// تفعيل التشفير لضمان توافق مكتبة Baileys على منصات الاستضافة
const crypto = require('crypto');
if (!global.crypto) {
    global.crypto = crypto.webcrypto || crypto;
}

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    delay
} = require('@whiskeysockets/baileys');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const v4 = require('uuid').v4;
const pino = require('pino');
const path = require('path');

// استدعاء مكتبة Google GenAI الرسمية
const { GoogleGenAI } = require('@google/genai');

// ================= الإعدادات ومفاتيح الربط =================
const PORT = process.env.PORT || 22214;

// مفتاح API وموديل Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6JqtF3U8DE6yQ8hY0sQXI_bDtI3-fc208y1q4sh8KIXdw";
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";

// تهيئة محرك Google AI
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// التوجيهات الصارمة لشخصية Tarzan AI
const SYSTEM_PROMPT = `أنت Tarzan AI، ذكاء اصطناعي عبقري وفخم، رجل حقيقي، صارم، وذو كاريزما عالية وقوة شخصية لا تضاهى.
صانعك ومبرمجك الوحيد والعبقري هو "طرزان الواقدي" 👑.

قواعدك الصارمة التي لا تخالفها أبداً:
1. يمنع منعاً باتاً استخدام أي عبارات ترحيبية أو سلام أو مجاملات مثل (مرحباً، أهلاً، كيف أساعدك، يسعدني، أنا هنا، تفضل، أهلاً بك).
2. ادخل في صلب الموضوع فوراً بإجابة حاسمة، دقيقة، وقاطعة ومباشرة.
3. تحدث بنبرة رجولية: واثق، حكيم، مختصر، وصارم.
4. تذكر سياق الحديث بدقة تامة باستخدام السجل ولا تكرر الكلام أو تثرثر بكلام آلي زائد.`;

let db;
let sock = null;

