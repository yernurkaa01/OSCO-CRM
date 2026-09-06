// ============================================================
// server.js — OSCO SERVER
// ============================================================

import "dotenv/config"

import express from "express"
import mongoose from "mongoose"
import cors from "cors"
import path from "path"
import session from "express-session"
import OpenAI from "openai"
import fetch from "node-fetch"
import bcrypt from "bcryptjs"
import { fileURLToPath } from "url"

import Order from "./models/Order.js"
import Client from "./models/Client.js"
import Log from "./models/Log.js"
import User from "./models/User.js"
import clientsRouter from "./routes/clients.js"

import warehouseApiRouter from "./routes/warehouse.js"
import reportsApiRouter from "./routes/reports.js"
import employeesApiRouter from "./routes/employees.js"
import stockMovementsApiRouter from "./routes/stockMovements.js"
import assistantApiRouter from "./routes/assistant.js"
import bonusesApiRouter from "./routes/bonuses.js"
import orderLookupApiRouter from "./routes/orderLookup.js"
import sellerSalesApiRouter from "./routes/sellerSales.js"
import employeeSalesRouter from "./routes/employeeSales.js"
import { finalizeStock, releaseStock, restockStock, reserveStock } from "./services/stockCheck.js"



// ============================================================
// __dirname FIX FOR ES MODULES
// ============================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)


// ============================================================
// EXPRESS
// ============================================================

const app = express()

app.use(cors())

app.use(express.json())

app.use(express.urlencoded({ extended: true }))

app.use(express.static(path.join(__dirname, "public")))


// ============================================================
// SESSION
// ============================================================

app.use(session({
secret: "osco_super_secret_key",
resave: false,
saveUninitialized: false,

cookie: {
secure: false,
maxAge: 1000 * 60 * 60 * 24
    }
}))


// ============================================================
// USERS — теперь хранятся в базе (модель User), не здесь.
// Первоначальные учётки создаются один раз скриптом scripts/seedUsers.js
// ============================================================


// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function checkAuth(req, res, next) {

if (!req.session.user) {
return res.redirect("/login")
    }

next()
}

// Middleware для проверки роли "owner"
function ownerOnly(req, res, next) {

if (req.session.user.role !== "owner") {
return res.status(403).send("Нет доступа")
    }

next()

}


app.get("/", (req, res) => {
res.redirect("/login")
})


// ============================================================
// OPENAI
// ============================================================

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
})


// ============================================================
// MONGODB
// ============================================================

console.log("SERVER URI:", process.env.MONGO_URI)
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
console.log("✅ MongoDB подключен")
    })
    .catch(err => {
console.log("❌ MongoDB ошибка:", err)
    })


// ============================================================
// LOGIN PAGE
// ============================================================

app.get("/login", (req, res) => {

res.send(`
        <html>

        <body style="
            font-family: Arial;
            display:flex;
            justify-content:center;
            align-items:center;
            height:100vh;
            background:#f5f5f5;
        ">

            <form
                method="POST"
                action="/login"

                style="
                    background:white;
                    padding:30px;
                    border-radius:10px;
                    width:300px;
                    box-shadow:0 0 10px rgba(0,0,0,0.1);
                "
            >

                <h2>OSCO Login</h2>

                <input
                    name="username"
                    placeholder="Логин"

                    style="
                        width:100%;
                        padding:10px;
                        margin-bottom:10px;
                        box-sizing:border-box;
                    "
                />

                <input
                    type="password"
                    name="password"
                    placeholder="Пароль"

                    style="
                        width:100%;
                        padding:10px;
                        margin-bottom:10px;
                        box-sizing:border-box;
                    "
                />

                <button
                    style="
                        width:100%;
                        padding:10px;
                        background:black;
                        color:white;
                        border:none;
                        cursor:pointer;
                    "
                >
                    Войти
                </button>

            </form>

        </body>
        </html>
    `)

})


