// ============================================================
// admin.js — КЛИЕНТСКАЯ ЛОГИКА СТРАНИЦЫ АДМИНИСТРАТОРА
// Подключается в admin.html через <script src="admin.js">
// ============================================================


// --- Глобальное состояние ---

// Дата фильтра — берём из URL-параметра ?date=...
const params       = new URLSearchParams(window.location.search)
const selectedDate = params.get("date") || ""
const adminKey     = params.get("key")  || ""

// НАВИГАЦИЯ
document.getElementById("linkClients").href =
    "/admin/clients?key=" + adminKey

document.getElementById("linkOrders").href =
    "/admin?key=" + adminKey

let allOrders = []
let currentSort = { field: "createdAt", direction: "desc" }

let lastPendingCount = 0
let firstPendingLoad = true

// ============================================================
// УТИЛИТЫ
// ============================================================

// Форматирует число в строку "12 500 ₸"
function formatPrice(value) {
    return Number(value || 0).toLocaleString("ru-RU") + " ₸"
}

// CSS-класс бейджа по статусу
function statusClass(status) {

    if (status === "оплачено")
        return "status-confirmed"

    if (status === "выдано")
        return "status-issued"

    if (status === "отклонено")
        return "status-rejected"

    return "status-pending"
}

// CSS-класс строки таблицы по статусу
function rowClass(status) {

    if (status === "Продано")
        return "row-confirmed"

    if (status === "выдано")
        return "row-issued"

    if (status === "отклонено")
        return "row-rejected"

    return ""
}

// Проигрывает звук при появлении новых заказов
function playNewOrderSound() {
    const audio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=")
    audio.play().catch(() => {}) // .catch — браузер может заблокировать без жеста пользователя
}


// ============================================================
// СТАТИСТИКА
// ============================================================

// Обновляет 4 плашки статистики над таблицей

function updateStats(orders) {

    const total = orders.length

    // Выручка
    const revenue = orders
        .filter(o =>
            o.status === "оплачено" ||
            o.status === "выдано"
        )
        .reduce((acc, o) =>
            acc + Number(o.totalPrice || 0), 0)

    // Успешно продано
    const sold = orders.filter(o =>
        o.status === "выдано"
    ).length

    // Возвраты
    const refunds = orders.filter(o =>
        o.status === "возврат"
    ).length

    // Отклонённые
    const rejected = orders.filter(o =>
        o.status === "отклонено"
    ).length

    document.getElementById("stat-total").innerText =
        "Всего: " + total

    document.getElementById("stat-confirmed").innerText =
        "Продано: " + sold

    document.getElementById("stat-rejected").innerText =
        "Отклонено: " + rejected

    document.getElementById("stat-sum").innerText =
        "Выручка: " + formatPrice(revenue)
}

// ============================================================
// СОРТИРОВКА
// ============================================================

// Возвращает новый отсортированный массив (исходный не мутирует)
function sortOrders(orders) {
    return [...orders].sort((a, b) => {
        let field = currentSort.field
        let av = a[field] || ""
        let bv = b[field] || ""

        // Даты сравниваем как числа (timestamp)
        if (field === "createdAt") {
            av = new Date(av).getTime()
            bv = new Date(bv).getTime()
        }

        // Цену и кол-во сравниваем как числа
        if (field === "totalPrice" || field === "count") {
            av = Number(av || 0)
            bv = Number(bv || 0)
        }

        if (av > bv) return currentSort.direction === "asc" ? 1 : -1
        if (av < bv) return currentSort.direction === "asc" ? -1 : 1
        return 0
    })
}

// Переключает сортировку при клике на заголовок таблицы
function setSort(field) {
    if (currentSort.field === field) {
        // Та же колонка — переключаем направление
        currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc"
    } else {
        // Новая колонка — начинаем с возрастания
        currentSort.field     = field
        currentSort.direction = "asc"
    }
    renderOrders()
}


// ============================================================
// ПОИСК
// ============================================================

