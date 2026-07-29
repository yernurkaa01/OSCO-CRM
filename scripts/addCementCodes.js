// ============================================================
// scripts/addCementCodes.js
// Разовый скрипт: присваивает коды (C01, C02, C03) реальным боевым
// товарам цемента в базе crm_production, по точным названиям.
//
// Запуск:  node scripts/addCementCodes.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Product from "../models/Product.js"

// Сопоставление: точное название товара в базе -> код
const CEMENT_CODES = {
    "Цемент (Гежуба) М450 (50 кг)": "C01",
    "Цемент (Аккерманн) М500 (1 т)": "C02",
    "Цемент (Аккерманн) М600 (1 т)": "C03"
}

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен")

    for (const [name, code] of Object.entries(CEMENT_CODES)) {
        const product = await Product.findOne({ name })

        if (!product) {
            console.log(`⚠️  Не найден товар с названием: "${name}" — пропускаю`)
            continue
        }

        if (product.code) {
            console.log(`ℹ️  У товара "${name}" уже есть код: ${product.code} — пропускаю`)
            continue
        }

        product.code = code
        await product.save()
        console.log(`✅ "${name}" -> код ${code}`)
    }

    console.log("Готово.")
    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка миграции:", err)
    process.exit(1)
})