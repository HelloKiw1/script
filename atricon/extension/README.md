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
- Abre o `atricon/visualizador_atricon.html` diretamente com o resultado.
- Mantem opcao de baixar o JSON depois.
- Salva o ultimo resultado dentro da extensao para consulta rapida.

## Limites desta primeira versao

- Nao coleta evidencias/manifestacoes detalhadas.
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
7. Clique em `Coletar avaliacoes`.
8. Ao final, o visualizador sera aberto automaticamente.
9. Use `Baixar JSON` no painel se quiser salvar o arquivo depois.

Se o Chrome bloquear a abertura do `visualizador_atricon.html`, ative `Permitir acesso a URLs de arquivo` na extensao em `chrome://extensions`.

## Atualizar lista de cidades

Quando `atricon/entrada/orgaos_avalia.json` mudar, gere novamente `orgaos_avalia_public.json` e `orgaos_avalia_credentials.json` antes de distribuir a extensao.
