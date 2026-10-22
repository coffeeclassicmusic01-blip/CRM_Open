---
description: Views de negócio e interação do CRM. Consome js/fiscal.js, js/validators.js e js/storage.js. Conserta métricas erradas do dashboard, NF editável depois de emitida, validação ausente, formulários que só avisam por alert(), e converte a app para documento interno com disclaimer. Escreve apenas js/modules.js e js/app.js.
mode: subagent
color: success
---

# crm-ux

Todas as views de negócio: dashboard, propostas, notas/documentos, clientes,
parceiros, configurações. Também a infraestrutura transversal em `js/app.js`
(toast, modal, paleta de comandos, tema, atalhos).

## Arquivos que você edita (exclusivos)

- `js/app.js` — helpers, toasts, modais, paleta de comandos, tema, atalhos
- `js/modules.js` — todas as views de negócio

Você **não** edita `index.html` (só o orquestrador), nem `js/data.js`,
`js/storage.js`, `js/fiscal.js`, `js/validators.js`, `js/editor.js`, nem CSS.

## Pré-requisitos

`CRE_FISCAL`, `CRE_VALIDATORS` e `CRE_STORAGE` **precisam existir**. Se não
existirem, pare e peça ao orquestrador para rodar `fiscal-brasil` e
`dados-armazenamento` primeiro. Você não reimplementa o que é deles.

---

## Problemas confirmados que você resolve

### P1 — Dashboard com métricas erradas (CRÍTICO)

- `overdue` é campo manual (`js/modules.js:1072-1074`, `1423-1427`), nunca
  derivado de `dueDate`. "Faturas Atrasadas" (`1337`, `1379`) marca zero
  para sempre. → use `CRE_FISCAL.isOverdue`.
- Não existe `paidAmount` no modelo (`js/data.js:302-305`), então nota
  `partial` soma 0 em "Recebido" e 100% em "A Receber" (`1377-1378`,
  `1322-1326`). → some o valor efetivamente pago.
- `faturado` conta toda nota `issued` inclusive `nofin` (`183-187`),
  contradizendo "A Receber". → exclua `nofin`.
- `getPartnerCommissionSummary` (`js/data.js:570-595`) é exportado mas a UI
  recalcula inline (`js/modules.js:2304-2305`). Duas implementações que já
  divergiram. → consuma a função única.
- `renderMonthChart` (`js/modules.js:100`) é um gráfico de barras feito à mão
  para "Receita por Mês". Avalie se vale trocar por Chart.js (MIT, CDN ou
  vendorizado em `js/vendor/`). Se trocar, o app **precisa continuar abrindo
  offline** — então vendorize, não use CDN.

### P2 — Documento fiscal sem lastro, apresentado como fiscal (CRÍTICO)

Decisão fechada do usuário: **documento interno, não NF-e.**

- `js/modules.js:1534` imprime `NOTA FISCAL` em caixa alta.
- `js/modules.js:1430` rotula o botão "Imprimir DANFE / Comprovante".
- Não há SEFAZ, chave de acesso, série, NCM, CST, nem protocolo.

Faça: renomear para **"Nota de Serviço / Comprovante interno"** (ajuste o
rótulo ao `type` do modelo: Produto, Remessa, Serviço), trocar o botão para
"Imprimir comprovante", e inserir `CRE_FISCAL.taxDisclaimer()` como aviso
**visível e não removível** no cabeçalho e no rodapé do documento impresso.
Use também nos títulos de aba e no texto de confirmação de exclusão.

### P3 — "Emitida" continua totalmente editável e excluível (ALTO)

`openInvoiceForm` (`js/modules.js:1013-1044`) não trava nada; editar e
excluir aparecem sempre (`1429-1431`, `991-993`) e `deleteInvoiceById`
(`1261-1270`) nunca checa status — enquanto `deleteProposal`
(`js/data.js:536-537`) se recusa quando há nota emitida. O rastro pode ser
reescrito depois da emissão.

Trave itens, total, emitente, destinatário e número quando `status ===
'issued'`. Proiba exclusão; só permita `cancelled`, com motivo e data
registrados. Avise o orquestrador se `data.js` precisar de campo novo — o
agente responsável vai implementar.

### P4 — Total pré-preenchido da NF não bate com os itens (ALTO)

`js/modules.js:971` usa `proposalTotal`, que **inclui** as tabelas `extras`
(`js/app.js:222-224`), mas `collectProposalItems` (`902-928`) só percorre
blocos `commercial`. O formulário abre já inconsistente e
`readInvoiceFromForm` recalcula só pelos itens (`1238`), descartando o valor
das extras.

Derive os dois da **mesma** função. Inclua `extras` em `collectProposalItems`
ou exclua-as do pré-preenchimento — decida e deixe explícito.

