/**
 * PayPlus Admin Bot - Full Production v4.0
 * Admin: 8233835640 | Support: @no_vi1
 * Fixes: User photo, name, ID display + Ads system
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
    CHANNEL_USERNAME: '@Pay_Plus_Channel',
    CHANNEL_URL: 'https://t.me/Pay_Plus_Channel',
    PORT: process.env.PORT || 3000,
    MIN_WITHDRAW: 10,
    AD_REWARD: 0.50,
    DAILY_AD_LIMIT: 5,
    REFERRAL_REWARD: 0.75,
    APP_URL: 'https://vip-1-6d4c.onrender.com',
    DB_FILE: path.join(__dirname, 'database.json'),
    UPLOADS_DIR: path.join(__dirname, 'uploads')
};

if (!fs.existsSync(CONFIG.UPLOADS_DIR)) {
    fs.mkdirSync(CONFIG.UPLOADS_DIR, { recursive: true });
}

// ============ DATABASE ============
class Database {
    constructor() { this.data = this.load(); }
    load() {
        try {
            if (fs.existsSync(CONFIG.DB_FILE)) {
                return JSON.parse(fs.readFileSync(CONFIG.DB_FILE, 'utf8'));
            }
        } catch (e) {}
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
        catch (e) {}
    }
    getUser(id) {
        const uid = String(id);
        if (!this.data.users[uid]) {
            this.data.users[uid] = {
                id: uid,
                firstName: '', lastName: '', username: '', photoUrl: '',
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
app.use(express.json({ limit: '25mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(CONFIG.UPLOADS_DIR));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ============ BOT ============
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });
const isAdmin = function(msg) { return msg.from.id === CONFIG.ADMIN_ID; };
const adminFlow = {};

// ============ HELPER: Get User Photo ============
async function getUserPhotoUrl(userId) {
    try {
        const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
        if (photos.total_count > 0) {
            const fileId = photos.photos[0][0].file_id;
            const file = await bot.getFile(fileId);
            return 'https://api.telegram.org/file/bot' + CONFIG.BOT_TOKEN + '/' + file.file_path;
        }
    } catch (e) {
        console.log('[Photo] Failed for', userId, ':', e.message);
    }
    return '';
}

// ============ AUTH API - FIXED ============
app.post('/api/auth', async (req, res) => {
    try {
        const { initData } = req.body;
        let userId = req.body.userId;
        let tgUser = null;

        // Parse initData from Telegram
        if (initData) {
            try {
                const params = new URLSearchParams(initData);
                const userJson = params.get('user');
                if (userJson) {
                    tgUser = JSON.parse(userJson);
                    userId = tgUser.id;
                }
            } catch (e) { console.log('[Auth] initData parse failed'); }
        }

        // If opened via URL with user_id
        if (!userId) {
            const urlMatch = req.headers.referer && req.headers.referer.match(/user_id=(\d+)/);
            if (urlMatch) userId = urlMatch[1];
        }

        if (!userId) return res.status(400).json({ error: 'No user ID' });

        const user = db.getUser(userId);
        if (user.banned) return res.status(403).json({ error: 'banned' });

        // ===== UPDATE USER INFO =====
        const updateData = {};

        // 1) From initData (most reliable)
        if (tgUser) {
            if (tgUser.first_name) updateData.firstName = tgUser.first_name;
            if (tgUser.last_name) updateData.lastName = tgUser.last_name;
            if (tgUser.username) updateData.username = tgUser.username;
        }

        // 2) Fetch from bot API if name is missing
        if (!user.firstName && !updateData.firstName) {
            try {
                const chat = await bot.getChat(userId);
                if (chat) {
                    updateData.firstName = chat.first_name || '';
                    updateData.lastName = chat.last_name || '';
                    updateData.username = chat.username || '';
                }
            } catch (e) { console.log('[Auth] getChat failed:', e.message); }
        }

        // 3) Fetch profile photo
        if (!user.photoUrl) {
            const photoUrl = await getUserPhotoUrl(userId);
            if (photoUrl) updateData.photoUrl = photoUrl;
        }

        if (Object.keys(updateData).length > 0) {
            db.updateUser(userId, updateData);
        }

        const freshUser = db.getUser(userId);

        res.json({
            success: true,
            user: {
                id: freshUser.id,
                firstName: freshUser.firstName || '',
                lastName: freshUser.lastName || '',
                username: freshUser.username || '',
                photoUrl: freshUser.photoUrl || '',
                balance: freshUser.balance,
                adsWatchedToday: freshUser.adsWatchedToday,
                totalAdsWatched: freshUser.totalAdsWatched,
                completedTasks: freshUser.completedTasks,
                invitedFriends: freshUser.invitedFriends.length,
                inviteEarnings: freshUser.inviteEarnings,
                totalEarned: freshUser.totalEarned
            },
            ads: db.data.ads.filter(function(a) { return a.active && a.mediaUrl; }),
            tasks: db.data.tasks.filter(function(t) { return t.active; }),
            config: {
                adReward: CONFIG.AD_REWARD,
                dailyLimit: CONFIG.DAILY_AD_LIMIT,
                minWithdraw: CONFIG.MIN_WITHDRAW,
                referralReward: CONFIG.REFERRAL_REWARD,
                supportUser: CONFIG.SUPPORT_USERNAME,
                channelUrl: CONFIG.CHANNEL_URL,
                botUsername: 'Pay_PIus_Bot'
            }
        });
    } catch (e) {
        console.error('[Auth] Error:', e);
        res.status(500).json({ error: 'server_error' });
    }
});

// ============ WATCH AD ============
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

// ============ WITHDRAW ============
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

    const adminMsg =
        '💸 *طلب سحب جديد*\n\n' +
        '👤 الاسم: ' + (user.firstName || '') + ' ' + (user.lastName || '') + '\n' +
        '🆔 ID: `' + userId + '`\n' +
        '📛 المعرف: @' + (user.username || 'لا يوجد') + '\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '💰 المبلغ: $' + amount + '\n' +
        '💳 الطريقة: ' + method + '\n' +
        '📍 العنوان: `' + address + '`\n' +
        '🆔 الطلب: `' + withdrawal.id + '`';

    bot.sendMessage(CONFIG.ADMIN_ID, adminMsg, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '✅ موافقة', callback_data: 'approve_' + withdrawal.id },
                { text: '❌ رفض', callback_data: 'reject_' + withdrawal.id }
            ]]
        }
    }).catch(function(){});

    res.json({ success: true, withdrawalId: withdrawal.id });
});

app.get('/api/withdrawals/:userId', (req, res) => {
    const list = db.data.withdrawals.filter(function(w) { return w.userId === String(req.params.userId); });
    res.json({ success: true, withdrawals: list.reverse().slice(0, 20) });
});

// ============ ADMIN KEYBOARDS ============
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

function adsMenuKeyboard() {
    const rows = [];
    const row1 = [];
    for (let i = 1; i <= 3; i++) {
        const ad = db.data.ads.find(function(a) { return a.id === i; });
        const status = ad && ad.mediaUrl ? '✅' : '⬜';
        row1.push({ text: status + ' إعلان ' + i, callback_data: 'ad_slot_' + i });
    }
    rows.push(row1);

    const row2 = [];
    for (let i = 4; i <= 5; i++) {
        const ad = db.data.ads.find(function(a) { return a.id === i; });
        const status = ad && ad.mediaUrl ? '✅' : '⬜';
        row2.push({ text: status + ' إعلان ' + i, callback_data: 'ad_slot_' + i });
    }
    rows.push(row2);

    rows.push([{ text: '🔄 تحديث الحالة', callback_data: 'menu_ads' }]);
    rows.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'menu_main' }]);
    return { reply_markup: { inline_keyboard: rows } };
}

function adSlotKeyboard(adId) {
    const ad = db.data.ads.find(function(a) { return a.id === adId; });
    if (!ad) return { reply_markup: { inline_keyboard: [[{ text: '🏠 رجوع', callback_data: 'menu_ads' }]] } };

    const rows = [];
    if (ad.mediaUrl) {
        const previewText = ad.mediaType === 'video' ? '🎬 معاينة الفيديو' : '🖼️ معاينة الصورة';
        rows.push([{ text: previewText, url: CONFIG.APP_URL + ad.mediaUrl }]);
    }
    rows.push([{ text: ad.mediaUrl ? '🔄 تغيير الوسائط' : '➕ إضافة وسائط (فيديو/صورة)', callback_data: 'ad_addmedia_' + adId }]);
    rows.push([{ text: '✏️ تعديل العنوان', callback_data: 'ad_edittitle_' + adId }]);
    rows.push([{ text: '💰 تعديل المكافأة', callback_data: 'ad_editreward_' + adId }]);
    if (ad.mediaUrl) {
        rows.push([{
            text: ad.active ? '🟢 مفعل (اضغط للتعطيل)' : '🔴 معطل (اضغط للتفعيل)',
            callback_data: 'ad_toggle_' + adId
        }]);
    }
    rows.push([{ text: '🗑️ حذف محتوى الإعلان', callback_data: 'ad_clear_' + adId }]);
    rows.push([{ text: '🔙 رجوع للإعلانات', callback_data: 'menu_ads' }]);
    return { reply_markup: { inline_keyboard: rows } };
}

// ============ START ============
bot.onText(/\/start/, async function(msg) {
    const chatId = msg.chat.id;

    if (isAdmin(msg)) {
        return bot.sendMessage(chatId,
            '👑 *لوحة تحكم PayPlus*\n\n' +
            'مرحباً بك يا مدير\n' +
            '━━━━━━━━━━━━━━━━━━\n' +
            '📈 المستخدمين: *' + db.data.stats.totalUsers + '*\n' +
            '💰 المدفوع: *$' + db.data.stats.totalPaid.toFixed(2) + '*\n' +
            '👁️ المشاهدات: *' + db.data.stats.totalAdsWatched + '*',
            Object.assign({ parse_mode: 'Markdown' }, mainAdminKeyboard())
        );
    }

    const user = db.getUser(msg.from.id);

    // Save user info from message
    const update = {
        firstName: msg.from.first_name || '',
        lastName: msg.from.last_name || '',
        username: msg.from.username || ''
    };

    // Fetch photo if not stored
    if (!user.photoUrl) {
        const photoUrl = await getUserPhotoUrl(msg.from.id);
        if (photoUrl) update.photoUrl = photoUrl;
    }
    db.updateUser(msg.from.id, update);

    // Handle referral
    const refBy = msg.text.split(' ')[1];
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

    // Send welcome with web app button
    const userAppUrl = CONFIG.APP_URL + '?user_id=' + msg.from.id;

    bot.sendMessage(chatId,
        '🚀 *مرحباً بك في PayPlus!*\n\n' +
        '💰 اربح المال بسهولة:\n' +
        '  📺 شاهد الإعلانات ($' + CONFIG.AD_REWARD + ')\n' +
        '  👥 ادعُ الأصدقاء ($' + CONFIG.REFERRAL_REWARD + ')\n' +
        '  💸 اسحب أرباحك (USDT / Binance / PayPal)\n\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '⬇️ *افتح التطبيق من الزر الأزرق أسفل الشاشة*\n' +
        '━━━━━━━━━━━━━━━━━━',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 فتح التطبيق', web_app: { url: userAppUrl } }],
                    [{ text: '📢 قناة البوت', url: CONFIG.CHANNEL_URL }],
                    [{ text: '💬 الدعم', url: 'https://t.me/' + CONFIG.SUPPORT_USERNAME.replace('@', '') }]
                ]
            }
        }
    );
});

// ============ SET MENU BUTTON (CRITICAL!) ============
setTimeout(async function() {
    try {
        await bot.setChatMenuButton({
            menu_button: {
                type: 'web_app',
                text: 'فتح التطبيق',
                web_app: { url: CONFIG.APP_URL }
            }
        });
        console.log('✅ Menu Button configured successfully');
    } catch (e) { console.error('❌ Menu button error:', e.message); }
}, 3000);

// ============ ADMIN CALLBACKS ============
bot.on('callback_query', async function(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (!isAdmin(query)) return bot.answerCallbackQuery(query.id, { text: '⚠️ للأدمن فقط' });
    bot.answerCallbackQuery(query.id);

    if (data === 'menu_main') {
        return bot.editMessageText(
            '👑 *لوحة التحكم الرئيسية*\n\nاختر القسم:',
            Object.assign({ chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }, mainAdminKeyboard())
        );
    }

    if (data === 'menu_stats') {
        const users = Object.values(db.data.users);
        const totalBalances = users.reduce(function(s, u) { return s + u.balance; }, 0);
        const pending = db.data.withdrawals.filter(function(w) { return w.status === 'pending'; }).length;
        const activeAds = db.data.ads.filter(function(a) { return a.active && a.mediaUrl; }).length;
        return bot.editMessageText(
            '📊 *الإحصائيات الشاملة*\n\n' +
            '👥 المستخدمين: ' + users.length + '\n' +
            '💰 الأرصدة: $' + totalBalances.toFixed(2) + '\n' +
            '💸 المدفوع: $' + db.data.stats.totalPaid.toFixed(2) + '\n' +
            '👁️ المشاهدات: ' + db.data.stats.totalAdsWatched + '\n' +
            '⏳ معلقة: ' + pending + '\n' +
            '📢 إعلانات نشطة: ' + activeAds + ' / 5',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[
                { text: '🔄 تحديث', callback_data: 'menu_stats' },
                { text: '🏠 رئيسية', callback_data: 'menu_main' }
              ]]}}
        );
    }

    if (data === 'menu_ads') {
        const activeCount = db.data.ads.filter(function(a) { return a.active && a.mediaUrl; }).length;
        return bot.editMessageText(
            '📢 *إدارة الإعلانات*\n\n' +
            'اضغط على رقم الإعلان لإدارته\n' +
            '✅ = جاهز  |  ⬜ = فارغ\n\n' +
            '🎯 الإعلانات النشطة: ' + activeCount + ' / 5',
            Object.assign({ chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }, adsMenuKeyboard())
        );
    }

    if (data.indexOf('ad_slot_') === 0) {
        const adId = parseInt(data.replace('ad_slot_', ''));
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (!ad) return;
        const statusText = ad.mediaUrl ? (ad.active ? '🟢 نشط' : '🔴 معطل') : '⬜ فارغ';
        const mediaInfo = ad.mediaUrl
            ? '🎬 النوع: ' + (ad.mediaType === 'video' ? 'فيديو' : 'صورة') + '\n🔗 [مشاهدة](' + CONFIG.APP_URL + ad.mediaUrl + ')'
            : '📭 لم تتم إضافة وسائط';
        return bot.editMessageText(
            '📢 *الإعلان رقم ' + adId + '*\n\n' +
            '📝 العنوان: ' + ad.title + '\n' +
            '💰 المكافأة: $' + ad.reward.toFixed(2) + '\n' +
            '📊 الحالة: ' + statusText + '\n\n' +
            mediaInfo,
            Object.assign({ chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', disable_web_page_preview: true }, adSlotKeyboard(adId))
        );
    }

    if (data.indexOf('ad_addmedia_') === 0) {
        const adId = parseInt(data.replace('ad_addmedia_', ''));
        adminFlow[chatId] = { action: 'add_media', adId: adId };
        return bot.editMessageText(
            '🎬 *إضافة وسائط للإعلان ' + adId + '*\n\n' +
            'أرسل الآن:\n' +
            '• 🎬 فيديو (MP4)\n' +
            '• 🖼️ صورة\n\n' +
            '⚠️ الحد الأقصى: 20 ميجابايت',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'ad_cancel_' + adId }]] }}
        );
    }

    if (data.indexOf('ad_cancel_') === 0) {
        delete adminFlow[chatId];
        const adId = data.replace('ad_cancel_', '');
        return bot.editMessageText('❌ تم الإلغاء',
            Object.assign({ chat_id: chatId, message_id: messageId }, adSlotKeyboard(adId)));
    }

    if (data.indexOf('ad_edittitle_') === 0) {
        const adId = parseInt(data.replace('ad_edittitle_', ''));
        adminFlow[chatId] = { action: 'edit_title', adId: adId };
        return bot.editMessageText(
            '✏️ *تعديل العنوان للإعلان ' + adId + '*\n\nأرسل العنوان الجديد (1-100 حرف)',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'ad_cancel_' + adId }]] }}
        );
    }

    if (data.indexOf('ad_editreward_') === 0) {
        const adId = parseInt(data.replace('ad_editreward_', ''));
        adminFlow[chatId] = { action: 'edit_reward', adId: adId };
        return bot.editMessageText(
            '💰 *تعديل المكافأة للإعلان ' + adId + '*\n\nأرسل المبلغ (مثال: 0.50)',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'ad_cancel_' + adId }]] }}
        );
    }

    if (data.indexOf('ad_toggle_') === 0) {
        const adId = parseInt(data.replace('ad_toggle_', ''));
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (ad) { ad.active = !ad.active; db.save(); }
        return bot.editMessageText(
            '✅ تم ' + (ad.active ? 'التفعيل' : 'التعطيل') + ' للإعلان ' + adId,
            Object.assign({ chat_id: chatId, message_id: messageId }, adSlotKeyboard(adId))
        );
    }

    if (data.indexOf('ad_clear_') === 0) {
        const adId = parseInt(data.replace('ad_clear_', ''));
        return bot.editMessageText(
            '⚠️ تأكيد حذف الإعلان ' + adId + '؟',
            { chat_id: chatId, message_id: messageId,
              reply_markup: { inline_keyboard: [
                [{ text: '🗑️ نعم، احذف', callback_data: 'ad_clearconfirm_' + adId }],
                [{ text: '❌ إلغاء', callback_data: 'ad_slot_' + adId }]
              ]}}
        );
    }

    if (data.indexOf('ad_clearconfirm_') === 0) {
        const adId = parseInt(data.replace('ad_clearconfirm_', ''));
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (ad) {
            if (ad.mediaUrl) {
                const oldFile = path.join(CONFIG.UPLOADS_DIR, path.basename(ad.mediaUrl));
                if (fs.existsSync(oldFile)) try { fs.unlinkSync(oldFile); } catch(e) {}
            }
            ad.mediaUrl = null; ad.mediaType = null; ad.active = false; db.save();
        }
        delete adminFlow[chatId];
        return bot.editMessageText('✅ تم الحذف',
            Object.assign({ chat_id: chatId, message_id: messageId }, adsMenuKeyboard()));
    }

    if (data === 'menu_withdrawals') {
        const pending = db.data.withdrawals.filter(function(w) { return w.status === 'pending'; });
        if (pending.length === 0) {
            return bot.editMessageText('✅ لا توجد طلبات معلقة',
                { chat_id: chatId, message_id: messageId,
                  reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }});
        }
        let text = '💸 *طلبات السحب المعلقة*\n\n';
        const buttons = [];
        for (let i = 0; i < Math.min(pending.length, 10); i++) {
            const w = pending[i];
            text += '👤 ' + (w.userName || 'Unknown') + '\n🆔 `' + w.userId + '`\n💰 $' + w.amount + ' | ' + w.method + '\n\n';
            buttons.push([
                { text: '✅ موافقة #' + (i+1), callback_data: 'approve_' + w.id },
                { text: '❌ رفض #' + (i+1), callback_data: 'reject_' + w.id }
            ]);
        }
        buttons.push([{ text: '🏠 رئيسية', callback_data: 'menu_main' }]);
        return bot.editMessageText(text,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    }

    if (data.indexOf('approve_') === 0) {
        const wid = data.replace('approve_', '');
        const w = db.data.withdrawals.find(function(x) { return x.id === wid; });
        if (w && w.status === 'pending') {
            w.status = 'approved';
            db.data.stats.totalPaid += w.amount;
            db.save();
            bot.sendMessage(w.userId, '✅ تمت الموافقة على سحب $' + w.amount).catch(function(){});
            bot.answerCallbackQuery(query.id, { text: '✅ تمت الموافقة', show_alert: true });
        }
        return;
    }

    if (data.indexOf('reject_') === 0) {
        const wid = data.replace('reject_', '');
        const w = db.data.withdrawals.find(function(x) { return x.id === wid; });
        if (w && w.status === 'pending') {
            w.status = 'rejected';
            const u = db.getUser(w.userId);
            db.updateUser(w.userId, { balance: u.balance + w.amount });
            db.save();
            bot.sendMessage(w.userId, '❌ تم رفض سحب $' + w.amount + ' وأعيد لرصيدك').catch(function(){});
            bot.answerCallbackQuery(query.id, { text: '❌ تم الرفض', show_alert: true });
        }
        return;
    }

    if (data === 'menu_users') {
        return bot.editMessageText(
            '👥 *إدارة المستخدمين*\n\nإجمالي: ' + Object.keys(db.data.users).length,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [
                [{ text: '🔍 بحث', callback_data: 'users_search' }],
                [{ text: '🏆 أفضل 10', callback_data: 'users_top' }],
                [{ text: '🏠 رئيسية', callback_data: 'menu_main' }]
              ]}}
        );
    }

    if (data === 'users_search') {
        adminFlow[chatId] = { action: 'search_user' };
        return bot.editMessageText(
            '🔍 أرسل ID المستخدم',
            { chat_id: chatId, message_id: messageId,
              reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'menu_users' }]] }}
        );
    }

    if (data === 'users_top') {
        const top = Object.values(db.data.users).sort(function(a, b) { return b.totalEarned - a.totalEarned; }).slice(0, 10);
        let text = '🏆 *أفضل 10 مستخدمين*\n\n';
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
        top.forEach(function(u, i) {
            text += medals[i] + ' ' + (u.firstName || 'User') + ' - $' + u.totalEarned.toFixed(2) + '\n';
        });
        return bot.editMessageText(text,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }});
    }

    if (data === 'menu_broadcast') {
        adminFlow[chatId] = { action: 'broadcast' };
        return bot.editMessageText(
            '📣 *إرسال بث*\n\nأرسل الرسالة الآن\n\n👥 المستخدمين: ' + Object.keys(db.data.users).length,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'menu_main' }]] }}
        );
    }

    if (data === 'menu_settings') {
        return bot.editMessageText(
            '⚙️ *الإعدادات*\n\n' +
            '💰 مكافأة الإعلان: $' + CONFIG.AD_REWARD + '\n' +
            '📊 الحد اليومي: ' + CONFIG.DAILY_AD_LIMIT + '\n' +
            '💸 الحد الأدنى للسحب: $' + CONFIG.MIN_WITHDRAW + '\n' +
            '👥 مكافأة الدعوة: $' + CONFIG.REFERRAL_REWARD,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }}
        );
    }

    if (data === 'menu_applink') {
        return bot.editMessageText(
            '🔗 *رابط التطبيق*\n\n`' + CONFIG.APP_URL + '`',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }}
        );
    }

    if (data === 'menu_help') {
        return bot.editMessageText(
            '📖 *دليل الاستخدام*\n\n' +
            '📢 إدارة الإعلانات:\n' +
            '• اضغط "إدارة الإعلانات"\n' +
            '• اختر رقم الإعلان (1-5)\n' +
            '• أرسل فيديو أو صورة\n\n' +
            '💸 السحوبات: تصلك تلقائياً\n\n' +
            '📣 البث: أرسل النص للجميع',
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: '🏠 رئيسية', callback_data: 'menu_main' }]] }}
        );
    }
});

// ============ ADMIN MESSAGE HANDLER ============
bot.on('message', async function(msg) {
    const chatId = msg.chat.id;
    if (!isAdmin(msg)) return;

    const flow = adminFlow[chatId];
    if (!flow) return;

    // ===== RECEIVE MEDIA =====
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

            // Download file
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
                if (fs.existsSync(oldFile)) try { fs.unlinkSync(oldFile); } catch(e) {}
            }

            // Update DB
            if (ad) {
                ad.mediaUrl = '/uploads/' + filename;
                ad.mediaType = mediaType;
                ad.active = true;
            }
            db.save();

            delete adminFlow[chatId];
            bot.deleteMessage(chatId, msg.message_id).catch(function(){});

            return bot.sendMessage(chatId,
                '✅ *تم الإضافة بنجاح*\n\n' +
                '📢 الإعلان: ' + adId + '\n' +
                '🎬 النوع: ' + (mediaType === 'video' ? 'فيديو' : 'صورة') + '\n' +
                '📊 الحالة: 🟢 نشط\n\n' +
                '✅ الإعلان الآن ظاهر في التطبيق',
                Object.assign({ parse_mode: 'Markdown' }, adSlotKeyboard(adId))
            );

        } catch (e) {
            console.error('[Upload] Error:', e);
            bot.sendMessage(chatId, '❌ خطأ في رفع الملف: ' + e.message);
            delete adminFlow[chatId];
        }
        return;
    }

    // ===== EDIT TITLE =====
    if (flow.action === 'edit_title') {
        const adId = flow.adId;
        const newTitle = msg.text ? msg.text.trim() : '';
        if (!newTitle || newTitle.length > 100) {
            return bot.sendMessage(chatId, '⚠️ العنوان غير صحيح (1-100 حرف)');
        }
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (ad) { ad.title = newTitle; db.save(); }
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});
        return bot.sendMessage(chatId, '✅ تم تعديل العنوان بنجاح', adSlotKeyboard(adId));
    }

    // ===== EDIT REWARD =====
    if (flow.action === 'edit_reward') {
        const adId = flow.adId;
        const reward = parseFloat(msg.text);
        if (isNaN(reward) || reward < 0.01 || reward > 100) {
            return bot.sendMessage(chatId, '⚠️ المبلغ غير صحيح (0.01 - 100)');
        }
        const ad = db.data.ads.find(function(a) { return a.id === adId; });
        if (ad) { ad.reward = reward; db.save(); }
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});
        return bot.sendMessage(chatId, '✅ تم تعديل المكافأة إلى $' + reward.toFixed(2), adSlotKeyboard(adId));
    }

    // ===== SEARCH USER =====
    if (flow.action === 'search_user') {
        const uid = msg.text ? msg.text.trim() : '';
        if (!db.data.users[uid]) {
            delete adminFlow[chatId];
            return bot.sendMessage(chatId, '❌ المستخدم غير موجود');
        }
        const u = db.data.users[uid];
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});

        let text = '👤 *بيانات المستخدم*\n\n' +
                   '🆔 ID: `' + u.id + '`\n' +
                   '📛 الاسم: ' + (u.firstName || '-') + ' ' + (u.lastName || '') + '\n' +
                   '🔗 @' + (u.username || 'لا يوجد') + '\n' +
                   '━━━━━━━━━━━━━━━━━━\n' +
                   '💰 الرصيد: $' + u.balance.toFixed(2) + '\n' +
                   '💵 الأرباح: $' + u.totalEarned.toFixed(2) + '\n' +
                   '👁️ المشاهدات: ' + u.totalAdsWatched + '\n' +
                   '👥 المدعوين: ' + u.invitedFriends.length + '\n' +
                   '🚫 محظور: ' + (u.banned ? 'نعم' : 'لا');

        return bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: '💬 مراسلة', url: 'tg://user?id=' + u.id }],
                [{ text: '🏠 رئيسية', callback_data: 'menu_main' }]
            ]}
        });
    }

    // ===== BROADCAST =====
    if (flow.action === 'broadcast') {
        const text = msg.text || msg.caption;
        if (!text) return bot.sendMessage(chatId, '⚠️ أرسل نصاً');
        const users = Object.keys(db.data.users);
        delete adminFlow[chatId];
        bot.deleteMessage(chatId, msg.message_id).catch(function(){});

        const progressMsg = await bot.sendMessage(chatId, '📣 جاري الإرسال... 0/' + users.length);
        let sent = 0;
        for (let i = 0; i < users.length; i++) {
            try {
                await bot.sendMessage(users[i], '📣 *رسالة من الإدارة*\n\n' + text, { parse_mode: 'Markdown' });
                sent++;
            } catch (e) {}
            await new Promise(function(r) { setTimeout(r, 50); });
        }
        return bot.editMessageText(
            '✅ *تم البث*\n\n📤 أُرسلت لـ: *' + sent + '* من *' + users.length + '*',
            Object.assign({ chat_id: chatId, message_id: progressMsg.message_id, parse_mode: 'Markdown' }, mainAdminKeyboard())
        );
    }
});

bot.on('polling_error', function(err) { console.log('[Polling Error]', err.message); });

// ============ START SERVER ============
app.listen(CONFIG.PORT, function() {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('🚀 PayPlus Bot v4.0 - Full Production');
    console.log('🌐 App URL: ' + CONFIG.APP_URL);
    console.log('👑 Admin ID: ' + CONFIG.ADMIN_ID);
    console.log('🤖 Bot: @Pay_PIus_Bot');
    console.log('📞 Support: ' + CONFIG.SUPPORT_USERNAME);
    console.log('═══════════════════════════════════════');
    console.log('');
});
