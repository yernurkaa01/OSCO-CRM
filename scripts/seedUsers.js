// ============================================================
// scripts/seedUsers.js
// Разовый скрипт: переносит пользователей из .env (ADMIN_USER/
// ADMIN_PASS, CASHIER_USER/CASHIER_PASS) в базу данных, с хэшированием
// пароля. После этого логин работает через базу.
//
// Запуск:  node scripts/seedUsers.js
// ============================================================

import "dotenv/config"
import mongoose from "mongoose"
import bcrypt from "bcryptjs"
import User from "../models/User.js"

async function run() {
    await mongoose.connect(process.env.MONGO_URI)
    console.log("MongoDB подключен\n")

    const toSeed = [
        { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS, role: "owner" },
        { username: process.env.CASHIER_USER, password: process.env.CASHIER_PASS, role: "cashier" }
    ]

    for (const u of toSeed) {
        if (!u.username || !u.password) {
            console.log(`Пропущено — не заданы переменные окружения для роли "${u.role}"`)
            continue
        }

        const existing = await User.findOne({ username: u.username })
        if (existing) {
            console.log(`Пользователь "${u.username}" уже есть в базе — пропущено`)
            continue
        }

        const passwordHash = await bcrypt.hash(u.password, 10)
        await User.create({ username: u.username, passwordHash, role: u.role })
        console.log(`Создан пользователь "${u.username}" (роль: ${u.role})`)
    }

    console.log("\nГотово.")
    await mongoose.disconnect()
}

run().catch(err => {
    console.error("Ошибка:", err)
    process.exit(1)
})