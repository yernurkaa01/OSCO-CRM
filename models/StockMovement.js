import mongoose from "mongoose"

// Журнал движения товара — каждое пополнение или списание склада,
// с причиной. Не заменяет продажи (Order) или косяки сотрудников
// (Incident) — это отдельный журнал именно для прихода новых партий
// и ручных списаний (брак, порча, возврат поставщику, коррекция учёта).
const stockMovementSchema = new mongoose.Schema({
    productCode: { type: String, required: true },
    productName: String,   // снимок названия на момент движения
    unit: String,

    type: {
        type: String,
        enum: ["приход", "расход"],
        required: true
    },

    quantity: { type: Number, required: true },   // всегда положительное число

    // Только для "приход"
    purchasePrice: Number,   // закупочная цена этой партии
    supplier: String,        // поставщик

    // Только для "расход" (ручного, не через продажу/косяк сотрудника)
    reason: String,   // "брак", "порча", "возврат поставщику", "коррекция учёта", "другое"

    note: String,   // свободный комментарий
    recordedBy: String,   // логин админа/кассира, кто внёс запись

    balanceAfter: Number,   // остаток товара СРАЗУ ПОСЛЕ этого движения — для истории

    createdAt: {
        type: Date,
        default: Date.now
    }
})

export default mongoose.model("StockMovement", stockMovementSchema)