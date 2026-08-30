(function () {
  const API = '/admin/api';
  let allSellers = [];

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₸';
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU');
  }

  function initials(name) {
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  const AVATAR_COLORS = [
    { bg: '#eaf1ff', fg: '#2551d9' },
    { bg: '#e9f9ef', fg: '#1a9d52' },
    { bg: '#fff2e2', fg: '#e08a1e' },
    { bg: '#fdeceb', fg: '#d84c3f' },
    { bg: '#f1eaff', fg: '#7c3aed' },
    { bg: '#eef2f5', fg: '#475569' }
  ];

  function colorFor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  function renderCards(sellers) {
    const grid = document.getElementById('sellersGrid');

    if (!sellers.length) {
      grid.innerHTML = '<div class="empty-state">Продавцов не найдено</div>';
      return;
    }

    grid.innerHTML = sellers.map(s => {
      const color = colorFor(s.id);
      return `
        <div class="stat-card" style="flex-direction:column; align-items:stretch; cursor:pointer; gap:10px;" data-seller-id="${s.id}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div style="display:flex; gap:12px; align-items:center;">
              <div style="width:44px;height:44px;border-radius:10px;background:${color.bg};color:${color.fg};display:flex;align-items:center;justify-content:center;font-weight:700;">${initials(s.name)}</div>
              <div>
                <div style="font-weight:700;">${s.name}</div>
                <div style="color:#8a8f98; font-size:13px;">${s.position}</div>
              </div>
            </div>
            <span style="font-size:12px; padding:3px 10px; border-radius:20px; background:${s.active ? '#e9f9ef' : '#f2f3f5'}; color:${s.active ? '#1a9d52' : '#8a8f98'};">
              ${s.active ? '● Активен' : 'Нет логина'}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; border-top:1px solid #f2f3f5; padding-top:10px;">
            <div>
              <div class="stat-label">Заказов</div>
              <div style="font-weight:700;">${s.orders}</div>
            </div>
            <div>
              <div class="stat-label">Выручка</div>
              <div style="font-weight:700; color:#1a9d52;">${formatMoney(s.revenue)}</div>
            </div>
          </div>
          <div>
            <div class="stat-label">Прибыль</div>
            <div style="font-weight:700; color:#2551d9;">${formatMoney(s.profit)}</div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-seller-id]').forEach(card => {
      card.addEventListener('click', () => openSellerProfile(card.dataset.sellerId));
    });
  }

  function renderSummary(data) {
    document.getElementById('sumTotalSellers').textContent = data.totalSellers;
    document.getElementById('sumActiveSellers').textContent = `Активных: ${data.activeSellers}`;

    document.getElementById('sumTotalOrders').textContent = data.summary.totalOrders;
    document.getElementById('sumOrdersToday').textContent = `Сегодня: ${data.summary.ordersToday}`;

    document.getElementById('sumTotalRevenue').textContent = formatMoney(data.summary.totalRevenue);
    document.getElementById('sumRevenueToday').textContent = `Сегодня: ${formatMoney(data.summary.revenueToday)}`;

    document.getElementById('sumTotalProfit').textContent = formatMoney(data.summary.totalProfit);
    document.getElementById('sumProfitToday').textContent = `Сегодня: ${formatMoney(data.summary.profitToday)}`;
  }

  async function loadStats() {
    const res = await fetch(`${API}/seller-sales/stats`);
    const data = await res.json();
    allSellers = data.sellers;
    renderCards(allSellers);
    renderSummary(data);
  }

  document.getElementById('sellerSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = q ? allSellers.filter(s => s.name.toLowerCase().includes(q)) : allSellers;
    renderCards(filtered);
  });

  // ---------- Профиль продавца — вся его история продаж ----------
  async function openSellerProfile(employeeId) {
    const seller = allSellers.find(s => s.id === employeeId);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="width:520px;">
        <h3>${seller ? seller.name : 'Продавец'} — история продаж</h3>
        <div id="profileList" style="max-height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;">
          <div style="color:#8a8f98;">Загрузка...</div>
        </div>
        <div class="modal-actions">
          <button id="profileClose">Закрыть</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#profileClose').onclick = () => overlay.remove();

    const res = await fetch(`${API}/seller-sales?employeeId=${employeeId}`);
    const data = await res.json();

    const listEl = overlay.querySelector('#profileList');
    if (!data.orders.length) {
      listEl.innerHTML = '<div style="color:#8a8f98;">Продаж пока нет</div>';
      return;
    }

    listEl.innerHTML = data.orders.map(o => `
      <div style="border:1px solid #eee;border-radius:10px;padding:12px;">
        <div style="font-size:13px;color:#8a8f98;display:flex;justify-content:space-between;">
          <span>Код: ${o.orderCode}</span>
          <span>${formatDate(o.createdAt)}</span>
        </div>
        <div style="margin:6px 0;">${o.items.map(i => `${i.product} — ${i.count}`).join('<br>')}</div>
        <div style="font-weight:700;color:#1a9d52;">${formatMoney(o.total)}</div>
      </div>
    `).join('');
  }

  // ---------- Добавить продавца ----------
  function openAddSellerModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Добавить продавца</h3>
        <label>Имя
          <input type="text" id="newSellerName" placeholder="Например: Асан М.">
        </label>
        <label>Должность <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="newSellerPosition" placeholder="Продавец">
        </label>
        <label>Логин для входа на /sell
          <input type="text" id="newSellerUsername" placeholder="asan">
        </label>
        <label>Пароль
          <input type="text" id="newSellerPassword" placeholder="Придумайте пароль">
        </label>
        <label>Бонус от личных продаж, % <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="number" id="newSellerBonus" min="0" max="100" value="0">
        </label>
        <div class="modal-actions">
          <button id="sellerCancel">Отмена</button>
          <button id="sellerSave" class="btn btn-primary">Добавить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#sellerCancel').onclick = () => overlay.remove();

    overlay.querySelector('#sellerSave').onclick = async () => {
      const name = overlay.querySelector('#newSellerName').value.trim();
      const username = overlay.querySelector('#newSellerUsername').value.trim();
      const password = overlay.querySelector('#newSellerPassword').value.trim();

      if (!name) { alert('Укажите имя'); return; }
      if (!username || !password) { alert('Укажите логин и пароль для входа на /sell'); return; }

      const res = await fetch(`${API}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          position: overlay.querySelector('#newSellerPosition').value.trim() || 'Продавец',
          username,
          password,
          bonusPercent: Number(overlay.querySelector('#newSellerBonus').value) || 0
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка добавления');
        return;
      }

      overlay.remove();
      loadStats();
    };
  }

  document.getElementById('addSellerBtn').addEventListener('click', openAddSellerModal);

  loadStats();
})();