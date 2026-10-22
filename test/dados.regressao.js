/* Regressão de dados do Georevest Studio.
   Roda fora da árvore do app: `node test/dados.regressao.js`.
   Nada aqui é carregado pelo index.html.

   Carrega js/fiscal.js, js/storage.js e js/data.js num contexto simulado
   com localStorage falso (em memória) e prova:
     1. dado no formato ANTIGO continua sendo lido, campo a campo
     2. save() devolve ok:true no caminho normal
     3. save() devolve erro de quota e não mente
     4. conflito entre abas: cliente da aba A e orçamento da aba B sobrevivem
     5. import de backup no formato antigo funciona
     6. import com __proto__ não contamina objeto
   + teto do backup local, seed sem dado de terceiro e integridade. */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var RAIZ = path.join(__dirname, '..');
var KEY = 'georevest-studio-v1';

/* ── Contexto simulado ─────────────────────────────────────── */

function criarArmazenamento(opts) {
  opts = opts || {};
  var d = {};
  var quota = opts.quotaBytes || Infinity;
  var lancarQuota = opts.lancarQuota === true;
  var indisponivel = opts.indisponivel === true;
  var acessos = { set: 0, get: 0 };
  return {
    _d: d,
    _acessos: acessos,
    length: 0,
    _recontar: function () {
      var n = 0;
      for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) n++; }
      this.length = n;
    },
    key: function (i) {
      var ks = [];
      for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) ks.push(k); }
      return ks[i] === undefined ? null : ks[i];
    },
    getItem: function (k) {
      acessos.get += 1;
      if (indisponivel) throw new Error('SecurityError: acesso negado');
      return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null;
    },
    setItem: function (k, v) {
      acessos.set += 1;
      if (indisponivel) {
        var e = new Error('SecurityError');
        e.name = 'SecurityError';
        e.code = 18;
        throw e;
      }
      var anterior = Object.prototype.hasOwnProperty.call(d, k) ? d[k] : '';
      var usado = 0;
      for (var x in d) { if (Object.prototype.hasOwnProperty.call(d, x)) usado += utf8(d[x]); }
      if (this.lancarQuota === true) {
        var q = new Error('quota');
        q.name = 'QuotaExceededError';
        q.code = 22;
        throw q;
      }
      if (usado - utf8(anterior) + utf8(v) > quota) {
        var q2 = new Error('quota');
        q2.name = 'QuotaExceededError';
        q2.code = 22;
        throw q2;
      }
      d[k] = String(v);
      this._recontar();
    },
    removeItem: function (k) { delete d[k]; this._recontar(); }
  };
}

function utf8(s) { return Buffer.byteLength(String(s === null || s === undefined ? '' : s), 'utf8'); }

function novoContexto(storage) {
  var janela = {};
  janela.window = janela;
  janela.localStorage = storage;
  janela.navigator = { storage: {} };
  var ctx = vm.createContext(janela);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/fiscal.js'), 'utf8'), ctx, { filename: 'fiscal.js' });
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/storage.js'), 'utf8'), ctx, { filename: 'storage.js' });
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/data.js'), 'utf8'), ctx, { filename: 'data.js' });
  return janela;
}

/* ── Relato ───────────────────────────────────────────────── */

var falhas = 0;
var n = 0;
function ok(cond, msg, extra) {
  n += 1;
  if (cond) { console.log('   ok   ' + msg); return true; }
  falhas += 1;
  console.log('   FALHA ' + msg + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''));
  return false;
}
function titulo(t) { console.log('\n' + t); console.log('   ' + '-'.repeat(t.length)); }

/* ════════════════════════════════════════════════════════════
   1. Leitura do formato antigo, campo a campo
   ════════════════════════════════════════════════════════════ */

titulo('1. Dado no formato ANTIGO continua sendo lido (sem perda)');

/* Snapshot no formato exato do data.js anterior à rodada. */
var ANTIGO = {
  clients: [{
    id: 'cl_antigo_1', name: 'Maria de Teste', company: 'Obra LTDA', cnpj: '11.222.333/0001-81',
    phone: '(11) 3333-4444', email: 'maria@teste.com.br', address: 'Rua X, 1 - São Paulo/SP',
    notes: 'OBS', createdAt: '2026-01-05T10:00:00.000Z', updatedAt: '2026-02-05T10:00:00.000Z'
  }, {
    id: 'cl_antigo_2', name: 'João Antigo', company: '', cnpj: '00.000.000/0001-00',
    phone: '(11) 3000-0000', email: '', address: '', notes: '',
    createdAt: '2025-11-01T10:00:00.000Z', updatedAt: '2025-11-01T10:00:00.000Z'
  }],
  partners: [{
    id: 'pa_antigo_1', name: 'Parceiro Antigo', cnpj: '11.222.333/0002-62',
    address: 'Av. Y, 2', contacts: [{ id: 'pc_1', name: 'Contato', email: 'c@t.com', phones: [{ id: 'pp_1', number: '(11) 3222-3333' }] }],
    contract: null, createdAt: '2025-12-01T10:00:00.000Z', updatedAt: '2025-12-01T10:00:00.000Z'
  }],
  proposals: [{
    id: 'pr_antigo_1', name: 'Proposta Antiga', clientId: 'cl_antigo_1', status: 'sent',
    partners: [{ partnerId: 'pa_antigo_1', role: 'technical', commissionType: 'percent', commissionValue: 3, showOnProposal: true, notes: 'execução' }],
    layout: {
      blocks: [
        { id: 'b1', type: 'cover', label: 'Capa', data: { date: 'São Paulo, 5 de fevereiro de 2026', recipient: 'Obra LTDA', proposalNumber: 'N° 461422130-00', contactName: 'Contato: Maria de Teste', contactPhone: 'Telefone: (11) 3333-4444', address: 'Rua X, 1', georevestContacts: [{ name: 'Eng. Um', role: 'Coordenador', phone: '(11) 90000-0000', email: 'a@b.c' }] } },
        { id: 'b2', type: 'commercial', label: 'Proposta Comercial', data: { title: 'Proposta Comercial.', proposalNumber: 'Número da proposta: 461422130-00', description: 'descrição', cols: ['Item', 'Quantidade', 'Descrição', 'Valor'], rows: [['1', '1', 'Reservatório inferior', 'R$ 23.197,77'], ['2', '2', 'Reservatório superior', 'R$ 20.561,73']] } }
      ],
      footer: { line1: 'Telefone: (11) 4417 - 4417', line2: 'Rod. Fernão Dias', line3: 'www.georevest.com.br', headerImg: 'assets/header.jpg' },
      margins: { top: 0, right: 20, bottom: 0, left: 20 },
      paper: { size: 'A4', orientation: 'portrait' }
    },
    revisions: [{ rev: 2, date: '2026-02-01T12:00:00.000Z', total: 43759.5, status: 'sent', note: 'Alteração', layout: { blocks: [] } }],
    revision: 3, _budgetFp: 'fp-antigo',
    createdAt: '2026-01-06T10:00:00.000Z', updatedAt: '2026-02-06T10:00:00.000Z'
  }, {
    id: 'pr_antigo_2', name: 'Proposta Sem Cliente', clientId: 'cl_inexistente', status: 'draft',
    partners: [], layout: { blocks: [], footer: {}, margins: {}, paper: {} },
    createdAt: '2026-01-07T10:00:00.000Z', updatedAt: '2026-01-07T10:00:00.000Z'
  }],
  templates: [{ id: 'tm_antigo_1', name: 'Modelo Antigo', layout: { blocks: [], footer: {}, margins: {}, paper: {} }, createdAt: '2026-01-08T10:00:00.000Z' }],
  invoices: [{
    id: 'nf_antigo_1', number: '000001', status: 'issued', payment: 'pending',
    dueDate: '2026-03-10', paymentDate: '', issuedAt: '2026-02-10',
    proposalId: 'pr_antigo_1', clientId: 'cl_antigo_1', modelId: 'im_antigo_1', type: 'produto',
    geraFinanceiro: true,
    emitente: { razaoSocial: 'Georevest', cnpj: '07.602.753/0001-16', ie: '', im: '', endereco: 'Rua', cidade: 'SP', telefone: '', email: '' },
    destinatario: { razaoSocial: 'Obra LTDA', cnpj: '11.222.333/0001-81', ie: '', im: '', endereco: 'Rua X', telefone: '', email: '' },
    modelData: { naturezaOperacao: 'Venda de mercadoria' },
    items: [{ descricao: 'Manta', quantidade: '1', unidade: 'un', valor: 23197.77 }],
    total: 23197.77, observacoes: 'obs', referencia: 'REF-1',
    createdAt: '2026-02-10T10:00:00.000Z', updatedAt: '2026-02-10T10:00:00.000Z'
  }],
  invoiceModels: [{ id: 'im_antigo_1', name: 'Nota de Produto', type: 'produto', geraFinanceiro: true, fields: [{ key: 'naturezaOperacao', label: 'Natureza da operação', type: 'select', required: true, options: ['Venda de mercadoria'] }] }],
  nfSequence: { produto: 1 },
  config: {
    footer: { line1: 'Telefone: (11) 4417 - 4417', line2: 'Rod. Fernão Dias, Km 44 Sul, Atibaia - SP', line3: 'www.georevest.com.br', headerImg: 'assets/header.jpg' },
    fiscal: { razaoSocial: 'Georevest Engenharia Ltda.', cnpj: '07.602.753/0001-16', ie: '', im: '', cnae: '', regime: '', endereco: 'Rod. Fernão Dias', cidade: 'Atibaia - SP', telefone: '(11) 4417 - 4417', email: 'contato@georevest.com.br' },
    invoiceStatuses: [{ key: 'draft', label: 'Rascunho', locked: true }, { key: 'issued', label: 'Emitida', locked: true }, { key: 'cancelled', label: 'Cancelada', locked: true }, { key: 'returned', label: 'Devolvida', locked: true }],
    company: 'Georevest Engenharia Ltda.',
    monthlyGoal: 50000
  },
  activeProposalId: 'pr_antigo_1'
};

