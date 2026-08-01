(function () {
    const API = '/admin/api/reports/sales';

    function formatMoney(n) {
        return Number(n || 0).toLocaleString('ru-RU') + ' ₸';
    }

    function formatDate(iso) {
        return new Date(iso).toLocaleDateString('ru-RU');
    }

    async function loadReport(params) {
        document.getElementById('reportBody').innerHTML =
            '<tr><td colspan="5">Загрузка...</td></tr>';

        const query = new URLSearchParams(params).toString();
        const res = await fetch(`${API}?${query}`);
        const data = await res.json();

        document.getElementById('grand-total').textContent = formatMoney(data.grandTotal);
        document.getElementById('periodLabel').textContent =
            `Период: ${formatDate(data.from)} — ${formatDate(data.to)}`;

        if (!data.items.length) {
            document.getElementById('reportBody').innerHTML =
                '<tr><td colspan="5">Продаж за этот период нет</td></tr>';
            return;
        }

        document.getElementById('reportBody').innerHTML = data.items.map(item => `
            <tr>
                <td>${item.product}</td>
                <td><b>${item.totalCount}</b></td>
                <td>${item.unit}</td>
                <td>${item.orders}</td>
                <td>${formatMoney(item.totalSum)}</td>
            </tr>
        `).join('');
    }

    // Быстрые кнопки периода
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Сбрасываем произвольный диапазон, если выбрана быстрая кнопка
            document.getElementById('dateFrom').value = '';
            document.getElementById('dateTo').value = '';

            loadReport({ period: btn.dataset.period });
        });
    });

    // Произвольный диапазон дат (или одна конкретная дата, если "по" не заполнено)
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

    // По умолчанию — сегодня
    loadReport({ period: 'today' });
})();