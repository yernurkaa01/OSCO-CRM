(function () {
  const API = '/admin/api/warehouse';

  const state = {
    category: 'all',
    search: '',
    page: 1,
    limit: 10,
  };

  const els = {
    categoryList: document.getElementById('categoryList'),
    search: document.getElementById('warehouseSearch'),
    categorySelect: document.getElementById('categorySelect'),
    statsRow: document.getElementById('statsRow'),
    tableBody: document.getElementById('tableBody'),
    tableCount: document.getElementById('tableCount'),
    footerInfo: document.getElementById('footerInfo'),
    pagination: document.getElementById('pagination'),
    updatedAt: document.getElementById('updatedAt'),
    addProductBtn: document.getElementById('addProductBtn'),
  };

  let debounceTimer = null;

  function formatMoney(n) {
    return n.toLocaleString('ru-RU') + ' ₸';
  }

  function statusClass(code) {
    return code === 'ok' ? 'ok' : code === 'low' ? 'low' : 'out';
  }

  async function loadCategories() {
    const res = await fetch(`${API}/categories`);
    const data = await res.json();

    els.categoryList.innerHTML = '';
    const allLi = document.createElement('li');
    allLi.className = state.category === 'all' ? 'active' : '';
    allLi.innerHTML = `<span>Все товары</span><span class="count">${data.all}</span>`;
    allLi.onclick = () => selectCategory('all');
    els.categoryList.appendChild(allLi);

    els.categorySelect.innerHTML = '<option value="all">Все категории</option>';

    data.categories.forEach((c) => {
      const li = document.createElement('li');
      li.className = state.category === c.key ? 'active' : '';
      li.innerHTML = `<span>${c.icon} ${c.name}</span><span class="count">${c.count}</span>`;
      li.onclick = () => selectCategory(c.key);
      els.categoryList.appendChild(li);

      const opt = document.createElement('option');
      opt.value = c.key;
      opt.textContent = c.name;
      if (state.category === c.key) opt.selected = true;
      els.categorySelect.appendChild(opt);
    });
  }

  function selectCategory(key) {
    state.category = key;
    state.page = 1;
    els.categorySelect.value = key;
    loadCategories();
    loadProducts();
  }

  async function loadStats() {
    const res = await fetch(`${API}/stats`);
    const s = await res.json();

    els.statsRow.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon blue">📦</div>
        <div>
          <div class="stat-label">Всего товаров</div>
          <div class="stat-value">${s.totalItems.toLocaleString('ru-RU')}</div>
          <div class="stat-sub">наименований</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">🧮</div>
        <div>
          <div class="stat-label">Общий остаток</div>
          <div class="stat-value">${s.totalUnits.toLocaleString('ru-RU')}</div>
          <div class="stat-sub">единиц</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange">📉</div>
        <div>
          <div class="stat-label">Мало (≤ 50)</div>
          <div class="stat-value">${s.lowStock}</div>
          <div class="stat-sub">товаров</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red">🚫</div>
        <div>
          <div class="stat-label">Нет в наличии</div>
          <div class="stat-value">${s.outOfStock}</div>
          <div class="stat-sub">товаров</div>
        </div>
      </div>
    `;

    const d = new Date(s.updatedAt);
    els.updatedAt.textContent = `Обновлено: ${d.toLocaleDateString('ru-RU')}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async function loadProducts() {
    const params = new URLSearchParams({
      category: state.category,
      search: state.search,
      page: state.page,
      limit: state.limit,
    });
    const res = await fetch(`${API}/products?${params}`);
    const data = await res.json();

    els.tableCount.textContent = `Товары (${data.total.toLocaleString('ru-RU')})`;

    if (!data.items.length) {
      els.tableBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">Товары не найдены</div></td></tr>`;
    } else {
      els.tableBody.innerHTML = data.items.map((p) => `
        <tr data-id="${p.id}">
          <td>${p.name}</td>
          <td>${p.category}</td>
          <td class="qty-${statusClass(p.status.code)}">${p.qty}</td>
          <td>${p.unit}</td>
          <td>${formatMoney(p.price)}</td>
          <td>${formatMoney(p.sum)}</td>
          <td>
            <span class="status-badge">
              <span class="status-dot ${statusClass(p.status.code)}"></span>
              ${p.status.label}
            </span>
          </td>
          <td>
            <div class="row-actions">
              <button title="Изменить" onclick="Warehouse.editProduct('${p.id}')">✏️</button>
              <button title="Удалить" onclick="Warehouse.deleteProduct('${p.id}')">🗑️</button>
            </div>
          </td>
        </tr>
      `).join('');
    }

    renderPagination(data);
  }

  function renderPagination(data) {
    const start = data.total === 0 ? 0 : (data.page - 1) * data.limit + 1;
    const end = Math.min(data.page * data.limit, data.total);
    els.footerInfo.textContent = `Показано ${start}–${end} из ${data.total}`;

    let html = '';
    const totalPages = data.totalPages;
    const cur = data.page;

    html += `<button ${cur === 1 ? 'disabled' : ''} onclick="Warehouse.goToPage(${cur - 1})">‹</button>`;

    const pagesToShow = new Set([1, totalPages, cur, cur - 1, cur + 1]);
    let prev = null;
    [...pagesToShow].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b).forEach((p) => {
      if (prev !== null && p - prev > 1) html += `<span>…</span>`;
      html += `<button class="${p === cur ? 'active' : ''}" onclick="Warehouse.goToPage(${p})">${p}</button>`;
      prev = p;
    });

    html += `<button ${cur === totalPages ? 'disabled' : ''} onclick="Warehouse.goToPage(${cur + 1})">›</button>`;
    els.pagination.innerHTML = html;
  }

  // ---------- Действия ----------
  async function deleteProduct(id) {
    if (!confirm('Удалить товар?')) return;
    await fetch(`${API}/products/${id}`, { method: 'DELETE' });
    loadProducts();
    loadStats();
    loadCategories();
  }

  async function editProduct(id) {
    const prodRes = await fetch(`${API}/products?search=&category=all&page=1&limit=1000`);
    const data = await prodRes.json();
    const product = data.items.find((p) => p.id === id);
    if (!product) return alert('Товар не найден');

    openProductModal(product, id);
  }

  function openProductModal(product, id) {
    const isEdit = !!id;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${isEdit ? 'Редактирование товара' : 'Добавить товар'}</h3>
        <label>Наименование
          <input type="text" id="editName" value="${product.name}">
        </label>
        <label>Категория
          <input type="text" id="editCategory" value="${product.category}">
        </label>
        <label>Количество
          <input type="number" id="editQty" value="${product.qty}">
        </label>
        <label>Ед. изм.
          <input type="text" id="editUnit" value="${product.unit}">
        </label>
        <label>Цена
          <input type="number" id="editPrice" value="${product.price}">
        </label>
        <div class="modal-actions">
          <button id="editCancel">Отмена</button>
          <button id="editSave">${isEdit ? 'Сохранить' : 'Добавить'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#editCancel').onclick = () => overlay.remove();
    overlay.querySelector('#editSave').onclick = async () => {
      const body = {
        name: overlay.querySelector('#editName').value.trim(),
        category: overlay.querySelector('#editCategory').value.trim(),
        qty: Number(overlay.querySelector('#editQty').value),
        unit: overlay.querySelector('#editUnit').value.trim(),
        price: Number(overlay.querySelector('#editPrice').value),
      };

      const url = isEdit ? `${API}/products/${id}` : `${API}/products`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка сохранения');
        return;
      }

      overlay.remove();
      loadProducts();
      loadStats();
      loadCategories();
    };
  }

  // ---------- События ----------
  els.search.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.search = e.target.value;
      state.page = 1;
      loadProducts();
    }, 300);
  });

  els.categorySelect.addEventListener('change', (e) => {
    selectCategory(e.target.value);
  });

  if (els.addProductBtn) {
    els.addProductBtn.addEventListener('click', () => {
      openProductModal({ name: '', category: '', qty: 0, unit: '', price: 0 }, null);
    });
  }

  window.Warehouse = {
    goToPage(p) {
      state.page = p;
      loadProducts();
    },
    deleteProduct,
    editProduct,
  };

  // ---------- Инициализация ----------
  loadCategories();
  loadStats();
  loadProducts();
})();