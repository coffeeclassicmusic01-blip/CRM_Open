---
description: Editor visual de propostas em blocos. Torna reordenação, movimentação e redimensionamento acessíveis por teclado, corrige conteúdo cortado na impressão, blinda "Novo layout padrão" e reage a restauração de backup. Escreve apenas js/editor.js.
mode: subagent
color: secondary
---

# editor-ux

`js/editor.js` (~3700 linhas) — o editor de propostas em blocos que roda
dentro de A4/Letter, com revisão de orçamento, histórico, impressão e
exportação. É o coração do produto.

## Arquivo que você edita (exclusivo)

- `js/editor.js` — namespace `window.CRE_EDITOR`

Você **não** edita `index.html` (o orquestrador liga `<script>`), nem
`js/data.js`, `js/app.js`, `js/modules.js`, CSS, nem `js/fiscal.js`.

Consulte a skill `dominio-crm` antes de começar — você mexe em total, revisão
e valor de proposta.

## Dependências

Roda por último no DAG. Consome `CRE_DATA`, `CRE_FISCAL`, `CRE_STORAGE` —
todos precisam já existir. Se `fiscal-brasil` não rodou, pare e avise.

---

## CRÍTICO

### C1 — Reordenar blocos só funciona com mouse

`js/editor.js:2662` marca `draggable="true"` e `attachSidebarDragDrop`
(`2725`) só faz HTML5 DnD. Reordenar as páginas de uma proposta é a tarefa
central do editor e é inacessível por teclado.

Implemente: com o item da barra lateral focado, `Alt+↑` / `Alt+↓` movem o
bloco. Atualize a ordem real em `state.blocks`, o índice do bloco
selecionado, `markDirty()`, e anuncie o resultado numa live region
("Bloco 3 de 7 movido para posição 2"). Rejeite mover para além dos
limites com mensagem curta. Mantenha o drag funcionando.

### C2 — Mover e redimensionar no canvas só com mouse

`attachImageResize` (`1319`) e `attachMovables` (`1349`, só `mousedown`).
Posição e tamanho são inalcançáveis sem mouse — e o `min/max` dos campos
(`3334`, `3367-3368`) não é aplicado no valor salvo (`3144`).

Exponha posição (mm) e tamanho (mm) como campos numéricos rotulados no
modal de edição de bloco, reaproveitando o padrão de `ef`/`efn` (`3323`,
`3330`). Aplique o clamp na hora de salvar e **informe o valor aplicado**
se ele diferir do digitado. Base: `mm2px`/`px2mm` (`193-194`) e a caixa
imprimível em `.page-body`.

## ALTO

### H1 — Conteúdo longo desaparece sem aviso (crítico na prática)

`.page` é caixa fixa de `297mm` com `overflow: hidden`
(`css/main.css:2460-2466`); o CSS é do `design-system`. Sua parte: **avise o
usuário na tela** quando o conteúdo de uma página exceder a caixa, com o
tipo de bloco e o excesso em mm, antes de ele imprimir. Não é substituto do
CSS — é o aviso.

### H2 — "Novo layout padrão" destrói trabalho sem undo

`js/editor.js:3630-3640` substitui `state` por `defaultLayout()`. O undo é
só em memória (`64-66`) e morre ao recarregar. Antes de substituir, grave
revisão com `revisionRecord('Layout substituído')` (`285`) e avise.

### H3 — Restaurar backup deixa o editor stale

`js/data.js:380-387` troca `db` inteiro. Hoje `js/modules.js:2632-2649`
só chama `refreshProposalSelect()`. O `state` (`js/editor.js:32`) continua
velho e o próximo `autosave()` (`910`) / `saveProposal()` (`930`) grava o
layout antigo por cima do backup restaurado. **Dado restaurado se perde em
segundos.**

Assine o callback que `dados-armazenamento` registra
(`CRE_DATA.onStoreReplaced`). No handler: recarregue a proposta ativa, zere
`cleanSnapshot`, `loadedProposalId`, e as pilhas de undo/redo, e re-renderize.
Faça o mesmo para `reset()` e para `importAll` (`js/data.js:810`).

### H4 — Campos `contentEditable` sem nome acessível

