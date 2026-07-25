import "dotenv/config"
import { Telegraf, Markup } from "telegraf"
import mongoose from "mongoose"
import Order from "./models/Order.js"
import { checkProductStock, STOCK_STATUS } from "./services/stockCheck.js"

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
    "Цемент (Гежуба) М450 (50 кг)": 2600,
    "Цемент (Аккерманн) М500 (1 т)": 48500,
    "Цемент (Аккерманн) М600 (1 т)": 50000,
    "наружный краска": 800,
    "внутренный краска": 1000
}

function generateOrderCode() {
    return Math.floor(1000 + Math.random() * 9000).toString()
}

const MAIN_MENU = Markup.keyboard([["Цемент", "Краска"], ["Сухие смеси"]]).resize()

function formatOrderSummary(user) {
    return (
        `📋 *Ваш заказ:*\n\n` +
        `🛒 ${user.product}\n` +
        `🔢 ${user.count} ${user.unit}\n` +
        `💰 *Итого:* ${(user.count * user.price).toLocaleString("ru-RU")} ₸\n\n` +
        `Подтвердить заказ?`
    )
}

async function proceedToOrderConfirm(ctx, user) {
    user.step = "confirm"

    return ctx.reply(formatOrderSummary(user), {
        parse_mode: "Markdown",
        ...Markup.keyboard([["Да", "Нет"]]).resize()
    })
}

