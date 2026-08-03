import express from "express";
import Order from "../models/Order.js";
import Product from "../models/Product.js";

const router = express.Router();

const SOLD_STATUSES = ["оплачено", "выдано"];

function getDateRange(period, fromParam, toParam) {
    const now = new Date();

    if (fromParam) {
        const from = new Date(fromParam + "T00:00:00");
        const to = toParam ? new Date(toParam + "T23:59:59") : new Date(fromParam + "T23:59:59");
        return { from, to };
    }

    if (period === "week") {
        const day = now.getDay();
        const diffToMonday = (day === 0 ? -6 : 1) - day;
        const from = new Date(now);
        from.setDate(now.getDate() + diffToMonday);
        from.setHours(0, 0, 0, 0);
        return { from, to: now };
    }

    if (period === "month") {
        const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        return { from, to: now };
    }

    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
}

function toDateKey(d) {
    return new Date(d).toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDayLabel(dateKey) {
    const [, m, d] = dateKey.split("-");
    return `${d}.${m}`;
}

router.get('/api/reports/sales', async (req, res) => {
    try {
        const period = ["today", "week", "month"].includes(req.query.period)
            ? req.query.period
            : "today";

        const fromParam = req.query.date || req.query.from || null;
        const toParam = req.query.date || req.query.to || null;

        const { from, to } = getDateRange(period, fromParam, toParam);

        const matchStage = {
            status: { $in: SOLD_STATUSES },
            createdAt: { $gte: from, $lte: to }
        };

        // ---- Продано по товарам ----
        // Группируем по коду товара (если он сохранён в заказе), а не по
        // тексту названия — так переименование товара на складе больше НЕ
        // рвёт связь с его историей продаж. Для старых заказов (до того,
        // как мы начали сохранять код) используем текст названия как раньше.
        const sold = await Order.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: { $ifNull: ["$productCode", "$product"] },
                    sampleName: { $first: "$product" },
                    sampleCode: { $first: "$productCode" },
                    totalCount: { $sum: "$count" },
                    totalSum: { $sum: "$totalPrice" },
                    orders: { $sum: 1 }
                }
            },
            { $sort: { totalCount: -1 } }
        ]);

        const codesToLookup = sold.filter(s => s.sampleCode).map(s => s.sampleCode);
        const namesToLookup = sold.filter(s => !s.sampleCode).map(s => s.sampleName);

        const productsByCode = await Product.find(
            { code: { $in: codesToLookup } },
            { code: 1, name: 1, unit: 1, category: 1 }
        );
        const productsByName = await Product.find(
            { name: { $in: namesToLookup } },
            { name: 1, unit: 1, category: 1 }
        );

        const infoByCode = {};
        productsByCode.forEach(p => { infoByCode[p.code] = p; });

        const infoByName = {};
        productsByName.forEach(p => { infoByName[p.name] = p; });

        const items = sold.map(s => {
            const byCode = s.sampleCode ? infoByCode[s.sampleCode] : null;
            const byName = !s.sampleCode ? infoByName[s.sampleName] : null;
            const info = byCode || byName;

            return {
                // Если товар найден по коду — берём его АКТУАЛЬНОЕ название
                // (даже если товар переименовали, отчёт покажет новое имя).
                // Если код не сохранён (старый заказ) — используем текст,
                // который был записан в заказе на тот момент.
                product: info?.name || s.sampleName,
                unit: info?.unit || "-",
                category: info?.category || "Другое",
                totalCount: s.totalCount,
                totalSum: s.totalSum,
                orders: s.orders
            };
        });

        const grandTotal = items.reduce((acc, i) => acc + i.totalSum, 0);
        const totalQtySold = items.reduce((acc, i) => acc + i.totalCount, 0);

        // ---- Уникальные заказы (по orderCode) и средний чек ----
        const distinctOrderCodesAgg = await Order.aggregate([
            { $match: matchStage },
            { $group: { _id: "$orderCode", sum: { $sum: "$totalPrice" } } }
        ]);
        const distinctOrders = distinctOrderCodesAgg.length;
        const avgCheck = distinctOrders > 0 ? Math.round(grandTotal / distinctOrders) : 0;

        // ---- Продажи по дням (для графика) ----
        const dailyAgg = await Order.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    revenue: { $sum: "$totalPrice" }
                }
            }
        ]);
        const dailyMap = {};
        dailyAgg.forEach(d => { dailyMap[d._id] = d.revenue; });

        // Заполняем все дни диапазона (включая нулевые), чтобы график был непрерывным
        const dailyBreakdown = [];
        const cursor = new Date(from);
        cursor.setHours(0, 0, 0, 0);
        const lastDay = new Date(to);
        lastDay.setHours(0, 0, 0, 0);

        while (cursor <= lastDay) {
            const key = toDateKey(cursor);
            dailyBreakdown.push({
                date: key,
                label: formatDayLabel(key),
                revenue: dailyMap[key] || 0
            });
            cursor.setDate(cursor.getDate() + 1);
        }

        // ---- Разбивка по категориям (топ-3 + "Другое") ----
        const categoryTotals = {};
        items.forEach(i => {
            categoryTotals[i.category] = (categoryTotals[i.category] || 0) + i.totalSum;
        });

        const categoryEntries = Object.entries(categoryTotals)
            .sort((a, b) => b[1] - a[1]);

        let categoryBreakdown;
        if (categoryEntries.length <= 4) {
            categoryBreakdown = categoryEntries.map(([category, sum]) => ({
                category,
                sum,
                percent: grandTotal > 0 ? Math.round((sum / grandTotal) * 100) : 0
            }));
        } else {
            const top = categoryEntries.slice(0, 3);
            const rest = categoryEntries.slice(3);
            const restSum = rest.reduce((acc, [, s]) => acc + s, 0);

            categoryBreakdown = [
                ...top.map(([category, sum]) => ({
                    category,
                    sum,
                    percent: grandTotal > 0 ? Math.round((sum / grandTotal) * 100) : 0
                })),
                {
                    category: "Другое",
                    sum: restSum,
                    percent: grandTotal > 0 ? Math.round((restSum / grandTotal) * 100) : 0
                }
            ];
        }

        res.json({
            period,
            from,
            to,
            items,
            grandTotal,
            totalQtySold,
            distinctOrders,
            avgCheck,
            dailyBreakdown,
            categoryBreakdown
        });

    } catch (err) {
        console.error("REPORTS sales error:", err);
        res.status(500).json({ error: "Ошибка построения отчёта" });
    }
});

export default router;