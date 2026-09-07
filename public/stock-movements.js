(function () {
  const API = '/admin/api';

  // Те же весовые/объёмные единицы, что в order-bot и routes/warehouse.js —
  // используются только для UI-подсказок (шаг ввода, allow decimal).
  const FRACTIONAL_UNITS = ['кг', 'kg', 'л', 'литр', 'литра', 'литров', 'м', 'м2', 'м²', 'м3', 'м³'];
  function isFractionalUnit(unit) {
    return FRACTIONAL_UNITS.includes(String(unit || '').trim().toLowerCase());
  }

  function formatQty(n, unit) {
    const num = Number(n || 0);
    const str = Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
    return `${str} ${unit || ''}`.trim();
  }

  function formatDateHeader(dayKey) {
    const [y, m, d] = dayKey.split('-');
    return `${d}.${m}.${y}`;
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function getFilters() {
    return {
      search: document.getElementById('filterSearch').value.trim().toLowerCase(),
      dateFrom: document.getElementById('filterDateFrom').value,
      dateTo: document.getElementById('filterDateTo').value,
      type: document.getElementById('filterType').value
    };
  }

  // ---------- Статистика + сайдбар ----------
  async function loadStats() {
    const { dateFrom, dateTo } = getFilters();
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);

    const res = await fetch(`${API}/stock-movements/stats?${params.toString()}`);
    const data = await res.json();

    document.getElementById('statTotalMovements').textContent = data.totalMovements;

    const inParts = [];
    if (data.totals.incomingPieces) inParts.push(`${data.totals.incomingPieces} шт`);
    if (data.totals.incomingWeight) inParts.push(`${data.totals.incomingWeight} кг/л`);
    document.getElementById('statIncoming').textContent = inParts.length ? inParts.join(' · ') : 'нет данных';

    const outParts = [];
    if (data.totals.outgoingPieces) outParts.push(`${data.totals.outgoingPieces} шт`);
    if (data.totals.outgoingWeight) outParts.push(`${data.totals.outgoingWeight} кг/л`);
    document.getElementById('statOutgoing').textContent = outParts.length ? outParts.join(' · ') : 'нет данных';

    const topList = document.getElementById('topProductsList');
    topList.innerHTML = data.topProducts.length
      ? data.topProducts.map((p, i) => `
          <li class="side-item">
            <span class="side-rank">${i + 1}</span>
            <span class="side-name">${p.productName || p.productCode}</span>
            <span class="side-loss">${formatQty(p.moved, p.unit)}</span>
          </li>
        `).join('')
      : '<li class="side-empty">Пока нет данных</li>';

    const reasonList = document.getElementById('reasonBreakdownList');
    reasonList.innerHTML = data.reasonBreakdown.length
      ? data.reasonBreakdown
          .sort((a, b) => b.quantity - a.quantity)
          .map(r => `
            <li class="side-item">
              <span class="side-name" style="text-transform:capitalize;">${r.reason}</span>
              <span class="side-loss">${r.quantity}</span>
            </li>
          `).join('')
      : '<li class="side-empty">Списаний не было</li>';
  }

  // ---------- История, сгруппированная по дням ----------
  async function loadMovements() {
    const { dateFrom, dateTo, type } = getFilters();
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (type) params.set('type', type);

    const container = document.getElementById('movementsContainer');
    container.innerHTML = '<div class="empty-state">Загрузка...</div>';

    const res = await fetch(`${API}/stock-movements?${params.toString()}`);
    const data = await res.json();

    const { search } = getFilters();

    // Клиентский текстовый фильтр по названию/коду товара — применяется
    // поверх уже загруженных (максимум 500) движений.
    const filteredGroups = data.groups
      .map(g => ({
        date: g.date,
        items: search
          ? g.items.filter(m =>
              (m.productName || '').toLowerCase().includes(search) ||
              (m.productCode || '').toLowerCase().includes(search)
            )
          : g.items
      }))
      .filter(g => g.items.length > 0);

    if (!filteredGroups.length) {
      container.innerHTML = '<div class="empty-state">Движений не найдено</div>';
      return;
    }

    container.innerHTML = filteredGroups.map(group => `
      <div style="margin-bottom:22px;">
        <div style="font-weight:700; font-size:15px; padding:14px 20px 8px;">${formatDateHeader(group.date)}</div>
        <table class="warehouse-table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Тип</th>
              <th>Товар</th>
              <th>Количество</th>
              <th>Причина / Поставщик</th>
              <th>Остаток после</th>
              <th>Кто внёс</th>
            </tr>
          </thead>
          <tbody>
            ${group.items.map(m => `
              <tr>
                <td>${formatTime(m.createdAt)}</td>
                <td>
                  ${m.type === 'приход'
                    ? '<span style="color:#1a9d52;font-weight:600;">+ Приход</span>'
                    : '<span style="color:#d84c3f;font-weight:600;">− Расход</span>'}
                </td>
                <td>${m.productName || m.productCode}</td>
                <td>${formatQty(m.quantity, m.unit)}</td>
                <td>${m.type === 'приход' ? (m.supplier || '-') : (m.reason || '-')}</td>
                <td>${formatQty(m.balanceAfter, m.unit)}</td>
                <td>${m.recordedBy || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  }

  function refreshAll() {
    loadStats();
    loadMovements();
  }

  // ---------- Фильтры ----------
  ['filterDateFrom', 'filterDateTo', 'filterType'].forEach(id => {
    document.getElementById(id).addEventListener('change', refreshAll);
  });
  document.getElementById('filterSearch').addEventListener('input', () => loadMovements());
  document.getElementById('filterReset').addEventListener('click', () => {
    document.getElementById('filterSearch').value = '';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    document.getElementById('filterType').value = '';
    refreshAll();
  });

  // ---------- Поиск товара внутри модалок (переиспользуем warehouse search) ----------
  function attachProductSearch(overlay, onSelect) {
    let searchTimer = null;
    overlay.querySelector('.mv-product-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value.trim();
      const resultsEl = overlay.querySelector('.mv-product-results');
      if (!q) { resultsEl.innerHTML = ''; return; }

      searchTimer = setTimeout(async () => {
        const res = await fetch(`/admin/api/warehouse/products?search=${encodeURIComponent(q)}&category=all&page=1&limit=10`);
        const data = await res.json();

        resultsEl.innerHTML = data.items.map(p => `
          <div style="padding:8px;cursor:pointer;border-bottom:1px solid #f2f2f2;" data-code="${p.code}" data-name="${p.name}" data-unit="${p.unit}" class="mv-product-option">
            ${p.code || '-'} — ${p.name} (остаток: ${p.qty} ${p.unit})
          </div>
        `).join('') || '<div style="padding:8px;color:#aaa;">Ничего не найдено</div>';

        resultsEl.querySelectorAll('.mv-product-option').forEach(el => {
          el.onclick = () => {
            resultsEl.innerHTML = '';
            overlay.querySelector('.mv-product-search').value = el.dataset.name;
            onSelect({ code: el.dataset.code, name: el.dataset.name, unit: el.dataset.unit });
          };
        });
      }, 250);
    });
  }

  // ---------- Модалка "Оприходовать" ----------
  function openIncomingModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>➕ Оприходовать</h3>
        <label>Товар <span style="color:#999;font-weight:normal;">(поиск по названию или коду)</span>
          <input type="text" class="mv-product-search" placeholder="Начните вводить название...">
          <div class="mv-product-results" style="max-height:160px;overflow-y:auto;border:1px solid #eee;border-radius:8px;margin-top:4px;"></div>
        </label>
        <input type="hidden" id="mvProductCode">
        <div id="mvSelectedProduct" style="margin:8px 0;color:#2551d9;font-weight:600;"></div>
        <label>Количество <span id="mvQtyHint" style="color:#999;font-weight:normal;"></span>
          <input type="text" id="mvQty" placeholder="Например: 500">
        </label>
        <label>Закупочная цена <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="number" id="mvPurchasePrice" min="0">
        </label>
        <label>Поставщик <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="mvSupplier" placeholder="ИП Онболсын">
        </label>
        <label>Комментарий <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="mvNote">
        </label>
        <div class="modal-actions">
          <button id="mvCancel">Отмена</button>
          <button id="mvSave" class="btn btn-primary">Сохранить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedUnit = '';
    attachProductSearch(overlay, (p) => {
      overlay.querySelector('#mvProductCode').value = p.code;
      overlay.querySelector('#mvSelectedProduct').textContent = `Выбрано: ${p.name}`;
      selectedUnit = p.unit;
      overlay.querySelector('#mvQtyHint').textContent = isFractionalUnit(p.unit)
        ? '(можно дробное, например 2.5)' : '(целое число)';
    });

    overlay.querySelector('#mvCancel').onclick = () => overlay.remove();

    const saveBtn = overlay.querySelector('#mvSave');
    let isSaving = false;

    saveBtn.onclick = async () => {
      if (isSaving) return;

      const productCode = overlay.querySelector('#mvProductCode').value;
      const qtyRaw = overlay.querySelector('#mvQty').value.trim().replace(',', '.');
      const quantity = Number(qtyRaw);

      if (!productCode) { alert('Выберите товар из списка'); return; }
      if (!qtyRaw || isNaN(quantity) || quantity <= 0) { alert('Укажите корректное количество'); return; }
      if (!isFractionalUnit(selectedUnit) && !Number.isInteger(quantity)) {
        alert('Для этого товара количество должно быть целым числом'); return;
      }

      isSaving = true;
      saveBtn.disabled = true;
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Сохранение…';

      try {
        const res = await fetch(`${API}/stock-movements/incoming`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productCode,
            quantity,
            purchasePrice: overlay.querySelector('#mvPurchasePrice').value || undefined,
            supplier: overlay.querySelector('#mvSupplier').value,
            note: overlay.querySelector('#mvNote').value
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Ошибка сохранения');
          isSaving = false; saveBtn.disabled = false; saveBtn.textContent = originalText;
          return;
        }

        overlay.remove();
        refreshAll();
      } catch (e) {
        alert('Ошибка сети, попробуйте ещё раз');
        isSaving = false; saveBtn.disabled = false; saveBtn.textContent = originalText;
      }
    };
  }

  // ---------- Модалка "Списать" ----------
  function openOutgoingModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>➖ Списать</h3>
        <label>Товар <span style="color:#999;font-weight:normal;">(поиск по названию или коду)</span>
          <input type="text" class="mv-product-search" placeholder="Начните вводить название...">
          <div class="mv-product-results" style="max-height:160px;overflow-y:auto;border:1px solid #eee;border-radius:8px;margin-top:4px;"></div>
        </label>
        <input type="hidden" id="mvProductCode">
        <div id="mvSelectedProduct" style="margin:8px 0;color:#2551d9;font-weight:600;"></div>
        <label>Количество <span id="mvQtyHint" style="color:#999;font-weight:normal;"></span>
          <input type="text" id="mvQty" placeholder="Например: 5">
        </label>
        <label>Причина
          <select id="mvReason">
            <option value="брак">Брак</option>
            <option value="порча">Порча</option>
            <option value="возврат поставщику">Возврат поставщику</option>
            <option value="коррекция учёта">Коррекция учёта</option>
            <option value="другое">Другое</option>
          </select>
        </label>
        <label>Комментарий <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="mvNote">
        </label>
        <div class="modal-actions">
          <button id="mvCancel">Отмена</button>
          <button id="mvSave" class="btn btn-primary">Сохранить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedUnit = '';
    attachProductSearch(overlay, (p) => {
      overlay.querySelector('#mvProductCode').value = p.code;
      overlay.querySelector('#mvSelectedProduct').textContent = `Выбрано: ${p.name}`;
      selectedUnit = p.unit;
      overlay.querySelector('#mvQtyHint').textContent = isFractionalUnit(p.unit)
        ? '(можно дробное, например 2.5)' : '(целое число)';
    });

    overlay.querySelector('#mvCancel').onclick = () => overlay.remove();

    const saveBtn = overlay.querySelector('#mvSave');
    let isSaving = false;

    saveBtn.onclick = async () => {
      if (isSaving) return;

      const productCode = overlay.querySelector('#mvProductCode').value;
      const qtyRaw = overlay.querySelector('#mvQty').value.trim().replace(',', '.');
      const quantity = Number(qtyRaw);

      if (!productCode) { alert('Выберите товар из списка'); return; }
      if (!qtyRaw || isNaN(quantity) || quantity <= 0) { alert('Укажите корректное количество'); return; }
      if (!isFractionalUnit(selectedUnit) && !Number.isInteger(quantity)) {
        alert('Для этого товара количество должно быть целым числом'); return;
      }

      isSaving = true;
      saveBtn.disabled = true;
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Сохранение…';

      try {
        const res = await fetch(`${API}/stock-movements/outgoing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productCode,
            quantity,
            reason: overlay.querySelector('#mvReason').value,
            note: overlay.querySelector('#mvNote').value
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Ошибка сохранения');
          isSaving = false; saveBtn.disabled = false; saveBtn.textContent = originalText;
          return;
        }

        overlay.remove();
        refreshAll();
      } catch (e) {
        alert('Ошибка сети, попробуйте ещё раз');
        isSaving = false; saveBtn.disabled = false; saveBtn.textContent = originalText;
      }
    };
  }

  document.getElementById('addIncomingBtn').addEventListener('click', openIncomingModal);
  document.getElementById('addOutgoingBtn').addEventListener('click', openOutgoingModal);

  refreshAll();
})();