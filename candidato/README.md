# Candidatron

Página estática para consultar candidaturas pela base oficial de Dados Abertos do TSE, filtrar os resultados e exportar CSV ou JSON.

## Busca automática sem servidor

Instale o projeto como extensão local:

1. Abra `chrome://extensions` no Chrome ou `edge://extensions` no Edge.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a raiz deste projeto: `C:\Users\eduar\Documents\GitHub\barco\script`.
5. Clique no ícone do Candidatron instalado.

A extensão serve apenas para conceder ao navegador permissão de leitura em `https://cdn.tse.jus.br/*`. Nenhum servidor é iniciado.

Ao pesquisar, o navegador baixa o arquivo oficial `consulta_cand_<ano>.zip`, extrai em memória os CSVs de Brasil e do estado escolhido e monta a lista. O ZIP fica em cache na memória da página para que novas pesquisas no mesmo ano não façam outro download.

## Usar somente o HTML

Também é possível abrir `candidato.html` diretamente. Nesse modo, use **Baixar ZIP** e depois **Importar ZIP/JSON**, pois o CDN do TSE envia um cabeçalho CORS duplicado que impede a leitura automática a partir de `file://`.

## Consulta padrão

- Ano: `2026`
- Estado: Tocantins (`TO`)
- Cargos: Presidente (`1`), Governador (`3`), Senador (`5`), Deputado Federal (`6`) e Deputado Estadual (`7`)

Ao consultar todos os cargos, Presidente usa o arquivo `BR`; os demais usam o arquivo do estado selecionado.

Fonte: [Candidatos 2026 — Dados Abertos do TSE](https://dadosabertos.tse.jus.br/dataset/candidatos-2026).

O botão **Importar ZIP/JSON** também aceita respostas JSON obtidas no DivulgaCandContas.
