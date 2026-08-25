import express from "express";
import Employee from "../models/Employee.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { sellStock, restockStock } from "../services/stockCheck.js";

const router = express.Router();

function generateOrderCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Проверка, что сотрудник залогинен на этом интерфейсе (отдельная
// сессия от админского логина — своё поле req.session.employee)
function checkEmployeeAuth(req, res, next) {
    if (!req.session.employee) {
        return res.status(401).json({ error: "Не авторизован" });
    }
    next();
}

// ---------- POST /employee/login ----------
router.post('/employee/login', express.json(), async (req, res) => {
    try {
        const { username, password } = req.body || {};

        const employee = await Employee.findOne({ username, password });
        if (!employee) {
            return res.status(401).json({ error: "Неверный логин или пароль" });
        }

        req.session.employee = { id: employee._id.toString(), name: employee.name };
        res.json({ ok: true, name: employee.name });

    } catch (err) {
        console.error("EMPLOYEE LOGIN error:", err);
        res.status(500).json({ error: "Ошибка входа" });
    }
});

// ---------- POST /employee/logout ----------
router.post('/employee/logout', (req, res) => {
    delete req.session.employee;
    res.json({ ok: true });
});

// ---------- GET /employee/me ----------
router.get('/employee/me', (req, res) => {
    if (!req.session.employee) {
        return res.json({ loggedIn: false });
    }
    res.json({ loggedIn: true, name: req.session.employee.name });
});

// ---------- GET /employee/products?search=... ----------
router.get('/employee/products', checkEmployeeAuth, async (req, res) => {
    try {
        const search = (req.query.search || "").trim();

        const filter = search
            ? { $or: [
                { name: { $regex: escapeRegex(search), $options: "i" } },
                { code: { $regex: escapeRegex(search), $options: "i" } }
              ] }
            : {};

        const products = await Product.find(filter).limit(20);

        res.json(products.map(p => ({
            code: p.code,
            name: p.name,
            unit: p.unit,
            price: p.price,
            available: Math.max(0, p.qty - (p.reservedQty || 0))
        })));

    } catch (err) {
        console.error("EMPLOYEE products error:", err);
        res.status(500).json({ error: "Ошибка поиска товаров" });
    }
});

// ---------- POST /employee/sales ----------
// Мгновенная продажа: без резерва и без ожидания оплаты — сразу
// списывает склад и создаёт заказ(ы) со статусом "выдано".
// Все товары одной корзины делят один orderCode — так же, как заказы
// из Telegram-бота — чтобы их можно было проверить как единый заказ.
router.post('/employee/sales', checkEmployeeAuth, express.json(), async (req, res) => {
    try {
        const { cart } = req.body || {};

        if (!Array.isArray(cart) || !cart.length) {
            return res.status(400).json({ error: "Корзина пуста" });
        }

        const employee = await Employee.findById(req.session.employee.id);
        if (!employee) {
            return res.status(401).json({ error: "Сотрудник не найден" });
        }

        const orderCode = generateOrderCode();
        const sold = [];

        for (const item of cart) {
            const product = await Product.findOne({ code: item.code });
            if (!product) {
                for (const s of sold) await restockStock(s.name, s.qty);
                return res.status(404).json({ error: `Товар с кодом ${item.code} не найден` });
            }

            const ok = await sellStock(item.code, item.qty);
            if (!ok) {
                for (const s of sold) await restockStock(s.name, s.qty);
                return res.status(409).json({ error: `Не хватает остатка: "${product.name}"` });
            }

            sold.push({ name: product.name, qty: item.qty });

            await Order.create({
                orderCode,
                product: product.name,
                productCode: product.code,
                count: item.qty,
                totalPrice: item.qty * product.price,
                source: "employee",
                soldByEmployee: employee._id,
                soldByEmployeeName: employee.name,
                status: "выдано"
            });
        }

        res.status(201).json({ ok: true, orderCode });

    } catch (err) {
        console.error("EMPLOYEE SALE error:", err);
        res.status(500).json({ error: "Ошибка оформления продажи" });
    }
});

// ---------- GET /employee/my-sales ----------
// Личный кабинет — история СВОИХ продаж (сгруппированных по orderCode),
// не видит продажи других сотрудников.
router.get('/employee/my-sales', checkEmployeeAuth, async (req, res) => {
    try {
        const orders = await Order.find({
            source: "employee",
            soldByEmployee: req.session.employee.id
        }).sort({ createdAt: -1 }).limit(200);

        // Группируем по orderCode — один "чек" может содержать несколько товаров
        const grouped = {};
        orders.forEach(o => {
            if (!grouped[o.orderCode]) {
                grouped[o.orderCode] = {
                    orderCode: o.orderCode,
                    createdAt: o.createdAt,
                    items: [],
                    total: 0
                };
            }
            grouped[o.orderCode].items.push({
                product: o.product,
                count: o.count,
                totalPrice: o.totalPrice
            });
            grouped[o.orderCode].total += o.totalPrice || 0;
        });

        res.json(Object.values(grouped).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));

    } catch (err) {
        console.error("EMPLOYEE my-sales error:", err);
        res.status(500).json({ error: "Ошибка загрузки истории" });
    }
});

export default router;