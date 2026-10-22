# Georevest Studio — Convenções para agentes

SPA vanilla (HTML + CSS + JS ES5-ish, sem build). CRM + editor de propostas
comerciais + controle de notas fiscais para empresa de engenharia geotécnica.

Leia isto antes de editar qualquer arquivo. As regras abaixo **não são
sugestões** — são a razão de o projeto não ter colidido até agora.

---

## 1. Restrições invioláveis

1. **Sem dependências.** Nenhum `npm install`, nenhum bundler, nenhum
   framework, nenhum CDN além do que já existe. O app precisa continuar
   abrindo com duplo clique em `index.html`.
2. **Offline-first.** O app é usado em campo, com internet instável. Validação
   e formatação **precisam** funcionar sem rede. Consultas externas são
   *enriquecimento opcional* e sempre degradam para "indisponível offline".
3. **Vanilla ES5.** O código existente usa `var`, funções anônimas, IIFE e
   `window` como namespace. **Não introduza** `let`/`const`, arrow functions,
   `async/await`, template literals, módulos ES, `class`, spread ou optional
   chaining. Um `<script>` com erro hoje quebra um app inteiro.
4. **Nada de build.** Não converta nada para ESM, não introduza `type="module"`.
5. **UTF-8 sem BOM.** Todos os arquivos já são UTF-8 válido. Salve sempre em
   UTF-8 sem BOM ou os acentos quebram.
6. **Sem comentários desnecessários.** O código se documenta pelo nome. Só
   comente o *porquê* de uma decisão não óbvia.

## 2. Arquitetura

```
index.html          Shell único. <head> com links, <body> com 7 <section class="view">,
                    depois os <script class="src"> no fim do body.
css/main.css        ~2900 linhas. Tokens em :root, tema claro em [data-theme="light"].
css/tokens.css*     Design tokens. Carregado ANTES de main.css.
css/a11y.css*       Foco, skip-link, prefers-reduced-motion. Carregado DEPOIS de main.css.
js/data.js          Storage + seed + CRUD. Namespace window.CRE_DATA.
js/app.js           Infra transversal: helpers, toasts, modais, paleta de comandos,
                    tema/acento, atalhos. Namespace window.CRE.
js/editor.js        Editor visual de propostas em blocos. Namespace window.CRE_EDITOR.
js/modules.js       Todas as views de negócio (dashboard, propostas, NF, clientes,
                    parceiros, config). Namespace window.CRE_MODULES.
js/storage.js*      Wrapper de localStorage com detecção de quota. Namespace window.CRE_STORAGE.
js/fiscal.js*       CNPJ/CPF/CEP/dinheiro/datas. Funções puras, sem DOM, sem storage.
js/validators.js*   Regras de validação de formulário e mensagens de erro em pt-BR.
```

`*` = arquivo novo, criado por um agente específico.

### Padrões obrigatórios

- **Escape obrigatório** em qualquer interpolação de dado do usuário dentro de
  HTML. Existe `esc()` em `js/app.js:14`. Today `js/modules.js:1538` injeta
  `statusTxt` sem escape numa janela `document.write` — XSS armazenado que dá
  acesso a todo o `localStorage`. **Não repita isso.**
- **Estado só no `localStorage`.** Fonte da verdade é `CRE_DATA.load()`.
  Views leem e redesenham; nunca guardam cópia paralela de dados.
- **Módulos expõem API**, não estado. Editar um módulo que outro consome
  exige avisar o orquestrador, porque o consumidor vive em outro arquivo.
- **Toda escrita passa por `CRE_DATA.save()`**, e `save()` precisa retornar
  sucesso/falha. Nunca confie em escrita silenciosa.
- **Tabelas e listas grandes** vão dentro de `<div class="table-scroll">` para
  poder receber `overflow-x: auto` + `tabindex="0"` + `role="region"`.

## 3. Matriz de propriedade (fim de conflito)

**Cada arquivo tem exatamente um dono. Ninguém mais escreve nele.**

| Arquivo | Dono |
|---|---|
| `index.html` | `acessibilidade` |
| `css/main.css` | `design-system` |
| `css/tokens.css` | `design-system` |
| `css/a11y.css` | `acessibilidade` |
| `js/data.js` | `dados-armazenamento` |
| `js/storage.js` | `dados-armazenamento` |
| `js/fiscal.js` | `fiscal-brasil` |
| `js/validators.js` | `fiscal-brasil` |
| `js/app.js` | `crm-ux` |
| `js/modules.js` | `crm-ux` |
| `js/editor.js` | `editor-ux` |
| qualquer outro arquivo | `orquestrador` |

**Zona reservada do `index.html`.** Só o `orquestrador` escreve nestas faixas:

- o bloco `<head>` completo (linhas 1–11): `<link>` de CSS e `<meta>`
- o bloco `<script>` no fim do `<body>` (linhas 700–703)

Motivo: novos módulos precisam ser registrados em `index.html`, e isso
criaria conflito entre `fiscal-brasil`, `dados-armazenamento` e
`acessibilidade`. O orquestrador centraliza esse passo.

Tudo mais do `index.html` (as 7 `<section class="view">`, o `<header>`,
modais, toasts) é do `acessibilidade`.

