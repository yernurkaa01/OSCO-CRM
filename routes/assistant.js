import express from "express";
import OpenAI from "openai";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SOLD_STATUSES = ["оплачено", "выдано"];

// ============================================================
// Безопасные "инструменты" — AI может ТОЛЬКО вызывать эти готовые
// функции с конкретными параметрами, а не сочинять свои запросы
// к базе напрямую. Каждая функция — только чтение, ничего не меняет.
// ============================================================

async function getOutOfStock() {
    const products = await Product.find({ qty: { $lte: 0 } }, { name: 1, code: 1, category: 1 });
    return products.map(p => ({ name: p.name, code: p.code, category: p.category }));
}

async function getLowStock(threshold) {
    const products = await Product.find(
        { qty: { $gt: 0, $lte: threshold } },
        { name: 1, code: 1, qty: 1, unit: 1 }
    ).sort({ qty: 1 });
    return products.map(p => ({ name: p.name, code: p.code, qty: p.qty, unit: p.unit }));
}

async function getProductsByPrice(comparison, price) {
    const filter = comparison === "above" ? { price: { $gte: price } } : { price: { $lte: price } };
    const products = await Product.find(filter, { name: 1, code: 1, price: 1 }).sort({ price: -1 }).limit(50);
    return products.map(p => ({ name: p.name, code: p.code, price: p.price }));
}

// Магазин работает по алматинскому времени (UTC+5) — фиксируем это явно
// в границах дня, а не полагаемся на часовой пояс сервера (Render обычно
// в UTC). Иначе заказы у полуночи могут "уехать" в соседний день.
function getAlmatyDayRange(dateStr) {
    const from = new Date(`${dateStr}T00:00:00+05:00`);
    const to = new Date(`${dateStr}T23:59:59+05:00`);
    return { from, to };
}

// status: "all" — все заказы за день (по умолчанию, для вопросов
// "сколько заказов было"); "sold" — только оплаченные/выданные (для
// вопросов про выручку/продажи); "rejected" — только отклонённые/отменённые.
async function getOrdersByDate(date, productName, status) {
    const { from, to } = getAlmatyDayRange(date);

    const filter = { createdAt: { $gte: from, $lte: to } };

    if (status === "sold") {
        filter.status = { $in: SOLD_STATUSES };
    } else if (status === "rejected") {
        filter.status = { $nin: SOLD_STATUSES };
    }
    // status === "all" (или не указан) — без фильтра по статусу вообще

    if (productName) {
        filter.product = { $regex: productName, $options: "i" };
    }

    const orders = await Order.find(filter, { product: 1, count: 1, totalPrice: 1, name: 1, status: 1, createdAt: 1 });
    return {
        totalOrders: orders.length,
        orders: orders.map(o => ({
            product: o.product,
            count: o.count,
            totalPrice: o.totalPrice,
            status: o.status,
            client: o.name || "-",
            time: o.createdAt
        }))
    };
}

async function searchProducts(query) {
    const products = await Product.find({
        $or: [
            { name: { $regex: query, $options: "i" } },
            { code: { $regex: query, $options: "i" } }
        ]
    }, { name: 1, code: 1, qty: 1, unit: 1, price: 1, category: 1 }).limit(20);

    return products.map(p => ({
        name: p.name, code: p.code, qty: p.qty, unit: p.unit, price: p.price, category: p.category
    }));
}

