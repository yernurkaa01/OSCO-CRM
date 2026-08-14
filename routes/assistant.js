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

async function getOrdersByDate(date, productName) {
    const from = new Date(date + "T00:00:00");
    const to = new Date(date + "T23:59:59");

    const filter = {
        status: { $in: SOLD_STATUSES },
        createdAt: { $gte: from, $lte: to }
    };
    if (productName) {
        filter.product = { $regex: productName, $options: "i" };
    }

    const orders = await Order.find(filter, { product: 1, count: 1, totalPrice: 1, name: 1, createdAt: 1 });
    return orders.map(o => ({
        product: o.product,
        count: o.count,
        totalPrice: o.totalPrice,
        client: o.name || "-",
        time: o.createdAt
    }));
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
            description: "Возвращает проданные (оплаченные/выданные) заказы за конкретную дату, при желании отфильтрованные по товару",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "дата в формате YYYY-MM-DD" },
                    productName: { type: "string", description: "необязательно — часть названия товара для фильтра" }
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
        case "get_orders_by_date": return getOrdersByDate(args.date, args.productName);
        case "search_products": return searchProducts(args.query);
        default: return { error: "Неизвестная функция" };
    }
}

// ---------- POST /admin/api/assistant ----------
router.post('/api/assistant', express.json(), async (req, res) => {
    try {
        const { message } = req.body || {};
        if (!message || !message.trim()) {
            return res.status(400).json({ error: "Пустой вопрос" });
        }

        const today = new Date().toISOString().slice(0, 10);

        const messages = [
            {
                role: "system",
                content:
                    `Ты внутренний AI-помощник владельца магазина стройматериалов. ` +
                    `Отвечай ТОЛЬКО на основе данных, которые получаешь через доступные функции — ` +
                    `никогда не выдумывай товары, цены или заказы. Если для ответа не хватает подходящей ` +
                    `функции — честно скажи, что не можешь ответить на этот вопрос. ` +
                    `Сегодняшняя дата: ${today}. Отвечай кратко, по-русски, списком если товаров несколько.`
            },
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