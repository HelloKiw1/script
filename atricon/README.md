# Atricon: coleta e análise consolidada

Para consultar todos com os detalhes necessários à análise, abra o coletor e
escolha **Coletar e analisar todas as cidades**. Pelo visualizador, use
**Coletor → Coletar e analisar todos**. A coleta simples continua disponível.

No terminal:

```powershell
python atricon/coletor_atricon.py --todos --analise-completa
```

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