const TOOLS = [
    {
        type: "function",
        function: {
            name: "get_out_of_stock",
            description: "Возвращает список товаров, которых сейчас нет в наличии (остаток 0 или меньше)",
            parameters: { type: "object", properties: {}, required: [] }
        }
    },
    {
        type: "function",
        function: {
            name: "get_low_stock",
            description: "Возвращает товары с остатком МЕНЬШЕ ИЛИ РАВНО указанному числу (но больше нуля)",
            parameters: {
                type: "object",
                properties: {
                    threshold: { type: "number", description: "порог остатка, например 50" }
                },
                required: ["threshold"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_products_by_price",
            description: "Возвращает товары дороже или дешевле указанной цены",
            parameters: {
                type: "object",
                properties: {
                    comparison: { type: "string", enum: ["above", "below"], description: "above = дороже, below = дешевле" },
                    price: { type: "number" }
                },
                required: ["comparison", "price"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_orders_by_date",
            description:
                "Возвращает заказы за конкретную дату. ВАЖНО: если пользователь спрашивает просто " +
                "\"сколько заказов было\" без уточнения — используй status=\"all\", чтобы посчитать " +
                "ВСЕ заказы, включая отклонённые и отменённые. Используй status=\"sold\" только если " +
                "пользователь явно спрашивает про проданные/оплаченные/выданные заказы или выручку. " +
                "Используй status=\"rejected\" только если явно спрашивает про отклонённые/отменённые.",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "дата в формате YYYY-MM-DD" },
                    productName: { type: "string", description: "необязательно — часть названия товара для фильтра" },
                    status: {
                        type: "string",
                        enum: ["all", "sold", "rejected"],
                        description: "all = все заказы (по умолчанию), sold = только оплаченные/выданные, rejected = только отклонённые/отменённые"
                    }
                },
                required: ["date"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "search_products",
            description: "Ищет товары по названию или коду (для общих вопросов про конкретный товар)",
            parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"]
            }
        }
    }
];

async function executeTool(name, args) {
    switch (name) {
        case "get_out_of_stock": return getOutOfStock();
        case "get_low_stock": return getLowStock(args.threshold);
        case "get_products_by_price": return getProductsByPrice(args.comparison, args.price);
        case "get_orders_by_date": return getOrdersByDate(args.date, args.productName, args.status || "all");
        case "search_products": return searchProducts(args.query);
        default: return { error: "Неизвестная функция" };
    }
}

const MAX_HISTORY_MESSAGES = 12; // 6 обменов туда-обратно — достаточно для контекста, не раздувает токены

// ---------- POST /admin/api/assistant ----------
router.post('/api/assistant', express.json(), async (req, res) => {
    try {
        const { message, history } = req.body || {};
        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Пустой вопрос" });
        }

        const today = new Date().toISOString().slice(0, 10);

        // История — только текстовые user/assistant реплики с фронтенда
        // (не внутренние tool-вызовы). Фронтенд должен копить её сам и
        // присылать при каждом запросе, чтобы помощник помнил контекст
        // в рамках одного открытого чата.
        const priorMessages = Array.isArray(history)
            ? history
                .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
                .slice(-MAX_HISTORY_MESSAGES)
            : [];

        const messages = [
            {
                role: "system",
                content:
                    `Ты внутренний AI-помощник владельца магазина стройматериалов. ` +
                    `Отвечай ТОЛЬКО на основе данных, которые получаешь через доступные функции — ` +
                    `никогда не выдумывай товары, цены или заказы. Если для ответа не хватает подходящей ` +
                    `функции — честно скажи, что не можешь ответить на этот вопрос. ` +
                    `Сегодняшняя дата: ${today} (часовой пояс Алматы, UTC+5). ` +
                    `Когда спрашивают "сколько заказов было" без уточнения статуса — считай ВСЕ заказы ` +
                    `(status="all"), включая отклонённые и отменённые, а не только проданные. ` +
                    `Отвечай кратко, по-русски, списком если товаров/заказов несколько.`
            },
            ...priorMessages,
            { role: "user", content: message }
        ];

        let response = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages,
            tools: TOOLS
        });

        let choice = response.choices[0];

        // Если AI хочет вызвать функцию(и) — выполняем и отдаём результат обратно
        let loopGuard = 0;
        while (choice.finish_reason === "tool_calls" && loopGuard < 3) {
            loopGuard++;
            messages.push(choice.message);

            for (const toolCall of choice.message.tool_calls) {
                const args = JSON.parse(toolCall.function.arguments || "{}");
                const result = await executeTool(toolCall.function.name, args);

                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result)
                });
            }

            response = await openai.chat.completions.create({
                model: "gpt-4.1-mini",
                messages,
                tools: TOOLS
            });
            choice = response.choices[0];
        }

        res.json({ reply: choice.message.content });

    } catch (err) {
        console.error("ASSISTANT error:", err);
        res.status(500).json({ error: "Ошибка помощника, попробуйте ещё раз" });
    }
});

export default router;