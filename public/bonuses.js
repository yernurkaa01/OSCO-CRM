(function () {
  const API = '/admin/api/bonuses';

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₸';
  }

  async function load() {
    const res = await fetch(API);
    const items = await res.json();

    const body = document.getElementById('bonusesBody');

    if (!items.length) {
      body.innerHTML = `<tr><td colspan="7"><div class="empty-state">Начислений пока нет</div></td></tr>`;
      return;
    }

    body.innerHTML = items.map(b => `
      <tr>
        <td>${b.month}</td>
        <td>${b.employeeName}</td>
        <td>${formatMoney(b.totalSales)}</td>
        <td>${b.bonusPercent}%</td>
        <td style="color:#1a9d52;font-weight:600;">${formatMoney(b.bonusAmount)}</td>
        <td>${b.paid ? '✅ Выплачено' : '⏳ Не выплачено'}</td>
        <td>
          ${!b.paid ? `<button onclick="Bonuses.markPaid('${b._id}')">Отметить выплаченным</button>` : ''}
        </td>
      </tr>
    `).join('');
  }

  async function markPaid(id) {
    await fetch(`${API}/${id}/mark-paid`, { method: 'POST' });
    load();
  }

  document.getElementById('calculateBtn').addEventListener('click', async () => {
    const month = document.getElementById('monthInput').value;
    if (!month) { alert('Выберите месяц'); return; }

    const btn = document.getElementById('calculateBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Считаю…';

    try {
      const res = await fetch(`${API}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Ошибка расчёта');
        return;
      }

      const summary = data.results.map(r =>
        r.skipped ? `${r.employee}: пропущено (${r.reason})` : `${r.employee}: ${formatMoney(r.bonusAmount)}`
      ).join('\n');

      alert(`Расчёт за ${month} завершён:\n\n${summary}`);
      load();
    } catch (e) {
      alert('Ошибка сети, попробуйте ещё раз');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  window.Bonuses = { markPaid };

  load();
})();