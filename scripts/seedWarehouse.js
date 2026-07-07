// ============================================================
// scripts/seedWarehouse.js
// Разовый скрипт — добавляет стартовые товары в базу.
// Запуск (из корня проекта): node scripts/seedWarehouse.js
// ============================================================

import "dotenv/config";
import mongoose from "mongoose";
import Product from "../models/Product.js";

const SEED_PRODUCTS = [
  { name: "Цемент Гежуба М450 (50 кг)", category: "cement", qty: 310, unit: "мешок", price: 2600 },
  { name: "Цемент Аккерманн M500 (1т)", category: "cement", qty: 20, unit: "мешок", price: 48500 },
  { name: "Цемент Аккерманн М600 (1т)", category: "cement", qty: 25, unit: "мешок", price: 50000 },
  { name: "Грунтовка глубокого проникновения", category: "paint", qty: 48, unit: "шт", price: 2100 },
  { name: "Эмульсия акриловая белая (14 кг)", category: "paint", qty: 32, unit: "ведро", price: 6500 },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB подключен");

  const existing = await Product.countDocuments();
  if (existing > 0) {
    console.log(`⚠️  В базе уже есть ${existing} товар(ов). Ничего не добавляю, чтобы не задублировать.`);
    console.log("Если хочешь всё же добавить — удали эту проверку или очисти коллекцию вручную.");
    await mongoose.disconnect();
    return;
  }


  await Product.insertMany(SEED_PRODUCTS);
  console.log(`✅ Добавлено ${SEED_PRODUCTS.length} товаров`);

  await mongoose.disconnect();
  console.log("Готово, соединение закрыто");
}

seed().catch((err) => {
  console.error("❌ Ошибка сидирования:", err);
  process.exit(1);
});