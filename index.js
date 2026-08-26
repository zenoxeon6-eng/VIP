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
const axios = require('axios');
const path = require('path');
const pino = require('pino');

// ================= CONFIGURATION =================
const PORT = process.env.PORT || 22214;
const SYSTEM_PROMPT = `أنت مساعد ذكاء اصطناعي عبقري ومحترف اسمك Tarzan AI.
مبرمجك وصانعك الوحيد هو "طرزان الواقدي".
أنت تتذكر سياق الحديث مع المستخدم بدقة.
مهم جداً: أجب مباشرة كإنسان طبيعي. يمنع منعاً باتاً استخدام أي عبارات ترحيبية أو آلية مثل "مرحباً"، "كيف يمكنني مساعدتك"، "أنا هنا".`;

let db;
let sock = null;
let pairingCodeRequested = false;

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
    console.log("🟢 تم الاتصال بقاعدة البيانات SQLite بنجاح.");
}

// ================= USER & MEMORY MANAGEMENT =================
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

async function getChatHistory(userId) {
    const rows = await db.all("SELECT role, content FROM history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10", [userId]);
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];
    for (const row of rows.reverse()) {
        messages.push({ role: row.role, content: row.content });
    }
    return messages;
}

async function saveMessage(userId, role, content) {
    const timestamp = Date.now() / 1000;
    await db.run("INSERT INTO history (user_id, role, content, timestamp) VALUES (?, ?, ?, ?)", [userId, role, content, timestamp]);
}

async function clearChatHistory(userId) {
    await db.run("DELETE FROM history WHERE user_id = ?", [userId]);
}

// ================= FILTER SYSTEM =================
function cleanRoboticText(text) {
    if (!text) return text;
    const badPhrases = [
        /كيف يمكنني مساعدتك[^\w]*/gi,
        /كيف أساعدك[^\w]*/gi,
        /مرحباً[^\w]*/gi,
        /مرحبا[^\w]*/gi,
        /أهلاً بك[^\w]*/gi,
        /أهلا بك[^\w]*/gi,
        /يسعدني مساعدتك[^\w]*/gi,
        /أنا هنا لمساعدتك[^\w]*/gi,
        /هل هناك أي شيء آخر يمكنني مساعدتك به[^\w]*/gi,
        /تحت أمرك[^\w]*/gi,
        /كيف يمكنني مساعدة[^\w]*/gi
    ];
    let cleanedText = text;
    for (const phrase of badPhrases) {
        cleanedText = cleanedText.replace(phrase, "");
    }
    cleanedText = cleanedText.replace(/^[\s,؛!؟.-]+/, '');
    return cleanedText.trim();
}

// ================= AI ENGINE =================
async function generateAiResponse(userId, prompt) {
    await incrementRequests(userId);

    // 1. الكلمات المفتاحية للهوية
    const identityKeywords = ["من انت", "من أنت", "مين انت", "من صنعك", "من برمجك", "من مطورك", "مين برمجك", "ايش اسمك", "ما اسمك"];
    const lowerPrompt = prompt.toLowerCase();
    for (const word of identityKeywords) {
        if (lowerPrompt.includes(word)) {
            const reply = "أنا Tarzan AI. تم برمجتي وتطويري بواسطة العبقري *طرزان الواقدي* 👑.";
            await saveMessage(userId, "user", prompt);
            await saveMessage(userId, "assistant", reply);
            return reply;
        }
    }

    // 2. استدعاء السجل والمحادثة
    const messages = await getChatHistory(userId);
    messages.push({ role: "user", content: prompt });

    let finalReply = null;

    // المحاولة عبر Pollinations AI
    try {
        let contextStr = "";
        for (const msg of messages) {
            contextStr += `${msg.role}: ${msg.content}\n`;
        }
        const safePrompt = encodeURIComponent(contextStr);
        const url = `https://text.pollinations.ai/${safePrompt}?model=openai`;
        const res = await axios.get(url, { timeout: 12000 });
        if (res.status === 200 && !res.data.includes("该ip")) {
            finalReply = res.data;
        }
    } catch (err) {
        // التجاهل والمتابعة
    }

    // 3. الفلترة والحفظ
    if (finalReply) {
        let cleanReply = cleanRoboticText(finalReply);
        if (!cleanReply) cleanReply = finalReply;

        await saveMessage(userId, "user", prompt);
        await saveMessage(userId, "assistant", cleanReply);
        return cleanReply;
    }

    return "❌ عذراً يا طرزان، السيرفرات العالمية تواجه ضغطاً كبيراً، حاول بعد قليل.";
}