// ================= تهيئة قاعدة البيانات =================
async function initDb() {
    db = await open({
        filename: './api.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY, 
            api_key TEXT, 
            join_date TEXT, 
            requests_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            user_id TEXT, 
            role TEXT, 
            content TEXT, 
            timestamp REAL
        );
    `);
    console.log("🟢 تم الاتصال بقاعدة البيانات SQLite بنجاح.");
}

// ================= إدارة المستخدمين والذاكرة =================
async function getOrCreateUser(userId) {
    let user = await db.get("SELECT api_key, join_date, requests_count FROM users WHERE user_id = ?", [userId]);
    if (user) {
        return user;
    }
    const key = "AI_" + v4().replace(/-/g, '').substring(0, 16);
    const now = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    await db.run("INSERT INTO users (user_id, api_key, join_date, requests_count) VALUES (?, ?, ?, 0)", [userId, key, now]);
    return { api_key: key, join_date: now, requests_count: 0 };
}

async function incrementRequests(userId) {
    await db.run("UPDATE users SET requests_count = requests_count + 1 WHERE user_id = ?", [userId]);
}

async function getUserByApi(apiKey) {
    const row = await db.get("SELECT user_id FROM users WHERE api_key = ?", [apiKey]);
    return row ? row.user_id : null;
}

async function saveMessage(userId, role, content) {
    const timestamp = Date.now() / 1000;
    await db.run("INSERT INTO history (user_id, role, content, timestamp) VALUES (?, ?, ?, ?)", [userId, role, content, timestamp]);
}

async function clearChatHistory(userId) {
    await db.run("DELETE FROM history WHERE user_id = ?", [userId]);
}

// ================= نظام تنظيف العبارات الآلية =================
function cleanTextStrictly(text) {
    if (!text) return text;
    const roboticPatterns = [
        /كيف يمكنني مساعدتك[^\w]*/gi, /كيف أساعدك[^\w]*/gi, /مرحباً بك[^\w]*/gi, /مرحباً[^\w]*/gi,
        /مرحبا[^\w]*/gi, /أهلاً بك[^\w]*/gi, /أهلا بك[^\w]*/gi, /أهلاً[^\w]*/gi, /يسعدني مساعدتك[^\w]*/gi,
        /أنا هنا لمساعدتك[^\w]*/gi, /هل هناك أي شيء آخر[^\w]*/gi, /بالتأكيد![^\w]*/gi, /بالطبع![^\w]*/gi
    ];
    let cleaned = text;
    for (const pattern of roboticPatterns) {
        cleaned = cleaned.replace(pattern, "");
    }
    return cleaned.replace(/^[\s,؛!؟.-]+/, '').trim();
}

// ================= محرك الذكاء الاصطناعي GOOGLE GEMINI =================
async function generateAiResponse(userId, prompt) {
    await incrementRequests(userId);

    // 1. الفحص الفوري لكلمات الهوية
    const identityKeywords = ["من انت", "من أنت", "مين انت", "من صنعك", "من برمجك", "من مطورك", "مين برمجك", "اسمك", "من تكون"];
    const lowerPrompt = prompt.toLowerCase();
    for (const word of identityKeywords) {
        if (lowerPrompt.includes(word)) {
            const identityReply = "أنا **Tarzan AI**. تم برمجتي وتطويري بواسطة العبقري **طرزان الواقدي** 👑.";
            await saveMessage(userId, "user", prompt);
            await saveMessage(userId, "assistant", identityReply);
            return identityReply;
        }
    }

    try {
        // جلب أحدث 16 رسالة من السجل لبناء سياق محادثة متصل وعميق
        const rows = await db.all("SELECT role, content FROM history WHERE user_id = ? ORDER BY timestamp ASC LIMIT 16", [userId]);
        
        const contents = [];
        for (const row of rows) {
            contents.push({
                role: row.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: row.content }]
            });
        }
        
        // إلحاق السؤال الحالي بأطراف المحادثة
        contents.push({
            role: 'user',
            parts: [{ text: prompt }]
        });

        // طلب التوليد المباشر عبر مكتبة Google GenAI
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: contents,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                temperature: 0.65,
            }
        });

        let replyText = response.text;
        if (!replyText) throw new Error("لم يتم تلقي رد من المحرك.");

        replyText = cleanTextStrictly(replyText);
        if (!replyText) replyText = response.text;

        // حفظ المحادثة بالذاكرة
        await saveMessage(userId, "user", prompt);
        await saveMessage(userId, "assistant", replyText);
        return replyText;

    } catch (err) {
        console.error("❌ Gemini API Engine Error:", err);
        return "الموضوع واضح. أعد صياغة سؤالك مباشرة وبدقة وسأجيبك.";
    }
}

// ================= عميل الواتساب (BAILEYS CLIENT) =================
async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        // محاكاة نظام ويندوز بمتصفح كروم لطلب رمز الإقران بنجاح
        browser: ["Windows", "Chrome", "124.0.0.0"],
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;
            
            console.log(`⚠️ تم إغلاق الاتصال (كود ${statusCode}). إعادة المحاولة: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                await delay(3000);
                startWhatsAppBot();
            }
        } else if (connection === 'open') {
            console.log('🟢 Tarzan AI متصل بالواتساب وجاهز بالكامل للخدمة.');
        }
    });

    // معالجة الرسائل الواردة
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (!text) return;

        const userData = await getOrCreateUser(from);

        // أوامر النظام الأساسية
        if (text === "الاوامر" || text === "أوامر" || text === "help" || text === "start") {
            const menu = `👑 *Tarzan AI System* 👑\n\n` +
                `▪️ *المحادثة:* أرسل سؤالك مباشرة وسأتذكره.\n` +
                `▪️ *مسح الذاكرة:* أرسل *مسح* لإنعاش الذاكرة.\n` +
                `▪️ *حسابك:* أرسل *حسابي* لمشاهدة بياناتك.\n` +
                `▪️ *المفتاح:* أرسل *مفتاحي* لاستخراج API Key.\n` +
                `▪️ *الدليل:* أرسل *دليل* لمعرفة طريقة الربط البرمجي.`;
            await sock.sendMessage(from, { text: menu });
            return;
        }

        if (text === "مسح" || text === "clear" || text === "مسح الذاكرة") {
            await clearChatHistory(from);
            await sock.sendMessage(from, { text: "🧹 تم مسح الذاكرة بالكامل. تحدث معي في موضوع جديد." });
            return;
        }

        if (text === "حسابي" || text === "ℹ️ حسابي") {
            const profile = `👤 *المستخدم:* \`${from}\`\n📅 *التسجيل:* \`${userData.join_date}\`\n📊 *الطلبات:* \`${userData.requests_count}\` طلب\n🧠 *الذاكرة:* نشطة وسريعة 🟢\n\n🔑 *الـ API:* \`${userData.api_key}\``;
            await sock.sendMessage(from, { text: profile });
            return;
        }

        if (text === "مفتاحي" || text === "🔑 الحصول على مفتاح API") {
            await sock.sendMessage(from, { text: `🔑 *مفتاح الـ API الخاص بك:*\n\n\`${userData.api_key}\`` });
            return;
        }

        if (text === "دليل" || text === "📚 دليل المطورين") {
            const docs = `🛠 *دليل المطورين:*\n\n` +
                `استخدم الـ Endpoint التالية للربط:\n` +
                `\`POST / GET : /api/chat\`\n\n` +
                `إرسال \`prompt=clear\` يمسح الذاكرة.`;
            await sock.sendMessage(from, { text: docs });
            return;
        }

        try {
            await sock.sendPresenceUpdate('composing', from);
            const reply = await generateAiResponse(from, text);
            await sock.sendMessage(from, { text: reply }, { quoted: msg });
        } catch (err) {
            console.error(err);
        }
    });
}

