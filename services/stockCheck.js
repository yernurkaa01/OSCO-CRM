import Product from "../models/Product.js"

export const STOCK_STATUS = {
    OK: "OK",
    PARTIAL: "PARTIAL",
    OUT_OF_STOCK: "OUT_OF_STOCK",
    NOT_FOUND: "NOT_FOUND",
    ERROR: "ERROR"
}

/**
 * Информационная проверка наличия — НЕ резервирует товар, просто
 * показывает клиенту, сколько реально доступно (qty - reservedQty)
 * на данный момент. Используется при вводе количества, до подтверждения
 * всей корзины.
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

        const availableQty = Math.max(0, product.qty - (product.reservedQty || 0))

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
 * Атомарно резервирует товар — увеличивает reservedQty, но ТОЛЬКО если
 * на этот момент реально доступно (qty - reservedQty) >= requestedQty.
 * Проверка условия и захват резерва происходят одной неделимой операцией
 * на уровне MongoDB — это и есть защита от гонки состояний (race condition),
 * когда два клиента одновременно пытаются купить последний остаток.
 *
 * Вызывать в момент финального подтверждения заказа клиентом
 * ("Подтвердить заказ? -> Да"), а не раньше.
 *
 * @param {string} productName
 * @param {number} qty
 * @returns {Promise<boolean>} true — резерв захвачен, false — не хватило
 */
export async function reserveStock(productName, qty) {
    try {
        const result = await Product.findOneAndUpdate(
            {
                name: productName,
                $expr: { $gte: [{ $subtract: ["$qty", "$reservedQty"] }, qty] }
            },
            { $inc: { reservedQty: qty } },
            { new: true }
        )

        return !!result

    } catch (error) {
        console.error("Ошибка при резервировании:", error)
        return false
    }
}

/**
 * Освобождает ранее зарезервированное количество — вызывать при отмене
 * заказа клиентом, отклонении менеджером, или истечении таймаута ожидания
 * оплаты. Не даёт reservedQty уйти в минус (на случай двойного вызова).
 * @param {string} productName
 * @param {number} qty
 */
export async function releaseStock(productName, qty) {
    try {
        await Product.updateOne(
            { name: productName },
            { $inc: { reservedQty: -qty } }
        )

        // Подстраховка: если из-за гонки/повторного вызова reservedQty
        // ушёл в минус — поджимаем обратно к нулю.
        await Product.updateOne(
            { name: productName, reservedQty: { $lt: 0 } },
            { $set: { reservedQty: 0 } }
        )

        return true

    } catch (error) {
        console.error("Ошибка при освобождении резерва:", error)
        return false
    }
}

/**
 * Превращает резерв в постоянное списание — вызывать ТОЛЬКО когда
 * менеджер подтвердил оплату заказа в CRM. Уменьшает qty и reservedQty
 * одновременно одной атомарной операцией.
 * @param {string} productName
 * @param {number} qty
 */
export async function finalizeStock(productName, qty) {
    try {
        await Product.updateOne(
            { name: productName },
            { $inc: { qty: -qty, reservedQty: -qty } }
        )

        // Подстраховка от ухода в минус
        await Product.updateOne(
            { name: productName, reservedQty: { $lt: 0 } },
            { $set: { reservedQty: 0 } }
        )

        return true

    } catch (error) {
        console.error("Ошибка при списании остатков:", error)
        return false
    }
}

/**
 * Возвращает физический товар на склад — вызывать при возврате денег
 * клиенту после того, как заказ уже был подтверждён и списан.
 * reservedQty НЕ трогаем — резерв уже был снят в момент finalizeStock.
 * @param {string} productName
 * @param {number} qty
 */
export async function restockStock(productName, qty) {
    try {
        await Product.updateOne(
            { name: productName },
            { $inc: { qty: qty } }
        )
        return true

    } catch (error) {
        console.error("Ошибка при возврате остатков:", error)
        return false
    }
}