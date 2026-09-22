import "dotenv/config"
import { Telegraf, Markup } from "telegraf"
import mongoose from "mongoose"
import Order from "./models/Order.js"
import Product from "./models/Product.js"
import Category from "./models/category.js"
import { generateCatalogPdf } from "./services/generateCatalogPdf.js"
import {
    checkProductStock,
    reserveStock,
    releaseStock,
    STOCK_STATUS
} from "./services/stockCheck.js"

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB подключен"))
    .catch(err => console.log(err))

const bot = new Telegraf(process.env.BOT_TOKEN)

// Ловим необработанные сетевые/прочие ошибки, чтобы временный сбой
// (например, недоступность Telegram на секунду) не ронял весь процесс.
process.on("unhandledRejection", (err) => {
    console.error("⚠️ Необработанная ошибка (процесс продолжает работу):", err)
})

// Ловим ошибки внутри самих обработчиков Telegraf (bot.on/bot.hears и т.д.),
// чтобы одно упавшее сообщение не роняло весь polling-цикл бота для ВСЕХ клиентов сразу.
bot.catch((err, ctx) => {
    console.error(`Bot.js: ошибка при обработке сообщения от ${ctx.from?.id}:`, err)
    ctx.reply("⚠️ Кешіріңіз, қате шықты. Қайталап жазып көріңіз.").catch(() => {})
})

const CHECKS_CHAT_ID = "-5164072787"

// Сколько времени даём клиенту на оплату и отправку чека после того, как
// он подтвердил заказ (и товар был реально зарезервирован).
const RESERVATION_TIMEOUT_MS = 10 * 60 * 1000 // 10 минут

const FRACTIONAL_UNITS = ["кг", "kg", "л", "литр", "литра", "литров", "м", "м2", "м²", "м3", "м³"]
const WEIGHT_UNITS = ["кг", "kg"]

function isFractionalUnit(unit) {
    return FRACTIONAL_UNITS.includes(String(unit || "").trim().toLowerCase())
}

function isWeightUnit(unit) {
    return WEIGHT_UNITS.includes(String(unit || "").trim().toLowerCase())
}

function roundQty(n) {
    return Math.round(n * 100) / 100
}

function parseQuantity(rawText, unit) {
    const text = rawText.trim().toLowerCase().replace(",", ".")
    const fractional = isFractionalUnit(unit)
    const weight = isWeightUnit(unit)

    if (weight && /^(пол\s?кило|полкило|пол\s?кг|половина\s?кг|половина\s?кило)$/.test(text)) {
        return 0.5
    }
    if (weight && /^(четверть\s?кило|четверть\s?кг)$/.test(text)) {
        return 0.25
    }

    const gramsMatch = text.match(/^(\d+(?:\.\d+)?)\s*(г|гр|грамм|грамма|граммов)\.?$/)
    if (gramsMatch) {
        if (!weight) return null
        return roundQty(Number(gramsMatch[1]) / 1000)
    }

    const kgMatch = text.match(/^(\d+(?:\.\d+)?)\s*(кг|килограмм|килограмма|килограммов)\.?$/)
    if (kgMatch) {
        return roundQty(Number(kgMatch[1]))
    }

    if (/^\d+(?:\.\d+)?$/.test(text)) {
        const value = roundQty(Number(text))
        if (!Number.isInteger(value) && !fractional) return null
        return value
    }

    return null
}

function isChecksChat(ctx) {
    return String(ctx.chat.id) === CHECKS_CHAT_ID
}

bot.command("id", (ctx) => {
    ctx.reply(`ID: ${ctx.chat.id}`)
})

const userData = {}

function getOrCreateUser(id) {
    if (!userData[id]) {
        userData[id] = { cart: [] }
    }
    if (!userData[id].cart) {
        userData[id].cart = []
    }
    return userData[id]
}

const BUTTON_THRESHOLD = 8

function generateOrderCode() {
    return Math.floor(1000 + Math.random() * 9000).toString()
}

