# EXTRACTRON - Extrator de Decretos PDF

Sistema de extração automática de dados de decretos municipais a partir de arquivos PDF, utilizando análise de texto nativo e OCR como fallback.

## Descrição


## Funcionalidades

- **Painel estilo Baixatron**: Dashboard fixo no topo com status, barra de progresso e estatísticas (total, processados, pendentes, erros)
- **Extração de Texto Nativo**: Utiliza PDF.js para ler PDFs com texto selecionável
- **OCR Integrado**: Tesseract.js processa automaticamente PDFs digitalizados quando necessário
- **Processamento em Lote**: Arraste múltiplos arquivos PDF para processamento paralelo
- **Detecção Automática**: Identifica o tipo de PDF e seleciona o método de extração adequado
- **Exportação JSON**: Gera arquivo estruturado pronto para importação em sistemas
- **Interface Intuitiva**: Drag-and-drop com feedback visual de progresso (banner fixo + painel)

## Tecnologias Utilizadas

- **PDF.js v3.11.174**: Biblioteca para parsing de arquivos PDF
- **Tesseract.js v5.0.4**: Engine de OCR para documentos digitalizados
- **HTML5 File API**: Manipulação de arquivos local sem necessidade de backend

## Estrutura de Dados Extraídos

Cada decreto processado gera um objeto JSON com os seguintes campos:

```json
{
  "numero": "001/2024",
  "data": "01/01/2024",
  "letra": "A",
  "descricao": "Dispõe sobre...",
  "arquivo": "decreto_001_2024.pdf"
}
```

## Uso

1. Abra o arquivo `extractron.html` em um navegador moderno
2. Arraste os arquivos PDF para a área indicada ou clique para selecionar
3. Aguarde o processamento automático
4. Clique em "Baixar JSON" para obter o arquivo de dados

## Fluxo de Trabalho Recomendado

EXTRACTRON funciona em conjunto com **FORMTRON** para automação completa:

```
PDF → EXTRACTRON → JSON → FORMTRON → Sistema
```

1. EXTRACTRON extrai dados dos PDFs
2. Exporta JSON com informações estruturadas
3. FORMTRON lê o JSON e preenche formulários web automaticamente

## Padrões de Extração

O sistema utiliza expressões regulares otimizadas para identificar:

- **Número do Decreto**: Padrões como "Decreto nº 001/2024", "Dec. 001-2024"
- **Data**: Formatos DD/MM/AAAA, DD.MM.AAAA, extenso
- **Letra Identificadora**: Caracteres únicos (A-Z) associados ao decreto
- **Descrição**: Primeira ocorrência de "Dispõe sobre", "Estabelece", "Autoriza"

## Limitações Conhecidas

- OCR requer tempo de processamento adicional (5-15s por página)
- PDFs/etapas que demorarem demais podem ser interrompidos por timeout (3 min por arquivo; OCR/página com limite) e o arquivo vai para `falha.json`
- Qualidade da digitalização afeta precisão do OCR
- PDFs com layout não-padrão podem necessitar ajuste manual
- Processamento local limitado pela memória do navegador

## Compatibilidade

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Estrutura de Arquivos

```
extractron.html    - Interface principal
```

Ferramenta standalone, sem dependências externas (bibliotecas carregadas via CDN).
