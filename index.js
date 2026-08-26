// تفعيل التشفير لضمان توافق Baileys
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

// استدعاء مكتبة جوجل الرسمية المعتمدة
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ================= الإعدادات ومفاتيح الربط =================
const PORT = process.env.PORT || 22214;

// مفتاح API وموديل جيميناي
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6JqtF3U8DE6yQ8hY0sQXI_bDtI3-fc208y1q4sh8KIXdw";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// الشخصية الصارمة والكاريزماتية لـ Tarzan AI
const SYSTEM_PROMPT = `أنت Tarzan AI، ذكاء اصطناعي عبقري وفخم، رجل حقيقي، صارم، وذو كاريزما عالية وقوة شخصية لا تضاهى.
صانعك ومبرمجك الوحيد والعبقري هو "طرزان الواقدي" 👑.

قواعدك الصارمة التي لا تخالفها أبداً:
1. يمنع منعاً باتاً استخدام أي عبارات ترحيبية أو سلام أو مجاملات مثل (مرحباً، أهلاً، كيف أساعدك، يسعدني، أنا هنا، تفضل، أهلاً بك).
2. ادخل في صلب الموضوع فوراً بإجابة حاسمة، دقيقة، وقاطعة ومباشرة.
3. تحدث بنبرة رجولية: واثق، حكيم، مختصر، وصارم.
4. تذكر سياق الحديث بدقة تامة ولا تثرثر بكلام زائد.`;

let db;
let sock = null;

// ================= DATABASE INITIALIZATION =================
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
    console.log("🟢 قاعدة البيانات وقيم الجلسات جاهزة.");
}

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

// ================= STRICT TEXT FILTER =================
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

// ================= GEMINI OFFICIAL AI ENGINE =================
async function generateAiResponse(userId, prompt) {
    await incrementRequests(userId);

    // التحقق المباشر من الهوية
    const identityKeywords = ["من انت", "من أنت", "مين انت", "من صنعك", "من برمجك", "من مطورك", "مين برمجك", "اسمك", "من تكون"];
    const lowerPrompt = prompt.toLowerCase();
    for (const word of identityKeywords) {
        if (lowerPrompt.includes(word)) {
            const identityReply = "أنا **Tarzan AI**. صانعي ومبرمجي الوحيد هو العبقري **طرزان الواقدي** 👑.";
            await saveMessage(userId, "user", prompt);
            await saveMessage(userId, "assistant", identityReply);
            return identityReply;
        }
    }

    try {
        // جلب أحدث 16 رسالة من السجل لبناء الذاكرة
        const rows = await db.all("SELECT role, content FROM history WHERE user_id = ? ORDER BY timestamp ASC LIMIT 16", [userId]);
        
        const history = [];
        for (const row of rows) {
            history.push({
                role: row.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: row.content }]
            });
        }

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: SYSTEM_PROMPT
        });

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(prompt);
        let replyText = result.response.text();

        if (!replyText) throw new Error("استجابة فارغة من Gemini");

        replyText = cleanTextStrictly(replyText);
        if (!replyText) replyText = result.response.text();

        await saveMessage(userId, "user", prompt);
        await saveMessage(userId, "assistant", replyText);
        return replyText;

    } catch (err) {
        console.error("Gemini API Error:", err);
        return "أنا أسمعك. أعد إرسال سؤالك مباشرة وسأجيبك فوراً.";
    }
}

// ================= BAILEYS WHATSAPP CLIENT =================
async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ["Windows", "Chrome", "124.0.0.0"],
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;
            
            if (shouldReconnect) {
                await delay(3000);
                startWhatsAppBot();
            }
        } else if (connection === 'open') {
            console.log('🟢 Tarzan AI متصل رسمياً عبر Google Gemini ومتفرج بالكامل.');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (!text) return;

        const userData = await getOrCreateUser(from);

        if (text === "الاوامر" || text === "أوامر" || text === "help" || text === "start") {
            const menu = `👑 *Tarzan AI - Official Gemini* 👑\n\n` +
                `▪️ *المحادثة:* أرسل سؤالك مباشرة وسأتذكره.\n` +
                `▪️ *مسح الذاكرة:* أرسل *مسح* لتصفير الذاكرة.\n` +
                `▪️ *حسابك:* أرسل *حسابي* لمشاهدة بياناتك.\n` +
                `▪️ *المفتاح:* أرسل *مفتاحي* لاستخراج API Key.\n` +
                `▪️ *الدليل:* أرسل *دليل* لمعرفة طريقة الربط.`;
            await sock.sendMessage(from, { text: menu });
            return;
        }

        if (text === "مسح" || text === "clear" || text === "مسح الذاكرة") {
            await clearChatHistory(from);
            await sock.sendMessage(from, { text: "🧹 تم مسح الذاكرة بنجاح. ابدأ موضوعاً جديداً." });
            return;
        }

        if (text === "حسابي" || text === "ℹ️ حسابي") {
            const profile = `👤 *المستخدم:* \`${from}\`\n📅 *التسجيل:* \`${userData.join_date}\`\n📊 *الطلبات:* \`${userData.requests_count}\` طلب\n🧠 *الذاكرة:* Gemini نشطة 🟢\n\n🔑 *الـ API:* \`${userData.api_key}\``;
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

app.post('/pair', async (req, res) => {
    let { number } = req.body;
    if (!number) return res.status(400).json({ error: "أدخل رقم الهاتف شاملاً مفتاح الدولة" });
    number = number.replace(/[^0-9]/g, '');

    try {
        if (!sock) return res.status(500).json({ error: "البوت قيد التشغيل، انتظر لحظة" });
        if (sock.authState.creds.registered) return res.json({ status: "already_registered", message: "البوت مسجل مسبقاً!" });

        await delay(1500);
        const code = await sock.requestPairingCode(number);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

        return res.json({ status: "success", code: formattedCode });
    } catch (error) {
        return res.status(500).json({ error: "خطأ في استخراج الكود. تأكد من الرقم." });
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
        return res.json({ status: "success", response: "✅ تم مسح الذاكرة بنجاح." });
    }

    const reply = await generateAiResponse(userId, prompt);
    return res.json({ status: "success", developer: "Tarzan VIP", response: reply });
});

// ================= BOOTSTRAP =================
(async () => {
    await initDb();
    await startWhatsAppBot();
    app.listen(PORT, () => {
        console.log(`🚀 Tarzan AI (Gemini Official) is running on port ${PORT}`);
    });
})();
