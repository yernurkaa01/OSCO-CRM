import mongoose from "mongoose"

const orderSchema = new mongoose.Schema({
    orderCode: String,   // без unique — у одного заказа может быть несколько товаров с одним orderCode

    product: String,
    count: Number,

    name: String,
    phone: String,
    username: String,
    comment: String,

    telegramId: Number,

    totalPrice: Number,
    receiptFileId: String,
    paymentBank: String,   // "Kaspi Bank" или "Halyk Bank"

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