const express = require('express');
const router = express.Router();

// ==========================================================
// МОКОВЫЕ ДАННЫЕ
// Когда подключишь базу (Mongo/Postgres/SQLite) — просто замени
// этот массив и функции ниже на реальные запросы к БД.
// Структура полей продумана так, чтобы совпадать с тем, что
// ждёт фронтенд (warehouse.js), так что менять фронт не придётся.
// ==========================================================

// Пока подключены только 2 категории — остальные добавим позже,
// когда будешь готов расширять склад.
const CATEGORIES = [
  { key: 'cement', name: 'Цемент', icon: '🧱' },
  { key: 'paint', name: 'Эмульсии и краски', icon: '🎨' },
];

let PRODUCTS = [
  { id: 1, name: 'Цемент М500 (50 кг)', category: 'cement', qty: 310, unit: 'мешок', price: 2550 },
  { id: 2, name: 'Цемент М400 (50 кг)', category: 'cement', qty: 520, unit: 'мешок', price: 2450 },
  { id: 3, name: 'Цемент М550 (50 кг)', category: 'cement', qty: 120, unit: 'мешок', price: 2800 },
  { id: 4, name: 'Грунтовка глубокого проникновения', category: 'paint', qty: 48, unit: 'шт', price: 2100 },
  { id: 5, name: 'Эмульсия акриловая белая (14 кг)', category: 'paint', qty: 32, unit: 'ведро', price: 6500 },
];

// Пороги статуса — совпадают с легендой на скриншоте
const LOW_STOCK_THRESHOLD = 50;

function statusOf(qty) {
  if (qty <= 0) return { code: 'out', label: 'Нет в наличии' };
  if (qty <= LOW_STOCK_THRESHOLD) return { code: 'low', label: `Мало (≤ ${LOW_STOCK_THRESHOLD})` };
  return { code: 'ok', label: 'Достаточно' };
}

function withComputed(p) {
  return {
    ...p,
    sum: p.qty * p.price,
    status: statusOf(p.qty),
  };
}

// ---------- GET /admin/api/warehouse/categories ----------
router.get('/api/warehouse/categories', (req, res) => {
  const counts = CATEGORIES.map((c) => ({
    ...c,
    count: PRODUCTS.filter((p) => p.category === c.key).length,
  }));
  res.json({
    all: PRODUCTS.length,
    categories: counts,
  });
});

// ---------- GET /admin/api/warehouse/stats ----------
router.get('/api/warehouse/stats', (req, res) => {
  const computed = PRODUCTS.map(withComputed);
  res.json({
    totalItems: PRODUCTS.length,
    totalUnits: PRODUCTS.reduce((s, p) => s + p.qty, 0),
    lowStock: computed.filter((p) => p.status.code === 'low').length,
    outOfStock: computed.filter((p) => p.status.code === 'out').length,
    updatedAt: new Date().toISOString(),
  });
});

// ---------- GET /admin/api/warehouse/products ----------
// query: category, search, page (1-based), limit
router.get('/api/warehouse/products', (req, res) => {
  const { category, search } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);

  let items = PRODUCTS.map(withComputed);

  if (category && category !== 'all') {
    items = items.filter((p) => p.category === category);
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter((p) => p.name.toLowerCase().includes(q));
  }

  const total = items.length;
  const start = (page - 1) * limit;
  const pageItems = items.slice(start, start + limit);

  res.json({
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1),
    items: pageItems,
  });
});

// ---------- POST /admin/api/warehouse/products ----------
router.post('/api/warehouse/products', express.json(), (req, res) => {
  const { name, category, qty, unit, price } = req.body || {};
  if (!name || !category || qty == null || !unit || price == null) {
    return res.status(400).json({ error: 'Заполните все поля товара' });
  }
  const newProduct = {
    id: PRODUCTS.length ? Math.max(...PRODUCTS.map((p) => p.id)) + 1 : 1,
    name,
    category,
    qty: Number(qty),
    unit,
    price: Number(price),
  };
  PRODUCTS.push(newProduct);
  res.status(201).json(withComputed(newProduct));
});

// ---------- DELETE /admin/api/warehouse/products/:id ----------
router.delete('/api/warehouse/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const before = PRODUCTS.length;
  PRODUCTS = PRODUCTS.filter((p) => p.id !== id);
  if (PRODUCTS.length === before) {
    return res.status(404).json({ error: 'Товар не найден' });
  }
  res.json({ ok: true });
});

module.exports = router;