(function () {
  const API = '/admin/api';

  let currentPage = 1;
  const PAGE_LIMIT = 6;
  let allEmployees = []; // для селектов и модалки управления

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₸';
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('ru-RU');
  }

  function getFilters() {
    return {
      search: document.getElementById('filterSearch').value.trim(),
      dateFrom: document.getElementById('filterDateFrom').value,
      dateTo: document.getElementById('filterDateTo').value,
      employeeId: document.getElementById('filterEmployee').value,
      category: document.getElementById('filterCategory').value
    };
  }

  // ---------- Статистика + сайдбар ----------
  async function loadStats() {
    const { dateFrom, dateTo } = getFilters();
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const res = await fetch(`${API}/incidents/stats?${params.toString()}`);
    const data = await res.json();

    document.getElementById('statTotalEmployees').textContent = data.totalEmployees;
    document.getElementById('statTotalLoss').textContent = formatMoney(data.totalLoss);
    document.getElementById('statTotalIncidents').textContent = data.totalIncidents;
    document.getElementById('statAvgLoss').textContent = formatMoney(data.avgLossPerEmployee);

    const topEmpList = document.getElementById('topEmployeesList');
    topEmpList.innerHTML = data.topEmployees.length
      ? data.topEmployees.map((e, i) => `
          <li class="side-item" data-employee-id="${e.id || ''}">
            <span class="side-rank">${i + 1}</span>
            <span class="side-name">${e.name || 'Без имени'}</span>
            <span class="side-loss">${formatMoney(e.totalLoss)}</span>
          </li>
        `).join('')
      : '<li class="side-empty">Пока нет данных</li>';

    topEmpList.querySelectorAll('.side-item[data-employee-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.employeeId;
        if (!id) return;
        document.getElementById('filterEmployee').value = id;
        currentPage = 1;
        loadIncidents();
      });
    });

    const topProdList = document.getElementById('topProductsList');
    topProdList.innerHTML = data.topProducts.length
      ? data.topProducts.map((p, i) => `
          <li class="side-item" data-product-name="${(p.name || '').replace(/"/g, '&quot;')}">
            <span class="side-rank">${i + 1}</span>
            <span class="side-name">${p.name || p.code || 'Товар'}</span>
            <span class="side-loss">${formatMoney(p.totalLoss)}</span>
          </li>
        `).join('')
      : '<li class="side-empty">Пока нет данных</li>';

    topProdList.querySelectorAll('.side-item[data-product-name]').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('filterSearch').value = el.dataset.productName;
        currentPage = 1;
        loadIncidents();
      });
    });
  }

  // ---------- Основная таблица ----------
  async function loadIncidents() {
    const { search, dateFrom, dateTo, employeeId, category } = getFilters();
    const params = new URLSearchParams({
      page: currentPage,
      limit: PAGE_LIMIT
    });
    if (search) params.set('search', search);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (employeeId) params.set('employeeId', employeeId);
    if (category) params.set('category', category);

    const body = document.getElementById('incidentsBody');
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state">Загрузка...</div></td></tr>`;

    const res = await fetch(`${API}/incidents/list?${params.toString()}`);
    const data = await res.json();

    if (!data.items.length) {
      body.innerHTML = `<tr><td colspan="7"><div class="empty-state">Записей не найдено</div></td></tr>`;
    } else {
      body.innerHTML = data.items.map(i => `
        <tr>
          <td>${formatDate(i.createdAt)}</td>
          <td>${i.employeeName || '-'}</td>
          <td>${i.productName || '-'}</td>
          <td>${i.quantity} ${i.unit || ''}</td>
          <td>${i.reason || '-'}</td>
          <td style="color:${i.lossValue ? '#c0392b' : '#8a8f98'};font-weight:${i.lossValue ? '600' : '400'};">
            ${i.lossValue != null ? formatMoney(i.lossValue) : 'нет данных'}
          </td>
          <td>
            <div class="row-actions">
              <button title="Удалить (вернуть товар на склад)" onclick="Employees.deleteIncident('${i._id}')">🗑️</button>
            </div>
          </td>
        </tr>
      `).join('');
    }

    const from = data.total === 0 ? 0 : (data.page - 1) * data.limit + 1;
    const to = Math.min(data.page * data.limit, data.total);
    document.getElementById('incidentsCount').textContent = `Показано ${from}–${to} из ${data.total} записей`;

    renderPagination(data.page, data.totalPages);
  }

  function renderPagination(page, totalPages) {
    const el = document.getElementById('incidentsPagination');
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    let html = `<button ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">‹ Назад</button>`;

    const pages = new Set([1, totalPages, page, page - 1, page + 1].filter(p => p >= 1 && p <= totalPages));
    let prev = 0;
    [...pages].sort((a, b) => a - b).forEach(p => {
      if (prev && p - prev > 1) html += `<span style="padding:0 4px;">…</span>`;
      html += `<button class="${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
      prev = p;
    });

    html += `<button ${page >= totalPages ? 'disabled' : ''} data-page="${page + 1}">Далее ›</button>`;
    el.innerHTML = html;

    el.querySelectorAll('button[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPage = Number(btn.dataset.page);
        loadIncidents();
      });
    });
  }

  function refreshAll() {
    loadStats();
    loadIncidents();
  }

  // ---------- Фильтры ----------
  ['filterSearch', 'filterDateFrom', 'filterDateTo', 'filterEmployee', 'filterCategory'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => { currentPage = 1; refreshAll(); });
  });
  document.getElementById('filterSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { currentPage = 1; refreshAll(); }
  });
  document.getElementById('filterReset').addEventListener('click', () => {
    document.getElementById('filterSearch').value = '';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    document.getElementById('filterEmployee').value = '';
    document.getElementById('filterCategory').value = 'all';
    currentPage = 1;
    refreshAll();
  });

  async function deleteIncident(id) {
    if (!confirm('Удалить запись? Товар вернётся на склад.')) return;
    await fetch(`${API}/incidents/${id}`, { method: 'DELETE' });
    refreshAll();
  }

  // ---------- Загрузка справочников для фильтров/селектов ----------
  async function loadEmployeeOptions() {
    const res = await fetch(`${API}/employees`);
    allEmployees = await res.json();

    const filterSelect = document.getElementById('filterEmployee');
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = '<option value="">Все сотрудники</option>' +
      allEmployees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
    filterSelect.value = currentVal;
  }

  async function loadCategoryOptions() {
    const res = await fetch(`${API}/incidents/categories`);
    const categories = await res.json();

    const select = document.getElementById('filterCategory');
    const currentVal = select.value;
    select.innerHTML = '<option value="all">Все категории</option>' +
      categories.map(c => `<option value="${c}">${c}</option>`).join('');
    select.value = currentVal || 'all';
  }

  // ---------- Модалка управления сотрудниками (добавить/удалить) ----------
  function openManageEmployeesModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="width:420px;">
        <h3>Сотрудники</h3>
        <div id="mgmtList" style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>
        <button class="btn btn-primary" id="mgmtAddBtn" style="align-self:flex-start;">+ Добавить сотрудника</button>
        <div class="modal-actions">
          <button id="mgmtClose">Закрыть</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function renderList() {
      overlay.querySelector('#mgmtList').innerHTML = allEmployees.map(e => `
        <div class="cat-row">
          <span>${e.name}${e.position ? ` — <span style="color:#8a8f98;">${e.position}</span>` : ''}</span>
          <button title="Удалить" data-id="${e.id}">🗑️</button>
        </div>
      `).join('') || '<div style="color:#8a8f98;padding:8px 0;">Сотрудников пока нет</div>';

      overlay.querySelectorAll('#mgmtList button[data-id]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Удалить сотрудника? История его косяков останется в базе.')) return;
          await fetch(`${API}/employees/${btn.dataset.id}`, { method: 'DELETE' });
          await loadEmployeeOptions();
          renderList();
          refreshAll();
        };
      });
    }
    renderList();

    overlay.querySelector('#mgmtClose').onclick = () => overlay.remove();

    overlay.querySelector('#mgmtAddBtn').onclick = () => {
      openAddEmployeeModal(async () => {
        await loadEmployeeOptions();
        renderList();
        refreshAll();
      });
    };
  }

  function openAddEmployeeModal(onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Добавить сотрудника</h3>
        <label>Имя
          <input type="text" id="newEmpName" placeholder="Например: Дастан">
        </label>
        <label>Должность <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="newEmpPosition" placeholder="Водитель">
        </label>
        <label>Телефон <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="newEmpPhone" placeholder="+7...">
        </label>
        <div class="modal-actions">
          <button id="empCancel">Отмена</button>
          <button id="empSave">Добавить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#empCancel').onclick = () => overlay.remove();

    overlay.querySelector('#empSave').onclick = async () => {
      const name = overlay.querySelector('#newEmpName').value.trim();
      if (!name) { alert('Укажите имя'); return; }

      const res = await fetch(`${API}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          position: overlay.querySelector('#newEmpPosition').value.trim(),
          phone: overlay.querySelector('#newEmpPhone').value.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка добавления');
        return;
      }

      overlay.remove();
      if (onDone) onDone();
    };
  }

  // ---------- Модалка ручного добавления записи ----------
  function openAddIncidentModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Добавить запись</h3>
        <label>Сотрудник
          <select id="incEmployee">
            ${allEmployees.map(e => `<option value="${e.id}">${e.name}</option>`).join('') || '<option value="">Нет сотрудников</option>'}
          </select>
        </label>
        <label>Товар <span style="color:#999;font-weight:normal;">(поиск по названию или коду)</span>
          <input type="text" id="incProductSearch" placeholder="Начните вводить название...">
          <div id="incProductResults" style="max-height:160px;overflow-y:auto;border:1px solid #eee;border-radius:8px;margin-top:4px;"></div>
        </label>
        <input type="hidden" id="incProductCode">
        <div id="incSelectedProduct" style="margin:8px 0;color:#2551d9;font-weight:600;"></div>
        <label>Количество
          <input type="number" id="incQty" min="1" value="1">
        </label>
        <label>Причина <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="incReason" placeholder="Разбил при разгрузке">
        </label>
        <div class="modal-actions">
          <button id="incCancel">Отмена</button>
          <button id="incSave">Сохранить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    if (!allEmployees.length) {
      overlay.querySelector('#incSave').disabled = true;
    }

    overlay.querySelector('#incCancel').onclick = () => overlay.remove();

    let searchTimer = null;
    overlay.querySelector('#incProductSearch').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value.trim();
      searchTimer = setTimeout(async () => {
        if (!q) {
          overlay.querySelector('#incProductResults').innerHTML = '';
          return;
        }
        const res = await fetch(`/admin/api/warehouse/products?search=${encodeURIComponent(q)}&category=all&page=1&limit=10`);
        const data = await res.json();

        overlay.querySelector('#incProductResults').innerHTML = data.items.map(p => `
          <div style="padding:8px;cursor:pointer;border-bottom:1px solid #f2f2f2;" data-code="${p.code}" data-name="${p.name}" class="inc-product-option">
            ${p.code || '-'} — ${p.name} (остаток: ${p.qty} ${p.unit})
          </div>
        `).join('') || '<div style="padding:8px;color:#aaa;">Ничего не найдено</div>';

        overlay.querySelectorAll('.inc-product-option').forEach(el => {
          el.onclick = () => {
            overlay.querySelector('#incProductCode').value = el.dataset.code;
            overlay.querySelector('#incSelectedProduct').textContent = `Выбрано: ${el.dataset.name}`;
            overlay.querySelector('#incProductResults').innerHTML = '';
            overlay.querySelector('#incProductSearch').value = el.dataset.name;
          };
        });
      }, 250);
    });

    overlay.querySelector('#incSave').onclick = async () => {
      const employeeId = overlay.querySelector('#incEmployee').value;
      const productCode = overlay.querySelector('#incProductCode').value;
      const quantity = Number(overlay.querySelector('#incQty').value);
      const reason = overlay.querySelector('#incReason').value.trim();

      if (!employeeId) { alert('Выберите сотрудника'); return; }
      if (!productCode) { alert('Выберите товар из списка'); return; }
      if (!quantity || quantity <= 0) { alert('Укажите корректное количество'); return; }

      const res = await fetch(`${API}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, productCode, quantity, reason })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка сохранения');
        return;
      }

      overlay.remove();
      refreshAll();
    };
  }

  // ---------- AI-чат: быстрая запись косяка через свободную фразу ----------
  async function sendAiChat() {
    const input = document.getElementById('aiChatInput');
    const text = input.value.trim();
    if (!text) return;

    const resultEl = document.getElementById('aiChatResult');
    resultEl.innerHTML = '<div style="color:#8a8f98;">Разбираю запрос...</div>';

    try {
      const res = await fetch(`${API}/incidents/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const data = await res.json();

      if (!res.ok) {
        resultEl.innerHTML = `<div style="color:#c0392b;">${data.error || 'Ошибка'}</div>`;
        return;
      }

      renderAiConfirmCard(data);
    } catch (e) {
      resultEl.innerHTML = `<div style="color:#c0392b;">Ошибка сети, попробуйте ещё раз</div>`;
    }
  }

  function renderAiConfirmCard(data) {
    const resultEl = document.getElementById('aiChatResult');
    const { parsed, employeeMatches, productMatches } = data;

    if (!employeeMatches.length) {
      resultEl.innerHTML = `<div style="color:#c0392b;">Сотрудник «${parsed.employeeName}» не найден. Сначала добавьте его через кнопку «Сотрудники».</div>`;
      return;
    }

    if (!productMatches.length) {
      resultEl.innerHTML = `<div style="color:#c0392b;">Товар «${parsed.productQuery}» не найден на складе.</div>`;
      return;
    }

    const employeeOptions = employeeMatches.map(e =>
      `<option value="${e.id}">${e.name}</option>`
    ).join('');

    const productOptions = productMatches.map(p => {
      const priceLabel = p.purchasePrice != null ? formatMoney(p.purchasePrice) : 'закупочная цена не указана';
      return `<option value="${p.code}" data-purchase="${p.purchasePrice ?? ''}" data-unit="${p.unit}">${p.name} — ${priceLabel} (остаток: ${p.qty} ${p.unit})</option>`;
    }).join('');

    resultEl.innerHTML = `
      <div style="border:1px solid #eee; border-radius:10px; padding:14px; background:#fafbfc;">
        <label>Сотрудник
          <select id="aiConfirmEmployee">${employeeOptions}</select>
        </label>
        <label>Товар
          <select id="aiConfirmProduct">${productOptions}</select>
        </label>
        <label>Количество
          <input type="number" id="aiConfirmQty" value="${parsed.quantity || 1}" min="1">
        </label>
        <label>Комментарий
          <input type="text" id="aiConfirmReason" value="${parsed.reason || ''}" placeholder="Причина (необязательно)">
        </label>
        <div id="aiConfirmLossPreview" style="margin:8px 0; color:#2551d9; font-weight:600;"></div>
        <div class="modal-actions" style="margin-top:10px;">
          <button id="aiConfirmCancel">Отмена</button>
          <button id="aiConfirmSave" class="btn btn-primary">✅ Подтвердить</button>
        </div>
      </div>
    `;

    function updatePreview() {
      const qty = Number(document.getElementById('aiConfirmQty').value) || 0;
      const opt = document.getElementById('aiConfirmProduct').selectedOptions[0];
      const purchase = opt.dataset.purchase;
      const preview = document.getElementById('aiConfirmLossPreview');
      if (purchase) {
        preview.textContent = `Убыток: ${formatMoney(Number(purchase) * qty)}`;
      } else {
        preview.textContent = `Убыток: нет данных (не указана закупочная цена товара)`;
      }
    }

    document.getElementById('aiConfirmQty').addEventListener('input', updatePreview);
    document.getElementById('aiConfirmProduct').addEventListener('change', updatePreview);
    updatePreview();

    document.getElementById('aiConfirmCancel').onclick = () => {
      resultEl.innerHTML = '';
      document.getElementById('aiChatInput').value = '';
    };

    document.getElementById('aiConfirmSave').onclick = async () => {
      const employeeId = document.getElementById('aiConfirmEmployee').value;
      const productCode = document.getElementById('aiConfirmProduct').value;
      const quantity = Number(document.getElementById('aiConfirmQty').value);
      const reason = document.getElementById('aiConfirmReason').value.trim();

      const saveRes = await fetch(`${API}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, productCode, quantity, reason })
      });

      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}));
        alert(err.error || 'Ошибка сохранения');
        return;
      }

      resultEl.innerHTML = '<div style="color:#1a9d52;">✅ Записано</div>';
      document.getElementById('aiChatInput').value = '';
      refreshAll();
    };
  }

  document.getElementById('aiChatSend').addEventListener('click', sendAiChat);
  document.getElementById('aiChatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendAiChat();
  });

  document.getElementById('manageEmployeesBtn').addEventListener('click', openManageEmployeesModal);
  document.getElementById('addIncidentBtn').addEventListener('click', openAddIncidentModal);

  window.Employees = { deleteIncident };

  // ---------- Инициализация ----------
  (async function init() {
    await Promise.all([loadEmployeeOptions(), loadCategoryOptions()]);
    refreshAll();
  })();
})();