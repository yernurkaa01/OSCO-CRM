import mongoose from "mongoose"

const orderSchema = new mongoose.Schema({
    orderCode: String,

    product: String,
    productCode: String,   // код товара на момент заказа — не меняется,
                            // даже если товар потом переименуют в складе
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