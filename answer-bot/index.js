// ============================================================
// answer-bot/index.js — БОТ-ОТВЕЧАТЕЛЬ
// Отвечает на вопросы: работает ли магазин, есть ли товар,
// сколько стоит. Прямой поиск + категории (кнопками) + AI для
// нечётких запросов. БЕЗ упоминания оформления заказа — только
// справочная информация.
// ============================================================

import "dotenv/config"
import { Telegraf, Markup } from "telegraf"
import mongoose from "mongoose"
import OpenAI from "openai"
import Product from "../models/Product.js"
import Category from "../models/category.js"
import { generateCatalogPdf } from "../services/generateCatalogPdf.js"

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Answer-bot: MongoDB подключен"))
    .catch(err => console.log("Answer-bot: ошибка MongoDB", err))

const bot = new Telegraf(process.env.ANSWER_BOT_TOKEN)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const CATEGORY_PAGE_SIZE = 6
// Если товаров в категории больше этого числа — сразу присылаем PDF со
// всем списком вместе с кнопками, а не заставляем клиента листать много
// страниц кнопками ради общего обзора ассортимента.
const LARGE_CATEGORY_THRESHOLD = 18

// Расписание работы по дням недели (0 = воскресенье, 1 = понедельник, ... 6 = суббота)
const SCHEDULE = {
    0: { open: 10, close: 16 },     // воскресенье
    1: { open: 9, close: 18.5 },    // понедельник
    2: { open: 9, close: 18.5 },
    3: { open: 9, close: 18.5 },
    4: { open: 9, close: 18.5 },
    5: { open: 9, close: 18.5 },
    6: { open: 9, close: 18.5 }     // суббота
}

function formatHour(h) {
    const hours = Math.floor(h)
    const minutes = Math.round((h - hours) * 60)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function getAlmatyNow() {
    const now = new Date()
    const almatyHour = (now.getUTCHours() + 5) % 24
    const dayShift = Math.floor((now.getUTCHours() + 5) / 24)
    const almatyDay = (now.getUTCDay() + dayShift) % 7
    return { day: almatyDay, hour: almatyHour, minute: now.getUTCMinutes() }
}

function isShopOpen() {
    const { day, hour, minute } = getAlmatyNow()
    const todaySchedule = SCHEDULE[day]

    const currentMinutes = hour * 60 + minute
    const openMinutes = todaySchedule.open * 60
    const closeMinutes = todaySchedule.close * 60

    return currentMinutes >= openMinutes && currentMinutes < closeMinutes
}

function todayScheduleText() {
    const { day } = getAlmatyNow()
    const s = SCHEDULE[day]
    return `${formatHour(s.open)}–${formatHour(s.close)}`
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Многие пишут на казахском обычной клавиатурой без специфических букв
// (қ, ғ, ұ, ү, ә, і, ө, ң) — например "ашык" вместо "ашық", "уакыт" вместо
// "уақыт". Без этой нормализации такие сообщения не совпадали с regex'ами
// намерений (часы работы, приветствие и т.д.) и ошибочно улетали в поиск
// товара. Приводим к "базовому" написанию только для ОПРЕДЕЛЕНИЯ намерения —
// на сам поиск товаров по названию это не влияет.
function normalizeKz(str) {
    return str
        .replace(/қ/g, "к")
        .replace(/ғ/g, "г")
        .replace(/ң/g, "н")
        .replace(/ұ/g, "у")
        .replace(/ү/g, "у")
        .replace(/ә/g, "а")
        .replace(/і/g, "и")
        .replace(/ө/g, "о")
}

// Расстояние Левенштейна — нужно, чтобы находить категорию даже если
// клиент написал её с опечаткой ("эмулсия" вместо "эмульсия").
function levenshtein(a, b) {
    const m = a.length, n = b.length
    if (!m) return n
    if (!n) return m
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
        }
    }
    return dp[m][n]
}

