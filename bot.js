import "dotenv/config"
import { Telegraf, Markup } from "telegraf"
import mongoose from "mongoose"
import Order from "./models/Order.js"
import Product from "./models/Product.js"
import Category from "./models/category.js"
import { generateCatalogPdf } from "./services/generateCatalogPdf.js"
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

// Возвращает существующую сессию пользователя или создаёт новую с пустой корзиной.
function getOrCreateUser(id) {
    if (!userData[id]) {
        userData[id] = { cart: [] }
    }
    if (!userData[id].cart) {
        userData[id].cart = []
    }
    return userData[id]
}

// Если товаров в категории не больше этого числа — показываем кнопки.
// Если больше — присылаем текстовый список с кодами (чтобы не заваливать
// клавиатуру десятками кнопок).
const BUTTON_THRESHOLD = 8

function generateOrderCode() {
    return Math.floor(1000 + Math.random() * 9000).toString()
}

// ============================================================
// ЕДИНАЯ СИСТЕМА ТОВАРОВ — всё берётся из базы (Category + Product),
// хардкода цен/названий в этом файле больше нет.
// ============================================================

async function getCategories() {
    return Category.find().sort({ name: 1 })
}

async function getProductsInCategory(categoryName) {
    return Product.find({ category: categoryName }).sort({ name: 1 })
}

// Клавиатура главного меню — собирается из категорий в базе, по 2 в ряд
async function mainMenuKeyboard() {
    const categories = await getCategories()
    const names = categories.map(c => c.name)

    const rows = []
    for (let i = 0; i < names.length; i += 2) {
        rows.push(names.slice(i, i + 2))
    }

    return Markup.keyboard(rows).resize()
}

// Показывает товары выбранной категории — кнопками (если их немного)
// или текстовым списком с кодами (если много)
async function handleCategorySelected(ctx, user, categoryName) {
    const products = await getProductsInCategory(categoryName)

    if (products.length === 0) {
        user.step = null
        return ctx.reply(
            "В этой категории сейчас нет товаров. Выберите другую категорию.",
            await mainMenuKeyboard()
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

        // Резервный вариант — текстовый список, если PDF не сгенерировался
        const list = products
            .map(p => `${p.code || "—"} — ${p.name} — ${p.price.toLocaleString("ru-RU")} ₸/${p.unit}`)
            .join("\n")

        return ctx.reply(
            `Товары категории «${categoryName}»:\n\n${list}\n\nОтправьте код нужного товара, например: ${products[0].code || "A01"}`,
            Markup.removeKeyboard()
        )
    }
}

// Форматирует всю корзину: список товаров + общая сумма
function formatCartSummary(user) {
    let text = "🛒 *Ваша корзина:*\n\n"
    let total = 0

    user.cart.forEach((item, i) => {
        const sum = item.count * item.price
        total += sum
        text += `${i + 1}. ${item.product} — ${item.count} ${item.unit} = ${sum.toLocaleString("ru-RU")} ₸\n`
    })

    text += `\n💰 *Итого:* ${total.toLocaleString("ru-RU")} ₸`
    return text
}

// Кладёт текущий выбранный товар в корзину, очищает "текущий товар"
// и спрашивает, нужно ли добавить ещё один товар
async function addToCartAndAskMore(ctx, user) {
    user.cart.push({
        product: user.product,
        count: user.count,
        price: user.price,
        unit: user.unit
    })

    delete user.product
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

// Финальное подтверждение всей корзины перед вводом имени
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
            { parse_mode: "Markdown", ...(await mainMenuKeyboard()) }
        )
    }

    if (stock.status === STOCK_STATUS.NOT_FOUND || stock.status === STOCK_STATUS.OUT_OF_STOCK) {
        return ctx.reply(
            "😔 *Данный товар временно закончился*\n\n" +
            "🚚 Мы уже везём новую партию — ожидайте поступления в ближайшее время!\n\n" +
            "Выберите другой товар или зайдите позже 👇",
            { parse_mode: "Markdown", ...(await mainMenuKeyboard()) }
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
        `🏭 На складе: *${stock.availableQty}* ${unit}`,
        { parse_mode: "Markdown" }
    )
    return addToCartAndAskMore(ctx, user)
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

    if (!user || user.step !== "check" || !user.cart || user.cart.length === 0) {
        return ctx.reply("Сначала оформите заказ и после оплаты отправьте чек.")
    }

    try {
        const code = generateOrderCode()
        const document = ctx.message.document

        const itemsList = user.cart
            .map(item =>
                `🛒 ${item.product}\n🔢 ${item.count} ${item.unit} — ${(item.count * item.price).toLocaleString("ru-RU")} тг`
            )
            .join("\n\n")

        const grandTotal = user.cart.reduce((acc, item) => acc + item.count * item.price, 0)

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

${itemsList}

💰 Итого: ${grandTotal.toLocaleString("ru-RU")} тг

🆔 ID: ${id}`
            }
        )

        // Один заказ = несколько товаров, все делят один orderCode
        for (const item of user.cart) {
            await Order.create({
                orderCode: code,
                product: item.product,
                count: item.count,
                name: user.name,
                phone: user.phone,
                username: user.username,
                telegramId: id,
                totalPrice: item.count * item.price,
                receiptFileId: document.file_id,
                paymentBank: user.bank,
                status: "ожидание"
            })
        }

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

    // ---- Мы "в меню" — нет активной сессии, либо шаг сброшен (null) ----
    // Проверяем, не является ли сообщение выбором категории.
    if (!user || !user.step) {
        const categories = await getCategories()
        const match = categories.find(c => c.name === text)

        if (match) {
            const activeUser = getOrCreateUser(id)
            return handleCategorySelected(ctx, activeUser, match.name)
        }

        return ctx.reply("Выберите товар:", await mainMenuKeyboard())
    }

    // ---- выбор товара кнопкой (категория с небольшим числом позиций) ----
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
            return ctx.reply("❌ Товар не найден. Попробуйте выбрать заново.", await mainMenuKeyboard())
        }

        user.product = product.name
        user.price = product.price
        user.unit = product.unit
        user.step = "count"

        return ctx.reply(`Сколько нужно "${product.name}"?`, Markup.removeKeyboard())
    }

    // ---- выбор товара по коду (категория с большим числом позиций) ----
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
        user.price = product.price
        user.unit = product.unit
        user.step = "count"

        return ctx.reply(`Сколько нужно "${product.name}"?`)
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

    // ---- добавить ещё товар? ----
    if (user.step === "add_more") {
        if (text.toLowerCase() === "да") {
            user.step = null
            return ctx.reply("Выберите товар:", await mainMenuKeyboard())
        }

        if (text.toLowerCase() === "нет") {
            return proceedToOrderConfirm(ctx, user)
        }

        return ctx.reply(
            "Нажмите 'Да' или 'Нет'",
            Markup.keyboard([["Да", "Нет"]]).resize()
        )
    }

    // ---- подтверждение всего заказа ----
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
                await mainMenuKeyboard()
            )
        }

        return ctx.reply("Нажмите 'Да' или 'Нет'")
    }

    // ---- имя ----
    if (user.step === "name") {
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

    // ---- шаг не распознан ----
    return ctx.reply("Выберите товар:", await mainMenuKeyboard())
})

bot.launch()
console.log("Бот работает 🚀")