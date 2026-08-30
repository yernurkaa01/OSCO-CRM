(function () {
  let cart = [];
  let selectedProduct = null;

  function formatMoney(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' \u20B8';
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU');
  }

  function showLogin() {
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('saleScreen').style.display = 'none';
  }

  function showSale(name) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('saleScreen').style.display = 'block';
    document.getElementById('greeting').textContent = `Привет, ${name}`;
  }

  async function checkAuth() {
    const res = await fetch('/employee/me');
    const data = await res.json();
    if (data.loggedIn) {
      showSale(data.name);
    } else {
      showLogin();
    }
  }

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';

    const res = await fetch('/employee/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Ошибка входа';
      return;
    }

    showSale(data.name);
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/employee/logout', { method: 'POST' });
    cart = [];
    renderCart();
    showLogin();
  });

  // ---------- Вкладки ----------
  document.getElementById('tabSaleBtn').addEventListener('click', () => {
    document.getElementById('tabSaleBtn').classList.add('active');
    document.getElementById('tabHistoryBtn').classList.remove('active');
    document.getElementById('saleTab').style.display = 'block';
    document.getElementById('historyTab').style.display = 'none';
  });

  document.getElementById('tabHistoryBtn').addEventListener('click', () => {
    document.getElementById('tabHistoryBtn').classList.add('active');
    document.getElementById('tabSaleBtn').classList.remove('active');
    document.getElementById('saleTab').style.display = 'none';
    document.getElementById('historyTab').style.display = 'block';
    loadHistory();
  });

  async function loadHistory() {
    const listEl = document.getElementById('historyList');
    listEl.innerHTML = 'Загрузка...';

    let res, orders;
    try {
      res = await fetch('/employee/my-sales');
      orders = await res.json();
    } catch (e) {
      listEl.innerHTML = '<div style="color:#c0392b;">Ошибка сети, попробуйте ещё раз</div>';
      return;
    }

    // КРИТИЧНО: сначала проверяем res.ok — иначе ответ вида {error: "..."}
    // (401 при проблеме с сессией, 500 и т.п.) молча трактуется как "нет
    // продаж", потому что у объекта ошибки orders.length === undefined,
    // что тоже "ложно". Из-за этого реальная проблема была не видна.
    if (!res.ok) {
      listEl.innerHTML = `<div style="color:#c0392b;">⚠️ ${orders.error || 'Не удалось загрузить историю (код ' + res.status + ')'}</div>`;
      return;
    }

    if (!Array.isArray(orders) || !orders.length) {
      listEl.innerHTML = '<div style="color:#8a8f98;">Продаж пока нет</div>';
      return;
    }

    listEl.innerHTML = orders.map(o => `
      <div class="history-order">
        <div class="items">${o.items.map(i => `${i.product} — ${i.count} шт`).join('<br>')}</div>
        <div class="meta">
          <span>Код: ${o.orderCode}</span>
          <span>${formatDate(o.createdAt)}</span>
        </div>
        <div style="font-weight:700; color:#1a9d52; margin-top:4px;">${formatMoney(o.total)}</div>
      </div>
    `).join('');
  }

  // ---------- Поиск и корзина ----------
  let searchTimer = null;
  document.getElementById('productSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(async () => {
      const resultsEl = document.getElementById('productResults');
      if (!q) { resultsEl.innerHTML = ''; return; }

      const res = await fetch(`/employee/products?search=${encodeURIComponent(q)}`);
      const products = await res.json();

      resultsEl.innerHTML = products.map(p => `
        <div class="product-item" data-code="${p.code}" data-name="${p.name}" data-price="${p.price}" data-unit="${p.unit}" data-available="${p.available}">
          <b>${p.name}</b><br>
          <span style="color:#8a8f98; font-size:13px;">${formatMoney(p.price)} · остаток: ${p.available} ${p.unit}</span>
        </div>
      `).join('') || '<div style="padding:10px; color:#aaa;">Ничего не найдено</div>';

      resultsEl.querySelectorAll('.product-item').forEach(el => {
        el.onclick = () => {
          selectedProduct = {
            code: el.dataset.code,
            name: el.dataset.name,
            price: Number(el.dataset.price),
            unit: el.dataset.unit,
            available: Number(el.dataset.available)
          };
          document.getElementById('selectedProductLabel').textContent =
            `${selectedProduct.name} — ${formatMoney(selectedProduct.price)}/${selectedProduct.unit} (доступно: ${selectedProduct.available})`;
          document.getElementById('qtyRow').style.display = 'block';
          resultsEl.innerHTML = '';
          document.getElementById('productSearch').value = '';
        };
      });
    }, 250);
  });

  document.getElementById('addToCartBtn').addEventListener('click', () => {
    if (!selectedProduct) return;
    const qty = Number(document.getElementById('qtyInput').value) || 1;

    cart.push({ ...selectedProduct, qty });
    selectedProduct = null;
    document.getElementById('qtyRow').style.display = 'none';
    document.getElementById('qtyInput').value = 1;
    renderCart();
  });

  function renderCart() {
    const cartCard = document.getElementById('cartCard');
    if (!cart.length) {
      cartCard.style.display = 'none';
      return;
    }
    cartCard.style.display = 'block';

    document.getElementById('cartList').innerHTML = cart.map((item, i) => `
      <div class="cart-row">
        <span>${item.name} — ${item.qty} ${item.unit}</span>
        <button onclick="Sell.removeFromCart(${i})">✕</button>
      </div>
    `).join('');

    const total = cart.reduce((acc, item) => acc + item.qty * item.price, 0);
    document.getElementById('cartTotal').textContent = `Итого: ${formatMoney(total)}`;
  }

  let isSubmittingSale = false;

  document.getElementById('submitSaleBtn').addEventListener('click', async () => {
    if (!cart.length || isSubmittingSale) return;

    isSubmittingSale = true;
    const submitBtn = document.getElementById('submitSaleBtn');
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Оформляем\u2026';

    try {
      const res = await fetch('/employee/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: cart.map(c => ({ code: c.code, qty: c.qty })) })
      });

      const data = await res.json();
      const resultEl = document.getElementById('saleResult');

      if (!res.ok) {
        resultEl.innerHTML = `<div class="error">${data.error || 'Ошибка'}</div>`;
        return;
      }

      resultEl.innerHTML = `<div class="success">\u2705 Продажа оформлена<br>Код: ${data.orderCode}</div>`;
      cart = [];
      renderCart();
    } catch (e) {
      document.getElementById('saleResult').innerHTML = `<div class="error">Ошибка сети, попробуйте ещё раз</div>`;
    } finally {
      isSubmittingSale = false;
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  window.Sell = {
    removeFromCart(i) {
      cart.splice(i, 1);
      renderCart();
    }
  };

  checkAuth();
})();