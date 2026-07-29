// ============================================================
// scripts/addCementCodes.js
// Разовый скрипт: присваивает коды (C01, C02, C03) существующим
// товарам цемента в базе, по РЕАЛЬНЫМ названиям (проверено через
// scripts/listProducts.js).
//
// Запуск:  node scripts/addCementCodes.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Product from "../models/Product.js"

// Сопоставление: точное название товара в базе -> код
const CEMENT_CODES = {
    "Цемент М400 (50 кг)": "C01",
    "Цемент М500 (50 кг)": "C02",
    "Цемент М550 (50 кг)": "C03"
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