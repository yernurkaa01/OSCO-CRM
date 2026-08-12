// ============================================================
// answer-bot/index.js — БОТ-ОТВЕЧАТЕЛЬ
// ============================================================

import "dotenv/config"
import { Telegraf, Markup } from "telegraf"
import mongoose from "mongoose"
import OpenAI from "openai"
import Product from "../models/Product.js"
import Category from "../models/category.js"

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Answer-bot: MongoDB подключен"))
    .catch(err => console.log("Answer-bot: ошибка MongoDB", err))

const bot = new Telegraf(process.env.ANSWER_BOT_TOKEN)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const ORDER_BOT_USERNAME = "@Ernurzhan_stroy_market"

// Расписание работы по дням недели (0 = воскресенье, 1 = понедельник, ... 6 = суббота)
// Без выходных — каждый день работаем, но воскресенье короче.
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
    // Грубый пересчёт в Алматы (UTC+5) — без учёта возможных изменений
    // часового пояса сервера
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

process.on("unhandledRejection", (err) => {
    console.error("Answer-bot: необработанная ошибка:", err)
})

bot.start((ctx) => {
    return ctx.reply(
        "👋 Сәлем! Мен дүкен туралы сұрақтарға жауап беремін — ашық па, тауар бар ма, бағасы қанша.\n\n" +
        `Тапсырыс беру үшін — ${ORDER_BOT_USERNAME} жазыңыз\n\n` +
        "Бірдеңе сұраңыз, мысалы: «цемент бар ма?» немесе «бүгін жұмыс істейсіздер ме?»"
    )
})

bot.command("id", (ctx) => ctx.reply(`ID: ${ctx.chat.id}`))

bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase()

    // ---- дүкен ашық па ----
    if (/(ашық|жұмыс|график|уақыт|сағат)/i.test(text)) {
        const status = isShopOpen()
            ? `✅ Біз қазір жұмыс істеп жатырмыз! Бүгінгі жұмыс уақыты: ${todayScheduleText()}.`
            : `😴 Қазір жабықпыз. Бүгінгі жұмыс уақыты: ${todayScheduleText()}.`
        return ctx.reply(status)
    }

    // ---- тікелей іздеу атауы/коды бойынша ----
    const direct = await Product.find({
        $or: [
            { name: { $regex: text, $options: "i" } },
            { code: { $regex: text, $options: "i" } }
        ]
    }).limit(5)

    if (direct.length === 1) {
        return replyWithProduct(ctx, direct[0])
    }

    if (direct.length > 1) {
        return ctx.reply(
            "Бірнеше нұсқа таптым, нақтылаңыз:\n\n" +
            direct.map((p, i) => `${i + 1}. ${p.name}`).join("\n")
        )
    }

    // ---- тікелей сәйкестік жоқ — AI арқылы іздейміз ----
    try {
        const allNames = await Product.find({}, { name: 1, code: 1 }).limit(300)
        const catalogList = allNames.map(p => `${p.code}: ${p.name}`).join("\n")

        const ai = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content:
                        `Сен құрылыс материалдары дүкенінің көмекшісісің. Клиент хабарлама жазды — ` +
                        `тауарлар тізімінен (код: атауы) мағынасы жағынан ең ұқсас 3-ке дейін тауар тап. ` +
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
                "😔 Сәйкес тауар табылмады. Атауын басқаша жазып көріңіз, " +
                "немесе менеджерден сұраңыз."
            )
        }

        const matches = await Product.find({ code: { $in: codes } })

        if (matches.length === 1) {
            await ctx.reply("Сіз мынаны айтқан болуыңыз мүмкін:")
            return replyWithProduct(ctx, matches[0])
        }

        return ctx.reply(
            "Сіз мына тауарлардың бірін айтқан болуыңыз мүмкін:\n\n" +
            matches.map((p, i) => `${i + 1}. ${p.name} — ${p.price.toLocaleString("ru-RU")} ₸`).join("\n") +
            "\n\nНақты атауын жазыңыз, толығырақ білу үшін."
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
        `${status}\n\n` +
        `Тапсырыс беру үшін — ${ORDER_BOT_USERNAME} жазыңыз`
    )
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