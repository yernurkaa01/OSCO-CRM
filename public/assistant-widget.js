(function () {
  const API = '/admin/api/assistant';

  // История чата храним в памяти вкладки — пока страница открыта,
  // помощник помнит контекст разговора. При перезагрузке страницы
  // начинается новый разговор (это осознанное упрощение, не баг).
  const conversationHistory = [];
  const MAX_CLIENT_HISTORY = 20; // держим с запасом, бэкенд всё равно обрежет до нужного

  // ---------- Стили ----------
  const style = document.createElement('style');
  style.textContent = `
    #aiWidgetBtn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #fff;
      border: none;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(37,81,217,0.28), 0 2px 6px rgba(0,0,0,0.12);
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      overflow: hidden;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      animation: aiWidgetPulse 3.5s ease-in-out infinite;
    }
    #aiWidgetBtn:hover {
      transform: scale(1.08);
      box-shadow: 0 8px 26px rgba(37,81,217,0.38), 0 3px 8px rgba(0,0,0,0.16);
      animation-play-state: paused;
    }
    #aiWidgetBtn img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scale(2.05);
      pointer-events: none;
    }
    @keyframes aiWidgetPulse {
      0%, 100% { box-shadow: 0 6px 20px rgba(37,81,217,0.28), 0 2px 6px rgba(0,0,0,0.12); }
      50% { box-shadow: 0 6px 20px rgba(37,81,217,0.5), 0 2px 10px rgba(0,0,0,0.16); }
    }
    #aiWidgetPanel {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 340px;
      max-height: 460px;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }
    #aiWidgetPanel.open { display: flex; }
    #aiWidgetHeader {
      background: #2551d9;
      color: #fff;
      padding: 12px 16px;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #aiWidgetClose { cursor: pointer; font-size: 18px; }
    #aiWidgetMessages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      font-size: 13px;
      background: #f6f7fb;
    }
    .ai-msg {
      margin-bottom: 10px;
      padding: 8px 12px;
      border-radius: 10px;
      max-width: 85%;
      white-space: pre-wrap;
      line-height: 1.4;
    }
    .ai-msg.user {
      background: #2551d9;
      color: #fff;
      margin-left: auto;
    }
    .ai-msg.bot {
      background: #fff;
      border: 1px solid #e3e6ec;
      color: #222;
    }
    #aiWidgetInputRow {
      display: flex;
      gap: 6px;
      padding: 10px;
      border-top: 1px solid #eee;
    }
    #aiWidgetInput {
      flex: 1;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid #e3e6ec;
      font-size: 13px;
    }
    #aiWidgetSend {
      padding: 9px 14px;
      border-radius: 8px;
      border: none;
      background: #2551d9;
      color: #fff;
      cursor: pointer;
      font-size: 13px;
    }
  `;
  document.head.appendChild(style);

  // ---------- Разметка ----------
  const btn = document.createElement('button');
  btn.id = 'aiWidgetBtn';
  btn.innerHTML = '<img src="/images/assistant-icon.png" alt="AI-помощник">';
  btn.title = 'AI-помощник по складу и заказам';

  const panel = document.createElement('div');
  panel.id = 'aiWidgetPanel';
  panel.innerHTML = `
    <div id="aiWidgetHeader">
      <span>🤖 AI-помощник</span>
      <span id="aiWidgetClose">✕</span>
    </div>
    <div id="aiWidgetMessages">
      <div class="ai-msg bot">Спросите, например: «какие товары закончились», «что дешевле 2000 тг», «что продали 12 августа»</div>
    </div>
    <div id="aiWidgetInputRow">
      <input type="text" id="aiWidgetInput" placeholder="Задайте вопрос...">
      <button id="aiWidgetSend">➤</button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  btn.addEventListener('click', () => panel.classList.toggle('open'));
  document.getElementById('aiWidgetClose').addEventListener('click', () => panel.classList.remove('open'));

  function addMessage(text, sender) {
    const msgsEl = document.getElementById('aiWidgetMessages');
    const div = document.createElement('div');
    div.className = `ai-msg ${sender}`;
    div.textContent = text;
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function send() {
    const input = document.getElementById('aiWidgetInput');
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';
    input.disabled = true;

    const loadingId = 'ai-loading-' + Date.now();
    const msgsEl = document.getElementById('aiWidgetMessages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'ai-msg bot';
    loadingDiv.id = loadingId;
    loadingDiv.textContent = 'Думаю...';
    msgsEl.appendChild(loadingDiv);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: conversationHistory })
      });
      const data = await res.json();

      document.getElementById(loadingId).remove();

      if (!res.ok) {
        addMessage(data.error || 'Ошибка', 'bot');
      } else {
        addMessage(data.reply, 'bot');

        // Запоминаем обмен репликами для следующего запроса —
        // именно это даёт помощнику "память" в рамках открытого чата.
        conversationHistory.push({ role: 'user', content: text });
        conversationHistory.push({ role: 'assistant', content: data.reply });
        if (conversationHistory.length > MAX_CLIENT_HISTORY) {
          conversationHistory.splice(0, conversationHistory.length - MAX_CLIENT_HISTORY);
        }
      }
    } catch (e) {
      document.getElementById(loadingId).remove();
      addMessage('Ошибка сети, попробуйте ещё раз', 'bot');
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  document.getElementById('aiWidgetSend').addEventListener('click', send);
  document.getElementById('aiWidgetInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
})();