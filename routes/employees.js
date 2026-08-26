import express from "express";
import mongoose from "mongoose";
import OpenAI from "openai";
import Employee from "../models/Employee.js";
import Incident from "../models/Incident.js";
import Product from "../models/Product.js";

const router = express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Экранируем спецсимволы регулярки, чтобы скобки/точки в названиях
// товаров ("Цемент (Гежуба М450)") не ломали поиск.
function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- POST /admin/api/incidents/parse ----------
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
            name: { $regex: escapeRegex(parsed.employeeName || ""), $options: "i" }
        }).limit(5);

        const words = String(parsed.productQuery || "")
            .split(/\s+/)
            .map(w => w.trim())
            .filter(Boolean);

        const wordConditions = words.map(w => ({
            $or: [
                { name: { $regex: escapeRegex(w), $options: "i" } },
                { code: { $regex: escapeRegex(w), $options: "i" } }
            ]
        }));

        const productMatches = wordConditions.length
            ? await Product.find({ $and: wordConditions }).limit(5)
            : [];

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
                username: e.username || "",
                bonusPercent: e.bonusPercent || 0,
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
// Теперь также принимает логин/пароль (для входа на /sell) и процент
// бонуса (для расчёта ежемесячных бонусов) — оба поля необязательны.
router.post('/api/employees', express.json(), async (req, res) => {
    try {
        const { name, position, phone, username, password, bonusPercent } = req.body || {};

        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Укажите имя сотрудника" });
        }

        if (username && username.trim()) {
            const existing = await Employee.findOne({ username: username.trim() });
            if (existing) {
                return res.status(400).json({ error: "Такой логин уже занят" });
            }
        }

        const employee = await Employee.create({
            name: name.trim(),
            position: position?.trim() || undefined,
            phone: phone?.trim() || undefined,
            username: username?.trim() || undefined,
            password: password?.trim() || undefined,
            bonusPercent: bonusPercent != null && bonusPercent !== "" ? Number(bonusPercent) : 0
        });

        res.status(201).json(employee);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: "Такой логин уже занят" });
        }
        console.error("EMPLOYEES create error:", err);
        res.status(500).json({ error: "Ошибка добавления сотрудника" });
    }
});

// ---------- PUT /admin/api/employees/:id ----------
// Редактирование существующего сотрудника — в частности, чтобы можно
// было позже добавить логин/пароль/процент бонуса тому, у кого их не было.
router.put('/api/employees/:id', express.json(), async (req, res) => {
    try {
        const { name, position, phone, username, password, bonusPercent } = req.body || {};

        if (username && username.trim()) {
            const existing = await Employee.findOne({ username: username.trim(), _id: { $ne: req.params.id } });
            if (existing) {
                return res.status(400).json({ error: "Такой логин уже занят" });
            }
        }

        const update = {
            name: name?.trim(),
            position: position?.trim() || undefined,
            phone: phone?.trim() || undefined,
            username: username?.trim() || undefined,
            bonusPercent: bonusPercent != null && bonusPercent !== "" ? Number(bonusPercent) : 0
        };

        // Пароль обновляем, только если реально прислали новый —
        // пустое поле не должно затирать уже существующий пароль.
        if (password && password.trim()) {
            update.password = password.trim();
        }

        const employee = await Employee.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
        if (!employee) {
            return res.status(404).json({ error: "Сотрудник не найден" });
        }

        res.json(employee);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: "Такой логин уже занят" });
        }
        console.error("EMPLOYEES update error:", err);
        res.status(500).json({ error: "Ошибка обновления сотрудника" });
    }
});

// ---------- DELETE /admin/api/employees/:id ----------
router.delete('/api/employees/:id', async (req, res) => {
    try {
        const deleted = await Employee.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: "Сотрудник не найден" });
        }
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

// ---------- GET /admin/api/incidents/categories ----------
router.get('/api/incidents/categories', async (req, res) => {
    try {
        const categories = await Product.distinct('category');
        res.json(categories.filter(Boolean).sort());
    } catch (err) {
        console.error("INCIDENTS categories error:", err);
        res.status(500).json({ error: "Ошибка загрузки категорий" });
    }
});