// ============================================================
// LOGIN POST
// ============================================================

app.post("/login", async (req, res) => {

const { username, password } = req.body

const user = await User.findOne({ username })

if (!user) {
return res.send("❌ Неверный логин или пароль")
    }

const passwordMatches = await bcrypt.compare(password, user.passwordHash)

if (!passwordMatches) {
return res.send("❌ Неверный логин или пароль")
    }

req.session.user = { username: user.username, role: user.role }

res.redirect("/admin")

})


// ============================================================
// LOGOUT
// ============================================================

app.get("/logout", (req, res) => {

req.session.destroy(() => {
res.redirect("/login")
    })

})


// ============================================================
// CHANGE PASSWORD PAGE
// ============================================================

app.get("/change-password", checkAuth, (req, res) => {

res.send(`
        <html>

        <body style="
            font-family: Arial;
            display:flex;
            justify-content:center;
            align-items:center;
            height:100vh;
            background:#f5f5f5;
        ">

            <form
                method="POST"
                action="/change-password"

                style="
                    background:white;
                    padding:30px;
                    border-radius:10px;
                    width:300px;
                    box-shadow:0 0 10px rgba(0,0,0,0.1);
                "
            >

                <h2>Смена пароля</h2>
                <p style="color:#888; font-size:13px; margin-top:-10px;">Вы вошли как: ${req.session.user.username}</p>

                <input
                    type="password"
                    name="oldPassword"
                    placeholder="Текущий пароль"

                    style="
                        width:100%;
                        padding:10px;
                        margin-bottom:10px;
                        box-sizing:border-box;
                    "
                />

                <input
                    type="password"
                    name="newPassword"
                    placeholder="Новый пароль"

                    style="
                        width:100%;
                        padding:10px;
                        margin-bottom:10px;
                        box-sizing:border-box;
                    "
                />

                <button
                    style="
                        width:100%;
                        padding:10px;
                        background:black;
                        color:white;
                        border:none;
                        cursor:pointer;
                    "
                >
                    Сохранить
                </button>

                <p style="text-align:center; margin-top:14px;">
                    <a href="/admin" style="color:#666; font-size:13px;">← Назад в админку</a>
                </p>

            </form>

        </body>
        </html>
    `)

})


// ============================================================
// CHANGE PASSWORD POST
// ============================================================

app.post("/change-password", checkAuth, async (req, res) => {

try {

const { oldPassword, newPassword } = req.body

if (!newPassword || newPassword.trim().length < 4) {
return res.send("❌ Новый пароль слишком короткий (минимум 4 символа). <a href='/change-password'>Назад</a>")
        }

const user = await User.findOne({ username: req.session.user.username })

if (!user) {
return res.send("❌ Пользователь не найден")
        }

const oldPasswordMatches = await bcrypt.compare(oldPassword, user.passwordHash)

if (!oldPasswordMatches) {
return res.send("❌ Текущий пароль указан неверно. <a href='/change-password'>Назад</a>")
        }

user.passwordHash = await bcrypt.hash(newPassword, 10)
await user.save()

await Log.create({
user: req.session.user.username,
action: "Сменил пароль",
orderId: "-"
        })

res.send("✅ Пароль изменён. <a href='/admin'>В админку</a>")

    } catch (err) {

console.error("CHANGE PASSWORD error:", err)
res.status(500).send("Ошибка смены пароля")

    }

})


// ============================================================
// ORDERS API
// ============================================================

app.get("/orders", checkAuth, async (req, res) => {

const { date } = req.query

let filter = {
status: { $nin: ["ожидание", "резерв"] }
    }

if (date) {

const start = new Date(date)

const end = new Date(date)

end.setDate(end.getDate() + 1)

filter.createdAt = {
$gte: start,
$lt: end
        }

    }

const orders = await Order.find(filter)
        .sort({ createdAt: -1 })

res.json(orders)

})


