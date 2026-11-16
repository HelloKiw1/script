# Relatórios Barco Digital

Transforma um PDF original do Avalia em um relatório no padrão Barco Digital.
Ao terminar, conserva **somente o PDF e o prompt** de revisão no Codex.
Os arquivos de entrada, o código e as dependências do programa são preservados.

## Abrir e gerar

1. Abra `iniciar.bat`. Ele inicia o serviço local e abre a página HTML no
   navegador padrão, normalmente em `http://127.0.0.1:8765/`. Também é possível
   executar `python web_local.py` ou `python relatorio.py` nesta pasta.
2. Na primeira utilização, clique em **Instalar dependências** ou execute
   `instalar.bat`. As bibliotecas ficam em `.dependencias/`; o navegador usado
   pela coleta é o Chromium do Playwright. A página informa quando estiver pronto.
3. Arraste um PDF original para a página, escolha um arquivo do computador,
   selecione um PDF já disponível ou busque um órgão do cadastro local do Avalia.
4. Clique em **Gerar PDF e prompt** e acompanhe as etapas e o histórico.

A interface é HTML, CSS e JavaScript, sem Node, instalação de frontend ou
janela do Tkinter. O Python continua responsável pela geração do PDF em
segundo plano. O serviço aceita conexões somente deste computador. Abrir
`iniciar.bat` novamente reutiliza a página que já estiver rodando.

Use o botão de encerrar no cabeçalho para parar o serviço. Se houver uma
geração em andamento, o serviço aguarda o cancelamento e a limpeza dos
temporários. Fechar apenas a aba mantém o serviço disponível para reabrir.

Um PDF enviado pelo navegador é conservado na pasta de entrada para permitir
a revisão posterior. Um original idêntico já existente é reutilizado. Os
arquivos de prompt, resposta e cadastro enviados à página não ficam guardados
como auxiliares permanentes.

A entrada padrão fica em `resultado/coleta_2026/pdfs/analise_2026/`.
A saída fica em `barco/`, com um par de arquivos por relatório:

```text
orgao_rascunho.pdf
orgao_rascunho_PROMPT_CODEX.md
```

Sem pendências, o nome do PDF não recebe `_rascunho`. O original não é
substituído. Painéis e controles são arredondados; a interface adapta os
cartões à largura da janela e mantém as ações principais no rodapé.

## Limpeza automática

Histórico renderizado, capturas PNG/JPG, anexos baixados, JSONs, cópias do
PDF, contatos de conferência e arquivos intermediários ficam em uma pasta
temporária exclusiva da execução. Essa pasta é excluída no sucesso, no erro
e no cancelamento normal, depois de fechar os arquivos em uso.

As imagens continuam **incorporadas no PDF**, sem arquivos de imagem
separados. O prompt incorpora contexto, textos coletados, datas, URLs,
pendências e a estrutura da resposta. Não há cache persistente de capturas.
Uma nova geração consulta novamente os portais; a importação usa as imagens
do próprio PDF, preservando as datas registradas.

A limpeza abrange apenas os auxiliares da execução atual. Não remove
arquivos de entrada ou pastas antigas e alheias à execução. O fechamento
forçado pelo sistema pode impedir que a limpeza normal seja executada.

## Revisão no Codex do VS Code

1. Clique em **Copiar prompt** e entregue as instruções ao Codex com este
   projeto aberto. Também é possível abrir o arquivo `_PROMPT_CODEX.md`.
2. O Codex lê as regras, os dados incorporados no prompt e as imagens no PDF,
   preenche a resposta JSON no caminho temporário indicado e executa o
   comando de importação que já vem no prompt.
3. A importação confere o hash do original, o hash do PDF associado,
   a cobertura dos critérios e os IDs das capturas. As imagens necessárias
   são recuperadas temporariamente do PDF, sem nova consulta aos portais.
4. Após regenerar o PDF e seu prompt, os auxiliares são apagados. A resposta
   no caminho gerenciado indicado pelo prompt também é removida no sucesso.
   Uma resposta externa selecionada pelo usuário é tratada como entrada.

Para importar manualmente, clique em **Importar revisão**. É possível usar o
original e o prompt da última geração ou selecionar esses arquivos. Acrescente
a resposta JSON preenchida. Prompts anteriores
ao formato autossuficiente precisam ser gerados novamente. Mantenha o PDF
associado sem alterações até concluir a importação.

Não há chamada de API neste fluxo nem solicitação de chave. A revisão só
ocorre quando você entrega o prompt ao Codex. Arquivos binários baixados que
não foram incorporados ao PDF são excluídos; o prompt informa esse limite
e conserva os textos extraídos e as pendências correspondentes.

## Conteúdo e conferência do relatório

- Usa somente critérios com “Não atende” na Revisão do PDF original.
- Confere categorias e enunciados na Cartilha PNTP 2026.
- Mantém o histórico, as imagens, os links e a ordem das etapas.
- Inclui capa, sumário clicável, comentários e situação atual do portal.
- Registra URL e data reais das capturas e distingue falha de acesso,
  indisponibilidade, ausência de registros e inexistência declarada.
- Confere páginas, destinos do sumário e presença dos comentários antes
  de publicar. Os contatos visuais usados na conferência são temporários.

Sem revisão concluída ou com limitações, o PDF permanece como rascunho.
O programa não altera a avaliação oficial. Na busca por órgão, reutiliza o
login e o download do coletor `../coletor_atricon.py`; as credenciais ficam
em memória e não entram no prompt ou no PDF.

Requer Python 3.11+, navegador, Windows com Arial e as dependências de
`requirements.txt`. PDFs somente digitalizados exigem OCR e conferência
antes deste fluxo. Arquivos de apoio incluem `../gerar_pdfs_barco.py`,
`../pdf_atricon.py`, `../doc/Cartilha-PNTP-2026.pdf` e os logos em `../assets/`.

## Terminal e testes

```powershell
python relatorio.py --verificar-ambiente
python web_local.py --porta 8765
python relatorio.py --arquivo "C:\entrada\orgao.pdf"
python relatorio.py --arquivo "C:\entrada\orgao.pdf" --modo importar --prompt "C:\saida\orgao_rascunho_PROMPT_CODEX.md" --resposta "C:\saida\resposta.json"
python -m unittest discover -s . -p "test_*.py" -v
```

`--destino` altera a pasta de saída. `--execucoes` altera a raiz dos
temporários; cada execução usa uma subpasta exclusiva e a exclui ao encerrar.
`--sem-capturas` gera um rascunho sem consultar os portais e registra essa
limitação. O cancelamento aguarda o término da operação em andamento.
