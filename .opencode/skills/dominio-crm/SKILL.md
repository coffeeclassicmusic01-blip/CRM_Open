---
name: dominio-crm
description: Use ao mexer em proposta, documento de serviço, cliente, parceiro, comissão, revisão de orçamento ou dashboard do Georevest Studio. Explica o modelo mental, os estados possíveis de um registro, as regras que não podem quebrar e as armadilhas já mapeadas. Aciona em "proposta", "orçamento", "cliente", "parceiro", "comissão", "revisão", "pipeline", "dashboard", "vencimento", "atraso", "layout", "bloco".
---

# Domínio do CRM Georevest

Empresa de engenharia geotécnica em Atibaia-SP. O serviço é
impermeabilização de reservatório (manta engeneirada ATO 800 etc.). Dois
usuários, uso em campo, offline. Um erro de dinheiro é o pior bug possível.

---

## 1. Modelo mental

```
CLIENTE  ──┬── PROPOSTA ──┬── LAYOUT (blocos)
           │              ├── PARCEIROS[] (papel + comissão)
           │              └── REVISÕES[] (histórico de valores)
           │
           └── DOCUMENTO (nota de serviço / comprovante interno)
                  ├── status: rascunho | emitida | cancelada | devolvida | custom
                  ├── pagamento: pendente | parcial | pago | (não gera financeiro)
                  └── vem de um MODELO (produto | remessa | serviço | custom)
```

**Chaves de storage** (não mude, quebra dado salvo):
- `georevest-studio-v1` — base
- `georevest-editor-current` — proposta ativa
- `georevest-backups-v1` — histórico (20 entradas, deepcopy completo)

---

## 2. Estados — e o que cada um bloqueia

| Status do documento | Pode editar itens? | Pode excluir? | Entra no financeiro? |
|---|---|---|---|
| Rascunho | sim | sim | sim |
| Emitida | **não** | **não** | sim |
| Cancelada | não | não | **não** |
| Devolvida | não | não | não |
| Pagamento `nofin` | — | — | **não** |

Hoje o app **não** respeita quase nada disso: `openInvoiceForm`
(`js/modules.js:1013-1044`) não trava nada e `deleteInvoiceById` (`1261-1270`)
nunca checa status — enquanto `deleteProposal` (`js/data.js:536-537`) recusa
quando há nota emitida. O rastro pode ser reescrito depois da emissão. O
`crm-ux` está consertando.

**Decisão do usuário:** o documento é **interno**, não NF-e. Não há SEFAZ,
chave de acesso, série, NCM, CST nem protocolo. Printable com disclaimer
obrigatório: *"Documento interno de comprovação. Não substitui Nota Fiscal
Eletrônica e não possui valor fiscal."* (`CRE_FISCAL.taxDisclaimer()`).

---

## 3. Comissão de parceiro

Quatro papéis (`js/data.js:27-32`):

| Papel | Rótulo | Uso típico |
|---|---|---|
| `commercial` | Indicador / Comercial | indicação de síndico, RT |
| `technical` | Executor Técnico | equipe, aplicação |
| `cobranding` | Parceria Estratégica | co-branding |
| `supplier` | Fornecedor Homologado | material |

Comissão é `commissionType` `percent` (do total da proposta) ou valor fixo.
`getPartnerCommissionSummary` (`js/data.js:570-595`) é a implementação
**canônica** — a UI recalcula inline em `js/modules.js:2304-2305` e as duas
já divergiram. Sempre consuma a função única.

`deletePartner` (`js/data.js:485-488`) não limpa `p.partners`: a comissão
fica apontando para parceiro inexistente e a UI degrada para "Parceiro".
Desfaça o vínculo com confirmação e **preserve o snapshot da comissão** — o
histórico financeiro não pode sumir.

---

## 4. Revisão de orçamento

`js/editor.js:246-330`. Quando a proposta é aprovada, as tabelas comerciais
travam (`rev-banner`, `index.html:452-459`). Alterar valor gera revisão
nova.

- `commercialFingerprint` (`252`) detecta mudança no conteúdo comercial
- `revisionRecord` (`285`) cria o registro
- `capRevisions` (`275-283`) limita o histórico — **está com bug**: fatia com
  índice negativo (colapsa a 0) e o teto real é `max * 2` = 50 snapshots de
  layout completo. Cap por contagem; acima de um limite, guarde metadados.
