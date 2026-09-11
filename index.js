/* =====================================================
   PayPlus Telegram Mini App - Complete Server
   Admin ID: 8233835640
   Support: @no_vi1
   ===================================================== */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

// ═══════════ CONFIG ═══════════
const BOT_TOKEN = '8909959176:AAF6V-RuF5nSAyKh1JOYijYoQJH7ZXB8GSM';
const ADMIN_ID = 8233835640;
const APP_URL = 'https://vip-1-6d4c.onrender.com';
const PORT = process.env.PORT || 3000;
const MIN_WITHDRAW = 10;
const AD_REWARD = 0.5;
const DAILY_LIMIT = 5;
const REF_REWARD = 0.75;
const SUPPORT = '@no_vi1';
const CHANNEL = 'https://t.me/Pay_PIus_Bot';

const DB_PATH = path.join(__dirname, 'data.json');
const UPLOADS = path.join(__dirname, 'media');

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ═══════════ DATABASE ═══════════
let DB = {
  users: {},
  ads: [],
  withdrawals: [],
  tasks: [],
  stats: { totalUsers: 0, totalPaid: 0, totalViews: 0 }
};

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      DB = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
    if (!DB.ads || DB.ads.length === 0) {
      DB.ads = [];
      for (let i = 1; i <= 5; i++) {
        DB.ads.push({
          id: i,
          title: 'إعلان ' + i,
          media: null,
          mediaType: null,
          reward: AD_REWARD,
          active: false
        });
      }
    }
    if (!DB.users) DB.users = {};
    if (!DB.withdrawals) DB.withdrawals = [];
    if (!DB.tasks) DB.tasks = [];
    if (!DB.stats) DB.stats = { totalUsers: 0, totalPaid: 0, totalViews: 0 };
  } catch (e) {
    console.error('DB Load Error:', e.message);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(DB, null, 2));
  } catch (e) {
    console.error('DB Save Error:', e.message);
  }
}

loadDB();

// ═══════════ USER HELPERS ═══════════
function getUser(id) {
  const uid = String(id);
  if (!DB.users[uid]) {
    DB.users[uid] = {
      id: uid,
      firstName: '',
      lastName: '',
      username: '',
      photo: '',
      balance: 0,
      todayAds: 0,
      lastDate: new Date().toDateString(),
      totalAds: 0,
      totalEarned: 0,
      referrals: [],
      referredBy: null,
      refEarnings: 0,
      completedTasks: [],
      banned: false,
      created: Date.now()
    };
    DB.stats.totalUsers++;
    saveDB();
  }
  // Reset daily
  const today = new Date().toDateString();
  if (DB.users[uid].lastDate !== today) {
    DB.users[uid].todayAds = 0;
    DB.users[uid].lastDate = today;
    saveDB();
  }
  return DB.users[uid];
}

function saveUser(id, updates) {
  const uid = String(id);
  const user = getUser(uid);
  DB.users[uid] = Object.assign({}, user, updates);
  saveDB();
  return DB.users[uid];
}

// ═══════════ EXPRESS SERVER ═══════════
const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.static(__dirname));
app.use('/media', express.static(UPLOADS));

