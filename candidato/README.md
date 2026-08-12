# Candidatron

Página estática para consultar candidaturas pela base oficial de Dados Abertos do TSE, filtrar os resultados e exportar CSV ou JSON.

## Uso padrão sem servidor

Abra `candidato.html` diretamente no Chrome ou Edge e faça a pesquisa. A base padrão de 2026 já fica dentro de `candidato/dados`, portanto não é necessário iniciar servidor, instalar extensão ou importar arquivo.

Arquivos da base interna:

- `dados/consulta_cand_2026.zip`: ZIP oficial original.
- `dados/consulta_cand_2026.js`: cópia carregável pelo navegador, gerada a partir do ZIP.

## Atualizar a base interna

Substitua `dados/consulta_cand_2026.zip` por uma versão mais nova e execute, na raiz do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File candidato/sincronizar_base.ps1
```

O script atualiza `consulta_cand_2026.js` e registra tamanho, data e hash SHA-256 do ZIP usado.

## Extensão opcional

Se quiser consultar automaticamente anos que ainda não possuem uma base interna, instale o projeto como extensão local:

1. Abra `chrome://extensions` no Chrome ou `edge://extensions` no Edge.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a raiz deste projeto: `C:\Users\eduar\Documents\GitHub\barco\script`.
5. Clique no ícone do Candidatron instalado.

A extensão serve apenas para conceder ao navegador permissão de leitura em `https://cdn.tse.jus.br/*`. Nenhum servidor é iniciado. Para 2026 ela não é necessária, pois o sistema prioriza a base interna.

Ao pesquisar, o navegador baixa o arquivo oficial `consulta_cand_<ano>.zip`, extrai em memória os CSVs de Brasil e do estado escolhido e monta a lista. O ZIP fica em cache na memória da página para que novas pesquisas no mesmo ano não façam outro download.

O botão **Baixar atualização** continua disponível para obter manualmente um ZIP mais recente do TSE. Após baixar, ele pode ser importado imediatamente ou colocado em `dados` e sincronizado pelo comando acima.

## Consulta padrão

- Ano: `2026`
- Estado: Tocantins (`TO`)
- Cargos: Presidente (`1`), Governador (`3`), Senador (`5`), Deputado Federal (`6`) e Deputado Estadual (`7`)

Ao consultar todos os cargos, Presidente usa o arquivo `BR`; os demais usam o arquivo do estado selecionado.

Fonte: [Candidatos 2026 — Dados Abertos do TSE](https://dadosabertos.tse.jus.br/dataset/candidatos-2026).

O botão **Importar ZIP/JSON** também aceita respostas JSON obtidas no DivulgaCandContas.
