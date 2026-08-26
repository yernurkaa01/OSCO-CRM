import express from "express";
import Order from "../models/Order.js";
import Employee from "../models/Employee.js";

const router = express.Router();

// ---------- GET /admin/api/seller-sales/employees ----------
// Список сотрудников для выпадающего фильтра
router.get('/api/seller-sales/employees', async (req, res) => {
    try {
        const employees = await Employee.find().sort({ name: 1 });
        res.json(employees.map(e => ({ id: e._id.toString(), name: e.name })));
    } catch (err) {
        console.error("SELLER SALES employees error:", err);
        res.status(500).json({ error: "Ошибка загрузки сотрудников" });
    }
});

function getAlmatyDayStart() {
    // Начало текущих суток по времени Алматы (UTC+5), выраженное как
    // корректный момент в UTC для сравнения с createdAt в базе.
    const now = new Date();
    const almatyNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    almatyNow.setUTCHours(0, 0, 0, 0);
    return new Date(almatyNow.getTime() - 5 * 60 * 60 * 1000);
}

// ---------- GET /admin/api/seller-sales/stats ----------
// Карточки продавцов: заказов/выручка/прибыль за всё время по каждому,
// плюс сводка внизу (всего продавцов, всего заказов, общая выручка/прибыль,
// с отдельными цифрами "за сегодня").
router.get('/api/seller-sales/stats', async (req, res) => {
    try {
        const employees = await Employee.find().sort({ name: 1 });
        const todayStart = getAlmatyDayStart();

        // Заказов у продавца = число РАЗНЫХ orderCode (один чек может
        // содержать несколько позиций/товаров) — не строк в Order.
        const ordersAgg = await Order.aggregate([
            { $match: { source: "employee" } },
            {
                $group: {
                    _id: { employee: "$soldByEmployee", orderCode: "$orderCode" },
                    revenue: { $sum: "$totalPrice" },
                    isToday: { $max: { $cond: [{ $gte: ["$createdAt", todayStart] }, 1, 0] } }
                }
            },
            {
                $group: {
                    _id: "$_id.employee",
                    orders: { $sum: 1 },
                    revenue: { $sum: "$revenue" },
                    ordersToday: { $sum: "$isToday" },
                    revenueToday: { $sum: { $cond: ["$isToday", "$revenue", 0] } }
                }
            }
        ]);

        // Прибыль считаем по ТЕКУЩЕЙ закупочной цене товара (как в
        // /admin/api/reports/sales) — если она не указана, вклад этой
        // позиции в прибыль считаем нулевым, а не додумываем цифру.
        const profitAgg = await Order.aggregate([
            { $match: { source: "employee" } },
            {
                $lookup: {
                    from: "products",
                    localField: "productCode",
                    foreignField: "code",
                    as: "product"
                }
            },
            { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
            {
                $addFields: {
                    hasCost: { $and: [{ $ne: ["$product", null] }, { $ne: ["$product.purchasePrice", null] }] },
                    isToday: { $gte: ["$createdAt", todayStart] }
                }
            },
            {
                $addFields: {
                    profitLine: {
                        $cond: [
                            "$hasCost",
                            { $subtract: ["$totalPrice", { $multiply: ["$product.purchasePrice", "$count"] }] },
                            0
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: "$soldByEmployee",
                    profit: { $sum: "$profitLine" },
                    profitToday: { $sum: { $cond: ["$isToday", "$profitLine", 0] } }
                }
            }
        ]);

        const ordersById = new Map(ordersAgg.map(o => [String(o._id), o]));
        const profitById = new Map(profitAgg.map(p => [String(p._id), p]));

        const sellers = employees.map(e => {
            const o = ordersById.get(e._id.toString()) || { orders: 0, revenue: 0, ordersToday: 0, revenueToday: 0 };
            const p = profitById.get(e._id.toString()) || { profit: 0, profitToday: 0 };

            return {
                id: e._id.toString(),
                name: e.name,
                position: e.position || "Продавец",
                // Пока у сотрудника нет явного флага активности в модели —
                // используем факт наличия логина/пароля как показатель
                // "готов принимать продажи через /sell". Если позже
                // добавите поле active в Employee, замените этой строкой.
                active: !!(e.username && e.password),
                orders: o.orders,
                revenue: o.revenue,
                profit: Math.round(p.profit),
                ordersToday: o.ordersToday,
                revenueToday: o.revenueToday,
                profitToday: Math.round(p.profitToday)
            };
        });

        sellers.sort((a, b) => b.revenue - a.revenue);

        const summary = sellers.reduce((acc, s) => {
            acc.totalOrders += s.orders;
            acc.totalRevenue += s.revenue;
            acc.totalProfit += s.profit;
            acc.ordersToday += s.ordersToday;
            acc.revenueToday += s.revenueToday;
            acc.profitToday += s.profitToday;
            return acc;
        }, { totalOrders: 0, totalRevenue: 0, totalProfit: 0, ordersToday: 0, revenueToday: 0, profitToday: 0 });

        res.json({
            sellers,
            totalSellers: sellers.length,
            activeSellers: sellers.filter(s => s.active).length,
            summary
        });

    } catch (err) {
        console.error("SELLER SALES stats error:", err);
        res.status(500).json({ error: "Ошибка загрузки статистики продавцов" });
    }
});

// ---------- GET /admin/api/seller-sales ----------
// Все продажи ВСЕХ сотрудников через /sell, сгруппированные по orderCode —
// та же логика, что в личном кабинете продавца, но объединённая по всем сразу.
// Фильтры: ?employeeId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
// Используется и для общего списка, и для "профиля" одного продавца
// (фронтенд просто передаёт employeeId при клике на карточку).
router.get('/api/seller-sales', async (req, res) => {
    try {
        const filter = { source: "employee" };

        if (req.query.employeeId) {
            filter.soldByEmployee = req.query.employeeId;
        }
        if (req.query.from) {
            filter.createdAt = { $gte: new Date(req.query.from + "T00:00:00") };
        }
        if (req.query.to) {
            filter.createdAt = filter.createdAt || {};
            filter.createdAt.$lte = new Date(req.query.to + "T23:59:59");
        }

        const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(500);

        // Группируем по orderCode — один "чек" может содержать несколько товаров
        const grouped = {};
        orders.forEach(o => {
            if (!grouped[o.orderCode]) {
                grouped[o.orderCode] = {
                    orderCode: o.orderCode,
                    employeeName: o.soldByEmployeeName,
                    createdAt: o.createdAt,
                    items: [],
                    total: 0
                };
            }
            grouped[o.orderCode].items.push({
                product: o.product,
                count: o.count,
                totalPrice: o.totalPrice
            });
            grouped[o.orderCode].total += o.totalPrice || 0;
        });

        const result = Object.values(grouped).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const grandTotal = result.reduce((acc, o) => acc + o.total, 0);

        res.json({ orders: result, grandTotal, count: result.length });

    } catch (err) {
        console.error("SELLER SALES list error:", err);
        res.status(500).json({ error: "Ошибка загрузки продаж" });
    }
});

export default router;