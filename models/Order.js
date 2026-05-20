import mongoose from "mongoose"

const orderSchema = new mongoose.Schema({
    orderCode: {
        type: String,
        unique: true
    },

    product: String,
    count: Number,

    name: String,
    phone: String,
    username: String,

    telegramId: Number,

    totalPrice: Number,
    receipt: String,

    status: {
        type: String,
        default: "ожидает"
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
})

export default mongoose.model("Order", orderSchema)