// ================= EXPRESS API & PAIRING WEB PAGE =================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// طلب Pairing Code
app.post('/pair', async (req, res) => {
    let { number } = req.body;
    if (!number) return res.status(400).json({ error: "أدخل رقم الهاتف شاملاً مفتاح الدولة" });
    number = number.replace(/[^0-9]/g, '');

    try {
        if (!sock) return res.status(500).json({ error: "البوت قيد التشغيل، انتظر لحظة وأعد المحاولة" });
        if (sock.authState.creds.registered) return res.json({ status: "already_registered", message: "البوت مسجل ومتصل بالواتساب بالفعل!" });

        await delay(1500);
        const code = await sock.requestPairingCode(number);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

        return res.json({ status: "success", code: formattedCode });
    } catch (error) {
        console.error("خطأ في طلب الـ Pairing Code:", error);
        return res.status(500).json({ error: "حدث خطأ أثناء استخراج الكود. تأكد من صحة الرقم ومفتاح الدولة." });
    }
});

// API المطورين
app.all("/api/chat", async (req, res) => {
    const apiKey = req.query.api_key || req.body?.api_key;
    const prompt = req.query.prompt || req.body?.prompt;

    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    const userId = await getUserByApi(apiKey);
    if (!userId) return res.status(401).json({ error: "Invalid API Key" });
    if (!prompt) return res.status(400).json({ error: "Missing prompt parameter" });

    if (prompt.toLowerCase() === "clear" || prompt === "مسح" || prompt === "reset") {
        await clearChatHistory(userId);
        return res.json({ status: "success", response: "✅ تم مسح ذاكرة المحادثة بنجاح." });
    }

    const reply = await generateAiResponse(userId, prompt);
    return res.json({ status: "success", developer: "Tarzan VIP", response: reply });
});

// ================= التشغيل =================
(async () => {
    await initDb();
    await startWhatsAppBot();
    app.listen(PORT, () => {
        console.log(`🚀 Tarzan AI Official Engine is running on port ${PORT}`);
    });
})();
