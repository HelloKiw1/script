# Prompt para reproduzir os relatórios Barco Digital

Copie este arquivo e os materiais indicados abaixo para o outro computador. Abra esta pasta em uma GPT/agente com acesso aos arquivos locais, navegação na internet, captura de telas e geração de PDF. Entregue o conteúdo deste documento como instrução de trabalho. Este arquivo contém o prompt; ele não incorpora os PDFs nem as imagens.

---

## Sua tarefa

Produza um PDF Barco Digital para cada PDF original de análise PNTP 2026 existente diretamente na pasta de entrada, usando duas fontes complementares:

1. O próprio PDF original da Atricon/Avalia, para resultados, critérios e histórico da avaliação.
2. O site público do respectivo órgão e seus documentos, para registrar a situação atual e verificar os apontamentos.

O resultado deve reproduzir o padrão visual e editorial da **última versão de Pugmil**(analise_2026\barco\prefeitura_municipal_pugmil_37614.pdf), já ajustada pelo usuário. Faça o trabalho completo: extração, análise individual dos critérios, visita aos sites, capturas reais, comentários, geração e conferência dos PDFs. Não entregue apenas instruções ou um gerador sem os relatórios.

O objetivo editorial é organizar os itens reprovados na última etapa e reunir elementos para fundamentar um **possível recurso**. Não há previsão de nova conferência oficial do site. Não apresente o relatório como recurso já protocolado, resultado reformado ou decisão de acolhimento.

## 1. Caminhos, modelo e materiais necessários

No computador original, a raiz do projeto de geração é:

```text
C:\Users\eduar\Documents\github\barco\script
```

A pasta de entrada é:

```text
C:\Users\eduar\Documents\github\barco\script\resultado\coleta_2026\pdfs\analise_2026
```

A pasta de saída é:

```text
C:\Users\eduar\Documents\github\barco\script\resultado\coleta_2026\pdfs\analise_2026\barco
```

**Modelo final obrigatório de aparência e composição:**

```text
resultado/coleta_2026/pdfs/analise_2026/barco/prefeitura_municipal_pugmil_37614.pdf
```

**Fonte original de Pugmil, para comparar a transformação:**

```text
resultado/coleta_2026/pdfs/analise_2026/prefeitura_municipal_pugmil_37614.pdf
```

Todos os caminhos relativos deste prompt partem da raiz `script`. Se o usuário, a unidade ou a estrutura de pastas forem diferentes no outro computador, localize a raiz copiada e adapte os caminhos. Não dependa da existência do usuário Windows `eduar`.

Antes de começar, confira a presença dos seguintes materiais:

| Material | Caminho relativo | Uso |
| --- | --- | --- |
| PDFs originais | `resultado/coleta_2026/pdfs/analise_2026/*.pdf` | Fontes de cada órgão; leitura não recursiva |
| PDF final de Pugmil | `resultado/coleta_2026/pdfs/analise_2026/barco/prefeitura_municipal_pugmil_37614.pdf` | Referência visual final |
| Gerador atual | `atricon/gerar_pdfs_barco.py` | Layout, cores, extração e montagem |
| Parser | `atricon/pdf_atricon.py` | Interpretação dos resultados originais |
| Cartilha | `atricon/doc/Cartilha-PNTP-2026.pdf` | Categorias e orientações dos critérios |
| Logotipo de capa | `atricon/assets/logo-da-empresa-capa.png` | Marca oficial |
| Símbolo | `atricon/assets/logo-da-empresa.png` | Cabeçalhos |
| Comentários de referência | `atricon/resumos_barco/prefeitura_municipal_pugmil_37614.json` | Tom e fundamentação final de Pugmil |
| Manifesto de capturas de referência | `atricon/evidencias_atuais/prefeitura_municipal_pugmil_37614.json` | Associação entre critério, tela, data e URL |
| Imagens de referência | `atricon/evidencias_atuais/pugmil/` | Capturas reais utilizadas no modelo |
| Conferência de referência, se disponível | `tmp/pdfs/barco/conferir_pugmil.py` | Exemplo de validação técnica e visual |