// Возвращает заказы, прошедшие текстовый фильтр из поля поиска
function getFilteredOrders() {
    const query = document.getElementById("searchInput").value.toLowerCase().trim()
    if (!query) return allOrders

    return allOrders.filter(o =>
        String(o.orderCode || "").toLowerCase().includes(query) ||
        String(o.product   || "").toLowerCase().includes(query) ||
        String(o.name      || "").toLowerCase().includes(query) ||
        String(o.status    || "").toLowerCase().includes(query)
    )
}


// ============================================================
// РЕНДЕРИНГ ТАБЛИЦЫ ЗАКАЗОВ
// ============================================================

// Строит HTML таблиц (сгруппированных по дням) и вставляет в #orders-container
function renderOrders() {
    const filtered = sortOrders(getFilteredOrders())
    updateStats(filtered)

    // Группируем по дате — ключ: "14.05.2025"
    const grouped = {}
    filtered.forEach(o => {
        const day = new Date(o.createdAt).toLocaleDateString("ru-RU")
        if (!grouped[day]) grouped[day] = []
        grouped[day].push(o)
    })

    let content = ""

    for (let day in grouped) {
        const rows = grouped[day].map(o => `
            <tr class="${rowClass(o.status)}">
                <td>${new Date(o.createdAt).toLocaleTimeString()}</td>
                <td>${o.orderCode}</td>
                <td>${o.product}</td>
                <td>${o.count}</td>
                <td class="price">${formatPrice(o.totalPrice)}</td>
                <td><span class="status ${statusClass(o.status)}">${o.status}</span></td>
                <td>${o.name || "-"}</td>
                <td>
                    
                    <button class="details-btn"
                      onclick='showDetails(${JSON.stringify(o)})'>Подробнее</button>
                      ${o.status === "оплачено" ? `
                           <button class="btn confirm"
                           onclick='issueOrder("${o._id}")'>
                                    Выдать
                           
                            </button>
   
                            <button class="btn reject"
                             onclick="refundOrder('${o._id}')">
                                    Возврат
                            </button>` : ""}
                    
                </td>
            </tr>
        `).join("")

        content += `
            <h3>${day}</h3>
            <table>
                <tr>
                    <th onclick="setSort('createdAt')">Время</th>
                    <th onclick="setSort('orderCode')">Код</th>
                    <th onclick="setSort('product')">Товар</th>
                    <th onclick="setSort('count')">Кол-во</th>
                    <th onclick="setSort('totalPrice')">Сумма</th>
                    <th onclick="setSort('status')">Статус</th>
                    <th onclick="setSort('name')">Имя</th>
                    <th>Детали</th>
                </tr>
                ${rows}
            </table>
        `
    }

    if (!content) content = "<p>Заказов пока нет</p>"

    document.getElementById("orders-container").innerHTML = content
}


// ============================================================
// FETCH — ЗАПРОСЫ К API
// ============================================================

// Загружает все заказы (с фильтром по дате если задан)
async function loadOrders() {
    let url = "/orders"
    if (selectedDate) url += "?date=" + selectedDate

    const res = await fetch(url)
    allOrders = await res.json()
    renderOrders()
}

// Загружает ожидающие заказы и обновляет правую колонку
async function loadPendingOrders() {
    const res    = await fetch("/pending-orders")
    const orders = await res.json()

    // Звук только если это не первая загрузка и заказов стало больше
    if (!firstPendingLoad && orders.length > lastPendingCount) {
        playNewOrderSound()
    }

    lastPendingCount = orders.length
    firstPendingLoad = false

    let content = ""

    orders.forEach(o => {
        content += `
            <div class="order-card">
                <h3>Заказ #${o.orderCode}</h3>
                <p><b>Товар:</b> ${o.product}</p>
                <p><b>Кол-во:</b> ${o.count}</p>
                <p><b>Сумма:</b> <span class="price">${formatPrice(o.totalPrice)}</span></p>
                <p><b>Имя:</b> ${o.name || "-"}</p>
                <p><b>Время:</b> ${new Date(o.createdAt).toLocaleTimeString()}</p>
                <p><b>Статус:</b> <span class="status status-pending">ожидание</span></p>
                ${o.receiptFileId ? `
<p>
    <a href="/receipt/${o.receiptFileId}" target="_blank">
        📄 PDF чек
    </a>
</p>
` : ""}
                <button class="btn confirm" onclick="confirmOrder('${o._id}')">Оплачено</button>
                <button class="btn reject"  onclick="rejectOrder('${o._id}')">Отклонить</button>
                <button class="details-btn" onclick='showDetails(${JSON.stringify(o)})'>Подробнее</button>
            </div>
        `
    })

    if (!content) content = "<p>Новых заказов нет</p>"

    document.getElementById("pending-container").innerHTML = content
}


