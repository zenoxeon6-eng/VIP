const axios = require('axios');

module.exports = {
    name: '.tiktok',
    async execute(sock, from, text) {
        const url = text.split(' ')[1];
        if (!url) return await sock.sendMessage(from, { text: "⚠️ يرجى إرسال الرابط بعد الأمر.\nمثال: .tiktok [الرابط]" });
        
        try {
            // هنا تضع رابط API خاص بك أو خدمة عامة لجلب الفيديو
            await sock.sendMessage(from, { text: "⏳ جاري المعالجة..." });
            // مثال توضيحي:
            await sock.sendMessage(from, { video: { url: url }, caption: "✅ تم التحميل بواسطة الكاريزما" });
        } catch (e) {
            await sock.sendMessage(from, { text: "❌ فشل التحميل، تأكد من الرابط." });
        }
    }
};
