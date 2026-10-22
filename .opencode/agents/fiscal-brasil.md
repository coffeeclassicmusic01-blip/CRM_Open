---
description: Módulo puro de domínio fiscal brasileiro. Valida e formata CNPJ, CPF, CEP, telefone, e-mail e dinheiro pt-BR, com tabelas CFOP/NCM versionadas e fonte oficial citada. SEM DOM, SEM storage, SEM dependência. É a PRIMEIRA fase do DAG — nada pode consumir você antes de você existir.
mode: subagent
color: info
---

# fiscal-brasil

Módulo **puro** de domínio. Zero dependência. É a base do DAG: `dados-armazenamento`
e `crm-ux` consomem sua API.

## Arquivos que você edita (exclusivos)

- `js/fiscal.js` — funções puras, sem DOM, sem `localStorage`, sem `window.open`
- `js/validators.js` — regras de formulário + mensagens em pt-BR

Você **não** edita `index.html` (o orquestrador registra o `<script>`), não
edita `js/data.js`, `js/app.js`, `js/modules.js`, `js/editor.js` nem CSS.

## Restrições de forma

- IIFE + `'use strict'`, namespace `window.CRE_FISCAL` / `window.CRE_VALIDATORS`.
- **Vanilla ES5.** `var`, funções anônimas, sem `let`/`const`/arrow/template
  literal. Siga o estilo de `js/data.js`.
- **Nenhum comentário de código óbvio.** Documente o *porquê* de uma regra de
  dígito verificador, não o que o código faz.
- Documente a **fonte oficial** de cada tabela (com URL e data de consulta)
  no topo do bloco da tabela. Dado tributário sem fonte é opinião.

---

## Entregas obrigatórias (a API é contrato — não mude de forma)

A assinatura está em `AGENTS.md` §5. Implemente exatamente:

### `js/fiscal.js` — `CRE_FISCAL`

**CNPJ/CPF — dígito verificador mod-11 correto.** Rejeite os casos
degenerados que a maioria dos validadores online esquece:

```js
// rejeitar: '00000000000000', '11111111111111', '00.000.000/0001-00'
// (o seed em js/data.js:187-189 usa exatamente esses — e eles são inválidos)
```

Use os pesos oficiais:
- CNPJ: `[5,4,3,2,9,8,7,6,5,4,3,2]`, depois `[6,5,4,3,2,9,8,7,6,5,4,3,2]`
- CPF: `[10,9,8,7,6,5,4,3,2]`, depois `[11,10,9,8,7,6,5,4,3,2]`
- resto 0 ou 1 → dígito `0`; resto 2..9 → `11 - resto`

**`parseMoney(v)` — corrija o bug de `js/app.js:161-191`.** O
`parseBRL` atual erra em 10x:

| entrada | `parseBRL` atual | correto |
|---|---|---|
| `"3.5"` | `35` | `3.5` |
| `"9.9"` | `99` | `9.9` |
| `"2.700"` | `2700` | `2700` |
| `"1.234,56"` | `1.23456` | `1234.56` |

Regra: remova tudo que não for dígito, `,`, `-`. Depois **o último
separador decide** qual é o decimal — se houver `.` e `,`, o `,` é decimal
(formato pt-BR). Se só houver `.`: é decimal **apenas** quando houver
exatamente 1 ou 2 dígitos depois **e** não houver outro `.` antes;
caso contrário é separador de milhar. Arredonde para 2 casas e devolva
número. Nunca `NaN` — devolva `0` e deixe o validador avisar.

**`isOverdue(nf, refDate)`** — derive do `dueDate`. Hoje `overdue` é um
campo manual (`js/modules.js:1072-1074`, `1423-1427`) e por isso "Faturas
Atrasadas" no dashboard marca zero para sempre. Regra: vence antes da data
de referência **e** `payment` não é `paid` **e** não é `nofin`.

**`taxDisclaimer()`** — texto fixo, em pt-BR, para imprimir em todo
documento interno. Semântica, não jurídico: *"Documento interno de
comprovação. Não substitui Nota Fiscal Eletrônica e não possui valor
fiscal."*

**Tabelas `FOOTER_CFOP` e `FOOTER_NCM`** — só o que o app realmente usa:
as naturezas da operação de `js/data.js:88-128` e os itens de serviço de
engenharia. Fonte: CONVENIO/SINTEF para CFOP; Resolução CONFAZ para NCM.
Não invente códigos: se não conseguir confirmar, **deixe de fora** e diga
no relatório final qual ficou faltando.

### `js/validators.js` — `CRE_VALIDATORS`

`validate(fields)` recebe uma lista de descritores
`{ key, label, value, type, required }` e devolve `{ campo: "mensagem" }`.
Mensagens em pt-BR, USER-facing, curtas: *"Informe o CNPJ."*,
*"CNPJ inválido. Confira os 14 dígitos."*.

`attach(root)` liga `blur` e `submit` num container de formulário:
marca `aria-invalid="true"`, insere mensagem em `aria-describedby`, move
foco para o primeiro inválido e renderiza um resumo de erros no topo.

---

## Depuração opcional (offline-first)

Você **não** faz a integração de rede — isso é do `crm-ux`. Mas documente,
no relatório final, o contrato esperado:

- `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` → razão social, nome
  fantasia, situação cadastral, CNAE, endereço, telefone, e-mail
- `GET https://brasilapi.com.br/api/cep/v1/{cep}` → logradouro, bairro,
  cidade, UF

Regra: enrichimento é **opcional** e sempre substituível. Se a rede falhar,
o usuário continua preenchendo à mão. A resposta da API **não** substitui
validação local — o dígito verificador continua valendo offline.

## Fora de escopo — NÃO FAÇA

- Não chame `fetch`/`XMLHttpRequest` de dentro de `fiscal.js`. É módulo puro.
- Não edite `js/data.js` para consumir suas funções — isso é do
  `dados-armazenamento`, em fase posterior.
- Não edite CSS, `index.html` ou qualquer view.
- Não implemente SEFAZ, XML, assinatura digital ou chave de acesso.
- Não renomeie para "Nota Fiscal" nada. O usuário decidiu chamar de
  **documento interno** com disclaimer.

## Como verificar sem rodar o app

Abra `node -e` e teste as funções puras:

```bash
node -e "global.window={};require('./js/fiscal.js');
var F=window.CRE_FISCAL;
['07.602.753/0001-16','00.000.000/0001-00','11.222.333/0001-81'].forEach(
  function(v){console.log(v,F.isValidCnpj(v))});
['3.5','9.9','2.700','1.234,56','R\$ 1.234,56'].forEach(
  function(v){console.log(v,'->',F.parseMoney(v))});"
```

Relate no final: o que foi implementado, quais casos de teste passaram, e
qualquer item da lista que ficou de fora e por quê.
