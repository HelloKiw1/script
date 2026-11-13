# Atricon: coleta e análise consolidada

## Programa de relatórios Barco Digital

O programa com janela está em [`Relatório/README.md`](Relat%C3%B3rio/README.md).
Abra `Relatório/iniciar.bat` para selecionar um PDF original ou um órgão do
cadastro, capturar as páginas públicas atuais e gerar o relatório. A revisão
dos comentários pode ser feita por API ou pelo pacote com prompt para outra
IA, com importação posterior. As saídas ficam em `analise_2026/barco/`.

## HTML com gráficos e Comentário do Revisor

Abra `analise_revisores_2026.html` para a análise consolidada preparada em
11/11/2026. O arquivo funciona localmente, sem bibliotecas remotas. Mantenha
a pasta `entrada/.resultado/analise_revisores_2026/pdfs/` junto ao projeto para
abrir as páginas das evidências. A base inclui a união dos clientes da planilha
original com o cadastro do coletor; órgãos sem PDF aparecem com a limitação.

Os botões **Prefeituras** e **Câmaras** e os filtros de cidade, status, dimensão,
critério/comentário e presença de comentário do revisor recalculam as pizzas,
barras, totais, tabelas e exportações. A tabela de critérios separa quantos
órgãos falham em cada grupo e o total de subitens reprovados.

Nas evidências, o **Comentário do Revisor mais recente por data** fica em
destaque. Os comentários anteriores e de outras etapas ficam no histórico.
Cada registro mostra a etapa do resultado, os subitens reprovados e o link para
a página do PDF. Ausência de comentário não é convertida em justificativa.
As imagens das evidências permanecem no documento original.

O PDF indicado de Silvanópolis é uma imagem: as tabelas passaram por OCR e
conferência visual das células incertas; os 13 comentários do revisor foram
transcritos e conferidos visualmente. O relatório informa essa limitação.
Os PDFs coletados pelo sistema são lidos por `pdf_atricon.py`.

Novas coletas com `--analise-completa` geram automaticamente um `.html` ao
lado do JSON, usando `relatorio_html.py`. O visualizador oferece o link ao
final da coleta e sua aba **Análise de todos** usa o mesmo motor de gráficos.
O HTML e suas exportações excluem os campos de credenciais.

Diferenças apenas de pontuação, espaços e hifens de quebra de linha do mesmo
enunciado são normalizadas no cruzamento. Palavras e números diferentes
permanecem critérios distintos; o ID local da resposta nunca é usado como
identificador global.

Para consultar todos com os detalhes necessários à análise, abra o coletor e
escolha **Coletar e analisar todas as cidades**. Pelo visualizador, use
**Coletor → Coletar e analisar todos**. A coleta simples continua disponível.

No terminal:

```powershell
python atricon/coletor_atricon.py --todos --analise-completa
```

## Relatórios PDF após o encerramento da avaliação

A coleta individual e **Coletar e analisar todas as cidades** usam o relatório
`/questionarios/ID/pdf/`, depois do login e da identificação do órgão em Minhas
Avaliações. O formulário com prazo encerrado não é utilizado nesse fluxo.
Se o endpoint retornar uma página de impressão, o coletor a converte em PDF com
Chromium headless, reutilizando a autenticação em memória. Os arquivos ficam em
`pdfs/<nome_do_resultado>/`, junto à pasta do JSON. O visualizador oferece o link PDF.

A extração lê as tabelas do PDF e preserva Avaliação, Validação e Revisão.
Quando existe Revisão, ela é o resultado usado na análise consolidada; lacunas
não são preenchidas com respostas de etapas anteriores. O total de itens extraídos
é conferido contra o resumo do documento e divergências tornam a coleta parcial.
O ID, o ano e a entidade do PDF são conferidos antes da associação ao cliente.

