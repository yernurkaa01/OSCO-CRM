(function () {
    const API = '/admin/api/reports/sales';

    let currentItems = [];
    let grandTotalValue = 0;
    let dailyChart = null;
    let categoryChart = null;

    let currentPage = 1;
    const PAGE_SIZE = 10;

    const CATEGORY_COLORS = ['#2551d9', '#5b8def', '#a9c6ff', '#c9c9c9', '#e08a1e'];

    function formatMoney(n) {
        return Number(n || 0).toLocaleString('ru-RU') + ' \u20B8';
    }

    function formatDate(iso) {
        return new Date(iso).toLocaleDateString('ru-RU');
    }

    function getFilteredSorted() {
        const query = document.getElementById('searchInput').value.toLowerCase().trim();
        const category = document.getElementById('categorySelect').value;
        const sortBy = document.getElementById('sortSelect').value;

        let filtered = currentItems.filter(i => {
            const matchesQuery = i.product.toLowerCase().includes(query);
            const matchesCategory = category === 'all' || i.category === category;
            return matchesQuery && matchesCategory;
        });

        filtered = filtered.slice().sort((a, b) => {
            if (sortBy === 'sum') return b.totalSum - a.totalSum;
            if (sortBy === 'name') return a.product.localeCompare(b.product, 'ru');
            return b.totalCount - a.totalCount;
        });

        return filtered;
    }

    function renderCategoryLeader() {
        const category = document.getElementById('categorySelect').value;
        const banner = document.getElementById('categoryLeader');

        if (category === 'all') {
            banner.style.display = 'none';
            return;
        }

        // Лидер считаем по всей категории целиком (без учёта поиска/страницы),
        // сортируем по количеству продано — это и есть "лучше всего продаётся"
        const categoryItems = currentItems.filter(i => i.category === category);

        if (!categoryItems.length) {
            banner.style.display = 'none';
            return;
        }

        const sortBy = document.getElementById('sortSelect').value;

        const leader = categoryItems.slice().sort((a, b) => {
            if (sortBy === 'sum') return b.totalSum - a.totalSum;
            if (sortBy === 'name') return a.product.localeCompare(b.product, 'ru');

            // "По количеству" (и по умолчанию): сначала по количеству,
            // при равенстве — по выручке (чтобы не выбирать лидера случайно)
            if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
            return b.totalSum - a.totalSum;
        })[0];

        banner.style.display = 'flex';
        banner.innerHTML =
            `🏆 Лидер категории «${category}»: <b>${leader.product}</b> — ` +
            `${leader.totalCount} ${leader.unit} · <span class="leader-money">${formatMoney(leader.totalSum)}</span>`;
    }

    function renderTable() {
        renderCategoryLeader();

        const filtered = getFilteredSorted();
        const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);

        if (currentPage > totalPages) currentPage = totalPages;

        const start = (currentPage - 1) * PAGE_SIZE;
        const pageItems = filtered.slice(start, start + PAGE_SIZE);

        if (!filtered.length) {
            document.getElementById('reportBody').innerHTML =
                '<tr><td colspan="7" class="empty-row">Ничего не найдено</td></tr>';
            document.getElementById('footerInfo').textContent = 'Показано 0 из 0 товаров';
            document.getElementById('pagination').innerHTML = '';
            return;
        }

        document.getElementById('reportBody').innerHTML = pageItems.map(item => {
            const avgPrice = item.totalCount > 0 ? Math.round(item.totalSum / item.totalCount) : 0;
            const share = grandTotalValue > 0 ? ((item.totalSum / grandTotalValue) * 100).toFixed(1) : '0.0';

            return `
                <tr>
                    <td>${item.product}</td>
                    <td>${item.category}</td>
                    <td>${item.totalCount} ${item.unit}</td>
                    <td>${item.orders}</td>
                    <td>${formatMoney(avgPrice)}</td>
                    <td class="money">${formatMoney(item.totalSum)}</td>
                    <td>${share}%</td>
                </tr>
            `;
        }).join('');

        const end = Math.min(start + PAGE_SIZE, filtered.length);
        document.getElementById('footerInfo').textContent =
            `Показано ${end} из ${filtered.length} товаров`;

        renderPagination(totalPages);
    }

    function renderPagination(totalPages) {
        let html = '';
        html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="ReportsPagination.goTo(${currentPage - 1})">\u2039</button>`;

        const pagesToShow = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
        let prev = null;
        [...pagesToShow].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b).forEach(p => {
            if (prev !== null && p - prev > 1) html += `<span>\u2026</span>`;
            html += `<button class="${p === currentPage ? 'active' : ''}" onclick="ReportsPagination.goTo(${p})">${p}</button>`;
            prev = p;
        });

        html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="ReportsPagination.goTo(${currentPage + 1})">\u203a</button>`;
        document.getElementById('pagination').innerHTML = html;
    }

    window.ReportsPagination = {
        goTo(page) {
            currentPage = page;
            renderTable();
        }
    };

    function populateCategoryFilter() {
        const select = document.getElementById('categorySelect');
        const categories = [...new Set(currentItems.map(i => i.category))].sort((a, b) => a.localeCompare(b, 'ru'));

        select.innerHTML = '<option value="all">Все категории</option>' +
            categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    function renderDailyChart(dailyBreakdown) {
        const ctx = document.getElementById('dailyChart');
        if (dailyChart) dailyChart.destroy();

        dailyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dailyBreakdown.map(d => d.label),
                datasets: [{
                    label: 'Выручка',
                    data: dailyBreakdown.map(d => d.revenue),
                    backgroundColor: '#2551d9',
                    borderRadius: 6,
                    maxBarThickness: 40
                }]
            },
            options: {
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (c) => formatMoney(c.parsed.y) } }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString('ru-RU') } }
                }
            }
        });
    }

    function renderCategoryChart(categoryBreakdown) {
        const ctx = document.getElementById('categoryChart');
        if (categoryChart) categoryChart.destroy();

        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: categoryBreakdown.map(c => c.category),
                datasets: [{
                    data: categoryBreakdown.map(c => c.percent),
                    backgroundColor: CATEGORY_COLORS,
                    borderWidth: 0
                }]
            },
            options: {
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { boxWidth: 10, usePointStyle: true, pointStyle: 'circle' }
                    },
                    tooltip: { callbacks: { label: (c) => `${c.label}: ${c.parsed}%` } }
                }
            }
        });
    }

    async function loadReport(params) {
        document.getElementById('reportBody').innerHTML =
            '<tr><td colspan="7" class="empty-row">Загрузка...</td></tr>';

        const query = new URLSearchParams(params).toString();
        const res = await fetch(`${API}?${query}`);
        const data = await res.json();

        document.getElementById('periodLabel').textContent =
            `Период: ${formatDate(data.from)} \u2014 ${formatDate(data.to)}`;

        document.getElementById('stat-qty').textContent = `${data.totalQtySold.toLocaleString('ru-RU')} шт`;
        document.getElementById('stat-revenue').textContent = formatMoney(data.grandTotal);
        document.getElementById('stat-orders').textContent = data.distinctOrders;
        document.getElementById('stat-avg').textContent = formatMoney(data.avgCheck);

        renderDailyChart(data.dailyBreakdown);
        renderCategoryChart(data.categoryBreakdown);

        currentItems = data.items;
        grandTotalValue = data.grandTotal;
        currentPage = 1;

        populateCategoryFilter();
        renderTable();
    }

    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.getElementById('dateFrom').value = '';
            document.getElementById('dateTo').value = '';

            loadReport({ period: btn.dataset.period });
        });
    });

    document.getElementById('customRangeBtn').addEventListener('click', () => {
        const from = document.getElementById('dateFrom').value;
        const to = document.getElementById('dateTo').value;

        if (!from) {
            alert('Укажите хотя бы начальную дату');
            return;
        }

        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));

        loadReport({ from, to: to || from });
    });

    document.getElementById('searchInput').addEventListener('input', () => {
        currentPage = 1;
        renderTable();
    });
    document.getElementById('categorySelect').addEventListener('change', () => {
        currentPage = 1;
        renderTable();
    });
    document.getElementById('sortSelect').addEventListener('change', () => {
        currentPage = 1;
        renderTable();
    });

    loadReport({ period: 'today' });
})();