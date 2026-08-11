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
            name: { $regex: escapeRegex(parsed.employeeName || ""), $options: "i" }
        }).limit(5);

        // Ищем товар по каждому слову запроса отдельно (а не по фразе целиком),
        // чтобы порядок слов и пунктуация ("Цемент (Гежуба М450)" vs
        // "Гежуба М450 Цемент") не мешали найти совпадение.
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

// ---------- GET /admin/api/incidents/categories ----------
// Список категорий товаров — для фильтра на странице сотрудников.
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
            : null; // некорректный id — просто ничего не найдёт
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
// Общий список инцидентов (не по одному сотруднику) с фильтрами и пагинацией —
// для главной таблицы на странице "Сотрудники".
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
// Сводка для карточек сверху + сайдбар (топ-5 сотрудников, топ-3 товара).
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