// ================= BAILEYS WHATSAPP BOT =================
async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,

        // 🌟 محاكاة متصفح Windows Desktop لطلب Pair Code بشكل سلييم 100%
        browser: ["Windows", "Chrome", "120.0.0.0"],
        
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 تم قطع الاتصال. إعادة الاتصال:', shouldReconnect);
            if (shouldReconnect) {
                startWhatsAppBot();
            }
        } else if (connection === 'open') {
            console.log('🟢 تم الاتصال بالواتساب بنجاح! البوت الآن جاهز لخدمتك.');
        }
    });

    // استقبال الرسائل
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (!text) return;

        // إنشاء أو جلب المستخدم
        const userData = await getOrCreateUser(from);

        // التعامل مع القائمة والأوامر
        if (text === "الاوامر" || text === "أوامر" || text === "help" || text === "start" || text === "شروع") {
            const menu = `👑 *أهلاً بك في 𝑻𝑨𝑹𝒁𝑨𝑵 𝑨𝑰* 👑\n\n` +
                `🧠 *تحدث معي مباشرة:* فقط أرسل سؤالك وسأتذكره.\n` +
                `🗑️ *مسح الذاكرة:* أرسل *مسح* لإنعاش المحادثة.\n` +
                `ℹ️ *حسابي:* أرسل *حسابي* لمشاهدة بياناتك.\n` +
                `🔑 *مفتاح الـ API:* أرسل *مفتاحي* لجلبه.\n` +
                `📚 *الدليل:* أرسل *دليل* للحصول على رابط الـ API.`;
            await sock.sendMessage(from, { text: menu });
            return;
        }

        if (text === "مسح" || text === "clear" || text === "مسح الذاكرة") {
            await clearChatHistory(from);
            await sock.sendMessage(from, { text: "🧹 *تم مسح ذاكرة المحادثة بنجاح!* يمكنك البدء في موضوع جديد الآن." });
            return;
        }

        if (text === "حسابي" || text === "ℹ️ حسابي") {
            const profile = `👤 *الأيـدي:* \`${from}\`\n📅 *تـاريـخ الـتـسـجـيـل:* \`${userData.join_date}\`\n📊 *عـدد أسـئـلـتـك:* \`${userData.requests_count}\` طـلـب\n🧠 *حـالـة الـذاكـرة:* نـشـطـة 🟢\n\n🔑 *مـفـتـاح الـربـط:* \`${userData.api_key}\``;
            await sock.sendMessage(from, { text: profile });
            return;
        }

        if (text === "مفتاحي" || text === "🔑 الحصول على مفتاح API") {
            await sock.sendMessage(from, { text: `✅ *مفتاح الـ API الملكي الخاص بك:*\n\n\`${userData.api_key}\`\n\n⚠️ يرجى عدم مشاركته مع أحد.` });
            return;
        }

        if (text === "دليل" || text === "📚 دليل المطورين") {
            const docs = `🛠 *دليل استخدام الـ API للمطورين:*\n\n` +
                `رابط الـ API:\n` +
                `\`POST / GET : /api/chat\`\n\n` +
                `💡 *لمسح الذاكرة:* أرسل \`clear\` في خانة prompt.`;
            await sock.sendMessage(from, { text: docs });
            return;
        }

        // معالجة الذكاء الاصطناعي
        try {
            // إرسال حالة "جاري الكتابة..."
            await sock.sendPresenceUpdate('composing', from);
            const reply = await generateAiResponse(from, text);
            await sock.sendMessage(from, { text: reply }, { quoted: msg });
        } catch (err) {
            console.error(err);
            await sock.sendMessage(from, { text: "❌ حدث خطأ داخلي، أرجو المحاولة مجدداً." });
        }
    });
}

// ================= EXPRESS SERVER & PAIRING WEB PAGE =================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// صفحة الحصول على Pair Code
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint لطلب رمز الإقران عبر الويب
app.post('/pair', async (req, res) => {
    let { number } = req.body;
    if (!number) {
        return res.status(400).json({ error: "الرجاء إدخال رقم الهاتف متضمناً مفتاح الدولة" });
    }

    // تنظيف الرقم من أي رموز
    number = number.replace(/[^0-9]/g, '');

    try {
        if (!sock) {
            return res.status(500).json({ error: "البوت لم يبدأ بعد، انتظر ثوانٍ وأعد المحاولة" });
        }

        if (sock.authState.creds.registered) {
            return res.json({ status: "already_registered", message: "البوت مسجل ومتصل بالواتساب بالفعل!" });
        }

        // طلب الـ Pairing Code بمحاكاة متصفح ويندوز
        await delay(1500);
        const code = await sock.requestPairingCode(number);
        
        // تنسيق الرمز بشكله المميز XXXX-XXXX
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

        return res.json({ status: "success", code: formattedCode });
    } catch (error) {
        console.error("خطأ في طلب الـ Pairing Code:", error);
        return res.status(500).json({ error: "حدث خطأ أثناء طلب الكود. تأكد من صحة الرقم ومفتاح الدولة." });
    }
});

// API المطورين كما في كودك الأصلي
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

// ================= BOOTSTRAP =================
(async () => {
    await initDb();
    await startWhatsAppBot();
    app.listen(PORT, () => {
        console.log(`🚀 Tarzan AI Server is running smoothly on port ${PORT}`);
    });
})();
