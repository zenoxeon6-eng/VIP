const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs-extra');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const config = require('./config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// متغيرات حالة البوت والويب
let sock = null;
let currentQR = '';
let isConnected = false;

// إدارة قاعدة البيانات المحلية
const DB_FILE = './database.json';
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, ads: [], verifiedUsers: [] }, null, 2));
}

function getDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// تشغيل محرك الواتساب
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./charisma_session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // سنعرضه على صفحة الويب
        auth: state,
        browser: ['Charisma OS', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = await QRCode.toDataURL(qr);
            isConnected = false;
        }

        if (connection === 'open') {
            console.log('👑 [Charisma Engine] تم الاتصال بنجاح بالواتساب!');
            isConnected = true;
            currentQR = '';
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('⚠️ تم قطع الاتصال، إعادة الاتصال تلقائياً...', shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.buttonsResponseMessage?.selectedButtonId || '';

        const db = getDB();

        if (!db.users[from]) {
            db.users[from] = { joinedAt: new Date().toISOString() };
            saveDB(db);
        }

        const isAdmin = config.admins.includes(from);
        const isVerified = db.verifiedUsers.includes(from);

        // التحقق من الاشتراك الإجباري بالقناة
        if (!isVerified && !isAdmin && text !== 'verify_sub') {
            await sock.sendMessage(from, {
                text: `👑 *أهـلاً بك في ${config.botName}*\n\n⚠️ *تنبيه:* لا يمكنك استخدام خدمات البوت إلا بعد الاشتراك بالقناة الرسمية:\n${config.officialChannel}\n\nاضغط على الزر أدناه بعد الاشتراك لتأكيد تفعيل البوت:`,
                footer: "Charisma VIP System",
                buttons: [
                    { buttonId: 'verify_sub', buttonText: { displayText: '✅ تم الاشتراك (تأكيد)' }, type: 1 }
                ]
            });
            return;
        }

        if (text === 'verify_sub') {
            if (!db.verifiedUsers.includes(from)) {
                db.verifiedUsers.push(from);
                saveDB(db);
            }
            await sock.sendMessage(from, { text: "🎉 *تم تأكيد اشتراكك بنجاح! مرحباً بك في عالم الكاريزما.*" });
            return sendMainMenu(from, isAdmin);
        }

        if (text === '/start' || text === 'القائمة' || text === 'menu') {
            return sendMainMenu(from, isAdmin);
        }
    });
}

async function sendMainMenu(from, isAdmin) {
    const listMessage = {
        text: "⚡ *مـرحـبـاً بك في نـظـام الكاريزما الـتـرويـجـي*\nاختر من القائمة الخدمة المطلوبة:",
        footer: "Charisma Engine v2.0",
        title: "⚜️ *الـقـائـمـة الـرئـيـسـيـة* ⚜️",
        buttonText: "📜 اضغط لاختيار الخيار",
        sections: [
            {
                title: "💎 خدمات الكاريزما VIP",
                rows: [
                    { title: "📢 القنوات المروجة", rowId: "opt_ads", description: "استعراض العروض والقنوات المعتمدة" },
                    { title: "🚀 طلب ترويج قناة", rowId: "opt_request", description: "تقديم طلب لترويج قناتك" }
                ]
            }
        ]
    };
    await sock.sendMessage(from, listMessage);
}

// 🌐 API واجهة الويب
app.get('/api/status', (req, res) => {
    res.json({ isConnected, hasQR: !!currentQR });
});

app.get('/api/qr', (req, res) => {
    res.json({ qr: currentQR });
});

app.post('/api/pair', async (req, res) => {
    try {
        let { phone } = req.body;
        if (!phone) return res.status(400).json({ error: "يرجى كتابة رقم الهاتف" });

        phone = phone.replace(/[^0-9]/g, '');
        if (!sock) return res.status(500).json({ error: "السيرفر غير جاهز حالياً" });

        if (isConnected) {
            return res.json({ success: false, message: "البوت متصل بالفعل!" });
        }

        const code = await sock.requestPairingCode(phone);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

        res.json({ success: true, code: formattedCode });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message || "حدث خطأ أثناء طلب كود الاقتران" });
    }
});

// تشغيل السيرفر والبوت
app.listen(config.port, () => {
    console.log(`🌐 [Web Server] يعمل بنجاح على المنفذ: ${config.port}`);
    startBot();
});
