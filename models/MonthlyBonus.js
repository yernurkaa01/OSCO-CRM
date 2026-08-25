import mongoose from "mongoose"

// Зафиксированный расчёт бонуса за конкретный месяц. Считается один раз
// по кнопке "Рассчитать" и НЕ пересчитывается автоматически позже, даже
// если процент сотрудника или его продажи задним числом поменяются —
// это осознанная защита от путаницы "а почему в том месяце было иначе".
const monthlyBonusSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    employeeName: String,   // снимок имени на момент расчёта

    month: { type: String, required: true },   // формат "2026-08"

    totalSales: { type: Number, required: true },   // сумма личных продаж сотрудника за месяц
    bonusPercent: { type: Number, required: true },  // процент, применённый именно в этом расчёте
    bonusAmount: { type: Number, required: true },   // итоговая сумма бонуса

    paid: { type: Boolean, default: false },   // выплачено ли

    createdAt: {
        type: Date,
        default: Date.now
    }
})

// Один сотрудник — один расчёт на месяц, повторный расчёт того же месяца запрещён
monthlyBonusSchema.index({ employee: 1, month: 1 }, { unique: true })

export default mongoose.model("MonthlyBonus", monthlyBonusSchema)