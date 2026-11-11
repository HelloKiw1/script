/* Shared DOM reader used by the Python collector and the Chrome extension. */
(function (root) {
  function read(container, chapter = '') {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const titles = [...container.querySelectorAll('[data-bs-target*="Criterio"]')];
    const seen = new Set();
    return titles.flatMap(title => {
      const card = title.closest('.card');
      if (!card || seen.has(card)) return [];
      seen.add(card);
      const clone = title.cloneNode(true);
      const badge = clone.querySelector('.badge');
      const importance = clean(badge?.textContent);
      badge?.remove();
      const column = needle => {
        const header = [...card.querySelectorAll('h6')].find(h => norm(h.textContent).includes(needle));
        const col = header?.closest('[class*="col-"]');
        return col ? [...col.querySelectorAll('.mb-2')].map(item => {
          const copy = item.cloneNode(true);
          const status = clean(copy.querySelector('.badge')?.textContent);
          copy.querySelector('.badge')?.remove();
          return { item: clean(copy.textContent), status };
        }).filter(item => item.item) : [];
      };
      const validation = column('validacao');
      return [{
        titulo: chapter, criterio: clean(clone.textContent),
        criterio_id: title.getAttribute('data-bs-target') || '',
        grau_importancia: importance,
        validacoes_avaliacao: column('avaliacao'), validacoes_validacao: validation,
        validacoes_nao_atendidas: validation.filter(item => /^nao(?:\s|$)/.test(norm(item.status)) && !norm(item.status).includes('aplic')).map(item => item.item)
      }];
    });
  }
  root.AtriconCriteria = { read };
  if (typeof module === 'object' && module.exports) module.exports = { read };
})(globalThis);