É preferível copiar a pasta `script` com esses materiais, sem credenciais, tokens ou arquivos privados desnecessários. A execução usa os PDFs locais e páginas públicas; não exige credenciais do Avalia para reconstruir o histórico já contido nos PDFs.

Leia o gerador e examine visualmente o PDF final antes de produzir os demais. Os outros PDFs que já estiverem em `barco` podem ser versões antigas: não os trate como modelo atualizado.

Preserve o PDF final de Pugmil como referência, sem regenerá-lo automaticamente no lote. Produza os demais relatórios. Não altere nem sobrescreva os PDFs originais da pasta de entrada. Mantenha o mesmo nome de arquivo na saída, dentro de `barco`.

## 2. Seleção correta dos critérios

- Inclua apenas critérios que tenham pelo menos um subitem marcado explicitamente como **Não atende na coluna Revisão**, a última etapa da avaliação.
- Não use o resultado da Avaliação ou da Validação como substituto do resultado da Revisão.
- Um critério entra uma única vez, mesmo que tenha vários subitens reprovados.
- Preserve o número, a dimensão, o enunciado completo e a categoria de cada critério selecionado. A retirada do título foi solicitada **somente nas linhas do sumário**, não no corpo dos critérios.
- Identifique internamente quais subitens foram reprovados para orientar a análise, mas **não mostre a tabela de subitens não atendidos** no relatório final.
- Confira a categoria na cartilha PNTP 2026 e na lógica do projeto; não a deduza pelo assunto ou pelo resultado.
- Preserve a ordem dos critérios do documento original.
- Se não houver Revisão no PDF, sinalize isso claramente. Não invente reprovações. O gerador possui tratamento específico para essa situação; mantenha um relatório de aviso compatível e registre a exceção no controle do lote.
- Se a Revisão existir e não houver reprovações, informe que não há subitens marcados como Não atende nessa etapa, sem inventar conteúdo.
- Investigue divergências de extração, enunciados ou categorias antes de concluir. Não descarte critérios silenciosamente.

## 3. Primeira página

Reproduza a capa de Pugmil com marca oficial Barco Digital, identificação do órgão, questionário, índice e classificação quando constarem da fonte.

Pode apresentar a quantidade de **critérios com falhas** e de **critérios essenciais**. Não apresente a contagem de subitens, nem a expressão `subitens reprovados`.

Mantenha o texto de escopo solicitado:

> Inclui somente subitens marcados como “Não atende” na coluna Revisão(Ultima Etapa da Avaliação). Os enunciados, comentários, links e imagens da revisão foram extraídos do PDF original, encontrado no site da Atricon.

Como no modelo final, pode completar com:

> Inclui também capturas atuais do portal, com data e link de consulta.

Na mesma altura, em **duas colunas com os títulos alinhados**, apresente:

### Coluna esquerda: Como funcionam as categorias

- **Essenciais:** precisam de 100% de atendimento. Se qualquer essencial falhar, o órgão não recebe selo, mesmo com nota geral alta.
- **Obrigatórios:** exigências de divulgação previstas em leis e normas; falhas reduzem a nota e influenciam a classificação.
- **Recomendados:** boas práticas de transparência, também consideradas na pontuação.

Preserve a ressalva do modelo de que o selo também depende da nota geral e das etapas de validação e controle de qualidade. Use a cartilha e fontes oficiais para a explicação, sem inventar regras adicionais.

### Coluna direita: Quem faz cada etapa

- **Avaliador:** responsável do órgão pela avaliação do site. Faz a avaliação inicial, apresenta links e imagens e responde aos apontamentos.
- **Validador:** em Pugmil e nos órgãos tocantinenses correspondentes, equipe do **TCE do Tocantins (TCE-TO)**. Confere as informações e evidências e valida ou contesta o atendimento.
- **Revisor:** equipe de Tribunal de Contas designada pela Atricon para a revisão nacional, que pode ser de **outro estado**. Reconfere evidências e resultado da validação.

