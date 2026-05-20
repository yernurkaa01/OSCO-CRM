import "dotenv/config"
import { Telegraf, Markup } from "telegraf"
import mongoose from "mongoose"
import Order from "./models/Order.js"


console.log("SERVER URI:", process.env.MONGO_URI)
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB подключен"))
    .catch(err => console.log(err))

const bot = new Telegraf(process.env.BOT_TOKEN)

const CHECKS_CHAT_ID = "-5164072787"

// --- запрет заказов в чате чеков ---
function isChecksChat(ctx) {
    return String(ctx.chat.id) === CHECKS_CHAT_ID
}

bot.command("id", (ctx) => {
    ctx.reply(`ID: ${ctx.chat.id}`)
})

const userData = {}

const PRICES = {
    "Цемент М450": 1600,
    "Цемент М500": 1700,
    "наружный краска": 800,
    "внутренный краска": 1000
}

function generateOrderCode() {
    return Math.floor(1000 + Math.random() * 9000).toString()
}

// ---- START ----
bot.start((ctx) => {
    if (isChecksChat(ctx)) return ctx.reply("Этот чат только для чеков ✅")

    ctx.reply(
        "Ернұржанға қош келдіңіз \nТоварды таңдаңыз:",
        Markup.keyboard([["Цемент", "Краска"], ["Сухие смеси"]]).resize()
    )
})

// ---- Выбор цемента ----
bot.hears("Цемент", (ctx) => {
    if (isChecksChat(ctx)) return

    ctx.reply(
        "Выберите марку цемента:",
        Markup.keyboard([["М450 - 1600тг", "М500 - 1700тг"]]).resize()
    )
})

// ---- Выбор краски ----
bot.hears("Краска", (ctx) => {
    if (isChecksChat(ctx)) return

    ctx.reply(
        "Выберите тип краски:",
        Markup.keyboard([["наружный - 800тг (1л)", "внутренный - 1000тг (1л)"]]).resize()
    )
})

// ---- Когда выбрали цемент ----
bot.hears(["М450 - 1600тг", "М500 - 1700тг"], (ctx) => {
    if (isChecksChat(ctx)) return

    const text = ctx.message.text
    let product = ""

    if (text === "М450 - 1600тг") product = "Цемент М450"
    if (text === "М500 - 1700тг") product = "Цемент М500"

    userData[ctx.from.id] = {
        product,
        fullText: text,
        price: PRICES[product],
        unit: "мешков",
        step: "count"
    }

    ctx.reply(`Сколько мешков ${text} нужно?`, Markup.removeKeyboard())
})

// ---- Когда выбрали краску ----
bot.hears(["наружный - 800тг (1л)", "внутренный - 1000тг (1л)"], (ctx) => {
    if (isChecksChat(ctx)) return

    const text = ctx.message.text
    let product = ""

    if (text.includes("наружный")) product = "наружный краска"
    if (text.includes("внутренный")) product = "внутренный краска"

    userData[ctx.from.id] = {
        product,
        fullText: text,
        price: PRICES[product],
        unit: "банок",
        step: "count"
    }

    ctx.reply(`Сколько ${text} нужно?`, Markup.removeKeyboard())
})


bot.on("photo", async (ctx) => {
    if (isChecksChat(ctx)) return

    const id = ctx.from.id
    const user = userData[id]

    if (!user || user.step !== "check") {
        return ctx.reply("Сначала оформите заказ и после оплаты отправьте чек.")
    }

    return ctx.reply("Отправьте чек из приложения Kaspi Bank")
})


// ---- PDF чек ----
bot.on("document", async (ctx) => {
    if (isChecksChat(ctx)) return

    const id = ctx.from.id
    const user = userData[id]

    if (!user || user.step !== "check") {
        return ctx.reply("Сначала оформите заказ и после оплаты отправьте чек.")
    }

    try {
        const code = generateOrderCode()
        const document = ctx.message.document

        await ctx.telegram.sendDocument(
            CHECKS_CHAT_ID,
            document.file_id,
            {
                caption:
`🧾 Новый чек (PDF)

📦 Код: ${code}
👤 ${user.name}
🛒 ${user.product}
🔢 ${user.count}
💰 ${user.count * user.price} тг

🆔 ID: ${id}`,
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "✅ Подтвердить",
                                callback_data: `confirm_${code}_${id}`
                            },
                            {
                                text: "❌ Отклонить",
                                callback_data: `reject_${code}_${id}`
                            }
                        ]
                    ]
                }
            }
        )

        await Order.create({
    orderCode: code,
    product: user.product,
    count: user.count,

    name: user.name,
    phone: user.phone,
    username: user.username,

    telegramId: id,

    totalPrice: user.count * user.price,
    status: "ожидание"
})

        await ctx.reply("✅ Чек получен. Ожидайте подтверждения оплаты.")

        delete userData[id]

    } catch (e) {
        console.log(e)
        ctx.reply("❌ Ошибка отправки чека")
    }
})