// ============================================================
// PENDING ORDERS
// ============================================================

app.get("/pending-orders", checkAuth, async (req, res) => {

const orders = await Order.find({
status: "ожидание"
    }).sort({ createdAt: -1 })

res.json(orders)

})

// ============================================================
// RECEIPT PDF
// ============================================================

app.get("/receipt/:fileId", checkAuth, async (req, res) => {

try {

const fileId = req.params.fileId

const telegramFile = await fetch(
`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
        )

const data = await telegramFile.json()
console.log(data)

const filePath = data.result.file_path

const fileUrl =
`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`

res.redirect(fileUrl)

    } catch (err) {

console.log(err)

res.status(500).send("Ошибка открытия PDF")

    }

})

// ============================================================
// CONFIRM ORDER
// ============================================================
// Резерв уже был захвачен ботом при подтверждении заказа клиентом.
// Здесь мы превращаем этот резерв в постоянное списание (qty и
// reservedQty уменьшаются одновременно через finalizeStock).

app.post("/confirm-order/:id", checkAuth, async (req, res) => {

const order = await Order.findById(req.params.id)

if (!order) {
return res.status(404).json({
error: "Заказ не найден"
        })
    }

// Находим ВСЕ товары этого заказа (они делят один orderCode),
// чтобы подтвердить их разом и отправить клиенту ОДНО сообщение,
// а не по одному на каждую позицию корзины.
const siblingOrders = await Order.find({
orderCode: order.orderCode,
telegramId: order.telegramId,
status: "ожидание"
    })

const ordersToConfirm = siblingOrders.length ? siblingOrders : [order]

for (const o of ordersToConfirm) {
await finalizeStock(o.product, o.count)
await Order.findByIdAndUpdate(o._id, { status: "оплачено" })
    }

const itemsList = ordersToConfirm
        .map(o => `🛒 ${o.product} — ${o.count} ${o.unit || 'шт'}.`)
        .join("\n")

const grandTotal = ordersToConfirm.reduce((acc, o) => acc + (o.totalPrice || 0), 0)

const telegramResponse = await fetch(
`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
    {
method: "POST",

headers: {
"Content-Type": "application/json"
        },

body: JSON.stringify({

chat_id: order.telegramId,

text:
`✅ Оплата подтверждена!

Ваш заказ принят.
Код заказа: ${order.orderCode}

${itemsList}

💰 Итого: ${grandTotal.toLocaleString("ru-RU")} ₸`

        })
    }
)

const telegramData = await telegramResponse.json()

console.log(telegramData)

await Log.create({

user: req.session.user.username,

action: `Подтвердил оплату (${ordersToConfirm.length} поз.)`,

orderId: order.orderCode

    })

res.json({
success: true
    })

})

// =======================
// REJECT ORDER
// =======================
// Заказ был в статусе "ожидание" — значит товар всё ещё зарезервирован
// (reservedQty увеличен) с момента подтверждения корзины клиентом.
// При отклонении нужно ОСВОБОДИТЬ этот резерв — товар возвращается
// в доступный пул для других клиентов, физический qty не трогаем.
app.post("/reject-order/:id", checkAuth, async (req, res) => {

const order = await Order.findById(req.params.id)

if (!order) {
return res.status(404).json({
error: "Заказ не найден"
        })
    }
console.log("REJECT ORDER:", order)

// Находим ВСЕ товары этого заказа (делят один orderCode) — отклоняем
// и освобождаем резерв разом, отправляем клиенту ОДНО сообщение.
const siblingOrders = await Order.find({
orderCode: order.orderCode,
telegramId: order.telegramId,
status: "ожидание"
    })

const ordersToReject = siblingOrders.length ? siblingOrders : [order]

for (const o of ordersToReject) {
await releaseStock(o.product, o.count)
await Order.findByIdAndUpdate(o._id, { status: "отклонено" })
    }

const telegramResponse = await fetch(
`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
        {
method: "POST",

headers: {
"Content-Type": "application/json"
            },

body: JSON.stringify({

chat_id: order.telegramId,

text:
`❌ Заказ отклонён.

Оплата не подтверждена.
Пожалуйста, проверьте чек и попробуйте снова.`

            })
        }
    )

const telegramData = await telegramResponse.json()

console.log(telegramData)

await Log.create({

user: req.session.user.username,

action: `Отклонил заказ (${ordersToReject.length} поз.)`,

orderId: order.orderCode

    })

res.json({
success: true
    })

})


// ============================================================
// RESTORE ORDER (отменить ошибочное отклонение)
// ============================================================
// Ситуация: кассир отклонил заказ (например, показалось, что сумма в
// чеке не совпадает), а потом выяснилось — по факту оплата была верной
// (например, проверили реальную банковскую выписку/приложение Kaspi,
// а не только скриншот от клиента). Нужно вернуть заказ в "оплачено".
//
// ВАЖНО: нельзя просто повторно вызвать /confirm-order — при отклонении
// releaseStock уже вернул товар в доступный остаток, и за прошедшее
// время его мог купить кто-то другой. Слепой finalizeStock без проверки
// увёл бы физический остаток в минус (пересорт/недостача на бумаге).
// Поэтому здесь СНАЧАЛА заново атомарно резервируем нужное количество
// (reserveStock сам проверит, действительно ли товар всё ещё в наличии),
// и только при успехе — превращаем это в постоянное списание.
app.post("/restore-order/:id", checkAuth, async (req, res) => {

    const order = await Order.findById(req.params.id)

    if (!order) {
        return res.status(404).json({ error: "Заказ не найден" })
    }

    if (order.status !== "отклонено") {
        return res.status(400).json({
            error: `Восстановить можно только отклонённый заказ (сейчас статус: "${order.status}")`
        })
    }

    // Находим ВСЕ позиции этого заказа (делят orderCode) — восстанавливаем
    // и уведомляем клиента разом, как и при подтверждении/отклонении.
    const siblingOrders = await Order.find({
        orderCode: order.orderCode,
        telegramId: order.telegramId,
        status: "отклонено"
    })
    const ordersToRestore = siblingOrders.length ? siblingOrders : [order]

    // Сначала пробуем зарезервировать ВСЕ позиции — если хоть одной не
    // хватает в наличии, откатываем то, что успели зарезервировать,
    // и сообщаем кассиру, что восстановить целиком нельзя.
    const reserved = []
    for (const o of ordersToRestore) {
        const ok = await reserveStock(o.product, o.count)
        if (!ok) {
            for (const done of reserved) {
                await releaseStock(done.product, done.count)
            }
            return res.status(409).json({
                error: `Недостаточно остатка, чтобы восстановить: "${o.product}" — товар мог быть продан кому-то ещё, пока заказ был отклонён.`
            })
        }
        reserved.push(o)
    }

    // Резерв на все позиции получен — превращаем в постоянное списание
    for (const o of ordersToRestore) {
        await finalizeStock(o.product, o.count)
        await Order.findByIdAndUpdate(o._id, { status: "оплачено" })
    }

    const itemsList = ordersToRestore
        .map(o => `🛒 ${o.product} — ${o.count} ${o.unit || 'шт'}.`)
        .join("\n")

    const grandTotal = ordersToRestore.reduce((acc, o) => acc + (o.totalPrice || 0), 0)

    try {
        await fetch(
            `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: order.telegramId,
                    text:
`✅ Ваш заказ восстановлен — оплата подтверждена!

Код заказа: ${order.orderCode}

${itemsList}

💰 Итого: ${grandTotal.toLocaleString("ru-RU")} ₸

Приносим извинения за путаницу.`
                })
            }
        )
    } catch (e) {
        console.log("Не удалось уведомить клиента о восстановлении заказа:", e.message)
    }

    await Log.create({
        user: req.session.user.username,
        action: `Восстановил ошибочно отклонённый заказ (${ordersToRestore.length} поз.)`,
        orderId: order.orderCode
    })

    res.json({ success: true })

})