Para órgãos de outros estados, identifique o Tribunal competente na fonte. Não copie TCE-TO para um município de outro estado. Não invente a identidade do Tribunal revisor quando ela não estiver informada.

Não inclua `Abrir PDF Original`. O modelo admite o link público do relatório no Avalia, com aviso de que pode exigir acesso. Não insira caminhos `file:///` do computador como links para o destinatário.

## 4. Sumário na segunda página

- Comece o sumário na página 2.
- Cada linha deve conter **apenas o número do critério, a categoria e a página de destino**.
- Exemplo: `8.6    Obrigatório    6`.
- Não mostre o enunciado/título do critério nessa linha.
- Não use o caractere `|` como separador da categoria.
- Use as etiquetas **Essencial**, **Obrigatório** e **Recomendado**, com as cores correspondentes.
- A linha inteira deve ser clicável e levar ao início do critério no próprio PDF.
- Calcule os destinos após a paginação final. Não use os números de página do PDF original.
- Se forem necessárias páginas extras de sumário, continue a partir da segunda; preserve a legibilidade.
- Preserve também os marcadores de navegação do PDF quando possível.

## 5. Corpo de cada critério: ordem obrigatória

Cada critério começa em uma página nova e segue esta sequência:

1. Dimensão, categoria e número com enunciado completo, usando a cor da categoria.
2. **Evidências do Critério:** histórico extraído do PDF original, na ordem em que aparece.
3. Caixa azul **Por que não foi atendido? - Critério X.Y**, com a identificação **Comentário do Barco Digital**.
4. Na sequência, começando em nova página como no modelo, **Situação atual do portal - Critério X.Y**, com capturas reais e apresentação azul.

Não coloque a situação atual antes do comentário do Barco. Preserve o comentário logo após o último bloco histórico, preferencialmente na mesma página se couber com boa legibilidade.

### Histórico de evidências

Reproduza a composição do original, incluindo, conforme existirem:

- Link do Avaliador e data/hora.
- Foto do Avaliador e data/hora.
- Comentários do Validador e do Avaliador.
- Links, fotos e comentários do Revisor.
- Réplicas, documentos e demais registros posteriores.

Mantenha textos, imagens, links, datas, horários e responsável por cada etapa. Preserve nomes pessoais quando efetivamente constarem da fonte. Não invente autoria.

Não reorganize o histórico apenas para formar uma narrativa favorável. Não elimine um comentário desfavorável. Não transforme tudo em uma lista genérica `Links presentes no critério original`: essa seção foi removida e substituída pela composição original.

O critério 6.7 de Pugmil é uma referência de ordem: link e foto do Avaliador em 19/05, comentário do Validador em 27/07 e comentário posterior do Avaliador em 03/08. Use **as datas e a ordem próprias de cada documento**, sem copiar as datas de Pugmil para outros órgãos.

Prefira importar os blocos originais como recortes vetoriais do PDF, restaurando as anotações de links. Se precisar rasterizar, mantenha nitidez e legibilidade. Não corte continuação de texto ou imagem entre páginas. A coloração dos responsáveis pode mudar; o conteúdo histórico deve permanecer fiel.

## 6. Identidade visual e cores

Reutilize os ativos e o layout do gerador atual. Não recrie o logotipo com IA.

| Aplicação | Cor principal | Fundo claro | Borda, quando aplicável |
| --- | --- | --- | --- |
| Azul Barco Digital | `#0b62c4` | Conforme o modelo | Conforme o modelo |
| Títulos em azul escuro | `#082f63` | - | - |
| Essenciais | `#b42318` | `#fef3f2` | `#fecdca` |
| Obrigatórios | `#93370d` | `#fffaeb` | `#fedf89` |
| Recomendados | `#067647` | `#ecfdf3` | `#abefc6` |
| Avaliador | `#6d28d9` | `#f3edff` | Cor principal do responsável |
| Validador | `#087f5b` | `#eaf8f1` | Cor principal do responsável |
| Revisor | `#be185d` | `#fff0f6` | Cor principal do responsável |

