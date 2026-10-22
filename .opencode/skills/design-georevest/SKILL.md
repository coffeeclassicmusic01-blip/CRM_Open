---
name: design-georevest
description: Use ao mexer em qualquer CSS, cor, fonte, espaçamento, breakpoint ou estado visual do Georevest Studio. Contém a linguagem visual da marca (tokens, acento, tema), regras de contraste, movimento respeitoso e o padrão de impressão que não pode cortar conteúdo. Aciona em "ficar bonito", "cores", "tema", "escuro/claro", "responsivo", "celular", "impressão", "tipografia", "spacing", "tokens".
---

# Linguagem visual do Georevest Studio

Empresa de engenharia geotécnica. Precisa parecer **técnica e confiável**,
não startup. Densidade de informação importa: o usuário éestafa que
trabalha em campo, não Idle.

## 1. Ordem de carga do CSS

```
css/tokens.css   ← tokens primeiro, sem_reset
css/main.css     ← componentes
css/a11y.css     ← foco, skip-link, reduced-motion, color-scheme (por último, vence)
```

Se algo novo precisar vencer `main.css`, ele vai para `a11y.css` — nunca
para `index.html` (é do orquestrador).

## 2. Tokens

Todos vivem em `css/tokens.css`. **Nenhum hex solto no corpo de
`main.css`.** Se aparece, é dívida.

### Cor — semântica antes de matiz

| Token | Uso |
|---|---|
| `--bg`, `--bg-2` | fundo da página / fundo de área recuada |
| `--panel`, `--panel-2` | cards, tabelas, cabeçalhos de tabela |
| `--panel-hover` | hover de linha |
| `--border`, `--border-2` | divisor normal / divisor de ênfase |
| `--text`, `--text-2` | primário / secundário |
| `--muted` | label, legenda, texto auxiliar |
| `--faint` | **só decorativo** — nunca texto (ver §4) |
| `--accent` + `-h` + `-soft` + `-glow` | ação primária, hover, fundo translúcido, halo |
| `--danger`, `--success`, `--warning`, `--info` | estado |

**O acento é configurável em runtime.** `applyAccent` (`js/app.js:667`)
gera o tom claro e escuro a partir do hex escolhido e escreve no `:root`.
Consequência: **nunca** assuma que `--accent` é azul. Nenhum componente pode
depender do valor específico do acento. Teste mental: a interface tem que funcionar
com as 8 cores de Configurações.

### Tipografia

- `--font-sans`: Plus Jakarta Sans (UI, textos)
- `--font-mono`: JetBrains Mono (números, valores, referências de bloco)
- Escala fluida com `clamp()`: `--text-xs` … `--text-4xl`
- Tabela comercial e valores **sempre** em mono, com `font-variant-numeric:
  tabular-nums` — coluna de dinheiro desalinhada lê como erro.
- Números de proposta, revisão, página, zoom: mono, tamanho pequeno,
  `--faint` só se decorativo.

### Espaçamento e raio

Base 4px. `--space-1` (4) a `--space-12` (48). Raios já existem:
`--radius-xs` (4) e `--radius-sm` (7) — não invente raio ad hoc.

## 3. Tema claro

`[data-theme="light"]` em `main.css` (não em `tokens.css` — os valores do
tema são poucos). O botão em `index.html:68` alterna; `initTheme`
(`js/app.js:628`) assume `dark` por padrão. Semeia com
`prefers-color-scheme` no primeiro uso, respeitando escolha manual
posterior.

## 4. Contraste — regra dura

| Alvo | Mínimo |
|---|---|
| texto normal | **4.5:1** |
| texto ≥ 18,66px ou ≥ 14px bold | **3:1** |
| borda de componente, ícone de ação | **3:1** |

`--faint: #475569` (≈2.5:1 no fundo escuro) **não passa**. Eleve para a faixa
`#7c8ba1`+ e mantenha o valor antigo só em divisória, marca d'água e borda.

Verifique **os dois temas**. Contraste que passa no escuro e falha no claro
é o erro mais comum aqui.

## 5. Movimento

- `--dur-fast: 120ms`, `--dur-base: 180ms`, `--dur-slow: 280ms`
- `--ease-out: cubic-bezier(.22,.61,.36,1)`
- Animar `transform` e `opacity`; **nunca** `width`, `height`, `top`, `left`.
- `scroll-behavior: smooth` só se `prefers-reduced-motion` permitir.
- Duração funcional máxima: 280ms. Passou disso, o app parece lento.

## 6. Estado de foco — um só lugar

`:focus-visible` global, 2px, `--focus-ring`, `outline-offset: 2px`.
Existe `outline: none` em oito pontos de `main.css` (`509`, `1894`, `1959`,
`2103`, `2390`, `2700`, `2830`, `2886`) — todos precisam de substituto.

Controle com `opacity: 0` no hover (`2165-2168`, `2600-2605`, `2630-2638`,
`2669-2673`, `2721-2725`) **precisa** revelar em `:focus-within`. Botão que
só o mouse enxerga não existe.

Célula em edição perde o indicador (`2967-2968`, `2991`): reponha com
`box-shadow: inset 0 0 0 2px var(--accent)`.

## 7. Responsividade

| Faixa | Comportamento |
|---|---|
| > 1200px | alvo principal — grade 2 colunas |
| 900–1200px | sidebar do editor encolhe (260px), grade 1 coluna |
| 640–900px | sidebar do editor vira gaveta (`body.sb-collapsed`, `2970`) |
| < 640px | 1 coluna; tabela vira `.table-scroll` com `overflow-x: auto` |

O topbar esconde rótulo de botão em `.hide-mobile` (`index.html:66`) — que
o ícone continue com `aria-label`, senão o botão fica sem nome acessível.

## 8. Impressão — não negociável

O usuário imprime proposta e manda para cliente final. Conteúdo cortado é
falha de negócio, não de estilo.

- `.page` é caixa fixa de `297mm` com `overflow: hidden` (`2460-2466`).
  Em `@media print`: `height: auto; overflow: visible`.
- `break-inside: avoid` em tabela comercial, imagem e bloco de valores.
  Tabela quebrada ao meio no PDF é inaceitável.
- Repetir cabeçalho e rodapé por página (`buildHeader`/`buildFooter`,
  `js/editor.js:1059`/`1063`).
- `-webkit-print-color-adjust: exact` quando o fundo importa.
- Nunca esconder informação só porque "não cabe" — reflow e reduza, não corte.

## 9. Emoji

Hoje o app usa emoji como ícone em button toolbar (`index.html:103-129`,
`index.html:281-302`, `index.html:388-399`, `js/modules.js:1943`, `2238`,
`2254`). Eles **funcionam** e o usuário reconhece. Ao adicionarem:

- `aria-hidden="true"` no emoji, `aria-label` no botão
- emoji decorativo **nunca** sozinho como única informação
- se migrar para ícone SVG (Lucide, ISC), migre a lista inteira — mistura de
  emoji e SVG fica inconsistente

## 10. Antes de dar por pronto

- [ ] Nenhum hex solto fora de `:root`/tema
- [ ] Contraste AA nos **dois** temas, no texto pequeno
- [ ] Foco visível em todo controle focável, inclusive os que só aparecem no hover
- [ ] Nada quebra com as 8 cores de acento
- [ ] Testado em 375px, 768px e 1440px
- [ ] `prefers-reduced-motion` respeitado
- [ ] Impressão não corta nada
- [ ] `@media print` não depende de recurso de tela
