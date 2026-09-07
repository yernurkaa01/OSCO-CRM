import express from "express";
import Product from "../models/Product.js";
import StockMovement from "../models/StockMovement.js";

const router = express.Router();

// Те же весовые/объёмные единицы, что в order-bot и routes/warehouse.js —
// их нельзя суммировать вместе со штучными товарами (шт, мешок), иначе
// сумма получается бессмысленной. Если добавляете новую единицу — поправьте
// все три места.
const FRACTIONAL_UNITS = ["кг", "kg", "л", "литр", "литра", "литров", "м", "м2", "м²", "м3", "м³"];

function isFractionalUnit(unit) {
    return FRACTIONAL_UNITS.includes(String(unit || "").trim().toLowerCase());
}

function buildDateFilter(from, to) {
    const filter = {};
    if (from) filter.$gte = new Date(from + "T00:00:00");
    if (to) {
        filter.$lte = new Date(to + "T23:59:59");
    }
    return Object.keys(filter).length ? filter : null;
}

// ---------- POST /api/stock-movements/incoming ----------
// Приход: новая партия товара от поставщика. Увеличивает остаток,
// обновляет закупочную цену (простая перезапись — если нужен точный
// средневзвешенный учёт по партиям, это отдельная будущая доработка).
router.post('/api/stock-movements/incoming', express.json(), async (req, res) => {
    try {
        const { productCode, quantity, purchasePrice, supplier, note } = req.body || {};

        if (!productCode || !quantity || Number(quantity) <= 0) {
            return res.status(400).json({ error: "Укажите товар и корректное количество" });
        }

        const product = await Product.findOne({ code: productCode });
        if (!product) {
            return res.status(404).json({ error: "Товар не найден" });
        }

        const qty = Number(quantity);

        product.qty = product.qty + qty;
        if (purchasePrice != null && purchasePrice !== "") {
            product.purchasePrice = Number(purchasePrice);
        }
        await product.save();

        const movement = await StockMovement.create({
            productCode: product.code,
            productName: product.name,
            unit: product.unit,
            type: "приход",
            quantity: qty,
            purchasePrice: purchasePrice != null && purchasePrice !== "" ? Number(purchasePrice) : undefined,
            supplier: supplier?.trim() || undefined,
            note: note?.trim() || undefined,
            recordedBy: req.session.user?.username,
            balanceAfter: product.qty
        });

        res.status(201).json(movement);

    } catch (err) {
        console.error("STOCK MOVEMENT incoming error:", err);
        res.status(500).json({ error: "Ошибка записи прихода" });
    }
});

// ---------- POST /api/stock-movements/outgoing ----------
// Ручной расход: брак, порча, возврат поставщику, коррекция учёта —
// то, что НЕ является продажей и НЕ является косяком сотрудника
// (для тех двух случаев уже есть свои разделы — Заказы и Сотрудники).
router.post('/api/stock-movements/outgoing', express.json(), async (req, res) => {
    try {
        const { productCode, quantity, reason, note } = req.body || {};

        if (!productCode || !quantity || Number(quantity) <= 0) {
            return res.status(400).json({ error: "Укажите товар и корректное количество" });
        }

        const product = await Product.findOne({ code: productCode });
        if (!product) {
            return res.status(404).json({ error: "Товар не найден" });
        }

        const qty = Number(quantity);

        if (product.qty < qty) {
            return res.status(400).json({ error: `На складе только ${product.qty} ${product.unit}, нельзя списать ${qty}` });
        }

        product.qty = product.qty - qty;
        await product.save();

        const movement = await StockMovement.create({
            productCode: product.code,
            productName: product.name,
            unit: product.unit,
            type: "расход",
            quantity: qty,
            reason: reason?.trim() || "другое",
            note: note?.trim() || undefined,
            recordedBy: req.session.user?.username,
            balanceAfter: product.qty
        });

        res.status(201).json(movement);

    } catch (err) {
        console.error("STOCK MOVEMENT outgoing error:", err);
        res.status(500).json({ error: "Ошибка записи расхода" });
    }
});

// ---------- GET /api/stock-movements ----------
// История движения с фильтрами: ?productCode=...&type=приход|расход&from=&to=
// Группируем по дням прямо в ответе — фронтенду не нужно самому разбирать
// даты, чтобы построить заголовки "13.08.2026" как на странице "Заказы".
router.get('/api/stock-movements', async (req, res) => {
    try {
        const filter = {};

        if (req.query.productCode) filter.productCode = req.query.productCode;
        if (req.query.type) filter.type = req.query.type;

        const dateFilter = buildDateFilter(req.query.from, req.query.to);
        if (dateFilter) filter.createdAt = dateFilter;

        const movements = await StockMovement.find(filter).sort({ createdAt: -1 }).limit(500);

        // Группировка по дню (ключ — YYYY-MM-DD в UTC+5, Алматы), сохраняя
        // порядок от новых дней к старым, как на странице "Заказы".
        const groupsMap = new Map();
        for (const m of movements) {
            const almatyMs = m.createdAt.getTime() + 5 * 60 * 60 * 1000;
            const dayKey = new Date(almatyMs).toISOString().slice(0, 10);
            if (!groupsMap.has(dayKey)) groupsMap.set(dayKey, []);
            groupsMap.get(dayKey).push(m);
        }

        const groups = [...groupsMap.entries()].map(([date, items]) => ({ date, items }));

        res.json({ groups, total: movements.length });

    } catch (err) {
        console.error("STOCK MOVEMENT history error:", err);
        res.status(500).json({ error: "Ошибка загрузки истории" });
    }
});

// ---------- GET /api/stock-movements/stats ----------
// Сводка за период для карточек наверху страницы: сколько пришло/ушло
// (раздельно для штучных и весовых/объёмных единиц), разбивка расхода по
// причинам, и топ-5 товаров по общему объёму движения.
router.get('/api/stock-movements/stats', async (req, res) => {
    try {
        const filter = {};
        const dateFilter = buildDateFilter(req.query.from, req.query.to);
        if (dateFilter) filter.createdAt = dateFilter;

        const movements = await StockMovement.find(filter);

        const totals = {
            incomingPieces: 0,
            incomingWeight: 0,
            outgoingPieces: 0,
            outgoingWeight: 0
        };

        const reasonTotals = {}; // { "брак": 12, "порча": 3, ... } — только для расхода
        const productTotals = new Map(); // productCode -> { name, unit, moved }

        for (const m of movements) {
            const fractional = isFractionalUnit(m.unit);

            if (m.type === "приход") {
                if (fractional) totals.incomingWeight += m.quantity;
                else totals.incomingPieces += m.quantity;
            } else {
                if (fractional) totals.outgoingWeight += m.quantity;
                else totals.outgoingPieces += m.quantity;

                const reasonKey = m.reason || "другое";
                reasonTotals[reasonKey] = (reasonTotals[reasonKey] || 0) + m.quantity;
            }

            const key = m.productCode;
            if (!productTotals.has(key)) {
                productTotals.set(key, { productCode: key, productName: m.productName, unit: m.unit, moved: 0 });
            }
            productTotals.get(key).moved += m.quantity;
        }

        const topProducts = [...productTotals.values()]
            .sort((a, b) => b.moved - a.moved)
            .slice(0, 5);

        res.json({
            totalMovements: movements.length,
            totals,
            reasonBreakdown: Object.entries(reasonTotals).map(([reason, quantity]) => ({ reason, quantity })),
            topProducts
        });

    } catch (err) {
        console.error("STOCK MOVEMENT stats error:", err);
        res.status(500).json({ error: "Ошибка загрузки статистики" });
    }
});

export default router;