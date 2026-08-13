// ============================================================
// answer-bot/index.js — БОТ-ОТВЕЧАТЕЛЬ
// Отвечает на вопросы: работает ли магазин, есть ли товар,
// сколько стоит. Прямой поиск + AI для нечётких запросов.
// БЕЗ упоминания оформления заказа — только справочная информация.
// ============================================================

import "dotenv/config"
import { Telegraf } from "telegraf"
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

process.on("unhandledRejection", (err) => {
    console.error("Answer-bot: необработанная ошибка:", err)
})

// Короткая память "что показали последним" — чтобы клиент мог ответить
// просто номером ("3") и получить именно тот товар, а не новый поиск
// с нуля. Не полноценное состояние диалога — только последний список.
const lastOptions = {}   // { [chatId]: [productDoc, ...] }

bot.start((ctx) => {
    return ctx.reply(
        "👋 Сәлем! Мен дүкен туралы сұрақтарға жауап беремін — ашық па, тауар бар ма, бағасы қанша.\n\n" +
        "Бірдеңе сұраңыз, мысалы: «цемент бар ма?» немесе «бүгін жұмыс істейсіздер ме?»"
    )
})

bot.command("id", (ctx) => ctx.reply(`ID: ${ctx.chat.id}`))

bot.on("text", async (ctx) => {
    const rawText = ctx.message.text.trim()
    const text = rawText.toLowerCase()
    const chatId = ctx.chat.id

    // ---- Клиент отвечает номером на ранее показанный список ----
    // Понимает и просто "3", и скопированную строку "3. Цемент... — 2 550 ₸"
    const numberMatch = rawText.match(/^(\d+)/)
    if (numberMatch && lastOptions[chatId]) {
        const idx = parseInt(numberMatch[1], 10) - 1
        const chosen = lastOptions[chatId][idx]
        if (chosen) {
            delete lastOptions[chatId]
            return replyWithProduct(ctx, chosen)
        }
    }

    // Слишком короткое/бессмысленное сообщение (случайный символ, пробел,
    // знак препинания) — не запускаем поиск вообще, просто просим уточнить.
    if (text.replace(/[^a-zа-яё0-9]/gi, "").length < 2) {
        return ctx.reply("Не совсем понял вопрос — напишите название товара или спросите про часы работы.")
    }

    // ---- дүкен ашық па / қашан ашылады ----
    if (/(ашық|ашыл|жұмыс|график|уақыт|сағат|қашан)/i.test(text)) {
        const status = isShopOpen()
            ? `✅ Біз қазір жұмыс істеп жатырмыз! Бүгінгі жұмыс уақыты: ${todayScheduleText()}.`
            : `😴 Қазір жабықпыз. Бүгінгі жұмыс уақыты: ${todayScheduleText()}.`
        return ctx.reply(status)
    }

    // ---- каталог сұрауы ----
    if (/(катало)/i.test(text)) {
        return handleCatalogRequest(ctx, text)
    }

    // ---- тікелей іздеу атауы/коды бойынша ----
    const safeText = escapeRegex(text)
    const direct = await Product.find({
        $or: [
            { name: { $regex: safeText, $options: "i" } },
            { code: { $regex: safeText, $options: "i" } }
        ]
    }).limit(5)

    if (direct.length === 1) {
        return replyWithProduct(ctx, direct[0])
    }

    if (direct.length > 1) {
        lastOptions[chatId] = direct
        return ctx.reply(
            "Бірнеше нұсқа таптым, нақтылаңыз (нөмірін жазыңыз):\n\n" +
            direct.map((p, i) => `${i + 1}. ${p.name}`).join("\n")
        )
    }

    // ---- тікелей сәйкестік жоқ — AI арқылы іздейміз ----
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
                        `тауарлар тізімінен (код: атауы [категория]) мағынасы жағынан ең ұқсас 3-ке дейін тауар тап. ` +
                        `Клиент категория атауын жазуы мүмкін (мысалы "эмульсия", "цемент") — бұл жағдайда ` +
                        `сол категориядағы тауарларды ұсын. ` +
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
            return ctx.reply(
                "😔 Кешіріңіз, дүкенімізде мұндай тауар жоқ."
            )
        }

        const matches = await Product.find({ code: { $in: codes } })

        if (matches.length === 1) {
            await ctx.reply("Сіз мынаны айтқан болуыңыз мүмкін:")
            return replyWithProduct(ctx, matches[0])
        }

        lastOptions[chatId] = matches

        return ctx.reply(
            "Сіз мына тауарлардың бірін айтқан болуыңыз мүмкін (нөмірін жазыңыз):\n\n" +
            matches.map((p, i) => `${i + 1}. ${p.name} — ${p.price.toLocaleString("ru-RU")} ₸`).join("\n") +
            "\n\nНомерін немесе нақты атауын жазыңыз."
        )

    } catch (e) {
        console.error("Answer-bot AI error:", e)
        return ctx.reply("⚠️ Сұрауды өңдеу мүмкін болмады, қайталап көріңіз.")
    }
})

async function replyWithProduct(ctx, p) {
    const available = Math.max(0, p.qty - (p.reservedQty || 0))
    const status = available > 0 ? `✅ Қоймада бар: ${available} ${p.unit}` : "😔 Қазір қоймада жоқ"

    return ctx.reply(
        `📦 ${p.name}\n` +
        `💰 Бағасы: ${p.price.toLocaleString("ru-RU")} ₸/${p.unit}\n` +
        `${status}`
    )
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
        const allProducts = await Product.find({}).sort({ category: 1, code: 1 })

        if (!allProducts.length) {
            return ctx.reply("Дүкенде тауарлар әлі қосылмаған.")
        }

        const pdfBuffer = await generateCatalogPdf("Барлық тауарлар", allProducts)
        return ctx.replyWithDocument(
            { source: pdfBuffer, filename: "catalog_full.pdf" },
            { caption: "📖 Толық каталог" }
        )

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