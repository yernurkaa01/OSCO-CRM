import express from "express";
import Employee from "../models/Employee.js";
import Order from "../models/Order.js";
import MonthlyBonus from "../models/MonthlyBonus.js";

const router = express.Router();

// ---------- POST /admin/api/bonuses/calculate ----------
// Считает бонус за указанный месяц для ВСЕХ сотрудников с процентом
// бонуса > 0.
//
// Поведение при повторном запуске за тот же месяц:
// - если запись уже ВЫПЛАЧЕНА (paid: true) — сумма НАВСЕГДА зафиксирована,
//   пересчёт пропускается. Это и есть настоящая защита "почему в том
//   месяце было иначе" — деньги уже отданы, менять цифру задним числом нельзя.
// - если запись ещё НЕ выплачена — пересчитываем заново по актуальным
//   продажам. Раньше это тоже пропускалось, из-за чего новая продажа
//   сотрудника после первого расчёта "терялась" и не попадала в бонус,
//   хотя реально ничего ещё не было выплачено и путаницы возникнуть не могло.
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
const existing = await MonthlyBonus.findOne({ employee: emp._id, month });

if (existing && existing.paid) {
results.push({ employee: emp.name, skipped: true, reason: "уже выплачено — сумма зафиксирована" });
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

if (existing) {
// Ещё не выплачено — можно спокойно обновить под актуальные продажи
existing.totalSales = totalSales;
existing.bonusPercent = emp.bonusPercent;
existing.bonusAmount = bonusAmount;
await existing.save();

results.push({ employee: emp.name, totalSales, bonusAmount, updated: true });
continue;
            }

await MonthlyBonus.create({
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
const existing = await MonthlyBonus.findById(req.params.id);
if (!existing) return res.status(404).json({ error: "Запись не найдена" });

existing.paid = true;
existing.paidAmount = existing.bonusAmount;
existing.paidAt = new Date();
await existing.save();

res.json(existing);

    } catch (err) {
console.error("BONUSES mark-paid error:", err);
res.status(500).json({ error: "Ошибка обновления" });
    }
});

// ---------- POST /admin/api/bonuses/:id/unmark-paid ----------
// Разблокирует запись — снимает статус "выплачено", чтобы можно было
// пересчитать месяц заново (например, если отметили выплату раньше
// окончания месяца, а потом появились ещё продажи). paidAmount НЕ
// стираем — это история того, сколько уже реально отдано, пригодится
// при следующем расчёте, чтобы не заплатить всю новую сумму ещё раз.
router.post('/api/bonuses/:id/unmark-paid', async (req, res) => {
try {
const bonus = await MonthlyBonus.findByIdAndUpdate(
req.params.id,
            { paid: false },
            { new: true }
        );
if (!bonus) return res.status(404).json({ error: "Запись не найдена" });
res.json(bonus);

    } catch (err) {
console.error("BONUSES unmark-paid error:", err);
res.status(500).json({ error: "Ошибка обновления" });
    }
});

// ---------- GET /admin/api/bonuses/pending ----------
// Находит месяцы, в которых у сотрудника ЕСТЬ продажи через /sell, но
// расчёт бонуса за этот месяц ЕЩЁ НИ РАЗУ не запускался. Без этой проверки
// такая выручка видна в общей сумме на странице "Продавцы" (там считается
// вообще всё, без разбора по месяцам), но полностью невидима на "Бонусы" —
// легко забыть посчитать какой-то месяц и заплатить сотруднику меньше.
router.get('/api/bonuses/pending', async (req, res) => {
    try {
        const monthlyAgg = await Order.aggregate([
            { $match: { source: "employee" } },
            {
                $group: {
                    _id: {
                        employee: "$soldByEmployee",
                        month: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }
                    },
                    employeeName: { $first: "$soldByEmployeeName" },
                    totalSales: { $sum: "$totalPrice" }
                }
            }
        ]);

        const existingBonuses = await MonthlyBonus.find({}, { employee: 1, month: 1 });
        const existingSet = new Set(existingBonuses.map(b => `${b.employee}_${b.month}`));

        const pending = monthlyAgg
            .filter(m => !existingSet.has(`${m._id.employee}_${m._id.month}`))
            .map(m => ({
                employee: m._id.employee?.toString(),
                employeeName: m.employeeName,
                month: m._id.month,
                totalSales: m.totalSales
            }))
            .sort((a, b) => a.month.localeCompare(b.month));

        res.json(pending);

    } catch (err) {
        console.error("BONUSES pending error:", err);
        res.status(500).json({ error: "Ошибка проверки непосчитанных месяцев" });
    }
});

export default router;