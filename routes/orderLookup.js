import express from "express";
import Order from "../models/Order.js";

const router = express.Router();

function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- GET /admin/api/order-lookup/:code ----------
// Находит ВСЕ товары, относящиеся к одному orderCode — работает
// одинаково для заказов из Telegram-бота И для продаж сотрудников
// через /sell, потому что оба используют одно и то же поле orderCode.
router.get('/api/order-lookup/:code', async (req, res) => {
    try {
        const code = escapeRegex(req.params.code.trim());

        const items = await Order.find({ orderCode: { $regex: `^${code}$`, $options: "i" } })
            .sort({ createdAt: 1 });

        if (!items.length) {
            return res.status(404).json({ error: "Заказ с таким кодом не найден" });
        }

        const total = items.reduce((acc, o) => acc + (o.totalPrice || 0), 0);

        res.json({
            orderCode: items[0].orderCode,
            source: items[0].source || "bot",
            soldByEmployeeName: items[0].soldByEmployeeName || null,
            clientName: items[0].name || null,
            clientPhone: items[0].phone || null,
            status: items[0].status,
            createdAt: items[0].createdAt,
            total,
            items: items.map(o => ({
                product: o.product,
                productCode: o.productCode,
                count: o.count,
                totalPrice: o.totalPrice
            }))
        });

    } catch (err) {
        console.error("ORDER LOOKUP error:", err);
        res.status(500).json({ error: "Ошибка поиска заказа" });
    }
});

export default router;