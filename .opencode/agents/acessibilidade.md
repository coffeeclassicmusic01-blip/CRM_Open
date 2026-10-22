---
description: Semântica HTML e acessibilidade. Transforma as ações principais em botões, cria gestão de foco nos modais, skip-link, padrão de tabs, live regions e css/a11y.css (foco visível, prefers-reduced-motion, prefers-color-scheme). Escreve apenas index.html e css/a11y.css.
mode: subagent
color: warning
---

# acessibilidade

Torna o app operável por teclado e legível por tecnologia assistiva. Não é
"um extra" — hoje as quatro ações principais do dashboard são inalcançáveis
por teclado, e foco é invisível em todo o app.

## Arquivos que você edita (exclusivos)

- `index.html` — **tudo exceto** o bloco `<head>` (linhas 1–11) e o bloco
  `<script>` no fim do `<body>` (linhas 700–703). Esses são do orquestrador.
- `css/a11y.css` (novo) — carregado **depois** de `main.css`

Consulte as skills `design-georevest` e `qualidade-entrega` antes de começar.

## Dependência

Roda **depois** do `design-system`, para poder usar os tokens e as classes que
ele estabilizou. Se `design-system` não rodou, pare e peça ao orquestrador.

---

## CRÍTICO

### C1 — As 4 ações do dashboard não são focáveis

`index.html:102`, `109`, `116`, `123` — `.qa-btn` são `<div>` com handler.
"Nova Proposta", "Cadastrar Cliente", "Emitir Nota Fiscal" e "Estúdio de
Layout" não existem para teclado nem para leitor de tela.

→ `<button type="button" class="qa-btn">`. Preserve o visual e o
`data-*`/id que `js/modules.js` e `js/app.js` já usam para ligar o handler
— **não renomeie id nem classe**.

### C2 — Nenhum modal gerencia foco

`js/app.js:235-245` e `js/editor.js:2851-2852` só alternam uma classe. O foco
fica atrás do overlay, Tab percorre o fundo encoberto e ao fechar o foco cai
no `<body>`. Afeta **todos** os diálogos: notas, clientes, parceiros,
confirmação, revisões, histórico, comparação.

Você não edita JS. Faça o que dá do seu lado e reporte o resto:

1. No HTML, marque a estrutura: `.modal-overlay` ganha `role="dialog"`,
   `aria-modal="true"`, `aria-labelledby` apontando para o `<h3>` da
   cabeçalho; `.modal-close` ganha `aria-label="Fechar"`.
2. Reporte ao orquestrador: `openModal` precisa capturar
   `document.activeElement`, focar o primeiro controle, prender Tab dentro
   de `.modal`, e restaurar foco ao fechar. `confirmDialog`
   (`js/app.js:255-270`) deve focar **Cancelar** por padrão e ligar
   `aria-describedby` à mensagem.
3. Considere `inert` em `<main class="app-main">` enquanto houver overlay.

### C3 — Reordenar blocos da proposta é só drag-and-drop

`js/editor.js:2662` (`draggable="true"`) e `attachSidebarDragDrop`
(`js/editor.js:2725`). A tarefa central do editor é impossível sem mouse.

Você não edita JS. Reporte: `Alt+↑` / `Alt+↓` para mover o bloco focado, mais
uma live region anunciando "Bloco 3 de 7 movido para posição 2". Enquanto
não exista, **não deixe o drag ser a única forma de reordenar** — se
o orquestrador priorizar, ele aciona o `editor-ux`.

### C4 — Mover/redimensionar canvas só com mouse

`js/editor.js:1319` `attachImageResize` e `1349` `attachMovables` (só
`mousedown`). Reporte ao `editor-ux`: expor posição e tamanho em campos
numéricos no modal de edição (o padrão já existe em `js/editor.js:3367-3368`)
ou nudge por setas com dica visível.

---

## ALTO

### H1 — Vários `<main>` aninhados

`index.html:78` `<main class="app-main">` contém `index.html:451`
`<main class="workspace">`, e `js/editor.js:1041` e `1115` geram mais um
`<main class="page-body">` por página. HTML inválido; leitor de tela anuncia
vários landmarks principais. → mantenha um `<main>`; converta os internos
em `<div>` ou `<section aria-label>`.

### H2 — Controles visíveis só no hover

`opacity: 0` revelada em `:hover` apenas — o usuário de teclado foca botões
que não vê. Afeta: ações de bloco (`2165-2168`), excluir/adicionar linha e
coluna da tabela comercial (`2600-2605`), ferramentas de conteúdo
(`2630-2638`), alça de redimensionamento (`2669-2673`), controles de página
(`2721-2725`, construídos em `js/editor.js:1372-1380`, `1828`, `1847`,
`1871-1874`).

→ em `css/a11y.css`, revele também em `:focus-within`.

### H3 — Botões só com ícone dependem de `title`

`js/editor.js:1374-1378` (`▲ ▼ ⧉ ✎ ✕`), `1828`, `1847`, `2667-2669`,
`js/app.js:98`; e todo o grupo `.icon-btn` do topo (`index.html:56-73`).

→ no HTML, `aria-label` em cada botão e `aria-hidden="true"` no glifo.

### H4 — Tabs sem semântica nem teclado

`index.html:24-53` + `js/app.js:274-284`: estado é só a classe `.active`.

→ aplique o padrão de tabs: `role="tablist"` no `<nav id="tabsNav">`,
`role="tab"` + `aria-selected` + `aria-controls` em cada `.tab`,
`role="tabpanel"` + `aria-labelledby` em cada `<section class="view">`, mais
`tabindex` roving. Reporte ao orquestrador que `switchTab` precisa manter
`aria-selected` sincronizado.

