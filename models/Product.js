import mongoose from "mongoose"

const productSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        category: {
            type: String,
            required: true // ключ категории, например "cement", "paint"
        },

        qty: {
            type: Number,
            required: true,
            default: 0
        },

        unit: {
            type: String,
            required: true // "мешок", "шт", "ведро" и т.д.
        },

        price: {
            type: Number,
            required: true,
            default: 0
        }
    },
    {
        timestamps: true
    }
)

export default mongoose.model("Product", productSchema)