**Leitura cruzada é livre e esperada.** Qualquer agente pode ler qualquer
arquivo. Só escrita é exclusiva.

## 4. Ordem de implementação (DAG)

```
fiscal-brasil          módulo puro, zero dependência. SEMPRE PRIMEIRO.
       │
       ▼
dados-armazenamento    consome fiscal.js para validar no load/import
       │
       ▼
crm-ux                 consome fiscal.js + validators.js + storage.js
       │
       ▼
design-system          CSS. Independente do JS, mas deve rodar depois
       │               para não ser sobrescrito por main.css
       ▼
acessibilidade         index.html. Precisa dos nomes de classe já
       │               estabilizados por design-system
       ▼
editor-ux              editor.js. Consome o resto
       │
       ▼
orquestrador           liga <script>/<link> em index.html
       │
       ▼
qa-verificador         auditoria final, read-only
```

Nunca peça a um agente para consumir um módulo que ainda não existe. Se
`crm-ux` precisar de `storage.js` e `dados-armazenamento` não rodou, o
orquestrador executa essa fase primeiro.

## 5. Contrato entre módulos

Para evitar drift, `fiscal-brasil` entrega uma API estável. Antes de mudar
qualquer assinatura, o orquestrador tem de avisar e listar todos os
consumidores.

```js
// window.CRE_FISCAL
CRE_FISCAL.isValidCnpj(v)        // boolean — dígito verificador mod-11
CRE_FISCAL.isValidCpf(v)         // boolean
CRE_FISCAL.isValidCep(v)         // boolean — 8 dígitos
CRE_FISCAL.formatCnpj(v)         // "00.000.000/0000-00"
CRE_FISCAL.formatCpf(v)          // "000.000.000-00"
CRE_FISCAL.formatCep(v)          // "00000-000"
CRE_FISCAL.parseCep(v)           // "00000000"
CRE_FISCAL.parseMoney(v)         // number pt-BR: "3.5"→3.5, "1.234,56"→1234.56
CRE_FISCAL.formatMoney(v)        // "R$ 1.234,56"
CRE_FISCAL.isValidEmail(v)       // boolean
CRE_FISCAL.isValidPhoneBR(v)     // boolean — 10 ou 11 dígitos
CRE_FISCAL.todayISO()            // "YYYY-MM-DD"
CRE_FISCAL.toISODate(d)          // Date | string → "YYYY-MM-DD" | ""
CRE_FISCAL.isValidISODate(v)     // boolean
CRE_FISCAL.isOverdue(nf, refDate) // boolean — vence antes de refDate e não pago
CRE_FISCAL.taxDisclaimer()       // string — aviso de "sem valor fiscal"
CRE_FISCAL.FOOTER_CFOP, CRE_FISCAL.FOOTER_NCM  // tabelas offline com fonte citada
```

```js
// window.CRE_VALIDATORS
CRE_VALIDATORS.validate(fields)   // → { campo: "mensagem em pt-BR" }
CRE_VALIDATORS.required(value, label)
CRE_VALIDATORS.cnpj(value, label)
CRE_VALIDATORS.renderErrors(errors)  // HTML acessível para exibir no form
CRE_VALIDATORS.attach(root)       // liga blur/submit ao form, aria-invalid
```

## 6. O que está deliberadamente errado (e por quê ainda existe)

Não "conserte" estes pontos sem aprovação explícita — cada um tem uma
decisão de produto por trás.

| Local | Estado | Decisão |
|---|---|---|
| `js/data.js` `defaultLayout()` | Seed com cliente/telefone/engenharia reais | **Removido** — layout funcional sem dado de terceiro |
| Tabelas comerciais | Coluna `Valor` com texto livre, sem qtd × unitário | **SUPERADO em 05/10/2026**: decidido catálogo de serviços com exceção manual. A tabela textual é dívida técnica, não decisão vigente. |
| `js/data.js:36-60` | Telefone/CNPJ/endereço placeholder em `defaultFooter`/`defaultFiscal` | **Pendente** |
| `js/modules.js:1534,1430` | Título "NOTA FISCAL" / botão "DANFE" | **Decidido: renomear** para documento interno com disclaimer |
| `js/app.js:161` | `parseBRL` está errado | **Decidido: substituir** por `CRE_FISCAL.parseMoney` |
| `js/data.js:1072` | `overdue` manual, nunca derivado de `dueDate` | **Decidido: derivar** |
| Tabelas comerciais | Coluna `Valor` com texto livre, sem qtd × unitário | **Decidido: manter** como está |

## 7. Antes de declarar qualquer tarefa concluída

Verifique `.opencode/skills/qualidade-entrega/SKILL.md`. O mínimo:

- [ ] App abre com duplo clique em `index.html`, sem erro no console
- [ ] Dado já salvo no `localStorage` continua sendo lido (sem perda)
- [ ] Fluxo completo: criar cliente → criar proposta → emitir documento → imprimir
- [ ] `Ctrl+S`, `Ctrl+K`, `Esc` e `?` ainda funcionam
- [ ] Impressão não corta conteúdo
- [ ] Nenhum `fetch()` no caminho crítico — offline continua funcionando