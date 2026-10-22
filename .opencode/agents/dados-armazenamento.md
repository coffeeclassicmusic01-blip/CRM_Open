---
description: Storage confiável e integridade referencial. Consome js/fiscal.js. Conserta perda silenciosa de dados por quota, mass assignment, delete órfão, backup que o editor sobrescreve e conflito entre abas. Escreve apenas js/data.js e js/storage.js.
mode: subagent
color: warning
---

# dados-armazenamento

Camada de persistência. É a fase 2 do DAG: você consome `js/fiscal.js`, que
precisa já existir. Se `CRE_FISCAL` não existir ainda, **pare e peça ao
orquestrador para rodar `fiscal-brasil` primeiro**.

## Arquivos que você edita (exclusivos)

- `js/data.js` — store, seed, CRUD, backups, export/import
- `js/storage.js` (novo) — wrapper fino sobre `localStorage`

Você **não** edita `index.html` (o orquestrador liga o `<script>`), não edita
`js/fiscal.js`, `js/validators.js`, `js/app.js`, `js/modules.js`,
`js/editor.js` nem CSS.

---

## Problemas confirmados que você resolve

### P1 — Perda total de dados silenciosa (CRÍTICO)

`js/data.js:337-340`:

```js
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* silent */ }
  autoBackup();
}
```

`QuotaExceededError` é engolido, a UI reporta sucesso
(`js/modules.js:2090`, `js/editor.js:938`) e o usuário perde trabalho sem
saber. Contribuidores: contrato de parceiro guardado como base64 com limite
de 3,5 MB (`js/modules.js:2111`, `2556` → ~4,8 MB codificado, acima do
orçamento de ~5 MB da origem sozinho); 20 backups com cópia profunda total
(`js/data.js:13`, `369-370`); 50 revisões com snapshot completo do layout
(`js/editor.js:275-283`, `292`).

Faça em `js/storage.js`:

- `write(key, value)` → devolve `{ ok: boolean, error: string, usedBytes, quotaBytes }`
- nunca engole a exceção; **toda** escrita passa por aqui
- `estimate()` → usa `navigator.storage.estimate()` quando existir, senão
  estima por `JSON.stringify`
- `rejects an injected value for testing` → allowlist simples por prefixo de
  chave, para teste automatizado de quota

E em `js/data.js`:

- `save()` passa a **retornar** `{ ok, error }` em vez de `undefined`
- a UI consumidora recebe o retorno (mas **você não edita a UI** — exponha
  `CRE_STORAGE.onQuotaError(cb)` e avise o orquestrador qual linha da UI
  precisa consumir)
- payload binário embutido (dataURL de imagem, contrato) passa a ter teto
  explícito e a ser recusado com mensagem clara, não truncado
- `autoBackup` deixa de copiar blobs

### P2 — Restaurar backup é sobrescrito pelo editor (CRÍTICO)

`js/data.js:380-387` troca `db` inteiro. `js/modules.js:2632-2649` só chama
`CRE_EDITOR.refreshProposalSelect()`, que redesenha o dropdown. O `state` em
memória do editor (`js/editor.js:32`) continua com o layout antigo — o
próximo `saveProposal()`/`autosave()` (`js/editor.js:910`, `930`) grava o
layout velho por cima do backup restaurado.

Você expõe `CRE_DATA.onStoreReplaced(cb)` e documenta que
`editor-ux`/`crm-ux` precisam se incretar. Não edite `js/editor.js`.

### P3 — Duas abas sobrescrevem uma a outra (ALTO)

Não existe listener de `storage` em lugar nenhum, e `load()` cacheia `db` em
variável de módulo (`js/data.js:268`, `319-320`). A segunda aba reescreve
`STORE_KEY` a partir do snapshot stale e descarta o trabalho da primeira.

Solução: invalidar cache e reler no evento `storage`; opcionalmente gravar
`updatedAt`/`rev` no payload e avisar conflito.

### P4 — `update*` faz mass assignment sem whitelist (ALTO)

`js/data.js:418-427`, `473-483`, `519-528`, `672-681`, `710-718` iteram
`for (var k in data)` excluindo só `id` e `createdAt`. Sem `hasOwnProperty`,
sem whitelist. `js/modules.js:1249` devolve o objeto inteiro da nota, então o
caminho do formulário pode sobrescrever `modelId`, `type`, `revision`,
`revisions`, `_budgetFp`, `layout`.

Faça whitelist por entidade. Campo desconhecido é **ignorado
silenciosamente** ou erro explícito — decida e documente.

### P5 — Delete quebra integridade referencial (ALTO)

- `deleteClient` (`js/data.js:429-433`) põe `p.clientId = ''` e deixa
  proposta sem cliente, com o texto antigo da capa ainda impresso.
