// ============================================================
// scripts/verifyBackfill.js
// Проверяет, реально ли у старых заказов появился productCode
// после запуска backfillProductCode.js — только чтение, ничего
// не меняет.
//
// Запуск:  node scripts/verifyBackfill.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Order from "../models/Order.js"

const NAMES = [
    "Цемент (Гежуба) М450 (50 кг)",
    "Цемент (Аккерманн) М500 (1 т)",
    "Attract {Белый}"
]

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен\n")

    for (const name of NAMES) {
        const orders = await Order.find({ product: name })
        console.log(`"${name}": найдено заказов ${orders.length}`)
        orders.forEach(o => {
            console.log(`   _id: ${o._id}, productCode: ${o.productCode || "(нет)"}`)
        })
        console.log("---")
    }

    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка:", err)
    process.exit(1)
})