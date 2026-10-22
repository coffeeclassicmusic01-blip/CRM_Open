---
name: fontes-dados-br
description: Use ao buscar, validar ou exibir qualquer dado brasileiro no Georevest Studio — CNPJ, CPF, CEP, CNAE, NCM, CFOP, ISS, IBS/CBS, alíquotas e referências de custo. Lista fontes oficiais gratuitas, APIs sem chave, o que é lei e o que é projeção, e as regras para nunca apresentar dado fictício como real. Aciona em "CNPJ", "CEP", "Receita Federal", "nota fiscal", "CFOP", "NCM", "imposto", "ISS", "IBGE", "consultar", "validar", "fonte de dados".
---

# Fontes de dados confiáveis (BR) — Georevest Studio

Duas decisões do usuário governam este arquivo:

1. **Offline-first.** Validação e formatação funcionam **sem rede**.
   Consulta externa é enriquecimento opcional e degrada para
   "indisponível offline".
2. **Dado fiscal sem fonte citada é opinião.** Toda tabela, alíquota e regra
   tributária entra no código com fonte oficial e data de consulta.

---

## 1. Regra de ouro: o que é lei e o que é projeção

Este é o erro mais comum e o mais caro em app brasileiro. Antes de escrever
qualquer número no código, classifique:

| Tipo | Fonte obrigatória | Exemplo |
|---|---|---|
| **Lei federal** | Planalto | LC 214/2025, LC 116/2003, EC 132/2023 |
| **Decreto / regulamento** | Planalto | Decreto 12.955/2026 (CBS) |
| **Ato infralegal** | Receita / Senado / Comitê Gestor | Portaria RFB, Resolução Senado |
| **Tabela oficial** | SEFAZ / CONVENIO / CONFAZ | CFOP, NCM, CST/CSOSN |
| **Dado cadastral** | Receita Federal | CNPJ, CNAE, IE |
| **Referência estatística** | IBGE / Caixa | localidades, SIDRA, SINAPI |
| **Projeção** | **nunca** aplicar como alíquota | "carga ~26,5%" |

**Caso concreto, LC 214/2025 (Reforma Tributária):**

- **É lei:** 2026 é fase de teste com **CBS 0,9%** (art. 346) e **IBS 0,1%**
  (art. 343). Compensável com o sistema atual. **É o único número cravado
  em lei hoje.**
- **Não é lei:** as alíquotas de referência de 2027+ (CBS ~8,8%, IBS
  ~17,7%, total ~26,5%). O art. 349 entrega ao Senado fixá-las por
  resolução, com cálculo do TCU, até 31 de outubro do ano anterior. São
  **projeção recalibrável**.
- **O "26,5%" não é alíquota** — é teto de referência do art. 475, § 11.
  Usar como alíquota é erro.
- Cronograma: 2027 CBS plena, PIS/Coafins extintos, IPI a zero; 2029-2032
  transição crescente do IBS contra queda de ICMS/ISS; 2033 ICMS e ISS
  extintos.
- A LC 214 **já foi alterada** pela LC 227/2026.

→ **Regra para o código:** o app **não** calcula IBS/CBS hoje. Se um dia
precisar, a constante vai para `CRE_FISCAL` com o artigo e a data ao lado,
e o app mostra "referência, não vigente" — nunca "alíquota".

---

## 2. Fontes oficiais gratuitas

### Receita Federal
- **Comprovante de Inscrição e Situação Cadastral** —
  `consultacnpj.redesim.fazenda.gov.br` (site, sem API pública)
- **Dumps abertos de CNPJ** (trimestral, ZIP por faixa) —
  `https://dadosabertos.rfb.gov.br/CNPJ/`. Base completa, gratuita, mas
  pesada (GB). Serve para gerar base local, não para consulta pontual.
- **Legislação da Reforma Tributária** —
  `https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/legislacao`

### Planalto (leis)
- `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm` (LC 214/2025)
- `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm` (LC 116 — lista
  de serviços e towns de ISS)

### NF-e / SEFAZ
- Portal NF-e: `https://www.nfe.fazenda.gov.br`
- Portal único SP: `https://portal.fazenda.sp.gov.br/notafiscal`
- Tabelas CFOP: CONVENIO ICMS / Nota Técnica SINTEF
- NCM: Resolução CONFAZ, atualizada por ato da GC (ex.: Resolução GC 1.419/2025)

### IBGE
- Localidades: `https://servicodados.ibge.gov.br/api/v1/localidades`
- CNAE: `https://servicodados.ibge.gov.br/api/v1/cnaes`
- SIDRA (indicadores): `https://apisidra.ibge.gov.br/values`
- Cidades por UF: `https://servicodados.ibge.gov.br/api/v1/localidades/estados/SP/municipios`

### Caixa — SINAPI
- `https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi`
- Sistema Nacional de Custos e Índices da Construção Civil. **Gratuito e
  oficial.** É a melhor referência gratuita do Brasil para custo de
  engenharia e material — relevante se a empresa quiser precificar com base
  em dado público em vez de no palpite.
- Complemento: CUB Sind (%) — Sindruz, Usimisa, Sindipeças.

---

## 3. APIs gratuitas sem chave (enriquecimento opcional)

### BrasilAPI — `https://brasilapi.com.br`
- `/api/cnpj/v1/{cnpj}` → razão social, fantasia, situação cadastral, CNAE
  principal e secundários, endereço, telefone, e-mail