// Проверяет только НАЧАЛО слова — если несколько первых букв запроса
// однозначно (без других похожих категорий) указывают на одно название,
// не важно, что там дальше (пропущенная буква, окончание другое и т.д.).
// Решает случаи вроде "эмулсия" (без "ь") — это не сплошная подстрока
// "эмульсия" (буква "ь" разрывает совпадение), но начало слова то же самое.
function findByPrefix(norm, categories) {
    const prefixLen = Math.min(4, norm.length)
    const prefix = norm.slice(0, prefixLen)

    const matches = categories.filter(c => {
        const words = normalizeKz(c.name.toLowerCase()).trim().split(/\s+/)
        return words.some(w => w.startsWith(prefix))
    })

    // Совпадение засчитываем, только если оно ОДНОЗНАЧНОЕ — если по такому
    // началу подходит несколько разных категорий, лучше промолчать и уйти
    // в более точную проверку ниже, чем угадать неправильно.
    return matches.length === 1 ? matches[0] : null
}

// Пытается понять, что клиент на самом деле назвал КАТЕГОРИЮ товара
// (пусть и с опечаткой, или назвал только часть составного названия —
// например "эмульсия" вместо полного "ВДК Эмульсия"), а не конкретный
// товар. Если так — вместо урезанного списка ("покажем только 3")
// показываем ВСЕ товары категории кнопками с пагинацией.
async function findMatchingCategory(rawText) {
    const norm = normalizeKz(rawText.toLowerCase()).trim()
    if (norm.length < 3) return null

    const categories = await Category.find()
    if (!categories.length) return null

    // 1) Слово клиента входит в название категории (или наоборот) —
    // например "эмульсия" находит "ВДК Эмульсия", даже если это не всё
    // название целиком и не первое слово в нём.
    const containmentMatches = categories.filter(c => {
        const cNorm = normalizeKz(c.name.toLowerCase()).trim()
        return cNorm.includes(norm) || norm.includes(cNorm)
    })
    if (containmentMatches.length) {
        // Если совпало несколько — берём ближайшую по длине названия
        // (обычно это самая точная/специфичная категория).
        return containmentMatches.sort((a, b) => {
            const aDiff = Math.abs(normalizeKz(a.name.toLowerCase()).length - norm.length)
            const bDiff = Math.abs(normalizeKz(b.name.toLowerCase()).length - norm.length)
            return aDiff - bDiff
        })[0]
    }

    // 2) Полного вхождения нет (например, опечатка ломает подстроку
    // посередине слова) — проверяем однозначное совпадение по началу слова.
    const prefixMatch = findByPrefix(norm, categories)
    if (prefixMatch) return prefixMatch

    // 3) И то не сработало — общая проверка на опечатку по всему слову
    // (расстояние Левенштейна).
    let best = null
    let bestDist = Infinity

    for (const c of categories) {
        const cNorm = normalizeKz(c.name.toLowerCase()).trim()
        const dist = levenshtein(norm, cNorm)
        // Допускаем опечатку примерно в треть длины слова (минимум 1 символ).
        const threshold = Math.max(1, Math.floor(cNorm.length * 0.3))
        if (dist <= threshold && dist < bestDist) {
            bestDist = dist
            best = c
        }
    }
    return best
}

function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + "…" : str
}

async function sendCategoryPdfFromList(ctx, categoryName, products) {
    const pdfBuffer = await generateCatalogPdf(categoryName, products)
    return ctx.replyWithDocument(
        { source: pdfBuffer, filename: `catalog_${categoryName}.pdf` },
        { caption: `📖 «${categoryName}» толық каталогы (${products.length} тауар)` }
    )
}

async function sendCategoryPage(ctx, categoryName, page, preloadedProducts) {
    const products = preloadedProducts || await Product.find({ category: categoryName }).sort({ name: 1 })

    if (!products.length) {
        const text = `«${categoryName}» санатында тауар жоқ.`
        return ctx.updateType === "callback_query" ? ctx.editMessageText(text) : ctx.reply(text)
    }

    const start = page * CATEGORY_PAGE_SIZE
    const pageItems = products.slice(start, start + CATEGORY_PAGE_SIZE)

    const buttons = pageItems.map(p => [
        Markup.button.callback(truncate(p.name, 40), `prod:${p.code}`)
    ])

    const navRow = []
    if (page > 0) navRow.push(Markup.button.callback("⬅️ Артқа", `catpage:${categoryName}:${page - 1}`))
    if (start + CATEGORY_PAGE_SIZE < products.length) navRow.push(Markup.button.callback("Келесі ➡️", `catpage:${categoryName}:${page + 1}`))
    if (navRow.length) buttons.push(navRow)

    // Кнопкам — для быстрого тапа и мгновенного ответа. PDF — отдельной
    // кнопкой внизу, для тех, кто хочет посмотреть/сохранить весь список
    // сразу. Обе опции читают склад в реальном времени, не из кэша.
    buttons.push([Markup.button.callback("📄 PDF каталог", `catpdf:${categoryName}`)])

    // Без этой кнопки клиент, зайдя в категорию, не может вернуться к
    // списку категорий иначе как заново набрав /start — тупиковый диалог.
    buttons.push([Markup.button.callback("📂 Санаттар тізімі", "showcategories")])

    const totalPages = Math.ceil(products.length / CATEGORY_PAGE_SIZE)
    const text =
        `«${categoryName}» санатында ${products.length} тауар бар ` +
        `(${page + 1}/${totalPages} бет). Керегін таңдаңыз:`

    const keyboard = Markup.inlineKeyboard(buttons)

    if (ctx.updateType === "callback_query") {
        return ctx.editMessageText(text, keyboard)
    }
    return ctx.reply(text, keyboard)
}