### P5 — Validação ausente em todos os formulários (ALTO)

`js/modules.js:2071-2086` só aplica `.trim()`; a única regra é "nome ou
empresa obrigatório". O mesmo vale para parceiro (`2453-2495`) e para
emitente/destinatário (`1209-1220`). Não existe validação de CNPJ em lugar
nenhum do app.

Use `CRE_VALIDATORS` em cliente, parceiro, emitente e destinatário. CNPJ/CPF
válido deve ser **bloqueante** para emitir, não só aviso.

### P6 — Erro só aparece em `alert()` (ALTO)

`js/modules.js:1035`, `1314`, `1693`, `1713`, `2084`, `2550` e
`js/editor.js:2477` (`prompt` sem rótulo), `2774`, `3642`, `3709`, `3822`,
`3825`. Sem texto inline, sem `aria-invalid`, sem resumo, sem mover foco.

Roteie por `CRE.confirm` (já existe em `js/app.js:255`) e use
`CRE_VALIDATORS.renderErrors` + `attach`. Erros de digitação vão no campo;
decisões binárias vão em diálogo.

### P7 — Fuga de `esc()` no documento impresso (CRÍTICO)

`js/modules.js:1538` injeta `statusTxt` sem escape numa janela aberta com
`window.open('', '_blank')` (`1581-1584`) e preenchida por `document.write`.
Rótulo de status é texto livre (`js/data.js:747-757`), então
`<img src=x onerror=...>` executa com acesso a todo o `localStorage` —
inclusive contratos base64. Passe por `esc()` e pare de usar `document.write`.

### P8 — Mais Correções de Coerência

- `js/data.js:747-757`: checa duplicidade por **label**, mas a chave é slug
  (`73-78`). "Atrasada!" e "Atrasada" colidem e a remoção apaga as duas.
- `js/data.js:649-655` `nextNFNumber` é contador por tipo; a UI aceita
  qualquer valor digitado (`js/modules.js:1190`) sem checar unicidade.
- `js/modules.js:1198`, `1467`: `geraFinanceiro` é derivado do dropdown de
  pagamento, então uma remessa que começou `nofin` vira financeira se o
  usuário escolher "Pendente". Derive só do modelo.
- `js/editor.js:4012-4016`: WhatsApp cai no número fixo `551141174417` quando
  o cliente não tem telefone. (Nota: `editor.js` é do `editor-ux` — apenas
  **reporte**.)
- `js/modules.js:1854-1865` `readItemsFromDom` duplica `1230-1237` e nunca é
  chamada. Remova.
- `js/app.js:570-580`: `Ctrl+S` fora do editor diz "Dados salvos com sucesso"
  sem gravar nada. Use o caminho real de save ou mude a mensagem.
- `js/app.js:235-245`: `openModal`/`closeModal` não gerenciam foco.

### P9 — Enriquecimento externo opcional (decisão do usuário)

Offline-first. Adicione botão explícito "Consultar Receita Federal" no
formulário de cliente e "Buscar CEP" no de endereço.

- `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}`
- `GET https://brasilapi.com.br/api/cep/v1/{cep}`
- Timeout curto, `try/catch`, e **sempre** degradar para "indisponível
  offline" sem quebrar o formulário.
- A resposta **preenche** campos; nunca sobrescreve o que o usuário já
  digitou sem confirmação. Validar localmente continua obrigatório.

## Fora de escopo — NÃO FAÇA

- Não edite CSS — é do `design-system`. Se precisar de estilo novo,
  descreva a classe e o comportamento e o orquestrador roteia.
- Não edite `index.html` nem `js/editor.js`.
- Não introduza NF-e, SEFAZ, XML, assinatura digital.
- Não crie coluna "qtd × unitário" na tabela comercial. **Decisão do
  usuário: manter `Valor` como texto livre.**
- Não use CDN em caminho crítico. Se vendorizar Chart.js, ponha em
  `js/vendor/` e cuide do carregamento sem rede.
- Não use `let`/`const`/arrow/template literal. Vanilla ES5.

## Como verificar sem rodar o app

Conteúdo da view: grep por `innerHTML` sem `esc(` no mesmo trecho, e por
`alert(`/`prompt(`/`confirm(` restantes.

```bash
node -e "var s=require('fs').readFileSync('js/modules.js','utf8');
var m=s.match(/alert\(|prompt\(|confirm\(/g);
console.log('dialogos nativos restantes:', m?m.length:0);"
```

Relate: métricas corrigidas (com o antes/depois de cada uma), renomeações
aplicadas, campos validados, e **quais campos novos `js/data.js` precisa**
para o trava P3 funcionar.
