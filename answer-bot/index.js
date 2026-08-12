// ============================================================
// answer-bot/index.js — БОТ-ОТВЕЧАТЕЛЬ
// Отдельный от основного бота-заказчика. Отвечает на повседневные
// вопросы (открыт ли магазин, есть ли товар, сколько стоит) —
// НЕ принимает заказы, НЕ резервирует товар. Смотрит в ту же базу
// данных, что и вся CRM — всегда актуальные остатки и цены.
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

// Ссылка на бота, который реально принимает заказы (замени на username)
const ORDER_BOT_USERNAME = "@ernurzhan_stroy_marketBot"

// Часы работы магазина — можно дробным числом: 18.5 = 18:30
const OPEN_HOUR = 9
const CLOSE_HOUR = 18.5

function formatHour(h) {
    const hours = Math.floor(h)
    const minutes = Math.round((h - hours) * 60)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function isShopOpen() {
    const now = new Date()
    const almatyHour = (now.getUTCHours() + 5) % 24 // грубо, под Алматы (UTC+5)
    const minutes = now.getUTCMinutes()

    // Считаем время в минутах от полуночи — так дробные часы (18.5 = 18:30)
    // сравниваются точно, а не только по целому часу.
    const currentMinutes = almatyHour * 60 + minutes
    const openMinutes = OPEN_HOUR * 60
    const closeMinutes = CLOSE_HOUR * 60

    return currentMinutes >= openMinutes && currentMinutes < closeMinutes
}

process.on("unhandledRejection", (err) => {
    console.error("Answer-bot: необработанная ошибка:", err)
})

bot.start((ctx) => {
    return ctx.reply(
        "👋 Привет! Я отвечаю на вопросы про наш магазин — открыт ли, есть ли товар, сколько стоит.\n\n" +
        `Чтобы оформить заказ — пишите ${ORDER_BOT_USERNAME}\n\n` +
        "Спросите что-нибудь, например: «есть цемент?» или «работаете сегодня?»"
    )
})

bot.command("id", (ctx) => ctx.reply(`ID: ${ctx.chat.id}`))

bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase()

    // ---- открыт ли магазин ----
    if (/(открыт|работа|часы|график|режим)/i.test(text)) {
        const status = isShopOpen()
            ? `✅ Мы сейчас работаем! Часы работы: ${formatHour(OPEN_HOUR)}–${formatHour(CLOSE_HOUR)}.`
            : `😴 Сейчас мы закрыты. Часы работы: ${formatHour(OPEN_HOUR)}–${formatHour(CLOSE_HOUR)}.`
        return ctx.reply(status)
    }

    // ---- прямой поиск по названию/коду ----
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
            "Нашёл несколько вариантов, уточните:\n\n" +
            direct.map((p, i) => `${i + 1}. ${p.name}`).join("\n")
        )
    }

    // ---- прямого совпадения нет — подключаем AI для нечёткого поиска ----
    try {
        const allNames = await Product.find({}, { name: 1, code: 1 }).limit(300)
        const catalogList = allNames.map(p => `${p.code}: ${p.name}`).join("\n")

        const ai = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content:
                        `Ты помощник магазина стройматериалов. Клиент написал сообщение — ` +
                        `найди среди списка товаров (код: название) до 3 наиболее похожих по смыслу. ` +
                        `Отвечай ТОЛЬКО JSON-массивом кодов без пояснений: ["P045","S01"]. ` +
                        `Если ничего подходящего нет — верни пустой массив [].\n\n` +
                        `Список товаров:\n${catalogList}`
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
                "😔 Не нашёл подходящий товар. Попробуйте написать название иначе, " +
                "или уточните у менеджера."
            )
        }

        const matches = await Product.find({ code: { $in: codes } })

        if (matches.length === 1) {
            await ctx.reply("Вы, наверное, имели в виду:")
            return replyWithProduct(ctx, matches[0])
        }

        return ctx.reply(
            "Возможно, вы имели в виду один из этих товаров:\n\n" +
            matches.map((p, i) => `${i + 1}. ${p.name} — ${p.price.toLocaleString("ru-RU")} ₸`).join("\n") +
            "\n\nНапишите точное название для подробностей."
        )

    } catch (e) {
        console.error("Answer-bot AI error:", e)
        return ctx.reply("⚠️ Не удалось обработать запрос, попробуйте ещё раз.")
    }
})

async function replyWithProduct(ctx, p) {
    const available = Math.max(0, p.qty - (p.reservedQty || 0))
    const status = available > 0 ? `✅ В наличии: ${available} ${p.unit}` : "😔 Сейчас нет в наличии"

    return ctx.reply(
        `📦 ${p.name}\n` +
        `💰 Цена: ${p.price.toLocaleString("ru-RU")} ₸/${p.unit}\n` +
        `${status}\n\n` +
        `Чтобы заказать — пишите ${ORDER_BOT_USERNAME}`
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