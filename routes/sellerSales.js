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

// ---------- GET /admin/api/seller-sales ----------
// Все продажи ВСЕХ сотрудников через /sell, сгруппированные по orderCode —
// та же логика, что в личном кабинете продавца, но объединённая по всем сразу.
// Фильтры: ?employeeId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
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