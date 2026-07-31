// ============================================================
// scripts/fixMissingReservedQty.js
// Проставляет reservedQty = 0 всем товарам, у которых это поле
// физически отсутствует в MongoDB (созданы до того, как поле
// появилось в схеме Product). Без этого reserveStock() всегда
// проваливается для таких товаров — $subtract от отсутствующего
// поля даёт null, и null >= число всегда false.
//
// Запуск:  node scripts/fixMissingReservedQty.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Product from "../models/Product.js"

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен")

    const result = await Product.updateMany(
        { reservedQty: { $exists: false } },
        { $set: { reservedQty: 0 } }
    )

    console.log(`Исправлено товаров: ${result.modifiedCount}`)

    // Покажем, у кого теперь есть/нет поля — для проверки
    const stillMissing = await Product.countDocuments({ reservedQty: { $exists: false } })
    console.log(`Осталось без reservedQty: ${stillMissing}`)

    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка:", err)
    process.exit(1)
})