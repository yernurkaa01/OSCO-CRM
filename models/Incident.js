import mongoose from "mongoose"

// "Косяк" — испорченный/повреждённый товар по вине сотрудника.
// Хранит СНИМОК данных на момент инцидента (название товара, имя
// сотрудника) — чтобы даже если товар переименуют или сотрудника
// удалят, история убытков осталась читаемой и точной.
const incidentSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    employeeName: String,   // снимок имени на момент записи

    productCode: String,
    productName: String,    // снимок названия товара на момент записи
    unit: String,

    quantity: { type: Number, required: true },
    lossValue: Number,      // убыток по закупочной цене (null, если цена не была указана)

    reason: String,         // "разбил", "разлил при разгрузке" и т.д.

    createdAt: {
        type: Date,
        default: Date.now
    }
})

export default mongoose.model("Incident", incidentSchema)