async function getCategories() {
    return Category.find().sort({ name: 1 })
}

async function getProductsInCategory(categoryName) {
    return Product.find({ category: categoryName }).sort({ code: 1 })
}

async function mainMenuKeyboard(user) {
    const categories = await getCategories()
    const names = categories.map(c => c.name)

    const rows = []
    for (let i = 0; i < names.length; i += 2) {
        rows.push(names.slice(i, i + 2))
    }

    if (user && user.cart && user.cart.length > 0) {
        rows.push(["✅ Оформить заказ"])
    }

    return Markup.keyboard(rows).resize()
}

async function handleCategorySelected(ctx, user, categoryName) {
    const products = await getProductsInCategory(categoryName)

    if (products.length === 0) {
        user.step = null
        return ctx.reply(
            "В этой категории сейчас нет товаров. Выберите другую категорию.",
            await mainMenuKeyboard(user)
        )
    }

    user.category = categoryName

    if (products.length <= BUTTON_THRESHOLD) {
        user.step = "product_select_button"

        const buttons = products.map(p =>
            [`${p.name} - ${p.price.toLocaleString("ru-RU")} тг`]
        )

        return ctx.reply(
            `Выберите товар (${categoryName}):`,
            Markup.keyboard(buttons).resize()
        )
    }

    user.step = "product_select_code"

    try {
        const pdfBuffer = await generateCatalogPdf(categoryName, products)

        return ctx.replyWithDocument(
            { source: pdfBuffer, filename: `catalog_${categoryName}.pdf` },
            {
                caption:
                    `📖 Каталог «${categoryName}» — актуальные цены и остатки.\n\n` +
                    `Отправьте код нужного товара, например: ${products[0].code || "S01"}`
            }
        )
    } catch (e) {
        console.log("Ошибка генерации PDF-каталога:", e)

        const list = products
            .map(p => `${p.code || "—"} — ${p.name} — ${p.price.toLocaleString("ru-RU")} ₸/${p.unit}`)
            .join("\n")

        return ctx.reply(
            `Товары категории «${categoryName}»:\n\n${list}\n\nОтправьте код нужного товара, например: ${products[0].code || "A01"}`,
            Markup.removeKeyboard()
        )
    }
}

function formatCartSummary(user) {
    let text = "🛒 *Ваша корзина:*\n\n"
    let total = 0

    user.cart.forEach((item, i) => {
        const sum = Math.round(item.count * item.price)
        total += sum
        text += `${i + 1}. ${item.product} — ${item.count} ${item.unit} = ${sum.toLocaleString("ru-RU")} ₸\n`
    })

    text += `\n💰 *Итого:* ${total.toLocaleString("ru-RU")} ₸`
    return text
}

async function addToCartAndAskMore(ctx, user) {
    user.cart.push({
        product: user.product,
        code: user.code,
        count: user.count,
        price: user.price,
        unit: user.unit
    })

    delete user.product
    delete user.code
    delete user.price
    delete user.unit
    delete user.count
    delete user.category

    user.step = "add_more"

    return ctx.reply(
        formatCartSummary(user) + "\n\nХотите добавить ещё один товар?",
        {
            parse_mode: "Markdown",
            ...Markup.keyboard([["Да", "Нет"]]).resize()
        }
    )
}

async function proceedToOrderConfirm(ctx, user) {
    user.step = "confirm"

    return ctx.reply(
        formatCartSummary(user) + "\n\nПодтвердить заказ?",
        {
            parse_mode: "Markdown",
            ...Markup.keyboard([["Да", "Нет"]]).resize()
        }
    )
}

