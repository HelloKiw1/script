(function () {
  const source = document.getElementById('scriptSource');
  const codeView = document.getElementById('codeView');
  const statusItems = [...document.querySelectorAll('[data-copy-status]')];
  const code = source ? source.value : '';

  if (codeView) {
    codeView.textContent = code;
  }

  function setStatus(message) {
    if (!statusItems.length) return;
    statusItems.forEach((status) => {
      status.textContent = message;
    });
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
      statusItems.forEach((status) => {
        status.textContent = '';
      });
    }, 2600);
  }

  function fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.inset = '0 auto auto 0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }

  async function copyScript() {
    if (!code) {
      setStatus('Codigo nao encontrado nesta pagina.');
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else if (!fallbackCopy(code)) {
        throw new Error('fallback failed');
      }
      setStatus('Codigo .js copiado para a area de transferencia.');
    } catch (error) {
      setStatus('Nao foi possivel copiar automaticamente. Selecione o codigo e copie manualmente.');
    }
  }

  document.querySelectorAll('[data-copy-js]').forEach((button) => {
    button.addEventListener('click', copyScript);
  });

  const tabs = [...document.querySelectorAll('[data-js-tab]')];
  const panels = [...document.querySelectorAll('[data-js-panel]')];

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.jsTab;
      tabs.forEach((item) => {
        const active = item === tab;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.jsPanel !== target;
      });
    });
  });
})();