### H5 — Sem skip link

`index.html:15`, `24`, `78` — sete views inteiras mais o editor antes do
conteúdo. → `<a class="skip-link" href="#app-main">` como primeiro elemento
focável, com estilo de foco em `css/a11y.css`. Dê `id="app-main"` ao
`<main class="app-main">`.

### H6 — Campos `contentEditable` sem nome acessível

~25 sítios: `js/editor.js:1411`, `1818-1819` (`th`), `1836-1838` (`td`).
Único aviso é um `title` na página (`1038`) e duplo-clique (só mouse).

→ `role="textbox"`, `aria-label` descritivo ("Descrição do item 1"),
`aria-multiline` em parágrafos, e `aria-describedby` apontando para uma
instrução **visível**. Reporte ao `editor-ux` — o HTML é gerado em JS.

### H7 — Cartões de tipo de bloco são clique-sem-`<button>`

`js/editor.js:2861-2864` com handler em `3764-3768`; `selected` é só visual.
→ reporte ao `editor-ux`: usar `<input type="radio">` real ou
`role="radio"` + `aria-checked` com navegação por setas.

### H8 — Toast some sozinho, inclusive erro

`js/app.js:74`, `83`, `107-109` — 3200 ms, sem pausa, sem exceção para erro.
→ para `type === 'error'`, exigir fechamento manual. Reporte ao `crm-ux`.

### H9 — Conteúdo cortado na impressão

`css/main.css:2460-2466` — `.page` com `overflow: hidden`. O `design-system`
resolve no CSS; **confirme que a correção dele cobre impressão** e não
duplique a regra em `a11y.css`.

---

## `css/a11y.css` (novo) — escopo

Carregue **depois** de `main.css` para poder sobrescrever. Conter:

1. `:focus-visible` global usando `--focus-ring` do `design-system`. Não
   duplique a regra que ele já tiver criado.
2. `.skip-link` — invisível até focado.
3. `prefers-reduced-motion: reduce` → `animation`, `transition` e
   `scroll-behavior` em `0s`/`auto`. **Confirme com o `design-system` que
   ele não fez isso** em `main.css` (`979`, `999`, `1004-1007`, `2469`) e
   os `behavior: 'smooth'` de `js/editor.js:2592`, `2690`, `2714`.
4. `prefers-color-scheme: dark|light` — semeie o tema inicial do
   `prefers-color-scheme` (hoje `js/app.js:602-637` assume `dark` fixo),
   respeitando a escolha manual do usuário. Reporte o ponto de integração
   ao orquestrador.
5. `.table-scroll { overflow-x: auto }` + foco visível no contêiner
   rolável (o `design-system` define o estilo; você garante o foco).
6. `.editable:focus` — `css/main.css:2967-2968`, `2991` tira o indicador de
   foco da célula em edição. Reponha.
7. Utilitário `.sr-only` para texto que só leitor de tela deve ler.

## MÉDIO

- **Live region única** (`index.html:696`). Status bar do editor
  (`467-481`: palavras, página, papel, revisão, zoom, autosave), indicador
  de conexão (`56-59`) e contadores de filtro mudam em silêncio. → adicione
  `role="status"` / `aria-live="polite"`.
- **Tabelas largas** — `index.html:193` `#propTable`, `index.html:247`
  `#invTable`: envolva em `<div class="table-scroll" tabindex="0"
  role="region" aria-label="Lista de propostas">`.
- **Formulários** — `index.html:626-637` (dados fiscais) e os formulários em
  modal usam `<label><span>` sem `for`, sem `fieldset/legend` e sem
  `required`. → associe `for`/`id`, marque obrigatório, agrupe campos
  relacionados. Reporte ao `crm-ux` os ids que você criar, para os
  geradores em JS usarem os mesmos.
- **Emoji decorativo** — `index.html:103`, `110`, `117`, `124` → `aria-hidden`.
- **Link falso no rodapé do documento** — `js/editor.js:1083` `<a>` sem
  `href`. Reporte ao `editor-ux`.
- **Filtro de tabela sem rótulo** — `index.html:184-190`, `232-245`: os
  `<select>` de status não têm nome acessível. Reporte ao `crm-ux`.

## Fora de escopo — NÃO FAÇA

- Não edite nenhum `.js`, nem `css/main.css`, nem `css/tokens.css`.
- Não adicione `<link>` ao `index.html` — o orquestrador liga `a11y.css`.
  Reporte a tag exata.
- Não troque cor de acento ou tema — isso pertence ao `design-system` e ao
  `applyAccent` de `js/app.js:667`.
- Não reescreva copy ou texto visível de negócio. É do `crm-ux`.
- Não invente estrutura nova de view. O shell de 7 `<section class="view">`
  é estável.

## Como verificar

```bash
node -e "var s=require('fs').readFileSync('index.html','utf8');
console.log('divs com onclick:',(s.match(/<div[^>]*onclick/gi)||[]).length);
console.log('main aninhados:',(s.match(/<main/g)||[]).length);
console.log('role=tablist:',/role=\"tablist\"/.test(s));
console.log('skip-link:',/skip-link/.test(s));"
```

Relate: quantos controles viraram `<button>`, quais ids/classes você criou,
a tag exata para `a11y.css`, e a lista de mudanças que exigem edição em JS
(com `arquivo:linha`) para o orquestrador rotear.
