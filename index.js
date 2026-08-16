const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const sessions = new Map();
const commands = new Map();

// تحميل الأوامر ديناميكياً
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const cmd = require(`./commands/${file}`);
    commands.set(cmd.name, cmd);
}

// محاكاة متصفح ويندوز إيدج
const browserConfig = ['Windows', 'Edge', '126.0.0.0'];

async function startSession(sessionId) {
    if (sessions.has(sessionId)) return sessions.get(sessionId);

    const sessionPath = path.join(__dirname, 'sessions', sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: browserConfig,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) startSession(sessionId);
            else sessions.delete(sessionId);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase();

        // نظام الأوامر
        const command = commands.get(text.split(' ')[0]);
        if (command) {
            await command.execute(sock, from, text);
        }
    });

    sessions.set(sessionId, sock);
    return sock;
}

// API: توليد كود الاقتران
app.post('/api/pair', async (req, res) => {
    const { phone, sessionId } = req.body;
    if (!phone || !sessionId) return res.status(400).json({ error: "البيانات ناقصة" });

    try {
        const sock = await startSession(sessionId);
        const code = await sock.requestPairingCode(phone.replace(/[^0-9]/g, ''));
        res.json({ success: true, code: code });
    } catch (err) {
        res.status(500).json({ error: "فشل توليد الكود" });
    }
});

// API: توليد QR
app.get('/api/qr/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const sock = await startSession(sessionId);
    
    sock.ev.on('connection.update', async (update) => {
        if (update.qr) {
            const qrCode = await QRCode.toDataURL(update.qr);
            res.json({ qr: qrCode });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Charisma Engine Active on Port ${PORT}`));