app.get('/health', function(req, res) {
  res.json({ status: 'ok', uptime: process.uptime(), users: Object.keys(DB.users).length });
});

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ═══════════ AUTH API ═══════════
app.post('/api/auth', async function(req, res) {
  try {
    const initData = req.body.initData || '';
    let userId = req.body.userId || null;
    let tgUser = null;

    // Parse Telegram initData
    if (initData && initData.length > 0) {
      try {
        const params = new URLSearchParams(initData);
        const userStr = params.get('user');
        if (userStr) {
          tgUser = JSON.parse(userStr);
          userId = tgUser.id;
        }
      } catch (e) {
        console.log('[Auth] initData parse error:', e.message);
      }
    }

    if (!userId) {
      return res.status(400).json({ success: false, error: 'NO_USER_ID' });
    }

    let user = getUser(userId);
    if (user.banned) {
      return res.status(403).json({ success: false, error: 'BANNED' });
    }

    // Update user profile
    const profileUpdates = {};

    if (tgUser) {
      profileUpdates.firstName = tgUser.first_name || '';
      profileUpdates.lastName = tgUser.last_name || '';
      profileUpdates.username = tgUser.username || '';
    }

    // Fetch from Bot if missing
    if (!profileUpdates.firstName && !user.firstName) {
      try {
        const chat = await bot.getChat(userId);
        profileUpdates.firstName = chat.first_name || '';
        profileUpdates.lastName = chat.last_name || '';
        profileUpdates.username = chat.username || '';
      } catch (e) {
        console.log('[Auth] getChat failed:', e.message);
      }
    }

    // Fetch profile photo if missing
    if (!user.photo) {
      try {
        const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
        if (photos.total_count > 0) {
          const fileId = photos.photos[0][0].file_id;
          const file = await bot.getFile(fileId);
          profileUpdates.photo = 'https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + file.file_path;
        }
      } catch (e) {
        console.log('[Auth] getPhoto failed:', e.message);
      }
    }

    if (Object.keys(profileUpdates).length > 0) {
      user = saveUser(userId, profileUpdates);
    }

    // Build ads response
    const activeAds = DB.ads.filter(function(a) { return a.active && a.media; }).map(function(a) {
      return {
        id: a.id,
        title: a.title,
        media: a.media,
        mediaType: a.mediaType,
        reward: a.reward
      };
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        username: user.username || '',
        photo: user.photo || '',
        balance: user.balance,
        todayAds: user.todayAds,
        totalAds: user.totalAds,
        totalEarned: user.totalEarned,
        referrals: user.referrals.length,
        refEarnings: user.refEarnings,
        completedTasks: user.completedTasks
      },
      ads: activeAds,
      tasks: DB.tasks.filter(function(t) { return t.active; }),
      config: {
        adReward: AD_REWARD,
        dailyLimit: DAILY_LIMIT,
        minWithdraw: MIN_WITHDRAW,
        refReward: REF_REWARD,
        support: SUPPORT,
        channel: CHANNEL,
        botUsername: 'Pay_PIus_Bot'
      }
    });
  } catch (e) {
    console.error('[Auth] Fatal:', e);
    res.status(500).json({ success: false, error: 'SERVER_ERROR' });
  }
});

