import express from "express";
import OpenAI from "openai";
import Employee from "../models/Employee.js";
import Incident from "../models/Incident.js";
import Product from "../models/Product.js";

const router = express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- POST /admin/api/incidents/parse ----------
// Разбирает свободную фразу ("Сергей эмульсия Rocks 7 кг разбил") на
// сотрудника/товар/количество/причину через AI, и подбирает совпадения
// в базе. НИЧЕГО не сохраняет — только предлагает варианты для подтверждения.
router.post('/api/incidents/parse', express.json(), async (req, res) => {
    try {
        const { text } = req.body || {};
        if (!text || !text.trim()) {
            return res.status(400).json({ error: "Пустой запрос" });
        }

        const ai = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content:
                        `Ты помощник склада строительного магазина. Извлеки из сообщения ` +
                        `имя сотрудника, название/описание товара, количество и причину (если есть). ` +
                        `Отвечай ТОЛЬКО JSON без пояснений и без markdown-разметки, строго такого вида: ` +
                        `{"employeeName": "...", "productQuery": "...", "quantity": число, "reason": "..." или null}. ` +
                        `Если количество явно не указано — ставь 1.`
                },
                { role: "user", content: text }
            ]
        });

        let parsed;
        try {
            parsed = JSON.parse(ai.choices[0].message.content);
        } catch (e) {
            return res.status(422).json({ error: "Не удалось разобрать фразу, попробуйте переформулировать" });
        }

        const employeeMatches = await Employee.find({
            name: { $regex: parsed.employeeName || "", $options: "i" }
        }).limit(5);

        const productMatches = await Product.find({
            $or: [
                { name: { $regex: parsed.productQuery || "", $options: "i" } },
                { code: { $regex: parsed.productQuery || "", $options: "i" } }
            ]
        }).limit(5);

        res.json({
            parsed,
            employeeMatches: employeeMatches.map(e => ({ id: e._id.toString(), name: e.name })),
            productMatches: productMatches.map(p => ({
                code: p.code,
                name: p.name,
                unit: p.unit,
                price: p.price,
                purchasePrice: p.purchasePrice ?? null,
                qty: p.qty
            }))
        });

    } catch (err) {
        console.error("INCIDENTS parse error:", err);
        res.status(500).json({ error: "Ошибка обработки запроса" });
    }
});

// ---------- GET /admin/api/employees ----------
// Список сотрудников с суммой их убытков (для справки при расчёте ЗП)
router.get('/api/employees', async (req, res) => {
    try {
        const employees = await Employee.find().sort({ name: 1 });

        const withLoss = await Promise.all(employees.map(async (e) => {
            const agg = await Incident.aggregate([
                { $match: { employee: e._id } },
                { $group: { _id: null, totalLoss: { $sum: "$lossValue" }, count: { $sum: 1 } } }
            ]);

            return {
                id: e._id.toString(),
                name: e.name,
                position: e.position || "",
                phone: e.phone || "",
                totalLoss: agg[0]?.totalLoss || 0,
                incidentCount: agg[0]?.count || 0
            };
        }));

        res.json(withLoss);
    } catch (err) {
        console.error("EMPLOYEES list error:", err);
        res.status(500).json({ error: "Ошибка загрузки сотрудников" });
    }
});

// ---------- POST /admin/api/employees ----------
router.post('/api/employees', express.json(), async (req, res) => {
    try {
        const { name, position, phone } = req.body || {};

        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Укажите имя сотрудника" });
        }

        const employee = await Employee.create({
            name: name.trim(),
            position: position?.trim() || undefined,
            phone: phone?.trim() || undefined
        });

        res.status(201).json(employee);
    } catch (err) {
        console.error("EMPLOYEES create error:", err);
        res.status(500).json({ error: "Ошибка добавления сотрудника" });
    }
});

// ---------- DELETE /admin/api/employees/:id ----------
router.delete('/api/employees/:id', async (req, res) => {
    try {
        const deleted = await Employee.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: "Сотрудник не найден" });
        }
        // Записи о косяках оставляем как есть (там уже сохранён снимок имени) —
        // история убытков не должна исчезать при удалении сотрудника из списка.
        res.json({ ok: true });
    } catch (err) {
        console.error("EMPLOYEES delete error:", err);
        res.status(500).json({ error: "Ошибка удаления сотрудника" });
    }
});

// ---------- GET /admin/api/employees/:id/incidents ----------
router.get('/api/employees/:id/incidents', async (req, res) => {
    try {
        const incidents = await Incident.find({ employee: req.params.id })
            .sort({ createdAt: -1 });
        res.json(incidents);
    } catch (err) {
        console.error("EMPLOYEES incidents list error:", err);
        res.status(500).json({ error: "Ошибка загрузки истории" });
    }
});

// ---------- POST /admin/api/incidents ----------
// Записывает "косяк": списывает товар со склада (он больше не продаётся)
// и фиксирует убыток по закупочной цене за конкретным сотрудником.
router.post('/api/incidents', express.json(), async (req, res) => {
    try {
        const { employeeId, productCode, quantity, reason } = req.body || {};

        if (!employeeId || !productCode || !quantity || Number(quantity) <= 0) {
            return res.status(400).json({ error: "Укажите сотрудника, товар и корректное количество" });
        }

        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ error: "Сотрудник не найден" });
        }

        const product = await Product.findOne({ code: productCode });
        if (!product) {
            return res.status(404).json({ error: "Товар не найден" });
        }

        const qty = Number(quantity);
        const lossValue = product.purchasePrice != null ? product.purchasePrice * qty : null;

        // Списываем товар со склада — он больше не подлежит продаже
        product.qty = Math.max(0, product.qty - qty);
        await product.save();

        const incident = await Incident.create({
            employee: employee._id,
            employeeName: employee.name,
            productCode: product.code,
            productName: product.name,
            unit: product.unit,
            quantity: qty,
            lossValue,
            reason: reason?.trim() || ""
        });

        res.status(201).json(incident);
    } catch (err) {
        console.error("INCIDENTS create error:", err);
        res.status(500).json({ error: "Ошибка записи инцидента" });
    }
});

// ---------- DELETE /admin/api/incidents/:id ----------
// Удаление ошибочной записи — возвращает товар обратно на склад.
router.delete('/api/incidents/:id', async (req, res) => {
    try {
        const incident = await Incident.findById(req.params.id);
        if (!incident) {
            return res.status(404).json({ error: "Запись не найдена" });
        }

        const product = await Product.findOne({ code: incident.productCode });
        if (product) {
            product.qty = product.qty + incident.quantity;
            await product.save();
        }

        await Incident.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error("INCIDENTS delete error:", err);
        res.status(500).json({ error: "Ошибка удаления записи" });
    }
});

export default router;