Os nomes dos responsáveis devem usar a cor principal correspondente. Seus blocos históricos usam fundo claro da mesma família de cor. Aplique a mesma identificação na explicação dos cargos da capa.

As caixas **Por que não foi atendido?** e **Situação atual do portal** usam o azul Barco, com texto branco legível, como em Pugmil. Toda a apresentação da situação atual, incluindo cabeçalho e cartões de capturas, segue esse azul. As telas capturadas conservam as cores reais do site; não aplique filtro azul sobre as imagens.

Use A4, margens e espaçamentos do modelo, fonte Arial ou substituta visualmente equivalente e acentos corretos. Cabeçalho com símbolo e rodapé com página, questionário e fontes. Não imponha o mesmo número total de páginas de Pugmil: o conteúdo de cada órgão determinará a extensão.

## 7. Comentários do Barco Digital e fundamento do possível recurso

Faça uma análise minuciosa **de cada critério selecionado**. Leia todo o histórico, examine as imagens e abra os links e documentos. Não escreva comentários apenas a partir da última frase do Revisor.

O comentário deve ser curto, claro, pessoal e específico, em português brasileiro, em um parágrafo compacto sempre que possível. Explique:

1. Qual foi o motivo registrado para a reprovação e qual cargo o apontou.
2. Quais evidências históricas respondem a esse motivo.
3. Qual é a posição do Barco Digital para a eventual contestação.
4. O que as capturas atuais comprovam e quais limites temporais existem.

Identifique explicitamente **Comentário do Barco Digital** para que a posição editorial não seja confundida com fala da Atricon, do Tribunal ou com texto extraído da fonte.

### Tom e tempos verbais

- O relatório serve para defender uma possível contestação do resultado já emitido.
- Use formulações como `Defendemos que a declaração deveria ter sido aceita`, `Esse registro fundamenta a contestação` e `A captura de DD/MM/AAAA registrou...`.
- Não use `deve ser considerado em uma nova conferência`, `será analisado na próxima avaliação`, `aguardar nova conferência` ou outra promessa de nova etapa.
- Quando houver evidência de caminho incorreto, pode usar `Acreditamos que o acesso ocorreu por um caminho incorreto`, explicando a imagem ou URL que sustenta essa interpretação.
- Não afirme genericamente `o Revisor errou`. Distinga fato documentado e interpretação do Barco.
- Não atribua ao Barco falha ou culpa que a fonte não demonstra. Se houver correções ou recursos efetivamente implementados, destaque o que foi disponibilizado ou corrigido, com data e evidência quando houver.
- Não transforme uma correção atual em prova de que o recurso existia na avaliação original.
- Se algo continuar ausente, informe isso com precisão. Defender o órgão não autoriza inventar filtros, anexos, documentos ou funcionamento.

### Declarações de inexistência

Use linguagem simples, identificando o cargo responsável: `A declaração foi apresentada pelo Avaliador, mas o Validador não a aceitou` ou `O Revisor não considerou a declaração publicada`, conforme o histórico real.

Quando houver suporte, defenda que a declaração deveria ter sido aceita como manifestação do órgão sobre a situação informada. Registre se ela já havia sido apresentada antes da última resposta do Avaliador. Se for PDF documental, descreva isso; se for declaração automática, descreva essa natureza sem transformá-la em outro documento.

Não presuma que toda declaração satisfaz automaticamente qualquer critério. A defesa é uma posição fundamentada do Barco, e não uma decisão de aceitação. Preserve o motivo da recusa e as exigências pertinentes da cartilha.

