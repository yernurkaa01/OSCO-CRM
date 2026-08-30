import mongoose from "mongoose"

const orderSchema = new mongoose.Schema({
    orderCode: String,

    product: String,
    productCode: String,   // код товара на момент заказа — не меняется,
                            // даже если товар потом переименуют в складе
    count: Number,
    unit: String,           // единица измерения товара на момент заказа
                             // (кг, шт, мешок и т.д.) — без этого поля
                             // уведомления клиенту были вынуждены
                             // хардкодить "шт." для абсолютно любого товара

    name: String,
    phone: String,
    username: String,
    comment: String,

    telegramId: Number,

    totalPrice: Number,
    receiptFileId: String,
    paymentBank: String,   // "Kaspi Bank" или "Halyk Bank"

    // ------------------------------------------------------------
    // Продажи через личный кабинет продавца (/sell), а не через
    // Telegram-бота клиента. Без этих трёх полей ЛЮБОЙ Order.create()
    // с source/soldByEmployee/soldByEmployeeName МОЛЧА терял эти данные
    // (Mongoose strict-режим отбрасывает поля, которых нет в схеме) —
    // из-за этого "Мои продажи" и статистика продавцов всегда были пустые,
    // хотя сами заказы прекрасно сохранялись и были видны в общем журнале.
    // ------------------------------------------------------------
    source: {
        type: String,
        enum: ["bot", "employee"],
        default: "bot"
    },
    soldByEmployee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    soldByEmployeeName: String,   // снимок имени продавца на момент продажи

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