// ============================================================
// ISSUE ORDER
// ============================================================
// Товар уже списан в момент confirm-order (finalizeStock) — здесь
// просто меняем статус, склад трогать не нужно.

app.post("/issue-order/:id", checkAuth, async (req, res) => {

const order = await Order.findById(req.params.id)

if (!order) {
return res.status(404).json({
error: "Заказ не найден"
        })
    }

// Находим ВСЕ товары этого заказа (делят один orderCode) и выдаём
// разом — одним кликом на любой строке, а не по одной позиции.
const siblingOrders = await Order.find({
orderCode: order.orderCode,
telegramId: order.telegramId,
status: "оплачено"
    })

const ordersToIssue = siblingOrders.length ? siblingOrders : [order]

for (const o of ordersToIssue) {
await Order.findByIdAndUpdate(o._id, { status: "выдано" })
    }

await Log.create({

user: req.session.user.username,

action: `Выдал заказ (${ordersToIssue.length} поз.)`,

orderId: order.orderCode

    })

res.json({
success: true
    })

})




// ============================================================
// REFUND ORDER
// ============================================================
// Заказ уже был оплачен и списан (finalizeStock уменьшил и qty,
// и reservedQty) — при возврате денег просто возвращаем физический
// товар обратно на склад. reservedQty трогать не нужно, резерв уже
// был снят при подтверждении оплаты.

