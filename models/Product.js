import mongoose from "mongoose"

const productSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true // "c01" и "C01" будут считаться одним и тем же кодом
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        category: {
            type: String,
            required: true // ключ категории, например "Цемент", "Краска", "Сухие смеси"
        },

        qty: {
            type: Number,
            required: true,
            default: 0
        },

        reservedQty: {
            type: Number,
            required: true,
            default: 0
            // Доступно к продаже = qty - reservedQty
        },

        unit: {
            type: String,
            required: true // "мешок", "шт", "ведро" и т.д.
        },

        price: {
            type: Number,
            required: true,
            default: 0
            // Розничная цена — используется ботом и на сайте для продажи
        },

        // ------------------------------------------------------------
        // Необязательные поля для управленческой аналитики (из 1С).
        // На процесс заказа/остатков в боте НЕ влияют — используются
        // только в админке для расчёта прибыли.
        // ------------------------------------------------------------
        purchasePrice: {
            type: Number,
            required: false
            // Закупочная цена
        },

        markupPercent: {
            type: Number,
            required: false
            // Наценка, %
        },

        supplier: {
            type: String,
            required: false,
            trim: true
        }
    },
    {
        timestamps: true
    }
)

export default mongoose.model("Product", productSchema)