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
import { fileURLToPath } from "url"

import Order from "./models/Order.js"
import Client from "./models/Client.js"
import Log from "./models/Log.js"
import clientsRouter from "./routes/clients.js"


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
// USERS
// ============================================================

const USERS = [
    {
        username: "admin",   // Нуртуган 
        password: "osco_00",
        role: "owner"
    },

    {
        username: "cashier1",  // Женисбек
        password: "osco_01",
        role: "cashier"
    }
]


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

app.post("/login", (req, res) => {

    const { username, password } = req.body

    const user = USERS.find(u =>
        u.username === username &&
        u.password === password
    )

    if (!user) {
        return res.send("❌ Неверный логин или пароль")
    }

    req.session.user = user

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
// ORDERS API
// ============================================================

app.get("/orders", checkAuth, async (req, res) => {

    const { date } = req.query

    let filter = {
        status: { $ne: "ожидание" }
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

app.post("/confirm-order/:id", checkAuth, async (req, res) => {

    const order = await Order.findById(req.params.id)

    if (!order) {
        return res.status(404).json({
            error: "Заказ не найден"
        })
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
`✅ Оплата подтверждена!

Ваш заказ принят.
Код заказа: ${order.orderCode}`

        })
    }
)

const telegramData = await telegramResponse.json()

console.log(telegramData)

    await Order.findByIdAndUpdate(
        req.params.id,
        {
            status: "оплачено"
        }
    )

    await Log.create({

        user: req.session.user.username,

        action: "Подтвердил оплату",

        orderId: order.orderCode

    })

    res.json({
        success: true
    })

})

// =======================
// REJECT ORDER
// =======================
app.post("/reject-order/:id", checkAuth, async (req, res) => {

    const order = await Order.findById(req.params.id)

    if (!order) {
        return res.status(404).json({
            error: "Заказ не найден"
        })
    }
    console.log("REJECT ORDER:", order)
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

    await Order.findByIdAndUpdate(
        req.params.id,
        {
            status: "отклонено"
        }
    )

    await Log.create({

        user: req.session.user.username,

        action: "Отклонил заказ",

        orderId: order.orderCode

    })

    res.json({
        success: true
    })

})




// ============================================================
// ISSUE ORDER
// ============================================================

app.post("/issue-order/:id", checkAuth, async (req, res) => {

    const order = await Order.findById(req.params.id)

    if (!order) {
        return res.status(404).json({
            error: "Заказ не найден"
        })
    }

    await Order.findByIdAndUpdate(
        req.params.id,
        {
            status: "выдано"
        }
    )

    await Log.create({

        user: req.session.user.username,

        action: "Выдал заказ",

        orderId: order.orderCode

    })

    res.json({
        success: true
    })

})




// ============================================================
// REFUND ORDER
// ============================================================

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

        await Order.findByIdAndUpdate(

            req.params.id,

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
                new: true
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