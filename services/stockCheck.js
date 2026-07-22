import Product from "../models/Product.js"
import Order from "../models/Order.js"

export const STOCK_STATUS = {
    OK: "OK",
    PARTIAL: "PARTIAL",
    OUT_OF_STOCK: "OUT_OF_STOCK",
    NOT_FOUND: "NOT_FOUND",
    ERROR: "ERROR"
}

/**
 * Считает, сколько товара уже "забронировано" неподтверждёнными заказами
 * (заказы клиентов, которые прислали чек, но менеджер ещё не подтвердил оплату).
 * @param {string} productName
 * @returns {Promise<number>}
 */
async function getReservedQty(productName) {
    const result = await Order.aggregate([
        { $match: { product: productName, status: "ожидание" } },
        { $group: { _id: null, total: { $sum: "$count" } } }
    ])

    return result[0]?.total || 0
}

/**
 * Проверяет наличие товара с учётом уже забронированных (но не подтверждённых) заказов.
 * Реально доступно = остаток на складе − сумма заказов в статусе "ожидание"
 * @param {string} productName
 * @param {number} requestedQty
 * @returns {Promise<{status: string, availableQty?: number}>}
 */
export async function checkProductStock(productName, requestedQty) {
    try {
        const product = await Product.findOne({ name: productName })

        if (!product) {
            console.log(`⚠️ Товар не найден в БД: "${productName}"`)
            return { status: STOCK_STATUS.NOT_FOUND }
        }

        const reserved = await getReservedQty(productName)
        const availableQty = Math.max(0, product.qty - reserved)

        if (availableQty <= 0) {
            return { status: STOCK_STATUS.OUT_OF_STOCK, availableQty: 0 }
        }

        if (availableQty < requestedQty) {
            return { status: STOCK_STATUS.PARTIAL, availableQty }
        }

        return { status: STOCK_STATUS.OK, availableQty }

    } catch (error) {
        console.error("Ошибка при проверке остатков:", error)
        return { status: STOCK_STATUS.ERROR }
    }
}

/**
 * Физически списывает товар со склада.
 * Вызывать ТОЛЬКО когда менеджер подтвердил оплату заказа в CRM.
 * @param {string} productName
 * @param {number} qty
 */
export async function decreaseStock(productName, qty) {
    try {
        await Product.updateOne(
            { name: productName },
            { $inc: { qty: -qty } }
        )
    } catch (error) {
        console.error("Ошибка при списании остатков:", error)
    }
}