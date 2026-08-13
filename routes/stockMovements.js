import express from "express";
import Product from "../models/Product.js";
import StockMovement from "../models/StockMovement.js";

const router = express.Router();

// ---------- POST /admin/api/stock-movements/incoming ----------
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

// ---------- POST /admin/api/stock-movements/outgoing ----------
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

// ---------- GET /admin/api/stock-movements ----------
// История движения с фильтрами: ?productCode=...&type=приход|расход&from=&to=
router.get('/api/stock-movements', async (req, res) => {
    try {
        const filter = {};

        if (req.query.productCode) filter.productCode = req.query.productCode;
        if (req.query.type) filter.type = req.query.type;

        if (req.query.from) {
            filter.createdAt = { $gte: new Date(req.query.from + "T00:00:00") };
        }
        if (req.query.to) {
            filter.createdAt = filter.createdAt || {};
            filter.createdAt.$lte = new Date(req.query.to + "T23:59:59");
        }

        const movements = await StockMovement.find(filter).sort({ createdAt: -1 }).limit(500);
        res.json(movements);

    } catch (err) {
        console.error("STOCK MOVEMENT history error:", err);
        res.status(500).json({ error: "Ошибка загрузки истории" });
    }
});

export default router;