// Одноразовый скрипт: запусти "node seedProducts.js", чтобы создать/обновить
// товары в MongoDB Atlas с начальными остатками.
// name ДОЛЖЕН точно совпадать с ключами PRICES в bot.js.

import "dotenv/config"
import mongoose from "mongoose"
import Product from "./models/Product.js"

const initialStock = [
    {
        name: "Цемент (Гежуба) М450 (50 кг)",
        category: "cement",
        qty: 100,
        unit: "мешок",
        price: 2600
    },
    {
        name: "Цемент (Аккерманн) М500 (1 т)",
        category: "cement",
        qty: 20,
        unit: "т",
        price: 48500
    },
    {
        name: "Цемент (Аккерманн) М600 (1 т)",
        category: "cement",
        qty: 20,
        unit: "т",
        price: 50000
    },
    {
        name: "наружный краска",
        category: "paint",
        qty: 50,
        unit: "банка",
        price: 800
    },
    {
        name: "внутренный краска",
        category: "paint",
        qty: 50,
        unit: "банка",
        price: 1000
    }
]

async function seed() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен")

    for (const item of initialStock) {
        await Product.updateOne(
            { name: item.name },
            { $set: item },
            { upsert: true }
        )
        console.log(`✅ ${item.name}: ${item.qty} ${item.unit}`)
    }

    console.log("Готово!")
    process.exit(0)
}

seed().catch(err => {
    console.error(err)
    process.exit(1)
})