O PDF atual não informa a importância de cada critério. Esse campo fica vazio,
e o painel avisa que não pode determinar quantas falhas são essenciais. Imagens
permanecem no PDF original; comentários de validadores e revisores são extraídos.
A coleta simples de todas as cidades continua disponível sem baixar os PDFs.

Instale também a dependência de leitura do PDF com o comando `install` do coletor.

Depois da coleta, a aba **Análise de todos** apresenta:

- Critérios e tipos de falha mais frequentes, com quantidade, percentual e órgãos afetados.
- Maioria identificada quando mais de 50% dos órgãos com resultado conhecido falham no mesmo critério/item.
- Ranking de órgãos, detalhamento dos itens não atendidos e prioridades por critérios essenciais e alcance.
- Matriz órgão × critério, falhas por dimensão e problemas que ocorrem juntos.
- Divergências em que a avaliação informou Sim e a validação informou Não.
- Cruzamentos por tipo de órgão, cidade, status e setor atual.
- Média e mediana das notas informadas, cobertura da coleta, datas e erros técnicos.
- Filtros próprios da análise e exportação da análise em JSON ou dos dados detalhados em CSV.

A análise usa todos os registros carregados, independentemente dos filtros
da aba Resultados. Seus próprios filtros recalculam os indicadores e as exportações.
É possível carregar JSONs anteriores; sem critérios estruturados, o painel
mostra a limitação da cobertura e os dados disponíveis.

## O que é coletado

O modo completo percorre os órgãos sequencialmente, usando o mesmo fluxo de
login existente. Além dos dados gerais e evidências, salva `criterios_validacao`
com todos os critérios encontrados, inclusive os que não possuem evidências.
Cada critério traz dimensão, nome, importância, avaliação e validação por item.
`coletado_em` registra a data da consulta; `coleta_detalhada` indica se ela foi
concluída, parcial, sem critérios ou apresentou erro.

Se uma evidência falhar, os dados gerais e critérios já coletados são preservados.
A análise é calculada localmente, sem enviar dados para outros serviços.

## Interpretação

Uma unidade corresponde ao tipo de órgão e cidade. Duplicatas usam a coleta
mais recente; sem data, a última ocorrência. Critérios são cruzados por nome
e dimensão, pois o ID da resposta pode variar entre órgãos. Mensagens e
evidências repetidas não multiplicam as falhas.

Itens explicitamente Não representam falhas. Sim representa atendimento;
pendências, status desconhecidos e itens não aplicáveis não entram na base de
itens verificados. Um critério com Não já possui falha; para considerá-lo atendido,
todos os itens aplicáveis observados devem ter Sim. Um critério inteiramente
não aplicável fica fora dessa base.

Ausência de dados não significa atendimento. Evidências isoladas de arquivos
antigos podem conter apenas falhas: o painel avisa que essa amostra é parcial.
As notas são as informadas pelo Avalia, sem estimar os pesos da nota oficial.
Os dados descrevem o arquivo carregado, e não uma consulta em tempo real nem
uma evolução histórica. Status diferentes podem representar etapas distintas.
Coocorrência não comprova relação de causa.

## Extensão Chrome

Recarregue a extensão em `chrome://extensions`, abra seu painel, escolha
**Todas** e marque **Coletar e analisar todos os selecionados**. Ao terminar,
o resultado abre a análise consolidada automaticamente. A opção também pode
ser usada com um subconjunto de cidades.

## Verificação local

Os testes usam dados simulados, sem acessar o Avalia ou ler credenciais reais:

```powershell
node --test atricon/tests/analise.test.cjs
python -B -m unittest discover -s atricon/tests -p test_coletor.py -v
node atricon/tests/browser.cjs
```

O teste de navegador requer Playwright instalado. Se necessário, defina
`ATRICON_PLAYWRIGHT_MODULE` com o caminho do pacote. Ele verifica a integração
do botão, filtros, downloads, layout em celular e desktop, temas, resultado da
extensão e extração de critérios sem evidências. As capturas ficam em
`tmp/atricon-analysis/`.
