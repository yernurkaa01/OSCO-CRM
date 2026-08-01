import express from "express";
import Order from "../models/Order.js";
import Product from "../models/Product.js";

const router = express.Router();

// Считаем "продано" — заказы в статусе "оплачено" или "выдано"
// (деньги реально получены, товар оплачен клиентом)
const SOLD_STATUSES = ["оплачено", "выдано"];

function getDateRange(period, fromParam, toParam) {
    const now = new Date();

    // Произвольный диапазон дат (или одна конкретная дата) — приоритет
    // выше, чем быстрые кнопки "Сегодня/Неделя/Месяц"
    if (fromParam) {
        const from = new Date(fromParam + "T00:00:00");
        const to = toParam ? new Date(toParam + "T23:59:59") : new Date(fromParam + "T23:59:59");
        return { from, to };
    }

    if (period === "week") {
        // Строго календарная неделя: с понедельника 00:00 по сейчас
        const day = now.getDay(); // 0 = воскресенье, 1 = понедельник ... 6 = суббота
        const diffToMonday = (day === 0 ? -6 : 1) - day;
        const from = new Date(now);
        from.setDate(now.getDate() + diffToMonday);
        from.setHours(0, 0, 0, 0);
        return { from, to: now };
    }

    if (period === "month") {
        // Строго календарный месяц: с 1 числа 00:00 по сейчас
        const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        return { from, to: now };
    }

    // "today" — с начала текущих суток по сейчас
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
}

// ---------- GET /admin/api/reports/sales?period=today|week|month  ----------
// ---------- ИЛИ ?date=YYYY-MM-DD  ИЛИ  ?from=YYYY-MM-DD&to=YYYY-MM-DD ----------
router.get('/api/reports/sales', async (req, res) => {
    try {
        const period = ["today", "week", "month"].includes(req.query.period)
            ? req.query.period
            : "today";

        // ?date=... — короткая форма для одного конкретного дня
        const fromParam = req.query.date || req.query.from || null;
        const toParam = req.query.date || req.query.to || null;

        const { from, to } = getDateRange(period, fromParam, toParam);

        const sold = await Order.aggregate([
            {
                $match: {
                    status: { $in: SOLD_STATUSES },
                    createdAt: { $gte: from, $lte: to }
                }
            },
            {
                $group: {
                    _id: "$product",
                    totalCount: { $sum: "$count" },
                    totalSum: { $sum: "$totalPrice" },
                    orders: { $sum: 1 }
                }
            },
            { $sort: { totalCount: -1 } }
        ]);

        // Подтягиваем единицу измерения по названию товара из склада
        const productNames = sold.map(s => s._id);
        const products = await Product.find(
            { name: { $in: productNames } },
            { name: 1, unit: 1 }
        );

        const unitByName = {};
        products.forEach(p => { unitByName[p.name] = p.unit; });

        const items = sold.map(s => ({
            product: s._id,
            unit: unitByName[s._id] || "-",
            totalCount: s.totalCount,
            totalSum: s.totalSum,
            orders: s.orders
        }));

        const grandTotal = items.reduce((acc, i) => acc + i.totalSum, 0);

        res.json({
            period,
            from,
            to,
            items,
            grandTotal
        });

    } catch (err) {
        console.error("REPORTS sales error:", err);
        res.status(500).json({ error: "Ошибка построения отчёта" });
    }
});

export default router;