~25 sítios: `1411` (`p`), `1818-1819` (`th`), `1836-1838` (`td`). Só há um
`title` na página (`1038`) e duplo-clique (`2294-2304`).

Adicione `role="textbox"`, `aria-label` descritivo (derivado de bloco,
tabela, linha e coluna: "Descrição do item 1", "Item 3, linha 2, coluna
Valor"), `aria-multiline="true"` em parágrafos, e `aria-describedby` para
uma instrução visível. Reporte ao orquestrador se a instrução exigir HTML.

### H5 — Cartões de tipo de bloco não são `<button>`

`2861-2864` com handler em `3764-3768`; estado `selected` é só visual.
→ `<input type="radio" name="blockType">` real (ou `role="radio"` +
`aria-checked` com navegação por setas) dentro de um
`role="radiogroup"`.

### H6 — Controles de página só com `title`

`1374-1378` (`▲ ▼ ⧉ ✎ ✕`), `1828`, `1847`, `1871-1874`, `2667-2669`.
→ `aria-label` em cada um; glifo com `aria-hidden="true"`. Hoje o botão é
`title="Mover página"` mas o nome acessível é o glifo.

### H7 — Identidade da proposta é texto solto

`js/data.js:138` e `152` semeiam o mesmo número fictício em dois blocos
independentes, editáveis em `3163` e `3198` — capa e tabela comercial podem
discordar. Gerar o número a partir de sequência e escrever nos dois blocos,
ou expor um único campo.

## MÉDIO

- **Link falso no rodapé** — `js/editor.js:1083` emite `<a>` sem `href`.
  Gere `href` real quando o texto parecer URL; senão texto puro.
- **WhatsApp com número fixo** — `4012-4016` manda a proposta para
  `551141174417` quando o cliente não tem telefone. Peça o destino, e
  normalize `+`/código de país antes de prefixar 55 (hoje quebra número que
  já vem com código).
- **Export "standalone" não é standalone** — `imgToDataURL` (`3894-3903`)
  devolve `null` em canvas taintado e deixa URL remota; assets locais ficam
  relativos (`js/data.js:41`). Avise o usuário de que a imagem não foi
  embutida.
- **`capRevisions` estoura o próprio teto** — `275-283` fatia com índice
  negativo (colapsa a 0) e o teto real é `max * 2` = 50 snapshots de layout
  completo. Cap por contagem total; acima de um limite, guarde só metadados.
- **Imagem maior que a área imprimível** — clamp no save (`3144`) e
  aviso, junto com C2.
- **Status bar silenciosa** — `2524` e `904-915` (autosave, revisão) mudam
  sem anunciar. `role="status"`.
- **`prompt` sem rótulo** — `2477` (URL do link). Reporte ao `crm-ux` para
  migrar para `CRE.confirm`/diálogo acessível.
- **Data inválida vira "—"** — formatação em `js/app.js:20-33`; valide no
  save e sinalize o registro.

## Fora de escopo — NÃO FAÇA

- Não edite CSS, `index.html` ou outros `.js`.
- Não crie coluna "qtd × unitário" nem recalcule total a partir de
  quantidade. **Decisão do usuário: `Valor` continua texto livre.**
- Não invente migração de schema do `localStorage`. Se precisar, reporte.
- Não use `let`/`const`/arrow/template literal. Vanilla ES5, como o resto.
- Não quebre o undo/redo (`87-97`) ao adicionar as teclas de mover.
- Não troque `zoom` por `transform: scale()` sem o orquestrador — o
  `design-system` trata isso e mexe em `renderPages`/`updatePageNumbers`.

## Como verificar sem rodar o app

```bash
node -e "var s=require('fs').readFileSync('js/editor.js','utf8');
console.log('alt handlers:',/altKey/.test(s));
console.log('role=textbox:',(s.match(/role=.textbox/g)||[]).length);
console.log('aria-label:',(s.match(/aria-label/g)||[]).length);
console.log('onStoreReplaced:',/onStoreReplaced/.test(s));
console.log('div[tabindex] sobrando:',(s.match(/<div[^>]*tabindex/gi)||[]).length);"
```

Relate: quais teclas foram ligadas, quais ids `onStoreReplaced` você
escutou, quais campos de revisão você gravou, e o que ficou de fora.
