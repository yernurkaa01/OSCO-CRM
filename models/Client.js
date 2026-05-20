// ============================================================
// models/Client.js — МОДЕЛЬ КЛИЕНТА (MongoDB / Mongoose)
// ============================================================

const mongoose = require("mongoose")

const clientSchema = new mongoose.Schema({
    name:       { type: String },                  // Имя клиента
    phone:      { type: String, unique: true },    // Телефон — уникальный идентификатор
    username:   { type: String },                  // Telegram username (@username)
    telegramId: { type: Number },                  // Telegram ID пользователя
}, {
    timestamps: true   // Автоматически добавляет createdAt и updatedAt
})

module.exports = mongoose.model("Client", clientSchema)