var st1 = criarArmazenamento();
st1._d[KEY] = JSON.stringify(ANTIGO);
var w1 = novoContexto(st1);
var D1 = w1.CRE_DATA;
var db1 = D1.load();

/* Comparação campo a campo contra o snapshot original. */
function percorrer(origem, alvo, caminho, divergencias, profundidade) {
  if (profundidade > 12) return;
  if (origem === null || origem === undefined) {
    if (alvo !== null && alvo !== undefined && typeof origem !== typeof alvo) divergencias.push(caminho + ': ' + JSON.stringify(alvo));
    return;
  }
  if (typeof origem === 'string' || typeof origem === 'number' || typeof origem === 'boolean') {
    if (origem !== alvo) divergencias.push(caminho + ': esperado ' + JSON.stringify(origem) + ', veio ' + JSON.stringify(alvo));
    return;
  }
  if (Array.isArray(origem)) {
    if (!Array.isArray(alvo)) { divergencias.push(caminho + ': esperado lista, veio ' + typeof alvo); return; }
    if (origem.length !== alvo.length) { divergencias.push(caminho + ': tamanho ' + origem.length + ' != ' + alvo.length); return; }
    for (var i = 0; i < origem.length; i++) percorrer(origem[i], alvo[i], caminho + '[' + i + ']', divergencias, profundidade + 1);
    return;
  }
  if (typeof origem === 'object') {
    if (alvo === null || typeof alvo !== 'object') { divergencias.push(caminho + ': esperado objeto, veio ' + JSON.stringify(alvo)); return; }
    for (var k in origem) {
      if (!Object.prototype.hasOwnProperty.call(origem, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(alvo, k)) { divergencias.push(caminho + '.' + k + ': AUSENTE'); continue; }
      percorrer(origem[k], alvo[k], caminho + '.' + k, divergencias, profundidade + 1);
    }
    return;
  }
}

var divergencias = [];
percorrer(ANTIGO.clients, db1.clients, 'clients', divergencias, 0);
percorrer(ANTIGO.partners, db1.partners, 'partners', divergencias, 0);
percorrer(ANTIGO.proposals, db1.proposals, 'proposals', divergencias, 0);
percorrer(ANTIGO.templates, db1.templates, 'templates', divergencias, 0);
percorrer(ANTIGO.invoices, db1.invoices, 'invoices', divergencias, 0);
percorrer(ANTIGO.invoiceModels, db1.invoiceModels, 'invoiceModels', divergencias, 0);
percorrer(ANTIGO.nfSequence, db1.nfSequence, 'nfSequence', divergencias, 0);
percorrer(ANTIGO.config, db1.config, 'config', divergencias, 0);

ok(divergencias.length === 1 && divergencias[0].indexOf('proposals[1].clientId') === 0,
  'nenhum campo do snapshot antigo mudou (exceto a referência órfã, ver abaixo)', divergencias);
ok(db1.clients.length === 2 && db1.proposals.length === 2 && db1.invoices.length === 1 &&
  db1.partners.length === 1 && db1.templates.length === 1, 'todas as coleções preservadas');
ok(db1.proposals[0].layout.blocks[1].data.rows[0][3] === 'R$ 23.197,77', 'layout aninhado e coluna Valor intactos');
ok(db1.proposals[0]._budgetFp === 'fp-antigo' && db1.proposals[0].revision === 3 &&
  db1.proposals[0].revisions.length === 1, 'campos internos do editor (revision/revisions/_budgetFp) preservados');
ok(db1.activeProposalId === 'pr_antigo_1', 'activeProposalId preservado');
ok(db1.config.monthlyGoal === 50000 && db1.config.footer.line1.indexOf('4417') !== -1,
  'config do usuário preservada (rodapé e meta do mês)');
ok(D1.getInvoice('nf_antigo_1').modelData.naturezaOperacao === 'Venda de mercadoria', 'modelData da nota preservado');
ok(D1.getPartnerCommissionSummary('pa_antigo_1').count === 1, 'API de comissão continua funcionando sobre o dado antigo');

/* Saneamento (não destruição): referência órfã vira null com aviso. */
var orfa = D1.getProposal('pr_antigo_2');
ok(orfa && orfa.clientId === null, 'proposta com clientId inexistente teve o vínculo removido em vez de virar objeto fantasma');
ok(D1.avisos().some(function (a) { return a.tipo === 'ref-orfa'; }), 'a referência órfã ficou registrada em CRE_DATA.avisos()');
ok(D1.findClient('cl_inexistente') === null, 'nenhum cliente fantasma foi criado');

/* CNPJ inválido é sinalizado, não apagado. */
ok(!!db1.clients[1].cnpj, 'cliente com CNPJ inválido continua na lista');
ok(D1.avisos().some(function (a) { return a.tipo === 'cnpj'; }), 'CNPJ inválido sinalizado em CRE_DATA.avisos()');

/* Carimbo de revisão nasce sem quebrar dado legado. */
ok(db1.__meta && typeof db1.__meta.rev === 'number', 'carimbo __meta.rev criado na migração');
ok(st1._d[KEY].indexOf('"__proto__"') === -1, 'nenhum __proto__ no dado gravado');

/* ════════════════════════════════════════════════════════════
   2. save() devolve ok:true
   ════════════════════════════════════════════════════════════ */

titulo('2. save() devolve { ok: true } no caminho normal');

var r2 = D1.save();
ok(r2.ok === true, 'save() devolve ok:true', r2);
ok(typeof r2.erro === 'string' && r2.erro === '', 'save() devolve erro vazio em caso de sucesso', r2);
ok(typeof r2.mensagem === 'string' && typeof r2.bytes === 'number' && r2.bytes > 0,
  'save() devolve mensagem e bytes', r2);
var gravado = JSON.parse(st1._d[KEY]);
ok(gravado.clients.length === 2 && gravado.proposals.length === 2, 'o conteúdo gravado no storage está completo');
ok(Number(gravado.__meta.rev) > 0, 'rev gravado e incrementado');
ok(D1.isDirty() === false, 'isDirty() falso depois de salvar bem');

var antes = w1.CRE_STORAGE.stampOf(KEY);
D1.save();
ok(w1.CRE_STORAGE.stampOf(KEY) > antes, 'o carimbo de rev do storage avançou a cada gravação');

/* Rev precisa ser monotônico entre gravações. */
var revs = [];
for (var i2 = 0; i2 < 5; i2++) { D1.save(); revs.push(Number(JSON.parse(st1._d[KEY]).__meta.rev)); }
var monotono = true;
for (i2 = 1; i2 < revs.length; i2++) { if (revs[i2] <= revs[i2 - 1]) monotono = false; }
ok(monotono, 'rev é estritamente crescente entre gravações', revs);

/* ════════════════════════════════════════════════════════════
   3. save() devolve erro de quota e não mente
   ════════════════════════════════════════════════════════════ */

titulo('3. save() devolve ok:false, erro:"quota" e não mente');

var st3 = criarArmazenamento();
st3._d[KEY] = JSON.stringify(ANTIGO);
var w3 = novoContexto(st3);
var D3 = w3.CRE_DATA;
D3.load();
st3.lancarQuota = true;

var avisosQuota = [];
w3.CRE_STORAGE.onQuotaError(function (info) { avisosQuota.push(info); });

var c3 = D3.addClient({ name: 'Teste Quota', company: 'X' });
var r3 = D3.save();
ok(r3.ok === false, 'save() devolve ok:false quando o storage recusa', r3);
ok(r3.erro === 'quota', 'erro é "quota"', r3);
ok(r3.error === 'quota', 'alias "error" presente para a UI que procurar por ele', r3);
ok(/Espaco insuficiente/i.test(r3.mensagem), 'mensagem em português legível', r3);
ok(r3.bytes > 0, 'save() diz quanto tentou gravar', r3);
ok(D3.isDirty() === true, 'isDirty() verdadeiro: há estado não gravado');
ok(D3.ultimoErro() && D3.ultimoErro().erro === 'quota', 'ultimoErro() expõe a causa');
ok(avisosQuota.length >= 1, 'o callback CRE_STORAGE.onQuotaError foi disparado', avisosQuota.length);
/* Não mente: o storage continua com o conteúdo ANTERIOR, não o novo. */
var persistido3 = JSON.parse(st3._d[KEY]);
ok(persistido3.clients.length === ANTIGO.clients.length, 'o storage não recebeu o registro que falhou');
ok(persistido3.clients.every(function (x) { return x.name !== 'Teste Quota'; }), 'nada foi gravado por cima do que já existia');
/* O trabalho continua na tela. */
ok(D3.findClient(c3.id) !== null, 'o registro novo continua em memória para o usuário ver e salvar em arquivo');

/* Firefox: name diferente, mesmo resultado. */
var st3b = criarArmazenamento();
st3b.lancarQuota = true;
var w3b = novoContexto(st3b);
w3b.CRE_STORAGE.write('georevest-teste', { a: 1 });
var r3b = w3b.CRE_STORAGE.write('georevest-teste', { a: 2 });
ok(r3b.ok === false && r3b.erro === 'quota', 'erro de quota é normalizado mesmo em outra implementação', r3b);

/* Chave fora da allowlist é recusada (porta de __proto__). */
var r3c = w3b.CRE_STORAGE.write('__proto__', { pollui: true });
ok(r3c.ok === false && r3c.erro === 'unknown' && r3c.detalhe === 'chave-fora-do-prefixo',
  'chave fora do prefixo permitido é recusada, com erro no enum e motivo em `detalhe`', r3c);
ok(({}).pollui === undefined, 'nada foi contaminado no protótipo');

/* Contrato de erro: a UI faz switch em quatro valores, nunca mais. */
var ENUM = ['quota', 'unavailable', 'serialize', 'unknown'];
var r3e1 = w3b.CRE_STORAGE.write('georevest-ciclo', (function () { var o = {}; o.eu = o; return o; })());
var r3e2 = w3b.CRE_STORAGE.write('__proto__', 1);
ok(ENUM.indexOf(r3e1.erro) !== -1, 'valor circular devolve erro no enum ("serialize")', r3e1.erro);
ok(ENUM.indexOf(r3e2.erro) !== -1, 'chave inválida devolve erro no enum ("unknown")', r3e2.erro);
ok(r3e1.erro === 'serialize' && r3e2.erro === 'unknown', 'os dois motivos continuam distinguíveis');

/* Armazenamento indisponível é detectado no uso, não no load. */
var st3d = criarArmazenamento({ indisponivel: true });
var w3d = novoContexto(st3d);
var D3d = w3d.CRE_DATA;
var db3d = D3d.load();
var r3d = D3d.save();
ok(r3d.ok === false && (r3d.erro === 'unavailable'), 'storage indisponível (modo privado) gera erro, não exceção', r3d);
ok(db3d && Array.isArray(db3d.clients), 'o app ainda abre com lista utilizável em storage indisponível');

/* ════════════════════════════════════════════════════════════
   4. Conflito entre abas
   ════════════════════════════════════════════════════════════ */

titulo('4. Duas abas: cliente da aba A e orçamento da aba B sobrevivem aos dois');

/* Duas instâncias do app sobre o MESMO storage, como duas abas. */
var st4 = criarArmazenamento();
st4._d[KEY] = JSON.stringify(ANTIGO);
var w4a = novoContexto(st4);
var w4b = novoContexto(st4);
var A = w4a.CRE_DATA;
var B = w4b.CRE_DATA;
A.load();
B.load();

var conflitosB = [];
B.onConflito(function (c) { conflitosB.push(c); });

/* Aba A cadastra um cliente novo. */
var novoCliente = A.addClient({ name: 'Cliente da Aba A', company: 'Empresa A', cnpj: '11.222.333/0003-43' });
/* Aba B cria um orçamento a partir do cliente antigo, sem saber de nada. */
var novaProposta = B.addProposal({ name: 'Orçamento da Aba B', clientId: 'cl_antigo_1', status: 'draft' });

var depois = JSON.parse(st4._d[KEY]);
ok(depois.clients.some(function (c) { return c.name === 'Cliente da Aba A'; }),
  'o cliente criado na aba A sobreviveu à escrita da aba B');
ok(depois.proposals.some(function (p) { return p.name === 'Orçamento da Aba B' }),
  'o orçamento criado na aba B sobreviveu à escrita da aba A');
ok(depois.clients.length === 3 && depois.proposals.length === 3,
  'as duas abas convergiram para a união dos registros', { clientes: depois.clients.length, propostas: depois.proposals.length });

var clienteNaB = B.findClient(novoCliente.id);
ok(clienteNaB !== null, 'a aba B enxerga o cliente da aba A depois de integrar');
ok(B.lastConflito() && B.lastConflito().houve === true, 'a aba B recebeu o relatório de conflito');
ok(B.lastConflito().registros.some(function (r) { return r.motivo === 'novo' && r.id === novoCliente.id }),
  'o relatório diz qual registro entrou de fora', B.lastConflito().registros);
ok(conflitosB.length >= 1, 'onConflito foi chamado na aba B');

/* Mesmo registro editado nas duas abas: o mais novo vence e a UI é avisada. */
A.updateProposal('pr_antigo_1', { name: 'Editada na aba A' });
var bAntes = B.getProposal('pr_antigo_1').name;
ok(bAntes === 'Proposta Antiga', 'antes de integrar, a aba B ainda vê a versão antiga');
B.updateProposal('pr_antigo_1', { name: 'Editada na aba B' });
A.load(); /* é o que a UI faz a cada render:CRE_DATA.load() */
var aDepois = A.getProposal('pr_antigo_1').name;
ok(aDepois === 'Editada na aba B', 'mesmo registro editado nas duas abas: valeu a alteração mais recente');
var lc = A.lastConflito();
ok(!!lc, 'A recebeu relatório de conflito ao integrar a escrita da aba B', lc);
var div = (lc && lc.registros ? lc.registros : []).filter(function (r) { return r.motivo === 'divergente'; });
ok(div.length >= 1, 'a divergência de mesmo registro foi sinalizada (a UI tem que avisar)', lc);

/* Exclusão numa aba não é desfeita pelo snapshot velho da outra. */
var clienteTemp = A.addClient({ name: 'Temporário', company: 'Temp' });
A.deleteClient(clienteTemp.id);
B.sync();
ok(B.findClient(clienteTemp.id) === null, 'cliente excluído na aba A não volta quando a aba B regrava');

/* Edição posterior ao registro de exclusão ressuscita o cadastro.
   Aqui a aba B ainda não tinha integrado a exclusão: ela edita o registro
   que tem em memória, grava por cima, e a exclusão é desfeita. */
var nascido = A.addClient({ name: 'Zika', company: 'Z' });
B.sync();
A.deleteClient(nascido.id);
B.updateClient(nascido.id, { notes: 'revivido' });
A.sync();
var rev = A.findClient(nascido.id);
ok(rev !== null && rev.notes === 'revivido', 'edição posterior à exclusão traz o registro de volta');
ok(B.findClient(nascido.id) !== null, 'o registro revivido continua visível nas duas abas');

/* Config e sequência de NF reconciliam sem perder contagem. */
A.nextNFNumber('produto');
A.nextNFNumber('produto');
B.nextNFNumber('servico');
A.save(); /* nextNFNumber não grava: quem persiste é o addInvoice seguinte */
B.save();
var seqFinal = JSON.parse(st4._d[KEY]).nfSequence;
ok(Number(seqFinal.produto) >= 2 && Number(seqFinal.servico) >= 1,
  'numeração de nota reconciliada pelo maior valor, sem reiniciar', seqFinal);

/* ── Relatório de conflito que não inventa divergência ──
   Uma única criação na outra aba produzia "1 criado, 7 alterados" nas DUAS
   abas. Sete dos oito registros não tinham sido editados por ninguém: três
   propostas só diferiam em revision/revisions (a memória já tinha o padrão,
   o payload recem-lido ainda não) e quatro não diferiam em campo nenhum,
   só na ordem em que as chaves foram montadas. Um relatório que grita oito
   vezes quando aconteceu uma não serve para avisar sobre a oitava. */
titulo('4b. O relatório de conflito só acusa o que realmente divergiu');

var st4b = criarArmazenamento();
st4b._d[KEY] = JSON.stringify(ANTIGO);
var A4b = novoContexto(st4b).CRE_DATA;
var B4b = novoContexto(st4b).CRE_DATA;
A4b.load();
B4b.load();

var criadoNaA = A4b.addClient({ name: 'Uma única criação', company: 'X' });
A4b.load();
B4b.sync();
var lc4b = B4b.lastConflito();
var cont4b = { novo: 0, divergente: 0 };
((lc4b && lc4b.registros) || []).forEach(function (r) { cont4b[r.motivo] = (cont4b[r.motivo] || 0) + 1; });
ok(cont4b.novo === 1, 'uma criação na outra aba conta como 1 criação', cont4b);
ok(cont4b.divergente === 0, 'uma criação na outra aba NÃO gera divergência', lc4b && lc4b.registros);
ok(B4b.lastConflito().houve === true, 'a aba que recebeu dado de fora é avisada mesmo sem divergência');

/* Ordem das chaves não é edição. Dois objetos com os mesmos dados em ordem
   diferente têm de ser lidos como iguais. */
var st4b2 = criarArmazenamento();
st4b2._d[KEY] = JSON.stringify(ANTIGO);
var A4b2 = novoContexto(st4b2).CRE_DATA;
var B4b2 = novoContexto(st4b2).CRE_DATA;
A4b2.load();
B4b2.load();
A4b2.updateClient('cl_antigo_1', { notes: 'mesmo conteudo' });
A4b2.save();
A4b2.load();
B4b2.sync();
var lc4b2 = B4b2.lastConflito();
ok(!(lc4b2 && lc4b2.registros || []).some(function (r) { return r.motivo === 'divergente'; }),
  'aba que não mexeu no registro não é acusada de conflito');

/* ── updateClient e updateInvoice nas duas abas ──
   A mesma perda de dados que atingia a proposta atingia qualquer entidade
   com id: a função pegava o registro, aplicava o patch, e devolvia essa
   referência depois que o merge a substituía por inteiro. A UI recebia um
   objeto "salvo" que já não estava no banco. */

titulo('4c. updateClient e updateInvoice: a edição mais recente vence');

var st4c = criarArmazenamento();
st4c._d[KEY] = JSON.stringify(ANTIGO);
var A4c = novoContexto(st4c).CRE_DATA;
var B4c = novoContexto(st4c).CRE_DATA;
A4c.load();
B4c.load();

A4c.updateClient('cl_antigo_1', { notes: 'cliente editado na aba A' });
B4c.updateClient('cl_antigo_1', { notes: 'cliente editado na aba B' });
A4c.load();
ok(A4c.findClient('cl_antigo_1').notes === 'cliente editado na aba B',
  'updateClient: vale a edição mais recente', A4c.findClient('cl_antigo_1').notes);
var div4c = (A4c.lastConflito().registros || []).filter(function (r) { return r.motivo === 'divergente'; });
ok(div4c.length >= 1, 'updateClient: a divergência entre as duas abas é avisada', A4c.lastConflito());

/* O objeto devolvido tem de ser o que está no banco agora. Se a função
   devolvesse a cópia pré-merge, o próximo save() do editor escreveria por
   cima do registro recém-integrado. */
var devolvido4c = B4c.updateClient('cl_antigo_1', { notes: 'segunda edicao na B' });
ok(devolvido4c === B4c.findClient('cl_antigo_1'),
  'updateClient devolve o registro que está no banco, não uma cópia órfã');
B4c.load();
ok(B4c.findClient('cl_antigo_1').notes === 'segunda edicao na B',
  'o cliente continua como a última escrita depois de integrar de novo');

/* Invoice tem o mesmo caminho, mais as datas, que passam por correção.
   A edita primeiro, B depois: o mais novo vence, como no cliente. */
var nf4c = A4c.addInvoice({ proposalId: 'pr_antigo_1', number: 'NF-0001', status: 'draft', payment: 'pending' });
A4c.load();
B4c.sync();
A4c.updateInvoice(nf4c.id, { payment: 'pending', status: 'draft', dueDate: '2026-04-10' });
B4c.updateInvoice(nf4c.id, { payment: 'paid', paymentDate: '2026-03-10', status: 'issued' });
A4c.load();
ok(A4c.getInvoice(nf4c.id).payment === 'paid',
  'updateInvoice: vale a edição mais recente', A4c.getInvoice(nf4c.id).payment);
ok(A4c.getInvoice(nf4c.id).status === 'issued',
  'updateInvoice: o resto do patch da edição vencedora também entra', A4c.getInvoice(nf4c.id).status);
var devolvido4c2 = B4c.updateInvoice(nf4c.id, { observacoes: 'segunda edicao na B' });
ok(devolvido4c2 === B4c.getInvoice(nf4c.id),
  'updateInvoice devolve o registro que está no banco, não uma cópia órfã');
var div4c2 = (A4c.lastConflito().registros || []).filter(function (r) { return r.motivo === 'divergente'; });
ok(div4c2.length >= 1, 'updateInvoice: a divergência entre as duas abas é avisada', A4c.lastConflito());

/* Aba defasada edita registro que ainda não viu: antes devolvia null e a
   edição era descartada em silêncio. */
var st4d = criarArmazenamento();
st4d._d[KEY] = JSON.stringify(ANTIGO);
var A4d = novoContexto(st4d).CRE_DATA;
var B4d = novoContexto(st4d).CRE_DATA;
A4d.load();
B4d.load();
var novo4d = A4d.addClient({ name: 'Criado na aba A', company: 'Z' });
var antes4d = B4d.findClient(novo4d.id);
var r4d = B4d.updateClient(novo4d.id, { notes: 'editado pela aba defasada' });
ok(r4d !== null, 'updateClient em registro que a aba ainda não viu não devolve null');
ok(r4d && r4d.notes === 'editado pela aba defasada', 'a edição da aba defasada foi aplicada', r4d && r4d.notes);
ok(r4d === B4d.findClient(novo4d.id), 'e devolveu o registro vivo, não órfã');
A4d.load();
ok(A4d.findClient(novo4d.id).notes === 'editado pela aba defasada',
  'a edição sobreviveu e aparece na outra aba');

/* Id que não existe não pode ser criado pelo update, e o falsy devolvido é
   o que a UI já trata como erro.

   Observação sobre exclusão: editar um registro que a OUTRA aba acabou de
   apagar NÃO é recusado - ele volta, com o carimbo novo por cima do
   tombstone. Isso é decisão de produto já coberta acima ("edição posterior
   à exclusão traz o registro de volta") e significa que o caminho
   "o registro sumiu no meio da gravação" é raramente alcançável pela API
   pública; ele existe para o caso do merge e da restauração de backup. */
var st4e = criarArmazenamento();
st4e._d[KEY] = JSON.stringify(ANTIGO);
var A4e = novoContexto(st4e).CRE_DATA;
var B4e = novoContexto(st4e).CRE_DATA;
A4e.load();
B4e.load();
ok(B4e.updateClient('cl_que_nunca_existiu', { notes: 'x' }) === null,
  'updateClient em id inexistente devolve null (a UI trata como erro)');
ok(A4e.findClient('cl_que_nunca_existiu') === null,
  'e não inventa o registro no banco');
ok(B4e.updateProposal('pr_que_nunca_existiu', { name: 'x' }) === null,
  'updateProposal em id inexistente devolve null');
ok(B4e.updateInvoice('nf_que_nunca_existiu', { status: 'draft' }) === null,
  'updateInvoice em id inexistente devolve null');
ok(JSON.parse(st4e._d[KEY]).clients.length === ANTIGO.clients.length,
  'nenhuma das tentativas inventou registro');

/* ════════════════════════════════════════════════════════════
   5. Import de backup no formato antigo
   ════════════════════════════════════════════════════════════ */

titulo('5. Import de arquivo de backup no formato antigo');

var st5 = criarArmazenamento();
var w5 = novoContexto(st5);
var D5 = w5.CRE_DATA;
D5.load();

/* Formato antigo: { app: {...}, layoutTemplate: {...} } sem 'versao'. */
var arquivoAntigo = JSON.stringify({ app: ANTIGO, layoutTemplate: ANTIGO.proposals[0].layout });
var ok5 = D5.importAll(arquivoAntigo);
ok(ok5 === true, 'importAll devolve true para arquivo no formato antigo');
var db5 = D5.load();
ok(db5.clients.length === 2 && db5.proposals.length === 2 && db5.invoices.length === 1,
  'todas as coleções do arquivo antigo foram importadas');
ok(db5.clients[0].company === 'Obra LTDA', 'campo de cliente importado sem perda');
ok(db5.proposals[0].layout.blocks[1].data.rows.length === 2, 'layout aninhado importado');
ok(db5.invoices[0].items.length === 1 && db5.invoices[0].total === 23197.77, 'itens e total da nota importados');
ok(db5.invoiceModels[0].name === 'Nota de Produto', 'modelo de nota importado');
ok(D5.lastImportReport().ok === true && D5.lastImportReport().registros === 8,
  'relatório de import conta os registros', D5.lastImportReport());

/* Formato atual, com 'versao'. */
var arquivoNovo = D5.exportAll();
var parsedNovo = JSON.parse(arquivoNovo);
ok(parsedNovo.versao === D5.FORMAT_VERSION && typeof parsedNovo.geradoEm === 'string',
  'exportAll inclui versao e geradoEm');
ok(D5.importAll(arquivoNovo) === true, 'import do formato atual funciona');
ok(D5.load().clients.length === 2, 'reimportação do próprio export não duplica nem perde');

/* Dump cru do banco, sem envelope 'app'. */
ok(D5.importAll(JSON.stringify(ANTIGO)) === true, 'import aceita dump cru do banco');
ok(D5.load().clients.length === 2, 'dump cru importado');

/* Arquivo inválido: recusa com motivo, sem tocar no dado. */
var antesInvalido = JSON.stringify(D5.load().clients);
ok(D5.importAll('{ isto não é json') === false, 'JSON inválido é recusado');
ok(D5.lastImportReport().ok === false && /inválido/i.test(D5.lastImportReport().mensagem),
  'a recusa explica o motivo', D5.lastImportReport());
ok(D5.importAll(JSON.stringify({ foo: 1 })) === false, 'objeto sem as coleções é recusado');
ok(JSON.stringify(D5.load().clients) === antesInvalido, 'o dado atual não foi tocado pela importação recusada');

/* Importar cria backup do estado anterior: importar é reversível. */
var st5b = criarArmazenamento();
var w5b = novoContexto(st5b);
var D5b = w5b.CRE_DATA;
D5b.load();
D5b.addClient({ name: 'Antes do import', company: 'X' });
var antesDoImport = D5b.load().clients.length;
D5b.importAll(arquivoAntigo);
var backupsDepois = D5b.getBackups();
ok(backupsDepois.length >= 1, 'importar guardou backup do estado anterior');
ok(JSON.parse(JSON.stringify(backupsDepois[0].data.clients)).length === antesDoImport,
  'o backup contém o estado que o import substituiu');

/* ════════════════════════════════════════════════════════════
   6. __proto__ no import
   ════════════════════════════════════════════════════════════ */

titulo('6. Import com __proto__ / constructor não contamina objeto');

var st6 = criarArmazenamento();
var w6 = novoContexto(st6);
var D6 = w6.CRE_DATA;
D6.load();

var malicioso = '{"app":{"clients":[{"id":"cl_x","name":"Teste","cnpj":"11.222.333/0001-81",' +
  '"__proto__":{"pollui":"SIM"},"constructor":{"prototype":{"pollui2":"SIM"}},' +
  '"prototype":{"pollui3":"SIM"},"campoDesconhecido":"deve ser descartado"}],' +
  '"proposals":[{"id":"pr_x","name":"P","clientId":"cl_x","status":"draft","layout":{"blocks":[],"__proto__":{"x":1}},' +
  '"parceiroFantasma":{"a":1}}],"partners":[],"invoices":[],"invoiceModels":[],' +
  '"nfSequence":{"__proto__":1},"config":{"__proto__":{"cfg":1},"footer":{}},"activeProposalId":"pr_x"}}';

var ok6 = D6.importAll(malicioso);
ok(ok6 === true, 'o arquivo com __proto__ ainda é aceito (o registro é legítimo)');
var db6 = D6.load();

ok(({}).pollui === undefined, 'Object.prototype não foi contaminado por __proto__');
ok(({}).pollui2 === undefined, 'constructor.prototype não foi contaminado');
ok(({}).pollui3 === undefined, 'prototype não foi contaminado');
ok(({}).cfg === undefined, '__proto__ dentro de config não contaminou');
ok(({}).x === undefined, '__proto__ dentro do layout não contaminou');
ok(!Object.prototype.hasOwnProperty.call(db6.clients[0], '__proto__'),
  'o registro do cliente não carrega __proto__ próprio');
ok(!Object.prototype.hasOwnProperty.call(db6.clients[0], 'constructor'),
  'o registro do cliente não carrega constructor próprio');
ok(db6.clients[0].campoDesconhecido === undefined, 'campo fora da whitelist foi descartado');
ok(db6.proposals[0].parceiroFantasma === undefined, 'campo de proposta fora da whitelist foi descartado');
ok(D6.lastImportReport().bloqueados.length >= 3, 'as chaves perigosas foram contabilizadas', D6.lastImportReport().bloqueados);
ok(D6.lastImportReport().desconhecidos.some(function (k) { return k.indexOf('campoDesconhecido') === 0; }),
  'campo desconhecido foi reportado, não sumiu em silêncio', D6.lastImportReport().desconhecidos);

/* A whitelist também fecha mass assignment no update. */
var st6b = criarArmazenamento();
st6b._d[KEY] = JSON.stringify(ANTIGO);
var w6b = novoContexto(st6b);
var D6b = w6b.CRE_DATA;
D6b.load();
D6b.updateProposal('pr_antigo_1', { id: 'pr_sequestrado', createdAt: '1999-01-01', revision: 999, layout: { blocks: [] } });
var p6 = D6b.getProposal('pr_antigo_1');
ok(p6 !== null, 'o registro não sumiu por tentar trocar o próprio id');
ok(p6.revision === 999, 'campo legítimo da proposta foi aplicado');
D6b.updateInvoice('nf_antigo_1', { __proto__: { mass: 'SIM' }, total: 999, modeloSecreto: 'x' });
ok(({}).mass === undefined, 'updateInvoice também ignora __proto__');
ok(D6b.getInvoice('nf_antigo_1').modeloSecreto === undefined, 'campo fora da whitelist no update foi ignorado');

/* ════════════════════════════════════════════════════════════
   7. Teto do backup local
   ════════════════════════════════════════════════════════════ */

titulo('7. Backup local: teto, descarte do mais antigo e aviso');

var st7 = criarArmazenamento();
var w7 = novoContexto(st7);
var D7 = w7.CRE_DATA;
D7.load();

/* O teto só aparece quando o histórico realmente passa de BACKUP_MAX_BYTES
   (1,2 MB), então o teste enche de propósito em vez de fingir o limite. */
var entulho = new Array(3000).join('linha de conteúdo de proposta reasonably longa. ');
for (var i7 = 0; i7 < 40; i7++) {
  D7.addProposal({ name: 'Proposta de volume ' + i7, clientId: null, status: 'draft', description: entulho });
  D7.addBackup(true);
}
var rel7 = D7.ultimoBackup();
var totalBk = D7.getBackups().reduce(function (s, b) { return s + Buffer.byteLength(JSON.stringify(b.data), 'utf8'); }, 0);
ok(rel7.descartados >= 1, 'ao estourar o teto, backups antigos foram descartados e isso foi dito', rel7);
ok(D7.getBackups().length <= D7.BACKUP_LIMIT, 'nunca passa do limite de cópias', D7.getBackups().length);
ok(totalBk <= D7.BACKUP_MAX_BYTES, 'o total dos backups locais fica no teto de bytes', totalBk);
ok(/descartados/i.test(rel7.mensagem), 'a mensagem explica o descarte', rel7.mensagem);
ok(D7.getBackups()[0].id === rel7.id, 'o backup mais recente foi o preservado');

/* Binário sai do backup local (é o que estoura a cota), mas o arquivo
   exportado continua com tudo. */
var st7b = criarArmazenamento();
var w7b = novoContexto(st7b);
var D7b = w7b.CRE_DATA;
D7b.load();
var img = 'data:image/png;base64,' + new Array(400).join('A');
D7b.addPartner({ name: 'Com imagem', cnpj: '11.222.333/0002-62', contract: { fileName: 'c.pdf', fileSize: 10, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + new Array(2000).join('B') } });
D7b.addBackup(true);
var bk = D7b.getBackups()[0];
ok(bk.binarioRemovido === true, 'o backup local sinalizou que removeu binário');
ok(!JSON.stringify(bk.data).match(/data:/), 'nenhum dataUrl ficou no backup local');
ok(JSON.stringify(D7b.exportAll()).indexOf('data:') !== -1, 'o arquivo exportado mantém o binário');

/* Backup sobrevive a "novo layout padrão" e a reset. */
D7b.addProposal({ name: 'Antes do reset', clientId: null, status: 'draft' });
var antesReset = D7b.getBackups().length;
D7b.reset();
var depoisReset = D7b.getBackups();
ok(depoisReset.length >= antesReset, 'reset não destroyu o histórico de backup', { antes: antesReset, depois: depoisReset.length });
var temAntes = depoisReset.some(function (b) { return (b.data.proposals || []).some(function (p) { return p.name === 'Antes do reset'; }); });
ok(temAntes, 'o backup feito antes do reset ainda contém o trabalho antigo');

/* Restaurar backup também é reversível e avisa sobre binário. */
var substituicoes = [];
D7b.onStoreReplaced(function (info) { substituicoes.push(info); });
var idBackup = depoisReset[0].id;
ok(D7b.restoreBackup(idBackup) === true, 'restoreBackup devolve true');
ok(substituicoes.some(function (s) { return s.origem === 'restauracao'; }),
  'onStoreReplaced avisou a UI (editor-ux precisa se incretar)');

/* ════════════════════════════════════════════════════════════
   8. Seed limpo e integridade referencial
   ════════════════════════════════════════════════════════════ */

titulo('8. defaultLayout() sem dado de terceiro; integridade das exclusões');

var st8 = criarArmazenamento();
var w8 = novoContexto(st8);
var D8 = w8.CRE_DATA;
var layout = D8.defaultLayout();
var texto = JSON.stringify(layout);

ok(layout.blocks.length === 2, 'layout padrão continua com os dois blocos funcionais');
ok(layout.blocks[0].type === 'cover' && layout.blocks[1].type === 'commercial', 'capa e tabela comercial preservadas');
ok(layout.blocks[1].data.cols.join('|') === 'Item|Quantidade|Descrição|Valor', 'coluna Valor mantida como texto livre');
ok(layout.blocks[1].data.rows.length === 1, 'tabela comercial nasce com uma linha em branco');
ok(!/Flamboyant|Willian|Oscar|Gabriel|Piratininga|4722|3363|4417|Osasco/i.test(texto),
  'nenhum nome, telefone ou endereço de terceiro no layout padrão', texto.match(/Flamboyant|Willian|Oscar|Gabriel|4417|4722|3363/gi));
ok(!/30 de abril de 2026|461422130|23\.197,77/.test(texto), 'nenhuma data fixa, número de proposta ou preço de terceiro');
ok(layout.blocks[0].data.date === '', 'data da capa nasce vazia (é calculada na renderização)');
ok(layout.blocks[0].data.recipient === '', 'destinatário nasce vazio');
ok(typeof D8.todayLabel() === 'string' && D8.todayLabel().length > 8,
  'CRE_DATA.todayLabel() disponível para o editor-ux preencher a data');
ok(D8.defaultFiscal().cnpj === '' && D8.defaultFiscal().telefone === '', 'defaultFiscal() sem CNPJ/telefone reais');
ok(!/44 Sul|4417 - 4417/i.test(JSON.stringify(D8.defaultFooter())), 'defaultFooter() sem telefone/endereço reais');

/* Seed do primeiro uso: exemplo, mas com CNPJ válido e genérico. */
var seed = D8.load();
ok(seed.clients.every(function (c) { return !/^0{2}\./.test(c.cnpj || ''); }),
  'seed não usa CNPJ inválido 00.000.000/0001-00');
ok(seed.clients.every(function (c) { return w8.CRE_FISCAL.isValidCnpj(c.cnpj) || !c.cnpj; }),
  'todo CNPJ do seed passa no dígito verificador');
ok(!/Flamboyant|Willian|Oscar|Gabriel|MantaTech|312345678/i.test(JSON.stringify(seed)),
  'seed sem dado que pareça empresa real');

/* Exclusões com dependente. */
var st8b = criarArmazenamento();
st8b._d[KEY] = JSON.stringify(ANTIGO);
var w8b = novoContexto(st8b);
var D8b = w8b.CRE_DATA;
D8b.load();
var rCli = D8b.deleteClient('cl_antigo_1');
ok(rCli.ok === false && rCli.erro === 'em-uso' && rCli.dependentes === 1,
  'cliente com proposta vinculada não é excluído em silêncio', rCli);
ok(D8b.findClient('cl_antigo_1') !== null, 'o cliente continua lá');
D8b.updateProposal('pr_antigo_1', { clientId: null });
var rCli2 = D8b.deleteClient('cl_antigo_1');
ok(rCli2.ok === true, 'sem dependência, o cliente é excluído', rCli2);

var rPar = D8b.deletePartner('pa_antigo_1');
ok(rPar.ok === true && rPar.dependentes === 1, 'parceiro sai e o retorno informa os dependentes', rPar);
var pt = D8b.getProposal('pr_antigo_1').partners[0];
ok(pt.partnerId === null && pt.parceiroNome === 'Parceiro Antigo',
  'vínculo desfeito com o nome preservado');
ok(pt.commissionType === 'percent' && pt.commissionValue === 3 && pt.notes === 'execução',
  'a comissão foi preservada no histórico');

var rMod = D8b.deleteInvoiceModel('im_antigo_1');
ok(rMod.ok === false && rMod.erro === 'em-uso',
  'modelo de nota em uso não pode ser excluído (impressão perderia "Dados da operação")', rMod);
ok(D8b.getInvoiceModel('im_antigo_1') !== null, 'o modelo continua lá');

D8b.deleteInvoice('nf_antigo_1');
ok(D8b.deleteInvoiceModel('im_antigo_1').ok === true, 'sem nota vinculada, o modelo sai');

/* ════════════════════════════════════════════════════════════
   9. Diagnóstico
   ════════════════════════════════════════════════════════════ */

titulo('9. Diagnóstico e integridade do armazenamento');

var d9 = w1.CRE_STORAGE.usage();
ok(d9.bytes > 0 && typeof d9.fracao === 'number' && d9.estimativa === true,
  'usage() mede o que o app ocupa e declara que a cota é estimativa', d9);
ok(d9.itens.some(function (i) { return i.chave === KEY; }), 'usage() lista a chave principal');
ok(w1.CRE_STORAGE.available() === true, 'available() true com storage funcional');

/* estimate() devolve Promise: a primeira leitura cai no padrao e a
   seguinte já usa a cota real. Sem isso, a tela ficaria eternity no 5 MB. */
var cotaViu = { chamada: 0 };
var st9b = criarArmazenamento();
var w9b = novoContexto(st9b);
w9b.navigator.storage.estimate = function () {
  cotaViu.chamada += 1;
  return { then: function (fn) { fn({ usage: 100, quota: 50 * 1024 * 1024 }); } };
};
w9b.CRE_STORAGE.write('georevest-x', { a: 1 });
var u9a = w9b.CRE_STORAGE.usage();
var u9b = w9b.CRE_STORAGE.usage();
ok(cotaViu.chamada >= 1, 'usage() consulta navigator.storage.estimate()');
ok(u9a.fonteQuota === 'estimate-api' && u9a.quotaBytes === 50 * 1024 * 1024,
  'estimate() devolve Promise e o resultado é assimilado, não lido como objeto', u9a);
ok(u9b.fonteQuota === 'estimate-api', 'a cota continua vindo da API nas leituras seguintes');

/* Promise de verdade (assíncrona): a 1ª leitura cai no padrão, a 2ª melhora. */
var st9c = criarArmazenamento();
var w9c = novoContexto(st9c);
w9c.navigator.storage.estimate = function () {
  return new (w9c.Promise || Promise)(function (res) { setTimeout(function () { res({ quota: 20 * 1024 * 1024 }); }, 0); });
};
w9c.CRE_STORAGE.write('georevest-y', { a: 1 });
var v9a = w9c.CRE_STORAGE.usage();
ok(v9a.fonteQuota === 'padrao-navegador', 'enquanto a Promise não resolveu, a cota padrão é usada', v9a.fonteQuota);

var diag = D1.diagnostico();
ok(diag.formato === 2 && typeof diag.rev === 'number' && diag.dirty === false,
  'diagnostico() expõe formato, rev e estado sujo', diag.formato);

/* ════════════════════════════════════════════════════════════
   10. Binário grande: recusa explícita, nunca truncamento
   ════════════════════════════════════════════════════════════ */

titulo('10. Contrato/PDF grande é recusado com mensagem, não truncado em silêncio');

var st10 = criarArmazenamento();
var w10 = novoContexto(st10);
var D10 = w10.CRE_DATA;
D10.load();

var pdfPequeno = { fileName: 'contrato.pdf', fileSize: 40, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + new Array(200).join('A') };
var pOk = D10.addPartner({ name: 'Contrato Ok', cnpj: '11.222.333/0002-62', contract: pdfPequeno });
ok(pOk.contract && pOk.contract.dataUrl === pdfPequeno.dataUrl, 'contrato dentro do teto é guardado inteiro');
ok(!pOk.__erroGravacao, 'sem aviso de erro em contrato que coube');

var pdfGrande = { fileName: 'contrato-4mb.pdf', fileSize: 3000000, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + new Array(4000000).join('B') };
var pGrande = D10.addPartner({ name: 'Contrato Grande', cnpj: '11.222.333/0003-43', contract: pdfGrande });
ok(pGrande.contract === undefined || pGrande.contract === null, 'o PDF de 4 MB NÃO foi gravado no banco');
ok(/Espaço insuficiente/i.test(pGrande.__erroGravacao.mensagem),
  'o parceiro guarda o motivo da recusa', pGrande.__erroGravacao);
ok(/teto codificado é 2560 KB/.test(pGrande.__erroGravacao.mensagem),
  'a mensagem nomeia o teto que estourou, não outro', pGrande.__erroGravacao.mensagem);
ok(/NÃO foi salvo/i.test(pGrande.__erroGravacao.mensagem), 'a mensagem diz que não foi salvo');
ok(/truncad/i.test(pGrande.__erroGravacao.mensagem), 'a mensagem diz explicitamente que não foi truncado');
ok(D10.avisos().some(function (a) { return a.tipo === 'contrato-grande'; }), 'a recusa entrou em CRE_DATA.avisos()');
ok(JSON.stringify(D10.load()).length < 500000, 'o banco não inchou com o PDF recusado');
var antes10 = D10.load().partners.length;
ok(antes10 === D10.load().partners.length && D10.load().partners.some(function (x) { return x.name === 'Contrato Grande' && !x.contract; }),
  'o parceiro foi criado mesmo sem o arquivo grande, para o usuário não perder o cadastro', antes10);

/* Sem truncamento silencioso: o que volta nunca é um base64 pela metade. */
var exportado = D10.exportAll();
ok(exportado.indexOf('BBBB') === -1, 'o export não tentou recomprimir nem truncar o PDF recusado');
ok(exportado.indexOf('AAAAAAAAAA') !== -1, 'o PDF pequeno continua íntegro no export');

/* O PDF recusado não impede o resto do fluxo. */
var st10b = criarArmazenamento();
var w10b = novoContexto(st10b);
var D10b = w10b.CRE_DATA;
D10b.load();
var p10 = D10b.addProposal({ name: 'Proposta com anexo grande', clientId: null, status: 'draft' });
var r10 = D10b.updateProposal(p10.id, { layout: { blocks: [{ id: 'b1', type: 'cover', data: { logo: pdfGrande.dataUrl } }] } });
ok(r10 && typeof r10 === 'object', 'updateProposal devolve o registro, não um booleano');
ok(typeof r10 === 'object' && typeof r10.ok === 'undefined',
  'updateProposal não mudou de contrato: a UI que trata falsy como erro continua funcionando', typeof r10);
ok(D10b.getProposal(p10.id) !== null, 'a proposta continua existindo depois do anexo grande');

/* ════════════════════════════════════════════════════════════
   11. Inscrição Estadual/Municipal do cliente: o dado que evaporava
   ════════════════════════════════════════════════════════════

   A UI coleta IE e IM (modules.js:2055-2056) e monta o registro com os
   dois campos (modules.js:2076-2077), mas a whitelist de CAMPOS.clients
   não os tinha. aplicarWhitelist() descarta o que não está na lista, e
   ela roda não só no add/update: sanitizarRaiz() passa por ela também
   no load(). O resultado era o pior dos dois - o campo digitado nunca
   era salvo E o campo já gravado sumia no primeiro load, sem aviso.

   Cada verificação abaixo confere o PAYLOAD GRAVADO, relendo a chave do
   localStorage. Conferir só o retorno em memória foi exatamente o que
   deixou esse bug passar. */

titulo('11. Inscrição Estadual/Municipal do cliente sobrevive ao add/update/load');

function brutoGravado(storage) {
  var raw = storage._d[KEY];
  if (!raw) return null;
  return JSON.parse(raw);
}
function clienteGravado(storage, id) {
  var p = brutoGravado(storage);
  if (!p || !p.clients) return null;
  for (var i = 0; i < p.clients.length; i++) {
    if (p.clients[i].id === id) return p.clients[i];
  }
  return null;
}

/* ── 11a. addClient grava os dois no storage ─────────────────── */

var st11 = criarArmazenamento();
var w11 = novoContexto(st11);
var D11 = w11.CRE_DATA;
D11.load();

var novo11 = D11.addClient({
  name: 'Contato Com IE', company: 'Cliente Com IE Ltda.', cnpj: '11.222.333/0001-81',
  inscricaoEstadual: '110042490114', inscricaoMunicipal: '3512302',
  cep: '08500-000', phone: '(11) 3000-0001', email: 'ie@exemplo.invalid',
  address: 'Rua de Teste, 1', notes: 'OBS'
});
ok(novo11.inscricaoEstadual === '110042490114' && novo11.inscricaoMunicipal === '3512302',
  'addClient devolve IE e IM no registro', novo11);
ok(typeof novo11.id === 'string' && novo11.id !== '',
  'addClient continua devolvendo o registro (nunca booleano)', typeof novo11);

var grav11 = clienteGravado(st11, novo11.id);
ok(grav11 !== null, 'o cliente novo está no payload gravado');
ok(grav11 && grav11.inscricaoEstadual === '110042490114',
  'inscricaoEstadual está NO ARQUIVO gravado, não só na memória', grav11 && grav11.inscricaoEstadual);
ok(grav11 && grav11.inscricaoMunicipal === '3512302',
  'inscricaoMunicipal está NO ARQUIVO gravado, não só na memória', grav11 && grav11.inscricaoMunicipal);
ok(grav11 && grav11.cnpj === '11.222.333/0001-81' && grav11.email === 'ie@exemplo.invalid',
  'os outros campos do cliente continuam indo junto', grav11);

/* ── 11b. updateClient altera e persiste os dois ─────────────── */

var upd11 = D11.updateClient(novo11.id, {
  inscricaoEstadual: '110999999999', inscricaoMunicipal: '9988776',
  company: 'Cliente Com IE Renomeado'
});
ok(upd11 && upd11.inscricaoEstadual === '110999999999' && upd11.inscricaoMunicipal === '9988776',
  'updateClient devolve IE/IM novos e preserva company', upd11);

var grav11b = clienteGravado(st11, novo11.id);
ok(grav11b && grav11b.inscricaoEstadual === '110999999999',
  'a IE alterada foi para o storage', grav11b && grav11b.inscricaoEstadual);
ok(grav11b && grav11b.inscricaoMunicipal === '9988776',
  'a IM alterada foi para o storage', grav11b && grav11b.inscricaoMunicipal);
ok(grav11b && grav11b.company === 'Cliente Com IE Renomeado',
  'update continua aplicando os demais campos do patch');

/* Apagar um dos dois não apaga o outro: são campos independentes. */
var upd11b = D11.updateClient(novo11.id, { inscricaoEstadual: '' });
var grav11c = clienteGravado(st11, novo11.id);
ok(grav11c && grav11c.inscricaoEstadual === '', 'limpar a IE grava string vazia, não apaga a chave');
ok(grav11c && grav11c.inscricaoMunicipal === '9988776',
  'limpar a IE não leva a IM junto', grav11c && grav11c.inscricaoMunicipal);

/* ── 11c. Cliente legado com os dois campos sobrevive a load+save ── */

var LEGADO = {
  clients: [{
    id: 'cl_ie_legado', name: 'Cliente Legado', company: 'Legado Obras', cnpj: '11.222.333/0002-62',
    inscricaoEstadual: 'SP-12345678', inscricaoMunicipal: 'IM-98765',
    phone: '(11) 4000-0000', email: '', address: 'Rua Antiga, 9', notes: '',
    createdAt: '2025-08-01T10:00:00.000Z', updatedAt: '2025-08-02T10:00:00.000Z'
  }],
  proposals: [], partners: [], templates: [], invoices: [], invoiceModels: [],
  nfSequence: {},
  config: {
    footer: { line1: 'Fone', line2: 'Endereco', line3: 'Site', headerImg: '' },
    fiscal: {
      razaoSocial: 'Georevest Engenharia Ltda.', cnpj: '07.602.753/0001-16',
      ie: 'IE-DA-EMPRESA', im: 'IM-DA-EMPRESA', cnae: '7210700/00', regime: 'Lucro Presumido',
      endereco: 'Rod. Fernao Dias', cidade: 'Atibaia - SP', telefone: '(11) 4000-0000', email: 'fisc@exemplo.invalid'
    },
    monthlyGoal: 42000
  },
  activeProposalId: ''
};
var st11d = criarArmazenamento();
st11d._d[KEY] = JSON.stringify(LEGADO);
var w11d = novoContexto(st11d);
var D11d = w11d.CRE_DATA;

var legadoLido = D11d.load().clients[0];
ok(legadoLido.inscricaoEstadual === 'SP-12345678' && legadoLido.inscricaoMunicipal === 'IM-98765',
  'o load() NÃO descarta mais IE/IM de cliente já gravado', legadoLido);
ok(legadoLido.cnpj === '11.222.333/0002-62' && legadoLido.address === 'Rua Antiga, 9',
  'os demais campos do cliente legado seguem intactos');

/* O load sozinho já provaria o dado em memória; o que importa é o
   próximo save(). Ele é o que antes apagava de vez o campo. */
var rSave11 = D11d.save();
ok(rSave11 && rSave11.ok === true, 'save() do legado devolveu ok', rSave11);
var legadoGravado = clienteGravado(st11d, 'cl_ie_legado');
ok(legadoGravado && legadoGravado.inscricaoEstadual === 'SP-12345678',
  'IE do legado sobrevive ao load()+save(): está no arquivo', legadoGravado && legadoGravado.inscricaoEstadual);
ok(legadoGravado && legadoGravado.inscricaoMunicipal === 'IM-98765',
  'IM do legado sobrevive ao load()+save(): está no arquivo', legadoGravado && legadoGravado.inscricaoMunicipal);

/* Reabrir o storage do zero: o round-trip completo. */
var st11e = criarArmazenamento();
st11e._d[KEY] = st11d._d[KEY];
var w11e = novoContexto(st11e);
var reaberto = w11e.CRE_DATA.load().clients[0];
ok(reaberto.inscricaoEstadual === 'SP-12345678' && reaberto.inscricaoMunicipal === 'IM-98765',
  'IE/IM voltam numa sessão nova, lendo o que foi gravado', reaberto);
ok(!D11d.avisos().some(function (a) { return a.tipo === 'campo-descartado'; }),
  'nenhum aviso de campo descartado: o cliente legado está inteiro na whitelist',
  D11d.avisos().filter(function (a) { return a.tipo === 'campo-descartado'; }));

/* ── 11d. config.fiscal.ie/im: caminho separado, mesmo risco ──── */

var cfg11 = D11d.getConfig();
ok(cfg11.fiscal.ie === 'IE-DA-EMPRESA' && cfg11.fiscal.im === 'IM-DA-EMPRESA',
  'config.fiscal.ie/im preservados no load (fiscal é objeto aninhado, saneado por inteiro)');

D11d.updateConfig({
  fiscal: {
    razaoSocial: 'Georevest Engenharia Ltda.', cnpj: '07.602.753/0001-16',
    ie: 'IE-NOVA', im: 'IM-NOVO', cnae: '7210700/00', regime: 'Lucro Presumido',
    endereco: 'Rod. Fernao Dias', cidade: 'Atibaia - SP', telefone: '(11) 4000-0000', email: 'fisc@exemplo.invalid'
  }
});
var fiscalGravado = brutoGravado(st11d).config.fiscal;
ok(fiscalGravado.ie === 'IE-NOVA' && fiscalGravado.im === 'IM-NOVO',
  'updateConfig grava config.fiscal.ie/im no arquivo', fiscalGravado);
ok(fiscalGravado.razaoSocial === 'Georevest Engenharia Ltda.' && fiscalGravado.regime === 'Lucro Presumido',
  'os outros campos de config.fiscal continuam junto', fiscalGravado);

/* updateConfig de rodapé não pode derrubar o bloco fiscal. */
D11d.updateConfig({ footer: { line1: 'Novo rodape', line2: '', line3: '', headerImg: '' }, monthlyGoal: 99000 });
var cfgDepois = brutoGravado(st11d).config;
ok(cfgDepois.fiscal && cfgDepois.fiscal.ie === 'IE-NOVA' && cfgDepois.fiscal.im === 'IM-NOVO',
  'salvar o rodapé não apaga a ie/im da empresa', cfgDepois.fiscal);
ok(cfgDepois.footer.line1 === 'Novo rodape' && cfgDepois.monthlyGoal === 99000,
  'rodapé e meta do mês foram gravados');

/* ── 11e. Campo fora da whitelist agora é visível ─────────────── */

var COM_EXTRAS = {
  clients: [{
    id: 'cl_extra', name: 'Com Campo Desconhecido', company: 'X',
    inscricaoEstadual: 'IE-MANTIDA',
    campoQueNaoExiste: 'valor que o usuário digitou',
    createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z'
  }],
  proposals: [], partners: [], templates: [], invoices: [], invoiceModels: [],
  nfSequence: {}, config: {}, activeProposalId: ''
};
var st11f = criarArmazenamento();
st11f._d[KEY] = JSON.stringify(COM_EXTRAS);
var w11f = novoContexto(st11f);
var D11f = w11f.CRE_DATA;
var lido11f = D11f.load().clients[0];
ok(lido11f.inscricaoEstadual === 'IE-MANTIDA', 'campo conhecido sobrevive mesmo ao lado de um desconhecido');
ok(lido11f.campoQueNaoExiste === undefined, 'campo fora da whitelist continua sendo barrado (a proteção permanece)');
var desc11 = D11f.avisos().filter(function (a) { return a.tipo === 'campo-descartado'; });
ok(desc11.length === 1 && desc11[0].mensagem.indexOf('campoQueNaoExiste') !== -1,
  'o descarte no load() agora é registrado em CRE_DATA.avisos() com o nome do campo', desc11);
ok(desc11[0].mensagem.indexOf('clients') !== -1,
  'o aviso diz de qual coleção o campo foi descartado', desc11[0] && desc11[0].mensagem);
D11f.load();
ok(D11f.avisos().filter(function (a) { return a.tipo === 'campo-descartado'; }).length === 1,
  'repetir o load não multiplica o aviso (dedup por chave)');

/* ════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   12. Atraso derivado de dueDate (AGENTS.md §6)
   ════════════════════════════════════════════════════════════ */

titulo('12. Atraso deriva de dueDate: regra, leitura e escrita');

function isoMais(dias) {
  var d = new Date();
  d.setDate(d.getDate() + dias);
  function dois(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
}
var ONTEM = isoMais(-1);
var HOJE = isoMais(0);
var AMANHA = isoMais(1);

function nfDe(id, campos) {
  var base = {
    id: id, number: '900000', status: 'issued', payment: 'pending', dueDate: '', paymentDate: '',
    issuedAt: '', proposalId: '', clientId: '', modelId: '', type: 'custom', geraFinanceiro: true,
    emitente: {}, destinatario: {}, modelData: {}, items: [], total: 0,
    observacoes: '', referencia: '',
    createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-01T10:00:00.000Z'
  };
  for (var k in campos) { if (Object.prototype.hasOwnProperty.call(campos, k)) base[k] = campos[k]; }
  return base;
}

function gravada12(lista, id) {
  return lista.filter(function (nf) { return nf.id === id; })[0];
}

function contextoDeNotas(notas) {
  var payload = {
    clients: [], partners: [], proposals: [], templates: [], invoices: notas,
    invoiceModels: [], nfSequence: {}, config: {}, activeProposalId: ''
  };
  var st = criarArmazenamento();
  st._d[KEY] = JSON.stringify(payload);
  var D = novoContexto(st).CRE_DATA;
  D.load();
  return { st: st, D: D };
}

var ctx12 = contextoDeNotas([
  nfDe('nf_venc_aberta', { number: '900001', payment: 'pending', dueDate: ONTEM }),
  nfDe('nf_venc_paga', { number: '900002', payment: 'paid', dueDate: ONTEM, paymentDate: ONTEM }),
  nfDe('nf_futura', { number: '900003', payment: 'pending', dueDate: AMANHA }),
  nfDe('nf_sem_venc', { number: '900004', payment: 'pending', dueDate: '' }),
  nfDe('nf_legado_atrasada', { number: '900005', payment: 'overdue', dueDate: ONTEM }),
  nfDe('nf_legado_futura', { number: '900006', payment: 'overdue', dueDate: AMANHA }),
  nfDe('nf_legado_sem_venc', { number: '900007', payment: 'overdue', dueDate: '' }),
  nfDe('nf_sem_financeiro', { number: '900008', payment: 'nofin', dueDate: ONTEM, geraFinanceiro: false }),
  nfDe('nf_legado_sem_fin', { number: '900011', payment: 'overdue', dueDate: ONTEM, geraFinanceiro: false })
]);
var D12 = ctx12.D;
function n12(id) { return D12.getInvoice(id); }

/* ── 12a. A regra, caso a caso ── */

ok(D12.derivarAtraso(n12('nf_venc_aberta')) === true, 'vencida e n\u00e3o paga = atrasada');
ok(D12.pagamentoEfetivo(n12('nf_venc_aberta')) === 'overdue', '...e o pagamento efetivo vira "overdue"');
ok(D12.derivarAtraso(n12('nf_venc_paga')) === false && D12.pagamentoEfetivo(n12('nf_venc_paga')) === 'paid',
  'vencida e PAGA n\u00e3o \u00e9 atrasada e continua "paid"');
ok(D12.derivarAtraso(n12('nf_futura')) === false && D12.pagamentoEfetivo(n12('nf_futura')) === 'pending',
  'vencimento no futuro n\u00e3o \u00e9 atraso');
ok(D12.derivarAtraso(n12('nf_sem_venc')) === false && D12.pagamentoEfetivo(n12('nf_sem_venc')) === 'pending',
  'dueDate ausente n\u00e3o gera atraso');
ok(D12.derivarAtraso(n12('nf_sem_financeiro')) === false && D12.pagamentoEfetivo(n12('nf_sem_financeiro')) === 'nofin',
  'documento sem financeiro nunca aparece como atrasado');
ok(D12.derivarAtraso(null) === false && D12.pagamentoEfetivo(null) === '',
  'entrada inv\u00e1lida devolve valor seguro, n\u00e3o lan\u00e7a');

var nfHoje = nfDe('nf_venc_hoje', { number: '900009', payment: 'pending', dueDate: HOJE });
ok(D12.derivarAtraso(nfHoje, HOJE) === false, 'vencida HOJE ainda n\u00e3o est\u00e1 atrasada (refDate = o pr\u00f3prio vencimento)');
ok(D12.derivarAtraso(nfHoje, AMANHA) === true, 'refDate expl\u00edcita muda a resposta: amanh\u00e3 ela est\u00e1 atrasada');

/* ── 12b. Legado já com "overdue" preenchido, e payload intocado ── */

ok(D12.derivarAtraso(n12('nf_legado_atrasada')) === true &&
  D12.pagamentoEfetivo(n12('nf_legado_atrasada')) === 'overdue',
  'legado manual "overdue" com vencimento vencido: confirmado pela regra');
ok(D12.pagamentoEfetivo(n12('nf_legado_futura')) === 'pending',
  'legado manual "overdue" contradito por vencimento futuro cede para "pending"');
ok(D12.pagamentoEfetivo(n12('nf_legado_sem_venc')) === 'overdue',
  'legado manual "overdue" sem dueDate \u00e9 preservado: n\u00e3o h\u00e1 evid\u00eancia para derivar contra');
ok(D12.pagamentoEfetivo(n12('nf_legado_sem_fin')) === 'nofin',
  'legado "overdue" em documento sem financeiro resolve para "nofin"');

ok(n12('nf_venc_aberta').payment === 'pending' && n12('nf_legado_futura').payment === 'overdue',
  'LEITURA n\u00e3o reescreve o payload: o payment gravado continua como o usu\u00e1rio deixou');

var r12 = D12.save();
ok(r12.ok === true, 'save() do cen\u00e1rio devolve ok', r12);
var cru12 = JSON.parse(ctx12.st._d[KEY]);
ok(cru12.invoices.length === 9 && gravada12(cru12.invoices, 'nf_venc_aberta').payment === 'pending',
  'load()+save() de dado legado mant\u00e9m payment e quantidade no arquivo', cru12.invoices.length);

/* ── 12c. Escrita materializa o derivado, com aviso rastreável ── */

var nova12 = D12.addInvoice({ number: '900010', status: 'draft', payment: 'pending', dueDate: ONTEM });
ok(nova12.payment === 'overdue', 'addInvoice materializa o atraso derivado no registro', nova12.payment);
var avisoAdd = D12.avisos().filter(function (a) { return a.chave === 'atraso:' + nova12.id + ':pending>overdue'; });
ok(avisoAdd.length === 1 && avisoAdd[0].tipo === 'atraso' && avisoAdd[0].mensagem.indexOf('900010') !== -1,
  'a materializa\u00e7\u00e3o virou aviso rastre\u00e1vel apontando a nota', avisoAdd);

var upd12 = D12.updateInvoice('nf_legado_futura', { status: 'issued', payment: 'overdue' });
ok(upd12 && upd12.payment === 'pending',
  'updateInvoice corrige a marca\u00e7\u00e3o manual contradita pelo vencimento', upd12 && upd12.payment);

var pag12 = D12.updateInvoice('nf_venc_aberta', { payment: 'paid', paymentDate: ONTEM });
ok(pag12 && pag12.payment === 'paid',
  'marcar como pago com vencimento no passado mant\u00e9m "paid"', pag12 && pag12.payment);

D12.updateInvoice('nf_legado_futura', { payment: 'overdue', dueDate: AMANHA });
var mesmoAviso = D12.avisos().filter(function (a) { return a.chave === 'atraso:nf_legado_futura:overdue>pending'; });
ok(mesmoAviso.length === 1 && mesmoAviso[0].vezes === 2,
  'refazer a mesma corre\u00e7\u00e3o deduplica o aviso por chave origem>destino', mesmoAviso);

var cru12b = JSON.parse(ctx12.st._d[KEY]);
ok(gravada12(cru12b.invoices, 'nf_legado_futura').payment === 'pending' &&
  gravada12(cru12b.invoices, 'nf_legado_sem_venc').payment === 'overdue',
  'a corre\u00e7\u00e3o foi gravada e a marca\u00e7\u00e3o sem vencimento sobreviveu na mesma cole\u00e7\u00e3o',
  gravada12(cru12b.invoices, 'nf_legado_futura').payment);

/* ── 12d. A nota do snapshot antigo, lida hoje ── */

var antiga12 = D1.getInvoice('nf_antigo_1');
ok(antiga12 && D1.pagamentoEfetivo(antiga12, '2026-12-31') === 'overdue',
  'a nota vencida do snapshot antigo \u00e9 atrasada na leitura',
  antiga12 && D1.pagamentoEfetivo(antiga12, '2026-12-31'));
ok(antiga12 && antiga12.payment === 'pending',
  '...e o payload dela segue "pending", exatamente como no snapshot', antiga12 && antiga12.payment);

console.log('\n' + '='.repeat(62));
console.log(n + ' verificações, ' + falhas + ' falha(s)');
console.log('='.repeat(62));
process.exit(falhas ? 1 : 0);