// ============================================================
// МОДАЛЬНОЕ ОКНО — ДЕТАЛИ ЗАКАЗА
// ============================================================

// Открывает модалку с полными данными заказа
function showDetails(o) {
    document.getElementById("detailsContent").innerHTML = `
        <p><b>Код заказа:</b>  ${o.orderCode || "-"}</p>
        <p><b>Товар:</b>       ${o.product   || "-"}</p>
        <p><b>Количество:</b>  ${o.count     || "-"}</p>
        <p><b>Сумма:</b>       ${formatPrice(o.totalPrice)}</p>
        <p><b>Статус:</b>      ${o.status    || "-"}</p>
        <p><b>Имя:</b>         ${o.name      || "-"}</p>
        <p><b>Телефон:</b>     ${o.phone     || "-"}</p>
        <p><b>Адрес:</b>       ${o.address   || "-"}</p>
        <p><b>Комментарий:</b></p>

        <textarea
            id="managerComment"
            style="
                width:100%;
                height:100px;
                margin-top:10px;
        padding:10px;
        box-sizing:border-box;
    "
            >${o.comment || ""}</textarea>

            <button 
    onclick="saveComment('${o._id}')"

    style="
        margin-top:10px;
        padding:10px 15px;
        background:black;
        color:white;
        border:none;
        cursor:pointer;
    "
>
    Сохранить
            </button>

            <p><b>Дата:</b>${new Date(o.createdAt).toLocaleString("ru-RU")}</p>

    `
    document.getElementById("detailsModal").style.display = "block"
}

// Сохранить комментарий
async function saveComment(id) {

    const comment =
        document.getElementById("managerComment").value

    await fetch("/update-comment/" + id, {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            comment
        })
    })

    loadOrders()

    alert("Комментарий сохранён")
}

// Закрывает модальное окно
function closeDetails() {
    document.getElementById("detailsModal").style.display = "none"
}

// Клик по тёмному оверлею — закрывает модалку
window.onclick = function(event) {
    const modal = document.getElementById("detailsModal")
    if (event.target === modal) closeDetails()
}


// ============================================================
// ДЕЙСТВИЯ С ЗАКАЗАМИ
// ============================================================

// Подтверждает заказ: POST-запрос → обновляем обе колонки
async function confirmOrder(id) {
    await fetch("/confirm-order/" + id, { method: "POST" })
    loadPendingOrders()
    loadOrders()
}

// Отклоняет заказ: POST-запрос → обновляем обе колонки
async function rejectOrder(id) {
    await fetch("/reject-order/" + id, { method: "POST" })
    loadPendingOrders()
    loadOrders()
}

// Выдать заказ
async function issueOrder(id) {

    await fetch("/issue-order/" + id, {
        method: "POST"
    })

    loadOrders()
}

// Возврат средств
async function refundOrder(id) {

    await fetch("/refund-order/" + id, {
        method: "POST"
    })

    loadOrders()
}
// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    const params   = new URLSearchParams(window.location.search)
    const adminKey = params.get("key") || ""
    const date     = params.get("date") || ""

    // Заполняем скрытое поле ключа в форме фильтра
    document.getElementById("adminKeyInput").value = adminKey

    // Заполняем поле даты если она есть в URL
    if (date) {
        document.getElementById("dateInput").value = date
    }

    // ✅ ВОТ ЭТО ИСПРАВЛЯЕТ "Показать все"
    document.getElementById("clearLink").href = "/admin?key=" + adminKey

    // Живой поиск
    document.getElementById("searchInput").addEventListener("input", renderOrders)

    loadOrders()
    loadPendingOrders()

    setInterval(loadOrders,        3000)
    setInterval(loadPendingOrders, 3000)
})