// Собирает меню категорий с количеством товаров в каждой — то же самое,
// что видно в сайдбаре админки ("Все товары 92", "ВДК Эмульсия 47" и т.д.).
// Показываем его проактивно, а не ждём, пока клиент сам догадается
// написать точное название категории.
async function buildCategoryMenu() {
    const categories = await Category.find().sort({ name: 1 })
    const counts = await Promise.all(
        categories.map(c => Product.countDocuments({ category: c.name }))
    )
    const totalCount = counts.reduce((a, b) => a + b, 0)

    const rows = categories.map((c, i) => [
        Markup.button.callback(`📦 ${c.name} (${counts[i]})`, `catpage:${c.name}:0`)
    ])
    rows.unshift([Markup.button.callback(`🗂 Барлық тауарлар (${totalCount})`, "allcatalog")])

    return Markup.inlineKeyboard(rows)
}

async function sendFullCatalogPdf(ctx) {
    const allProducts = await Product.find({}).sort({ category: 1, code: 1 })

    if (!allProducts.length) {
        return ctx.reply("Дүкенде тауарлар әлі қосылмаған.")
    }

    const pdfBuffer = await generateCatalogPdf("Барлық тауарлар", allProducts)
    return ctx.replyWithDocument(
        { source: pdfBuffer, filename: "catalog_full.pdf" },
        { caption: "📖 Толық каталог" }
    )
}

process.on("unhandledRejection", (err) => {
    console.error("Answer-bot: необработанная ошибка:", err)
})

// БЕЗ этого обработчика ошибка в обработке ОДНОГО сообщения (например,
// Telegram отверг сообщение из-за неверной разметки) могла обрушить всю
// сессию polling'а целиком — бот переставал отвечать вообще на любые
// сообщения, а не только на то, что вызвало ошибку, и уходил в бесконечный
// цикл перезапуска (launchWithRetry). Теперь ошибка в одном сообщении
// логируется и клиенту приходит вежливый ответ, а бот продолжает
// нормально работать для всех остальных.
bot.catch((err, ctx) => {
    console.error(`Answer-bot: ошибка при обработке сообщения от ${ctx.from?.id}:`, err)
    ctx.reply("⚠️ Кешіріңіз, қате шықты. Қайталап жазып көріңіз.").catch(() => {})
})

bot.start(async (ctx) => {
    await ctx.reply(
        "👋 Сәлем! Мен дүкеннің көмекші-боты. Не істей аламын:\n\n" +
        "1️⃣ Тауар іздеу — атауын жазыңыз (мысалы: «цемент»)\n" +
        "2️⃣ Баға мен қалдықты білу — тауар атауын жазсаңыз жеткілікті\n" +
        "3️⃣ Жұмыс уақыты — «бүгін ашық па?» деп сұраңыз\n" +
        "4️⃣ Мекенжай — «мекенжайыңыз қайда?» деп сұраңыз\n" +
        "5️⃣ Толық каталог — төмендегі санаттардан таңдаңыз немесе «каталог» деп жазыңыз\n\n" +
        "Санатты таңдаудың орнына жай ғана жазуға да болады."
    )
    const keyboard = await buildCategoryMenu()
    return ctx.reply("📂 Санаттар:", keyboard)
})

