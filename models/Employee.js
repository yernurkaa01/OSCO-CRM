import mongoose from "mongoose"

const employeeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    position: String,
    phone: String,

    username: { type: String, unique: true, sparse: true },
    password: String,

    telegramId: { type: Number, unique: true, sparse: true },

    // Индивидуальный процент бонуса от личных продаж через /sell.
    // Можно менять в любой момент — уже посчитанные месяцы это не затронет.
    bonusPercent: { type: Number, default: 0 },

    createdAt: {
        type: Date,
        default: Date.now
    }
})

export default mongoose.model("Employee", employeeSchema)