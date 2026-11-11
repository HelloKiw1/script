(() => {
  function parsePercentage(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    const text = String(value).trim().replace(/%$/, '').trim().replace(',', '.');
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  }

  function evaluate(record, year = 2026) {
    const score = parsePercentage(record?.[`nota_${year}`] ?? record?.[`indice_${year}`]);
    const essentials = parsePercentage(record?.[`essenciais_${year}`]);
    const result = { score, essentials, type: '', eligible: false, reason: '' };
    if (essentials === null) {
      result.reason = `Sem selo ${year}: informe a nota dos criterios essenciais (obrigatorio: 100%).`;
    } else if (essentials !== 100) {
      result.reason = `Sem selo ${year}: essenciais ${String(essentials).replace('.', ',')}%. E necessario atingir 100%.`;
    } else if (score === null || score < 75) {
      result.reason = `Sem selo ${year}: a nota geral precisa estar entre 75 e 100, com essenciais em 100%.`;
    } else {
      result.type = score >= 95 ? 'diamante' : score >= 85 ? 'ouro' : 'prata';
      result.eligible = true;
    }
    return result;
  }

  globalThis.BannerSealRules = { parsePercentage, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.BannerSealRules;
})();
