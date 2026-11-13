# Relatórios Barco Digital

Programa para transformar **um PDF original do Avalia** em um relatório no
padrão de Pugmil, Aparecida do Rio Negro e Araguaína. A entrada padrão é
`resultado/coleta_2026/pdfs/analise_2026/`; a saída é a subpasta `barco/`.
Os PDFs feitos anteriormente continuam preservados.

## Abrir

1. Abra `iniciar.bat`, ou execute `python relatorio.py` nesta pasta.
2. Na primeira utilização, clique em **Instalar dependências**. Também é
   possível executar `instalar.bat`. São instaladas bibliotecas em
   `.dependencias/` e o Chromium do Playwright. Reabra o programa ao terminar.
3. Escolha **Selecionar PDF original**, ou **Buscar pelo órgão no Avalia**.
   No segundo caso, selecione o órgão do cadastro local já usado pelo coletor.
4. Clique em **Gerar relatório**. A seleção desaparece, dando lugar à etapa
   atual, à barra de progresso e ao registro do processamento.

Requer Python 3.11 ou superior, Tkinter e Windows com Arial instalada.
O PDF deve ter texto pesquisável no formato do Avalia. Fontes digitalizadas
somente como imagem exigem OCR e conferência antes deste fluxo; o programa
interrompe se não consegue extrair os critérios com cobertura consistente.
O programa usa caminhos relativos ao projeto e funciona em outro computador
quando a estrutura `script/atricon/` e os arquivos de apoio forem copiados.
Não precisa instalar Node para executar o programa.

## Dois modos de revisão

**Preparar PDF e pacote**, selecionado por padrão, não chama API paga. O
programa extrai os critérios, preserva o histórico e as imagens do PDF,
consulta os portais, abre documentos identificáveis e gera um **rascunho**.
O botão **Abrir pacote** leva à pasta com `PROMPT_REVISAO.md`, `contexto.json`,
`original.pdf`, `historico/`, `capturas/` e `modelo_resposta.json`. Entregue
essa pasta à IA que fará a revisão. O prompt manda analisar depois da
acumulação e contém as orientações desta conversa. Peça que salve
`resposta_ia.json`; use **Importar revisão** para regenerar sem repetir os
prints. Também é possível revisar os textos pessoalmente no JSON.

**Revisão automática por IA** usa a OpenAI Responses API, com imagens e saída
estruturada. Informe o nome de um modelo da sua conta que aceite visão e JSON
Schema. Configure `OPENAI_API_KEY` no ambiente do computador; opcionalmente
`OPENAI_MODEL`. A assinatura do ChatGPT não configura essa chave no programa.
Esse modo envia os textos e imagens das evidências públicas à API e tem o
custo da sua conta. O programa não fixa modelo nem preço, não cria chaves e
não registra a chave nos arquivos. Documentação da integração:
[Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).

A IA só começa após percorrer todos os critérios do órgão. Cada critério
recebe seu histórico, imagens, regra da cartilha e capturas atuais. Os
resultados são armazenados por hash de texto, imagens, prompt e modelo.
Retomar uma análise idêntica reutiliza a resposta, sem outra chamada. Um
anexo textual muito grande é amostrado na chamada, fica integral no pacote e
gera uma pendência explícita. Não se alega que a IA leu o que não recebeu.

## O que é automático

- Leitura da **Revisão**, com conferência da quantidade de itens da fonte.
- Classificação pela Cartilha PNTP 2026 e validação do enunciado.
- Histórico vetorial, datas, horários, comentários, imagens e links na ordem
  original, inclusive continuações de outra página.
- Capa, cores, duas colunas de categorias/funções, sumário clicável,
  comentários azuis e situação atual azul após o comentário.
- Captura real do portal após aguardar rede, imagens e componentes de carga;
  texto observado e eventuais erros são guardados com URL e horário real.
- Abertura de até três controles identificados como Visualizar, Detalhes,
  Abrir ou Baixar por página, priorizando declarações e termos do critério.
- Abertura das próprias linhas consultáveis das tabelas PrimeVue quando não
  existe botão separado, com capturas das abas de documentos e anexos.
- Captura de modais, novas abas, PDFs de respostas e downloads. PDFs abertos
  são renderizados, identificados como documento e têm seu texto integral
  salvo. Por padrão, documentos extensos têm imagens das primeiras páginas
  e da última, com pendência de conferência das demais.
- Anexos em outros formatos, como XLSX e DOCX, ficam preservados no pacote
  com indicação de que o conteúdo precisa ser analisado na revisão manual.
