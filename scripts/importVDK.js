// ============================================================
// scripts/importVDK.js
// Импортирует/обновляет 49 товаров краски (ВДК) в существующую
// категорию "Краска", коды B01-B49 — как указано в каталоге.
//
// Безопасно перезапускать: ищет товар по коду, если найден —
// обновляет данные, если нет — создаёт.
//
// Запуск:  node scripts/importVDK.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import Product from "../models/Product.js"

const CATEGORY = "ВДК Эмульсия"

const ITEMS = [
    { code: "B01", name: 'ВДК Alina Paint FRONTA 15кг', price: 10900.00, unit: "шт" },
    { code: "B02", name: 'ВДК Alina Paint FRONTA 25кг', price: 17700.00, unit: "шт" },
    { code: "B03", name: 'ВДК Alina Paint FRONTA 7кг', price: 5500.00, unit: "шт" },
    { code: "B04", name: 'ВДК ELEGANT 15кг фасадная', price: 5900.00, unit: "шт" },
    { code: "B05", name: 'ВДК ELEGANT 25кг фасадная', price: 8800.00, unit: "шт" },
    { code: "B06", name: 'ВДК MASTER AUBER FASADE 15кг', price: 6700.00, unit: "шт" },
    { code: "B07", name: 'ВДК MASTER AUBER FASADE 25кг', price: 10200.00, unit: "шт" },
    { code: "B08", name: 'ВДК SUNRISE Фасадная Силиконовая 4кг ELEGANT', price: 15700.00, unit: "шт" },
    { code: "B09", name: 'ВДК SUNRISE Фасадная Силиконовая 9кг ELEGANT', price: 30200.00, unit: "шт" },
    { code: "B10", name: 'ВДК Alina Paint NORMA 15кг', price: 6250.00, unit: "шт" },
    { code: "B11", name: 'ВДК Alina Paint NORMA 25кг', price: 9650.00, unit: "шт" },
    { code: "B12", name: 'ВДК Alina Paint NORMA 3кг', price: 1950.00, unit: "шт" },
    { code: "B13", name: 'ВДК Alina Paint NORMA 4,5кг', price: 2250.00, unit: "шт" },
    { code: "B14", name: 'ВДК Alina Paint NORMA 7кг', price: 3000.00, unit: "шт" },
    { code: "B15", name: 'ВДК Alina Paint OPTIMA 25кг', price: 21900.00, unit: "шт" },
    { code: "B16", name: 'ВДК Alina Paint OPTIMA 15кг', price: 13700.00, unit: "шт" },
    { code: "B17", name: 'ВДК Alina Paint OPTIMA 3кг', price: 3150.00, unit: "шт" },
    { code: "B18", name: 'ВДК Alina Paint OPTIMA 7кг', price: 6750.00, unit: "шт" },
    { code: "B19", name: 'ВДК Alina Paint ARCTIC 15кг', price: 8500.00, unit: "шт" },
    { code: "B20", name: 'ВДК Alina Paint ARCTIC 25кг', price: 13800.00, unit: "шт" },
    { code: "B21", name: 'ВДК Alina Paint ARCTIC 3кг', price: 2450.00, unit: "шт" },
    { code: "B22", name: 'ВДК Alina Paint ARCTIC 4,5кг', price: 3100.00, unit: "шт" },
    { code: "B23", name: 'ВДК Alina Paint ARCTIC 7кг', price: 4300.00, unit: "шт" },
    { code: "B24", name: 'ВДК ELEGANT 10кг протирающая', price: 1400.00, unit: "шт" },
    { code: "B25", name: 'ВДК ELEGANT 15кг моющаяся', price: 5200.00, unit: "шт" },
    { code: "B26", name: 'ВДК ELEGANT 15кг протирающая', price: 2900.00, unit: "шт" },
    { code: "B27", name: 'ВДК ELEGANT 25кг моющаяся', price: 8500.00, unit: "шт" },
    { code: "B28", name: 'ВДК ELEGANT 25кг протирающая', price: 4650.00, unit: "шт" },
    { code: "B29", name: 'ВДК ELEGANT 3кг протирающая', price: 650.00, unit: "шт" },
    { code: "B30", name: 'ВДК ELEGANT 7кг протирающая', price: 1050.00, unit: "шт" },
    { code: "B31", name: 'ВДК GRAND ULTRA 15кг', price: 15750.00, unit: "шт" },
    { code: "B32", name: 'ВДК GRAND ULTRA 25кг', price: 23650.00, unit: "шт" },
    { code: "B33", name: 'ВДК GRAND ULTRA 3,5кг', price: 4400.00, unit: "шт" },
    { code: "B34", name: 'ВДК GRAND ULTRA 7кг', price: 8650.00, unit: "шт" },
    { code: "B35", name: 'ВДК MASTER WHITE PLUS 14кг', price: 9000.00, unit: "шт" },
    { code: "B36", name: 'ВДК SUNRISE 3 глубокоматовая 4кг ELEGANT', price: 10700.00, unit: "шт" },
    { code: "B37", name: 'ВДК SUNRISE 3 глубокоматовая 9кг ELEGANT', price: 23400.00, unit: "шт" },
    { code: "B38", name: 'ВДК SUNRISE 7 интерьерная 4кг ELEGANT', price: 14900.00, unit: "шт" },
    { code: "B39", name: 'ВДК SUNRISE 7 интерьерная 9кг ELEGANT', price: 33500.00, unit: "шт" },
    { code: "B40", name: 'ВДК Alina Paint База "A" Fassad 4,16кг', price: 5900.00, unit: "шт" },
    { code: "B41", name: 'ВДК Alina Paint База "AB" Fassad 14кг', price: 21200.00, unit: "шт" },
    { code: "B42", name: 'ВДК Alina Paint База "AB" Fassad 3кг', price: 5100.00, unit: "шт" },
    { code: "B43", name: 'ВДК Alina Paint База "B" Fassad 3,8кг', price: 5050.00, unit: "шт" },
    { code: "B44", name: 'ВДК Alina Paint База "C" Fassad 11,52кг', price: 18000.00, unit: "шт" },
    { code: "B45", name: 'ВДК Alina Paint База "C" Fassad 3,0кг', price: 6600.00, unit: "шт" },
    { code: "B46", name: 'ВДК MASTER AUBER 15кг База A', price: 14200.00, unit: "шт" },
    { code: "B47", name: 'ВДК MASTER MANYCOLOR 10кг База C', price: 13500.00, unit: "шт" },
    { code: "B48", name: 'ВДК SUNRISE Акриловая База C 4кг ELEGANT', price: 10700.00, unit: "шт" },
    { code: "B49", name: 'ВДК SUNRISE Акриловая База C 9кг ELEGANT', price: 22200.00, unit: "шт" },
]

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен\n")

    let created = 0
    let updated = 0

    for (const item of ITEMS) {
        const existing = await Product.findOne({ code: item.code })

        const data = {
            name: item.name,
            category: CATEGORY,
            unit: item.unit,
            price: item.price
        }

        if (existing) {
            existing.set(data)
            await existing.save()
            updated++
            console.log(`🔄 Обновлён: ${item.code} — ${item.name}`)
        } else {
            await Product.create({
                ...data,
                code: item.code,
                qty: 0,       // остаток неизвестен — нужно проставить вручную через админку
                reservedQty: 0
            })
            created++
            console.log(`✅ Создан: ${item.code} — ${item.name}`)
        }
    }

    console.log(`\nГотово. Создано: ${created}, обновлено: ${updated}.`)
    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка импорта:", err)
    process.exit(1)
})