function buildIncidentMatchStage({ dateFrom, dateTo, employeeId, search }) {
    const match = {};

    if (dateFrom || dateTo) {
        match.createdAt = {};
        if (dateFrom) match.createdAt.$gte = new Date(`${dateFrom}T00:00:00`);
        if (dateTo) match.createdAt.$lte = new Date(`${dateTo}T23:59:59`);
    }

    if (employeeId) {
        match.employee = mongoose.Types.ObjectId.isValid(employeeId)
            ? new mongoose.Types.ObjectId(employeeId)
            : null;
    }

    if (search && search.trim()) {
        const re = { $regex: escapeRegex(search.trim()), $options: "i" };
        match.$or = [
            { employeeName: re },
            { productName: re },
            { productCode: re },
            { reason: re }
        ];
    }

    return match;
}

// ---------- GET /admin/api/incidents/list ----------
router.get('/api/incidents/list', async (req, res) => {
    try {
        const {
            dateFrom, dateTo, employeeId, category, search,
            page = 1, limit = 6
        } = req.query;

        const match = buildIncidentMatchStage({ dateFrom, dateTo, employeeId, search });
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 6);

        const pipeline = [
            { $match: match },
            {
                $lookup: {
                    from: "products",
                    localField: "productCode",
                    foreignField: "code",
                    as: "product"
                }
            },
            { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } }
        ];

        if (category && category !== "all") {
            pipeline.push({ $match: { "product.category": category } });
        }

        pipeline.push(
            { $sort: { createdAt: -1 } },
            {
                $facet: {
                    items: [
                        { $skip: (pageNum - 1) * limitNum },
                        { $limit: limitNum },
                        {
                            $project: {
                                _id: 1,
                                createdAt: 1,
                                employee: 1,
                                employeeName: 1,
                                productCode: 1,
                                productName: 1,
                                unit: 1,
                                quantity: 1,
                                lossValue: 1,
                                reason: 1,
                                category: "$product.category"
                            }
                        }
                    ],
                    totalCount: [{ $count: "count" }]
                }
            }
        );

        const [result] = await Incident.aggregate(pipeline);
        const items = result?.items || [];
        const total = result?.totalCount?.[0]?.count || 0;

        res.json({
            items,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.max(1, Math.ceil(total / limitNum))
        });
    } catch (err) {
        console.error("INCIDENTS list error:", err);
        res.status(500).json({ error: "Ошибка загрузки записей" });
    }
});

// ---------- GET /admin/api/incidents/stats ----------
router.get('/api/incidents/stats', async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;
        const match = buildIncidentMatchStage({ dateFrom, dateTo });

        const [totalEmployees, totals, topEmployees, topProducts] = await Promise.all([
            Employee.countDocuments(),

            Incident.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        totalLoss: { $sum: { $ifNull: ["$lossValue", 0] } },
                        totalIncidents: { $sum: 1 }
                    }
                }
            ]),

            Incident.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: "$employee",
                        name: { $first: "$employeeName" },
                        totalLoss: { $sum: { $ifNull: ["$lossValue", 0] } }
                    }
                },
                { $sort: { totalLoss: -1 } },
                { $limit: 5 }
            ]),

            Incident.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: "$productCode",
                        name: { $first: "$productName" },
                        totalLoss: { $sum: { $ifNull: ["$lossValue", 0] } }
                    }
                },
                { $sort: { totalLoss: -1 } },
                { $limit: 3 }
            ])
        ]);

        const totalLoss = totals[0]?.totalLoss || 0;
        const totalIncidents = totals[0]?.totalIncidents || 0;

        res.json({
            totalEmployees,
            totalLoss,
            totalIncidents,
            avgLossPerEmployee: totalEmployees > 0 ? Math.round(totalLoss / totalEmployees) : 0,
            topEmployees: topEmployees.map(e => ({ id: e._id?.toString(), name: e.name, totalLoss: e.totalLoss })),
            topProducts: topProducts.map(p => ({ code: p._id, name: p.name, totalLoss: p.totalLoss }))
        });
    } catch (err) {
        console.error("INCIDENTS stats error:", err);
        res.status(500).json({ error: "Ошибка загрузки статистики" });
    }
});

// ---------- POST /admin/api/incidents ----------
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