- Teste de até quatro anos mais recentes disponíveis quando o critério
  falhou em filtros, atualidade ou série histórica e o seletor de ano e o
  comando Filtrar/Pesquisar/Consultar são reconhecidos.
- Deduplicação de consultas à mesma URL durante a rodada, preservando a
  hora original. Reutilização entre rodadas exige marcar essa opção.
  Quando a coleta é refeita, as imagens anteriores ficam arquivadas em
  `rodadas_anteriores/`, separadas do manifesto atual.
- Revisão estruturada ou importação com hash e cobertura de critérios.
- Conferência de páginas, destinos do sumário e comentários, com imagens
  de contato de todas as páginas em `conferencia_visual/`.

Os controles dos portais não são todos iguais. CAPTCHA, autenticação
adicional, botões sem nome acessível, caminhos antigos ou documentos não
abertos não são disfarçados como sucesso. O programa registra a limitação.
Não modifica dados do portal, não envia recursos e não altera a nota oficial.

## Ajustar uma página que o capturador não reconheceu

Na pasta do pacote existe `plano_capturas.json`. Acrescente os endereços
públicos corretos e ações opcionais de **consulta**, por exemplo:

```json
{
  "6.7": {
    "criterio": "6.7 Enunciado original...",
    "urls": ["https://portal.exemplo.gov.br/transparencia/concursos"],
    "acoes": [
      {"tipo": "selecionar_ano", "nome": "Ano", "valor": "2025"},
      {"tipo": "clicar", "papel": "button", "nome": "Filtrar", "titulo": "Consulta do ano de 2025"}
    ]
  }
}
```

Para seletor PrimeVue, use ações `clicar` com papéis `combobox`, `option` e
o botão `Filtrar`, sempre pelo nome acessível observado no portal. O programa
não aceita seletores de código ou comandos de escrita nesse plano. Rode de
novo **sem** reaproveitar capturas. O plano existente é mantido entre rodadas.

## Rascunho e versão concluída

Sem comentários revisados ou com limitações relevantes, o arquivo é salvo
como `<nome>_rascunho.pdf`, com indicação de revisão pendente na capa. O nome
original na pasta `barco/` só é usado quando a revisão e as verificações
terminam sem pendências. Versões anteriores da saída são copiadas para
`versoes_anteriores/` antes de substituir; o PDF original não é modificado.

Uma revisão por IA não equivale a aprovação humana ou deferimento do recurso.
Os contatos visuais e `pendencias.json` permitem conferir o resultado. A
detecção de recortes históricos incompletos exige corrigir a extração antes
de tratar o documento como concluído.

Uma revisão manual pode registrar `pendencias_resolvidas` no JSON, com o texto
exato de cada pendência como chave e uma justificativa concreta de sua
resolução como valor. Essa decisão fica registrada separadamente; limitações
de recorte do histórico não podem ser liberadas sem corrigir a extração.

## Integração com o coletor existente

O modo por órgão reutiliza `../coletor_atricon.py`: carrega o cadastro,
autentica, localiza a avaliação PNTP 2026 e baixa o relatório pelo endpoint
do questionário. Confere órgão e ID antes de salvar em `analise_2026/`.
Credenciais ficam em memória, não entram no contexto, no prompt ou na API.
Se o Avalia exigir uma intervenção no login, use o coletor para obter o PDF
e selecione o arquivo local nesta janela.

O desenho do PDF é o de `../gerar_pdfs_barco.py`. Foram adicionadas opções
para destinos e dados separados por execução, mantendo o uso anterior.
Dependências compartilhadas: `../pdf_atricon.py`,
`../doc/Cartilha-PNTP-2026.pdf`, `../assets/logo-da-empresa*.png` e Arial.

## Terminal e testes

```powershell
python relatorio.py --verificar-ambiente
python relatorio.py --arquivo "C:\caminho\analise_2026\orgao.pdf"
python relatorio.py --arquivo "C:\caminho\analise_2026\orgao.pdf" --modo ia --modelo SEU_MODELO --reutilizar
python relatorio.py --arquivo "C:\caminho\analise_2026\orgao.pdf" --modo importar --resposta "C:\pacote\resposta_ia.json"
python -m unittest discover -s . -p "test_relatorio.py" -v
```

Para um teste isolado, `--destino` e `--execucoes` permitem direcionar a saída
para uma pasta temporária. `--sem-capturas` gera somente um rascunho local;
não comprova a situação atual do portal.

O cancelamento acontece entre operações. Uma consulta de rede ou chamada à
IA em andamento pode levar até seu timeout antes de parar. Não feche o
processo à força para evitar interromper a gravação; os JSONs são atômicos.
