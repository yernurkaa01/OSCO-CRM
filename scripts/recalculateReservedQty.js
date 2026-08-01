// ============================================================
// scripts/recalculateReservedQty.js
// Пересчитывает reservedQty у ВСЕХ товаров по факту — берёт реальную
// сумму количества в заказах со статусом "резерв" и выставляет её
// как reservedQty у товара, независимо от того, что было раньше
// (чинит зависшие резервы из-за прошлых ошибок в releaseStock).
//
// Запуск:  node scripts/recalculateReservedQty.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Product from "../models/Product.js"
import Order from "../models/Order.js"

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен\n")

    const products = await Product.find({})

    for (const product of products) {
        const result = await Order.aggregate([
            { $match: { product: product.name, status: "резерв" } },
            { $group: { _id: null, total: { $sum: "$count" } } }
        ])

        const realReserved = result[0]?.total || 0
        const oldReserved = product.reservedQty || 0

        if (realReserved !== oldReserved) {
            product.reservedQty = realReserved
            await product.save()
            console.log(`🔧 "${product.name}": reservedQty ${oldReserved} -> ${realReserved}`)
        } else {
            console.log(`✓ "${product.name}": уже верно (${oldReserved})`)
        } 
    }

    console.log("\nГотово.")
    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка:", err)
    process.exit(1)
})