// ═══════════ WATCH AD API ═══════════
app.post('/api/watch-ad', function(req, res) {
  try {
    const { userId, adId } = req.body;
    if (!userId || !adId) return res.status(400).json({ success: false });

    const user = getUser(userId);
    if (user.banned) return res.status(403).json({ success: false, error: 'BANNED' });
    if (user.todayAds >= DAILY_LIMIT) {
      return res.status(400).json({ success: false, error: 'LIMIT_REACHED' });
    }

    const ad = DB.ads.find(function(a) { return a.id === adId && a.active && a.media; });
    if (!ad) return res.status(404).json({ success: false, error: 'AD_NOT_FOUND' });

    const newBalance = user.balance + ad.reward;
    const updated = saveUser(userId, {
      balance: newBalance,
      todayAds: user.todayAds + 1,
      totalAds: user.totalAds + 1,
      totalEarned: user.totalEarned + ad.reward
    });

    DB.stats.totalViews++;
    saveDB();

    res.json({
      success: true,
      newBalance: updated.balance,
      reward: ad.reward,
      todayAds: updated.todayAds
    });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ═══════════ COMPLETE TASK ═══════════
app.post('/api/complete-task', function(req, res) {
  try {
    const { userId, taskId } = req.body;
    if (!userId || !taskId) return res.status(400).json({ success: false });

    const user = getUser(userId);
    if (user.completedTasks.indexOf(taskId) !== -1) {
      return res.status(400).json({ success: false, error: 'ALREADY_DONE' });
    }

    const task = DB.tasks.find(function(t) { return t.id === taskId && t.active; });
    if (!task) return res.status(404).json({ success: false });

    const newBalance = user.balance + task.reward;
    const updated = saveUser(userId, {
      balance: newBalance,
      totalEarned: user.totalEarned + task.reward,
      completedTasks: user.completedTasks.concat([taskId])
    });

    res.json({ success: true, newBalance: updated.balance, reward: task.reward });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ═══════════ WITHDRAW API ═══════════
app.post('/api/withdraw', function(req, res) {
  try {
    const { userId, amount, method, address } = req.body;
    if (!userId || !amount || !method || !address) {
      return res.status(400).json({ success: false, error: 'MISSING_FIELDS' });
    }

    const user = getUser(userId);
    if (user.banned) return res.status(403).json({ success: false, error: 'BANNED' });
    if (amount < MIN_WITHDRAW) return res.status(400).json({ success: false, error: 'MIN_AMOUNT' });
    if (amount > user.balance) return res.status(400).json({ success: false, error: 'INSUFFICIENT' });

    const wd = {
      id: 'TX' + Date.now(),
      userId: userId,
      userName: (user.firstName + ' ' + user.lastName).trim(),
      userUsername: user.username,
      amount: amount,
      method: method,
      address: address,
      status: 'pending',
      date: Date.now()
    };

    DB.withdrawals.push(wd);
    saveUser(userId, { balance: user.balance - amount });

    const adminMsg =
      '💸 *طلب سحب جديد*\n\n' +
      '👤 الاسم: ' + (user.firstName || '') + ' ' + (user.lastName || '') + '\n' +
      '🆔 ID: `' + userId + '`\n' +
      '📛 المعرف: @' + (user.username || 'لا يوجد') + '\n' +
      '━━━━━━━━━━━━━━━\n' +
      '💰 المبلغ: $' + amount + '\n' +
      '💳 الطريقة: ' + method + '\n' +
      '📍 العنوان: `' + address + '`\n' +
      '🆔 رقم الطلب: `' + wd.id + '`';

    bot.sendMessage(ADMIN_ID, adminMsg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ موافقة', callback_data: 'approve_' + wd.id },
          { text: '❌ رفض', callback_data: 'reject_' + wd.id }
        ]]
      }
    }).catch(function(){});

    res.json({ success: true, withdrawalId: wd.id });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/withdrawals/:userId', function(req, res) {
  const list = DB.withdrawals.filter(function(w) { return w.userId === String(req.params.userId); });
  res.json({ success: true, withdrawals: list.reverse().slice(0, 20) });
});

// ═══════════ BOT ═══════════
const bot = new TelegramBot(BOT_TOKEN, { polling: { interval: 1000, autoStart: true } });

const flows = {};

function isAdmin(msg) {
  return msg.from.id === ADMIN_ID;
}

// ═══════════ KEYBOARDS ═══════════
function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 الإحصائيات', callback_data: 'menu_stats' }],
        [{ text: '📢 الإعلانات', callback_data: 'menu_ads' }, { text: '🎯 المهام', callback_data: 'menu_tasks' }],
        [{ text: '💸 السحوبات', callback_data: 'menu_wd' }, { text: '👥 المستخدمين', callback_data: 'menu_users' }],
        [{ text: '📣 إرسال بث', callback_data: 'menu_bc' }, { text: '⚙️ الإعدادات', callback_data: 'menu_settings' }],
        [{ text: '🔗 رابط التطبيق', callback_data: 'menu_link' }, { text: '📖 مساعدة', callback_data: 'menu_help' }]
      ]
    }
  };
}

