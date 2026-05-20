// ============================================================
// public/clients.js — ЛОГИКА СТРАНИЦЫ КЛИЕНТОВ
// ============================================================

const params   = new URLSearchParams(window.location.search)
const adminKey = params.get("key") || ""

let allClients    = []
let selectedPhone = null


// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    // Навигация
    document.getElementById("linkOrders").href  = "/admin?key=" + adminKey
    document.getElementById("linkClients").href = "/admin/clients?key=" + adminKey

    // Живой поиск
    document.getElementById("clientSearch").addEventListener("input", renderClients)

    loadClients()
})


// ============================================================
// ЗАГРУЗКА КЛИЕНТОВ
// ============================================================

async function loadClients() {
    try {
        const res = await fetch("/clients?key=" + adminKey)
        allClients = await res.json()
        renderClients()
    } catch (err) {
        console.error("Ошибка загрузки клиентов:", err)
    }
}


// ============================================================
// РЕНДЕРИНГ ТАБЛИЦЫ КЛИЕНТОВ
// ============================================================

function renderClients() {
    const query    = document.getElementById("clientSearch").value.toLowerCase().trim()
    const filtered = allClients.filter(c =>
        String(c.name  || "").toLowerCase().includes(query) ||
        String(c.phone || "").toLowerCase().includes(query)
    )

    // Статистика
    const totalOrders  = filtered.reduce((s, c) => s + c.totalOrders, 0)
    const totalRevenue = filtered.reduce((s, c) => s + c.totalSpent,  0)

    document.getElementById("stat-clients").innerText = "Клиентов: " + filtered.length
    document.getElementById("stat-orders").innerText  = "Заказов: "  + totalOrders
    document.getElementById("stat-revenue").innerText = "Оборот: "   + formatPrice(totalRevenue)

    if (!filtered.length) {
        document.getElementById("clients-container").innerHTML = "<p style='color:#aaa'>Клиентов не найдено</p>"
        return
    }

    const rows = filtered.map(c => `
        <tr class="client-row ${selectedPhone === (c.telegramId || c.phone || c.name) ? "selected-row" : ""}"
            onclick="openClient('${encodeURIComponent(c.telegramId || c.phone || c.name)}', '${escapeHtml(c.name)}', '${c.phone}')">
            <td><b>${c.name || "-"}</b></td>
            <td>${c.phone || "-"}</td>
            <td><b>${c.totalOrders}</b></td>
            <td class="price">${formatPrice(c.totalSpent)}</td>
            <td style="color:#aaa; font-size:13px">${new Date(c.lastOrder).toLocaleDateString("ru-RU")}</td>
        </tr>
    `).join("")

    document.getElementById("clients-container").innerHTML = `
        <table>
            <tr>
                <th>Имя</th>
                <th>Телефон</th>
                <th>Заказов</th>
                <th>Потратил</th>
                <th>Последний заказ</th>
            </tr>
            ${rows}
        </table>
    `
}


// ============================================================
// КАРТОЧКА КЛИЕНТА — история заказов
// ============================================================

async function openClient(encodedKey, name, phone) {
    selectedPhone = decodeURIComponent(encodedKey)
    renderClients() // перерисуем чтобы подсветить строку

    document.getElementById("client-detail-empty").style.display   = "none"
    document.getElementById("client-detail-content").style.display = "block"
    document.getElementById("detail-name").innerText  = name  || "Клиент"
    document.getElementById("detail-phone").innerText = phone || ""
    document.getElementById("detail-orders").innerHTML  = "<p style='color:#aaa'>Загрузка...</p>"
    document.getElementById("detail-summary").innerHTML = ""

    try {
        const res = await fetch("/clients/" + encodedKey + "/orders?key=" + adminKey)
        const orders = await res.json()

        // Считаем итоги
        const totalSpent = orders
            .filter(o => o.status === "оплачено" || o.status === "подтверждено")
            .reduce((s, o) => s + Number(o.totalPrice || 0), 0)

        const firstDate = orders.length ? new Date(orders[orders.length - 1].createdAt).toLocaleDateString("ru-RU") : "-"
        const lastDate  = orders.length ? new Date(orders[0].createdAt).toLocaleDateString("ru-RU") : "-"

        document.getElementById("detail-summary").innerHTML = `
            <div class="summary-grid">
                <div class="summary-card">📦 Заказов<br><b>${orders.length}</b></div>
                <div class="summary-card">💰 Потратил<br><b>${formatPrice(totalSpent)}</b></div>
                <div class="summary-card">🗓 Первый заказ<br><b>${firstDate}</b></div>
                <div class="summary-card">🕐 Последний<br><b>${lastDate}</b></div>
            </div>
        `

        if (!orders.length) {
            document.getElementById("detail-orders").innerHTML = "<p style='color:#aaa'>Заказов нет</p>"
            return
        }

        const rows = orders.map(o => `
            <tr>
                <td style="font-size:13px; color:#888">${new Date(o.createdAt).toLocaleString("ru-RU")}</td>
                <td>${o.orderCode || "-"}</td>
                <td>${o.product   || "-"}</td>
                <td>${o.count     || "-"}</td>
                <td class="price">${formatPrice(o.totalPrice)}</td>
                <td><span class="status ${statusClass(o.status)}">${o.status}</span></td>
            </tr>
        `).join("")

        document.getElementById("detail-orders").innerHTML = `
            <table style="margin-top:15px">
                <tr>
                    <th>Дата</th>
                    <th>Код</th>
                    <th>Товар</th>
                    <th>Кол-во</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                </tr>
                ${rows}
            </table>
        `

    } catch (err) {
        document.getElementById("detail-orders").innerHTML = "<p style='color:red'>Ошибка загрузки</p>"
    }
}


// ============================================================
// УТИЛИТЫ
// ============================================================

function formatPrice(value) {
    return Number(value || 0).toLocaleString("ru-RU") + " ₸"
}

function statusClass(status) {
    if (status === "подтверждено" || status === "оплачено") return "status-confirmed"
    if (status === "отклонено")                             return "status-rejected"
    return "status-pending"
}

function escapeHtml(str) {
    return String(str || "").replace(/'/g, "\\'").replace(/"/g, "&quot;")
}