(function () {
  const API = '/admin/api';

  let selectedEmployeeId = null;
  let selectedEmployeeName = '';

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₸';
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('ru-RU');
  }

  async function loadEmployees() {
    const res = await fetch(`${API}/employees`);
    const employees = await res.json();

    const body = document.getElementById('employeesBody');

    if (!employees.length) {
      body.innerHTML = `<tr><td colspan="6"><div class="empty-state">Сотрудников пока нет</div></td></tr>`;
      return;
    }

    body.innerHTML = employees.map(e => `
      <tr>
        <td><a href="#" onclick="Employees.selectEmployee('${e.id}', '${e.name.replace(/'/g, "\\'")}'); return false;">${e.name}</a></td>
        <td>${e.position || '-'}</td>
        <td>${e.phone || '-'}</td>
        <td>${e.incidentCount}</td>
        <td style="color:${e.totalLoss > 0 ? '#c0392b' : '#222'};font-weight:${e.totalLoss > 0 ? '600' : '400'};">${formatMoney(e.totalLoss)}</td>
        <td>
          <div class="row-actions">
            <button title="Удалить" onclick="Employees.deleteEmployee('${e.id}')">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function deleteEmployee(id) {
    if (!confirm('Удалить сотрудника? История его косяков останется в базе.')) return;
    await fetch(`${API}/employees/${id}`, { method: 'DELETE' });
    if (selectedEmployeeId === id) {
      selectedEmployeeId = null;
      document.getElementById('incidentsCard').style.display = 'none';
    }
    loadEmployees();
  }

  async function selectEmployee(id, name) {
    selectedEmployeeId = id;
    selectedEmployeeName = name;

    document.getElementById('incidentsCard').style.display = 'block';
    document.getElementById('incidentsTitle').textContent = `История: ${name}`;

    await loadIncidents();
  }

  async function loadIncidents() {
    if (!selectedEmployeeId) return;

    const res = await fetch(`${API}/employees/${selectedEmployeeId}/incidents`);
    const incidents = await res.json();

    const body = document.getElementById('incidentsBody');

    if (!incidents.length) {
      body.innerHTML = `<tr><td colspan="6"><div class="empty-state">Косяков пока нет</div></td></tr>`;
      return;
    }

    body.innerHTML = incidents.map(i => `
      <tr>
        <td>${formatDate(i.createdAt)}</td>
        <td>${i.productName}</td>
        <td>${i.quantity} ${i.unit}</td>
        <td>${i.lossValue != null ? formatMoney(i.lossValue) : '<span style="color:#aaa;">нет данных</span>'}</td>
        <td>${i.reason || '-'}</td>
        <td>
          <div class="row-actions">
            <button title="Удалить (вернуть товар на склад)" onclick="Employees.deleteIncident('${i._id}')">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function deleteIncident(id) {
    if (!confirm('Удалить запись? Товар вернётся на склад.')) return;
    await fetch(`${API}/incidents/${id}`, { method: 'DELETE' });
    loadIncidents();
    loadEmployees();
  }

  function openAddEmployeeModal() {
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
      loadEmployees();
    };
  }

  async function openAddIncidentModal() {
    if (!selectedEmployeeId) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Добавить косяк — ${selectedEmployeeName}</h3>
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
      const productCode = overlay.querySelector('#incProductCode').value;
      const quantity = Number(overlay.querySelector('#incQty').value);
      const reason = overlay.querySelector('#incReason').value.trim();

      if (!productCode) { alert('Выберите товар из списка'); return; }
      if (!quantity || quantity <= 0) { alert('Укажите корректное количество'); return; }

      const res = await fetch(`${API}/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: selectedEmployeeId, productCode, quantity, reason })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка сохранения');
        return;
      }

      overlay.remove();
      loadIncidents();
      loadEmployees();
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

      renderAiConfirmCard(data, text);
    } catch (e) {
      resultEl.innerHTML = `<div style="color:#c0392b;">Ошибка сети, попробуйте ещё раз</div>`;
    }
  }

  function renderAiConfirmCard(data, originalText) {
    const resultEl = document.getElementById('aiChatResult');
    const { parsed, employeeMatches, productMatches } = data;

    if (!employeeMatches.length) {
      resultEl.innerHTML = `<div style="color:#c0392b;">Сотрудник «${parsed.employeeName}» не найден. Сначала добавьте его в список выше.</div>`;
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
      loadEmployees();
      if (selectedEmployeeId === employeeId) loadIncidents();
    };
  }

  document.getElementById('aiChatSend').addEventListener('click', sendAiChat);
  document.getElementById('aiChatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendAiChat();
  });

  document.getElementById('addEmployeeBtn').addEventListener('click', openAddEmployeeModal);
  document.getElementById('addIncidentBtn').addEventListener('click', openAddIncidentModal);

  window.Employees = {
    selectEmployee,
    deleteEmployee,
    deleteIncident
  };

  loadEmployees();
})();