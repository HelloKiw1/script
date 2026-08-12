(function () {
  const pages = [
    { id: 'home', label: 'Inicio', icon: 'home', href: 'index.html' },
    { id: 'atricon', label: 'Atricon', icon: 'chart', href: 'atricon/visualizador_atricon.html' },
    { id: 'candidatron', label: 'Candidatron', icon: 'ballot', href: 'candidato/candidato.html' },
    { id: 'extractron', label: 'Extractron', icon: 'file-search', href: 'extractron/extractron.html' },
    { id: 'sizetron', label: 'Sizetron', icon: 'compress', href: 'sizetron/sizetron.html' },
    { id: 'imagetron', label: 'Imagetron', icon: 'image', href: 'imagetron/imagetron.html' },
    { id: 'banner', label: 'Banner', icon: 'layout', href: 'Banner/banner-composer.html' },
    { id: 'baixatron', label: 'Baixatron', icon: 'download', href: 'baixatron/baixatron.html' },
    { id: 'marcelo', label: 'Marcelo', icon: 'form', href: 'formtron/marcelo.html' },
    { id: 'noticias-js', label: 'Noticias JS', icon: 'news', href: 'extractron/extractron_noticias.html' }
  ];

  const storage = {
    open: 'script-tools-sidebar-open',
    theme: 'script-tools-theme'
  };
  const assetBase = currentScriptBase();
  const themeFiles = {
    light: 'assets/themes/retro.css',
    dark: 'assets/themes/halloween.css'
  };
  const daisyThemes = {
    light: 'retro',
    dark: 'halloween'
  };

  function currentScriptBase() {
    const script = document.currentScript;
    const src = script ? script.getAttribute('src') || '' : '';
    return src.replace(/assets\/script-shell\.js(?:\?.*)?$/i, '');
  }

  function activePageId() {
    const path = window.location.pathname.replace(/\\/g, '/').toLowerCase();
    if (path.endsWith('/index.html') || /\/script\/?$/.test(path)) return 'home';
    if (path.includes('/atricon/')) return 'atricon';
    if (path.includes('/candidato/')) return 'candidatron';
    if (path.includes('/extractron/extractron_noticias')) return 'noticias-js';
    if (path.includes('/extractron/')) return 'extractron';
    if (path.includes('/sizetron/')) return 'sizetron';
    if (path.includes('/imagetron/')) return 'imagetron';
    if (path.includes('/banner/')) return 'banner';
    if (path.includes('/baixatron/')) return 'baixatron';
    if (path.includes('/formtron/marcelo')) return 'marcelo';
    return '';
  }

  function savedTheme() {
    try {
      const theme = localStorage.getItem(storage.theme) || localStorage.getItem('atricon-theme');
      return theme === 'light' || theme === 'dark' ? theme : 'dark';
    } catch (error) {
      return 'dark';
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      // Storage can be blocked for local files.
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.scriptTheme = theme;
    document.documentElement.dataset.theme = daisyThemes[theme] || daisyThemes.dark;
    if (document.body) {
      document.body.dataset.theme = daisyThemes[theme] || daisyThemes.dark;
      document.body.dataset.scriptTheme = theme;
    }
    setThemeStylesheet(theme);
    save(storage.theme, theme);
    save('atricon-theme', theme);

    updateThemeControls(theme);

    const label = document.querySelector('[data-shell-theme-label]');
    if (label) label.textContent = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
  }

  function updateThemeControls(theme) {
    const button = document.querySelector('[data-shell-theme]');
    if (!button) return;

    const nextModeLabel = theme === 'dark' ? 'modo claro' : 'modo escuro';
    button.innerHTML = theme === 'dark' ? themeIconSvg('moon') : themeIconSvg('sun');
    button.setAttribute('title', `Alternar para ${nextModeLabel}`);
    button.setAttribute('aria-label', `Alternar para ${nextModeLabel}`);
  }

  function setThemeStylesheet(theme) {
    const href = `${assetBase}${themeFiles[theme] || themeFiles.dark}`;
    let link = document.getElementById('script-shell-theme-css');
    if (!link) {
      link = document.createElement('link');
      link.id = 'script-shell-theme-css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) {
      link.setAttribute('href', href);
    }
  }

  function setOpen(isOpen) {
    document.body.classList.toggle('script-shell-open', isOpen);
    const toggle = document.querySelector('[data-shell-toggle]');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.textContent = isOpen ? '<' : '>';
      toggle.title = isOpen ? 'Recolher menu' : 'Abrir menu';
    }
    save(storage.open, isOpen ? '1' : '0');
  }

  function initialOpen() {
    try {
      return localStorage.getItem(storage.open) === '1';
    } catch (error) {
      return false;
    }
  }

  function iconSvg(name) {
    const icons = {
      home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
      chart: '<path d="M4 19V5"/><path d="M4 19h17"/><path d="M8 16v-5"/><path d="M13 16V8"/><path d="M18 16v-3"/>',
      ballot: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h.01"/><path d="M11 8h5"/><path d="M8 13h.01"/><path d="M11 13h5"/><path d="m8 17 1 1 2-2"/>',
      'file-search': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="11" cy="14" r="3"/><path d="m13.2 16.2 2.3 2.3"/>',
      compress: '<path d="M8 3v5H3"/><path d="M16 3v5h5"/><path d="M3 16h5v5"/><path d="M21 16h-5v5"/><path d="M8 8 3 3"/><path d="m16 8 5-5"/><path d="m8 16-5 5"/><path d="m16 16 5 5"/>',
      image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m21 16-5-5L5 19"/>',
      layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 20V9"/>',
      download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
      form: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
      news: '<path d="M4 5h13a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3z"/><path d="M8 9h7"/><path d="M8 13h8"/><path d="M8 17h5"/>'
    };
    return `<svg class="script-shell-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.home}</svg>`;
  }

  function themeIconSvg(name) {
    const icons = {
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
      moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3c0 5 3.79 8.79 8.79 8.79"/>'
    };
    return `<svg class="script-shell-theme-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.sun}</svg>`;
  }

  function buildShell() {
    if (document.querySelector('.script-shell')) return;

    const base = assetBase;
    const active = activePageId();
    const shell = document.createElement('aside');
    shell.className = 'script-shell';
    shell.setAttribute('aria-label', 'Navegacao das ferramentas');
    shell.innerHTML = `
      <div class="script-shell-rail">
        <button class="script-shell-toggle" type="button" data-shell-toggle aria-expanded="false" title="Abrir menu">></button>
        <div class="script-shell-mark">Script</div>
        <button class="script-shell-theme" type="button" data-shell-theme aria-label="Alternar tema" title="Alternar tema"></button>
      </div>
      <div class="script-shell-panel">
        <div class="script-shell-title">
          <strong>Script Tools</strong>
          <span>Navegacao central das paginas HTML deste projeto.</span>
        </div>
        <nav class="script-shell-nav">
          ${pages.map((page) => `
            <a class="script-shell-link ${page.id === active ? 'is-active' : ''}" href="${base}${page.href}">
              ${iconSvg(page.icon)}
              <span>${page.label}</span>
            </a>
          `).join('')}
        </nav>
        <div class="script-shell-footer">
          <button type="button" data-shell-theme-label>Modo claro</button>
          <span>Use a seta para recolher a barra.</span>
        </div>
      </div>
    `;

    document.body.prepend(shell);
    document.body.classList.add('script-shell-ready');
    applyTheme(savedTheme());
    setOpen(initialOpen());

    shell.querySelector('[data-shell-toggle]').addEventListener('click', () => {
      setOpen(!document.body.classList.contains('script-shell-open'));
    });

    shell.querySelectorAll('[data-shell-theme], [data-shell-theme-label]').forEach((button) => {
      button.addEventListener('click', () => {
        const current = document.documentElement.dataset.scriptTheme === 'light' ? 'light' : 'dark';
        applyTheme(current === 'dark' ? 'light' : 'dark');
      });
    });
  }

  applyTheme(savedTheme());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildShell);
  } else {
    buildShell();
  }
})();
