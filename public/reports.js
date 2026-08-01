(function () {
    const API = '/admin/api/reports/sales';

    let currentItems = [];
    let dailyChart = null;
    let categoryChart = null;

    const CATEGORY_COLORS = ['#2551d9', '#5b8def', '#a9c6ff', '#c9c9c9', '#e08a1e'];

    function formatMoney(n) {
        return Number(n || 0).toLocaleString('ru-RU') + ' \u20B8';
    }

    function formatDate(iso) {
        return new Date(iso).toLocaleDateString('ru-RU');
    }

    function renderTable() {
        const query = document.getElementById('searchInput').value.toLowerCase().trim();
        const sortBy = document.getElementById('sortSelect').value;

        let filtered = currentItems.filter(i =>
            i.product.toLowerCase().includes(query)
        );

        filtered = filtered.slice().sort((a, b) => {
            if (sortBy === 'sum') return b.totalSum - a.totalSum;
            if (sortBy === 'name') return a.product.localeCompare(b.product, 'ru');
            return b.totalCount - a.totalCount;
        });

        if (!filtered.length) {
            document.getElementById('reportBody').innerHTML =
                '<tr><td colspan="4" class="empty-state">Ничего не найдено</td></tr>';
            return;
        }

        document.getElementById('reportBody').innerHTML = filtered.map(item => `
            <tr>
                <td>${item.product}</td>
                <td>${item.category}</td>
                <td>${item.totalCount} ${item.unit}</td>
                <td class="money">${formatMoney(item.totalSum)}</td>
            </tr>
        `).join('');
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
            '<tr><td colspan="4" class="empty-state">Загрузка...</td></tr>';

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

    document.getElementById('searchInput').addEventListener('input', renderTable);
    document.getElementById('sortSelect').addEventListener('change', renderTable);

    loadReport({ period: 'today' });
})();