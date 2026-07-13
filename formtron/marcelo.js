// ==UserScript==
// @name         Marcelo
// @namespace    https://github.com/eduar
// @version      0.1.0
// @description  Preenche o formulário automaticamente usando dados do JSON
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  // Estado e opções (inspirado no painel do Baixatron)
  const state = {
    paused: false,
    stopped: false,
    running: false,
    currentIndex: 0,
    total: 0,
    processed: 0,
    errors: 0,
    skipped: 0,
    percent: 0,
    theme: localStorage.getItem('__marcelo-theme') || 'dark',
    speedFactor: parseFloat(localStorage.getItem('__marcelo-speedFactor') || '1'),
    startedAt: null,
    sumItemDuration: 0,
  };

  let arquivos = [];
  let arquivosFiltrados = [];

  // Utilitários
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const scaledSleep = async (ms) => {
    const goal = ms * Math.max(0.25, Math.min(4, state.speedFactor));
    const start = Date.now();
    while (Date.now() - start < goal) {
      if (state.stopped) throw new Error('Script parado pelo usuário');
      while (state.paused && !state.stopped) await wait(100);
      await wait(60);
    }
  };

  const waitForElement = async (selector, shouldExist = true, timeout = 10000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (state.stopped) throw new Error('Script parado pelo usuário');
      if (state.paused) await wait(100);
      const el = document.querySelector(selector);
      if (shouldExist && el) return el;
      if (!shouldExist && !el) return true;
      await wait(100);
    }
    throw new Error(`Timeout aguardando elemento: ${selector}`);
  };

  const waitForSaveComplete = async () => {
    await wait(900);
    const startedAt = Date.now();
    const timeout = 20000;
    while (Date.now() - startedAt < timeout) {
      const loading = document.querySelector('.p-button-loading-icon, .pi-spinner, .pi-spin');
      const saveButton = document.querySelector('button[aria-label="Salvar e Publicar"], button[aria-label="Salvar"], form button[type="submit"]');
      if (!saveButton) return true;
      if (!loading && !saveButton.disabled) {
        await wait(250);
        return true;
      }
      await wait(120);
    }
    throw new Error('Timeout aguardando conclusão do salvamento');
  };

  const normalizeText = (value) => String(value ?? '').trim();
  const normalizeUrl = (value) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    return raw
      .replace(/^https?:\/\/(www\.)?araguaina\.to\.gov\.br\/?/i, '')
      .replace(/^(www\.)?araguaina\.to\.gov\.br\/?/i, '')
      .replace(/^\/+/, '');
  };
  const isVisible = (el) => !!(el && (el.offsetParent || el.getClientRects().length));

  const findFirstVisible = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (isVisible(el)) return el;
    }
    return null;
  };

  const setFieldValue = (el, value) => {
    if (!el) return;
    el.value = value;
    el.focus();
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(enterEvent);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  };

  const formatDateForForm = (value) => {
    const raw = normalizeText(value);
    if (!raw) return '';

    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

    const ymd = raw.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
    if (ymd) {
      return `${String(Number(ymd[3])).padStart(2, '0')}/${String(Number(ymd[2])).padStart(2, '0')}/${ymd[1]}`;
    }

    const br = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (br) {
      return `${String(Number(br[1])).padStart(2, '0')}/${String(Number(br[2])).padStart(2, '0')}/${br[3]}`;
    }

    return raw;
  };

  const preencherData = async (value) => {
    const dataFormatada = formatDateForForm(value);
    if (!dataFormatada) {
      console.warn('Data vazia no JSON:', value);
      return false;
    }

    const input = findFirstVisible([
      '#data input',
      '#data input[type="text"]',
      'input[name="data"]',
      'input[placeholder*="data" i]',
      '.p-calendar input',
      '.p-datepicker input',
    ]);

    if (!input) {
      console.warn('Campo de data nao encontrado.');
      return false;
    }

    setFieldValue(input, dataFormatada);
    await scaledSleep(120);

    if (normalizeText(input.value) !== dataFormatada) {
      setFieldValue(input, dataFormatada);
    }

    return normalizeText(input.value) === dataFormatada;
  };

  const preencherLinkArquivo = async (url) => {
    const value = normalizeUrl(url);
    if (!value) return true;

    let input = findFirstVisible([
      '.p-fileupload-content input[type="text"]',
      '.p-fileupload-content input:not([type="file"])',
      '.p-fileupload-content textarea',
      'input[placeholder*="url" i]',
      'input[placeholder*="link" i]',
    ]);

    if (!input) {
      const btnOpenLink = findFirstVisible([
        '.p-fileupload-buttonbar button.p-button-help',
        '.p-fileupload-buttonbar button[aria-label*="URL" i]',
        '.p-fileupload-buttonbar button[aria-label*="Link" i]',
      ]);

      if (btnOpenLink) {
        btnOpenLink.click();
        await scaledSleep(350);
        input = findFirstVisible([
          '.p-fileupload-content input[type="text"]',
          '.p-fileupload-content input:not([type="file"])',
          '.p-fileupload-content textarea',
          'input[placeholder*="url" i]',
          'input[placeholder*="link" i]',
        ]);
      }
    }

    if (!input) {
      console.warn('Campo de URL do arquivo não encontrado.');
      return false;
    }

    setFieldValue(input, value);
    await scaledSleep(180);
    if (normalizeText(input.value) !== value) {
      setFieldValue(input, value);
    }
    return true;
  };

  const fillInput = (selector, value) => {
    const el = document.querySelector(selector);
    if (!el) return console.warn('Elemento não encontrado:', selector);
    el.value = value;
    el.focus();
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(enterEvent);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const click = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return console.warn('Elemento não encontrado:', selector);
    el.focus();
    el.click();
  };

  // Procura e clica em um <li> de dropdown pelo aria-label ou texto
  const selectByAriaLabel = (label) => {
    if (!label) return false;
    const targetLabel = normalizeText(label);
    const items = Array.from(document.querySelectorAll('li[aria-label]'));
    const target = items.find((el) => {
      const aria = normalizeText(el.getAttribute('aria-label'));
      const text = normalizeText(el.textContent);
      return (
        aria === targetLabel ||
        text === targetLabel ||
        aria.startsWith(`${targetLabel} -`) ||
        text.startsWith(`${targetLabel} -`)
      );
    });
    if (!target) {
      console.warn(`Opção não encontrada para aria-label: ${label}`);
      return false;
    }
    target.click();
    return true;
  };

  // =============================
  // UI: Painel Marcelo
  // =============================
  const CSS = `
    * { box-sizing: border-box; }
    #marcelo-panel { position: fixed; top: 14px; right: 14px; width: 460px; max-height: 86vh; border-radius: 10px; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; z-index: 999999; color: #fff; background: #181a1f; box-shadow: 0 8px 32px rgba(0,0,0,.45); }
    #marcelo-panel.light { background: #f5f6f8; color: #111; }
    #marcelo-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; background: #21232b; cursor: move; user-select: none; border-bottom: 1px solid #2c2f37; font-weight: 700; font-size: 13px; }
    #marcelo-panel.light #marcelo-header { background: #ffffff; border-bottom: 1px solid #e5e7eb; }
    #marcelo-title { display: flex; align-items: center; gap: 8px; }
    #marcelo-actions { display: flex; gap: 6px; }
    .m-btn-icon { border: none; background: transparent; color: #aab; font-size: 16px; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: .2s; }
    .m-btn-icon:hover { background: rgba(255,255,255,.08); color: #fff; }
    #marcelo-panel.light .m-btn-icon { color: #555; }
    #marcelo-panel.light .m-btn-icon:hover { background: #f1f5f9; color: #111; }
    #marcelo-warning { background: #2b2935; border-left: 4px solid #8b5cf6; padding: 10px 12px; font-size: 11px; line-height: 1.4; }
    #marcelo-panel.light #marcelo-warning { background: #ede9fe; color: #2d1b69; border-left-color: #7c3aed; }
    #marcelo-body { display: flex; flex-direction: column; max-height: calc(86vh - 48px); }
    #marcelo-stats { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2c2f37; background: #1b1e26; }
    #marcelo-panel.light #marcelo-stats { background: #ffffff; border-bottom: 1px solid #e5e7eb; }
    .m-stat { display: flex; flex-direction: column; gap: 2px; }
    .m-stat .lbl { font-size: 10px; opacity: .7; text-transform: uppercase; letter-spacing: .4px; }
    .m-stat .val { font-size: 15px; font-weight: 800; }
    #marcelo-progress { padding: 10px 12px; border-bottom: 1px solid #2c2f37; }
    #marcelo-panel.light #marcelo-progress { border-bottom: 1px solid #e5e7eb; }
    .m-bar { height: 8px; background: #2c2f37; border-radius: 4px; overflow: hidden; }
    .m-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #10b981, #22d3ee); transition: width .25s; }
    #marcelo-controls { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2c2f37; }
    #marcelo-panel.light #marcelo-controls { border-bottom: 1px solid #e5e7eb; }
    .m-btn { padding: 9px 10px; border-radius: 8px; border: 1px solid #30343d; background: #242833; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; transition: .2s; }
    .m-btn:hover { background: #2b3040; border-color: #3b404c; }
    .m-btn.primary { background: #10b981; border-color: #10b981; color: #0b1a14; }
    .m-btn.primary:hover { background: #0ea371; border-color: #0ea371; }
    .m-btn.danger { background: #ef4444; border-color: #ef4444; color: #fff; }
    .m-btn.danger:hover { background: #dc2626; border-color: #dc2626; }
    .row { display: flex; gap: 8px; align-items: center; }
    .row input[type="text"] { flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid #30343d; background: #1d212a; color: #fff; font-size: 12px; outline: none; }
    #marcelo-panel.light .row input[type="text"] { background: #fff; color: #111; border: 1px solid #e5e7eb; }
    .m-help { font-size: 10px; opacity: .75; padding: 2px 2px 0; }
    #marcelo-speed { padding: 10px 12px; border-top: 1px solid #2c2f37; font-size: 11px; }
    #marcelo-panel.light #marcelo-speed { border-top: 1px solid #e5e7eb; }
    input[type="range"] { width: 100%; height: 4px; background: #2c2f37; border-radius: 2px; appearance: none; }
    input[type="range"]::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 999px; background: #10b981; cursor: pointer; }
    #marcelo-collapsed { display: none; }
    #marcelo-panel.min { width: 260px; }
    #marcelo-panel.min #marcelo-body { display: none; }
    @media (max-width: 640px){ #marcelo-panel{ width: calc(100% - 20px); left: 10px; right: 10px; } #marcelo-controls{ grid-template-columns: repeat(2, minmax(0,1fr)); } }
  `;

  const injectStyle = () => {
    if (document.getElementById('marcelo-style')) return;
    const style = document.createElement('style');
    style.id = 'marcelo-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  };

  const enableDrag = (panel, handle) => {
    const drag = { active: false, dx: 0, dy: 0 };
    const onMove = (e) => {
      if (!drag.active) return;
      const x = e.clientX - drag.dx;
      const y = e.clientY - drag.dy;
      panel.style.right = '';
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, x)) + 'px';
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, y)) + 'px';
    };
    const onUp = () => {
      drag.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    handle.addEventListener('mousedown', (e) => {
      drag.active = true;
      const r = panel.getBoundingClientRect();
      drag.dx = e.clientX - r.left;
      drag.dy = e.clientY - r.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  };

  const setStatus = (txt) => {
    const el = document.getElementById('marcelo-status');
    if (el) el.textContent = txt;
  };

  const updateStats = () => {
    const q = {
      fila: state.total - state.processed,
      ativos: state.running && !state.paused ? 1 : 0,
      proc: state.processed,
      sel: arquivosFiltrados.length,
      err: state.errors,
    };
    const total = state.total || 0;
    const pct = total ? Math.round((state.processed / total) * 100) : 0;
    state.percent = pct;
    const fill = document.getElementById('marcelo-fill');
    const pctEl = document.getElementById('marcelo-pct');
    const qEls = {
      fila: document.getElementById('m-q-fila'),
      ativos: document.getElementById('m-q-ativos'),
      proc: document.getElementById('m-q-proc'),
      sel: document.getElementById('m-q-sel'),
      err: document.getElementById('m-q-err'),
    };
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (qEls.fila) qEls.fila.textContent = String(q.fila);
    if (qEls.ativos) qEls.ativos.textContent = String(q.ativos);
    if (qEls.proc) qEls.proc.textContent = String(q.proc);
    if (qEls.sel) qEls.sel.textContent = String(q.sel);
    if (qEls.err) qEls.err.textContent = String(q.err);
    const prog = document.getElementById('marcelo-progress-label');
    if (prog) prog.textContent = `${state.currentIndex} / ${state.total}`;

    // timers
    const elapsedEl = document.getElementById('marcelo-elapsed');
    const etaEl = document.getElementById('marcelo-eta');
    if (elapsedEl) {
      const secs = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
      elapsedEl.textContent = `⏱️ ${formatTime(secs)}`;
    }
    if (etaEl) {
      const etaSecs = getEstimatedSeconds();
      etaEl.textContent = `🕒 ${etaSecs ? formatTime(etaSecs) : '--:--'}`;
    }
  };

  const toggleTheme = () => {
    const panel = document.getElementById('marcelo-panel');
    if (!panel) return;
    if (state.theme === 'dark') {
      state.theme = 'light';
      panel.classList.add('light');
    } else {
      state.theme = 'dark';
      panel.classList.remove('light');
    }
    localStorage.setItem('__marcelo-theme', state.theme);
  };

  const renderPanel = () => {
    const existing = document.getElementById('marcelo-panel');
    if (existing) existing.remove();

    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'marcelo-panel';
    if (state.theme === 'light') panel.classList.add('light');
    panel.innerHTML = `
      <div id="marcelo-header">
        <div id="marcelo-title">🧩 Marcelo — Automação</div>
        <div id="marcelo-actions">
          <button id="m-theme" class="m-btn-icon" title="Tema">${state.theme === 'light' ? '☀️' : '🌙'}</button>
          <button id="m-min" class="m-btn-icon" title="Minimizar">➖</button>
          <button id="m-close" class="m-btn-icon" title="Fechar">✕</button>
        </div>
      </div>
      <div id="marcelo-body">
        <div id="marcelo-warning">
          Dica: use barra de espaço para Pausar/Continuar · T: tema · S: parar
        </div>
        <div id="marcelo-stats">
          <div class="m-stat"><span class="lbl">Fila</span><span class="val" id="m-q-fila">0</span></div>
          <div class="m-stat"><span class="lbl">Ativos</span><span class="val" id="m-q-ativos">0</span></div>
          <div class="m-stat"><span class="lbl">Processados</span><span class="val" id="m-q-proc">0</span></div>
          <div class="m-stat"><span class="lbl">Selecionados</span><span class="val" id="m-q-sel">0</span></div>
          <div class="m-stat"><span class="lbl">Erros</span><span class="val" id="m-q-err">0</span></div>
        </div>
        <div id="marcelo-progress">
          <div class="row" style="justify-content: space-between;">
            <div class="m-help" id="marcelo-status">Aguardando arquivo JSON…</div>
            <div class="m-help" id="marcelo-pct">0%</div>
          </div>
          <div class="m-bar"><div class="m-fill" id="marcelo-fill"></div></div>
          <div class="m-help" id="marcelo-progress-label" style="margin-top:6px;">0 / 0</div>
          <div class="row" style="justify-content: space-between; margin-top:6px;">
            <div class="m-help" id="marcelo-elapsed">⏱️ 00:00</div>
            <div class="m-help" id="marcelo-eta">🕒 --:--</div>
          </div>
        </div>
        <div id="marcelo-controls">
          <button id="m-start" class="m-btn primary" disabled>▶ Iniciar</button>
          <button id="m-pause" class="m-btn" disabled>⏸ Pausar</button>
          <button id="m-stop" class="m-btn danger">⏹ Parar</button>
          <button id="m-loadjson" class="m-btn" style="grid-column: span 3;">📂 Carregar JSON</button>
          <div class="row" style="grid-column: span 3;">
            <input id="m-startfrom" type="text" placeholder="Começar a partir do decreto (ex: 123)">
            <button id="m-apply" class="m-btn">Aplicar</button>
          </div>
          <div class="m-help" id="m-startinfo" style="grid-column: span 3;">Carregue o arquivo JSON para começar</div>
        </div>
        <div id="marcelo-speed">
          <div class="row" style="justify-content: space-between; margin-bottom:6px"><span>Velocidade</span><span id="m-speed-label">${state.speedFactor.toFixed(2)}x</span></div>
          <input id="m-speed" type="range" min="0.25" max="3" step="0.05" value="${state.speedFactor}">
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Eventos
    const btnStart = document.getElementById('m-start');
    const btnPause = document.getElementById('m-pause');
    const btnStop = document.getElementById('m-stop');
    const btnApply = document.getElementById('m-apply');
    const btnLoadJson = document.getElementById('m-loadjson');
    const inputStart = document.getElementById('m-startfrom');
    const startInfo = document.getElementById('m-startinfo');
    const statusEl = document.getElementById('marcelo-status');

    document.getElementById('m-close').onclick = () => panel.remove();
    document.getElementById('m-min').onclick = () => {
      if (panel.classList.contains('min')) {
        panel.classList.remove('min');
      } else {
        panel.classList.add('min');
      }
    };
    document.getElementById('m-theme').onclick = () => {
      toggleTheme();
      document.getElementById('m-theme').textContent = state.theme === 'light' ? '☀️' : '🌙';
    };

    enableDrag(panel, document.getElementById('marcelo-header'));

    btnPause.onclick = () => {
      state.paused = !state.paused;
      btnPause.textContent = state.paused ? '▶ Continuar' : '⏸ Pausar';
      setStatus(state.paused ? '⏸️ Pausado' : '▶️ Executando...');
    };
    btnStop.onclick = () => {
      state.stopped = true;
      state.running = false;
      setStatus('⏹️ Parando...');
      updateStats();
    };
    btnStart.onclick = async () => {
      if (!arquivosFiltrados.length) return;
      if (state.running) return;
      state.stopped = false;
      state.paused = false;
      state.running = true;
      state.startedAt = Date.now();
      state.sumItemDuration = 0;
      btnPause.disabled = false;
      // Atualizar timers periodicamente
      state.__tick = setInterval(updateStats, 500);
      await loop();
    };
    btnLoadJson.onclick = async () => {
      await carregarJson();
    };
    btnApply.onclick = async () => {
      const numeroInicial = inputStart.value.trim();
      if (!numeroInicial) {
        arquivosFiltrados = arquivos;
        state.skipped = 0;
        state.total = arquivos.length;
        state.currentIndex = 0;
        state.processed = 0;
        state.errors = 0;
        btnStart.disabled = arquivosFiltrados.length === 0;
        startInfo.textContent = 'Processando todos os decretos';
        startInfo.style.opacity = '0.9';
        updateStats();
        return;
      }
      const idx = arquivos.findIndex((item) => normalizeText(item.numeroDecreto) === numeroInicial || normalizeText(item.numero) === numeroInicial);
      if (idx !== -1) {
        arquivosFiltrados = arquivos.slice(idx);
        state.skipped = idx;
        state.total = arquivosFiltrados.length;
        state.currentIndex = 0;
        state.processed = 0;
        state.errors = 0;
        btnStart.disabled = arquivosFiltrados.length === 0;
        startInfo.textContent = `✓ Pulando ${state.skipped} decreto(s)`;
        startInfo.style.color = '#10b981';
        updateStats();
      } else {
        startInfo.textContent = `✗ Decreto "${numeroInicial}" não encontrado`;
        startInfo.style.color = '#ef4444';
      }
    };

    // Velocidade
    const speed = document.getElementById('m-speed');
    const speedLbl = document.getElementById('m-speed-label');
    speed.oninput = (e) => {
      state.speedFactor = parseFloat(e.target.value || '1');
      speedLbl.textContent = `${state.speedFactor.toFixed(2)}x`;
      localStorage.setItem('__marcelo-speedFactor', String(state.speedFactor));
    };

    // Atalhos
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target || {}).tagName)) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!btnPause.disabled) btnPause.click();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        btnStop.click();
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        document.getElementById('m-theme').click();
      }
    });

    // Estado inicial
    statusEl.textContent = 'Aguardando arquivo JSON…';
    btnPause.disabled = true;
    btnStart.disabled = true;
    updateStats();
  };

  // =============================
  // Núcleo da automação (adaptado do script original)
  // =============================
  const loop = async () => {
    try {
      const btnPause = document.getElementById('m-pause');
      const btnStart = document.getElementById('m-start');
      const inputStart = document.getElementById('m-startfrom');
      const btnApply = document.getElementById('m-apply');
      btnPause.disabled = false;
      inputStart.disabled = true;
      btnApply.disabled = true;

      setStatus(`▶️ Iniciando processamento (${arquivosFiltrados.length} decretos)`);

      for (const data of arquivosFiltrados) {
        if (state.stopped) break;
        while (state.paused && !state.stopped) await wait(120);

        state.currentIndex++;
        setStatus(`▶️ Processando decreto ${state.currentIndex}/${state.total}`);
        updateStats();

        const itemStart = Date.now();

        // Fluxo de decreto/documento (igual ao Formtron)
        fillInput('#acao-form > div:nth-child(1) > div.pt-1.w-full > div:nth-child(1) > div > div:nth-child(1) > span > div > div > div:nth-child(1) > span > div > div > span > input', data.numero ?? '');
        await scaledSleep(2000);
        click('#tipo_documento > div');
        await scaledSleep(400);
        click('#tipo_documento_6');
        await scaledSleep(400);

        fillInput('#numero input', data.numeroDoDocumento ?? '');

        if (normalizeText(data.letra)) {
          fillInput('#letra', data.letra);
        }

        const dataOk = await preencherData(data.data);
        if (!dataOk) {
          state.errors++;
          setStatus(`⚠️ Data não preenchida (${data.data || 'vazia'}) no item ${state.currentIndex}`);
        }

        fillInput('textarea.p-inputtextarea', data.descricao ?? '');

        const urlOk = await preencherLinkArquivo(data.url);
        if (!urlOk) {
          state.errors++;
          setStatus(`⚠️ URL não encontrada no formulário (decreto ${state.currentIndex})`);
        }
        await scaledSleep(220);

        // Salvar
        setStatus(`💾 Salvando decreto ${state.currentIndex}...`);
        click('#acao-form button[aria-label="Salvar"]');
        try {
          await waitForSaveComplete();
          state.sumItemDuration += (Date.now() - itemStart);
          state.processed++;
          updateStats();
          if (state.currentIndex < state.total) {
            setStatus('➕ Criando novo formulário...');
            click('button[aria-label="Novo"]');
            await scaledSleep(800);
          }
        } catch (error) {
          if (error?.response && String(error.response.message || '').includes('Too Many Attemps')) {
            await scaledSleep(20000);
            setStatus(`💾 (Retry) Salvando decreto ${state.currentIndex}...`);
            click('#acao-form button[aria-label="Salvar"]');
            await waitForSaveComplete();
            state.sumItemDuration += (Date.now() - itemStart);
            state.processed++;
            updateStats();
            if (state.currentIndex < state.total) {
              setStatus('➕ Criando novo formulário...');
              click('button[aria-label="Novo"]');
              await scaledSleep(800);
            }
          } else {
            console.error(error);
            state.errors++;
          }
        }
      }

      if (state.stopped) {
        setStatus('⏹️ Script parado pelo usuário');
      } else {
        setStatus(`✅ Concluído! ${state.total} decretos processados`);
      }
    } catch (e) {
      console.error('Erro:', e);
      setStatus(`❌ Erro: ${e}`);
    } finally {
      state.running = false;
      const btnPause = document.getElementById('m-pause');
      const btnStart = document.getElementById('m-start');
      const inputStart = document.getElementById('m-startfrom');
      const btnApply = document.getElementById('m-apply');
      if (btnPause) btnPause.disabled = true;
      if (btnStart) btnStart.disabled = false;
      if (inputStart) inputStart.disabled = false;
      if (btnApply) btnApply.disabled = false;
      if (state.__tick) { clearInterval(state.__tick); state.__tick = null; }
      updateStats();
    }
  };

  // Tempo: helpers
  const formatTime = (seconds) => {
    if (!seconds || seconds <= 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const getEstimatedSeconds = () => {
    if (!state.running || !state.total) return null;
    if (state.processed <= 0 || state.sumItemDuration <= 0) return null;
    const avgMs = state.sumItemDuration / state.processed;
    const remaining = Math.max(0, state.total - state.processed);
    const estMs = remaining * avgMs;
    return Math.ceil(estMs / 1000);
  };

  // =============================
  // Carregar arquivo JSON
  // =============================
  const pickJson = async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            resolve(data);
          } catch (err) {
            alert('Arquivo JSON inválido');
            resolve([]);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
  };

  const carregarJson = async () => {
    arquivos = await pickJson();
    if (!Array.isArray(arquivos)) arquivos = [];
    arquivosFiltrados = arquivos;
    state.total = arquivos.length;
    state.currentIndex = 0;
    state.processed = 0;
    state.errors = 0;
    const startInfo = document.getElementById('m-startinfo');
    if (startInfo) startInfo.textContent = arquivos.length ? `Total: ${arquivos.length} decreto(s) no arquivo` : 'Nenhum dado carregado';
    const btnStart = document.getElementById('m-start');
    if (btnStart) btnStart.disabled = arquivos.length === 0;
    setStatus(arquivos.length ? `Arquivo carregado: ${arquivos.length} decreto(s)` : 'Nenhum dado carregado');
    updateStats();
  };

  // Expor API mínima
  window.__marcelo = {
    pause: () => (state.paused = true),
    resume: () => (state.paused = false),
    stop: () => (state.stopped = true),
    setSpeed: (f) => {
      state.speedFactor = Math.max(0.25, Math.min(4, Number(f) || 1));
      localStorage.setItem('__marcelo-speedFactor', String(state.speedFactor));
      const lbl = document.getElementById('m-speed-label');
      if (lbl) lbl.textContent = `${state.speedFactor.toFixed(2)}x`;
    },
    toggleTheme,
  };

  // Inicialização
  renderPanel();
  // Aguarda o usuário clicar em "Carregar JSON"
  setStatus('Aguardando arquivo JSON…');
  updateStats();
})();
