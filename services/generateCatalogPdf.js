// ============================================================
// services/generateCatalogPdf.js
// Генерирует PDF-каталог товаров категории "на лету" из базы
// (Product), а не из статичного файла. Гарантирует, что цены и
// коды в PDF всегда совпадают с тем, что реально на складе.
// ============================================================

import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Шрифты с поддержкой кириллицы — должны лежать в files/fonts/
// (встроенные шрифты PDF кириллицу не поддерживают)
const FONT_REGULAR = path.join(__dirname, "..", "files", "fonts", "DejaVuSans.ttf")
const FONT_BOLD = path.join(__dirname, "..", "files", "fonts", "DejaVuSans-Bold.ttf")

/**
 * Генерирует PDF-каталог для одной категории товаров.
 * @param {string} categoryName - название категории (например "Сухие смеси")
 * @param {Array} products - массив документов Product (code, name, price, unit)
 * @returns {Promise<Buffer>}
 */
export function generateCatalogPdf(categoryName, products) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40, size: "A4" })
            const chunks = []

            doc.on("data", chunk => chunks.push(chunk))
            doc.on("end", () => resolve(Buffer.concat(chunks)))
            doc.on("error", reject)

            doc.registerFont("main", FONT_REGULAR)
            doc.registerFont("main-bold", FONT_BOLD)

            // --- Заголовок ---
            doc.font("main-bold").fontSize(18).fillColor("#111")
                .text(`Каталог: ${categoryName}`, { align: "left" })

            doc.moveDown(0.3)
            doc.font("main").fontSize(9).fillColor("#888")
                .text(`Актуально на ${new Date().toLocaleString("ru-RU")}`, { align: "left" })

            doc.moveDown(1)

            const startX = doc.x
            const tableWidth = 500

            const colCode = startX
            const colCodeW = 45
            const colName = startX + colCodeW
            const colNameW = 315
            const colPrice = colName + colNameW
            const colPriceW = 90
            const colUnit = colPrice + colPriceW
            const colUnitW = 50

            let y = doc.y

            // --- Заголовок таблицы ---
            doc.font("main-bold").fontSize(10).fillColor("#fff")
            doc.rect(startX, y, tableWidth, 20).fill("#343a40")
            doc.fillColor("#fff")
            doc.text("Код", colCode + 5, y + 5, { width: colCodeW - 5 })
            doc.text("Наименование", colName + 5, y + 5, { width: colNameW - 5 })
            doc.text("Цена", colPrice, y + 5, { width: colPriceW, align: "right" })
            doc.text("Ед.", colUnit, y + 5, { width: colUnitW })

            y += 20

            doc.font("main").fontSize(9.5)

            products.forEach((p, i) => {
                // Оценка высоты строки по длине названия (перенос строк)
                const nameHeight = doc.heightOfString(p.name, { width: colNameW - 10 })
                const rowHeight = Math.max(18, nameHeight + 6)

                if (y + rowHeight > 780) {
                    doc.addPage()
                    y = 40

                    // Повторяем заголовок таблицы на новой странице
                    doc.font("main-bold").fontSize(10).fillColor("#fff")
                    doc.rect(startX, y, tableWidth, 20).fill("#343a40")
                    doc.fillColor("#fff")
                    doc.text("Код", colCode + 5, y + 5, { width: colCodeW - 5 })
                    doc.text("Наименование", colName + 5, y + 5, { width: colNameW - 5 })
                    doc.text("Цена", colPrice, y + 5, { width: colPriceW, align: "right" })
                    doc.text("Ед.", colUnit, y + 5, { width: colUnitW })
                    y += 20
                    doc.font("main").fontSize(9.5)
                }

                const rowColor = i % 2 === 0 ? "#ffffff" : "#f5f5f5"
                doc.rect(startX, y, tableWidth, rowHeight).fill(rowColor)
                doc.fillColor("#111")

                doc.text(p.code || "-", colCode + 5, y + 3, { width: colCodeW - 5 })
                doc.text(p.name, colName + 5, y + 3, { width: colNameW - 10 })
                doc.text(`${Number(p.price || 0).toLocaleString("ru-RU")} тг`, colPrice, y + 3, { width: colPriceW, align: "right" })
                doc.text(p.unit || "-", colUnit, y + 3, { width: colUnitW })

                y += rowHeight
            })

            doc.end()
        } catch (err) {
            reject(err)
        }
    })
}