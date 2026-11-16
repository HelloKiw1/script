'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="app-token"]').content;
const state = { origem: 'pdf', pdf: null, cadastro: '', config: null, resultado: null, ocupado: false,
  enviando: 0, ultimaTransicao: '', ultimoLog: '', desconexoes: 0, encerrado: false,
  visualizandoFormulario: false, ultimoEstado: '' };
let toastTimer;

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-Barco-Token', token);
  if (options.body && typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.erro || 'Não foi possível concluir esta operação.');
  return data;
}

function mensagem(id, texto) { $(id).textContent = texto || ''; $(id).hidden = !texto; }
function toast(texto) {
  $('toast').querySelector('span').textContent = texto;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function habilitarGeracao() {
  $('gerar').disabled = state.ocupado || state.enviando > 0 || !state.config || state.config.ausentes.length > 0;
}
function erroFormulario(erro) {
  mensagem('erro-formulario', erro.message || String(erro));
  $('erro-formulario').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function opcao(valor, texto) { const option = document.createElement('option'); option.value = valor; option.textContent = texto; return option; }
function orgaosFiltrados() {
  const termo = $('busca-orgao').value.toLocaleLowerCase('pt-BR');
  const selecionado = $('orgao').value;
  const orgaos = (state.config?.orgaos || []).filter(o => o.rotulo.toLocaleLowerCase('pt-BR').includes(termo));
  $('orgao').replaceChildren(opcao('', orgaos.length ? 'Selecione um órgão…' : 'Nenhum órgão encontrado'));
  orgaos.forEach(o => $('orgao').append(opcao(String(o.indice), o.rotulo)));
  if (orgaos.some(o => String(o.indice) === selecionado)) $('orgao').value = selecionado;
  $('total-orgaos').textContent = `${orgaos.length} disponíveis`;
}
async function configurar() {
  const selecionado = $('pdf-existente').value;
  const cadastroOrgaos = state.cadastro ? state.config?.orgaos : null;
  state.config = await api('/api/config');
  if (cadastroOrgaos) state.config.orgaos = cadastroOrgaos;
  $('destino').value ||= state.config.destino;
  $('pdf-existente').replaceChildren(opcao('', 'Selecione um PDF…'));
  state.config.pdfs.forEach(nome => $('pdf-existente').append(opcao(nome, nome)));
  if (state.config.pdfs.includes(selecionado)) $('pdf-existente').value = selecionado;
  $('pdf-existente').closest('details').hidden = state.config.pdfs.length === 0;
  $('ambiente-aviso').hidden = state.config.ausentes.length === 0;
  $('ambiente-texto').textContent = state.config.ausentes.length ? 'Preparar ambiente' : 'Ambiente pronto';
  orgaosFiltrados();
  habilitarGeracao();
}

async function enviar(file, tipo) {
  if (!file) throw new Error('Selecione um arquivo antes de continuar.');
  if (file.size > 150 * 1024 * 1024) throw new Error('Selecione um arquivo de até 150 MB.');
  state.enviando++;
  habilitarGeracao();
  try {
    return await api(`/api/arquivo?tipo=${tipo}&nome=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  } finally { state.enviando--; habilitarGeracao(); }
}
function limparPDF() {
  state.pdf = null;
  $('arquivo-pdf').value = '';
  $('pdf-selecionado').hidden = true;
  $('dropzone').hidden = false;
}
async function selecionarPDF(file) {
  if (!file) return;
  mensagem('erro-formulario', '');
  document.body.classList.add('uploading');
  try {
    const enviado = await enviar(file, 'pdf');
    state.pdf = enviado;
    $('pdf-existente').value = '';
    $('nome-pdf').textContent = enviado.nome;
    $('tamanho-pdf').textContent = `${(enviado.tamanho / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB · PDF original selecionado`;
    $('dropzone').hidden = true;
    $('pdf-selecionado').hidden = false;
  } catch (erro) { limparPDF(); erroFormulario(erro); }
  finally { document.body.classList.remove('uploading'); }
}

function selecionarOrigem(origem) {
  state.origem = origem;
  for (const nome of ['pdf', 'orgao']) {
    const ativo = nome === origem;
    $(`tab-${nome}`).classList.toggle('selected', ativo);
    $(`tab-${nome}`).setAttribute('aria-selected', String(ativo));
    $(`painel-${nome}`).hidden = !ativo;
  }
}
function atualizarPassos(atual) {
  document.querySelectorAll('.steps li').forEach(li => {
    const numero = Number(li.dataset.step);
    li.classList.toggle('active', numero === atual);
    li.classList.toggle('done', numero < atual);
  });
}
function parametros() {
  return { origem: state.origem, pdf_id: state.pdf?.id || '', pdf_existente: $('pdf-existente').value,
    cadastro_id: state.cadastro, orgao_indice: $('orgao').value === '' ? null : Number($('orgao').value),
    destino: $('destino').value.trim(), espera: Number($('espera').value), documentos: Number($('documentos').value),
    visivel: $('visivel').checked, capturar: $('capturar').checked };
}
async function iniciar(dados) {
  mensagem('erro-formulario', '');
  const estado = await api('/api/iniciar', { method: 'POST', body: JSON.stringify(dados) });
  state.ultimoLog = '';
  renderizarEstado(estado);
  $('execucao').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function renderizarEstado(estado) {
  if (!estado.id) return;
  if (state.visualizandoFormulario && estado.id === state.ultimoEstado && !['executando', 'cancelando'].includes(estado.situacao)) return;
  state.visualizandoFormulario = false;
  state.ultimoEstado = estado.id;
  const ativo = ['executando', 'cancelando'].includes(estado.situacao);
  const instalando = estado.tipo === 'instalar';
  state.ocupado = ativo;
  document.body.classList.toggle('busy', ativo);
  $('formulario').hidden = true;
  $('execucao').hidden = false;
  $('cancelar').hidden = !ativo || instalando;
  $('cancelar').disabled = estado.situacao === 'cancelando';
  $('encerrar').disabled = ativo && instalando;
  $('instalar').disabled = ativo;
  $('instalar-aviso').disabled = ativo;
  $('voltar').hidden = ativo;
  $('indicador-ativo').hidden = !ativo;
  $('progresso').classList.toggle('indeterminate', ativo && instalando);
  const percentual = Math.round(estado.percentual || 0);
  $('percentual').textContent = ativo && instalando ? 'Em curso' : `${percentual}%`;
  $('percentual').style.fontSize = ativo && instalando ? '18px' : '';
  $('barra-progresso').style.width = `${percentual}%`;
  $('progresso').setAttribute('aria-valuenow', String(percentual));
  $('etapa').textContent = estado.etapa;
  $('situacao').className = 'badge blue';
  $('situacao').textContent = estado.situacao === 'cancelando' ? 'Cancelando' : 'Em andamento';
  $('titulo-execucao').textContent = instalando ? 'Preparando o ambiente' : estado.tipo === 'importar' ? 'Atualizando seu relatório' : 'Preparando seu relatório';
  atualizarPassos(2);
  if (estado.situacao === 'concluido') {
    $('situacao').className = 'badge green';
    $('situacao').textContent = 'Concluído';
    $('titulo-execucao').textContent = instalando ? 'Ambiente pronto para começar' : estado.tipo === 'importar' ? 'Seu relatório foi atualizado' : 'Seu PDF e prompt estão prontos';
    atualizarPassos(instalando ? 1 : 3);
  } else if (['erro', 'cancelado'].includes(estado.situacao)) {
    $('situacao').className = estado.situacao === 'erro' ? 'badge red' : 'badge amber';
    $('situacao').textContent = estado.situacao === 'erro' ? 'Atenção' : 'Cancelado';
    $('titulo-execucao').textContent = estado.situacao === 'erro' ? 'Não foi possível concluir' : 'Execução cancelada';
  }
  const logs = estado.logs.join('\n');
  if (logs !== state.ultimoLog) {
    $('historico').textContent = logs || 'Preparando…';
    $('historico').scrollTop = $('historico').scrollHeight;
    state.ultimoLog = logs;
  }
  $('resultado').hidden = !estado.resultado;
  $('importar-resultado').hidden = !estado.resultado;
  if (estado.resultado) {
    state.resultado = estado.resultado;
    const r = estado.resultado;
    const nome = r.arquivo.split(/[\\/]/).at(-1);
    $('nome-resultado').textContent = nome;
    $('detalhes-resultado').textContent = `${r.paginas} páginas · ${r.pendencias.length ? `${r.pendencias.length} pendências de revisão` : 'Conferência concluída'}`;
    $('pasta-resultado').textContent = r.pacote;
    $('abrir-pdf').href = `/api/resultado/pdf?token=${encodeURIComponent(token)}`;
    $('abrir-prompt').href = `/api/resultado/prompt?token=${encodeURIComponent(token)}`;
    if (r.pendencias.length) { $('situacao').textContent = 'Pronto para revisão'; $('situacao').className = 'badge amber'; }
    $('etapa').textContent = r.revisao_importada ? estado.etapa : 'Copie o prompt e continue a revisão no Codex do VS Code.';
  }
  const transicao = `${estado.id}:${estado.situacao}`;
  if (!ativo && transicao !== state.ultimaTransicao) {
    state.ultimaTransicao = transicao;
    limparPDF();
    state.cadastro = '';
    configurar().catch(erroFormulario);
  }
  habilitarGeracao();
}

async function acompanhar() {
  if (state.encerrado) return;
  try {
    const estado = await api('/api/status');
    state.desconexoes = 0;
    $('conexao').hidden = true;
    renderizarEstado(estado);
  } catch (erro) {
    state.desconexoes++;
    if (state.desconexoes >= 3) { $('conexao').hidden = false; $('gerar').disabled = true; }
  } finally { if (!state.encerrado) setTimeout(acompanhar, 1000); }
}

function abrirImportacao() {
  mensagem('erro-importacao', '');
  const ultima = Boolean(state.resultado);
  $('usar-ultimo-linha').hidden = !ultima;
  $('usar-ultimo').checked = ultima;
  $('arquivos-importacao').hidden = ultima;
  $('importacao').showModal();
}
async function importar(event) {
  event.preventDefault();
  mensagem('erro-importacao', '');
  const botao = $('confirmar-importacao');
  botao.disabled = true;
  try {
    const dados = { ...parametros(), tipo: 'importar', origem: 'pdf', usar_ultimo: $('usar-ultimo').checked && Boolean(state.resultado) };
    if (!$('importar-resposta').files[0]) throw new Error('Selecione a resposta JSON preenchida pelo Codex.');
    if (!dados.usar_ultimo && (!$('importar-original').files[0] || !$('importar-prompt').files[0])) {
      throw new Error('Selecione o PDF original e o prompt gerado junto ao relatório.');
    }
    if (!dados.usar_ultimo) {
      dados.pdf_id = (await enviar($('importar-original').files[0], 'pdf')).id;
      dados.pdf_existente = '';
      dados.prompt_id = (await enviar($('importar-prompt').files[0], 'prompt')).id;
    }
    dados.resposta_id = (await enviar($('importar-resposta').files[0], 'resposta')).id;
    await iniciar(dados);
    $('importacao').close();
    $('form-importacao').reset();
  } catch (erro) { mensagem('erro-importacao', erro.message); }
  finally { botao.disabled = false; }
}

$('tab-pdf').addEventListener('click', () => selecionarOrigem('pdf'));
$('tab-orgao').addEventListener('click', () => selecionarOrigem('orgao'));
document.querySelector('.segmented').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    selecionarOrigem(state.origem === 'pdf' ? 'orgao' : 'pdf');
    $(`tab-${state.origem}`).focus();
  }
});
$('arquivo-pdf').addEventListener('change', event => selecionarPDF(event.target.files[0]));
$('remover-pdf').addEventListener('click', limparPDF);
$('pdf-existente').addEventListener('change', () => { if ($('pdf-existente').value) limparPDF(); });
for (const eventName of ['dragenter', 'dragover']) $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => selecionarPDF(event.dataTransfer.files[0]));
$('busca-orgao').addEventListener('input', orgaosFiltrados);
$('arquivo-cadastro').addEventListener('change', async event => {
  if (!event.target.files[0]) return;
  try {
    state.cadastro = (await enviar(event.target.files[0], 'cadastro')).id;
    state.config.orgaos = (await api(`/api/orgaos?cadastro=${encodeURIComponent(state.cadastro)}`)).orgaos;
    $('busca-orgao').value = ''; orgaosFiltrados(); toast('Cadastro carregado. Selecione um órgão.');
  } catch (erro) { state.cadastro = ''; erroFormulario(erro); }
});
$('formulario').addEventListener('submit', async event => {
  event.preventDefault();
  if (!event.target.reportValidity() || state.enviando || state.ocupado) return;
  $('gerar').disabled = true;
  try { await iniciar({ ...parametros(), tipo: 'gerar' }); }
  catch (erro) { erroFormulario(erro); habilitarGeracao(); }
});
$('cancelar').addEventListener('click', async () => {
  try { renderizarEstado(await api('/api/cancelar', { method: 'POST' })); }
  catch (erro) { toast(erro.message); }
});
$('voltar').addEventListener('click', () => {
  $('execucao').hidden = true; $('formulario').hidden = false; atualizarPassos(1);
  // Acompanhar mantém resultados em memória, sem voltar à execução já encerrada.
  state.visualizandoFormulario = true;
  $('erro-formulario').hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('copiar-prompt').addEventListener('click', async () => {
  try {
    const { texto } = await api('/api/prompt');
    if (navigator.clipboard) await navigator.clipboard.writeText(texto);
    else {
      const campo = document.createElement('textarea'); campo.value = texto; document.body.append(campo);
      campo.select(); if (!document.execCommand('copy')) throw new Error('Abra o prompt para copiar o texto.'); campo.remove();
    }
    toast('Prompt copiado. Cole no Codex do VS Code.');
  } catch (erro) { toast(erro.message || 'Abra o prompt para copiar o texto.'); }
});
$('abrir-pasta').addEventListener('click', async () => { try { await api('/api/abrir-pasta', { method: 'POST' }); } catch (erro) { toast(erro.message); } });
for (const id of ['abrir-importacao', 'importar-resultado']) $(id).addEventListener('click', abrirImportacao);
for (const id of ['fechar-importacao', 'cancelar-importacao']) $(id).addEventListener('click', () => $('importacao').close());
$('usar-ultimo').addEventListener('change', () => { $('arquivos-importacao').hidden = $('usar-ultimo').checked; });
$('form-importacao').addEventListener('submit', importar);
async function instalarAmbiente() {
  if (state.ocupado) return;
  try { await iniciar({ tipo: 'instalar' }); } catch (erro) { erroFormulario(erro); }
}
$('instalar-aviso').addEventListener('click', instalarAmbiente);
$('instalar').addEventListener('click', () => {
  if (state.config?.ausentes.length) instalarAmbiente(); else toast('O ambiente está pronto para gerar relatórios.');
});
$('encerrar').addEventListener('click', async () => {
  try {
    await api('/api/encerrar', { method: 'POST' });
    state.encerrado = true; document.body.classList.add('encerrado');
    $('conexao').className = 'alert warning';
    mensagem('conexao', state.ocupado ? 'Encerrando a execução e removendo os auxiliares. Você pode fechar esta aba.' : 'Página local encerrada. Para abrir novamente, execute iniciar.bat.');
    $('encerrar').disabled = true;
  } catch (erro) { toast(erro.message); }
});
configurar().then(acompanhar).catch(erro => { erroFormulario(erro); acompanhar(); });
