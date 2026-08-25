import Product from "../models/Product.js"

export const STOCK_STATUS = {
    OK: "OK",
    PARTIAL: "PARTIAL",
    OUT_OF_STOCK: "OUT_OF_STOCK",
    NOT_FOUND: "NOT_FOUND",
    ERROR: "ERROR"
}

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

export async function reserveStock(productName, qty) {
    try {
        const result = await Product.findOneAndUpdate(
            { name: productName, $expr: { $gte: [{ $subtract: ["$qty", "$reservedQty"] }, qty] } },
            { $inc: { reservedQty: qty } },
            { returnDocument: "after" }
        )
        return !!result
    } catch (error) {
        console.error("Ошибка при резервировании:", error)
        return false
    }
}

export async function releaseStock(productName, qty) {
    try {
        await Product.updateOne({ name: productName }, { $inc: { reservedQty: -qty } })
        await Product.updateOne({ name: productName, reservedQty: { $lt: 0 } }, { $set: { reservedQty: 0 } })
        return true
    } catch (error) {
        console.error("Ошибка при освобождении резерва:", error)
        return false
    }
}

export async function finalizeStock(productName, qty) {
    try {
        await Product.updateOne({ name: productName }, { $inc: { qty: -qty, reservedQty: -qty } })
        await Product.updateOne({ name: productName, reservedQty: { $lt: 0 } }, { $set: { reservedQty: 0 } })
        return true
    } catch (error) {
        console.error("Ошибка при списании остатков:", error)
        return false
    }
}

export async function restockStock(productName, qty) {
    try {
        await Product.updateOne({ name: productName }, { $inc: { qty: qty } })
        return true
    } catch (error) {
        console.error("Ошибка при возврате остатков:", error)
        return false
    }
}

export async function sellStock(productCode, qty) {
    try {
        const result = await Product.findOneAndUpdate(
            { code: productCode, $expr: { $gte: [{ $subtract: ["$qty", "$reservedQty"] }, qty] } },
            { $inc: { qty: -qty } },
            { returnDocument: "after" }
        )
        return !!result
    } catch (error) {
        console.error("Ошибка при мгновенной продаже:", error)
        return false
    }
}
