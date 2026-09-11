/**
 * PayPlus Admin Bot - Button-Only Control Panel
 * Admin ID: 8233835640
 * Support: @no_vi1
 * App URL: https://vip-1-6d4c.onrender.com
 * Version: 3.0 (Button-Only + Media Support)
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
    APP_URL: 'https://vip-1-6d4c.onrender.com',
    DB_FILE: path.join(__dirname, 'database.json'),
    UPLOADS_DIR: path.join(__dirname, 'uploads')
};

// Create uploads folder if not exists
if (!fs.existsSync(CONFIG.UPLOADS_DIR)) {
    fs.mkdirSync(CONFIG.UPLOADS_DIR, { recursive: true });
}

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
                { id: 1, title: 'إعلان 1', mediaType: null, mediaUrl: null, reward: 0.50, active: false },
                { id: 2, title: 'إعلان 2', mediaType: null, mediaUrl: null, reward: 0.50, active: false },
                { id: 3, title: 'إعلان 3', mediaType: null, mediaUrl: null, reward: 0.50, active: false },
                { id: 4, title: 'إعلان 4', mediaType: null, mediaUrl: null, reward: 0.50, active: false },
                { id: 5, title: 'إعلان 5', mediaType: null, mediaUrl: null, reward: 0.50, active: false }
            ],
            tasks: [],
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
        this.data.users[uid] = Object.assign({}, this.getUser(id), updates);
        this.save();
        return this.data.users[uid];
    }
}

const db = new Database();

// ============ EXPRESS ============
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(CONFIG.UPLOADS_DIR));

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

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.post('/api/auth', (req, res) => {
    const { initData } = req.body;
    const tgUser = initData ? validateInitData(initData) : null;
    const userId = (tgUser && tgUser.id) || req.body.userId;
    if (!userId) return res.status(400).json({ error: 'No user ID' });

    const user = db.getUser(userId);
    if (user.banned) return res.status(403).json({ error: 'banned' });

    // Save user profile info from Telegram
    if (tgUser) {
        db.updateUser(userId, {
            firstName: tgUser.first_name || '',
            lastName: tgUser.last_name || '',
            username: tgUser.username || '',
            photoUrl: tgUser.photo_url || '',
            languageCode: tgUser.language_code || 'ar'
        });
    }

    res.json({
        success: true,
        user: {
            id: user.id,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            username: user.username || '',
            photoUrl: user.photoUrl || '',
            balance: user.balance,
            adsWatchedToday: user.adsWatchedToday,
            totalAdsWatched: user.totalAdsWatched,
            completedTasks: user.completedTasks,
            invitedFriends: user.invitedFriends.length,
            inviteEarnings: user.inviteEarnings,
            totalEarned: user.totalEarned
        },
        ads: db.data.ads.filter(function(a) { return a.active && a.mediaUrl; }),
        tasks: db.data.tasks.filter(function(t) { return t.active; }),
        config: {
            adReward: CONFIG.AD_REWARD,
            dailyLimit: CONFIG.DAILY_AD_LIMIT,
            minWithdraw: CONFIG.MIN_WITHDRAW,
            referralReward: CONFIG.REFERRAL_REWARD,
            supportUser: CONFIG.SUPPORT_USERNAME,
            botUsername: 'Pay_PIus_Bot'
        }
    });
});

app.post('/api/watch-ad', (req, res) => {
    const { userId, adId } = req.body;
    const user = db.getUser(userId);
    if (user.banned) return res.status(403).json({ error: 'banned' });
    if (user.adsWatchedToday >= CONFIG.DAILY_AD_LIMIT)
        return res.status(400).json({ error: 'limit_reached' });

    const ad = db.data.ads.find(function(a) { return a.id === adId && a.active && a.mediaUrl; });
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

    res.json({ success: true, newBalance: newBalance, reward: ad.reward });
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
        userId: userId,
        userName: (user.firstName || '') + ' ' + (user.lastName || ''),
        userUsername: user.username || '',
        amount: amount,
        method: method,
        address: address,
        status: 'pending',
        date: Date.now()
    };

    db.data.withdrawals.push(withdrawal);
    db.updateUser(userId, { balance: user.balance - amount });
    db.save();

    // Notify admin with fancy layout
    const adminMsg =
        '╔══════════════════════╗\n' +
        '   💸 *طلب سحب جديد*\n' +
        '╚══════════════════════╝\n\n' +
        '👤 *المستخدم:* ' + (user.firstName || 'Unknown') + '\n' +
        '🆔 *ID:* `' + userId + '`\n' +
        '📛 *المعرف:* @' + (user.username || 'لا يوجد') + '\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '💰 *المبلغ:* $' + amount + '\n' +
        '💳 *الطريقة:* ' + method + '\n' +
        '📍 *العنوان:*\n`' + address + '`\n' +
        '🆔 *رقم الطلب:* `' + withdrawal.id + '`\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '⏳ في انتظار قرارك';

    bot.sendMessage(CONFIG.ADMIN_ID, adminMsg, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '✅ موافقة', callback_data: 'approve_' + withdrawal.id },
                { text: '❌ رفض', callback_data: 'reject_' + withdrawal.id }
            ], [
                { text: '💬 مراسلة المستخدم', url: 'tg://user?id=' + userId }
            ]]
        }
    }).catch(function(e) { console.error('Admin notify error:', e.message); });

    res.json({ success: true, withdrawalId: withdrawal.id });
});

app.get('/api/withdrawals/:userId', (req, res) => {
    const list = db.data.withdrawals.filter(function(w) { return w.userId === String(req.params.userId); });
    res.json({ success: true, withdrawals: list.reverse().slice(0, 20) });
});

// ============ TELEGRAM BOT ============
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });

const isAdmin = function(msg) { return msg.from.id === CONFIG.ADMIN_ID; };

// Temp storage for admin media upload flow
const adminFlow = {};

// ============ MAIN ADMIN KEYBOARD ============
function mainAdminKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📊  الإحصائيات الشاملة', callback_data: 'menu_stats' }],
                [{ text: '📢  إدارة الإعلانات', callback_data: 'menu_ads' }, { text: '🎯  إدارة المهام', callback_data: 'menu_tasks' }],
                [{ text: '💸  طلبات السحب', callback_data: 'menu_withdrawals' }, { text: '👥  إدارة المستخدمين', callback_data: 'menu_users' }],
                [{ text: '📣  إرسال بث جماعي', callback_data: 'menu_broadcast' }, { text: '⚙️  الإعدادات', callback_data: 'menu_settings' }],
                [{ text: '🔗  رابط التطبيق', callback_data: 'menu_applink' }, { text: '📖  دليل الاستخدام', callback_data: 'menu_help' }]
            ]
        }
    };
}

// ============ ADS MENU KEYBOARD (5 buttons) ============
function adsMenuKeyboard() {
    const rows = [];
    // Row 1: Ads 1, 2, 3
    const row1 = [];
    for (let i = 1; i <= 3; i++) {
        const ad = db.data.ads.find(function(a) { return a.id === i; });
        const hasMedia = ad && ad.mediaUrl;
        const status = hasMedia ? '✅' : '⬜';
        row1.push({ text: status + ' إعلان ' + i, callback_data: 'ad_slot_' + i });
    }
    rows.push(row1);

    // Row 2: Ads 4, 5
    const row2 = [];
    for (let i = 4; i <= 5; i++) {
        const ad = db.data.ads.find(function(a) { return a.id === i; });
        const hasMedia = ad && ad.mediaUrl;
        const status = hasMedia ? '✅' : '⬜';
        row2.push({ text: status + ' إعلان ' + i, callback_data: 'ad_slot_' + i });
    }
    rows.push(row2);

    rows.push([{ text: '🔄 تحديث الحالة', callback_data: 'menu_ads' }]);
    rows.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'menu_main' }]);
    return { reply_markup: { inline_keyboard: rows } };
}

// ============ SINGLE AD KEYBOARD ============
function adSlotKeyboard(adId) {
    const ad = db.data.ads.find(function(a) { return a.id === adId; });
    if (!ad) return { reply_markup: { inline_keyboard: [[{ text: '🏠 رجوع', callback_data: 'menu_ads' }]] } };

    const rows = [];

    // Preview
    if (ad.mediaUrl) {
        const previewText = ad.mediaType === 'video' ? '🎬 معاينة الفيديو' : '🖼️ معاينة الصورة';
        rows.push([{ text: previewText, url: CONFIG.APP_URL + ad.mediaUrl }]);
    }

    // Actions
    rows.push([{ text: ad.mediaUrl ? '🔄 تغيير الوسائط' : '➕ إضافة وسائط (فيديو/صورة)', callback_data: 'ad_addmedia_' + adId }]);
    rows.push([{ text: '✏️ تعديل العنوان', callback_data: 'ad_edittitle_' + adId }]);
    rows.push([{ text: '💰 تعديل المكافأة', callback_data: 'ad_editreward_' + adId }]);
    
    if (ad.mediaUrl) {
        rows.push([{ 
            text: ad.active ? '🟢 الحالة: مفعل (اضغط للتعطيل)' : '🔴 الحالة: معطل (اضغط للتفعيل)',
            callback_data: 'ad_toggle_' + adId
        }]);
    }
    
    rows.push([{ text: '🗑️ حذف محتوى الإعلان', callback_data: 'ad_clear_' + adId }]);
    rows.push([{ text: '🔙 رجوع للإعلانات', callback_data: 'menu_ads' }]);

    return { reply_markup: { inline_keyboard: rows } };
}

// ============ START COMMAND ============
bot.onText(/\/start/, function(msg) {
    const chatId = msg.chat.id;

    if (isAdmin(msg)) {
        return bot.sendMessage(chatId,
            '╔═══════════════════════════════╗\n' +
            '       👑 *PayPlus Admin*\n' +
            '      لوحة التحكم الرئيسية\n' +
            '╚═══════════════════════════════╝\n\n' +
            '🎯 مرحباً بك يا مدير\n' +
            '━━━━━━━━━━━━━━━━━━\n' +
            '📈 المستخدمين: *' + db.data.stats.totalUsers + '*\n' +
            '💰 المدفوع: *$' + db.data.stats.totalPaid.toFixed(2) + '*\n' +
            '👁️ المشاهدات: *' + db.data.stats.totalAdsWatched + '*\n' +
            '⏳ طلبات معلقة: *' + db.data.withdrawals.filter(function(w){return w.status === 'pending';}).length + '*\n' +
            '━━━━━━━━━━━━━━━━━━\n' +
            'اختر من الأزرار أدناه:',
            Object.assign({ parse_mode: 'Markdown' }, mainAdminKeyboard())
        );
    }

    // Regular user
    const parts = msg.text.split(' ');
    const refBy = parts[1];
    const user = db.getUser(msg.from.id);

    if (refBy && refBy !== String(msg.from.id) && !user.referredBy) {
        const referrer = db.getUser(refBy);
        if (referrer && referrer.invitedFriends.indexOf(String(msg.from.id)) === -1) {
            referrer.invitedFriends.push(String(msg.from.id));
            referrer.balance += CONFIG.REFERRAL_REWARD;
            referrer.inviteEarnings += CONFIG.REFERRAL_REWARD;
            db.save();
            bot.sendMessage(refBy, '🎉 صديق جديد انضم عبر رابطك! +$' + CONFIG.REFERRAL_REWARD).catch(function(){});
        }
        user.referredBy = refBy;
        db.save();
    }

    bot.sendMessage(chatId,
        '╔═══════════════════════════════╗\n' +
        '       🚀 *PayPlus App*\n' +
        '╚═══════════════════════════════╝\n\n' +
        '💰 اربح المال بسهولة:\n' +
        '• 📺 شاهد الإعلانات ($' + CONFIG.AD_REWARD + ')\n' +
        '• 👥 ادعُ الأصدقاء ($' + CONFIG.REFERRAL_REWARD + ')\n' +
        '• 💸 اسحب أرباحك بسهولة\n\n' +
        '📱 اضغط لفتح التطبيق:',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 فتح التطبيق', web_app: { url: CONFIG.APP_URL } }],
                    [{ text: '📞 الدعم', url: 'https://t.me/' + CONFIG.SUPPORT_USERNAME.replace('@', '') }]
                ]
            }
        }
    );
});

// ============ CALLBACK QUERY HANDLER ============
bot.on('callback_query', async function(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (!isAdmin(query)) {
        return bot.answerCallbackQuery(query.id, { text: '⚠️ للأدمن فقط' });
    }
    bot.answerCallbackQuery(query.id);

    // ============ MAIN MENU ============
    if (data === 'menu_main') {
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       👑 *PayPlus Admin*\n' +
            '      لوحة التحكم الرئيسية\n' +
            '╚═══════════════════════════════╝\n\n' +
            '🎯 اختر القسم الذي تريد إدارته:',
            Object.assign({
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            }, mainAdminKeyboard())
        );
    }

    // ============ STATS ============
    if (data === 'menu_stats') {
        const users = Object.values(db.data.users);
        const totalBalances = users.reduce(function(s, u) { return s + u.balance; }, 0);
        const pending = db.data.withdrawals.filter(function(w) { return w.status === 'pending'; }).length;
        const activeAds = db.data.ads.filter(function(a) { return a.active && a.mediaUrl; }).length;
        
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       📊 *الإحصائيات الشاملة*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '👥 *المستخدمين:* ' + users.length + '\n' +
            '💰 *مجموع الأرصدة:* $' + totalBalances.toFixed(2) + '\n' +
            '💸 *إجمالي المدفوع:* $' + db.data.stats.totalPaid.toFixed(2) + '\n' +
            '👁️ *المشاهدات:* ' + db.data.stats.totalAdsWatched + '\n' +
            '⏳ *طلبات معلقة:* ' + pending + '\n' +
            '📢 *إعلانات نشطة:* ' + activeAds + ' / 5\n' +
            '━━━━━━━━━━━━━━━━━━',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🔄 تحديث', callback_data: 'menu_stats' }, { text: '🏠 رئيسية', callback_data: 'menu_main' }]
                ]}
            }
        );
    }

    // ============ ADS MENU ============
    if (data === 'menu_ads') {
        const activeCount = db.data.ads.filter(function(a) { return a.active && a.mediaUrl; }).length;
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       📢 *إدارة الإعلانات*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '📌 اضغط على رقم الإعلان لإدارته\n' +
            '✅ = جاهز  |  ⬜ = فارغ\n' +
            '━━━━━━━━━━━━━━━━━━\n' +
            '🎯 *الإعلانات النشطة:* ' + activeCount + ' / 5\n' +
            '💰 *مكافأة الإعلان:* $' + CONFIG.AD_REWARD + '\n' +
            '📺 *الحد اليومي:* ' + CONFIG.DAILY_AD_LIMIT + ' إعلان\n' +
            '━━━━━━━━━━━━━━━━━━',
            Object.assign({
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            }, adsMenuKeyboard())
        );
    }

    // ============ AD SLOT DETAILS ============
    if (data.indexOf('ad_slot_') === 0) {
        const adId = parseInt(data.replace('ad_slot_', ''));
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (!ad) return bot.editMessageText('❌ الإعلان غير موجود', { chat_id: chatId, message_id: messageId });

        const statusText = ad.mediaUrl 
            ? (ad.active ? '🟢 نشط' : '🔴 معطل') 
            : '⬜ لا يوجد محتوى';

        const mediaInfo = ad.mediaUrl 
            ? '🎬 *النوع:* ' + (ad.mediaType === 'video' ? 'فيديو' : 'صورة') + '\n' +
              '🔗 *الرابط:* [مشاهدة](' + CONFIG.APP_URL + ad.mediaUrl + ')'
            : '📭 لم تتم إضافة وسائط بعد';

        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       📢 *الإعلان رقم ' + adId + '*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '📝 *العنوان:* ' + ad.title + '\n' +
            '💰 *المكافأة:* $' + ad.reward.toFixed(2) + '\n' +
            '📊 *الحالة:* ' + statusText + '\n' +
            '━━━━━━━━━━━━━━━━━━\n' +
            mediaInfo + '\n' +
            '━━━━━━━━━━━━━━━━━━\n' +
            'اختر الإجراء:',
            Object.assign({
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            }, adSlotKeyboard(adId))
        );
    }

    // ============ ADD MEDIA FLOW ============
    if (data.indexOf('ad_addmedia_') === 0) {
        const adId = parseInt(data.replace('ad_addmedia_', ''));
        adminFlow[chatId] = { action: 'add_media', adId: adId };

        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       🎬 *إضافة وسائط*\n' +
            '     للإعلان رقم ' + adId + '\n' +
            '╚═══════════════════════════════╝\n\n' +
            '📌 *الآن أرسل:*\n' +
            '• 🎬 فيديو (MP4)\n' +
            '• 🖼️ صورة\n\n' +
            '⚠️ *ملاحظات مهمة:*\n' +
            '• الحد الأقصى: 20 ميجابايت\n' +
            '• سيتم ربط الوسائط بالإعلان تلقائياً\n' +
            '• يمكنك إرسالها كملف أو كصورة\n\n' +
            '🚀 أرسل الآن...',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '❌ إلغاء', callback_data: 'ad_cancel_' + adId }]
                ]}
            }
        );
    }

    if (data.indexOf('ad_cancel_') === 0) {
        delete adminFlow[chatId];
        const adId = data.replace('ad_cancel_', '');
        return bot.editMessageText('❌ تم الإلغاء', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع للإعلان', callback_data: 'ad_slot_' + adId }]] }
        });
    }

    // ============ EDIT TITLE FLOW ============
    if (data.indexOf('ad_edittitle_') === 0) {
        const adId = parseInt(data.replace('ad_edittitle_', ''));
        adminFlow[chatId] = { action: 'edit_title', adId: adId };

        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       ✏️ *تعديل العنوان*\n' +
            '     للإعلان رقم ' + adId + '\n' +
            '╚═══════════════════════════════╝\n\n' +
            '📝 أرسل العنوان الجديد للإعلان\n\n' +
            '⚠️ الحد الأقصى: 100 حرف',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '❌ إلغاء', callback_data: 'ad_cancel_' + adId }]
                ]}
            }
        );
    }

    // ============ EDIT REWARD FLOW ============
    if (data.indexOf('ad_editreward_') === 0) {
        const adId = parseInt(data.replace('ad_editreward_', ''));
        adminFlow[chatId] = { action: 'edit_reward', adId: adId };

        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       💰 *تعديل المكافأة*\n' +
            '     للإعلان رقم ' + adId + '\n' +
            '╚═══════════════════════════════╝\n\n' +
            '💵 أرسل المبلغ الجديد\n' +
            'مثال: `0.50` أو `1.00`\n\n' +
            '⚠️ الحد الأدنى: $0.01',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '❌ إلغاء', callback_data: 'ad_cancel_' + adId }]
                ]}
            }
        );
    }

    // ============ TOGGLE AD ============
    if (data.indexOf('ad_toggle_') === 0) {
        const adId = parseInt(data.replace('ad_toggle_', ''));
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (ad) {
            ad.active = !ad.active;
            db.save();
            return bot.editMessageText(
                '╔═══════════════════════════════╗\n' +
                '       📢 *الإعلان رقم ' + adId + '*\n' +
                '╚═══════════════════════════════╝\n\n' +
                (ad.active ? '🟢 تم *التفعيل* بنجاح' : '🔴 تم *التعطيل* بنجاح') + '\n\n' +
                '📝 *العنوان:* ' + ad.title + '\n' +
                '💰 *المكافأة:* $' + ad.reward.toFixed(2) + '\n' +
                '📊 *الحالة:* ' + (ad.active ? '🟢 نشط' : '🔴 معطل'),
                Object.assign({
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                }, adSlotKeyboard(adId))
            );
        }
    }

    // ============ CLEAR AD ============
    if (data.indexOf('ad_clear_') === 0) {
        const adId = parseInt(data.replace('ad_clear_', ''));
        return bot.editMessageText(
            '⚠️ *تأكيد الحذف*\n\n' +
            'هل أنت متأكد من حذف محتوى الإعلان رقم ' + adId + '؟\n' +
            'لا يمكن التراجع عن هذا الإجراء.',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🗑️ نعم، احذف', callback_data: 'ad_clearconfirm_' + adId }],
                    [{ text: '❌ إلغاء', callback_data: 'ad_slot_' + adId }]
                ]}
            }
        );
    }

    if (data.indexOf('ad_clearconfirm_') === 0) {
        const adId = parseInt(data.replace('ad_clearconfirm_', ''));
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (ad) {
            // Delete old file
            if (ad.mediaUrl) {
                const oldFile = path.join(CONFIG.UPLOADS_DIR, path.basename(ad.mediaUrl));
                if (fs.existsSync(oldFile)) {
                    try { fs.unlinkSync(oldFile); } catch(e) {}
                }
            }
            ad.mediaUrl = null;
            ad.mediaType = null;
            ad.active = false;
            db.save();
        }
        delete adminFlow[chatId];
        return bot.editMessageText(
            '✅ تم حذف محتوى الإعلان رقم ' + adId,
            Object.assign({
                chat_id: chatId,
                message_id: messageId
            }, adsMenuKeyboard())
        );
    }

    // ============ WITHDRAWALS ============
    if (data === 'menu_withdrawals') {
        const pending = db.data.withdrawals.filter(function(w) { return w.status === 'pending'; });
        
        if (pending.length === 0) {
            return bot.editMessageText(
                '╔═══════════════════════════════╗\n' +
                '       💸 *طلبات السحب*\n' +
                '╚═══════════════════════════════╝\n\n' +
                '✅ لا توجد طلبات معلقة حالياً',
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }
                }
            );
        }

        let text = '╔═══════════════════════════════╗\n' +
                   '       💸 *طلبات السحب المعلقة*\n' +
                   '╚═══════════════════════════════╝\n\n';
        
        const buttons = [];
        for (let i = 0; i < Math.min(pending.length, 10); i++) {
            const w = pending[i];
            text += '━━━━━━━━━━━━━━━━━━\n' +
                    '👤 *' + (w.userName || 'Unknown') + '*\n' +
                    '🆔 `' + w.userId + '`\n' +
                    '💰 *$' + w.amount + '* | ' + w.method + '\n' +
                    '📍 `' + w.address.substring(0, 30) + (w.address.length > 30 ? '...' : '') + '`\n';
            buttons.push([
                { text: '✅ موافقة #' + (i+1), callback_data: 'approve_' + w.id },
                { text: '❌ رفض #' + (i+1), callback_data: 'reject_' + w.id }
            ]);
        }
        buttons.push([{ text: '🔄 تحديث', callback_data: 'menu_withdrawals' }]);
        buttons.push([{ text: '🏠 رئيسية', callback_data: 'menu_main' }]);

        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // ============ APPROVE/REJECT ============
    if (data.indexOf('approve_') === 0) {
        const wid = data.replace('approve_', '');
        const w = db.data.withdrawals.find(function(x) { return x.id === wid; });
        if (w && w.status === 'pending') {
            w.status = 'approved';
            db.data.stats.totalPaid += w.amount;
            db.save();
            bot.sendMessage(w.userId,
                '╔═══════════════════════════════╗\n' +
                '       ✅ *تمت الموافقة*\n' +
                '╚═══════════════════════════════╝\n\n' +
                '💰 *المبلغ:* $' + w.amount + '\n' +
                '💳 *الطريقة:* ' + w.method + '\n' +
                '🆔 *الطلب:* `' + w.id + '`\n\n' +
                '🎉 سيتم التحويل خلال 24 ساعة',
                { parse_mode: 'Markdown' }
            ).catch(function(){});
            return bot.answerCallbackQuery(query.id, { text: '✅ تمت الموافقة' });
        }
        return bot.answerCallbackQuery(query.id, { text: '⚠️ تم معالجته مسبقاً' });
    }

    if (data.indexOf('reject_') === 0) {
        const wid = data.replace('reject_', '');
        const w = db.data.withdrawals.find(function(x) { return x.id === wid; });
        if (w && w.status === 'pending') {
            w.status = 'rejected';
            const user = db.getUser(w.userId);
            db.updateUser(w.userId, { balance: user.balance + w.amount });
            db.save();
            bot.sendMessage(w.userId,
                '╔═══════════════════════════════╗\n' +
                '       ❌ *تم الرفض*\n' +
                '╚═══════════════════════════════╝\n\n' +
                '💰 *المبلغ:* $' + w.amount + '\n' +
                '🆔 *الطلب:* `' + w.id + '`\n\n' +
                '✅ تم إعادة المبلغ لرصيدك',
                { parse_mode: 'Markdown' }
            ).catch(function(){});
            return bot.answerCallbackQuery(query.id, { text: '❌ تم الرفض' });
        }
        return bot.answerCallbackQuery(query.id, { text: '⚠️ تم معالجته مسبقاً' });
    }

    // ============ USERS MENU ============
    if (data === 'menu_users') {
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       👥 *إدارة المستخدمين*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '📊 *إجمالي المستخدمين:* ' + Object.keys(db.data.users).length + '\n\n' +
            'اختر الإجراء:',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🔍 بحث عن مستخدم', callback_data: 'users_search' }],
                    [{ text: '🚫 المستخدمين المحظورين', callback_data: 'users_banned' }],
                    [{ text: '🏆 أفضل 10 مستخدمين', callback_data: 'users_top' }],
                    [{ text: '🏠 رئيسية', callback_data: 'menu_main' }]
                ]}
            }
        );
    }

    if (data === 'users_search') {
        adminFlow[chatId] = { action: 'search_user' };
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       🔍 *بحث مستخدم*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '📌 أرسل ID المستخدم للبحث\n\n' +
            'مثال: `8233835640`',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'menu_users' }]] }
            }
        );
    }

    if (data === 'users_banned') {
        const banned = Object.values(db.data.users).filter(function(u) { return u.banned; });
        if (banned.length === 0) {
            return bot.editMessageText('✅ لا يوجد مستخدمون محظورون', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }
            });
        }
        const buttons = banned.slice(0, 10).map(function(u) {
            return [{ text: '✅ رفع الحظر - ' + u.id, callback_data: 'user_unban_' + u.id }];
        });
        buttons.push([{ text: '🏠 رئيسية', callback_data: 'menu_main' }]);
        return bot.editMessageText(
            '🚫 *المستخدمين المحظورين*\n\nالمجموع: ' + banned.length,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            }
        );
    }

    if (data === 'users_top') {
        const top = Object.values(db.data.users)
            .sort(function(a, b) { return b.totalEarned - a.totalEarned; })
            .slice(0, 10);
        
        let text = '╔═══════════════════════════════╗\n' +
                   '       🏆 *أفضل 10 مستخدمين*\n' +
                   '╚═══════════════════════════════╝\n\n';
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        top.forEach(function(u, i) {
            text += medals[i] + ' *' + (u.firstName || 'User') + '* - $' + u.totalEarned.toFixed(2) + '\n';
        });
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }
        });
    }

    if (data.indexOf('user_unban_') === 0) {
        const uid = data.replace('user_unban_', '');
        db.updateUser(uid, { banned: false });
        return bot.answerCallbackQuery(query.id, { text: '✅ تم رفع الحظر' });
    }

    // ============ BROADCAST ============
    if (data === 'menu_broadcast') {
        adminFlow[chatId] = { action: 'broadcast' };
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       📣 *إرسال بث جماعي*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '📌 أرسل الرسالة التي تريد بثها\n' +
            '📊 عدد المستخدمين: ' + Object.keys(db.data.users).length + '\n\n' +
            '⚠️ سيتم إرسالها للجميع',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'menu_main' }]] }
            }
        );
    }

    // ============ SETTINGS ============
    if (data === 'menu_settings') {
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       ⚙️ *الإعدادات*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '💰 مكافأة الإعلان: *$' + CONFIG.AD_REWARD + '*\n' +
            '📊 الحد اليومي: *' + CONFIG.DAILY_AD_LIMIT + '* إعلان\n' +
            '💸 الحد الأدنى للسحب: *$' + CONFIG.MIN_WITHDRAW + '*\n' +
            '👥 مكافأة الدعوة: *$' + CONFIG.REFERRAL_REWARD + '*\n' +
            '━━━━━━━━━━━━━━━━━━',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '💰 تعديل مكافأة الإعلان', callback_data: 'setting_edit_ad_reward' }],
                    [{ text: '📊 تعديل الحد اليومي', callback_data: 'setting_edit_daily_limit' }],
                    [{ text: '💸 تعديل الحد الأدنى للسحب', callback_data: 'setting_edit_min_withdraw' }],
                    [{ text: '👥 تعديل مكافأة الدعوة', callback_data: 'setting_edit_ref_reward' }],
                    [{ text: '🏠 رئيسية', callback_data: 'menu_main' }]
                ]}
            }
        );
    }

    if (data.indexOf('setting_edit_') === 0) {
        const key = data.replace('setting_edit_', '');
        adminFlow[chatId] = { action: 'edit_setting', key: key };
        const labels = {
            ad_reward: 'مكافأة الإعلان',
            daily_limit: 'الحد اليومي',
            min_withdraw: 'الحد الأدنى للسحب',
            ref_reward: 'مكافأة الدعوة'
        };
        return bot.editMessageText(
            '⚙️ *تعديل: ' + labels[key] + '*\n\n' +
            '📌 أرسل القيمة الجديدة (رقم فقط)',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'menu_settings' }]] }
            }
        );
    }

    // ============ APP LINK ============
    if (data === 'menu_applink') {
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       🔗 *رابط التطبيق*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '`' + CONFIG.APP_URL + '`\n\n' +
            '📱 هذا هو الرابط المستخدم في التطبيق',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '📋 نسخ الرابط', callback_data: 'copy_applink' }],
                    [{ text: '🏠 رئيسية', callback_data: 'menu_main' }]
                ]}
            }
        );
    }

    if (data === 'copy_applink') {
        return bot.answerCallbackQuery(query.id, { text: CONFIG.APP_URL, show_alert: true });
    }

    // ============ HELP ============
    if (data === 'menu_help') {
        return bot.editMessageText(
            '╔═══════════════════════════════╗\n' +
            '       📖 *دليل الاستخدام*\n' +
            '╚═══════════════════════════════╝\n\n' +
            '📢 *إدارة الإعلانات:*\n' +
            '• اضغط "إدارة الإعلانات"\n' +
            '• اختر رقم الإعلان (1-5)\n' +
            '• أرسل فيديو أو صورة\n' +
            '• فعّل الإعلان من الزر 🟢\n\n' +
            '💸 *السحوبات:*\n' +
            '• تصلك تلقائياً هنا\n' +
            '• اضغط ✅ موافقة أو ❌ رفض\n\n' +
            '📣 *البث:*\n' +
            '• أرسل النص وسيُرسل للجميع\n' +
            '━━━━━━━━━━━━━━━━━━',
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }
            }
        );
    }
});

// ============ ADMIN TEXT/MEDIA HANDLER (for flows) ============
bot.on('message', async function(msg) {
    const chatId = msg.chat.id;
    if (!isAdmin(msg)) return;

    const flow = adminFlow[chatId];
    if (!flow) return;

    // ============ RECEIVE MEDIA (video/photo) ============
    if (flow.action === 'add_media') {
        const adId = flow.adId;
        let fileId = null;
        let mediaType = null;

        if (msg.video) {
            fileId = msg.video.file_id;
            mediaType = 'video';
        } else if (msg.photo && msg.photo.length > 0) {
            fileId = msg.photo[msg.photo.length - 1].file_id;
            mediaType = 'photo';
        } else if (msg.document && (msg.document.mime_type || '').indexOf('video') === 0) {
            fileId = msg.document.file_id;
            mediaType = 'video';
        } else {
            return bot.sendMessage(chatId, '⚠️ أرسل فيديو أو صورة فقط');
        }

        try {
            const fileInfo = await bot.getFile(fileId);
            if (fileInfo.file_size && fileInfo.file_size > 20 * 1024 * 1024) {
                return bot.sendMessage(chatId, '⚠️ الملف كبير جداً (الحد 20 ميجا)');
            }

            const ext = mediaType === 'video' ? '.mp4' : '.jpg';
            const filename = 'ad_' + adId + '_' + Date.now() + ext;
            const filePath = path.join(CONFIG.UPLOADS_DIR, filename);

            // Download
            const fileStream = bot.getFileStream(fileId);
            const writeStream = fs.createWriteStream(filePath);
            fileStream.pipe(writeStream);

            await new Promise(function(resolve, reject) {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            // Delete old file
            const ad = db.data.ads.find(function(a) { return a.id === adId; });
            if (ad && ad.mediaUrl) {
                const oldFile = path.join(CONFIG.UPLOADS_DIR, path.basename(ad.mediaUrl));
                if (fs.existsSync(oldFile)) {
                    try { fs.unlinkSync(oldFile); } catch(e) {}
                }
            }

            // Update DB
            if (ad) {
                ad.mediaUrl = '/uploads/' + filename;
                ad.mediaType = mediaType;
                ad.active = true;
            }
            db.save();

            delete adminFlow[chatId];

            // Delete user's message to keep chat clean
            bot.deleteMessage(chatId, msg.message_id).catch(function(){});

            // Success message
            const successMsg = await bot.sendMessage(chatId,
                '╔═══════════════════════════════╗\n' +
                '       ✅ *تم الإضافة بنجاح*\n' +
                '╚═══════════════════════════════╝\n\n' +
                '📢 *الإعلان:* ' + adId + '\n' +
                '🎬 *النوع:* ' + (mediaType === 'video' ? 'فيديو' : 'صورة') + '\n' +
                '📊 *الحالة:* 🟢 نشط\n' +
                '━━━━━━━━━━━━━━━━━━\n' +
                '✅ الإعلان الآن ظاهر في التطبيق',
                Object.assign({
                    parse_mode: 'Markdown'
                }, adSlotKeyboard(adId))
            );

        } catch (e) {
            console.error('Upload error:', e);
            bot.sendMessage(chatId, '❌ خطأ في رفع الملف: ' + e.message);
            delete adminFlow[chatId];
        }
        return;
    }

    // ============ EDIT TITLE ============
    if (flow.action === 'edit_title') {
        const adId = flow.adId;
        const newTitle = msg.text ? msg.text.trim() : '';
        if (!newTitle || newTitle.length > 100) {
            return bot.sendMessage(chatId, '⚠️ العنوان غير صحيح (1-100 حرف)');
        }
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (ad) {
            ad.title = newTitle;
            db.save();
        }
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});
        return bot.sendMessage(chatId, '✅ تم تعديل العنوان بنجاح', adSlotKeyboard(adId));
    }

    // ============ EDIT REWARD ============
    if (flow.action === 'edit_reward') {
        const adId = flow.adId;
        const reward = parseFloat(msg.text);
        if (isNaN(reward) || reward < 0.01 || reward > 100) {
            return bot.sendMessage(chatId, '⚠️ المبلغ غير صحيح (0.01 - 100)');
        }
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (ad) {
            ad.reward = reward;
            db.save();
        }
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});
        return bot.sendMessage(chatId, '✅ تم تعديل المكافأة إلى $' + reward.toFixed(2), adSlotKeyboard(adId));
    }

    // ============ SEARCH USER ============
    if (flow.action === 'search_user') {
        const uid = msg.text ? msg.text.trim() : '';
        if (!db.data.users[uid]) {
            delete adminFlow[chatId];
            return bot.sendMessage(chatId, '❌ المستخدم غير موجود');
        }
        const u = db.data.users[uid];
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});
        
        let text = '╔═══════════════════════════════╗\n' +
                   '       👤 *بيانات المستخدم*\n' +
                   '╚═══════════════════════════════╝\n\n' +
                   '🆔 *ID:* `' + u.id + '`\n' +
                   '📛 *الاسم:* ' + (u.firstName || '-') + ' ' + (u.lastName || '') + '\n' +
                   '🔗 *المعرف:* @' + (u.username || 'لا يوجد') + '\n' +
                   '━━━━━━━━━━━━━━━━━━\n' +
                   '💰 *الرصيد:* $' + u.balance.toFixed(2) + '\n' +
                   '💵 *إجمالي الأرباح:* $' + u.totalEarned.toFixed(2) + '\n' +
                   '👁️ *المشاهدات:* ' + u.totalAdsWatched + '\n' +
                   '👥 *المدعوين:* ' + u.invitedFriends.length + '\n' +
                   '🚫 *محظور:* ' + (u.banned ? 'نعم' : 'لا');

        const buttons = [];
        if (u.banned) {
            buttons.push([{ text: '✅ رفع الحظر', callback_data: 'user_unban_' + u.id }]);
        } else {
            buttons.push([{ text: '🚫 حظر المستخدم', callback_data: 'user_ban_' + u.id }]);
        }
        buttons.push([{ text: '💬 مراسلة', url: 'tg://user?id=' + u.id }]);
        buttons.push([{ text: '🏠 رئيسية', callback_data: 'menu_main' }]);

        return bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
    }

    // ============ BROADCAST ============
    if (flow.action === 'broadcast') {
        const text = msg.text || msg.caption;
        if (!text) return bot.sendMessage(chatId, '⚠️ أرسل نصاً للبث');
        
        const users = Object.keys(db.data.users);
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});

        const progressMsg = await bot.sendMessage(chatId, '📣 جاري الإرسال... 0/' + users.length);
        
        let sent = 0;
        for (let i = 0; i < users.length; i++) {
            try {
                await bot.sendMessage(users[i], '📣 *رسالة من الإدارة*\n\n' + text, { parse_mode: 'Markdown' });
                sent++;
                if (i % 10 === 0) {
                    bot.editMessageText('📣 جاري الإرسال... ' + sent + '/' + users.length, {
                        chat_id: chatId,
                        message_id: progressMsg.message_id
                    }).catch(function(){});
                }
            } catch (e) {}
            await new Promise(function(r) { setTimeout(r, 50); });
        }
        
        bot.editMessageText(
            '✅ *تم البث بنجاح*\n\n' +
            '📤 أُرسلت لـ: *' + sent + '*' + '\n' +
            '👥 من أصل: *' + users.length + '*',
            Object.assign({
                chat_id: chatId,
                message_id: progressMsg.message_id,
                parse_mode: 'Markdown'
            }, mainAdminKeyboard())
        );
        return;
    }

    // ============ EDIT SETTING ============
    if (flow.action === 'edit_setting') {
        const val = parseFloat(msg.text);
        if (isNaN(val)) return bot.sendMessage(chatId, '⚠️ أرسل رقماً صحيحاً');
        
        const key = flow.key;
        if (key === 'ad_reward') CONFIG.AD_REWARD = val;
        else if (key === 'daily_limit') CONFIG.DAILY_AD_LIMIT = Math.floor(val);
        else if (key === 'min_withdraw') CONFIG.MIN_WITHDRAW = val;
        else if (key === 'ref_reward') CONFIG.REFERRAL_REWARD = val;
        
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});
        return bot.sendMessage(chatId, '✅ تم تحديث الإعداد بنجاح', mainAdminKeyboard());
    }
});

bot.on('polling_error', function(err) { console.log('Bot Error:', err.message); });

// ============ START SERVER ============
app.listen(CONFIG.PORT, function() {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('🚀 PayPlus Bot v3.0 - Button Only Mode');
    console.log('🌐 App URL: ' + CONFIG.APP_URL);
    console.log('👑 Admin ID: ' + CONFIG.ADMIN_ID);
    console.log('🤖 Bot: @Pay_PIus_Bot');
    console.log('📞 Support: ' + CONFIG.SUPPORT_USERNAME);
    console.log('═══════════════════════════════════════');
    console.log('');
});
