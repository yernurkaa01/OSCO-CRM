import express from "express";
import Product from "../models/Product.js";
import Category from "../models/category.js";

const router = express.Router();

const LOW_STOCK_THRESHOLD = 50;

function statusOf(qty) {
  if (qty <= 0) return { code: 'out', label: 'Нет в наличии' };
  if (qty <= LOW_STOCK_THRESHOLD) return { code: 'low', label: `Мало (≤ ${LOW_STOCK_THRESHOLD})` };
  return { code: 'ok', label: 'Достаточно' };
}

function serialize(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  return {
    id: p._id.toString(),
    code: p.code,
    name: p.name,
    category: p.category,
    qty: p.qty,
    unit: p.unit,
    price: p.price,
    sum: p.qty * p.price,
    status: statusOf(p.qty),
    purchasePrice: p.purchasePrice ?? null,
    markupPercent: p.markupPercent ?? null,
    supplier: p.supplier ?? null,
  };
}

// ---------- GET /admin/api/warehouse/categories ----------
router.get('/api/warehouse/categories', async (req, res) => {
  try {
    const all = await Product.countDocuments();
    const cats = await Category.find().sort({ name: 1 });

    const categories = await Promise.all(
      cats.map(async (c) => ({
        key: c.key,
        name: c.name,
        icon: c.icon,
        count: await Product.countDocuments({ category: c.key }),
      }))
    );

    res.json({ all, categories });
  } catch (err) {
    console.error("WAREHOUSE categories error:", err);
    res.status(500).json({ error: "Ошибка загрузки категорий" });
  }
});

// ---------- POST /admin/api/warehouse/categories ----------
router.post('/api/warehouse/categories', express.json(), async (req, res) => {
  try {
    const { name, icon } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Укажите название категории' });
    }

    const key = name.trim();

    const exists = await Category.findOne({ key });
    if (exists) {
      return res.status(400).json({ error: 'Такая категория уже существует' });
    }

    const category = await Category.create({
      key,
      name: name.trim(),
      icon: icon || '📦',
    });

    res.status(201).json(category);
  } catch (err) {
    console.error("WAREHOUSE create category error:", err);
    res.status(500).json({ error: "Ошибка создания категории" });
  }
});
// ---------- DELETE /admin/api/warehouse/categories/:key ----------
router.delete('/api/warehouse/categories/:key', async (req, res) => {
  try {
    const inUse = await Product.countDocuments({ category: req.params.key });
    if (inUse > 0) {
      return res.status(400).json({ error: `Нельзя удалить — в категории ещё ${inUse} товар(ов)` });
    }

    const deleted = await Category.findOneAndDelete({ key: req.params.key });
    if (!deleted) {
      return res.status(404).json({ error: 'Категория не найдена' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("WAREHOUSE delete category error:", err);
    res.status(500).json({ error: "Ошибка удаления категории" });
  }
});

// ---------- GET /admin/api/warehouse/stats ----------
router.get('/api/warehouse/stats', async (req, res) => {
  try {
    const totalItems = await Product.countDocuments();
    const unitsAgg = await Product.aggregate([
      { $group: { _id: null, totalUnits: { $sum: "$qty" } } },
    ]);
    const totalUnits = unitsAgg[0]?.totalUnits || 0;
    const lowStock = await Product.countDocuments({
      qty: { $gt: 0, $lte: LOW_STOCK_THRESHOLD },
    });
    const outOfStock = await Product.countDocuments({ qty: { $lte: 0 } });

    res.json({
      totalItems,
      totalUnits,
      lowStock,
      outOfStock,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("WAREHOUSE stats error:", err);
    res.status(500).json({ error: "Ошибка загрузки статистики" });
  }
});

// ---------- GET /admin/api/warehouse/products ----------
router.get('/api/warehouse/products', async (req, res) => {
  try {
    const { category, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);

    const filter = {};
    if (category && category !== 'all') filter.category = category;
    if (search && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { code: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const total = await Product.countDocuments(filter);
    const docs = await Product.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      items: docs.map(serialize),
    });
  } catch (err) {
    console.error("WAREHOUSE products error:", err);
    res.status(500).json({ error: "Ошибка загрузки товаров" });
  }
});

// Генерирует следующий свободный код для категории на основе первой буквы
// (например "Цемент" -> C01, C02...; "Сухие смеси" -> C01... если совпадёт
// первая буква — тогда берём первую букву транслитом от общего счётчика).
async function generateNextCode() {
  // Берём самый большой существующий числовой суффикс среди всех кодов
  // вида <буквы><цифры> и просто продолжаем счёт от общего пула, чтобы
  // гарантированно не столкнуться с уже существующим кодом.
  const all = await Product.find({}, { code: 1 }).lean();
  let maxNum = 0;

  all.forEach((p) => {
    const match = String(p.code || '').match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  return 'P' + String(maxNum + 1).padStart(3, '0');
}

// ---------- POST /admin/api/warehouse/products ----------
router.post('/api/warehouse/products', express.json(), async (req, res) => {
  try {
    let {
      code, name, category, qty, unit, price,
      purchasePrice, markupPercent, supplier
    } = req.body || {};

    if (!name || !category || qty == null || !unit || price == null) {
      return res.status(400).json({ error: 'Заполните все обязательные поля товара (название, категория, кол-во, ед. изм., цена)' });
    }

    if (!code || !code.trim()) {
      code = await generateNextCode();
    }

    const product = await Product.create({
      code,
      name,
      category,
      qty: Number(qty),
      unit,
      price: Number(price),
      purchasePrice: purchasePrice != null && purchasePrice !== '' ? Number(purchasePrice) : undefined,
      markupPercent: markupPercent != null && markupPercent !== '' ? Number(markupPercent) : undefined,
      supplier: supplier || undefined,
    });

    res.status(201).json(serialize(product));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: `Товар с кодом "${req.body?.code}" уже существует` });
    }
    console.error("WAREHOUSE create error:", err);
    res.status(500).json({ error: "Ошибка создания товара" });
  }
});

// ---------- PUT /admin/api/warehouse/products/:id ----------
router.put('/api/warehouse/products/:id', express.json(), async (req, res) => {
  try {
    let {
      code, name, category, qty, unit, price,
      purchasePrice, markupPercent, supplier
    } = req.body || {};

    if (!name || !category || qty == null || !unit || price == null) {
      return res.status(400).json({ error: 'Заполните все обязательные поля товара (название, категория, кол-во, ед. изм., цена)' });
    }

    if (!code || !code.trim()) {
      const existingDoc = await Product.findById(req.params.id);
      code = existingDoc?.code || await generateNextCode();
    }

    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      {
        code,
        name,
        category,
        qty: Number(qty),
        unit,
        price: Number(price),
        purchasePrice: purchasePrice != null && purchasePrice !== '' ? Number(purchasePrice) : undefined,
        markupPercent: markupPercent != null && markupPercent !== '' ? Number(markupPercent) : undefined,
        supplier: supplier || undefined,
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Товар не найден' });
    }

    res.json(serialize(updated));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: `Товар с кодом "${req.body?.code}" уже существует` });
    }
    console.error("WAREHOUSE update error:", err);
    res.status(500).json({ error: "Ошибка обновления товара" });
  }
});

// ---------- DELETE /admin/api/warehouse/products/:id ----------
router.delete('/api/warehouse/products/:id', async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("WAREHOUSE delete error:", err);
    res.status(500).json({ error: "Ошибка удаления товара" });
  }
});

export default router;