bot.command("id", (ctx) => ctx.reply(`ID: ${ctx.chat.id}`))

// ---- Тап по кнопке конкретного товара (из списка категории) ----
bot.action(/^prod:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery()
    const code = ctx.match[1]
    const p = await Product.findOne({ code })
    if (!p) return ctx.reply("Кешіріңіз, бұл тауар табылмады.")
    return replyWithProduct(ctx, p)
})

// ---- Пагинация внутри категории ----
bot.action(/^catpage:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery()
    const categoryName = ctx.match[1]
    const page = parseInt(ctx.match[2], 10)
    return sendCategoryPage(ctx, categoryName, page)
})

// ---- Кнопка "Барлық тауарлар" в меню категорий ----
bot.action("allcatalog", async (ctx) => {
    await ctx.answerCbQuery("PDF дайындалуда...")
    return sendFullCatalogPdf(ctx)
})

// ---- Вернуться к списку категорий (из любого места диалога) ----
bot.action("showcategories", async (ctx) => {
    await ctx.answerCbQuery()
    const keyboard = await buildCategoryMenu()
    return ctx.reply("📂 Санаттар:", keyboard)
})

// ---- Скачать PDF конкретной категории (по кнопке в списке) ----
bot.action(/^catpdf:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("PDF дайындалуда...")
    const categoryName = ctx.match[1]

    try {
        // Читаем склад заново, в момент нажатия — данные всегда актуальные,
        // не заранее сгенерированный/закэшированный файл.
        const products = await Product.find({ category: categoryName }).sort({ code: 1 })

        if (!products.length) {
            return ctx.reply(`«${categoryName}» санатында тауар жоқ.`)
        }

        return sendCategoryPdfFromList(ctx, categoryName, products)
    } catch (e) {
        console.error("Answer-bot category PDF error:", e)
        return ctx.reply("⚠️ PDF жіберу мүмкін болмады, қайталап көріңіз.")
    }
})