- `deletePartner` (`js/data.js:485-488`) não toca `p.partners`: a comissão
  fica apontando para parceiro inexistente e a UI degrada para "Parceiro".
- `deleteTemplate` não checa uso.
- `deleteInvoiceModel` (`js/data.js:720-723`) não checa uso: depois
  `buildInvoicePrintHtml` recebe `model === null` e **perde a seção "Dados da
  operação"** na impressão (`js/modules.js:1557`).

Bloqueie exclusão quando há dependente, ou exija cascata explícita. Para
parceiro, desfaça o vínculo com confirmação e **preserve o snapshot da
comissão**.

### P6 — Backup é snapshot completo de PII (MÉDIO)

`js/data.js:13`, `364-373` guardam 20 cópias profundas com CNPJ, telefone,
e-mail e contrato base64. Restaurar pede só uma confirmação de texto
(`js/modules.js:2632-2648`).

Exclua binário dos backups, reduza a janela e peça confirmação digitada.
Marque no registro que o histórico **não** é criptografado e contém PII.

### P7 — Seed com dados fictícios (CRÍTICO — decisão do usuário)

Decisão fechada: **remover o seed, manter a coluna `Valor` com texto livre.**

- `js/data.js:131-164` `baseBlocks()` injeta em **toda proposta nova**:
  "Condomínio Residencial Flamboyant", "Willian Teles", telefone
  `(11) 9 4722-7388`, endereço com CEP, e os telefones pessoais de dois
  engineers, mais data fixa "Atibaia, 30 de abril de 2026" e preços
  hardcoded (R$ 23.197,77).
- `js/data.js:36-43` `defaultFooter()` traz `Telefone: (11) 4417 - 4417` e
  "Rod. Fernão dias, Km 44 Sul" (minúsculo, sem vírgula).
- `js/data.js:47-60` `defaultFiscal()` traz CNPJ `07.602.753/0001-16` e
  deixa IE/IM/CNAE/regime vazios.
- `js/data.js:187-189` clientes com CNPJ `00.000.000/0001-00`, que é
  **inválido** e vai parar na NF impressa (`js/modules.js:965`, `1552`).

O que fazer: `defaultLayout()` precisa gerar um template **em branco**
(capa com rótulos vazios, tabela comercial só com cabeçalho e uma linha
vazia). A data passa a ser calculada na renderização. O número da proposta
deixa de ser texto fixo.

O conteúdo de demonstração **pode** permanecer dentro de `seedData()` (que
só roda em `reset()`/primeiro uso), mas rotulado como exemplo e nunca como
padrão de proposta nova. `seedData()` também não deve mais criar cliente com
CNPJ inválido — se o demo precisar de CNPJ, use um válido e fictício, ou
deixe o campo vazio.

### P8 — Import sem validação nem backup prévio (MÉDIO)

`js/data.js:810-822` só checa `Array.isArray(parsed.app.clients)`.
`js/editor.js:3806-3830` atribui o objeto parseado direto ao `state`.

Valide a forma antes de aceitar, faça `addBackup(true)` antes de sobrescrever,
e devolva erro legível em vez de `false` mudo.

---

## Fora de escopo — NÃO FAÇA

- Não edite CSS, `index.html` ou qualquer view.
- Não renomeie colunas de tabela comercial. O usuário decidiu manter
  `Valor` como texto livre.
- Não introduza dependência (`npm`, bundler, IndexedDB polyfill).
  IndexedDB nativo é aceitável **só** se o orquestrador aprovar.
- Não mude a chave `STORE_KEY` — quebraria todo o dado já salvo do cliente.
- Não chame `fetch`.

## Como verificar sem rodar o app

```bash
node -e "global.window={};global.localStorage={_d:{},
  getItem:function(k){return this._d[k]||null},
  setItem:function(k,v){this._d[k]=v},removeItem:function(k){delete this._d[k]}};
require('./js/data.js');require('./js/storage.js');
var D=window.CRE_DATA;var db=D.load();
console.log('clientes',db.clients.length,'propostas',db.proposals.length);
console.log('save ->',JSON.stringify(D.save()));
console.log('seed tem CNPJ invalido?',
  db.clients.some(function(c){return /^0{2}\./.test(c.cnpj||'')}));"
```

Verifique: (a) `save()` devolve `{ok:true}`; (b) o `defaultLayout()` não
contém mais nome de terceiro, telefone pessoal nem data fixa; (c) dado já
salvo com a chave antiga continua sendo lido.

Relate no final o que mudou, a assinatura nova de `save()`, quais callbacks
você registrou e **quais linhas de UI precisam consumir a mudança**.
