(function () {
  const API = '/admin/api';
  let allBonuses = [];

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₸';
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

  function monthLabel(month) {
    const [y, m] = month.split('-');
    const names = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return `${names[Number(m) - 1]} ${y}`;
  }

  // Текущий месяц по умолчанию в поле выбора
  const now = new Date();
  document.getElementById('monthInput').value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  function renderStats(bonuses) {
    document.getElementById('statCount').textContent = bonuses.length;

    const totalSales = bonuses.reduce((acc, b) => acc + b.totalSales, 0);
    const totalBonus = bonuses.reduce((acc, b) => acc + b.bonusAmount, 0);
    const unpaid = bonuses.filter(b => !b.paid).reduce((acc, b) => acc + b.bonusAmount, 0);

    document.getElementById('statTotalSales').textContent = formatMoney(totalSales);
    document.getElementById('statTotalBonus').textContent = formatMoney(totalBonus);
    document.getElementById('statUnpaid').textContent = formatMoney(unpaid);
  }

  function renderCards(bonuses) {
    const grid = document.getElementById('bonusesGrid');

    if (!bonuses.length) {
      grid.innerHTML = '<div class="empty-state">Начислений пока нет — выберите месяц и нажмите «Рассчитать»</div>';
      return;
    }

    grid.innerHTML = bonuses.map(b => {
      const color = colorFor(b.employee);
      return `
        <div class="stat-card" style="flex-direction:column; align-items:stretch; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div style="display:flex; gap:12px; align-items:center;">
              <div style="width:44px;height:44px;border-radius:10px;background:${color.bg};color:${color.fg};display:flex;align-items:center;justify-content:center;font-weight:700;">${initials(b.employeeName)}</div>
              <div>
                <div style="font-weight:700;">${b.employeeName}</div>
                <div style="color:#8a8f98; font-size:13px;">${monthLabel(b.month)}</div>
              </div>
            </div>
            <span style="font-size:12px; padding:3px 10px; border-radius:20px; background:${b.paid ? '#e9f9ef' : '#fff2e2'}; color:${b.paid ? '#1a9d52' : '#e08a1e'};">
              ${b.paid ? '✅ Выплачено' : '⏳ Не выплачено'}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; border-top:1px solid #f2f3f5; padding-top:10px;">
            <div>
              <div class="stat-label">Продано лично</div>
              <div style="font-weight:700;">${formatMoney(b.totalSales)}</div>
            </div>
            <div>
              <div class="stat-label">Процент</div>
              <div style="font-weight:700;">${b.bonusPercent}%</div>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div class="stat-label">Бонус</div>
              <div style="font-weight:700; color:#1a9d52; font-size:17px;">${formatMoney(b.bonusAmount)}</div>
            </div>
            ${b.paid ? '' : `<button class="btn btn-primary" data-mark-paid="${b._id}">Отметить выплаченным</button>`}
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-mark-paid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Сохранение…';
        const res = await fetch(`${API}/bonuses/${btn.dataset.markPaid}/mark-paid`, { method: 'POST' });
        if (!res.ok) {
          alert('Не удалось отметить как выплачено');
          btn.disabled = false;
          btn.textContent = 'Отметить выплаченным';
          return;
        }
        loadBonuses();
      });
    });
  }

  function populateMonthFilter(bonuses) {
    const select = document.getElementById('filterMonth');
    const currentVal = select.value;
    const months = [...new Set(bonuses.map(b => b.month))].sort().reverse();

    select.innerHTML = '<option value="">Все месяцы</option>' +
      months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
    select.value = currentVal;
  }

  async function loadBonuses() {
    const grid = document.getElementById('bonusesGrid');
    grid.innerHTML = '<div class="empty-state">Загрузка...</div>';

    const month = document.getElementById('filterMonth').value;
    const params = month ? `?month=${month}` : '';

    const res = await fetch(`${API}/bonuses${params}`);
    const data = await res.json();

    allBonuses = data;
    if (!month) populateMonthFilter(data);

    renderStats(data);
    renderCards(data);
  }

  document.getElementById('filterMonth').addEventListener('change', loadBonuses);

  document.getElementById('calculateBtn').addEventListener('click', async () => {
    const month = document.getElementById('monthInput').value;
    if (!month) { alert('Выберите месяц'); return; }

    const btn = document.getElementById('calculateBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Считаем…';

    try {
      const res = await fetch(`${API}/bonuses/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Ошибка расчёта');
        return;
      }

      const skipped = data.results.filter(r => r.skipped).length;
      const calculated = data.results.length - skipped;
      alert(
        `Готово: посчитано для ${calculated} сотрудник(ов).` +
        (skipped ? `\nПропущено (уже было посчитано ранее): ${skipped}` : '')
      );

      document.getElementById('filterMonth').value = month;
      loadBonuses();
    } catch (e) {
      alert('Ошибка сети, попробуйте ещё раз');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  loadBonuses();
})();