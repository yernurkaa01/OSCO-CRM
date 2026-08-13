(function () {
  const API = '/admin/api/stock-movements';

  function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU');
  }

  async function load() {
    const res = await fetch(API);
    const items = await res.json();

    const body = document.getElementById('movementsBody');

    if (!items.length) {
      body.innerHTML = `<tr><td colspan="7"><div class="empty-state">Движений пока нет</div></td></tr>`;
      return;
    }

    body.innerHTML = items.map(m => {
      const isIncoming = m.type === 'приход';
      const typeLabel = isIncoming
        ? `<span style="color:#1a9d52;font-weight:600;">➕ Приход</span>`
        : `<span style="color:#c0392b;font-weight:600;">➖ Расход</span>`;
      const reasonText = isIncoming
        ? (m.supplier || '—')
        : (m.reason || '—');

      return `
        <tr>
          <td>${formatDate(m.createdAt)}</td>
          <td>${typeLabel}</td>
          <td>${m.productName}</td>
          <td>${m.quantity} ${m.unit}</td>
          <td>${reasonText}${m.note ? `<br><span style="color:#8a8f98;font-size:12px;">${m.note}</span>` : ''}</td>
          <td>${m.balanceAfter} ${m.unit}</td>
          <td>${m.recordedBy || '—'}</td>
        </tr>
      `;
    }).join('');
  }

  async function searchProducts(query, resultsEl, onSelect) {
    if (!query) { resultsEl.innerHTML = ''; return; }
    const res = await fetch(`/admin/api/warehouse/products?search=${encodeURIComponent(query)}&category=all&page=1&limit=10`);
    const data = await res.json();

    resultsEl.innerHTML = data.items.map(p => `
      <div style="padding:8px;cursor:pointer;border-bottom:1px solid #f2f2f2;" data-code="${p.code}" data-name="${p.name}" data-unit="${p.unit}">
        ${p.code || '-'} — ${p.name} (остаток: ${p.qty} ${p.unit})
      </div>
    `).join('') || '<div style="padding:8px;color:#aaa;">Ничего не найдено</div>';

    resultsEl.querySelectorAll('div[data-code]').forEach(el => {
      el.onclick = () => onSelect({ code: el.dataset.code, name: el.dataset.name, unit: el.dataset.unit });
    });
  }

  function openIncomingModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>➕ Оприходовать товар</h3>
        <label>Товар <span style="color:#999;font-weight:normal;">(поиск)</span>
          <input type="text" id="inSearch" placeholder="Начните вводить название...">
          <div id="inResults" style="max-height:160px;overflow-y:auto;border:1px solid #eee;border-radius:8px;margin-top:4px;"></div>
        </label>
        <input type="hidden" id="inCode">
        <div id="inSelected" style="margin:8px 0;color:#2551d9;font-weight:600;"></div>
        <label>Количество
          <input type="number" id="inQty" min="1" value="1">
        </label>
        <label>Закупочная цена <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="number" id="inPrice" placeholder="Например: 2600">
        </label>
        <label>Поставщик <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="inSupplier" placeholder="Название поставщика">
        </label>
        <label>Комментарий <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="inNote">
        </label>
        <div class="modal-actions">
          <button id="inCancel">Отмена</button>
          <button id="inSave">Сохранить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#inCancel').onclick = () => overlay.remove();

    let searchTimer = null;
    overlay.querySelector('#inSearch').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchProducts(e.target.value.trim(), overlay.querySelector('#inResults'), (p) => {
          overlay.querySelector('#inCode').value = p.code;
          overlay.querySelector('#inSelected').textContent = `Выбрано: ${p.name}`;
          overlay.querySelector('#inResults').innerHTML = '';
          overlay.querySelector('#inSearch').value = p.name;
        });
      }, 250);
    });

    overlay.querySelector('#inSave').onclick = async () => {
      const productCode = overlay.querySelector('#inCode').value;
      const quantity = Number(overlay.querySelector('#inQty').value);
      if (!productCode) { alert('Выберите товар'); return; }
      if (!quantity || quantity <= 0) { alert('Укажите количество'); return; }

      const res = await fetch(`${API}/incoming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productCode,
          quantity,
          purchasePrice: overlay.querySelector('#inPrice').value,
          supplier: overlay.querySelector('#inSupplier').value,
          note: overlay.querySelector('#inNote').value
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка сохранения');
        return;
      }

      overlay.remove();
      load();
    };
  }

  function openOutgoingModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>➖ Списать товар</h3>
        <label>Товар <span style="color:#999;font-weight:normal;">(поиск)</span>
          <input type="text" id="outSearch" placeholder="Начните вводить название...">
          <div id="outResults" style="max-height:160px;overflow-y:auto;border:1px solid #eee;border-radius:8px;margin-top:4px;"></div>
        </label>
        <input type="hidden" id="outCode">
        <div id="outSelected" style="margin:8px 0;color:#2551d9;font-weight:600;"></div>
        <label>Количество
          <input type="number" id="outQty" min="1" value="1">
        </label>
        <label>Причина
          <select id="outReason">
            <option value="брак">Брак</option>
            <option value="порча">Порча (истёк срок и т.п.)</option>
            <option value="возврат поставщику">Возврат поставщику</option>
            <option value="коррекция учёта">Коррекция учёта</option>
            <option value="другое">Другое</option>
          </select>
        </label>
        <label>Комментарий <span style="color:#999;font-weight:normal;">(необязательно)</span>
          <input type="text" id="outNote">
        </label>
        <div class="modal-actions">
          <button id="outCancel">Отмена</button>
          <button id="outSave">Сохранить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#outCancel').onclick = () => overlay.remove();

    let searchTimer = null;
    overlay.querySelector('#outSearch').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchProducts(e.target.value.trim(), overlay.querySelector('#outResults'), (p) => {
          overlay.querySelector('#outCode').value = p.code;
          overlay.querySelector('#outSelected').textContent = `Выбрано: ${p.name}`;
          overlay.querySelector('#outResults').innerHTML = '';
          overlay.querySelector('#outSearch').value = p.name;
        });
      }, 250);
    });

    overlay.querySelector('#outSave').onclick = async () => {
      const productCode = overlay.querySelector('#outCode').value;
      const quantity = Number(overlay.querySelector('#outQty').value);
      if (!productCode) { alert('Выберите товар'); return; }
      if (!quantity || quantity <= 0) { alert('Укажите количество'); return; }

      const res = await fetch(`${API}/outgoing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productCode,
          quantity,
          reason: overlay.querySelector('#outReason').value,
          note: overlay.querySelector('#outNote').value
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка сохранения');
        return;
      }

      overlay.remove();
      load();
    };
  }

  document.getElementById('addIncomingBtn').addEventListener('click', openIncomingModal);
  document.getElementById('addOutgoingBtn').addEventListener('click', openOutgoingModal);

  load();
})();