- `restoreRevision` (`618`) e `duplicateRevision` (`358`) reescrevem o
  layout atual

Trilha de revisão é documento que o cliente pode pedir. Não pode ser
silenciosamente sobrescrita.

---

## 5. Dashboard — semântica de cada número

`js/modules.js:133-305`.

| Card | O que é | O que está errado hoje |
|---|---|---|
| Faturado | soma de notas **emitidas** | inclui `nofin` (`183-187`) |
| A Receber | emitido − pago | não desconta valor parcial |
| Recebido | soma do que foi pago | não há `paidAmount` no modelo, então `partial` soma 0 |
| Faturas Atrasadas | vence antes de hoje e não pago | `overdue` é campo **manual** (`1072-1074`), nunca derivado de `dueDate` → marca zero sempre |
| Pipeline | propostas por status | ok |

Use `CRE_FISCAL.isOverdue(nf, refDate)`. Sem campo `paidAmount`, o card
"Recebido" é matematicamente errado — reporte ao `dados-armazenamento` se
precisar do campo.

Período (`dashPeriodTabs`, `index.html:88-94`): mês / 3m / 6m / 12m / tudo.

---

## 6. Proposta e layout

- Proposta = `layout` com **blocos** (`js/editor.js` renderiza). Tipos:
  `cover`, `commercial`, `technical`, `obligations`, `clients`, `closing`,
  `extras`, `gallery`, `custom`.
- `proposalTotal` (`js/app.js:214-227`) varre blocos `commercial` **e**
  `extras` (linha `222-224`).
- `collectProposalItems` (`js/modules.js:902-928`) só varre `commercial`.
  → o pré-preenchimento da nota usa um total e o save recalcula por outro;
  o valor das extras **desaparece** ao salvar. Derive os dois da mesma
  função.
- `defaultLayout()` é o template de toda proposta nova. Hoje injeta cliente,
  telefone e engenharia reais + data fixa + preço hardcoded. **Decisão do
  usuário: remover o seed, manter a coluna `Valor` como texto livre.**

---

## 7. Armadilhas já mapeadas (não repita)

| Local | Armadilha |
|---|---|
| `js/app.js:161` | `parseBRL` erra em 10x (`"3.5"`→`35`). Use `CRE_FISCAL.parseMoney`. |
| `js/app.js:161` | `save()` engole `QuotaExceededError` (`js/data.js:337`) e a UI reporta sucesso |
| `js/modules.js:1538` | rótulo de status sem `esc()` em `document.write` → **XSS armazenado** com acesso a todo o `localStorage` |
| `js/data.js:380` | restaurar backup não recarrega o editor → o próximo autosave sobrescreve o restaurado |
| `js/data.js:268` | sem listener de `storage` → duas abas sobrescrevem uma a outra |
| `js/data.js:429` | `deleteClient` põe `clientId = ''` e deixa proposta órfã com capa antiga |
| `js/data.js:720` | `deleteInvoiceModel` não checa uso → perde a seção "Dados da operação" na impressão |
| `js/data.js:747` | unicidade de status checa **label**, mas a chave é slug → colisão |
| `js/modules.js:1198` | `geraFinanceiro` vem do dropdown de pagamento, não do modelo |
| `js/editor.js:4012` | WhatsApp cai no número fixo `551141174417` sem telefone do cliente |
| `js/modules.js:1854` | `readItemsFromDom` duplica `1230-1237` e nunca é chamada |
| `js/editor.js:3630` | "Novo layout padrão" apaga o layout sem revisão prévia |
| `js/editor.js:1083` | `<a>` sem `href` no rodapé do documento |
| `css/main.css:2460` | `.page` com `overflow: hidden` → conteúdo longo **desaparece na impressão** |

---

## 8. Antes de mexer em regra de negócio

- [ ] Entendi qual card do dashboard ou qual tela é afetado
- [ ] Sei se a regra envolve **dinheiro** (se sim, teste com 3 casos: zero,
      parcial, total)
- [ ] Verifiquei se o dado é real do usuário ou semente — semente nunca entra
      em proposta nova
- [ ] Confirmei que não quebrei o fluxo: cliente → proposta → documento →
      imprimir
- [ ] Se alterei schema do `localStorage`, avisei o orquestrador antes
