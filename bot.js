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

// ---- Фото (чек) ----
bot.on("photo", async (ctx) => {
    if (isChecksChat(ctx)) return

    const id = ctx.from.id
    const user = userData[id]

    if (!user || user.step !== "check") {
        return ctx.reply("Сначала оформите заказ и после оплаты отправьте чек.")
    }

    return ctx.reply("Отправьте PDF чек из приложения Kaspi Bank")
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
📞 ${user.phone}

🛒 ${user.product}
🔢 ${user.count}

💰 ${user.count * user.price} тг

🆔 ID: ${id}`
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
            receiptFileId: document.file_id,
            status: "ожидание"
        })

        await ctx.reply("✅ Чек получен. Ожидайте подтверждения оплаты.")
        delete userData[id]

    } catch (e) {
        console.log(e)
        ctx.reply("❌ Ошибка отправки чека")
    }
})

// ---- Кнопка "Поделиться номером" — контакт ----
bot.on("contact", (ctx) => {
    if (isChecksChat(ctx)) return

    const id = ctx.from.id
    const user = userData[id]

    if (!user || user.step !== "phone_choice") return

    user.phone = ctx.message.contact.phone_number
    user.username = ctx.from.username || ""
    user.step = "check"

    return ctx.reply(
        `Каспи номер: 8 777 656 96 66\n` +
        `Имя владельца: Нұртуған\n\n` +
        `📄 После оплаты отправьте PDF чек из приложения Kaspi Bank`,
        Markup.removeKeyboard()
    )
})

// ---- Кнопка "Ввести вручную" ----
bot.hears("✍️ Ввести вручную", (ctx) => {
    if (isChecksChat(ctx)) return

    const user = userData[ctx.from.id]
    if (!user) return

    user.step = "phone_manual"

    return ctx.reply(
        "Введите номер телефона:\nПример:\n87071234567\nили\n+77071234567",
        Markup.removeKeyboard()
    )
})

// ---- Валидация номера телефона ----
function validatePhone(phone) {
    // Убираем пробелы
    phone = phone.trim()

    // Разрешены только цифры и + в начале
    if (!/^[\+\d]+$/.test(phone)) return null

    // Формат +7XXXXXXXXXX (12 символов)
    if (/^\+7\d{10}$/.test(phone)) return phone

    // Формат 8XXXXXXXXXX (11 цифр)
    if (/^8\d{10}$/.test(phone)) return phone

    return null
}

function isRepeatingDigits(phone) {
    // Убираем + и 7/8 в начале, проверяем оставшиеся 10 цифр
    const digits = phone.replace(/^\+7|^8/, "")
    // Все одинаковые цифры: 0000000000, 1111111111 и т.д.
    if (/^(\d)\1{9}$/.test(digits)) return true
    // Слишком короткая последовательность типа 89779 (уже отсеяна длиной)
    return false
}

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
            Markup.keyboard([["Цемент", "Краска"], ["Сухие смеси"]]).resize()
        )
    }

    // ---- количество ----
    if (user.step === "count") {
        const count = Number(text)

        if (isNaN(count) || count <= 0 || !Number.isInteger(count)) {
            return ctx.reply("Введите корректное количество (целое число):")
        }

        user.count = count
        user.step = "confirm"

        return ctx.reply(
            `Ваш заказ:\n` +
            `${user.product} — ${user.count} ${user.unit}\n` +
            `Общая сумма: ${(user.count * user.price).toLocaleString("ru-RU")} ₸\n\n` +
            `Подтвердить?`,
            Markup.keyboard([["Да", "Нет"]]).resize()
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
            return ctx.reply(
                "Заказ отменен.",
                Markup.keyboard([["Цемент", "Краска"], ["Сухие смеси"]]).resize()
            )
        }

        return ctx.reply("Нажмите 'Да' или 'Нет'")
    }

    // ---- имя ----
    if (user.step === "name") {
        // Только буквы (кириллица, латиница), пробелы и дефис
        if (!/^[а-яА-ЯёЁa-zA-Z\s\-]{2,}$/.test(text)) {
            return ctx.reply(
                "❌ Введите корректное имя (только буквы)"
            )
        }

        user.name = text
        user.step = "phone_choice"

        return ctx.reply(
    `Введите ваш номер телефона:\n\n` +
    `📱 Если нажмёте "Поделиться номером" — Telegram покажет стандартное предупреждение. Это нормально, не пугайтесь 🙂\n\n` +
    `Ваш номер сохраняется только в базе нашего магазина и используется исключительно для связи по заказу. Мы никому его не передаём.`,
    Markup.keyboard([
        [Markup.button.contactRequest("📱 Поделиться номером")],
        ["✍️ Ввести вручную"]
    ]).resize().oneTime()
)
    }

    // ---- телефон вручную ----
    if (user.step === "phone_manual") {
        const validPhone = validatePhone(text)

        if (!validPhone) {
            return ctx.reply(
                "❌ Неверный формат номера.\n\n" +
                "Введите 11-значный номер начиная с 8:\n87071234567\n\n" +
                "Или 12-значный начиная с +7:\n+77071234567\n\n" +
                "Только цифры, никаких букв и лишних символов."
            )
        }

        if (isRepeatingDigits(validPhone)) {
            return ctx.reply(
                "❌ Укажите настоящий номер телефона.\n\n" +
                "Введите корректный номер:"
            )
        }

        user.phone = validPhone
        user.username = ctx.from.username || ""
        user.step = "check"

        return ctx.reply(
            `Каспи номер: 8 777 656 96 66\n` +
            `Имя владельца: Нұртуған\n\n` +
            `📄 После оплаты отправьте PDF чек из приложения Kaspi Bank`,
            Markup.removeKeyboard()
        )
    }
})

bot.launch()
console.log("Бот работает 🚀")