app.post("/refund-order/:id", checkAuth, async (req, res) => {

const order = await Order.findById(req.params.id)

if (!order) {
return res.status(404).json({
error: "Заказ не найден"
        })
    }

await Order.findByIdAndUpdate(
req.params.id,
        {
status: "возврат"
        }
    )

// ⬇️ Возвращаем физический товар на склад
await restockStock(order.product, order.count)

await Log.create({

user: req.session.user.username,

action: "Возврат средств",

orderId: order.orderCode

    })

res.json({
success: true
    })

})

// ============================================================
// UPDATE COMMENT
// ============================================================

app.post("/update-comment/:id", checkAuth, async (req, res) => {

try {

const order = await Order.findById(req.params.id)

if (!order) {
return res.status(404).json({
error: "Заказ не найден"
            })
        }

// Комментарий относится ко всему заказу клиента, а не к одной
// конкретной позиции — сохраняем его сразу во все товары
// с тем же orderCode, чтобы он был виден в "Подробнее" на любом из них.
await Order.updateMany(
            {
orderCode: order.orderCode,
telegramId: order.telegramId
            },
            {
comment: req.body.comment
            }
        )

res.json({
success: true
        })

    } catch (err) {

console.log(err)

res.status(500).json({
error: "Ошибка сохранения комментария"
        })

    }

})

// ============================================================
// LOGS
// ============================================================

app.get("/logs", checkAuth, ownerOnly, async (req, res) => {

const logs = await Log.find()
        .sort({ createdAt: -1 })

res.json(logs)

})



// ============================================================
// CLIENTS ROUTER
// ============================================================

app.use("/clients", checkAuth, clientsRouter)


// ============================================================
// SAVE CLIENT
// ============================================================

app.post("/save-client", async (req, res) => {

try {

const {
name,
phone,
username,
telegramId
        } = req.body

await Client.findOneAndUpdate(

            { phone },

            {
name,
phone,
username,
telegramId
            },

            {
upsert: true,
returnDocument: "after"
            }

        )

res.json({
success: true
        })

    } catch (err) {

console.error(err)

res.status(500).json({
error: "Ошибка сохранения клиента"
        })

    }

})


// ============================================================
// ADMIN PAGE
// ============================================================

app.get("/admin", checkAuth, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "admin.html")
    )

})


