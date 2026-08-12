# Candidatron

Página para consultar candidaturas oficiais do DivulgaCandContas/TSE, filtrar os resultados e exportar CSV ou JSON.

## Executar

No terminal do VS Code, a partir da raiz do projeto, rode:

```powershell
python candidato/servidor_candidatos.py
```

Depois abra [http://localhost:8877](http://localhost:8877). O servidor usa somente a biblioteca padrão do Python; não é necessário instalar pacotes.

O servidor local é necessário porque a API do TSE não autoriza chamadas diretas de uma página aberta no navegador. Como alternativa, abra `candidato.html` e use **Importar JSON** com arquivos obtidos no portal/API do TSE.

## Consulta padrão

- Ano: `2026`
- Estado: Tocantins (`TO`)
- Cargos: Presidente (`1`), Governador (`3`), Senador (`5`), Deputado Federal (`6`) e Deputado Estadual (`7`)

Ao consultar todos os cargos, Presidente usa automaticamente a unidade `BR`; os demais usam o estado selecionado.