### Cronologia: exemplo obrigatório para compreender o padrão

No critério 8.6 de Pugmil:

- O Avaliador apresentou declaração automática em **19/05/2026**, antes da sua última resposta de **03/08/2026**.
- O Validador a recusou em **28/07/2026**, por ser automática.
- A defesa editorial é que a declaração então apresentada deveria ter sido aceita como registro da situação informada pelo órgão.
- O PDF exibido na situação atual é **outro documento, posterior, datado de 17/09/2026**.

É proibido afirmar que esse PDF de setembro já havia sido anexado antes de agosto. Preserve essa distinção entre a declaração histórica e o documento posterior. Para outros órgãos e critérios, reconstrua as respectivas datas; não transporte essa cronologia.

Outros exemplos de atenção no modelo de Pugmil:

- **11.6:** a imagem histórica mostrou o endereço de Pugmil anexado ao domínio do Avalia, sustentando a hipótese de acesso por caminho incorreto; o link público atual abriu o RREO.
- **16.2:** houve declaração e justificativa no histórico, com apontamento de caminho inválido; a captura atual documentou a abertura pública. Não conclua o mesmo em outro órgão sem evidência.
- **17.2:** a declaração estava na página conjunta, houve registro de validação e depois consulta a seção distinta. Relacione essas etapas, sem confundir páginas.
- **17.1:** o painel de Plano de Trabalho existia, mas o exemplo aberto não tinha anexo. Não apresente a existência do botão como prova de que o plano estava publicado.
- **6.7:** a lista de atos comprova divulgação; não comprova, por si, o filtro específico questionado.

Esses exemplos explicam o método de análise. Não são textos universais para copiar em outros relatórios.

## 8. Situação atual do portal: navegação e capturas reais

Para **cada critério incluído**, acesse a página correspondente do órgão, partindo dos links do PDF original e verificando a navegação atual quando necessário.

1. Espere a página e seus componentes carregarem: tabelas, integrações, documentos, filtros e painéis.
2. Registre uma captura legível da página relevante, com contexto suficiente para identificar o recurso.
3. Teste os filtros efetivamente relacionados ao apontamento. Quando possível, registre o filtro preenchido e o resultado obtido. Não confunda existência de campo com funcionamento comprovado.
4. Clique em **Visualizar**, detalhes ou documento, sempre que necessário para examinar a evidência. Capture também o conteúdo aberto, e não apenas o botão.
5. Nos PDFs longos, abra as páginas relevantes: valores, medições, datas, cronogramas, declarações ou orientações. Não use uma capa como prova de conteúdo interno que não foi examinado.
6. Registre URL pública, data e hora reais de cada captura. Use o horário local identificado; no Brasil, prefira `America/Sao_Paulo` quando aplicável. Não copie a data de captura de Pugmil.
7. Armazene as imagens originais e associe-as ao critério em um manifesto. Um mesmo documento pode apoiar vários critérios, desde que o trecho pertinente seja identificado em cada um.
8. Recorte somente margens e áreas irrelevantes, preservando o que comprova o argumento. Não modifique o conteúdo da página para melhorar a evidência.

As capturas devem ser reais, obtidas nesta execução. Não use imagens geradas por IA, telas reconstruídas nem imagens históricas do PDF como se fossem atuais.

Cada cartão deve apresentar título breve, data/hora, link clicável e legenda factual específica, como no modelo. Mantenha todas essas informações na apresentação azul.

**Não coloque nenhum parágrafo genérico no início da seção.** Após `Situação atual do portal - Critério X.Y`, comece diretamente os cartões de evidência. Em especial, não inclua:

> Conferência do Barco Digital após o carregamento dos componentes. Cada imagem identifica a data da captura e o endereço consultado.

Se uma página estiver indisponível, apresentar erro, exigir sessão ou não contiver o recurso, registre o ocorrido com URL e data. Faça tentativas razoáveis pelo caminho público correto, sem contornar autenticação. Não declare atendimento completo quando a verificação não for possível. Identifique limitações e pendências no controle do lote.