// ---- Текстовый сценарий ----
bot.on("text", async (ctx) => {

    if (isChecksChat(ctx)) return

    const text = ctx.message.text.trim()

    const id = ctx.from.id

    const user = userData[id]


    // ---- если заказа нет ----
    if (!user) {

        return ctx.reply(
            "Выберите товар:",
            Markup.keyboard([
                ["Цемент", "Краска"],
                ["Сухие смеси"]
            ]).resize()
        )

    }


    // ---- количество ----
    if (user.step === "count") {

        const count = Number(text)

        if (isNaN(count) || count <= 0) {
            return ctx.reply("Введите корректное количество:")
        }

        user.count = count

        user.step = "confirm"

        return ctx.reply(

            `Ваш заказ:\n` +
            `${user.product} — ${user.count} ${user.unit}\n` +
            `Общая сумма: ${(user.count * user.price).toLocaleString("ru-RU")} ₸\n\n` +
            `Подтвердить?`,

            Markup.keyboard([
                ["Да", "Нет"]
            ]).resize()

        )

    }


    // ---- подтверждение ----
    if (user.step === "confirm") {

        if (text.toLowerCase() === "да") {

            user.step = "name"

            return ctx.reply(
                "Введите ваше имя:",
                Markup.removeKeyboard()
            )

        }

        if (text.toLowerCase() === "нет") {

            delete userData[id]

            return ctx.reply("Заказ отменен.")

        }

        return ctx.reply("Нажмите 'Да' или 'Нет'")

    }


    // ---- имя ----
    if (user.step === "name") {

        if (text.length < 2) {
            return ctx.reply("Введите корректное имя:")
        }

        user.name = text

        user.step = "phone"

        return ctx.reply("Введите номер телефона:")

    }


    // ---- телефон ----
    if (user.step === "phone") {

        user.phone = text

        user.username = ctx.from.username || ""

        user.step = "payment"

        return ctx.reply(

            `Каспи номер: 8 777 656 96 66\n` +
            `Имя владельца: Нұртуған\n\n` +
            `После оплаты напишите: оплатил`

        )

    }


    // ---- ожидание оплаты ----
    if (user.step === "payment") {

        if (text.toLowerCase() === "оплатил") {

            user.step = "check"

            return ctx.reply(
                "📄 Отправьте PDF чек из приложения Kaspi Bank"
            )

        }

        return ctx.reply(
            "После оплаты напишите: оплатил"
        )

    }

})

// ---- Подтверждение ----
bot.action(/confirm_(.+)_(.+)/, async (ctx) => {
    const code = ctx.match[1]
    const clientId = ctx.match[2]

    try {
        await Order.updateOne(
            { orderCode: code },
            { status: "оплачено" }
        )

        await ctx.telegram.sendMessage(
            clientId,
            `✅ Оплата подтверждена!\nВаш заказ принят.\nКод заказа: ${code}`
        )

        await ctx.editMessageCaption(
            ctx.callbackQuery.message.caption + "\n\n✅ ОПЛАТА ПОДТВЕРЖДЕНА",
            { reply_markup: { inline_keyboard: [] } }
        )

        await ctx.answerCbQuery("Подтверждено")

    } catch (e) {
        console.log(e)
        await ctx.answerCbQuery("Ошибка")
    }
})

// ---- Отклонение ----
bot.action(/reject_(.+)_(.+)/, async (ctx) => {
    const code = ctx.match[1]
    const clientId = ctx.match[2]

    try {
        await Order.updateOne(
            { orderCode: code },
            { status: "отклонено" }
        )

        await ctx.telegram.sendMessage(
            clientId,
            `❌ Оплата не подтверждена`
        )

        await ctx.editMessageCaption(
            ctx.callbackQuery.message.caption + "\n\n❌ ОПЛАТА ОТКЛОНЕНА",
            { reply_markup: { inliчne_keyboard: [] } }
        )

        await ctx.answerCbQuery("Отклонено")

    } catch (e) {
        console.log(e)
        await ctx.answerCbQuery("Ошибка")
    }
})

bot.launch()
console.log("Бот работает 🚀")