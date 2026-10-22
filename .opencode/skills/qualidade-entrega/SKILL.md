---
name: qualidade-entrega
description: Use antes de declarar qualquer tarefa do Georevest Studio concluída, e sempre que o qa-verificador rodar. Contém o checklist funcional, as varreduras estáticas sem dependência, a matriz de propriedade de arquivos e o procedimento de rollback. Aciona em "terminei", "pronto", "revise", "confere", "checklist", "teste", "qualidade", "verificar", "entregar".
---

# Qualidade de entrega — Georevest Studio

O app abre com **duplo clique** em `index.html`. Sem servidor, sem build, sem
`npm`. Se você introduziu dependência, quebrou isso.

---

## 1. Matriz de propriedade (fim de conflito)

Cada arquivo tem **exatamente um dono**. Se dois agentes mexeram no mesmo
arquivo na mesma rodada, isso é conflito e a rodada é inválida.

| Arquivo | Dono |
|---|---|
| `index.html` | `acessibilidade` |
| `css/main.css`, `css/tokens.css` | `design-system` |
| `css/a11y.css` | `acessibilidade` |
| `js/data.js`, `js/storage.js` | `dados-armazenamento` |
| `js/fiscal.js`, `js/validators.js` | `fiscal-brasil` |
| `js/app.js`, `js/modules.js` | `crm-ux` |
| `js/editor.js` | `editor-ux` |
| qualquer novo arquivo | `orquestrador` |

**Zonas reservadas do `index.html`** — só o orquestrador escreve:

- `<head>` completo (linhas 1–11): `<link>` de CSS e `<meta>`
- `<script>` no fim do `<body>` (linhas 700–703)

Ninguém mais insere tag de script ou link. Especialista **reporta** a tag
exata que precisa; não insere.

---

## 2. Checklist funcional (o usuário roda, o agente orienta)

O agente **não tem browser**. Marque o que não é verificável por inspeção
estática e entregue ao usuário.

### Abrir e não quebrar nada
- [ ] Duplo clique em `index.html` abre sem erro no console
- [ ] Dado já no `localStorage` (chave `georevest-studio-v1`) continua
      sendo lido — **nenhuma perda**
- [ ] Nenhum `fetch()` no caminho crítico (app funciona com rede desligada)
- [ ] Nenhuma mudança em `STORE_KEY`

### Fluxo completo
- [ ] Criar cliente → criar proposta → emitir documento → imprimir
- [ ] Abrir proposta existente, editar bloco, salvar, recarregar: persistiu
- [ ] Restaurar backup → o editor **não** sobrescreve o que foi restaurado
- [ ] Duas abas abertas não se sobrescrevem

### Atalhos
- [ ] `Ctrl+S` salva (e não mente quando não salvou)
- [ ] `Ctrl+K` abre a paleta, setas navegam, `Esc` fecha
- [ ] `Esc` fecha modal e devolve o foco a quem abriu
- [ ] `?` abre a lista de atalhos
- [ ] Reordenar bloco da proposta funciona **por teclado** (`Alt+↑`/`Alt+↓`)

### Impressão — falha de negócio, não de estilo
- [ ] Nada é cortado: proposta longa pagina e repete cabeçalho/rodapé
- [ ] Tabela comercial não quebra ao meio
- [ ] O disclaimer "sem valor fiscal" aparece no documento impresso

### Dinheiro
- [ ] `parseMoney("3.5")` = 3.5, `("9.9")` = 9.9, `("2.700")` = 2700,
      `("1.234,56")` = 1234.56
- [ ] Total de proposta, total de nota e comissão batem entre si
- [ ] "Faturas Atrasadas" reflete vencimento real, não um campo manual

### Acessibilidade
- [ ] As 4 ações do dashboard são focáveis (Tab chega nelas)
- [ ] Foco visível em **todo** controle, inclusive os que só aparecem no hover
- [ ] Modal prende Tab e devolve foco ao fechar
- [ ] Nenhum `<div>` com `onclick` no fluxo principal
- [ ] Contraste AA nos dois temas

### Dados
- [ ] `CRE_DATA.save()` devolve `{ok, error}` — quota estourada aparece
- [ ] Proposta nova **não** vem com cliente, telefone ou preço de terceiro
- [ ] CNPJ/CPF inválido é barrado, inclusive `00.000.000/0001-00`

