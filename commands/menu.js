module.exports = {
    name: '.menu',
    async execute(sock, from) {
        const sections = [{
            title: "💎 خدمات الكاريزما VIP",
            rows: [
                { title: "📥 تحميل تيك توك", rowId: ".tiktok", description: "بدون علامة مائية" },
                { title: "👤 حفظ البروفايل", rowId: ".profile", description: "جلب صورة الحساب" },
                { title: "📢 نظام الترويج", rowId: ".promote", description: "أضف إعلانك الخاص" },
                { title: "🔗 روابط هامة", rowId: ".links", description: "قائمة الروابط الرسمية" }
            ]
        }];

        await sock.sendMessage(from, {
            text: "👑 *أهلاً بك في لوحة تحكم الكاريزما*\nاختر الخدمة المطلوبة:",
            buttonText: "📜 قائمة الخدمات",
            sections: sections,
            listType: 1
        });
    }
};