bot.on("text", async (ctx) => {
    const rawText = ctx.message.text.trim()
    const text = rawText.toLowerCase()
    const normalizedText = normalizeKz(text)

    // Клиент прислал голую цифру без остального текста ("2", "3") — скорее
    // всего, ожидает пронумерованное меню, которого у бота нет. Вместо
    // непонятного отказа показываем список возможностей — видимо, это и
    // есть то самое "меню", которое он искал.
    if (/^\d+$/.test(rawText)) {
        return ctx.reply(
            "Нөмірлі мәзір жоқ — не істей алатынымды тізіп берейін:\n\n" +
            "1️⃣ Тауар іздеу — атауын жазыңыз (мысалы: «цемент»)\n" +
            "2️⃣ Баға мен қалдықты білу — тауар атауын жазсаңыз жеткілікті\n" +
            "3️⃣ Жұмыс уақыты — «бүгін ашық па?» деп сұраңыз\n" +
            "4️⃣ Мекенжай — «мекенжайыңыз қайда?» деп сұраңыз\n" +
            "5️⃣ Толық каталог — «каталог» деп жазыңыз"
        )
    }

    // Слишком короткое/бессмысленное сообщение (случайный символ, пробел,
    // знак препинания) — не запускаем поиск вообще, просто просим уточнить.
    if (text.replace(/[^a-zа-яёқғңұүәіө0-9]/gi, "").length < 2) {
        return ctx.reply("Сұрағыңызды толық түсінбедім — тауар атауын жазыңыз немесе жұмыс уақыты туралы сұраңыз.")
    }

    // ---- сәлемдесу / қоштасу / рахмет ----
    // Проверяем по нормализованному тексту — так "салем" и "сәлем" (с қ/ә
    // или без) распознаются одинаково.
    if (/(салем|саламатсыз|здравств|привет)/i.test(normalizedText)) {
        return ctx.reply("👋 Сәлеметсіз бе! Не сұрағыңыз келеді — тауар, баға, жұмыс уақыты?")
    }

    if (/(рахмет|ракмет|спасибо|благодар)/i.test(normalizedText)) {
        return ctx.reply("🙏 Өтінемін! Тағы сұрақ болса — жазыңыз.")
    }

    if (/(сау бол|корискенше|до свидан|пока$|бай-бай)/i.test(normalizedText)) {
        return ctx.reply("👋 Сау болыңыз! Күте тұрыңыз, тағы жазыңыз.")
    }

    // ---- мекенжай ----
    if (/(мекенжай|адрес|кайда|орналас)/i.test(normalizedText)) {
        return ctx.reply("📍 Мекенжайымыз: Қарасақал Ерімбет көшесі, 5А")
    }

    // ---- дүкен ашық па / қашан ашылады ----
    if (/(ашык|ашыл|жумыс|график|уакыт|сагат|кашан)/i.test(normalizedText)) {
        const status = isShopOpen()
            ? `✅ Біз қазір жұмыс істеп жатырмыз! Бүгінгі жұмыс уақыты: ${todayScheduleText()}.`
            : `😴 Қазір жабықпыз. Бүгінгі жұмыс уақыты: ${todayScheduleText()}.`
        return ctx.reply(status)
    }

    // ---- каталог сұрауы (PDF) ----
    if (/(катало)/i.test(normalizedText)) {
        return handleCatalogRequest(ctx, text)
    }

    // ---- клиент, судя по всему, назвал КАТЕГОРИЮ, а не конкретный товар ----
    // Показываем ВСЕ товары категории кнопками — не урезаем до 3-5 штук.
    const matchedCategory = await findMatchingCategory(text)
    if (matchedCategory) {
        const products = await Product.find({ category: matchedCategory.name }).sort({ name: 1 })

        if (!products.length) {
            return ctx.reply(`«${matchedCategory.name}» санатында тауар жоқ.`)
        }

        // Большая категория — сразу присылаем PDF со всем списком, чтобы не
        // заставлять клиента листать много страниц кнопками ради общего
        // обзора. Кнопки всё равно показываем следом — для быстрого тапа
        // по конкретной позиции.
        if (products.length > LARGE_CATEGORY_THRESHOLD) {
            await sendCategoryPdfFromList(ctx, matchedCategory.name, products)
        }

        return sendCategoryPage(ctx, matchedCategory.name, 0, products)
    }

    // ---- тікелей іздеу атауы/коды бойынша ----
    const safeText = escapeRegex(text)
    const direct = await Product.find({
        $or: [
            { name: { $regex: safeText, $options: "i" } },
            { code: { $regex: safeText, $options: "i" } }
        ]
    }).limit(8)

    if (direct.length === 1) {
        return replyWithProduct(ctx, direct[0])
    }

    if (direct.length > 1) {
        return ctx.reply(
            "Мына тауарлар табылды:\n\n" +
            direct.map(formatProductLine).join("\n\n"),
            { parse_mode: "HTML" }
        )
    }

    // ---- тікелей сәйкестік жоқ — AI арқылы іздейміз (нақты, бірақ жазылуы басқаша тауар) ----
    try {
        const allProducts = await Product.find({}, { name: 1, code: 1, category: 1 }).limit(300)
        const catalogList = allProducts.map(p => `${p.code}: ${p.name} [категория: ${p.category}]`).join("\n")

        const ai = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content:
                        `Сен құрылыс материалдары дүкенінің көмекшісісің. Клиент хабарлама жазды — ` +
                        `тауарлар тізімінен (код: атауы [категория]) мағынасы жағынан ең ұқсас тауарларды тап ` +
                        `(мейлінше нақты болса — 1-2 тауар, жалпырақ сұрау болса — 8-ге дейін). ` +
                        `Тек JSON-массив кодтарын қайтар, түсініктемесіз: ["P045","S01"]. ` +
                        `Ешнәрсе сәйкес келмесе — бос массив қайтар: [].\n\n` +
                        `Тауарлар тізімі:\n${catalogList}`
                },
                { role: "user", content: text }
            ]
        })

        let codes = []
        try {
            codes = JSON.parse(ai.choices[0].message.content)
        } catch (e) {
            codes = []
        }

        if (!codes.length) {
            const keyboard = await buildCategoryMenu()
            return ctx.reply(
                "😔 Кешіріңіз, дүкенімізде мұндай тауар табылмады. Санаттардан қарап көріңіз:",
                keyboard
            )
        }

        const matches = await Product.find({ code: { $in: codes } })

        if (matches.length === 1) {
            await ctx.reply("Сіз мынаны айтқан болуыңыз мүмкін:")
            return replyWithProduct(ctx, matches[0])
        }

        return ctx.reply(
            "Сіз мына тауарлардың бірін айтқан болуыңыз мүмкін:\n\n" +
            matches.map(formatProductLine).join("\n\n"),
            { parse_mode: "HTML" }
        )

    } catch (e) {
        console.error("Answer-bot AI error:", e)
        return ctx.reply("⚠️ Сұрауды өңдеу мүмкін болмады, қайталап көріңіз.")
    }
})