- `/api/cep/v1/{cep}` → logradouro, complemento, bairro, cidade, UF
- Sem cadastro, sem chave. Limite informal: **~5 req/s**. Não fazer crawl
  ou full scan. Índice ~90 dias atrás em relação à Receita.
- Falhou → "indisponível offline", formulário continua, usuário digita à mão.
- **Nunca** a resposta substitui validação local por dígito verificador.

### ViaCEP — `https://viacep.com.br/ws/{cep}/json/`
- Só CEP. Boa alternativa se a BrasilAPI estiver fora.
- Também é cors-frendly, mas tem limite diário.

### ConectaGov (API oficial de CNPJ)
- `https://apigateway.conectagov.estaleiro.serpro.gov.br/api-cnpj-{basica,empresa,qsa}/v2/...`
- **Gratuita, mas exige cadastro e chave.** Fonte oficial (SERPRO). Se o
  usuário quiser dado em tempo real, é o caminho — peça a chave a ele, não
  coloque no código.

### Chave de WhatsApp / telefone
- DDD oficial: ANATEL. Formato BR: 10 ou 11 dígitos, DDD 11–99, celular
  começa com 9. Normalize: remova tudo fora de `+` e dígitos, prefixe 55 se
  faltar, e trate `+` e `00` como código de país já presente.

---

## 4. Validação offline (a base de tudo)

Dígito verificador mod-11. Não precisa de rede, não erra, é lei.

```js
// CNPJ: pesos [5,4,3,2,9,8,7,6,5,4,3,2] depois [6,5,4,3,2,9,8,7,6,5,4,3,2]
// CPF:  pesos [10,9,8,7,6,5,4,3,2]      depois [11,10,9,8,7,6,5,4,3,2]
// resto 0 ou 1 -> digito 0;  resto 2..9 -> 11 - resto
```

**Rejeite os degenerados.** A maioria dos validadores online aceita:

| Valor | Por que é inválido |
|---|---|
| `00.000.000/0001-00` | todos os dígitos base zero |
| `11.111.111/1111-11` | dígitos repetidos |
| `000.000.000-00` | idem para CPF |

O seed em `js/data.js:187-189` usa exatamente `00.000.000/0001-00`, e esse
CNPJ vai parar na nota impressa. Nunca reintroduza.

**CEP:** exatamente 8 dígitos. Não valide prefixo por região — mudança de
numeração complicate. Formatar `00000-000` é seguro.

**Telefone:** 10 dígitos (fixo) ou 11 (celular, nono dígito `9`). Rejeite
`0000000000` e `1111111111`.

**E-mail:** `local@dominio.tld`, sem espaço, um `@`, TLD com 2+ letras.
Não seja severo demais (recusar e-mail válido é pior que aceitar lixo).

**Data:** o app usa `<input type="date">` → `YYYY-MM-DD`. `js/app.js:20-33`
transforma inválido em `"—"` silenciosamente. Valide no save e sinalize.

---

## 5. Dinheiro pt-BR

Regra: remova o que não for dígito, `,` ou `-`. Depois o **último
separador** decide. `.` e `,` juntos → `,` é decimal. Só `.` → é decimal
só se 1 ou 2 dígitos depois e nenhum `.` antes; senão é milhar.

```
"3.5"        -> 3.5     (o parseBRL atual em js/app.js:161 devolve 35)
"9.9"        -> 9.9     (atual devolve 99)
"2.700"      -> 2700
"1.234,56"   -> 1234.56 (atual devolve 1.23456)
"R$ 1.234,56"-> 1234.56
```

Arrede para 2 casas. Nunca devolva `NaN` — devolva `0` e deixe o validador
avisar. Valor de proposta é o dado mais crítico do app.

---

## 6. Seed e dado fictício — a regra que o usuário já fixou

**Decisão do usuário: remover o seed, manter a coluna `Valor` com texto
livre.**

O que é proibido:

- Nome de terceiro real, telefone pessoal, e-mail pessoal em
  `defaultLayout()` — hoje em `js/data.js:131-164` injeta "Condomínio
  Residencial Flamboyant", "Willian Teles" e os telefones de dois engineers
  em **toda proposta nova**.
- CNPJ inventado em campo fiscal. `07.602.753/0001-16` (`js/data.js:47-60`)
  parece real e não é.
- Data fixa como "Atibaia, 30 de abril de 2026".
- Preço de mercado fixo no código.

O que é aceitável:

- Template em branco: capa com rótulos vazios, tabela só com cabeçalho e
  uma linha vazia, data calculada na renderização.
- Conteúdo de demonstração **dentro** de `seedData()` (que só roda em
  `reset()`/primeiro uso), rotulado como exemplo, com CNPJ **válido** ou
  campo vazio.

> Se o CNPJ da empresa real for preenchido em Configurações, ele é dado do
> usuário, não semente. Respeite.

---

## 7. Como registrar fonte no código

Toda constante de dado tributário leva procedência. Exemplo:

```js
/* CFOP subset — CONVENIO ICMS 06/89 e NTS SINTEF.
   Fonte: https://www.nfe.fazenda.gov.br/portal/consultaNFe.aspx
   Consultado em 2026-09-30. Subconjunto: apenas naturezas usadas pelo app. */
var CFOP = { /* ... */ };
```

Requisitos:

1. Órgão emissor e número do ato
2. URL oficial
3. Data da consulta
4. Se é **subconjunto** — diga quais códigos ficaram de fora

Se não conseguir confirmar um código, **deixe de fora** e reporte ao
orquestrador. Código tributário errado é pior que código ausente.
