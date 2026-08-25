import express from "express";
import Employee from "../models/Employee.js";
import Order from "../models/Order.js";
import MonthlyBonus from "../models/MonthlyBonus.js";

const router = express.Router();

// ---------- POST /admin/api/bonuses/calculate ----------
// Считает и ФИКСИРУЕТ бонус за указанный месяц для ВСЕХ сотрудников
// с процентом бонуса > 0. Если расчёт за этот месяц уже был — пропускает
// (не пересчитывает повторно), чтобы не перезаписать уже выданный бонус.
router.post('/api/bonuses/calculate', express.json(), async (req, res) => {
    try {
        const { month } = req.body || {};   // формат "2026-08"
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ error: "Укажите месяц в формате YYYY-MM" });
        }

        const from = new Date(month + "-01T00:00:00");
        const to = new Date(from);
        to.setMonth(to.getMonth() + 1);

        const employees = await Employee.find({ bonusPercent: { $gt: 0 } });

        const results = [];

        for (const emp of employees) {
            const already = await MonthlyBonus.findOne({ employee: emp._id, month });
            if (already) {
                results.push({ employee: emp.name, skipped: true, reason: "уже посчитано ранее" });
                continue;
            }

            const salesAgg = await Order.aggregate([
                {
                    $match: {
                        source: "employee",
                        soldByEmployee: emp._id,
                        createdAt: { $gte: from, $lt: to }
                    }
                },
                { $group: { _id: null, total: { $sum: "$totalPrice" } } }
            ]);

            const totalSales = salesAgg[0]?.total || 0;
            const bonusAmount = Math.round(totalSales * (emp.bonusPercent / 100));

            const record = await MonthlyBonus.create({
                employee: emp._id,
                employeeName: emp.name,
                month,
                totalSales,
                bonusPercent: emp.bonusPercent,
                bonusAmount
            });

            results.push({ employee: emp.name, totalSales, bonusAmount, skipped: false });
        }

        res.json({ month, results });

    } catch (err) {
        console.error("BONUSES calculate error:", err);
        res.status(500).json({ error: "Ошибка расчёта бонусов" });
    }
});

// ---------- GET /admin/api/bonuses?month=2026-08 ----------
router.get('/api/bonuses', async (req, res) => {
    try {
        const filter = {};
        if (req.query.month) filter.month = req.query.month;

        const bonuses = await MonthlyBonus.find(filter).sort({ month: -1, bonusAmount: -1 });
        res.json(bonuses);

    } catch (err) {
        console.error("BONUSES list error:", err);
        res.status(500).json({ error: "Ошибка загрузки бонусов" });
    }
});

// ---------- POST /admin/api/bonuses/:id/mark-paid ----------
router.post('/api/bonuses/:id/mark-paid', async (req, res) => {
    try {
        const bonus = await MonthlyBonus.findByIdAndUpdate(
            req.params.id,
            { paid: true },
            { new: true }
        );
        if (!bonus) return res.status(404).json({ error: "Запись не найдена" });
        res.json(bonus);

    } catch (err) {
        console.error("BONUSES mark-paid error:", err);
        res.status(500).json({ error: "Ошибка обновления" });
    }
});

export default router;