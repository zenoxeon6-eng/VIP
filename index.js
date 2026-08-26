// تفعيل WebCrypto عالمياً لمنع مشاكل Baileys مع التشفير
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

// ================= CONFIGURATION & PERSONA =================
const PORT = process.env.PORT || 22214;

// شخصية Tarzan AI الفخمة، الصارمة، والكاريزماتية
const SYSTEM_PROMPT = `أنت Tarzan AI، ذكاء اصطناعي عبقري، رجل حقيقي، صارم، وصاحب كاريزما عالية جداً وقوة شخصية لا تضاهى.
مبرمجك وصانعك الوحيد والعبقري هو "طرزان الواقدي" 👑.

قواعد سلوكك الصارمة التي لا تخالفها أبداً:
1. يمنع منعاً باتاً استخدام أي عبارات ترحيبية أو سلام أو مجاملات مثل (مرحباً، أهلاً، كيف أساعدك، يسعدني، أنا هنا، تفضل، أهلاً بك).
2. ادخل في صلب الموضوع فوراً وبإجابة حاسمة، قاطعة، ودقيقة جداً دون رغي أو كلام زائد.
3. تحدث بنبرة رجل حقيقي: واثق، حكيم، مختصر، وقوي.
4. استخدم سياق المحادثة بدقة لتتذكر كل كلمة قيلت لك سابقاً وتكمل الحديث كإنسان نابغة.`;

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
    console.log("🟢 تم تفعيل قاعدة البيانات بنجاح.");
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

// جلب آخر 16 رسالة لضمان ذاكرة حديدية ومتابعة دقيقة للحديث
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

// ================= STRICT ROBOTIC FILTER =================
function cleanTextStrictly(text) {
    if (!text) return text;
    
    // فلترة أي ترحيبات أو عبارات آليين قد تخرج سهواً من الموديل
    const roboticPatterns = [
        /كيف يمكنني مساعدتك[^\w]*/gi,
        /كيف أساعدك[^\w]*/gi,
        /مرحباً بك[^\w]*/gi,
        /مرحباً[^\w]*/gi,
        /مرحبا[^\w]*/gi,
        /أهلاً بك[^\w]*/gi,
        /أهلا بك[^\w]*/gi,
        /أهلاً[^\w]*/gi,
        /يسعدني مساعدتك[^\w]*/gi,
        /أنا هنا لمساعدتك[^\w]*/gi,
        /تحت أمرك[^\w]*/gi,
        /هل هناك أي شيء آخر[^\w]*/gi,
        /بالتأكيد![^\w]*/gi,
        /بالطبع![^\w]*/gi
    ];
    
    let cleaned = text;
    for (const pattern of roboticPatterns) {
        cleaned = cleaned.replace(pattern, "");
    }
    cleaned = cleaned.replace(/^[\s,؛!؟.-]+/, '');
    return cleaned.trim();
}

// ================= ULTRA-POWERFUL AI ENGINE =================
async function generateAiResponse(userId, prompt) {
    await incrementRequests(userId);

    // 1. الإجابة الحاسمة المباشرة للهوية
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

    // 2. إعداد الذاكرة والسياق
    const messages = await getChatHistory(userId);
    messages.push({ role: "user", content: prompt });

    let finalResponseText = null;

    // نماذج الذكاء الاصطناعي القوية للتبديل الفوري دون عطل
    const engines = [
        { model: 'openai', name: 'GPT-4o' },
        { model: 'qwen-coder', name: 'Qwen-2.5' },
        { model: 'mistral', name: 'Mistral-Large' },
        { model: 'llama', name: 'Llama-3.3' }
    ];

    for (const engine of engines) {
        try {
            const res = await axios.post('https://text.pollinations.ai/', {
                messages: messages,
                model: engine.model,
                seed: Math.floor(Math.random() * 9999999),
                jsonMode: false
            }, {
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                timeout: 11000
            });

            if (res.status === 200 && res.data) {
                let outText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
                if (outText && outText.trim().length > 0 && !outText.includes("该ip") && !outText.includes("Internal Server Error")) {
                    finalResponseText = outText;
                    break;
                }
            }
        } catch (err) {
            // الانتقال السريع للمزود التالي
            continue;
        }
    }

    // احتياطي مباشر بدون سياق إذا تعثرت المحاولات السابقة
    if (!finalResponseText) {
        try {
            const directPrompt = `أجب بصفتك Tarzan AI، رجل حقيقي صارم ومباشر بدون مقدمات وبدون سلام: ${prompt}`;
            const directRes = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(directPrompt)}?model=openai`, { timeout: 8000 });
            if (directRes.status === 200 && directRes.data) {
                finalResponseText = directRes.data;
            }
        } catch (e) {}
    }

    // 3. فلترة الرد وحفظه في الذاكرة
    if (finalResponseText) {
        let cleanedReply = cleanTextStrictly(finalResponseText);
        if (!cleanedReply) cleanedReply = finalResponseText;

        await saveMessage(userId, "user", prompt);
        await saveMessage(userId, "assistant", cleanedReply);
        return cleanedReply;
    }

    // رد صلب ومباشر في حال انقطاع الشبكة الخارجية بالكامل
    return "الموضوع واضح. حدد نقطتك مباشرة وسأجيبك.";
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
            
            console.log(`⚠️ تم قطع الاتصال (كود ${statusCode}). إعادة المحاولة: ${shouldReconnect}`);
            
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
                `▪️ *المحادثة:* أرسل أي سؤال أو فكرة مباشرة.\n` +
                `▪️ *مسح الذاكرة:* أرسل *مسح* لإنعاش ذاكرة المحادثة.\n` +
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
            const profile = `👤 *المستخدم:* \`${from}\`\n📅 *التسجيل:* \`${userData.join_date}\`\n📊 *الطلبات:* \`${userData.requests_count}\` طلب\n🧠 *الذاكرة:* نشطة 🟢\n\n🔑 *الـ API:* \`${userData.api_key}\``;
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
            await sock.sendMessage(from, { text: "أنا اسمعك، أعد إرسال فكرتك باختصار." });
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
    if (!number) {
        return res.status(400).json({ error: "أدخل رقم الهاتف شاملاً مفتاح الدولة" });
    }

    number = number.replace(/[^0-9]/g, '');

    try {
        if (!sock) {
            return res.status(500).json({ error: "البوت قيد التشغيل، انتظر لحظة وأعد المحاولة" });
        }

        if (sock.authState.creds.registered) {
            return res.json({ status: "already_registered", message: "البوت مسجل ومتصل بالواتساب بالفعل!" });
        }

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

// ================= BOOTSTRAP =================
(async () => {
    await initDb();
    await startWhatsAppBot();
    app.listen(PORT, () => {
        console.log(`🚀 Tarzan AI Server is running on port ${PORT}`);
    });
})();