function adsMenu() {
  const row1 = [];
  const row2 = [];
  for (let i = 1; i <= 5; i++) {
    const ad = DB.ads.find(function(a) { return a.id === i; });
    const mark = (ad && ad.media) ? '✅' : '⬜';
    const btn = { text: mark + ' إعلان ' + i, callback_data: 'ad_' + i };
    if (i <= 3) row1.push(btn); else row2.push(btn);
  }
  return {
    reply_markup: {
      inline_keyboard: [
        row1,
        row2,
        [{ text: '🔄 تحديث', callback_data: 'menu_ads' }],
        [{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]
      ]
    }
  };
}

function adDetail(adId) {
  const ad = DB.ads.find(function(a) { return a.id === adId; });
  if (!ad) return { reply_markup: { inline_keyboard: [[{ text: '🔙', callback_data: 'menu_ads' }]] } };

  const rows = [];
  if (ad.media) {
    rows.push([{ text: '👁️ معاينة', url: APP_URL + ad.media }]);
  }
  rows.push([{ text: ad.media ? '🔄 تغيير الوسائط' : '➕ إضافة وسائط', callback_data: 'admedia_' + adId }]);
  rows.push([{ text: '✏️ العنوان', callback_data: 'adtitle_' + adId }, { text: '💰 المكافأة', callback_data: 'adreward_' + adId }]);
  if (ad.media) {
    rows.push([{ text: ad.active ? '🟢 مفعل - اضغط للتعطيل' : '🔴 معطل - اضغط للتفعيل', callback_data: 'adtoggle_' + adId }]);
  }
  rows.push([{ text: '🗑️ حذف المحتوى', callback_data: 'adclear_' + adId }]);
  rows.push([{ text: '🔙 رجوع', callback_data: 'menu_ads' }]);

  return { reply_markup: { inline_keyboard: rows } };
}

// ═══════════ /start ═══════════
bot.onText(/\/start/, async function(msg) {
  const chatId = msg.chat.id;

  if (isAdmin(msg)) {
    return bot.sendMessage(chatId,
      '👑 *لوحة التحكم*\n\n' +
      '━━━━━━━━━━━━━━━\n' +
      '👥 المستخدمين: *' + DB.stats.totalUsers + '*\n' +
      '💰 المدفوع: *$' + DB.stats.totalPaid.toFixed(2) + '*\n' +
      '👁️ المشاهدات: *' + DB.stats.totalViews + '*\n' +
      '━━━━━━━━━━━━━━━',
      Object.assign({ parse_mode: 'Markdown' }, mainMenu())
    );
  }

  const user = getUser(msg.from.id);

  // Save user
  const updates = {
    firstName: msg.from.first_name || '',
    lastName: msg.from.last_name || '',
    username: msg.from.username || ''
  };

  if (!user.photo) {
    try {
      const photos = await bot.getUserProfilePhotos(msg.from.id, { limit: 1 });
      if (photos.total_count > 0) {
        const fileId = photos.photos[0][0].file_id;
        const file = await bot.getFile(fileId);
        updates.photo = 'https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + file.file_path;
      }
    } catch (e) {}
  }
  saveUser(msg.from.id, updates);

  // Referral
  const parts = msg.text.split(' ');
  if (parts[1] && parts[1] !== String(msg.from.id) && !user.referredBy) {
    const referrer = getUser(parts[1]);
    if (referrer && referrer.referrals.indexOf(String(msg.from.id)) === -1) {
      referrer.referrals.push(String(msg.from.id));
      referrer.balance += REF_REWARD;
      referrer.refEarnings += REF_REWARD;
      DB.users[parts[1]] = referrer;
      saveDB();
      bot.sendMessage(parts[1], '🎉 صديق جديد انضم! +$' + REF_REWARD).catch(function(){});
    }
    saveUser(msg.from.id, { referredBy: parts[1] });
  }

  const appUrl = APP_URL + '?uid=' + msg.from.id;

  bot.sendMessage(chatId,
    '🚀 *مرحباً بك في PayPlus!*\n\n' +
    '💰 اربح المال:\n' +
    '  📺 إعلانات → $' + AD_REWARD + '\n' +
    '  👥 دعوات → $' + REF_REWARD + '\n' +
    '  💸 سحوبات (Binance/PayPal/USDT)\n\n' +
    '━━━━━━━━━━━━━━━\n' +
    '⬇️ افتح التطبيق من الزر الأزرق أسفل الشاشة',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 فتح التطبيق', web_app: { url: appUrl } }],
          [{ text: '📢 القناة', url: CHANNEL }],
          [{ text: '💬 الدعم', url: 'https://t.me/' + SUPPORT.replace('@', '') }]
        ]
      }
    }
  );
});

// ═══════════ SET MENU BUTTON ═══════════
async function setupMenuButton() {
  try {
    await bot.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: 'فتح التطبيق',
        web_app: { url: APP_URL }
      }
    });
    console.log('✅ Menu Button set');
  } catch (e) {
    console.log('❌ Menu Button error:', e.message);
  }
}