async function handleStockCheck(ctx, user, requestedQty) {
    const stock = await checkProductStock(user.product, requestedQty)
    const unit = user.unit

    if (stock.status === STOCK_STATUS.ERROR) {
        return ctx.reply(
            "⚠️ *Не удалось проверить наличие товара*\n\n" +
            "Попробуйте ещё раз через минуту или свяжитесь с менеджером.",
            { parse_mode: "Markdown", ...MAIN_MENU }
        )
    }

    if (stock.status === STOCK_STATUS.NOT_FOUND || stock.status === STOCK_STATUS.OUT_OF_STOCK) {
        delete userData[ctx.from.id]
        return ctx.reply(
            "😔 *Данный товар временно закончился*\n\n" +
            "🚚 Мы уже везём новую партию — ожидайте поступления в ближайшее время!\n\n" +
            "Выберите другой товар или зайдите позже 👇",
            { parse_mode: "Markdown", ...MAIN_MENU }
        )
    }

    if (stock.status === STOCK_STATUS.PARTIAL) {
        user.requestedCount = requestedQty
        user.availableCount = stock.availableQty
        user.step = "partial_confirm"

        return ctx.reply(
            `⚠️ *К сожалению, в таком количестве товара нет*\n\n` +
            `📦 Вы запросили: *${requestedQty}* ${unit}\n` +
            `✅ Сейчас на складе: *${stock.availableQty}* ${unit}\n\n` +
            `Желаете оформить то, что есть?`,
            {
                parse_mode: "Markdown",
                ...Markup.keyboard([["✅ Да, оформить", "❌ Нет, отменить"]]).resize()
            }
        )
    }

    user.count = requestedQty
    await ctx.reply(
        `✅ *Товар в наличии!*\n\n` +
        `📦 ${user.product}\n` +
        `🔢 Запрошено: *${requestedQty}* ${unit}\n` +
        `🏭 На складе: *${stock.availableQty}* ${unit}\n\n` +
        `Переходим к оформлению заказа 👇`,
        { parse_mode: "Markdown" }
    )
    return proceedToOrderConfirm(ctx, user)
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
        "Выберите цемент:",
        Markup.keyboard([
            ["Цемент (Гежуба) М450 (50 кг) - 2600 тг"],
            ["Цемент (Аккерманн) М500 (1 т) - 48500 тг"],
            ["Цемент (Аккерманн) М600 (1 т) - 50000 тг"]
        ]).resize()
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
bot.hears([
    "Цемент (Гежуба) М450 (50 кг) - 2600 тг",
    "Цемент (Аккерманн) М500 (1 т) - 48500 тг",
    "Цемент (Аккерманн) М600 (1 т) - 50000 тг"
], (ctx) => {

    if (isChecksChat(ctx)) return

    const text = ctx.message.text
    let product = ""

    if (text === "Цемент (Гежуба) М450 (50 кг) - 2600 тг")
        product = "Цемент (Гежуба) М450 (50 кг)"

    if (text === "Цемент (Аккерманн) М500 (1 т) - 48500 тг")
        product = "Цемент (Аккерманн) М500 (1 т)"

    if (text === "Цемент (Аккерманн) М600 (1 т) - 50000 тг")
        product = "Цемент (Аккерманн) М600 (1 т)"

    userData[ctx.from.id] = {
        product,
        fullText: text,
        price: PRICES[product],
        unit: "шт",
        step: "count"
    }

    ctx.reply(
        `Сколько нужно "${product}"?`,
        Markup.removeKeyboard()
    )
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
🏦 ${user.bank}

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
            paymentBank: user.bank,
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
    user.step = "bank_choice"

    return ctx.reply(
        "Выберите удобный банк для оплаты:",
        Markup.keyboard([["Kaspi Bank", "Halyk Bank"]]).resize().oneTime()
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

    // ---- количество + проверка остатков на складе ----
    if (user.step === "count") {
        const count = Number(text)

        if (isNaN(count) || count <= 0 || !Number.isInteger(count)) {
            return ctx.reply("Введите корректное количество (целое число):")
        }

        try {
            return await handleStockCheck(ctx, user, count)
        } catch (error) {
            console.error("Ошибка проверки склада:", error)
            return ctx.reply(
                "⚠️ Произошла ошибка при проверке наличия. Попробуйте ещё раз."
            )
        }
    }

    // ---- частичное наличие: оформить доступное количество? ----
    if (user.step === "partial_confirm") {
        const yes = ["✅ да, оформить", "да, оформить", "да"].includes(text.toLowerCase())
        const no = ["❌ нет, отменить", "нет, отменить", "нет"].includes(text.toLowerCase())

        if (yes) {
            user.count = user.availableCount
            delete user.requestedCount
            delete user.availableCount

            await ctx.reply(
                `👍 Хорошо! Оформляем *${user.count}* ${user.unit}.`,
                { parse_mode: "Markdown" }
            )
            return proceedToOrderConfirm(ctx, user)
        }

        if (no) {
            delete userData[id]
            return ctx.reply(
                "Заказ отменён. Выберите другой товар 👇",
                MAIN_MENU
            )
        }

        return ctx.reply("Нажмите «✅ Да, оформить» или «❌ Нет, отменить»")
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
        if (!/^[а-яА-ЯёЁa-zA-ZқҚөӨһҺәӘіІңҢғҒүҮұҰ\s\-]{2,}$/.test(text)) {
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

    // ---- выбор банка ----
    if (user.step === "bank_choice") {
        if (text !== "Kaspi Bank" && text !== "Halyk Bank") {
            return ctx.reply(
                "Пожалуйста, выберите банк с помощью кнопок: Kaspi Bank или Halyk Bank",
                Markup.keyboard([["Kaspi Bank", "Halyk Bank"]]).resize().oneTime()
            )
        }

        user.bank = text
        user.step = "check"

        const bankMessage = text === "Kaspi Bank"
            ? `⏳ Мы выставим вам счет в приложении Kaspi Bank в течение минуты.\n\n` +
              `📱 Пожалуйста, перейдите в Kaspi.kz -> Сообщения -> Платежи и оплатите его.\n\n` +
              `📄 После оплаты отправьте PDF чек в этот чат.`
            : `⏳ Мы выставим вам счет в приложении Halyk Bank в течение минуты.\n\n` +
              `📱 Пожалуйста, перейдите в Halyk Homebank -> Платежи и оплатите его.\n\n` +
              `📄 После оплаты отправьте PDF чек в этот чат.`

        return ctx.reply(bankMessage, Markup.removeKeyboard())
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
        user.step = "bank_choice"

        return ctx.reply(
            "Выберите удобный банк для оплаты:",
            Markup.keyboard([["Kaspi Bank", "Halyk Bank"]]).resize().oneTime()
        )
    }
})

bot.launch()
console.log("Бот работает 🚀")