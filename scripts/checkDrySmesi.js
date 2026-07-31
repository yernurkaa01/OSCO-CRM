// ============================================================
// scripts/checkDrySmesi.js
// Показывает все товары категории "Сухие смеси" в базе, отсортированные
// по коду — чтобы увидеть, каких кодов не хватает.
//
// Запуск:  node scripts/checkDrySmesi.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Product from "../models/Product.js"

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен\n")

    const products = await Product.find({ category: "Сухие смеси" }).sort({ code: 1 })

    console.log(`Всего товаров в категории "Сухие смеси": ${products.length}\n`)

    products.forEach(p => {
        console.log(`${p.code || "(нет кода)"} — ${p.name}`)
    })

    // Проверяем, какие коды S01-S42 отсутствуют
    const existingCodes = new Set(products.map(p => p.code))
    const missing = []
    for (let i = 1; i <= 42; i++) {
        const code = "S" + String(i).padStart(2, "0")
        if (!existingCodes.has(code)) missing.push(code)
    }

    console.log("\n=== Отсутствующие коды (из ожидаемых S01-S42) ===")
    console.log(missing.length ? missing.join(", ") : "Все коды на месте")

    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка:", err)
    process.exit(1)
})