async function handleStockCheck(ctx, user, requestedQty) {
    const stock = await checkProductStock(user.product, requestedQty)
    const unit = user.unit

    if (stock.status === STOCK_STATUS.ERROR) {
        return ctx.reply(
            "⚠️ *Не удалось проверить наличие товара*\n\n" +
            "Попробуйте ещё раз через минуту или свяжитесь с менеджером.",
            { parse_mode: "Markdown", ...(await mainMenuKeyboard(user)) }
        )
    }

    if (stock.status === STOCK_STATUS.NOT_FOUND || stock.status === STOCK_STATUS.OUT_OF_STOCK) {
        delete user.product
        delete user.price
        delete user.unit
        delete user.count
        user.step = null

        return ctx.reply(
            "😔 *Данный товар временно закончился*\n\n" +
            "🚚 Мы уже везём новую партию — ожидайте поступления в ближайшее время!\n\n" +
            "Выберите другой товар или зайдите позже 👇",
            { parse_mode: "Markdown", ...(await mainMenuKeyboard(user)) }
        )
    }

    if (stock.status === STOCK_STATUS.PARTIAL) {
        user.requestedCount = requestedQty
        user.availableCount = stock.availableQty
        user.step = "partial_confirm"

        return ctx.reply(
            `⚠️ *К сожалению, в таком количестве товара нет*\n\n` +
            `📦 Вы запросили: *${requestedQty}* ${unit}\n` +
            `✅ Сейчас доступно: *${stock.availableQty}* ${unit}\n\n` +
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
        `🏭 Доступно: *${stock.availableQty}* ${unit}`,
        { parse_mode: "Markdown" }
    )
    return addToCartAndAskMore(ctx, user)
}

async function reserveCart(cart) {
    const reserved = []

    for (const item of cart) {
        const ok = await reserveStock(item.product, item.count)

        if (!ok) {
            for (const done of reserved) {
                await releaseStock(done.product, done.count)
            }
            return { success: false, failedItem: item }
        }

        reserved.push(item)
    }

    return { success: true }
}

// ---- START ----
bot.start(async (ctx) => {
    if (isChecksChat(ctx)) return ctx.reply("Этот чат только для чеков ✅")

    delete userData[ctx.from.id]

    return ctx.reply(
        "Ернұржанға қош келдіңіз \nТоварды таңдаңыз:",
        await mainMenuKeyboard()
    )
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

    if (!user || user.step !== "check" || !user.orderCode) {
        return ctx.reply("Сначала оформите заказ и после оплаты отправьте чек.")
    }

    if (!user.reservationExpiresAt || Date.now() > user.reservationExpiresAt) {
        delete userData[id]
        return ctx.reply(
            "⏱️ К сожалению, время на оплату истекло, и резерв товара был снят.\n\n" +
            "Пожалуйста, оформите заказ заново.",
            await mainMenuKeyboard()
        )
    }

    try {
        const document = ctx.message.document

        const itemsList = user.cart
            .map(item =>
                `🛒 ${item.product}\n🔢 ${item.count} ${item.unit} — ${Math.round(item.count * item.price).toLocaleString("ru-RU")} тг`
            )
            .join("\n\n")

        const grandTotal = Math.round(user.cart.reduce((acc, item) => acc + item.count * item.price, 0))

        await ctx.telegram.sendDocument(
            CHECKS_CHAT_ID,
            document.file_id,
            {
                caption:
`🧾 Новый чек (PDF)

📦 Код: ${user.orderCode}
👤 ${user.name}
📞 ${user.phone}
🏦 ${user.bank}

${itemsList}

💰 Итого: ${grandTotal.toLocaleString("ru-RU")} тг

🆔 ID: ${id}`
            }
        )

        await Order.updateMany(
            { orderCode: user.orderCode, telegramId: id, status: "резерв" },
            {
                name: user.name,
                phone: user.phone,
                username: user.username,
                paymentBank: user.bank,
                receiptFileId: document.file_id,
                status: "ожидание"
            }
        )

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

    if (user.reservationExpiresAt && Date.now() > user.reservationExpiresAt) {
        delete userData[id]
        return ctx.reply(
            "⏱️ К сожалению, время на оформление заказа истекло, и резерв товара был снят.\n\n" +
            "Пожалуйста, оформите заказ заново."
        )
    }

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

function validatePhone(phone) {
    phone = phone.trim()
    if (!/^[\+\d]+$/.test(phone)) return null
    if (/^\+7\d{10}$/.test(phone)) return phone
    if (/^8\d{10}$/.test(phone)) return phone
    return null
}

function isRepeatingDigits(phone) {
    const digits = phone.replace(/^\+7|^8/, "")
    if (/^(\d)\1{9}$/.test(digits)) return true
    return false
}

// ---- Текстовый сценарий ----
bot.on("text", async (ctx) => {
    if (isChecksChat(ctx)) return

    const text = ctx.message.text.trim()
    const id = ctx.from.id
    const user = userData[id]

    if (!user || !user.step) {
        if (user && user.cart && user.cart.length > 0 && text === "✅ Оформить заказ") {
            return proceedToOrderConfirm(ctx, user)
        }

        const categories = await getCategories()
        const match = categories.find(c => c.name === text)

        if (match) {
            const activeUser = getOrCreateUser(id)
            return handleCategorySelected(ctx, activeUser, match.name)
        }

        return ctx.reply("Выберите товар:", await mainMenuKeyboard(user))
    }

    const STEPS_AFTER_RESERVATION = ["name", "phone_choice", "phone_manual", "bank_choice", "check"]

    if (STEPS_AFTER_RESERVATION.includes(user.step) && user.reservationExpiresAt && Date.now() > user.reservationExpiresAt) {
        delete userData[id]
        return ctx.reply(
            "⏱️ К сожалению, время на оформление заказа истекло, и резерв товара был снят.\n\n" +
            "Пожалуйста, оформите заказ заново.",
            await mainMenuKeyboard()
        )
    }

    if (user.step === "product_select_button") {
        const match = text.match(/^(.+) - [\d\s]+ тг$/)

        if (!match) {
            return ctx.reply("Пожалуйста, выберите товар с помощью кнопок ниже.")
        }

        const productName = match[1]

        let product
        try {
            product = await Product.findOne({ name: productName, category: user.category })
        } catch (e) {
            console.log("Ошибка поиска товара:", e)
            return ctx.reply("⚠️ Произошла ошибка. Попробуйте ещё раз.")
        }

        if (!product) {
            return ctx.reply("❌ Товар не найден. Попробуйте выбрать заново.", await mainMenuKeyboard(user))
        }

        user.product = product.name
        user.code = product.code
        user.price = product.price
        user.unit = product.unit
        user.step = "count"

        const hint = isFractionalUnit(product.unit)
            ? ` (например: 2.5 или 500г)`
            : ""

        return ctx.reply(`Сколько нужно "${product.name}"?${hint}`, Markup.removeKeyboard())
    }

    if (user.step === "product_select_code") {
        const code = text.toUpperCase()

        let product
        try {
            product = await Product.findOne({ code, category: user.category })
        } catch (e) {
            console.log("Ошибка поиска товара по коду:", e)
            return ctx.reply("⚠️ Произошла ошибка. Попробуйте ещё раз.")
        }

        if (!product) {
            return ctx.reply(
                "❌ Такого кода нет.\n\n" +
                "Проверьте код в списке выше и отправьте его ещё раз."
            )
        }

        user.product = product.name
        user.code = product.code
        user.price = product.price
        user.unit = product.unit
        user.step = "count"

        const hint = isFractionalUnit(product.unit)
            ? ` (например: 2.5 или 500г)`
            : ""

        return ctx.reply(`Сколько нужно "${product.name}"?${hint}`)
    }

    if (user.step === "count") {
        const count = parseQuantity(text, user.unit)

        if (count === null || count <= 0) {
            const errorHint = isFractionalUnit(user.unit)
                ? `Введите корректное количество, например: 2.5 или 500г`
                : `Введите корректное количество (целое число):`
            return ctx.reply(errorHint)
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
            return addToCartAndAskMore(ctx, user)
        }

        if (no) {
            delete user.requestedCount
            delete user.availableCount
            delete user.product
            delete user.price
            delete user.unit
            delete user.count

            if (user.cart.length > 0) {
                await ctx.reply("Этот товар не добавлен.")
                return proceedToOrderConfirm(ctx, user)
            }

            delete userData[id]
            return ctx.reply(
                "Заказ отменён. Выберите другой товар 👇",
                await mainMenuKeyboard()
            )
        }

        return ctx.reply("Нажмите «✅ Да, оформить» или «❌ Нет, отменить»")
    }

    if (user.step === "add_more") {
        if (text.toLowerCase() === "да") {
            user.step = null
            return ctx.reply("Выберите товар:", await mainMenuKeyboard(user))
        }

        if (text.toLowerCase() === "нет") {
            return proceedToOrderConfirm(ctx, user)
        }

        return ctx.reply(
            "Нажмите 'Да' или 'Нет'",
            Markup.keyboard([["Да", "Нет"]]).resize()
        )
    }

    if (user.step === "confirm") {
        if (text.toLowerCase() === "да") {
            const reserveResult = await reserveCart(user.cart)

            if (!reserveResult.success) {
                const failedName = reserveResult.failedItem.product

                user.cart = user.cart.filter(item => item.product !== failedName)

                await ctx.reply(
                    `😔 К сожалению, товар "${failedName}" уже разобрали, пока вы оформляли заказ.\n\n` +
                    `Он убран из корзины.`
                )

                if (user.cart.length > 0) {
                    return proceedToOrderConfirm(ctx, user)
                }

                delete userData[id]
                return ctx.reply(
                    "В корзине больше нет товаров. Выберите заново 👇",
                    await mainMenuKeyboard()
                )
            }

            const orderCode = generateOrderCode()
            user.orderCode = orderCode
            user.reservationExpiresAt = Date.now() + RESERVATION_TIMEOUT_MS

            for (const item of user.cart) {
                await Order.create({
                    orderCode,
                    product: item.product,
                    productCode: item.code,
                    count: item.count,
                    telegramId: id,
                    totalPrice: Math.round(item.count * item.price),
                    status: "резерв"
                })
            }

            user.step = "name"
            return ctx.reply(
                `✅ Заказ зарезервирован! У вас есть 10 минут, чтобы завершить оформление и оплату.\n\n` +
                `Введите ваше имя:`,
                Markup.removeKeyboard()
            )
        }

        if (text.toLowerCase() === "нет") {
            delete userData[id]
            return ctx.reply(
                "Заказ отменен.",
                await mainMenuKeyboard()
            )
        }

        return ctx.reply("Нажмите 'Да' или 'Нет'")
    }

    if (user.step === "name") {
        if (!/^[а-яА-ЯёЁa-zA-ZқҚөӨһҺәӘіІңҢғҒүҮұҰ\s\-]{2,}$/.test(text)) {
            return ctx.reply("❌ Введите корректное имя (только буквы)")
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

    if (user.step === "bank_choice") {
        if (text !== "Kaspi Bank" && text !== "Halyk Bank") {
            return ctx.reply(
                "Пожалуйста, выберите банк с помощью кнопок: Kaspi Bank или Halyk Bank",
                Markup.keyboard([["Kaspi Bank", "Halyk Bank"]]).resize().oneTime()
            )
        }

        user.bank = text
        user.step = "check"

        const cartList = user.cart
            .map(item => `${item.product} — ${item.count} ${item.unit}`)
            .join("\n")
        const grandTotal = Math.round(user.cart.reduce((acc, item) => acc + item.count * item.price, 0))

        try {
            await ctx.telegram.sendMessage(
                CHECKS_CHAT_ID,
                `💳 ТРЕБУЕТСЯ ВЫСТАВИТЬ СЧЁТ\n\n` +
                `👤 ${user.name}\n` +
                `📞 ${user.phone}\n` +
                `🏦 ${user.bank}\n\n` +
                `${cartList}\n\n` +
                `💰 Сумма: ${grandTotal.toLocaleString("ru-RU")} ₸\n\n` +
                `⏱️ Отправьте платёжный запрос на этот номер прямо сейчас — клиент уже ждёт счёт.`
            )
        } catch (e) {
            console.log("Не удалось уведомить о необходимости выставить счёт:", e.message)
        }

        const bankMessage = text === "Kaspi Bank"
            ? `⏳ Мы выставим вам счет в приложении Kaspi Bank в течение нескольких минут.\n\n` +
              `📱 Пожалуйста, перейдите в Kaspi.kz -> Сообщения -> Платежи и оплатите его.\n\n` +
              `📄 После оплаты отправьте PDF чек в этот чат.`
            : `⏳ Мы выставим вам счет в приложении Halyk Bank в течение нескольких минут.\n\n` +
              `📱 Пожалуйста, перейдите в Halyk Homebank -> Платежи и оплатите его.\n\n` +
              `📄 После оплаты отправьте PDF чек в этот чат.`

        return ctx.reply(bankMessage, Markup.removeKeyboard())
    }

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

    return ctx.reply("Выберите товар:", await mainMenuKeyboard(user))
})

// ============================================================
// ФОНОВАЯ ОЧИСТКА ПРОСРОЧЕННЫХ РЕЗЕРВОВ
// ============================================================
async function releaseExpiredReservations() {
    try {
        const expiredBefore = new Date(Date.now() - RESERVATION_TIMEOUT_MS)

        const expired = await Order.find({
            status: "резерв",
            createdAt: { $lt: expiredBefore }
        })

        const groups = new Map()

        for (const order of expired) {
            await releaseStock(order.product, order.count)
            await Order.findByIdAndUpdate(order._id, { status: "отменено (таймаут)" })
            console.log(`⏱️ Резерв освобождён по таймауту: ${order.product} x${order.count} (заказ ${order.orderCode})`)

            const key = `${order.telegramId}_${order.orderCode}`
            if (!groups.has(key)) {
                groups.set(key, { telegramId: order.telegramId, orderCode: order.orderCode })
            }
        }

        for (const { telegramId, orderCode } of groups.values()) {
            try {
                await bot.telegram.sendMessage(
                    telegramId,
                    `⏱️ Время на оплату заказа (код ${orderCode}) истекло, и резерв товара был автоматически снят.\n\n` +
                    `Если вы уже оплатили — пожалуйста, всё равно отправьте чек, мы разберёмся вручную.\n` +
                    `Если ещё не оплачивали — оформите заказ заново, нажав /start.`
                )
            } catch (e) {
                console.log(`Не удалось уведомить клиента ${telegramId} об истечении резерва:`, e.message)
            }

            const session = userData[telegramId]
            if (session && session.orderCode === orderCode) {
                delete userData[telegramId]
            }
        }
    } catch (e) {
        console.error("Ошибка очистки просроченных резервов:", e)
    }
}

setInterval(releaseExpiredReservations, 60 * 1000)

// ============================================================
// ЗАПУСК БОТА С АВТОМАТИЧЕСКИМИ ПОВТОРНЫМИ ПОПЫТКАМИ
// ============================================================
async function launchBotWithRetry(retryDelayMs = 10000) {
    try {
        await bot.launch()
        console.log("Бот работает 🚀")
    } catch (err) {
        console.error("Не удалось запустить бота, повтор через", retryDelayMs / 1000, "сек:", err.message)
        setTimeout(() => launchBotWithRetry(retryDelayMs), retryDelayMs)
    }
}

launchBotWithRetry()

// ============================================================
// ГРАЦЕФУЛ-ШАТДАУН
// Без этого блока при каждом деплое/рестарте Render старый процесс
// не успевает сказать Telegram "я закончил polling" — и Telegram ещё
// какое-то время считает, что бот занят старым соединением, из-за чего
// новый процесс получает 409 Conflict на bot.launch(). Эти два обработчика
// корректно останавливают polling ДО того как процесс убьют.
// ============================================================
process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))