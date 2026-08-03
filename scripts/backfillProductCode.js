// ============================================================
// scripts/backfillProductCode.js
// Разовый скрипт: дописывает productCode старым заказам (созданным
// до того, как мы начали сохранять код товара), сопоставляя старый
// текст названия с актуальным кодом товара после переименования.
//
// Запуск:  node scripts/backfillProductCode.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Order from "../models/Order.js"

// Старое название (как записано в Order.product) -> актуальный код товара
const MAPPING = {
    "Цемент (Гежуба) М450 (50 кг)": "P045",
    "Цемент (Аккерманн) М500 (1 т)": "P043",
    "Attract {Белый}": "P050"
}

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен\n")

    for (const [oldName, code] of Object.entries(MAPPING)) {
        const result = await Order.updateMany(
            { product: oldName, productCode: { $exists: false } },
            { $set: { productCode: code } }
        )

        console.log(`"${oldName}" -> код ${code}: обновлено заказов ${result.modifiedCount}`)
    }

    console.log("\nГотово.")
    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка:", err)
    process.exit(1)
})