# Atricon Collector - Extensao Chrome

Extensao Manifest V3 para coletar avaliacoes do Avalia Atricon usando a sessao ja aberta no Chrome.

## O que esta versao faz

- Mostra um checklist de cidades antes de iniciar a coleta.
- Permite coletar todas, uma unica cidade ou cidades especificas.
- Ja inclui um JSON interno com `orgao`, `cidade`, `user` e `senha`.
- Faz login automatico para cada cidade selecionada.
- Abre a tela `Minhas Avaliacoes`.
- Le as linhas da tabela de avaliacoes.
- Para registros com status `Validado`, abre o link do questionario e tenta ler a porcentagem.
- Quando apenas uma cidade/avaliacao e selecionada, ou a opcao de analise completa esta marcada, abre os formularios e coleta criterios e evidencias/manifestacoes de validacao.
- Oferece analise consolidada com falhas recorrentes, maioria, orgaos afetados, prioridades, matriz de criterios, divergencias e cruzamentos, com filtros e exportacao JSON/CSV.
- Abre a pagina interna de resultado da extensao com opcoes de copiar e baixar o JSON.
- Mantem opcao de baixar o JSON depois.
- Salva o ultimo resultado dentro da extensao para consulta rapida.

## Limites desta primeira versao

- Para varios orgaos, a coleta detalhada precisa ser ativada em `Coletar e analisar todos os selecionados` e leva mais tempo.
- As imagens das evidencias entram no JSON como links; a extensao nao baixa as imagens para uma pasta local.
- Usa a aba visivel do Chrome durante a coleta.
- A pasta da extensao contem `orgaos_avalia_credentials.json` com credenciais internas.

## Como instalar no Chrome

1. Abra `chrome://extensions`.
2. Ative `Modo do desenvolvedor`.
3. Clique em `Carregar sem compactacao`.
4. Selecione esta pasta:

```text
atricon/extension
```

## Como usar

1. Entre no Avalia Atricon normalmente pelo Chrome, se quiser testar a sessao.
2. Clique no icone da extensao `Atricon Collector`.
3. Clique em `Abrir painel`.
4. Confira se as credenciais internas foram carregadas.
5. Escolha `Todas`, `Especificas` ou `Unica`.
6. Marque as cidades desejadas no checklist.
7. Para analisar todos, marque `Coletar e analisar todos os selecionados`. Clique em `Coletar avaliacoes`.
8. Ao final, a pagina de resultado da extensao sera aberta automaticamente.
9. Use `Baixar JSON` no painel se quiser salvar o arquivo depois.

## Atualizar lista de cidades

Quando `atricon/entrada/orgaos_avalia.json` mudar, gere novamente `orgaos_avalia_public.json` e `orgaos_avalia_credentials.json` antes de distribuir a extensao.
