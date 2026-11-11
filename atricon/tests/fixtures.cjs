const criterion = (name, availability, actuality, importance = 'Essencial', id = '') => ({
  titulo: 'Transparência', criterio: name, criterio_id: id, grau_importancia: importance,
  validacoes_validacao: [
    { item: 'Disponibilidade', status: availability },
    ...(actuality === undefined ? [] : [{ item: 'Atualidade', status: actuality }])
  ],
  validacoes_avaliacao: [{ item: 'Disponibilidade', status: 'Sim' }, { item: 'Atualidade', status: 'Sim' }]
});
const rows = [
  { orgao: 'Prefeitura', cidade: 'Alfa', porcentagem: '60,5%', status: 'Validado', setor_atual: 'Tribunal',
    coletado_em: '2026-11-11T10:00:00Z', coleta_detalhada: 'concluida', modo_coleta: 'analise_completa',
    criterios_validacao: [criterion('1.1 Receitas', 'Não', 'Não', 'Essencial', '101'), criterion('1.2 Despesas', 'Não', undefined, 'Obrigatório', '102')] },
  { orgao: 'Prefeitura', cidade: 'Beta', porcentagem: '80%', status: 'Validado', setor_atual: 'Tribunal',
    coletado_em: '2026-11-11T11:00:00Z', coleta_detalhada: 'concluida',
    criterios_validacao: [criterion('1.1 Receitas', 'Não', 'Sim', 'Essencial', '201'), criterion('1.2 Despesas', 'Não', undefined, 'Obrigatório', '202')] },
  { orgao: 'Câmara', cidade: 'Gama', porcentagem: '100%', status: 'Validado', coleta_detalhada: 'concluida',
    criterios_validacao: [criterion('1.1 Receitas', 'Sim', 'Sim'), criterion('1.2 Despesas', 'Sim', undefined, 'Obrigatório')] },
  { orgao: 'Prefeitura', cidade: 'Delta', porcentagem: '', status: 'Em validação',
    criterios_validacao: [criterion('1.1 Receitas', 'Pendente', 'Não se aplica')] },
  { orgao: 'Câmara', cidade: 'Épsilon', porcentagem: '', erro: 'Falha de conexão', coleta_detalhada: 'erro' }
];
module.exports = { criterion, rows };