// ============================================================
// CLIENTS PAGE
// ============================================================

app.get("/admin/clients", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "clients.html")
    )

})


// ============================================================
// HISTORY PAGE
// ============================================================
app.get("/admin/history", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "history.html")
    )

})

// ============================================================
// WAREHOUSE PAGE
// ============================================================

app.get("/admin/warehouse", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "warehouse.html")
    )

})


// ============================================================
// REPORTS PAGE
// ============================================================

app.get("/admin/reports", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "reports.html")
    )

})


// ============================================================
// EMPLOYEES PAGE
// ============================================================

app.get("/admin/employees", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "employees.html")
    )

})


// ============================================================
// STOCK MOVEMENTS PAGE
// ============================================================

app.get("/admin/stock-movements", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "stock-movements.html")
    )

})


// ============================================================
// BONUSES PAGE
// ============================================================

app.get("/admin/bonuses", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "bonuses.html")
    )

})


// ============================================================
// ORDER LOOKUP PAGE
// ============================================================

app.get("/admin/order-lookup", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "order-lookup.html")
    )

})


// ============================================================
// SELLER SALES PAGE
// ============================================================

app.get("/admin/seller-sales", checkAuth, ownerOnly, (req, res) => {

res.sendFile(
path.join(__dirname, "views", "seller-sales.html")
    )

})


// ============================================================
// SELL PAGE (интерфейс продавцов — отдельный логин, БЕЗ checkAuth,
// у сотрудников своя отдельная сессия req.session.employee)
// ============================================================

app.get("/sell", (req, res) => {

res.sendFile(
path.join(__dirname, "views", "sell.html")
    )

})


// ============================================================
// WAREHOUSE API
// ============================================================

app.use("/admin", checkAuth, ownerOnly, warehouseApiRouter)


// ============================================================
// REPORTS API
// ============================================================

app.use("/admin", checkAuth, ownerOnly, reportsApiRouter)


// ============================================================
// EMPLOYEES API
// ============================================================

app.use("/admin", checkAuth, ownerOnly, employeesApiRouter)


// ============================================================
// STOCK MOVEMENTS API
// ============================================================

app.use("/admin", checkAuth, ownerOnly, stockMovementsApiRouter)


// ============================================================
// ASSISTANT API (внутренний AI-помощник по данным CRM)
// ============================================================

app.use("/admin", checkAuth, ownerOnly, assistantApiRouter)


// ============================================================
// BONUSES API
// ============================================================

app.use("/admin", checkAuth, ownerOnly, bonusesApiRouter)


// ============================================================
// ORDER LOOKUP API
// ============================================================

app.use("/admin", checkAuth, ownerOnly, orderLookupApiRouter)


// ============================================================
// SELLER SALES API
// ============================================================

app.use("/admin", checkAuth, ownerOnly, sellerSalesApiRouter)


// ============================================================
// EMPLOYEE SALES API (публичный — свой логин сотрудника, не админский)
// ============================================================

app.use("/", employeeSalesRouter)


// ============================================================
// AI
// ============================================================

app.post("/ai", checkAuth, async (req, res) => {

try {

const { message } = req.body

const ai = await openai.chat.completions.create({

model: "gpt-4.1-mini",

messages: [

                {
role: "system",
content: "Ты менеджер магазина стройматериалов. Отвечай кратко и по делу."
                },

                {
role: "user",
content: message
                }

            ]

        })

res.json({
reply: ai.choices[0].message.content
        })

    } catch (err) {

console.error("AI ERROR:", err)

res.status(500).json({
error: "Ошибка AI"
        })

    }

})


// ============================================================
// SERVER START
// ============================================================

const PORT = process.env.PORT || 3000

app.listen(PORT, "0.0.0.0", () => {

console.log("🚀 OSCO SERVER STARTED")

console.log(`🌍 PORT: ${PORT}`)


})