// ============================================================
// scripts/listProducts.js
// Просто выводит все товары в базе — ничего не меняет.
// Нужен, чтобы увидеть точные названия/категории как они реально
// хранятся в MongoDB.
//
// Запуск:  node scripts/listProducts.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Product from "../models/Product.js"

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен\n")

    const products = await Product.find({})

    products.forEach(p => {
        console.log(`_id: ${p._id}`)
        console.log(`name: "${p.name}"`)
        console.log(`category: "${p.category}"`)
        console.log(`code: ${p.code || "(нет)"}`)
        console.log(`qty: ${p.qty}, unit: ${p.unit}, price: ${p.price}`)
        console.log("---")
    })

    console.log(`\nВсего товаров: ${products.length}`)

    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка:", err)
    process.exit(1)
})