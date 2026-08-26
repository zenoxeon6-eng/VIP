// تفعيل التشفير لضمان عمل البوت بدون مشاكل مع Baileys
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
const axios = require('axios');
const path = require('path');
const pino = require('pino');

// ================= إعدادات الشخصية الصارمة (Tarzan AI) =================
const PORT = process.env.PORT || 22214;
const SYSTEM_PROMPT = `أنت Tarzan AI، ذكاء اصطناعي فخم، رجل حقيقي، صارم، وذو كاريزما عالية جداً وقوة شخصية لا تضاهى.
صانعك ومبرمجك الوحيد هو "طرزان الواقدي" 👑.

قواعدك الصارمة التي لا تخالفها أبداً:
1. ممنوع الترحيب أو المجاملات (لا تقل مرحباً، أهلاً، كيف أساعدك، أنا هنا).
2. ادخل في صلب الموضوع فوراً بإجابة حاسمة، دقيقة، ومباشرة.
3. تحدث بنبرة رجولية: واثق، حكيم، مختصر، وصارم.
4. تذكر سياق الحديث بدقة وافهم القصد بسرعة ولا تثرثر بكلام زائد.`;

let db;
let sock = null;

// ================= قاعدة البيانات والذاكرة =================
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
    console.log("🟢 تم تفعيل قاعدة البيانات بنجاح.");
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