Capturas atuais comprovam o que estava acessível **na data da consulta**. Elas não provam sozinhas que o mesmo conteúdo estava publicado na data da avaliação ou do último retorno. Compare datas de publicação, datas internas dos documentos e datas das manifestações históricas.

## 9. Implementação e portabilidade

Prefira adaptar e reutilizar `atricon/gerar_pdfs_barco.py`, preservando o padrão final. O gerador monta o documento, mas **não navega nos sites nem escreve sozinho a análise criteriosa**: prepare antes os comentários e as evidências de cada órgão.

Ele usa Python com `pymupdf`, `pypdf`, `reportlab` e `Pillow`. Para conferências, `pdfplumber` e Poppler também podem ser úteis. Instale apenas o necessário no ambiente disponível. Não reutilize um caminho absoluto do interpretador Python do computador original.

No gerador atual, fontes Arial são procuradas em `C:/Windows/Fonts`, inclusive em trechos de montagem e recoloração do PDF. Adapte todas as referências de fonte se o outro computador usar outra plataforma. A pasta opcional `tmp/pdf-barco-runtime` contém dependências locais, mas não é um ambiente portátil garantido.

### Comentários por documento

Crie `atricon/resumos_barco/<nome-sem-extensao>.json` com o SHA-256 real do PDF original e uma explicação revisada para cada critério incluído:

```json
{
  "sha256_origem": "SUBSTITUIR_PELO_SHA256_REAL_DO_PDF",
  "explicacoes": {
    "8.6": "SUBSTITUIR_PELA_ANALISE_INDIVIDUAL_COM_DATAS_E_EVIDENCIAS_REAIS"
  }
}
```

Não copie o hash nem os comentários de Pugmil para outro PDF. Não deixe marcadores de exemplo nos arquivos de produção. Se o original mudar, confira novamente a análise antes de atualizar o hash.

### Manifesto das capturas por documento

Crie `atricon/evidencias_atuais/<nome-sem-extensao>.json`, salvando as imagens em uma subpasta identificável do mesmo diretório:

```json
{
  "itens": {
    "8.6": [
      {
        "arquivo": "orgao/8.6-pagina.png",
        "titulo": "Página atual: declaração publicada",
        "url": "https://ENDERECO_PUBLICO_REAL",
        "observacao": "LEGENDA_FACTUAL_DO_QUE_A_IMAGEM_DEMONSTRA",
        "capturado_em": "DD/MM/AAAA HH:MM"
      }
    ]
  }
}
```

O campo opcional `recorte` segue `[x0, y0, x1, y1]`, em pixels da imagem original. Use apenas coordenadas válidas. Substitua todos os exemplos por dados reais e cubra todos os critérios incluídos.

**Atenção:** o gerador atual aceita a ausência total do manifesto e pode gerar sem situação atual. Isso não satisfaz este pedido. Exija a cobertura de capturas por critério, ou um registro explícito da impossibilidade de consulta com a evidência do ocorrido. Não entregue omissões silenciosas como relatório completo.

### Execução por arquivo

Na raiz `script`, usando o interpretador disponível no computador:

```powershell
python atricon/gerar_pdfs_barco.py --analisar --arquivo "NOME_REAL_DO_PDF.pdf"
python atricon/gerar_pdfs_barco.py --arquivo "NOME_REAL_DO_PDF.pdf"
```

O primeiro comando analisa a fonte; o segundo gera o relatório após a preparação dos materiais. Não use o nome fictício acima literalmente. Prefira processar um órgão por vez, com os JSONs e capturas completos, e registrar o progresso.

Não execute o gerador sem `--arquivo` indiscriminadamente: ele tentará gerar também Pugmil e documentos ainda sem comentários prontos. Se automatizar o lote, exclua o modelo de Pugmil da regeneração e só gere os documentos preparados.