// ═══════════ CALLBACKS ═══════════
bot.on('callback_query', async function(q) {
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;

  if (!isAdmin(q)) {
    return bot.answerCallbackQuery(q.id, { text: '⚠️ للأدمن فقط' });
  }
  bot.answerCallbackQuery(q.id);

  // Main menu
  if (data === 'menu_main') {
    return bot.editMessageText(
      '👑 *لوحة التحكم*\n\nاختر قسماً:',
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, mainMenu())
    );
  }

  // Stats
  if (data === 'menu_stats') {
    const users = Object.values(DB.users);
    const totalBal = users.reduce(function(s, u) { return s + u.balance; }, 0);
    const pending = DB.withdrawals.filter(function(w) { return w.status === 'pending'; }).length;
    const activeAds = DB.ads.filter(function(a) { return a.active && a.media; }).length;
    return bot.editMessageText(
      '📊 *الإحصائيات*\n\n' +
      '👥 المستخدمين: ' + users.length + '\n' +
      '💰 الأرصدة: $' + totalBal.toFixed(2) + '\n' +
      '💸 المدفوع: $' + DB.stats.totalPaid.toFixed(2) + '\n' +
      '👁️ المشاهدات: ' + DB.stats.totalViews + '\n' +
      '⏳ معلقة: ' + pending + '\n' +
      '📢 نشطة: ' + activeAds + '/5',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '🔄 تحديث', callback_data: 'menu_stats' }],
          [{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]
        ]}}
    );
  }

  // Ads menu
  if (data === 'menu_ads') {
    const active = DB.ads.filter(function(a) { return a.active && a.media; }).length;
    return bot.editMessageText(
      '📢 *إدارة الإعلانات*\n\n' +
      '✅ = جاهز | ⬜ = فارغ\n' +
      'النشطة: ' + active + '/5\n\n' +
      'اضغط رقم لإدارته:',
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, adsMenu())
    );
  }

  // Ad detail
  if (data.indexOf('ad_') === 0 && data.indexOf('admedia_') !== 0 && data.indexOf('adtitle_') !== 0 &&
      data.indexOf('adreward_') !== 0 && data.indexOf('adtoggle_') !== 0 && data.indexOf('adclear_') !== 0) {
    const adId = parseInt(data.replace('ad_', ''));
    const ad = DB.ads.find(function(a) { return a.id === adId; });
    if (!ad) return;

    const status = ad.media ? (ad.active ? '🟢 نشط' : '🔴 معطل') : '⬜ فارغ';
    const mediaLine = ad.media
      ? '🎬 النوع: ' + (ad.mediaType === 'video' ? 'فيديو' : 'صورة') + '\n🔗 ' + APP_URL + ad.media
      : '📭 لا يوجد محتوى';

    return bot.editMessageText(
      '📢 *الإعلان ' + adId + '*\n\n' +
      '📝 ' + ad.title + '\n' +
      '💰 $' + ad.reward.toFixed(2) + '\n' +
      '📊 ' + status + '\n\n' +
      mediaLine,
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', disable_web_page_preview: true }, adDetail(adId))
    );
  }

  // Add media flow
  if (data.indexOf('admedia_') === 0) {
    const adId = parseInt(data.replace('admedia_', ''));
    flows[chatId] = { action: 'add_media', adId: adId };
    return bot.editMessageText(
      '📤 *إضافة وسائط للإعلان ' + adId + '*\n\n' +
      'أرسل الآن:\n' +
      '• 🎬 فيديو (MP4)\n' +
      '• 🖼️ صورة (JPG/PNG)\n\n' +
      '⚠️ الحد الأقصى: 20MB',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'ad_' + adId }]] }}
    );
  }

  // Edit title flow
  if (data.indexOf('adtitle_') === 0) {
    const adId = parseInt(data.replace('adtitle_', ''));
    flows[chatId] = { action: 'edit_title', adId: adId };
    return bot.editMessageText(
      '✏️ *تعديل عنوان الإعلان ' + adId + '*\n\nأرسل العنوان الجديد:',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'ad_' + adId }]] }}
    );
  }

  // Edit reward flow
  if (data.indexOf('adreward_') === 0) {
    const adId = parseInt(data.replace('adreward_', ''));
    flows[chatId] = { action: 'edit_reward', adId: adId };
    return bot.editMessageText(
      '💰 *تعديل مكافأة الإعلان ' + adId + '*\n\nأرسل المبلغ الجديد (مثال: 0.50):',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'ad_' + adId }]] }}
    );
  }

  // Toggle
  if (data.indexOf('adtoggle_') === 0) {
    const adId = parseInt(data.replace('adtoggle_', ''));
    const ad = DB.ads.find(function(a) { return a.id === adId; });
    if (ad) {
      ad.active = !ad.active;
      saveDB();
    }
    return bot.editMessageText(
      '✅ تم ' + (ad.active ? 'التفعيل' : 'التعطيل'),
      Object.assign({ chat_id: chatId, message_id: msgId }, adDetail(adId))
    );
  }

  // Clear
  if (data.indexOf('adclear_') === 0) {
    const adId = parseInt(data.replace('adclear_', ''));
    return bot.editMessageText(
      '⚠️ تأكيد حذف محتوى الإعلان ' + adId + '؟',
      { chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [
          [{ text: '🗑️ نعم احذف', callback_data: 'adclear_yes_' + adId }],
          [{ text: '❌ إلغاء', callback_data: 'ad_' + adId }]
        ]}}
    );
  }

  if (data.indexOf('adclear_yes_') === 0) {
    const adId = parseInt(data.replace('adclear_yes_', ''));
    const ad = DB.ads.find(function(a) { return a.id === adId; });
    if (ad) {
      if (ad.media) {
        const oldPath = path.join(UPLOADS, path.basename(ad.media));
        if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch(e) {}
      }
      ad.media = null;
      ad.mediaType = null;
      ad.active = false;
      saveDB();
    }
    return bot.editMessageText(
      '✅ تم الحذف',
      Object.assign({ chat_id: chatId, message_id: msgId }, adsMenu())
    );
  }

  // Withdrawals
  if (data === 'menu_wd') {
    const pending = DB.withdrawals.filter(function(w) { return w.status === 'pending'; });
    if (pending.length === 0) {
      return bot.editMessageText(
        '💸 *السحوبات*\n\n✅ لا توجد طلبات معلقة',
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]] }}
      );
    }
    let text = '💸 *السحوبات المعلقة*\n\n';
    const btns = [];
    for (let i = 0; i < Math.min(pending.length, 5); i++) {
      const w = pending[i];
      text += (i+1) + '. ' + (w.userName || '?') + ' — $' + w.amount + '\n';
      btns.push([
        { text: '✅ موافقة #' + (i+1), callback_data: 'approve_' + w.id },
        { text: '❌ رفض #' + (i+1), callback_data: 'reject_' + w.id }
      ]);
    }
    btns.push([{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]);
    return bot.editMessageText(text,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }

  if (data.indexOf('approve_') === 0) {
    const wid = data.replace('approve_', '');
    const w = DB.withdrawals.find(function(x) { return x.id === wid; });
    if (w && w.status === 'pending') {
      w.status = 'approved';
      DB.stats.totalPaid += w.amount;
      saveDB();
      bot.sendMessage(w.userId, '✅ تمت الموافقة على سحب $' + w.amount).catch(function(){});
      bot.answerCallbackQuery(q.id, { text: '✅ تم', show_alert: true });
    }
    return;
  }

  if (data.indexOf('reject_') === 0) {
    const wid = data.replace('reject_', '');
    const w = DB.withdrawals.find(function(x) { return x.id === wid; });
    if (w && w.status === 'pending') {
      w.status = 'rejected';
      const u = getUser(w.userId);
      saveUser(w.userId, { balance: u.balance + w.amount });
      bot.sendMessage(w.userId, '❌ تم رفض سحب $' + w.amount + ' وأعيد لرصيدك').catch(function(){});
      bot.answerCallbackQuery(q.id, { text: '❌ تم', show_alert: true });
    }
    return;
  }

  // Users
  if (data === 'menu_users') {
    return bot.editMessageText(
      '👥 *المستخدمين*\n\nإجمالي: ' + Object.keys(DB.users).length,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '🔍 بحث', callback_data: 'users_search' }],
          [{ text: '🏆 الأفضل', callback_data: 'users_top' }],
          [{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]
        ]}}
    );
  }

  if (data === 'users_search') {
    flows[chatId] = { action: 'search_user' };
    return bot.editMessageText('🔍 أرسل ID المستخدم:',
      { chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'menu_users' }]] }});
  }

  if (data === 'users_top') {
    const top = Object.values(DB.users).sort(function(a, b) { return b.totalEarned - a.totalEarned; }).slice(0, 10);
    let text = '🏆 *أفضل 10*\n\n';
    top.forEach(function(u, i) {
      text += (i+1) + '. ' + (u.firstName || 'User') + ' — $' + u.totalEarned.toFixed(2) + '\n';
    });
    return bot.editMessageText(text,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]] }});
  }

  // Broadcast
  if (data === 'menu_bc') {
    flows[chatId] = { action: 'broadcast' };
    return bot.editMessageText(
      '📣 *بث جماعي*\n\nأرسل الرسالة:\n👥 للمستخدمين: ' + Object.keys(DB.users).length,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'menu_main' }]] }}
    );
  }

  // Settings
  if (data === 'menu_settings') {
    return bot.editMessageText(
      '⚙️ *الإعدادات*\n\n' +
      '💰 مكافأة الإعلان: $' + AD_REWARD + '\n' +
      '📊 الحد اليومي: ' + DAILY_LIMIT + '\n' +
      '💸 حد السحب: $' + MIN_WITHDRAW + '\n' +
      '👥 مكافأة الدعوة: $' + REF_REWARD,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]] }}
    );
  }

  // App link
  if (data === 'menu_link') {
    return bot.editMessageText(
      '🔗 *رابط التطبيق*\n\n`' + APP_URL + '`',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]] }}
    );
  }

  // Help
  if (data === 'menu_help') {
    return bot.editMessageText(
      '📖 *الدليل*\n\n' +
      '📢 الإعلانات: اختر 1-5 ثم أضف وسائط\n' +
      '💸 السحوبات: تصلك تلقائياً\n' +
      '📣 البث: أرسل نصاً',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]] }}
    );
  }
});