// Названия товаров иногда сами содержат символы, которые Telegram
// воспринимает как разметку (* для жирного, _ для курсива и т.д.) —
// например размеры гипсокартона "2500*1200*9,5мм".
// ВАЖНО: экранирование через "\*" работает ТОЛЬКО в parse_mode
// "MarkdownV2", а НЕ в обычном "Markdown" — со старым Markdown обратный
// слэш не распознаётся как экранирование вообще, и Telegram либо путает
// пары звёздочек (пропадает часть текста), либо прямо отклоняет
// сообщение с ошибкой "can't parse entities". Поэтому используем HTML
// вместо Markdown — там жирный текст через <b>...</b>, а звёздочки внутри
// названия товара вообще ничего не значат и не мешают.
function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

async function replyWithProduct(ctx, p) {
    const available = Math.max(0, p.qty - (p.reservedQty || 0))
    const status = available > 0 ? `✅ Қоймада бар: ${available} ${p.unit}` : "😔 Қазір қоймада жоқ"

    return ctx.reply(
        `📦 <b>${escapeHtml(p.name)}</b>\n\n` +
        `💰 Бағасы: ${p.price.toLocaleString("ru-RU")} ₸\n` +
        `${status}`,
        {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("📂 Санаттар тізімі", "showcategories")]])
        }
    )
}

// Компактная карточка на товар — цена и наличие сразу, без отдельного шага
// "напишите номер, чтобы узнать подробности". Используется, когда найдено
// несколько подходящих товаров сразу. Единица измерения указана только
// рядом с остатком (у цены её убрали — там она была лишней).
function formatProductLine(p) {
    const available = Math.max(0, p.qty - (p.reservedQty || 0))
    const status = available > 0 ? `✅ бар: ${available} ${p.unit}` : "😔 жоқ"
    return `📦 <b>${escapeHtml(p.name)}</b>\n💰 ${p.price.toLocaleString("ru-RU")} ₸ · ${status}`
}

// Обрабатывает запрос каталога: если в сообщении упомянута конкретная
// категория — шлёт PDF только по ней; если нет — шлёт полный каталог
// по всем товарам сразу.
async function handleCatalogRequest(ctx, text) {
    try {
        const categories = await Category.find()

        // Ищем, не упомянута ли в сообщении конкретная категория
        const matchedCategory = categories.find(c =>
            text.includes(c.name.toLowerCase())
        )

        if (matchedCategory) {
            const products = await Product.find({ category: matchedCategory.name }).sort({ code: 1 })

            if (!products.length) {
                return ctx.reply(`«${matchedCategory.name}» санатында тауар жоқ.`)
            }

            const pdfBuffer = await generateCatalogPdf(matchedCategory.name, products)
            return ctx.replyWithDocument(
                { source: pdfBuffer, filename: `catalog_${matchedCategory.name}.pdf` },
                { caption: `📖 «${matchedCategory.name}» каталогы` }
            )
        }

        // Категория нақтыланбаған — толық каталогты жібереміз
        return sendFullCatalogPdf(ctx)

    } catch (e) {
        console.error("Answer-bot catalog error:", e)
        return ctx.reply("⚠️ Каталогты жіберу мүмкін болмады, қайталап көріңіз.")
    }
}

async function launchWithRetry(retryDelayMs = 10000) {
    try {
        await bot.launch()
        console.log("Answer-bot работает 🚀")
    } catch (err) {
        console.error("Answer-bot: не удалось запустить, повтор через", retryDelayMs / 1000, "сек:", err.message)
        setTimeout(() => launchWithRetry(retryDelayMs), retryDelayMs)
    }
}

launchWithRetry()

// ============================================================
// GRACEFUL SHUTDOWN — см. подробный комментарий в order-bot/index.js.
// Releasing the polling connection immediately on SIGTERM avoids the
// brief "409 Conflict" window that otherwise appears on every deploy.
// ============================================================
process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))