Faça uma primeira amostra de outro órgão e confronte-a visualmente com Pugmil. Corrija diferenças e prossiga no lote sem exigir uma nova aprovação para cada órgão. A execução técnica só é considerada concluída depois da análise e da conferência dos artefatos.

## 10. Conferência obrigatória antes da entrega

Valide o conteúdo e **renderize todas as páginas**. Inspecione as imagens renderizadas, usando folhas de contato e ampliações nas páginas densas. Corrija problemas e confira novamente as páginas afetadas.

Checklist:

- [ ] O PDF é do órgão correto, com questionário e dados da fonte corretos.
- [ ] O conjunto de critérios corresponde exatamente aos reprovados na Revisão.
- [ ] Categorias corretas, com etiquetas e cores consistentes.
- [ ] Capa com logo oficial e categorias/cargos em duas colunas alinhadas.
- [ ] Sumário começa na página 2; linhas contêm apenas número, categoria e página, sem `|`.
- [ ] Todos os links internos do sumário apontam para o início correto do critério.
- [ ] Enunciados completos aparecem no corpo.
- [ ] Histórico completo, com ordem, imagens, datas, horários, textos e autoria preservados.
- [ ] Cores dos cargos e fundos claros foram aplicados sem encobrir conteúdo.
- [ ] Links públicos são clicáveis; não há links locais `file:///` nem placeholders.
- [ ] Cada critério tem comentário individual, identificado como do Barco Digital.
- [ ] Comentários fundamentam possível recurso, sem prometer nova conferência.
- [ ] Declarações anteriores e documentos posteriores estão temporalmente distinguidos.
- [ ] A situação atual vem depois do comentário, toda apresentada em azul.
- [ ] Não há introdução genérica antes das capturas atuais.
- [ ] Cada critério tem capturas reais pertinentes, com datas, URLs e legendas corretas, ou limitação documentada.
- [ ] Recursos testados e documentos abertos correspondem ao que o comentário afirma.
- [ ] Não há tabelas `Subitem não atendido`, contagem `subitens reprovados`, seção `Links presentes no critério original` ou botão `Abrir PDF Original`.
- [ ] A palavra `script` não aparece na redação autoral do relatório ao leitor. Ela pode existir nos caminhos técnicos deste prompt; não altere transcrições históricas para apagá-la se fizer parte da fonte.
- [ ] Nenhum texto, tabela ou imagem está cortado, sobreposto, pequeno demais ou fora das margens.
- [ ] Não há páginas vazias acidentais, acentos corrompidos, títulos isolados ou imagens distorcidas.
- [ ] Os PDFs originais e o modelo final de Pugmil foram preservados.

O conferidor de Pugmil é uma referência, mas contém números e nomes próprios daquele documento. Generalize-o para cada órgão; não exija 14 critérios, 62 páginas ou a quantidade de evidências de Pugmil nos demais relatórios.

## 11. Entrega e continuidade

Salve um PDF final por original em `analise_2026/barco`, com o mesmo nome do arquivo de entrada. Preserve os manifestos, comentários e capturas usados, para permitir auditoria e reprodução.

Mantenha também um controle do lote em arquivo auxiliar, com órgão, arquivo de origem, hash, quantidade de critérios incluídos, arquivo de saída, datas de consulta, conferências executadas e pendências reais. Esse controle não substitui os PDFs nem deve poluir as páginas do relatório.

Caso falte alguma capacidade essencial no ambiente, como leitura de arquivos locais ou captura de sites, explique precisamente a limitação e conclua o trabalho independente que for possível. Não afirme que acessou páginas ou gerou capturas sem ter feito isso. Não entregue relatórios incompletos como se estivessem integralmente verificados.

Ao terminar, informe os arquivos gerados e eventuais exceções de forma breve. Não protocole recurso, não envie mensagens e não modifique sites: a tarefa autorizada é consultar as fontes e produzir os relatórios para análise do usuário.