---

## 3. Varreduras estáticas (sem dependência)

```powershell
cd "C:/Users/OscarKameda/Documents/Pojetos Sistemas/CRE_Layout_004"

# Sintaxe — se falhar, o app inteiro quebra
node --check js/app.js; node --check js/data.js
node --check js/editor.js; node --check js/modules.js
foreach($f in @("js/fiscal.js","js/validators.js","js/storage.js")){
  if(Test-Path $f){ node --check $f } }

# ES5 obrigatório: nenhum destes pode aparecer
Select-String -Path js\*.js -Pattern "^\s*(let|const)\s+\w+\s*="
Select-String -Path js\*.js -Pattern "=>|\basync\s|\bawait\s|\.\.\."

# XSS
Select-String -Path js\*.js -Pattern "document\.write"
Select-String -Path js\*.js -Pattern "\+\s*\w*(name|label|title|text|status|note)\w*\s*\+" -CaseSensitive:$false

# Offline
Select-String -Path js\*.js -Pattern "fetch\(|XMLHttpRequest"

# Diálogos nativos (devem sumir)
Select-String -Path js\*.js -Pattern "\balert\(|\bprompt\(|\bconfirm\("

# Foco invisível
Select-String -Path css\*.css -Pattern "outline:\s*none"

# UTF-8 sem BOM
node -e "['index.html','css/main.css','js/app.js','js/data.js','js/editor.js','js/modules.js'].forEach(f=>{const b=require('fs').readFileSync(f);console.log(f,b[0]===0xEF?'BOM!':'ok')})"
```

**Bloqueiam a entrega:** erro de sintaxe; ES5 moderno; `document.write` novo;
`fetch` no caminho crítico; `outline: none` sem substituto; BOM.

---

## 4. Teste rápido das funções puras (sem browser)

```bash
node -e "global.window={};require('./js/fiscal.js');var F=window.CRE_FISCAL;
['07.602.753/0001-16','00.000.000/0001-00','11.222.333/0001-81']
  .forEach(function(v){console.log('cnpj',v,F.isValidCnpj(v))});
['3.5','9.9','2.700','1.234,56']
  .forEach(function(v){console.log('money',v,'->',F.parseMoney(v))});"
```

```bash
node -e "global.window={};
global.localStorage={_d:{},getItem:function(k){return this._d[k]||null},
setItem:function(k,v){this._d[k]=v},removeItem:function(k){delete this._d[k]}};
require('./js/data.js');var D=window.CRE_DATA;var db=D.load();
console.log('clientes',db.clients.length,'propostas',db.proposals.length);
console.log('save ->',JSON.stringify(D.save()));" 
```

`defaultLayout()` novo **não pode** conter nome de terceiro, telefone
pessoal nem data fixa.

---

## 5. Diff da rodada

```bash
git status --short
git diff --stat
```

Cada arquivo listado tem que mapear para **um** dono. Um arquivo em duas
listas = conflito: pare e divida o escopo, não a linha.

`js/editor.js` deve ter **zero** mudança quando a rodada é de
`dados-armazenamento`, `crm-ux` ou `design-system`. A auditoria citava
`js/editor.js:1319` e `js/editor.js:2725` — citar `arquivo:linha` é leitura,
não é edição.

---

## 6. Rollback

Sem branch e sem dependência, a rede de segurança é `git`:

```bash
git diff                 # revisar antes de descartar
git checkout -- js/data.js     # reverte um arquivo
git stash                       # guarda tudo sem commitar
```

Apaguei algo? `git checkout -- <arquivo>`. Se não havia commit, **não há
rollback** — working tree suja é o estado de risco. Commit antes de uma
fase grande.

---

## 7. Relatório de entrega

O agente entrega:

1. **O que mudou** — com `arquivo:linha`
2. **O que ficou de fora** — e qual fase destrava
3. **O que o usuário precisa testar** — a lista do §2 que não é verificável
   por inspeção estática
4. **Risco de migração** — se algum dado do `localStorage` muda de forma

Não despeje auditoria completa. O usuário pediu a tarefa, não o relatório.
