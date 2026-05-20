// ============================================================
// routes/clients.js — API МАРШРУТЫ ДЛЯ КЛИЕНТОВ
// Клиенты берутся напрямую из заказов (группировка по phone)
// ============================================================

const express = require("express")
const router  = express.Router()
const Order   = require("../models/Order")


// GET /clients — группируем заказы по телефону, получаем список клиентов
router.get("/", async (req, res) => {
    try {
        // Берём все заказы кроме "ожидание"
        const orders = await Order.find({ status: { $ne: "ожидание" } }).sort({ createdAt: 1 })

        // Группируем по phone (или по name если phone нет)
        const map = {}

        orders.forEach(o => {
            const key = String(o.telegramId || o.phone || o.name || "unknown")

            if (!map[key]) {
                map[key] = {
                    telegramId: o.telegramId || "-",
                    phone:       o.phone || "-",
                    name:        o.name  || "-",
                    firstOrder:  o.createdAt,
                    lastOrder:   o.createdAt,
                    totalOrders: 0,
                    totalSpent:  0,
                }
            }

            map[key].totalOrders++
            map[key].lastOrder = o.createdAt

            if (o.status === "оплачено" || o.status === "подтверждено") {
                map[key].totalSpent += Number(o.totalPrice || 0)
            }
        })

        // Сортируем по дате последнего заказа (новые первыми)
        const result = Object.values(map).sort((a, b) =>
            new Date(b.lastOrder) - new Date(a.lastOrder)
        )

        res.json(result)

    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Ошибка сервера" })
    }
})


// GET /clients/:phone/orders — все заказы клиента по телефону или имени
router.get("/:key/orders", async (req, res) => {
    try {
        const key = decodeURIComponent(req.params.key)

        // Ищем по phone, если не нашли — по name
        let orders = await Order.find({ telegramId: key }).sort({ createdAt: -1 })

        if (!orders.length) {
            orders = await Order.find({ name: key }).sort({ createdAt: -1 })
        }

        res.json(orders)

    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Ошибка сервера" })
    }
})


module.exports = router