import Product from "../models/Product.js"

/**
 * Соответствие названий товаров в боте и в коллекции products (склад).
 * При добавлении новых позиций в бот — добавьте строку сюда.
 */
export const BOT_TO_DB_PRODUCT = {
    "50кг Гежуба 450": "Цемент Гежуба М450 (50 кг)",
    "1т Аккерманн 500": "Цемент Аккерманн M500 (1т)",
    "1т Аккерманн 600": "Цемент Аккерманн М600 (1т)",
    "наружный краска": "наружный краска",
    "внутренный краска": "внутренный краска"
}

export const STOCK_STATUS = {
    AVAILABLE: "available",
    PARTIAL: "partial",
    OUT_OF_STOCK: "out_of_stock",
    NOT_FOUND: "not_found",
    ERROR: "error"
}

async function findProductInDb(botProductName) {
    const dbName = BOT_TO_DB_PRODUCT[botProductName]

    if (dbName) {
        const byExactName = await Product.findOne({ name: dbName })
        if (byExactName) return byExactName
    }

    return Product.findOne({
        name: { $regex: botProductName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }
    })
}

/**
 * Проверяет остаток товара на складе перед оформлением заказа.
 *
 * @param {string} productName — ключ товара из бота (user.product)
 * @param {number} requestedQty — запрошенное количество
 * @returns {Promise<{ status: string, availableQty: number, product: object|null, error?: string }>}
 */
export async function checkProductStock(productName, requestedQty) {
    try {
        const product = await findProductInDb(productName)

        if (!product) {
            return {
                status: STOCK_STATUS.NOT_FOUND,
                availableQty: 0,
                product: null
            }
        }

        const availableQty = product.qty ?? 0

        if (availableQty <= 0) {
            return {
                status: STOCK_STATUS.OUT_OF_STOCK,
                availableQty: 0,
                product
            }
        }

        if (availableQty >= requestedQty) {
            return {
                status: STOCK_STATUS.AVAILABLE,
                availableQty,
                product
            }
        }

        return {
            status: STOCK_STATUS.PARTIAL,
            availableQty,
            product
        }
    } catch (error) {
        console.error("stockCheck error:", error)
        return {
            status: STOCK_STATUS.ERROR,
            availableQty: 0,
            product: null,
            error: error.message
        }
    }
}
