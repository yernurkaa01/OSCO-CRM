(function () {
  function formatMoney(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₸';
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU');
  }

  async function lookup() {
    const code = document.getElementById('codeInput').value.trim();
    const resultEl = document.getElementById('lookupResult');

    if (!code) return;

    resultEl.innerHTML = '<div style="color:#8a8f98;">Ищу...</div>';

    try {
      const res = await fetch(`/admin/api/order-lookup/${encodeURIComponent(code)}`);
      const data = await res.json();

      if (!res.ok) {
        resultEl.innerHTML = `<div style="color:#c0392b;">${data.error || 'Ошибка'}</div>`;
        return;
      }

      const sourceLabel = data.source === 'employee'
        ? `Продал сотрудник: <b>${data.soldByEmployeeName}</b>`
        : `Клиент из Telegram: <b>${data.clientName || '-'}</b> (${data.clientPhone || '-'})`;

      resultEl.innerHTML = `
        <div style="border:1px solid #eee; border-radius:10px; padding:16px;">
          <div style="margin-bottom:8px;"><b>Код заказа:</b> ${data.orderCode}</div>
          <div style="margin-bottom:8px;">${sourceLabel}</div>
          <div style="margin-bottom:8px;"><b>Статус:</b> ${data.status}</div>
          <div style="margin-bottom:12px;"><b>Дата:</b> ${formatDate(data.createdAt)}</div>
          <table class="warehouse-table">
            <thead><tr><th>Товар</th><th>Кол-во</th><th>Сумма</th></tr></thead>
            <tbody>
              ${data.items.map(i => `
                <tr>
                  <td>${i.product}</td>
                  <td>${i.count}</td>
                  <td>${formatMoney(i.totalPrice)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="text-align:right; margin-top:10px; font-weight:700; color:#1a9d52;">
            Итого: ${formatMoney(data.total)}
          </div>
        </div>
      `;
    } catch (e) {
      resultEl.innerHTML = '<div style="color:#c0392b;">Ошибка сети, попробуйте ещё раз</div>';
    }
  }

  document.getElementById('lookupBtn').addEventListener('click', lookup);
  document.getElementById('codeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookup();
  });
})();