// الذاكرة الحديدية (تتذكر آخر 16 رسالة للحفاظ على السياق)
async function getChatHistory(userId) {
    const rows = await db.all("SELECT role, content FROM history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 16", [userId]);
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

// ================= الفلتر الصارم لمنع العبارات الآلية =================
function cleanTextStrictly(text) {
    if (!text) return text;
    const roboticPatterns = [
        /كيف يمكنني مساعدتك/g, /كيف أساعدك/g, /مرحباً بك/g, /مرحباً/g,
        /مرحبا/g, /أهلاً بك/g, /أهلا بك/g, /أهلاً/g, /يسعدني مساعدتك/g,
        /أنا هنا لمساعدتك/g, /هل هناك أي شيء آخر/g, /هل أستطيع مساعدتك/g
    ];
    let cleaned = text;
    for (const pattern of roboticPatterns) {
        cleaned = cleaned.replace(pattern, "");
    }
    cleaned = cleaned.replace(/^[\s,؛!؟.-]+/, ''); // إزالة العلامات الزائدة من البداية
    return cleaned.trim();
}

// ================= المحرك المتوازي الجبار (CONCURRENT AI ENGINE) =================
async function generateAiResponse(userId, prompt) {
    await incrementRequests(userId);

    // 1. الإجابة الصارمة للهوية
    const identityKeywords = ["من انت", "من أنت", "مين انت", "من صنعك", "من برمجك", "من مطورك", "مين برمجك", "اسمك", "من تكون"];
    const lowerPrompt = prompt.toLowerCase();
    for (const word of identityKeywords) {
        if (lowerPrompt.includes(word)) {
            const identityReply = "أنا **Tarzan AI**. صانعي ومبرمجي الوحيد هو **طرزان الواقدي** 👑.";
            await saveMessage(userId, "user", prompt);
            await saveMessage(userId, "assistant", identityReply);
            return identityReply;
        }
    }

    // 2. إعداد الذاكرة
    const messages = await getChatHistory(userId);
    messages.push({ role: "user", content: prompt });

    // تجهيز سياق مختصر للروابط المباشرة (لتجنب خطأ 414 URI Too Long)
    let shortContext = `${SYSTEM_PROMPT}\n\n`;
    const recentMsgs = messages.slice(-5); // نأخذ أحدث 5 رسائل فقط للروابط القصيرة
    for (const msg of recentMsgs) {
        if (msg.role !== 'system') {
            shortContext += `${msg.role === 'user' ? 'المستخدم' : 'أنت'}: ${msg.content}\n`;
        }
    }
    if (shortContext.length > 1500) shortContext = shortContext.substring(shortContext.length - 1500);

    let finalResponseText = null;

    // 3. الهجوم المتوازي (إرسال الطلب لـ 4 سيرفرات في نفس اللحظة، والأسرع يفوز)
    const promises = [];

    // المزود الأول: Pollinations POST (يدعم الذاكرة الكاملة)
    promises.push(
        axios.post('https://text.pollinations.ai/', {
            messages: messages,
            model: 'openai',
            seed: Math.floor(Math.random() * 99999)
        }, { timeout: 15000 }).then(res => {
            let text = typeof res.data === 'string' ? res.data : (res.data.choices?.[0]?.message?.content || JSON.stringify(res.data));
            if (text && !text.includes("该ip") && !text.includes("Error")) return text;
            throw new Error("Bad Response");
        })
    );

    // المزود الثاني: Pollinations GET السريع
    promises.push(
        axios.get(`https://text.pollinations.ai/${encodeURIComponent(shortContext)}`, { timeout: 15000 })
        .then(res => {
            if (res.data && typeof res.data === 'string' && !res.data.includes("该ip")) return res.data;
            throw new Error("Bad Response");
        })
    );

    // المزود الثالث: Ryzendesu AI
    promises.push(
        axios.get(`https://api.ryzendesu.vip/api/ai/chatgpt?text=${encodeURIComponent(shortContext)}`, { timeout: 15000 })
        .then(res => {
            if (res.data && res.data.response) return res.data.response;
            throw new Error("Bad Response");
        })
    );

    // المزود الرابع: BK9 AI
    promises.push(
        axios.get(`https://bk9.fun/ai/gpt4?q=${encodeURIComponent(shortContext)}`, { timeout: 15000 })
        .then(res => {
            if (res.data && res.data.status && res.data.BK9) return res.data.BK9;
            throw new Error("Bad Response");
        })
    );

    // استلام أول رد صحيح من أسرع سيرفر (Promise.any)
    try {
        finalResponseText = await Promise.any(promises);
    } catch (errors) {
        console.error("⚠️ جميع مزودات الذكاء الاصطناعي فشلت أو تأخرت.");
        finalResponseText = null;
    }

    // 4. فلترة الرد وحفظه
    if (finalResponseText) {
        let cleanedReply = cleanTextStrictly(finalResponseText);
        if (!cleanedReply || cleanedReply.trim() === "") cleanedReply = finalResponseText;

        await saveMessage(userId, "user", prompt);
        await saveMessage(userId, "assistant", cleanedReply);
        return cleanedReply;
    }

    // لن تصل لهذه الرسالة إلا إذا انقطع الإنترنت بالكامل عن سيرفر Render
    return "السيرفرات العالمية تواجه انقطاعاً. سأرد عليك فور استقرار الشبكة.";
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
        browser: ["Windows", "Chrome", "122.0.0.0"],
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
            console.log('🟢 Tarzan AI متصل بالواتساب وجاهز بالكامل.');
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

        // أوامر البوت الأساسية
        if (text === "الاوامر" || text === "أوامر" || text === "help" || text === "start") {
            const menu = `👑 *Tarzan AI System* 👑\n\n` +
                `▪️ *المحادثة:* أرسل سؤالك مباشرة وسأتذكره.\n` +
                `▪️ *مسح الذاكرة:* أرسل *مسح* لإنعاش ذاكرتي.\n` +
                `▪️ *حسابك:* أرسل *حسابي* لمشاهدة بياناتك.\n` +
                `▪️ *المفتاح:* أرسل *مفتاحي* لاستخراج API Key.\n` +
                `▪️ *الدليل:* أرسل *دليل* لمعرفة طريقة الربط.`;
            await sock.sendMessage(from, { text: menu });
            return;
        }

        if (text === "مسح" || text === "clear" || text === "مسح الذاكرة") {
            await clearChatHistory(from);
            await sock.sendMessage(from, { text: "🧹 تم مسح الذاكرة بالكامل. تحدث معي في موضوع جديد." });
            return;
        }

        if (text === "حسابي" || text === "ℹ️ حسابي") {
            const profile = `👤 *المستخدم:* \`${from}\`\n📅 *التسجيل:* \`${userData.join_date}\`\n📊 *الطلبات:* \`${userData.requests_count}\` طلب\n🧠 *الذاكرة:* حديدية ونشطة 🟢\n\n🔑 *الـ API:* \`${userData.api_key}\``;
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
        if (!sock) return res.status(500).json({ error: "البوت قيد التشغيل، انتظر لحظة وأعد المحاولة" });
        if (sock.authState.creds.registered) return res.json({ status: "already_registered", message: "البوت مسجل ومتصل بالواتساب بالفعل!" });

        await delay(1500);
        const code = await sock.requestPairingCode(number);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

        return res.json({ status: "success", code: formattedCode });
    } catch (error) {
        return res.status(500).json({ error: "حدث خطأ أثناء استخراج الكود. تأكد من صحة الرقم." });
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

// ================= BOOTSTRAP =================
(async () => {
    await initDb();
    await startWhatsAppBot();
    app.listen(PORT, () => {
        console.log(`🚀 Tarzan AI Server is running on port ${PORT}`);
    });
})();
