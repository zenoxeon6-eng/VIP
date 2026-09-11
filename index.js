/**
 * PayPlus - Telegram Mini App Server + Admin Bot
 * Admin ID: 8233835640
 * Support: @no_vi1
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

// ============ CONFIG ============
const CONFIG = {
    BOT_TOKEN: '8909959176:AAF6V-RuF5nSAyKh1JOYijYoQJH7ZXB8GSM',
    ADMIN_ID: 8233835640,
    SUPPORT_USERNAME: '@no_vi1',
    PORT: process.env.PORT || 3000,
    MIN_WITHDRAW: 10,
    AD_REWARD: 0.50,
    DAILY_AD_LIMIT: 5,
    REFERRAL_REWARD: 0.75,
    DB_FILE: path.join(__dirname, 'database.json')
};

// ============ DATABASE ============
class Database {
    constructor() {
        this.data = this.load();
    }
    load() {
        try {
            if (fs.existsSync(CONFIG.DB_FILE)) {
                return JSON.parse(fs.readFileSync(CONFIG.DB_FILE, 'utf8'));
            }
        } catch (e) { console.error('DB Load Error:', e.message); }
        return {
            users: {},
            ads: [
                { id: 1, title: 'إعلان 1', url: 'https://t.me/Pay_PIus_Bot', reward: 0.50, active: true, type: 'video' },
                { id: 2, title: 'إعلان 2', url: 'https://t.me/Pay_PIus_Bot', reward: 0.50, active: true, type: 'video' },
                { id: 3, title: 'إعلان 3', url: 'https://t.me/Pay_PIus_Bot', reward: 0.50, active: true, type: 'video' },
                { id: 4, title: 'إعلان 4', url: 'https://t.me/Pay_PIus_Bot', reward: 0.50, active: true, type: 'video' },
                { id: 5, title: 'إعلان 5', url: 'https://t.me/Pay_PIus_Bot', reward: 0.50, active: true, type: 'video' }
            ],
            tasks: [
                { id: 1, title: 'قناة الشركاء 1', url: 'https://t.me/Pay_PIus_Bot', reward: 0.25, type: 'channel', active: true },
                { id: 2, title: 'قناة الشركاء 2', url: 'https://t.me/Pay_PIus_Bot', reward: 0.25, type: 'channel', active: true },
                { id: 3, title: 'بوت شريك', url: 'https://t.me/Pay_Plus_Bot', reward: 0.25, type: 'bot', active: true },
                { id: 4, title: 'قناة يوتيوب', url: 'https://youtube.com', reward: 0.50, type: 'youtube', active: true }
            ],
            withdrawals: [],
            stats: { totalUsers: 0, totalPaid: 0, totalAdsWatched: 0 }
        };
    }
    save() {
        try { fs.writeFileSync(CONFIG.DB_FILE, JSON.stringify(this.data, null, 2)); }
        catch (e) { console.error('DB Save Error:', e.message); }
    }
    getUser(id) {
        const uid = String(id);
        if (!this.data.users[uid]) {
            this.data.users[uid] = {
                id: uid,
                balance: 0,
                adsWatchedToday: 0,
                lastAdDate: new Date().toDateString(),
                totalAdsWatched: 0,
                completedTasks: [],
                invitedFriends: [],
                referredBy: null,
                inviteEarnings: 0,
                totalEarned: 0,
                banned: false,
                createdAt: Date.now()
            };
            this.data.stats.totalUsers++;
            this.save();
        }
        // Reset daily ads
        const today = new Date().toDateString();
        if (this.data.users[uid].lastAdDate !== today) {
            this.data.users[uid].adsWatchedToday = 0;
            this.data.users[uid].lastAdDate = today;
            this.save();
        }
        return this.data.users[uid];
    }
    updateUser(id, updates) {
        const uid = String(id);
        this.data.users[uid] = { ...this.getUser(id), ...updates };
        this.save();
        return this.data.users[uid];
    }
}

const db = new Database();

// ============ EXPRESS SERVER ============
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============ AUTH MIDDLEWARE ============
function validateInitData(initData) {
    try {
        const params = new URLSearchParams(initData);
        const userJson = params.get('user');
        if (!userJson) return null;
        return JSON.parse(userJson);
    } catch (e) { return null; }
}

// ============ API ROUTES ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/api/auth', (req, res) => {
    const { initData } = req.body;
    const tgUser = initData ? validateInitData(initData) : null;
    const userId = tgUser?.id || req.body.userId;
    if (!userId) return res.status(400).json({ error: 'No user ID' });

    const user = db.getUser(userId);
    if (user.banned) return res.status(403).json({ error: 'banned' });

    res.json({
        success: true,
        user: {
            id: user.id,
            balance: user.balance,
            adsWatchedToday: user.adsWatchedToday,
            totalAdsWatched: user.totalAdsWatched,
            completedTasks: user.completedTasks,
            invitedFriends: user.invitedFriends.length,
            inviteEarnings: user.inviteEarnings
        },
        ads: db.data.ads.filter(a => a.active),
        tasks: db.data.tasks.filter(t => t.active),
        config: {
            adReward: CONFIG.AD_REWARD,
            dailyLimit: CONFIG.DAILY_AD_LIMIT,
            minWithdraw: CONFIG.MIN_WITHDRAW,
            referralReward: CONFIG.REFERRAL_REWARD,
            supportUser: CONFIG.SUPPORT_USERNAME,
            botUsername: 'Pay_Plus_Bot'
        }
    });
});

app.post('/api/watch-ad', (req, res) => {
    const { userId, adId } = req.body;
    const user = db.getUser(userId);
    if (user.banned) return res.status(403).json({ error: 'banned' });
    if (user.adsWatchedToday >= CONFIG.DAILY_AD_LIMIT)
        return res.status(400).json({ error: 'limit_reached' });

    const ad = db.data.ads.find(a => a.id === adId && a.active);
    if (!ad) return res.status(404).json({ error: 'ad_not_found' });

    const newBalance = user.balance + ad.reward;
    db.updateUser(userId, {
        balance: newBalance,
        adsWatchedToday: user.adsWatchedToday + 1,
        totalAdsWatched: user.totalAdsWatched + 1,
        totalEarned: user.totalEarned + ad.reward
    });
    db.data.stats.totalAdsWatched++;
    db.save();

    res.json({ success: true, newBalance, reward: ad.reward });
});

app.post('/api/complete-task', (req, res) => {
    const { userId, taskId } = req.body;
    const user = db.getUser(userId);
    if (user.completedTasks.includes(taskId))
        return res.status(400).json({ error: 'already_done' });

    const task = db.data.tasks.find(t => t.id === taskId && t.active);
    if (!task) return res.status(404).json({ error: 'task_not_found' });

    const newBalance = user.balance + task.reward;
    db.updateUser(userId, {
        balance: newBalance,
        completedTasks: [...user.completedTasks, taskId],
        totalEarned: user.totalEarned + task.reward
    });

    res.json({ success: true, newBalance, reward: task.reward });
});

app.post('/api/withdraw', (req, res) => {
    const { userId, amount, method, address } = req.body;
    const user = db.getUser(userId);
    if (user.banned) return res.status(403).json({ error: 'banned' });
    if (amount < CONFIG.MIN_WITHDRAW) return res.status(400).json({ error: 'min_amount' });
    if (amount > user.balance) return res.status(400).json({ error: 'insufficient' });
    if (!address) return res.status(400).json({ error: 'no_address' });

    const withdrawal = {
        id: 'TX' + Date.now(),
        userId,
        amount,
        method,
        address,
        status: 'pending',
        date: Date.now()
    };

    db.data.withdrawals.push(withdrawal);
    db.updateUser(userId, { balance: user.balance - amount });
    db.save();

    // Notify admin
    bot.sendMessage(CONFIG.ADMIN_ID,
        `💸 *طلب سحب جديد*\n\n` +
        `👤 المستخدم: \`${userId}\`\n` +
        `💰 المبلغ: $${amount}\n` +
        `💳 الطريقة: ${method}\n` +
        `📍 العنوان: \`${address}\`\n` +
        `🆔 المعرف: \`${withdrawal.id}\`\n\n` +
        `للموافقة: /approve ${withdrawal.id}\n` +
        `للرفض: /reject ${withdrawal.id}`,
        { parse_mode: 'Markdown' }
    );

    res.json({ success: true, withdrawalId: withdrawal.id });
});

app.get('/api/withdrawals/:userId', (req, res) => {
    const list = db.data.withdrawals.filter(w => w.userId === String(req.params.userId));
    res.json({ success: true, withdrawals: list.reverse().slice(0, 20) });
});

// ============ TELEGRAM BOT ============
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });

const isAdmin = (msg) => msg.from.id === CONFIG.ADMIN_ID;

// Admin panel keyboard
const adminKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '📊 إحصائيات شاملة', callback_data: 'stats' }],
            [{ text: '📢 إدارة الإعلانات', callback_data: 'ads_menu' }, { text: '🎯 إدارة المهام', callback_data: 'tasks_menu' }],
            [{ text: '💸 طلبات السحب', callback_data: 'withdrawals' }, { text: '👥 المستخدمين', callback_data: 'users_menu' }],
            [{ text: '📣 إرسال بث', callback_data: 'broadcast' }, { text: '⚙️ الإعدادات', callback_data: 'settings' }],
            Plustext: '🔗 رابط التطبيق', callback_data: 'app_link' }]
        ]
    }
};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (isAdmin(msg)) {
        return bot.sendMessage(chatId,
            `👑 *لوحة تحكم PayPlus*\n\n` +
            `مرحباً بك يا مدير 👋\n` +
            `التحكم الكامل في التطبيق متاح لك\n\n` +
            `📈 المستخدمين: ${db.data.stats.totalUsers}\n` +
            `💰 الإجمالي المدفوع: $${db.data.stats.totalPaid.toFixed(2)}\n` +
            `👁️ المشاهدات الكلية: ${db.data.stats.totalAdsWatched}`,
            { parse_mode: 'Markdown', ...adminKeyboard }
        );
    }

    // Regular user
    const refBy = msg.text.split(' ')[1];
    const user = db.getUser(userId);
    
    if (refBy && refBy !== String(userId) && !user.referredBy) {
        const referrer = db.getUser(refBy);
        if (referrer && !referrer.invitedFriends.includes(String(userId))) {
            referrer.invitedFriends.push(String(userId));
            referrer.balance += CONFIG.REFERRAL_REWARD;
            referrer.inviteEarnings += CONFIG.REFERRAL_REWARD;
            db.save();
            bot.sendMessage(refBy, `🎉 صديق جديد انضم عبر رابطك! +$${CONFIG.REFERRAL_REWARD}`);
        }
        user.referredBy = refBy;
        db.save();
    }

    const webAppUrl = 'https://vip-mjia.onrender.com';
    bot.sendMessage(chatId,
        `🚀 *مرحباً بك في PayPlus!*\n\n` +
        `💰 اربح المال من خلال:\n` +
        `• مشاهدة الإعلانات ($${CONFIG.AD_REWARD} لكل إعلان)\n` +
        `• إكمال المهام\n` +
        `• دعوة الأصدقاء ($${CONFIG.REFERRAL_REWARD})\n\n` +
        `📱 اضغط على الزر أدناه لفتح التطبيق:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 فتح التطبيق', web_app: { url: webAppUrl } }],
                    [{ text: '📞 الدعم', url: `https://t.me/${CONFIG.SUPPORT_USERNAME.replace('@','')}` }]
                ]
            }
        }
    );
});

// ============ ADMIN CALLBACKS ============
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    if (!isAdmin(query)) {
        return bot.answerCallbackQuery(query.id, { text: '⚠️ للمدير فقط' });
    }
    bot.answerCallbackQuery(query.id);

    if (data === 'stats') {
        const users = Object.values(db.data.users);
        const totalBalances = users.reduce((s, u) => s + u.balance, 0);
        const pending = db.data.withdrawals.filter(w => w.status === 'pending').length;
        return bot.sendMessage(chatId,
            `📊 *الإحصائيات الشاملة*\n\n` +
            `👥 إجمالي المستخدمين: ${users.length}\n` +
            `💰 مجموع الأرصدة: $${totalBalances.toFixed(2)}\n` +
            `💸 إجمالي المسحوب: $${db.data.stats.totalPaid.toFixed(2)}\n` +
            `👁️ المشاهدات: ${db.data.stats.totalAdsWatched}\n` +
            `⏳ طلبات معلقة: ${pending}\n` +
            `📢 إعلانات نشطة: ${db.data.ads.filter(a => a.active).length}\n` +
            `🎯 مهام نشطة: ${db.data.tasks.filter(t => t.active).length}`,
            { parse_mode: 'Markdown', ...adminKeyboard }
        );
    }

    if (data === 'ads_menu') {
        let adsList = db.data.ads.map(a =>
            `${a.active ? '🟢' : '🔴'} #${a.id} - ${a.title} ($${a.reward})`
        ).join('\n');
        return bot.sendMessage(chatId,
            `📢 *إدارة الإعلانات*\n\n${adsList}\n\n` +
            `الأوامر:\n` +
            `/add_ad عنوان | رابط | مكافأة\n` +
            `/del_ad [ID]\n` +
            `/toggle_ad [ID]\n` +
            `/edit_ad [ID] | عنوان | رابط | مكافأة`,
            { parse_mode: 'Markdown', ...adminKeyboard }
        );
    }

    if (data === 'tasks_menu') {
        let tasksList = db.data.tasks.map(t =>
            `${t.active ? '🟢' : '🔴'} #${t.id} - ${t.title} (${t.type}) $${t.reward}`
        ).join('\n');
        return bot.sendMessage(chatId,
            `🎯 *إدارة المهام*\n\n${tasksList}\n\n` +
            `الأوامر:\n` +
            `/add_task عنوان | رابط | مكافأة | نوع\n` +
            `الأنواع: channel, bot, youtube\n` +
            `/del_task [ID]\n` +
            `/toggle_task [ID]`,
            { parse_mode: 'Markdown', ...adminKeyboard }
        );
    }

    if (data === 'withdrawals') {
        const pending = db.data.withdrawals.filter(w => w.status === 'pending');
        if (pending.length === 0) {
            return bot.sendMessage(chatId, '✅ لا توجد طلبات سحب معلقة', adminKeyboard);
        }
        for (const w of pending.slice(0, 5)) {
            await bot.sendMessage(chatId,
                `💸 *طلب سحب*\n\n` +
                `👤 المستخدم: \`${w.userId}\`\n` +
                `💰 المبلغ: $${w.amount}\n` +
                `💳 الطريقة: ${w.method}\n` +
                `📍 العنوان: \`${w.address}\`\n` +
                `🆔 \`${w.id}\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ موافقة', callback_data: `approve_${w.id}` },
                            { text: '❌ رفض', callback_data: `reject_${w.id}` }
                        ]]
                    }
                }
            );
        }
        return;
    }

    if (data === 'users_menu') {
        return bot.sendMessage(chatId,
            `👥 *إدارة المستخدمين*\n\n` +
            `/user [ID] - عرض بيانات مستخدم\n` +
            `/add_balance [ID] [مبلغ] - إضافة رصيد\n` +
            `/ban [ID] - حظر\n` +
            `/unban [ID] - رفع الحظر`,
            { parse_mode: 'Markdown', ...adminKeyboard }
        );
    }

    if (data === 'settings') {
        return bot.sendMessage(chatId,
            `⚙️ *الإعدادات الحالية*\n\n` +
            `💰 مكافأة الإعلان: $${CONFIG.AD_REWARD}\n` +
            `📊 الحد اليومي: ${CONFIG.DAILY_AD_LIMIT}\n` +
            `💸 الحد الأدنى للسحب: $${CONFIG.MIN_WITHDRAW}\n` +
            `👥 مكافأة الدعوة: $${CONFIG.REFERRAL_REWARD}\n\n` +
            `لتعديل قيمة استخدم:\n` +
            `/set ad_reward 0.5\n` +
            `/set daily_limit 5\n` +
            `/set min_withdraw 10\n` +
            `/set ref_reward 0.75`,
            { parse_mode: 'Markdown', ...adminKeyboard }
        );
    }

    if (data === 'app_link') {
        return bot.sendMessage(chatId,
            `🔗 *رابط التطبيق*\n\n` +
            `https://t.me/Pay_PIus_Bot/app`,
            { parse_mode: 'Markdown', ...adminKeyboard }
        );
    }

    if (data === 'broadcast') {
        return bot.sendMessage(chatId,
            `📣 أرسل الرسالة للبث:\n\n/broadcast نص الرسالة`,
            adminKeyboard
        );
    }

    // Approve/Reject
    if (data.startsWith('approve_')) {
        const wid = data.replace('approve_', '');
        const w = db.data.withdrawals.find(x => x.id === wid);
        if (w) {
            w.status = 'approved';
            db.data.stats.totalPaid += w.amount;
            db.save();
            bot.sendMessage(w.userId, `✅ تمت الموافقة على سحبك بمبلغ $${w.amount}!\nسيتم التحويل قريباً.`);
            bot.sendMessage(chatId, `✅ تمت الموافقة على ${wid}`);
        }
        return;
    }
    if (data.startsWith('reject_')) {
        const wid = data.replace('reject_', '');
        const w = db.data.withdrawals.find(x => x.id === wid);
        if (w) {
            w.status = 'rejected';
            const user = db.getUser(w.userId);
            db.updateUser(w.userId, { balance: user.balance + w.amount });
            db.save();
            bot.sendMessage(w.userId, `❌ تم رفض طلب السحب بمبلغ $${w.amount}. تم إعادة المبلغ لرصيدك.`);
            bot.sendMessage(chatId, `❌ تم الرفض ${wid}`);
        }
        return;
    }
});

// ============ ADMIN COMMANDS ============
bot.onText(/\/admin/, (msg) => {
    if (!isAdmin(msg)) return;
    bot.sendMessage(msg.chat.id, '👑 لوحة التحكم:', adminKeyboard);
});

bot.onText(/\/add_ad (.+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const parts = match[1].split('|').map(s => s.trim());
    if (parts.length < 3) return bot.sendMessage(msg.chat.id, '⚠️ الصيغة: /add_ad عنوان | رابط | مكافأة');
    const id = Math.max(0, ...db.data.ads.map(a => a.id)) + 1;
    db.data.ads.push({ id, title: parts[0], url: parts[1], reward: parseFloat(parts[2]), active: true, type: 'video' });
    db.save();
    bot.sendMessage(msg.chat.id, `✅ تم إضافة الإعلان #${id}`);
});

bot.onText(/\/del_ad (\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const id = parseInt(match[1]);
    db.data.ads = db.data.ads.filter(a => a.id !== id);
    db.save();
    bot.sendMessage(msg.chat.id, `✅ تم حذف الإعلان #${id}`);
});

bot.onText(/\/toggle_ad (\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const ad = db.data.ads.find(a => a.id === parseInt(match[1]));
    if (!ad) return bot.sendMessage(msg.chat.id, '❌ غير موجود');
    ad.active = !ad.active;
    db.save();
    bot.sendMessage(msg.chat.id, `✅ الإعلان #${ad.id} ${ad.active ? 'مفعل' : 'معطل'}`);
});

bot.onText(/\/add_task (.+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const parts = match[1].split('|').map(s => s.trim());
    if (parts.length < 4) return bot.sendMessage(msg.chat.id, '⚠️ الصيغة: /add_task عنوان | رابط | مكافأة | نوع');
    const id = Math.max(0, ...db.data.tasks.map(t => t.id)) + 1;
    db.data.tasks.push({ id, title: parts[0], url: parts[1], reward: parseFloat(parts[2]), type: parts[3], active: true });
    db.save();
    bot.sendMessage(msg.chat.id, `✅ تم إضافة المهمة #${id}`);
});

bot.onText(/\/del_task (\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    db.data.tasks = db.data.tasks.filter(t => t.id !== parseInt(match[1]));
    db.save();
    bot.sendMessage(msg.chat.id, `✅ تم الحذف`);
});

bot.onText(/\/toggle_task (\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const t = db.data.tasks.find(x => x.id === parseInt(match[1]));
    if (!t) return bot.sendMessage(msg.chat.id, '❌ غير موجود');
    t.active = !t.active;
    db.save();
    bot.sendMessage(msg.chat.id, `✅ ${t.active ? 'مفعل' : 'معطل'}`);
});

bot.onText(/\/user (\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const u = db.getUser(match[1]);
    bot.sendMessage(msg.chat.id,
        `👤 *بيانات المستخدم*\n\n` +
        `🆔 ID: \`${u.id}\`\n` +
        `💰 الرصيد: $${u.balance.toFixed(2)}\n` +
        `👁️ المشاهدات: ${u.totalAdsWatched}\n` +
        `👥 المدعوين: ${u.invitedFriends.length}\n` +
        `💵 إجمالي الأرباح: $${u.totalEarned.toFixed(2)}\n` +
        `🚫 محظور: ${u.banned ? 'نعم' : 'لا'}`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/add_balance (\d+) ([\d.]+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const userId = match[1];
    const amount = parseFloat(match[2]);
    const u = db.getUser(userId);
    db.updateUser(userId, { balance: u.balance + amount });
    bot.sendMessage(msg.chat.id, `✅ تم إضافة $${amount} للمستخدم ${userId}`);
    bot.sendMessage(userId, `🎁 تم إضافة $${amount} لرصيدك من الإدارة!`);
});

bot.onText(/\/ban (\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    db.updateUser(match[1], { banned: true });
    bot.sendMessage(msg.chat.id, `🚫 تم حظر ${match[1]}`);
});

bot.onText(/\/unban (\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    db.updateUser(match[1], { banned: false });
    bot.sendMessage(msg.chat.id, `✅ تم رفع الحظر عن ${match[1]}`);
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const text = match[1];
    const users = Object.keys(db.data.users);
    let sent = 0;
    for (const uid of users) {
        try {
            await bot.sendMessage(uid, `📣 *رسالة من الإدارة*\n\n${text}`, { parse_mode: 'Markdown' });
            sent++;
            await new Promise(r => setTimeout(r, 50));
        } catch (e) {}
    }
    bot.sendMessage(msg.chat.id, `✅ تم الإرسال لـ ${sent}/${users.length} مستخدم`);
});

bot.onText(/\/approve (TX\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const w = db.data.withdrawals.find(x => x.id === match[1]);
    if (!w) return bot.sendMessage(msg.chat.id, '❌ غير موجود');
    w.status = 'approved';
    db.data.stats.totalPaid += w.amount;
    db.save();
    bot.sendMessage(w.userId, `✅ تمت الموافقة على سحب $${w.amount}`);
    bot.sendMessage(msg.chat.id, '✅ تمت الموافقة');
});

bot.onText(/\/reject (TX\d+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const w = db.data.withdrawals.find(x => x.id === match[1]);
    if (!w) return bot.sendMessage(msg.chat.id, '❌ غير موجود');
    w.status = 'rejected';
    const u = db.getUser(w.userId);
    db.updateUser(w.userId, { balance: u.balance + w.amount });
    db.save();
    bot.sendMessage(w.userId, `❌ تم رفض سحب $${w.amount} وأعيد لرصيدك`);
    bot.sendMessage(msg.chat.id, '❌ تم الرفض');
});

bot.onText(/\/set (\w+) ([\d.]+)/, (msg, match) => {
    if (!isAdmin(msg)) return;
    const key = match[1];
    const val = parseFloat(match[2]);
    if (key === 'ad_reward') CONFIG.AD_REWARD = val;
    else if (key === 'daily_limit') CONFIG.DAILY_AD_LIMIT = val;
    else if (key === 'min_withdraw') CONFIG.MIN_WITHDRAW = val;
    else if (key === 'ref_reward') CONFIG.REFERRAL_REWARD = val;
    else return bot.sendMessage(msg.chat.id, '❌ مفتاح غير معروف');
    bot.sendMessage(msg.chat.id, `✅ تم تعديل ${key} إلى ${val}`);
});

bot.on('polling_error', (err) => console.log('Bot Error:', err.message));

// ============ START ============
app.listen(CONFIG.PORT, () => {
    console.log(`\n🚀 PayPlus Server running on port ${CONFIG.PORT}`);
    console.log(`👑 Admin ID: ${CONFIG.ADMIN_ID}`);
    console.log(`🤖 Bot: @Pay_Plus_Bot\n`);
});