// ═══════════ ADMIN MESSAGES ═══════════
bot.on('message', async function(msg) {
  const chatId = msg.chat.id;
  if (!isAdmin(msg)) return;
  if (msg.text && msg.text.indexOf('/start') === 0) return;

  const flow = flows[chatId];
  if (!flow) return;

  // Add media
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
      const info = await bot.getFile(fileId);
      if (info.file_size && info.file_size > 20 * 1024 * 1024) {
        return bot.sendMessage(chatId, '⚠️ الملف كبير جداً');
      }

      const ext = mediaType === 'video' ? '.mp4' : '.jpg';
      const filename = 'ad' + adId + '_' + Date.now() + ext;
      const filepath = path.join(UPLOADS, filename);

      const stream = bot.getFileStream(fileId);
      const write = fs.createWriteStream(filepath);
      stream.pipe(write);

      await new Promise(function(resolve, reject) {
        write.on('finish', resolve);
        write.on('error', reject);
      });

      const ad = DB.ads.find(function(a) { return a.id === adId; });
      if (ad) {
        if (ad.media) {
          const oldPath = path.join(UPLOADS, path.basename(ad.media));
          if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch(e) {}
        }
        ad.media = '/media/' + filename;
        ad.mediaType = mediaType;
        ad.active = true;
      }
      saveDB();

      delete flows[chatId];
      bot.deleteMessage(chatId, msg.message_id).catch(function(){});

      return bot.sendMessage(chatId,
        '✅ *تم الإضافة بنجاح*\n\n' +
        '📢 الإعلان: ' + adId + '\n' +
        '🎬 النوع: ' + (mediaType === 'video' ? 'فيديو' : 'صورة') + '\n' +
        '📊 الحالة: 🟢 نشط',
        Object.assign({ parse_mode: 'Markdown' }, adDetail(adId))
      );
    } catch (e) {
      console.error('[Upload]', e);
      delete flows[chatId];
      return bot.sendMessage(chatId, '❌ خطأ: ' + e.message);
    }
  }

  // Edit title
  if (flow.action === 'edit_title') {
    const adId = flow.adId;
    const title = (msg.text || '').trim();
    if (!title || title.length > 100) {
      return bot.sendMessage(chatId, '⚠️ عنوان غير صحيح');
    }
    const ad = DB.ads.find(function(a) { return a.id === adId; });
    if (ad) { ad.title = title; saveDB(); }
    delete flows[chatId];
    bot.deleteMessage(chatId, msg.message_id).catch(function(){});
    return bot.sendMessage(chatId, '✅ تم تعديل العنوان', adDetail(adId));
  }

  // Edit reward
  if (flow.action === 'edit_reward') {
    const adId = flow.adId;
    const reward = parseFloat(msg.text);
    if (isNaN(reward) || reward < 0.01 || reward > 100) {
      return bot.sendMessage(chatId, '⚠️ مبلغ غير صحيح');
    }
    const ad = DB.ads.find(function(a) { return a.id === adId; });
    if (ad) { ad.reward = reward; saveDB(); }
    delete flows[chatId];
    bot.deleteMessage(chatId, msg.message_id).catch(function(){});
    return bot.sendMessage(chatId, '✅ تم تعديل المكافأة', adDetail(adId));
  }

  // Search user
  if (flow.action === 'search_user') {
    const uid = (msg.text || '').trim();
    delete flows[chatId];
    bot.deleteMessage(chatId, msg.message_id).catch(function(){});

    if (!DB.users[uid]) {
      return bot.sendMessage(chatId, '❌ المستخدم غير موجود');
    }
    const u = DB.users[uid];
    return bot.sendMessage(chatId,
      '👤 *بيانات المستخدم*\n\n' +
      '🆔 `' + u.id + '`\n' +
      '📛 ' + (u.firstName || '') + ' ' + (u.lastName || '') + '\n' +
      '🔗 @' + (u.username || 'لا يوجد') + '\n' +
      '━━━━━━━━━━━━━━━\n' +
      '💰 $' + u.balance.toFixed(2) + '\n' +
      '💵 $' + u.totalEarned.toFixed(2) + '\n' +
      '👁️ ' + u.totalAds + '\n' +
      '👥 ' + u.referrals.length,
      { parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '💬 مراسلة', url: 'tg://user?id=' + u.id }],
          [{ text: '🏠 الرئيسية', callback_data: 'menu_main' }]
        ]}}
    );
  }

  // Broadcast
  if (flow.action === 'broadcast') {
    const text = msg.text || msg.caption;
    delete flows[chatId];
    bot.deleteMessage(chatId, msg.message_id).catch(function(){});
    if (!text) return bot.sendMessage(chatId, '⚠️ أرسل نصاً');

    const users = Object.keys(DB.users);
    const prog = await bot.sendMessage(chatId, '📣 جاري الإرسال... 0/' + users.length);
    let sent = 0;
    for (let i = 0; i < users.length; i++) {
      try {
        await bot.sendMessage(users[i], '📣 *رسالة من الإدارة*\n\n' + text, { parse_mode: 'Markdown' });
        sent++;
      } catch (e) {}
      await new Promise(function(r) { setTimeout(r, 50); });
    }
    return bot.editMessageText(
      '✅ تم البث\n📤 ' + sent + ' / ' + users.length,
      Object.assign({ chat_id: chatId, message_id: prog.message_id, parse_mode: 'Markdown' }, mainMenu())
    );
  }
});

bot.on('polling_error', function(err) { console.log('[Poll]', err.message); });

// ═══════════ START ═══════════
app.listen(PORT, function() {
  console.log('═══════════════════════════════');
  console.log('🚀 PayPlus Server Running');
  console.log('📍 Port: ' + PORT);
  console.log('🌐 App: ' + APP_URL);
  console.log('👑 Admin: ' + ADMIN_ID);
  console.log('═══════════════════════════════');
  setupMenuButton();
});
