(function () {
  const API = '/admin/api/seller-sales';

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₸';
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU');
  }

  async function loadEmployees() {
    const res = await fetch(`${API}/employees`);
    const employees = await res.json();

    const select = document.getElementById('employeeFilter');
    select.innerHTML = '<option value="">Все продавцы</option>' +
      employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  }

  async function load() {
    const employeeId = document.getElementById('employeeFilter').value;
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;

    const params = new URLSearchParams();
    if (employeeId) params.set('employeeId', employeeId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    const body = document.getElementById('salesBody');
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">Загрузка...</div></td></tr>`;

    const res = await fetch(`${API}?${params.toString()}`);
    const data = await res.json();

    document.getElementById('statsRow').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon blue">🛒</div>
        <div>
          <div class="stat-label">Продаж</div>
          <div class="stat-value">${data.count}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">💰</div>
        <div>
          <div class="stat-label">Общая сумма</div>
          <div class="stat-value">${formatMoney(data.grandTotal)}</div>
        </div>
      </div>
    `;

    if (!data.orders.length) {
      body.innerHTML = `<tr><td colspan="5"><div class="empty-state">Продаж не найдено</div></td></tr>`;
      return;
    }

    body.innerHTML = data.orders.map(o => `
      <tr>
        <td>${formatDate(o.createdAt)}</td>
        <td>${o.employeeName}</td>
        <td>${o.items.map(i => `${i.product} (${i.count})`).join(', ')}</td>
        <td>${o.orderCode}</td>
        <td style="color:#1a9d52;font-weight:600;">${formatMoney(o.total)}</td>
      </tr>
    `).join('');
  }

  document.getElementById('applyFilterBtn').addEventListener('click', load);

  loadEmployees();
  load();
})();