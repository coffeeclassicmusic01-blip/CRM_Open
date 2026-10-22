/* ============================================================
   GEOREVEST STUDIO — data.js
   Armazenamento (localStorage), seed e CRUD de clientes,
   propostas, modelos de layout e configurações.

   Contrato com o resto do app (js/modules.js, js/editor.js):
   save() devolve { ok, erro, mensagem, bytes } e NUNCA mente.
   load() continua devolvendo o objeto de dados direto (assinatura
   preservada); o que houve de conflito entre abas fica em
   CRE_DATA.lastConflito() e nos callbacks de CRE_DATA.onConflito.
   ============================================================ */

(function (global) {
  'use strict';

  var S = global.CRE_STORAGE;
  var F = global.CRE_FISCAL;

  /* Não mudar: é a chave do dado de produção dos usuários. */
  var STORE_KEY = 'georevest-studio-v1';
  var EDITOR_KEY = 'georevest-editor-current';
  var BACKUP_KEY = 'georevest-backups-v1';

  var FORMAT_VERSION = 2;
  var TAB_ID = 'aba-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

  /* Backups locais são conveniência, não desastre. Janela curta e teto
     de bytes: backup que enche a cota derruba a escrita do dado real.
     O backup de verdade é o arquivo baixado em downloadBackup(). */
  var BACKUP_LIMIT = 8;
  var BACKUP_MAX_BYTES = 1200 * 1024;
  var BACKUP_INTERVAL = 30000;
  var LIMITE_AVISOS = 60;
  var LIMITE_EXCLUIDOS = 300;

  /* Chave reservada dentro do registro: nunca aceita de fora. */
  var CHAVES_PERIGO = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  /* ── IDs ────────────────────────────────── */

  var counter = 0;
  function uid(prefix) {
    counter += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 7) + '_' + counter;
  }

  function tem(campos, k) {
    for (var i = 0; i < campos.length; i++) { if (campos[i] === k) return true; }
    return false;
  }

  function temPropriedade(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  /* ── Papéis de parceiros nas propostas ──── */

  var PARTNER_ROLES = {
    commercial: { key: 'commercial', label: 'Indicador / Comercial', icon: '💼', desc: 'Indicação de projeto / RT' },
    technical: { key: 'technical', label: 'Executor Técnico', icon: '🛠️', desc: 'Equipe técnica / Aplicação' },
    cobranding: { key: 'cobranding', label: 'Parceria Estratégica', icon: '🤝', desc: 'Parceiro conjunto / Co-branding' },
    supplier: { key: 'supplier', label: 'Fornecedor Homologado', icon: '📦', desc: 'Fornecedor de insumos/materiais' }
  };

/* ── Datas ──────────────────────────────── */

  /* updatedAt é o RELÓGIO DE PAREDE, e não um relógio privado da aba.

     Esta função já foi um relógio monótono por aba: cada escrita avançava
     `ultimoCarimbo` em 1 ms quando o relógio real não andava, para
     garantir que duas edições no mesmo milissegundo não empatassem. O
     efeito colateral era pior que o problema que resolvia: o carimbo
     deixava de ser comparável ENTRE abas. Uma aba que fez três escritas
     seguidas ficava até 3 ms no futuro, e passava a ganhar de uma
     edição de verdade feita depois dela noutra aba. Medido: a edição da
     aba A, ocorrida 1 ms antes no relógio da parede, tinha carimbo
     1 ms MAIOR que a da aba B e vencia o merge.

     Empate no mesmo milissegundo continua seguro: a mesclagem trata
     empate como "vale o local", e a aba local é justamente a que está
     com a escrita mais recente em mãos. Ver mesclarColecao. */
  function agoraISO() {
    var agora = Date.now();
    if (!isFinite(agora)) return new Date().toISOString();
    return new Date(agora).toISOString();
  }

  function p2(n) { return (n < 10 ? '0' : '') + n; }

  /* Rótulo de data para a capa da proposta. Exposto para o editor-ux
     preencher a data na renderização, já que o layout padrão nasce vazio. */
  function todayLabel() {
    var d = new Date();
    var meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
      'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    return p2(d.getDate()) + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  }

  /* ── Layout padrão (blocos da primeira proposta) ── */

  /* Sem dado de terceiro: telefone, endereço e CNPJ reais eram aqui e
     saíam impressos na proposta sem o usuário ter digitado nada. */
  function defaultFooter() {
    return {
      line1: 'Telefone: (00) 00000-0000',
      line2: 'Endereço da empresa: preencher nas Configurações',
      line3: 'www.suaempresa.com.br',
      headerImg: 'assets/header.jpg'
    };
  }

  /* ── Dados fiscais da empresa (emitente) ─── */

  function defaultFiscal() {
    return {
      razaoSocial: '',
      cnpj: '',
      ie: '',
      im: '',
      cnae: '',
      regime: '',
      endereco: '',
      cidade: '',
      telefone: '',
      email: ''
    };
  }

  /* ── Status de nota fiscal (padrão) ──────── */

  function defaultInvoiceStatuses() {
    return [
      { key: 'draft', label: 'Rascunho', locked: true },
      { key: 'issued', label: 'Emitida', locked: true },
      { key: 'cancelled', label: 'Cancelada', locked: true },
      { key: 'returned', label: 'Devolvida', locked: true }
    ];
  }

  function statusSlugKey(s) {
    var t = String(s || '').toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* silent */ }
    t = t.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return t || ('status_' + Date.now().toString(36));
  }

  /* ── Modelos de nota fiscal (padrão) ─────── */

  function padNFNumber(n) {
    var s = String(n);
    while (s.length < 6) s = '0' + s;
    return s;
  }

  function defaultInvoiceModels() {
    return [
      {
        id: uid('im'), name: 'Nota de Produto', type: 'produto', geraFinanceiro: true,
        fields: [
          { key: 'naturezaOperacao', label: 'Natureza da operação', type: 'select', required: true, options: [
            'Venda de mercadoria',
            'Venda de mercadoria sujeita a substituição tributária',
            'Remessa',
            'Remessa por conta e ordem',
            'Remessa para industrialização',
            'Devolução de compra',
            'Transferência de mercadoria'
          ] }
        ]
      },
      {
        id: uid('im'), name: 'Nota de Remessa', type: 'remessa', geraFinanceiro: false,
        fields: [
          { key: 'naturezaOperacao', label: 'Natureza da operação', type: 'select', required: true, options: [
            'Remessa para industrialização',
            'Remessa por conta e ordem',
            'Remessa para venda futura',
            'Remessa para depósito',
            'Devolução de remessa'
          ] }
        ]
      },
      {
        id: uid('im'), name: 'Nota de Serviço', type: 'servico', geraFinanceiro: true,
        fields: [
          { key: 'codigoServico', label: 'Código do serviço', type: 'text', required: false },
          { key: 'tributacao', label: 'Tributação', type: 'select', required: true, options: [
            'Tributável no município', 'Imune', 'Isenta', 'Não tributável'
          ] },
          { key: 'iss', label: 'ISS alíquota (%)', type: 'number', required: false },
          { key: 'retencao', label: 'Retenção de ISS', type: 'select', required: false, options: ['Não', 'Sim'] },
          { key: 'cidadePrestacao', label: 'Cidade da prestação', type: 'text', required: false }
        ]
      }
    ];
  }

  /* ── Modelo em branco de proposta ──────────
     Mantém a estrutura funcional (capa + tabela comercial, coluna
     "Valor" como texto livre) mas sem nenhum dado de terceiro: o
     usuário escolhe o cliente e preenche os valores. */

  function blocoCapa() {
    return {
      id: uid('b'), type: 'cover', label: 'Capa',
      data: {
        date: '',
        recipient: '',
        proposalNumber: '',
        contactName: '',
        contactPhone: '',
        address: '',
        georevestContacts: [{ name: '', role: '', phone: '', email: '' }],
        formatted: {},
        extras: []
      },
      hidden: []
    };
  }

  function blocoComercial() {
    return {
      id: uid('b'), type: 'commercial', label: 'Proposta Comercial',
      data: {
        title: 'Proposta Comercial',
        proposalNumber: '',
        description: '',
        cols: ['Item', 'Quantidade', 'Descrição', 'Valor'],
        rows: [['1', '1', '', '']],
        showTotal: true,
        formatted: {},
        extras: []
      },
      hidden: []
    };
  }

  function baseBlocks() {
    return [blocoCapa(), blocoComercial()];
  }

  function defaultLayout() {
    var f = defaultFooter();
    if (db && db.config && db.config.footer) {
      f = applyConfigDefaults(JSON.parse(JSON.stringify(db.config.footer)));
    }
    return {
      blocks: baseBlocks(),
      footer: f,
      margins: { top: 0, right: 20, bottom: 0, left: 20 },
      paper: { size: 'A4', orientation: 'portrait' }
    };
  }

  /* ── Whitelist de campos por entidade ───────
     Campo fora da lista é IGNORADO no update e no import. Isso fecha a
     porta de mass assignment (um "modelId" no payload do formulário
     não pode mais reescrever o registro) e a de __proto__.
     Objetos aninhados (layout, contacts, items, emitente...) são
     preservados por inteiro: só passam pela limpeza de chave perigosa. */

  var CAMPOS = {
    clients: ['id', 'name', 'company', 'cnpj', 'inscricaoEstadual', 'inscricaoMunicipal',
      'cep', 'phone', 'email', 'address', 'notes', 'createdAt', 'updatedAt'],
    partners: ['id', 'name', 'cnpj', 'cep', 'address', 'contacts', 'contract', 'notes', 'createdAt', 'updatedAt'],
    proposals: ['id', 'name', 'clientId', 'status', 'partners', 'layout', 'revisions', 'revision', '_budgetFp', 'createdAt', 'updatedAt'],
    templates: ['id', 'name', 'layout', 'createdAt', 'updatedAt'],
    invoices: ['id', 'number', 'status', 'payment', 'dueDate', 'paymentDate', 'issuedAt',
      'proposalId', 'clientId', 'modelId', 'type', 'geraFinanceiro', 'emitente', 'destinatario',
      'modelData', 'items', 'total', 'observacoes', 'referencia', 'createdAt', 'updatedAt'],
    invoiceModels: ['id', 'name', 'type', 'geraFinanceiro', 'fields', 'createdAt', 'updatedAt']
  };
  var COLECOES_ID = ['clients', 'partners', 'proposals', 'templates', 'invoices', 'invoiceModels'];

  /* Campos que NÃO são edição do usuário. Não entram na comparação de
     negócio entre abas: carimbo de tempo, identificador e a marca de erro
     de gravação mudam sozinhos, sem que ninguém tenha digitado nada. */
  var CAMPOS_LIVRES = { id: 1, createdAt: 1, updatedAt: 1, __erroGravacao: 1 };

  var CAMPOS_CONFIG = ['footer', 'fiscal', 'invoiceStatuses', 'company', 'monthlyGoal',
    'cnpj', 'logo', 'endereco', 'createdAt', 'updatedAt'];

  var CAMPOS_META = ['rev', 'updatedAt', 'origem', 'versao'];

  /* ── Limpeza profunda ────────────────────── */

  function sanitizeProfundo(v, profundidade) {
    if (profundidade > 40) return null;
    if (v === null || v === undefined) return null;
    var t = typeof v;
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'number') return isFinite(v) ? v : 0;
    if (t === 'function' || t === 'symbol') return undefined;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
    if (Array.isArray(v)) {
      var arr = [];
      for (var i = 0; i < v.length; i++) {
        var it = sanitizeProfundo(v[i], profundidade + 1);
        arr.push(it === undefined ? null : it);
      }
      return arr;
    }
    if (t === 'object') {
      var o = {};
      for (var k in v) {
        if (!temPropriedade(v, k)) continue;
        if (CHAVES_PERIGO[k]) continue;
        var limpo = sanitizeProfundo(v[k], profundidade + 1);
        if (limpo === undefined) continue;
        o[k] = limpo;
      }
      return o;
    }
    return null;
  }

  function aplicarWhitelist(origem, campos, relatorio, colecao) {
    var saida = {};
    if (!origem || typeof origem !== 'object' || Array.isArray(origem)) return saida;
    var i;
    for (i = 0; i < campos.length; i++) {
      var k = campos[i];
      if (!temPropriedade(origem, k)) continue;
      if (CHAVES_PERIGO[k]) continue;
      var limpo = sanitizeProfundo(origem[k], 0);
      if (limpo === undefined) continue;
      saida[k] = limpo;
    }
    for (var k2 in origem) {
      if (!temPropriedade(origem, k2)) continue;
      if (CHAVES_PERIGO[k2]) { if (relatorio) relatorio.bloqueados[k2] = (relatorio.bloqueados[k2] || 0) + 1; continue; }
      if (tem(campos, k2)) continue;
      if (relatorio) {
        relatorio.desconhecidos[k2] = (relatorio.desconhecidos[k2] || 0) + 1;
        if (colecao) {
          var marca = colecao + '.' + k2;
          relatorio.descartados[marca] = (relatorio.descartados[marca] || 0) + 1;
        }
      }
    }
    /* for..in não enumera '__proto__' em todo motor, então a chave é
       conferida à mão: é a que o JSON.parse transforma em propriedade
       própria e a que contamina o prototype numa atribuição direta. */
    if (relatorio) {
      ['__proto__', 'constructor', 'prototype'].forEach(function (perigosa) {
        if (temPropriedade(origem, perigosa)) {
          relatorio.bloqueados[perigosa] = (relatorio.bloqueados[perigosa] || 0) + 1;
        }
      });
    }
    return saida;
  }

  /* Relógio de comparação entre registros. Também aceita 'ts', usado
     nos registros de exclusão, que não são entidades de negócio. */
  function tsDe(o) {
    if (!o) return 0;
    var t = o.updatedAt;
    if (t === undefined || t === null || t === '') t = o.createdAt;
    if (t === undefined || t === null || t === '') t = o.ts;
    if (t === undefined || t === null || t === '') return 0;
    if (typeof t === 'number') return t;
    var n = new Date(t).getTime();
    return isNaN(n) ? 0 : n;
  }

  function revDe(o) {
    if (!o || !o.__meta) return 0;
    var n = Number(o.__meta.rev);
    return isNaN(n) ? 0 : n;
  }

  /* ── Estado base do app (exemplo) ──────────
     Só roda em primeiro uso ou em reset(). Os dados abaixo são
     obviamente fictícios: nome genérico, telefone de exemplo e CNPJ
     válido no formato mas de raiz inexistente. */

  function seedData() {
    var t = Date.now();
    var d1 = new Date(t - 5 * 86400000);
    var d2 = new Date(t - 12 * 86400000);
    var d3 = new Date(t - 20 * 86400000);

    var clientA = { id: uid('cl'), name: 'Contato Exemplo A', company: 'Cliente Exemplo Ltda.', cnpj: '11.222.333/0001-81', cep: '', phone: '(11) 3000-0001', email: 'contato@exemplo-a.invalid', address: 'Endereço de exemplo, 1 - Cidade Exemplo/SP', notes: 'Exemplo: reservas de água com 12 e 4 pavimentos.', createdAt: d3, updatedAt: d3 };
    var clientB = { id: uid('cl'), name: 'Contato Exemplo B', company: 'Condomínio Exemplo', cnpj: '11.222.333/0002-62', cep: '', phone: '(11) 3000-0002', email: 'sindico@exemplo-b.invalid', address: 'Endereço de exemplo, 2 - Cidade Exemplo/SP', notes: 'Exemplo: proposta enviada aguardando retorno.', createdAt: d2, updatedAt: d2 };
    var clientC = { id: uid('cl'), name: 'Contato Exemplo C', company: 'Síndica Exemplo', cnpj: '11.222.333/0003-43', cep: '', phone: '(11) 3000-0003', email: 'contato@exemplo-c.invalid', address: 'Endereço de exemplo, 3 - Cidade Exemplo/SP', notes: '', createdAt: d1, updatedAt: d1 };

    var partnerA = {
      id: uid('pa'), name: 'Fornecedor Exemplo Ltda.', cnpj: '11.222.333/0002-62', cep: '',
      address: 'Endereço de exemplo, 1500 - Cidade Exemplo/SP',
      contacts: [
        { id: uid('pc'), name: 'Contato Exemplo 1', email: 'contato1@exemplo.invalid', phones: [{ id: uid('pp'), number: '(11) 3000-0010' }] },
        { id: uid('pc'), name: 'Contato Exemplo 2', email: 'contato2@exemplo.invalid', phones: [{ id: uid('pp'), number: '(11) 3000-0020' }, { id: uid('pp'), number: '(11) 3000-0021' }] }
      ],
      contract: null,
      notes: '',
      createdAt: d2, updatedAt: d2
    };

    var layout1 = defaultLayout();
    var layout2 = defaultLayout();
    var layout3 = defaultLayout();

    /* A capa do exemplo mostra que o layout serve, sem inventar cliente. */
    function marcarCapa(layout, rotulo) {
      var capa = (layout.blocks || []).filter(function (b) { return b.type === 'cover'; })[0];
      if (!capa || !capa.data) return;
      capa.data.date = todayLabel();
      capa.data.recipient = rotulo;
      return layout;
    }
    marcarCapa(layout1, 'Cliente Exemplo Ltda.');
    marcarCapa(layout2, 'Condomínio Exemplo');
    marcarCapa(layout3, 'Síndica Exemplo');

    var propA = {
      id: uid('pr'), name: 'Proposta de exemplo — reservatórios',
      clientId: clientA.id, status: 'draft',
      partners: [
        {
          partnerId: partnerA.id,
          role: 'technical',
          commissionType: 'percent',
          commissionValue: 3,
          showOnProposal: true,
          notes: 'Execução técnica e ensaios de estanqueidade'
        }
      ],
      layout: layout1,
      createdAt: d3, updatedAt: new Date(t - 2 * 86400000)
    };
    var propB = {
      id: uid('pr'), name: 'Proposta de exemplo — impermeabilização',
      clientId: clientB.id, status: 'sent',
      partners: [
        {
          partnerId: partnerA.id,
          role: 'commercial',
          commissionType: 'percent',
          commissionValue: 5,
          showOnProposal: false,
          notes: 'Indicação do sindico'
        }
      ],
      layout: layout2,
      createdAt: d2, updatedAt: d2
    };
    var propC = {
      id: uid('pr'), name: 'Proposta de exemplo — revestimento',
      clientId: clientC.id, status: 'approved',
      partners: [],
      layout: layout3,
      createdAt: d1, updatedAt: d1
    };

    return {
      clients: [clientA, clientB, clientC],
      partners: [partnerA],
      proposals: [propA, propB, propC],
      templates: [
        { id: uid('tm'), name: 'Modelo padrão (em branco)', layout: JSON.parse(JSON.stringify(layout1)) }
      ],
      invoices: [],
      invoiceModels: defaultInvoiceModels(),
      nfSequence: {},
      config: {
        footer: defaultFooter(),
        fiscal: defaultFiscal(),
        invoiceStatuses: defaultInvoiceStatuses(),
        company: '',
        monthlyGoal: 0
      },
      activeProposalId: propA.id,
      __meta: { rev: 0, updatedAt: agoraISO(), origem: TAB_ID, versao: FORMAT_VERSION },
      __avisos: [],
      __excluidos: []
    };
  }

  /* ── Avisos (rastreáveis) ───────────────────
     Dado que falha validação é sinalizado, nunca apagado: perder um
     cadastro porque o contador digitou um dígito errado é pior que
     mostrar um aviso. */

  var avisos = [];
  function aviso(chave, tipo, mensagem) {
    for (var i = 0; i < avisos.length; i++) {
      if (avisos[i].chave === chave) { avisos[i].vezes = (avisos[i].vezes || 1) + 1; return avisos[i]; }
    }
    var a = { chave: chave, tipo: tipo, mensagem: mensagem, ts: agoraISO(), vezes: 1 };
    avisos.push(a);
    if (avisos.length > LIMITE_AVISOS) avisos.shift();
    return a;
  }

  function getAvisos() { return avisos.slice(); }

  /* ── Store ───────────────────────────────── */

  var db = null;
  var revCarregada = -1;
  var ultimoRaw = null;
  var integrando = false;
  var pendenteDeGravacao = false;
  var ultimoErroGravacao = null;
  var ultimoConflito = null;
  var ultimoRelatorioImport = null;
  var ultimoRelatorioBackup = null;
  var ultimoErroNormalizacao = null;
  var somenteLeitura = false;

  var conflitoCbs = [];
  var substituicaoCbs = [];

  function onConflito(cb) {
    if (typeof cb !== 'function') return function () { };
    conflitoCbs.push(cb);
    return function () { var i = conflitoCbs.indexOf(cb); if (i !== -1) conflitoCbs.splice(i, 1); };
  }

  /* Dispara quando o objeto em memória é trocado por inteiro (restaurar
     backup, importar, reset) ou quando a integração com outra aba
     substituiu registros. O editor-ux PRECISA se incretar aqui: o state
     dele é uma cópia do layout e sobrescreve o que foi restaurado. */
  function onStoreReplaced(cb) {
    if (typeof cb !== 'function') return function () { };
    substituicaoCbs.push(cb);
    return function () { var i = substituicaoCbs.indexOf(cb); if (i !== -1) substituicaoCbs.splice(i, 1); };
  }

  function avisarSubstituicao(info) {
    for (var i = 0; i < substituicaoCbs.length; i++) {
      try { substituicaoCbs[i](info || {}); } catch (e) { /* silent */ }
    }
  }

  function avisarConflito(c) {
    ultimoConflito = c;
    if (!c || !c.houve) return;
    for (var i = 0; i < conflitoCbs.length; i++) {
      try { conflitoCbs[i](c); } catch (e) { /* silent */ }
    }
  }

  function lastConflito() { return ultimoConflito; }
  function isDirty() { return pendenteDeGravacao; }
  function ultimoErro() { return ultimoErroGravacao; }

  /* ── Normalização (migração idempotente) ──── */

  /* ── Saneamento de forma ───────────────────
     Uma lista cujo item deveria ser objeto pode conter string, número ou
     null: dado gravado por versão anterior do schema, ou gravação
     interrompida no meio. Escrever `pt.role = ...` em cima de uma
     string lança TypeError DENTRO de load(), e aí o app não abre -
     tela branca, nenhum dado acessível. A única recuperação seria o
     usuário limpar o localStorage na mão, o que apaga TUDO. Para app de
     campo, sem servidor e sem backup confiável, é o pior bug possível.

     Por isso a forma é conferida ANTES de qualquer escrita em item de
     lista. O mesmo conjunto já existia em valorComparavel() (usado só
     na comparação entre abas) e nunca voltou para cá: uma hipótese
     única, dois lugares, só um endurecido. */

  function ehRegistro(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  /* Descreve o valor para a mensagem. Curto de propósito: os avisos são
     lidos em sequência, não arquivados. */
  function formaDe(v) {
    if (v === null) return 'nulo';
    if (v === undefined) return 'indefinido';
    if (Array.isArray(v)) return 'lista';
    var t = typeof v;
    if (t === 'string') return 'texto "' + (v.length > 32 ? v.slice(0, 32) + '...' : v) + '"';
    if (t === 'number' || t === 'boolean') return t + ' ' + String(v);
    return t;
  }

  /* `recuperar` recebe o item bruto e devolve o objeto reconstruído, ou
     null para indicar que não há o que recuperar. O que não vira objeto
     é descartado - e cada descarte vira aviso, porque dado perdido em
     silêncio é pior que dado faltando com registro. */
  function sanearLista(origem, rotulo, recuperar) {
    if (!Array.isArray(origem)) {
      if (origem !== undefined && origem !== null) {
        aviso('forma:' + rotulo, 'forma',
          rotulo + ' não era uma lista, e sim ' + formaDe(origem) + '. Foi substituída por uma lista vazia.');
      }
      return [];
    }
    var saida = [];
    for (var i = 0; i < origem.length; i++) {
      var item = origem[i];
      if (ehRegistro(item)) { saida.push(item); continue; }
      var recuperado = recuperar ? recuperar(item) : null;
      if (ehRegistro(recuperado)) { saida.push(recuperado); continue; }
      aviso('forma:' + rotulo + ':' + i + ':' + formaDe(item), 'forma',
        'O item ' + (i + 1) + ' de ' + rotulo + ' não era um registro válido (' + formaDe(item) +
        ') e foi descartado. Os demais itens foram mantidos.');
    }
    return saida;
  }

  /* Formato antigo: `proposal.partners` era a lista de ids do parceiro.
     A string É um id, e o id resolve - então converter preserva quem
     participava da proposta, que é informação de negócio (indicação e
     comissão) e não se reconstrói sozinha. Descartar perderia o vínculo
     em silêncio. Se o id não existe em db.partners não há vínculo a
     recuperar: aí sim se descarta, com aviso. */
  function recuperarVinculoParceiro(bruto, porId) {
    if (typeof bruto !== 'string') return null;
    var id = bruto.trim();
    if (!id || !porId[id]) return null;
    return {
      partnerId: id,
      role: 'commercial',
      commissionType: 'percent',
      commissionValue: 0,
      showOnProposal: false,
      recuperado: true
    };
  }

  /* Contato em forma de string não diz se era nome ou telefone. O texto
     vai para o campo visível, inteiro, e o usuário corrige em dois
     cliques - descartar faria a informação sumir sem ninguém perceber
     que havia algo ali. `recuperado` marca a linha para a UI explicar. */
  function recuperarContato(bruto) {
    if (typeof bruto !== 'string') return null;
    var nome = bruto.trim();
    if (!nome) return null;
    return { id: uid('pc'), name: nome, email: '', phones: [], recuperado: true };
  }

  function recuperarTelefone(bruto) {
    if (typeof bruto !== 'string') return null;
    var numero = bruto.trim();
    if (!numero) return null;
    return { id: uid('pp'), number: numero, recuperado: true };
  }

  /* Status de nota em forma de string é o rótulo (ou a chave) que o
     usuário tinha digitado. Vira registro com esse mesmo texto, para a
     lista de status continuar mostrando o que ele reconhece. */
  function recuperarStatusNota(bruto) {
    if (typeof bruto !== 'string') return null;
    var txt = bruto.trim();
    if (!txt) return null;
    return { key: statusSlugKey(txt), label: txt, locked: false, recuperado: true };
  }

  function indiceDeParceiros() {
    var porId = {};
    (db.partners || []).forEach(function (p) { if (ehRegistro(p) && p.id) porId[p.id] = true; });
    return porId;
  }

  /* Rede debaixo da rede: só as garantias de forma que a UI consome.
     Roda mesmo quando a normalização completa falhou, e por construção
     não pode lançar - não lê nada sem conferir o tipo antes. */
  function garantirFormaMinima() {
    if (!db) return;
    if (!Array.isArray(db.proposals)) db.proposals = [];
    if (!Array.isArray(db.partners)) db.partners = [];
    if (!db.config || typeof db.config !== 'object' || Array.isArray(db.config)) db.config = {};
    var porId = indiceDeParceiros();
    db.proposals.forEach(function (p) {
      if (!ehRegistro(p)) return;
      p.partners = sanearLista(p.partners, 'os parceiros de uma proposta', function (bruto) {
        return recuperarVinculoParceiro(bruto, porId);
      });
    });
    db.partners.forEach(function (p) {
      if (!ehRegistro(p)) return;
      p.contacts = sanearLista(p.contacts, 'os contatos de um parceiro', recuperarContato);
      p.contacts.forEach(function (c) {
        if (!ehRegistro(c)) return;
        c.phones = sanearLista(c.phones, 'os telefones de um contato', recuperarTelefone);
      });
    });
    if (db.config.invoiceStatuses !== undefined && db.config.invoiceStatuses !== null) {
      db.config.invoiceStatuses = sanearLista(db.config.invoiceStatuses, 'os status de nota fiscal', recuperarStatusNota);
    }
  }

  function corrigirDatas(o) {
    if (!o || !F || typeof F.toISODate !== 'function') return;
    ['dueDate', 'paymentDate', 'issuedAt'].forEach(function (campo) {
      var v = o[campo];
      if (v === undefined || v === null || v === '') return;
      var iso = F.toISODate(v);
      if (iso && iso !== v) {
        aviso('data:' + campo + ':' + v, 'data',
          'Data "' + campo + '" normalizada de "' + v + '" para "' + iso + '" (fuso horário).');
        o[campo] = iso;
      }
    });
  }

  /* Máscara só ao salvar. Valor divergente do original fica registrado
     em __avisos para o usuário conferir, nunca descartado. */
  function aplicarMascaras() {
    if (!F) return;
    function mascara(alvo, campo, formatador, rotulo) {
      if (!alvo || typeof alvo !== 'object') return;
      var v = alvo[campo];
      if (typeof v !== 'string' || !v.trim()) return;
      var m = formatador(v);
      if (m && m !== v) {
        aviso('mascara:' + rotulo + ':' + v, 'mascara',
          'Campo "' + rotulo + '" salvo como "' + m + '" (o valor digitado era "' + v + '").');
        alvo[campo] = m;
      }
    }
    (db.clients || []).forEach(function (c) {
      mascara(c, 'cnpj', F.formatCnpj, 'CNPJ do cliente');
      mascara(c, 'cep', F.formatCep, 'CEP do cliente');
    });
    (db.partners || []).forEach(function (p) {
      mascara(p, 'cnpj', F.formatCnpj, 'CNPJ do parceiro');
      mascara(p, 'cep', F.formatCep, 'CEP do parceiro');
    });
    (db.invoices || []).forEach(function (nf) {
      mascara(nf.emitente, 'cnpj', F.formatCnpj, 'CNPJ do emitente');
      mascara(nf.destinatario, 'cnpj', F.formatCnpj, 'CNPJ do destinatário');
      corrigirDatas(nf);
    });
    if (db.config && db.config.fiscal) {
      mascara(db.config.fiscal, 'cnpj', F.formatCnpj, 'CNPJ da empresa');
    }
  }

  function validarDocumentos() {
    (db.clients || []).forEach(function (c) {
      if (!c.cnpj) return;
      if (!F || typeof F.isValidCnpj !== 'function') return;
      if (!F.isValidCnpj(c.cnpj)) {
        aviso('cnpj:cliente:' + c.id, 'cnpj',
          'CNPJ "' + c.cnpj + '" do cliente "' + (c.company || c.name || c.id) + '" não passa no dígito verificador. O cadastro foi mantido.');
      }
    });
    (db.partners || []).forEach(function (p) {
      if (!p.cnpj) return;
      if (!F || typeof F.isValidCnpj !== 'function') return;
      if (!F.isValidCnpj(p.cnpj)) {
        aviso('cnpj:parceiro:' + p.id, 'cnpj',
          'CNPJ "' + p.cnpj + '" do parceiro "' + (p.name || p.id) + '" não passa no dígito verificador. O cadastro foi mantido.');
      }
    });
  }

  /* Referência órfã vira null e fica registrada. Nunca vira objeto
     fantasma: addressar um id inexistente quebra a impressão. */
  function validarReferencias() {
    var temCliente = {};
    (db.clients || []).forEach(function (c) { if (c && c.id) temCliente[c.id] = true; });
    var temProposta = {};
    (db.proposals || []).forEach(function (p) { if (p && p.id) temProposta[p.id] = true; });
    var temParceiro = {};
    (db.partners || []).forEach(function (p) { if (p && p.id) temParceiro[p.id] = true; });
    var temModelo = {};
    (db.invoiceModels || []).forEach(function (m) { if (m && m.id) temModelo[m.id] = true; });

    (db.proposals || []).forEach(function (p) {
      if (!p) return;
      if (p.clientId && !temCliente[p.clientId]) {
        aviso('ref:proposta:' + p.id + ':clientId', 'ref-orfa',
          'A proposta "' + (p.name || p.id) + '" apontava para o cliente "' + p.clientId + '", que não existe mais. Vínculo removido.');
        p.clientId = null;
      }
      (p.partners || []).forEach(function (pt) {
        if (!pt || !pt.partnerId) return;
        if (temParceiro[pt.partnerId]) { delete pt.parceiroOrfao; return; }
        /* Comissão preservada: só o vínculo some, e o nome fica gravado
           para a UI explicar de onde veio o registro. */
        if (!pt.parceiroOrfao) {
          aviso('ref:proposta:' + p.id + ':parceiro:' + pt.partnerId, 'ref-orfa',
            'O parceiro "' + pt.partnerId + '" da proposta "' + (p.name || p.id) + '" não existe mais. A comissão foi mantida no histórico.');
        }
        pt.parceiroOrfao = true;
      });
    });

    (db.invoices || []).forEach(function (nf) {
      if (!nf) return;
      if (nf.proposalId && !temProposta[nf.proposalId]) {
        aviso('ref:nota:' + nf.id + ':proposalId', 'ref-orfa',
          'A nota nº ' + (nf.number || nf.id) + ' apontava para uma proposta que não existe mais. Vínculo removido.');
        nf.proposalId = null;
      }
      if (nf.clientId && !temCliente[nf.clientId]) {
        aviso('ref:nota:' + nf.id + ':clientId', 'ref-orfa',
          'A nota nº ' + (nf.number || nf.id) + ' apontava para um cliente que não existe mais. Vínculo removido.');
        nf.clientId = null;
      }
      if (nf.modelId && !temModelo[nf.modelId]) {
        aviso('ref:nota:' + nf.id + ':modelId', 'ref-orfa',
          'A nota nº ' + (nf.number || nf.id) + ' usava um modelo de nota que não existe mais. Os dados da operação já gravados foram preservados.');
        nf.modelData = nf.modelData || {};
        nf.modelRemovido = true;
      }
    });
  }

  function normalizarPropostas() {
    var porId = indiceDeParceiros();
    (db.proposals || []).forEach(function (p) {
      if (!ehRegistro(p)) return;
      p.partners = sanearLista(p.partners, 'os parceiros da proposta "' + (p.name || p.id) + '"', function (bruto) {
        return recuperarVinculoParceiro(bruto, porId);
      });
      p.partners.forEach(function (pt) {
        if (!ehRegistro(pt)) return;
        if (!pt.role) pt.role = 'commercial';
        if (!pt.commissionType) pt.commissionType = 'percent';
        if (pt.commissionValue === undefined) pt.commissionValue = 0;
        if (pt.showOnProposal === undefined) pt.showOnProposal = false;
      });
      if (p.revision === undefined) p.revision = 1;
      if (!Array.isArray(p.revisions)) p.revisions = [];
      if (!p.layout) p.layout = defaultLayout();
      corrigirDatas(p);
    });
  }

  function normalizeDb() {
    if (!db) return;
    if (!Array.isArray(db.clients)) db.clients = [];
    if (!Array.isArray(db.partners)) db.partners = [];
    if (!Array.isArray(db.proposals)) db.proposals = [];
    if (!Array.isArray(db.templates)) db.templates = [];
    if (!Array.isArray(db.invoices)) db.invoices = [];
    if (!db.nfSequence || typeof db.nfSequence !== 'object') db.nfSequence = {};
    if (!db.config || typeof db.config !== 'object') db.config = { footer: defaultFooter(), fiscal: defaultFiscal(), invoiceStatuses: defaultInvoiceStatuses() };
    if (!db.config.footer) db.config.footer = defaultFooter();
    if (!db.config.fiscal) db.config.fiscal = defaultFiscal();
    if (!Array.isArray(db.config.invoiceStatuses) || !db.config.invoiceStatuses.length) {
      db.config.invoiceStatuses = defaultInvoiceStatuses();
    } else {
      /* Item nulo aqui derrubava o load inteiro em `s.key`. Status sem
         rótulo também: addInvoiceStatus() quebra em s.label.toLowerCase()
         e a impressão sai com a coluna em branco. */
      db.config.invoiceStatuses = sanearLista(db.config.invoiceStatuses, 'os status de nota fiscal', recuperarStatusNota);
      defaultInvoiceStatuses().forEach(function (d) {
        if (!db.config.invoiceStatuses.some(function (s) { return s.key === d.key; })) {
          db.config.invoiceStatuses.unshift(d);
        }
      });
      db.config.invoiceStatuses.forEach(function (s) {
        if (!s.key) s.key = statusSlugKey(s.label || '');
        if (!s.label) s.label = s.key || '';
      });
    }
    if (!Array.isArray(db.invoiceModels) || !db.invoiceModels.length) {
      db.invoiceModels = defaultInvoiceModels();
    }
    db.invoiceModels.forEach(function (m) {
      if (!ehRegistro(m)) return;
      if (!m.type) m.type = 'custom';
      if (m.geraFinanceiro === undefined) m.geraFinanceiro = true;
      if (!Array.isArray(m.fields)) m.fields = [];
    });
    db.invoices.forEach(function (nf) {
      if (!ehRegistro(nf)) return;
      if (!nf.issuedAt) nf.issuedAt = null;
      if (!nf.emitente) nf.emitente = {};
      if (!nf.destinatario) nf.destinatario = {};
      if (!Array.isArray(nf.items)) nf.items = [];
      if (!nf.modelData) nf.modelData = {};
      if (!nf.payment) nf.payment = 'pending';
      if (!nf.dueDate) nf.dueDate = '';
      if (!nf.paymentDate) nf.paymentDate = '';
      if (nf.geraFinanceiro === undefined) nf.geraFinanceiro = true;
      corrigirDatas(nf);
    });
    normalizarPropostas();
    db.partners.forEach(function (p) {
      normalizePartner(p);
      validarContrato(p);
    });
    db.templates.forEach(function (t) {
      if (!ehRegistro(t)) return;
      if (!t.layout) t.layout = defaultLayout();
    });
    if (db.activeProposalId === undefined || db.activeProposalId === null) db.activeProposalId = '';
    if (!Array.isArray(db.__excluidos)) db.__excluidos = [];
    if (!db.__meta || typeof db.__meta !== 'object') db.__meta = { rev: 0, updatedAt: agoraISO(), origem: TAB_ID, versao: FORMAT_VERSION };
    if (!Number(db.__meta.rev)) db.__meta.rev = 0;
    if (!db.__meta.versao) db.__meta.versao = FORMAT_VERSION;
    db.__avisos = avisos;
    validarReferencias();
    validarDocumentos();
  }

  /* ── Import: whitelist + limpeza ─────────── */

  function novoRelatorio() {
    /* Sem prototype: o contador de "__proto__" precisa ser uma chave real.
       Num objeto normal, `rel.bloqueados['__proto__'] = 1` é engolido em
       silêncio pelo setter do prototype - o relatório diria que não achou
       chave perigosa nenhuma. */
    return {
      desconhecidos: Object.create(null),
      bloqueados: Object.create(null),
      /* "colecao.campo" -> quantas vezes. Só para o aviso do load: o
         relatório do import já mostra os nomes, o do load não mostrava. */
      descartados: Object.create(null),
      registros: 0,
      idsGerados: 0,
      avisos: []
    };
  }

  /* Um campo fora da whitelist não é ignorado só no formulário: ele é
     descartado também no load(), porque sanitizarRaiz() passa por ela. Sem
     registro algum, o dado evaporava sem aviso - foi assim que a Inscrição
     Estadual/Municipal do cliente sumiu depois de ser digitada. A chave do
     aviso é o próprio campo, então repetir o load não repete o ruído. */
  function avisarCamposDescartados(rel) {
    if (!rel || !rel.descartados) return;
    for (var k in rel.descartados) {
      if (!temPropriedade(rel.descartados, k)) continue;
      var corte = k.lastIndexOf('.');
      var colecao = corte === -1 ? k : k.slice(0, corte);
      var campo = corte === -1 ? '' : k.slice(corte + 1);
      aviso('descartado:' + k, 'campo-descartado',
        'O campo "' + campo + '" de "' + colecao + '" foi descartado ao carregar os dados: ' +
        'ele não é um dos campos que o Georevest guarda. Se você digitou esse dado, ' +
        'ele não foi salvo.');
    }
  }

  function sanitizarRaiz(origem, relatorio) {
    var saida = {};
    COLECOES_ID.forEach(function (nome) {
      var bruto = origem[nome];
      if (bruto !== undefined && !Array.isArray(bruto)) {
        relatorio.avisos.push('A coleção "' + nome + '" não era uma lista e foi substituída por vazia.');
        bruto = [];
      }
      saida[nome] = (bruto || []).map(function (rec) {
        var base = aplicarWhitelist(rec, CAMPOS[nome], relatorio, nome);
        if (!base.id) {
          base.id = uid('rec');
          relatorio.idsGerados += 1;
          relatorio.avisos.push('Um registro de "' + nome + '" sem id ganhou id "' + base.id + '".');
        }
        if (!base.createdAt) base.createdAt = agoraISO();
        if (!base.updatedAt) base.updatedAt = base.createdAt;
        relatorio.registros += 1;
        return base;
      });
    });

    var seq = {};
    var brutoSeq = origem.nfSequence;
    if (brutoSeq && typeof brutoSeq === 'object' && !Array.isArray(brutoSeq)) {
      for (var k in brutoSeq) {
        if (!temPropriedade(brutoSeq, k) || CHAVES_PERIGO[k]) continue;
        var n = parseInt(brutoSeq[k], 10);
        if (!isNaN(n)) seq[k] = n;
      }
    }
    saida.nfSequence = seq;

    /* config é uma bolsa de preferências do usuário: chave desconhecida
       é preservada (perder configuração é perda real), exceto perigosa. */
    var cfg = origem.config;
    saida.config = {};
    if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
      for (var c in cfg) {
        if (!temPropriedade(cfg, c)) continue;
        if (CHAVES_PERIGO[c]) { relatorio.bloqueados[c] = (relatorio.bloqueados[c] || 0) + 1; continue; }
        var lv = sanitizeProfundo(cfg[c], 0);
        if (lv === undefined) continue;
        saida.config[c] = lv;
      }
    }

    saida.activeProposalId = typeof origem.activeProposalId === 'string' ? origem.activeProposalId : '';

    var meta = origem.__meta;
    saida.__meta = { rev: 0, updatedAt: agoraISO(), origem: TAB_ID, versao: FORMAT_VERSION };
    if (meta && typeof meta === 'object') {
      CAMPOS_META.forEach(function (k) {
        if (CHAVES_PERIGO[k] || !temPropriedade(meta, k)) return;
        var v = sanitizeProfundo(meta[k], 0);
        if (v !== undefined) saida.__meta[k] = v;
      });
    }
    saida.__meta.versao = FORMAT_VERSION;
    saida.__meta.origem = TAB_ID;

    var ex = [];
    var brutoEx = origem.__excluidos;
    if (Array.isArray(brutoEx)) {
      brutoEx.forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        if (CHAVES_PERIGO[e.colecao] || CHAVES_PERIGO[e.id]) return;
        if (!e.colecao || !e.id) return;
        ex.push({ colecao: String(e.colecao), id: String(e.id), ts: e.ts ? e.ts : agoraISO() });
      });
    }
    saida.__excluidos = ex.slice(-LIMITE_EXCLUIDOS);
    return saida;
  }

  /* ── Mesclagem entre abas ───────────────────
     Sem servidor para arbitrar, então a regra é conservadora e por
     registro: nada é sobrescrito em bloco, tudo é reconciliado por id. */

  /* ── Comparação de negócio entre abas ───────
     O relatório de conflito é o aviso que sobra para o usuário entender
     que outra aba mexeu no que ele estava mexendo. Se ele aparecer oito
     vezes quando aconteceu uma, ninguém lê mais nenhum.

     Por isso a comparação NÃO usa o JSON bruto do registro. Ela olha só
     os campos que o usuário controla (a whitelist da coleção), já
     normalizados dos dois lados, e ignora a ordem das chaves do objeto.
     Medido: com o JSON bruto, uma única criação de proposta na outra aba
     reportava "1 criado, 7 alterados nas DUAS abas" — sendo que dos 7,
     três só diferiam em `revision`/`revisions` (a memória já tinha o
     padrão, o payload recem-lido ainda não) e quatro não diferiam em
     campo nenhum: só na ordem em que as chaves foram montadas. */

  /* Padrão que a normalização injeta quando o campo está ausente. Aplicado
     dos dois lados, para que "ausente" e "já normalizado" não pareçam
     edição de ninguém. Deliberadamente fixo: defaultLayout() cria ids
     novos a cada chamada e produziria uma divergência falsa por registro. */
  function padraoDe(nome, campo) {
    if (nome === 'proposals') {
      if (campo === 'partners') return [];
      if (campo === 'revision') return 1;
      if (campo === 'revisions') return [];
      if (campo === 'layout') return '';
    }
    if (nome === 'invoices') {
      if (campo === 'issuedAt') return null;
      if (campo === 'emitente' || campo === 'destinatario' || campo === 'modelData') return {};
      if (campo === 'items') return [];
      if (campo === 'payment') return 'pending';
      if (campo === 'dueDate' || campo === 'paymentDate') return '';
      if (campo === 'geraFinanceiro') return true;
    }
    if (nome === 'invoiceModels') {
      if (campo === 'type') return 'custom';
      if (campo === 'geraFinanceiro') return true;
      if (campo === 'fields') return [];
    }
    if (nome === 'partners' && campo === 'contacts') return [];
    if (nome === 'templates' && campo === 'layout') return '';
    return undefined;
  }

  /* Serialização estável: chaves de objeto em ordem alfabética, listas
     na ordem em que estão (a ordem de uma revisão ou de um bloco é
     informação, não formatação). */
  function canonico(v, profundidade) {
    if (profundidade > 40) return '~';
    if (v === null || v === undefined) return 'nil';
    if (Array.isArray(v)) {
      var itens = [];
      for (var i = 0; i < v.length; i++) itens.push(canonico(v[i], profundidade + 1));
      return '[' + itens.join(',') + ']';
    }
    if (typeof v === 'object') {
      var ks = [];
      for (var k in v) { if (temPropriedade(v, k) && !CHAVES_PERIGO[k]) ks.push(k); }
      ks.sort();
      var corpo = [];
      for (var j = 0; j < ks.length; j++) corpo.push(ks[j] + ':' + canonico(v[ks[j]], profundidade + 1));
      return '{' + corpo.join(',') + '}';
    }
    if (typeof v === 'string') return 's' + v.length + ':' + v;
    return typeof v + ':' + String(v);
  }

  /* Corrige data sem registrar aviso: aqui é comparação, não gravação,
     e um aviso por registro comparado viraria ruído também. */
  function corrigirDatasSilencioso(o) {
    if (!o || !F || typeof F.toISODate !== 'function') return o;
    ['dueDate', 'paymentDate', 'issuedAt'].forEach(function (campo) {
      var v = o[campo];
      if (v === undefined || v === null || v === '') return;
      var iso = F.toISODate(v);
      if (iso) o[campo] = iso;
    });
    return o;
  }

  function valorComparavel(nome, campo, v) {
    var copia = sanitizeProfundo(v, 0);
    if (nome === 'proposals' && campo === 'partners' && Array.isArray(copia)) {
      copia.forEach(function (pt) {
        if (!pt || typeof pt !== 'object') return;
        if (!pt.role) pt.role = 'commercial';
        if (!pt.commissionType) pt.commissionType = 'percent';
        if (pt.commissionValue === undefined) pt.commissionValue = 0;
        if (pt.showOnProposal === undefined) pt.showOnProposal = false;
      });
    }
    if (nome === 'partners' && Array.isArray(copia)) {
      copia.forEach(function (ct) {
        if (ct && typeof ct === 'object' && !Array.isArray(ct.phones)) ct.phones = [];
      });
    }
    if (nome === 'invoices' && copia && typeof copia === 'object' && !Array.isArray(copia)) {
      corrigirDatasSilencioso(copia);
    }
    return canonico(copia, 0);
  }

  /* Impressão digital do que o usuário controla neste registro. */
  function negocioDe(nome, rec) {
    if (!rec || typeof rec !== 'object') return '~ausente~';
    var campos = CAMPOS[nome] || [];
    var partes = [];
    for (var i = 0; i < campos.length; i++) {
      var k = campos[i];
      if (CAMPOS_LIVRES[k]) continue;
      var v = temPropriedade(rec, k) ? rec[k] : padraoDe(nome, k);
      if (v === undefined) continue;
      partes.push(k + '=' + valorComparavel(nome, k, v));
    }
    return partes.join('');
  }

  /* Verdadeiro só quando houve edição de verdade dos dois lados. */
  function mesmoNegocio(nome, loc, rem) {
    return negocioDe(nome, loc) === negocioDe(nome, rem);
  }

  /* ── Detecção de conflito em três vias ──────
     Carimbo sozinho não separa "outra aba mexeu" de "outra aba E eu
     mexemos no mesmo registro". Os dois casos produzem conteúdo
     diferente e carimbos diferentes, e a diferença entre eles é quem
     precisa ser avisado. Sem isso, toda aba aberta enquanto outra
     trabalha reporta conflito a cada render, e o relatório deixa de
     significar alguma coisa.

     A terceira via é a base: o registro como ele veio DE FORA, na última
     integração. `houveEdicaoLocal` compara o registro em memória com essa
     base. Só quando esta aba mudou E o que veio de fora é diferente do que
     está em memória é divergência de verdade - e aí os dados de um dos
     lados estão sendo descartados, o que alguém precisa decidir.

     INVARIANTE: a base é preenchida SEMPRE a partir do payload remoto,
     nunca do banco local. Isso é o que faz a detecção funcionar, porque
     gravar() integra antes de escrever: se a base fosse tirada do banco
     já com o patch aplicado, a edição da própria aba entraria na base e
     pararia de contar como edição independente - e o conflito real
     entre duas abas seria reportado como "nada aconteceu". Foi
     exatamente o que aconteceu na medição: houve:false enquanto as duas
     abas se atropelavam no mesmo registro. */
  var ancestrais = {};

  function lembrarAncestral(remoto) {
    if (!remoto) return;
    if (!ancestrais.__pronto) ancestrais = { __pronto: 1 };
    Object.keys(CAMPOS).forEach(function (nome) {
      var lista = remoto[nome];
      if (!Array.isArray(lista)) return;
      var mapa = ancestrais[nome] || {};
      /* Só o que veio de fora entra na base. Registro ausente no remoto
         (criado aqui, ou apagado lá) mantém a base anterior. */
      lista.forEach(function (rec) {
        if (rec && rec.id) mapa[rec.id] = negocioDe(nome, rec);
      });
      ancestrais[nome] = mapa;
    });
  }

  function houveEdicaoLocal(nome, id, rec) {
    var mapa = ancestrais[nome];
    if (!mapa) return true; /* sem base, presunção de edição: melhor avisar */
    if (!temPropriedade(mapa, id)) return true; /* criado nesta aba */
    return mapa[id] !== negocioDe(nome, rec);
  }

  /* Conflito de verdade exige edição dos dois lados sobre o mesmo
     registro. Se esta aba não mexeu nele, o que está chegando é só uma
     atualização e não há nada a decidir. */
  function ehConflitoReal(nome, id, loc, rem) {
    if (mesmoNegocio(nome, loc, rem)) return false;
    return houveEdicaoLocal(nome, id, loc);
  }

  function mesclarColecao(local, remoto, nome, rel) {
    var i, id;
    var indiceLocal = {};
    for (i = 0; i < local.length; i++) { if (local[i] && local[i].id) indiceLocal[local[i].id] = i; }
    var indiceRemoto = {};
    for (i = 0; i < remoto.length; i++) { if (remoto[i] && remoto[i].id) indiceRemoto[remoto[i].id] = i; }

    /* Remote tem, local não: o registro novo da outra aba entra. */
    for (id in indiceRemoto) {
      if (!temPropriedade(indiceRemoto, id)) continue;
      if (temPropriedade(indiceLocal, id)) continue;
      local.push(remoto[indiceRemoto[id]]);
      rel.registros.push({ colecao: nome, id: id, motivo: 'novo' });
    }

    /* Existe nos dois: vence o updatedAt mais novo.

       O carimbo é o relógio de parede (ver agoraISO), então é comparável
       entre abas e a edição feita depois realmente vence - inclusive
       quando a outra aba estava com uma cópia velha do registro em mãos,
       que é o caso comum de duas abas abertas.

       Empate de carimbo com conteúdo diferente é concorrência de verdade
       e ninguém dos dois lados pode dizer qual é a certa: vale o local,
       porque descartar a edição que o usuário acabou de fazer na frente
       dele é pior que o conflito.

       O relatório só recebe 'divergente' quando os DOIS lados mudaram
       (ver ehConflitoReal). É isso que evita o alarme falso: uma aba que
       não mexeu no registro não tem nada a decidir sobre ele. */
    for (id in indiceLocal) {
      if (!temPropriedade(indiceLocal, id)) continue;
      if (!temPropriedade(indiceRemoto, id)) continue;
      var loc = local[indiceLocal[id]];
      var rem = remoto[indiceRemoto[id]];
      var tl = tsDe(loc);
      var tr = tsDe(rem);
      if (tr > tl) {
        local[indiceLocal[id]] = rem;
      } else if (tr === tl && !mesmoNegocio(nome, loc, rem)) {
        /* vale o local */
      }
      if (ehConflitoReal(nome, id, loc, rem)) {
        rel.registros.push({ colecao: nome, id: id, motivo: 'divergente' });
      }
    }
    return local;
  }

  /* Exclusões do outro lado chegam por 'remoto.__excluidos'. Sem isso o
     registro excluído numa aba volta na integração, porque a outra ainda
     o tinha em memória. */
  function aplicarExclusoes(lista, nome, rel, exclusoes) {
    var remotas = [];
    var i, j;
    for (i = 0; i < exclusoes.length; i++) {
      if (exclusoes[i] && exclusoes[i].colecao === nome && exclusoes[i].id) remotas.push(exclusoes[i]);
    }
    if (!remotas.length) return lista;
    var saida = [];
    for (i = 0; i < lista.length; i++) {
      var o = lista[i];
      var reviviu = false;
      var morreu = false;
      for (j = 0; j < remotas.length; j++) {
        if (remotas[j].id !== (o && o.id)) continue;
        /* Editado depois de excluído no outro lado: o registro volta. */
        if (tsDe(o) > tsDe(remotas[j])) { reviviu = true; break; }
        morreu = true;
        break;
      }
      if (morreu) rel.registros.push({ colecao: nome, id: o && o.id, motivo: 'removido' });
      else if (reviviu) rel.registros.push({ colecao: nome, id: o && o.id, motivo: 'revivido' });
      saida.push(o);
    }
    return saida;
  }

  function mesclar(local, remoto) {
    var rel = { houve: false, revLocal: revDe(local), revRemoto: revDe(remoto), registros: [], escala: {} };
    var i;
    if (!Array.isArray(local.__excluidos)) local.__excluidos = [];
    if (!Array.isArray(remoto.__excluidos)) remoto.__excluidos = [];
    COLECOES_ID.forEach(function (nome) {
      rel.escala[nome] = { local: (local[nome] || []).length, remoto: (remoto[nome] || []).length };
      local[nome] = mesclarColecao(local[nome] || [], remoto[nome] || [], nome, rel);
      local[nome] = aplicarExclusoes(local[nome], nome, rel, remoto.__excluidos);
    });

    /* Escalar: quem tem rev maior é a aba que escreveu por último. */
    if (rel.revRemoto > rel.revLocal) {
      if (remoto.activeProposalId) local.activeProposalId = remoto.activeProposalId;
      var fc = remoto.config || {};
      var lc = local.config || {};
      for (var k in fc) {
        if (!temPropriedade(fc, k) || CHAVES_PERIGO[k]) continue;
        if (!temPropriedade(lc, k)) { lc[k] = fc[k]; rel.registros.push({ colecao: 'config', id: k, motivo: 'novo' }); }
      }
      for (k in lc) {
        if (!temPropriedade(lc, k) || CHAVES_PERIGO[k]) continue;
        if (!temPropriedade(fc, k)) continue;
        if (JSON.stringify(lc[k]) !== JSON.stringify(fc[k])) lc[k] = fc[k];
      }
      local.config = lc;
    }

    /* nfSequence só cresce: o maior número é o único que faz sentido. */
    var rs = remoto.nfSequence || {};
    for (i in rs) {
      if (!temPropriedade(rs, i) || CHAVES_PERIGO[i]) continue;
      var nv = parseInt(rs[i], 10);
      if (isNaN(nv)) continue;
      var atual = parseInt(local.nfSequence[i], 10);
      if (isNaN(atual) || nv > atual) local.nfSequence[i] = nv;
    }

    /* Exclusões locais e remotas convivem para que a reconciliação
       termine. A lista é podada; é rastro, não estado de negócio. */
    var juntos = local.__excluidos.slice();
    remoto.__excluidos.forEach(function (e) {
      if (!e || !e.id) return;
      var achou = false;
      for (i = 0; i < juntos.length; i++) {
        if (juntos[i].id === e.id && juntos[i].colecao === e.colecao) {
          if (tsDe(e) > tsDe(juntos[i])) juntos[i] = e;
          achou = true;
          break;
        }
      }
      if (!achou) juntos.push(e);
    });
    local.__excluidos = juntos.slice(-LIMITE_EXCLUIDOS);

    var metaVencedor = rel.revRemoto > rel.revLocal ? remoto.__meta : local.__meta;
    local.__meta = {
      rev: Math.max(rel.revLocal, rel.revRemoto),
      updatedAt: (metaVencedor && metaVencedor.updatedAt) || agoraISO(),
      origem: TAB_ID,
      versao: FORMAT_VERSION
    };

    rel.houve = rel.registros.length > 0;
    return { db: local, relatorio: rel };
  }

  /* ── Leitura ──────────────────────────────── */

  function lerDoStorage() {
    var raw = S ? S.readRaw(STORE_KEY) : null;
    if (raw === null) return null;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clients) || !Array.isArray(parsed.proposals)) {
      return null;
    }
    return parsed;
  }

  /* Dado corrompido não pode ser sobrescrito pelo seed: primeiro vira
     uma cópia datada, depois o app segue funcionando. */
  function resgatarCorrompido() {
    var raw = S ? S.readRaw(STORE_KEY) : null;
    if (raw === null) return;
    var destino = STORE_KEY + '-corrupto-' + Date.now();
    var r = S ? S.write(destino, raw) : { ok: false };
    aviso('storage:corrompido', 'corrompido', r.ok
      ? 'O conteúdo salvo em "' + STORE_KEY + '" estava corrompido e foi preservado em "' + destino + '". O app carregou dados de exemplo.'
      : 'O conteúdo salvo em "' + STORE_KEY + '" está corrompido e não foi nem preservado. Não apague o armazenamento antes de exportar um backup.');
  }

  /* Rede de segurança do load(). Um TypeError aqui é tela branca: nenhum
   dado acessível, e a única recuperação é o usuário limpar o
   localStorage na mão - o que significa perder tudo. Melhor abrir com
   um registro meio torto, que o usuário ainda consegue exportar e
   recuperar, do que não abrir.

   Ela NÃO substitui o saneamento por forma: existe para o normalizador
   que alguém vai escrever amanhã. Por isso o erro não morre no
   console - fica em CRE_DATA.diagnostico().erroNormalizacao e vira
   aviso visível. Em desenvolvimento, um aviso novo aparecendo na tela
   é o que denuncia bug de migração antes de virar tela branca. */
  function normalizarProtegido(parsed, refazerDoRaw) {
    try {
      normalizeDb();
      ultimoErroNormalizacao = null;
      return true;
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      ultimoErroNormalizacao = {
        mensagem: msg,
        quando: agoraISO(),
        onde: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : ''
      };
      aviso('normalizacao:falhou', 'erro-normalizacao',
        'A migração do dado salvo parou em um registro inesperado (' + msg +
        ') e o app abriu com o dado como estava, sem completar a normalização. ' +
        'Nada foi apagado e o seed não entrou no lugar - exporte um backup antes de mexer em qualquer registro.');
      /* Recomeça do payload cru quando dá: sanitizarRaiz() reconstrói o
         mesmo grafo a partir do JSON original, sem o estado meio
         normalizado que a exceção deixou para trás. */
      if (refazerDoRaw && parsed) {
        try { db = sanitizarRaiz(parsed, novoRelatorio()); } catch (e2) { db = parsed; }
      }
      try { garantirFormaMinima(); } catch (e3) { /* já estamos no pior caso; o aviso acima é a saída */ }
      return false;
    }
  }

  function carregarDoStorage(mesclarComCache) {
    var raw = S ? S.readRaw(STORE_KEY) : null;
    var parsed = lerDoStorage();

    if (!parsed) {
      if (raw !== null) resgatarCorrompido();
      if (!db) {
        db = seedData();
        gravar('seed');
      }
      return;
    }

    var relLeitura = novoRelatorio();
    var novo = sanitizarRaiz(parsed, relLeitura);
    avisarCamposDescartados(relLeitura);

    if (!db || !mesclarComCache) {
      db = novo;
      normalizarProtegido(parsed, true);
      revCarregada = revDe(novo);
      ancestrais = { __pronto: 1 };
      lembrarAncestral(novo);
      return;
    }

    /* O merge roda sobre uma cópia: ele reconstrói arrays, e o editor
       mantém referência viva para o objeto da proposta. */
    var m = mesclar(clonarCache(), novo);
    db = m.db;
    /* Sem refazerDoRaw: o db já é a mescla de duas grafos já saneados e
       descartá-la perderia o que esta aba tinha. A forma mínima ainda
       entra, para a UI não quebrar em cima do registro torto. */
    normalizarProtegido(null, false);
    if (revDe(novo) > revCarregada) revCarregada = revDe(novo);
    /* A base vem do payload remoto, e é capturada DEPOIS do merge porque
       o merge a consulta. Ela descreve o que veio de fora, nunca o que
       esta aba tinha em mãos. */
    lembrarAncestral(novo);
    if (m.relatorio.houve) {
      avisarConflito({
        houve: true,
        origem: 'aba-externa',
        revLocal: m.relatorio.revLocal,
        revRemoto: m.relatorio.revRemoto,
        registros: m.relatorio.registros,
        escala: m.relatorio.escala,
        mensagem: resumirConflito(m.relatorio)
      });
      avisarSubstituicao({ origem: 'aba-externa', conflito: m.relatorio });
    } else {
      ultimoConflito = { houve: false, origem: 'aba-externa', revRemoto: revDe(novo) };
    }
  }

  function clonarCache() {
    try { return sanitizeProfundo(db, 0); } catch (e) { return db; }
  }

  function resumirConflito(rel) {
    var novos = 0, div = 0, rem = 0, rev = 0;
    rel.registros.forEach(function (r) {
      if (r.motivo === 'novo') novos += 1;
      else if (r.motivo === 'divergente') div += 1;
      else if (r.motivo === 'removido') rem += 1;
      else if (r.motivo === 'revivido') rev += 1;
    });
    var partes = [];
    if (novos) partes.push(novos + ' registro(s) criado(s) em outra aba foram incorporados');
    if (div) partes.push(div + ' registro(s) foram alterados nas DUAS abas (valeu o mais recente)');
    if (rem) partes.push(rem + ' exclusão(ões) de outra aba foram aplicadas');
    if (rev) partes.push(rev + ' registro(s) excluído(s) em outra aba foram restaurados por edição posterior');
    return partes.length ? partes.join('; ') + '.' : '';
  }

  /* Detecta escrita de outra aba pelo carimbo de rev. Funciona mesmo se o
     navegador não disparar 'storage' nem BroadcastChannel: sem carimbo a
     comparação cai para o texto bruto do payload. */
  function integrarMudancaExterna() {
    if (!db || integrando) return false;
    var remoto = S ? S.stampOf(STORE_KEY) : null;
    if (remoto !== null) {
      if (remoto === revCarregada) return false;
    } else {
      var raw = S ? S.readRaw(STORE_KEY) : null;
      if (raw === null || raw === ultimoRaw) return false;
    }
    integrando = true;
    try {
      carregarDoStorage(true);
    } finally {
      integrando = false;
    }
    return true;
  }

  function load() {
    if (!db) {
      carregarDoStorage(false);
    } else {
      integrarMudancaExterna();
    }
    if (pendenteDeGravacao) gravar('re-tentativa');
    return db;
  }

  /* ── Gravação ─────────────────────────────── */

  function resultadoDe(r) {
    return { ok: r.ok, erro: r.erro || '', error: r.erro || '', mensagem: r.mensagem || '', bytes: r.bytes || 0 };
  }

  function gravar(motivo) {
    motivo = motivo || 'salvar';
    if (!db) {
      return resultadoDe({ ok: false, erro: 'estado', mensagem: 'Nada foi carregado: não há estado para salvar.', bytes: 0 });
    }
    if (somenteLeitura && motivo !== 'seed') {
      return resultadoDe({
        ok: false,
        erro: ultimoErroGravacao ? ultimoErroGravacao.erro : 'somente-leitura',
        mensagem: ultimoErroGravacao ? ultimoErroGravacao.mensagem : 'Armazenamento bloqueado (CRE_DATA.readonly).',
        bytes: 0
      });
    }

    /* integrator antes de escrever: sem isso a aba B grava o snapshot
       velho por cima do cliente que a aba A acabou de criar. */
    if (motivo !== 'seed' && motivo !== 'importacao' && motivo !== 'restauracao' && motivo !== 'reset') {
      integrarMudancaExterna();
    }

    if (!db.__meta || typeof db.__meta !== 'object') db.__meta = { rev: 0, updatedAt: agoraISO(), origem: TAB_ID, versao: FORMAT_VERSION };
    db.__meta.rev = (Number(db.__meta.rev) || 0) + 1;
    db.__meta.updatedAt = agoraISO();
    db.__meta.origem = TAB_ID;
    db.__meta.versao = FORMAT_VERSION;
    db.__avisos = avisos;

    validarReferencias();
    aplicarMascaras();

    var res = S ? S.write(STORE_KEY, db) : { ok: false, erro: 'unavailable', mensagem: 'CRE_STORAGE não está carregado.', bytes: 0 };

    if (!res.ok) {
      pendenteDeGravacao = true;
      ultimoErroGravacao = { erro: res.erro, mensagem: res.mensagem, bytes: res.bytes, ts: agoraISO() };
      /* O estado em memória NÃO é revertido: é o trabalho do usuário,
         e ele ainda está na tela para ser salvo em arquivo. load() tenta
         regravar; o que não pode é fingir que salvou. */
      return resultadoDe(res);
    }

    pendenteDeGravacao = false;
    ultimoErroGravacao = null;
    revCarregada = Number(db.__meta.rev) || 0;
    if (S) {
      S.stamp(STORE_KEY, revCarregada);
      S.broadcast();
      /* O texto bruto só é refeito quando não há carimbo: ler o blob
         inteiro a cada gravação seria o custo que o carimbo evita. */
      if (S.stampOf(STORE_KEY) === null) ultimoRaw = S.readRaw(STORE_KEY);
    }
    /* O ancestral NÃO é atualizado aqui, e essa omissão é deliberada.

       O ancestral precisa ser o último estado sobre o qual as duas abas
       concordavam, não o que esta aba acabou de gravar. Se a gravação
       local virasse ancestral, a edição da própria aba deixaria de contar
       como edição independente na integração seguinte, e o conflito real
       entre duas abas seria reportado como "nada aconteceu" - que foi
       exatamente o sintoma medido (a UI recebia houve:false enquanto duas
       abas se atropelavam no mesmo registro).

       O ancestral é renovado só na integração (ver carregarDoStorage), que
       é o momento em que esta aba passa a concordar com o armazenamento. */
    autoBackup();
    return resultadoDe(res);
  }

  function save() { return gravar('salvar'); }

  /* ── Escrita em registro: identidade não sobrevive ao merge ──

     REGRA DO MÓDULO, e ela vale para quem consome:

     A integração com outra aba reconstrói os arrays do banco (ver
     carregarDoStorage). No instante em que ela acontece, TODO objeto que
     alguém já estava segurando deixa de pertencer ao banco: vira registro
     órfão, uma cópia que ninguém mais lê. Quem escreveu nele perdeu o
     trabalho sem ter escrito em lugar nenhum.

     Consequência medida: numa edição concorrente de duas abas, a edição
     do usuário era aplicada num registro que o merge em seguida substituía
     pela versão da outra aba, e a função devolvia esse órfão como se
     tivesse gravado. A tela dizia sucesso; o banco tinha o valor antigo.

     O editor visual mantém referência viva para o objeto da proposta por
     períodos longos, POR DESIGN. Depois de qualquer CRE_DATA.save() ele
     precisa re-resolver a proposta por id (CRE_DATA.getProposal(id)) em
     vez de continuar escrevendo no objeto que já estava segurando. */

  function porId(colecao, id) {
    if (!db || !id) return null;
    var lista = db[colecao];
    if (!Array.isArray(lista)) return null;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] && lista[i].id === id) return lista[i];
    }
    return null;
  }

  var ultimoPatchPerdido = null;
  var patchPerdidoCbs = [];

  function sinalizarPatchPerdido(colecao, id, erro, mensagem) {
    ultimoPatchPerdido = { colecao: colecao, id: id, erro: erro, mensagem: mensagem, ts: agoraISO() };
    aviso('patch-perdido:' + colecao + ':' + id, erro, mensagem);
    for (var i = 0; i < patchPerdidoCbs.length; i++) {
      try { patchPerdidoCbs[i](ultimoPatchPerdido); } catch (e) { /* silent */ }
    }
  }

  function onPatchPerdido(cb) {
    if (typeof cb !== 'function') return function () { };
    patchPerdidoCbs.push(cb);
    return function () { var i = patchPerdidoCbs.indexOf(cb); if (i !== -1) patchPerdidoCbs.splice(i, 1); };
  }

  function lastPatchPerdido() { return ultimoPatchPerdido; }

  /* Aplica o patch, grava e só então re-resolve o registro por id.
     `aplicar` recebe sempre um registro que está no banco, nunca uma
     cópia; `concluir` recebe o resultado da gravação e é ele quem
     registra o erro no registro certo.

     Se o id sumiu do banco, o patch é DESCARTADO e o motivo é
     sinalizado: devolver o órfão fingindo sucesso é pior que devolver
     erro, porque a UI trata falsy como erro e mostra o que aconteceu. */
  function escreverRegistro(colecao, id, aplicar, concluir) {
    var rec = porId(colecao, id);
    if (!rec) {
      /* A aba pode estar defasada: o registro foi criado em outra aba e
         esta ainda não integrou. Sem esta tentativa a edição do usuário
         seria descartada com um null mudo. */
      integrarMudancaExterna();
      rec = porId(colecao, id);
      if (!rec) return null;
    }
    var r;
    for (var tentativa = 0; tentativa < 2; tentativa++) {
      aplicar(rec);
      r = save();
      var pos = porId(colecao, id);
      if (!pos) {
        sinalizarPatchPerdido(colecao, id, 'registro-sumiu',
          'A edição não foi salva: o registro "' + id + '" saiu do banco durante a gravação (exclusão em outra aba).');
        return null;
      }
      if (pos === rec) { concluir(pos, r); return pos; }
      /* O merge trocou a identidade do registro entre a captura e a
         gravação. A edição do usuário não pode se perder por causa
         disso: reaplica uma vez no registro que está no banco agora. */
      rec = pos;
    }
    concluir(rec, r);
    return rec;
  }

  /* Inclusão tem a mesma exigência: o registro devolvido precisa ser o
     que está no banco. A integração vem ANTES da inserção, senão o
     objeto novo é engolido pelo merge e o chamador sai com um órfão. */
  function inserirRegistro(colecao, rec, concluir) {
    integrarMudancaExterna();
    db[colecao].unshift(rec);
    var r = save();
    var pos = porId(colecao, rec.id);
    if (!pos) {
      sinalizarPatchPerdido(colecao, rec.id, 'registro-sumiu',
        'O registro criado não foi encontrado depois de salvar: outra aba alterou o banco no mesmo instante.');
      return null;
    }
    concluir(pos, r);
    return pos;
  }

  /* ── Backups / histórico ─────────────────── */

  var ultimoBackupTs = 0;

  /* Binário dentro do snapshot local é o que estoura a cota: base64 de
     contrato e miniatura de imagem ocupam ordens de grandeza a mais que
     o resto do documento. A cópia local perde o binário; o arquivo
     baixado é que guarda tudo. */
  function removerBinario(v, profundidade) {
    if (profundidade > 40) return null;
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) {
      return v.map(function (x) { return removerBinario(x, profundidade + 1); });
    }
    if (typeof v === 'object') {
      var o = {};
      for (var k in v) {
        if (!temPropriedade(v, k)) continue;
        if (CHAVES_PERIGO[k]) continue;
        if (k === 'dataUrl' || k === 'dataURL' || k === 'base64') continue;
        o[k] = removerBinario(v[k], profundidade + 1);
      }
      return o;
    }
    return v;
  }

  function temBinario(v, profundidade) {
    if (profundidade > 40 || v === null || v === undefined) return false;
    if (typeof v === 'string') return v.length > 512 && v.indexOf('data:') === 0;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) { if (temBinario(v[i], profundidade + 1)) return true; }
      return false;
    }
    if (typeof v === 'object') {
      if (typeof v.dataUrl === 'string' && v.dataUrl.length > 512) return true;
      for (var k in v) {
        if (!temPropriedade(v, k)) continue;
        if (temBinario(v[k], profundidade + 1)) return true;
      }
    }
    return false;
  }

  function getBackups() {
    if (!S) return [];
    var arr = S.read(BACKUP_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function escreverBackups(lista) {
    if (!S) return { ok: false, erro: 'unavailable', mensagem: 'CRE_STORAGE não está carregado.', bytes: 0 };
    return S.write(BACKUP_KEY, lista);
  }

  function tamanhoDeBackup(b) {
    try { return S ? S.bytesOf(JSON.stringify(b)) : 0; } catch (e) { return 0; }
  }

  function autoBackup() {
    var now = Date.now();
    if (now - ultimoBackupTs < BACKUP_INTERVAL) return null;
    return addBackup(false);
  }

  function addBackup(force) {
    var now = Date.now();
    if (!force && now - ultimoBackupTs < BACKUP_INTERVAL) return null;
    if (!db) return null;
    ultimoBackupTs = now;

    var semBinario = removerBinario(db, 0);
    semBinario.__avisos = avisos.slice();
    var entrada = {
      id: uid('bk'),
      ts: new Date(),
      data: semBinario,
      binarioRemovido: temBinario(db, 0)
    };

    var lista = getBackups();
    var tamanhos = {};
    for (var i = 0; i < lista.length; i++) { tamanhos[lista[i].id] = tamanhoDeBackup(lista[i]); }
    lista.unshift(entrada);
    var meuTamanho = tamanhoDeBackup(entrada);
    var total = meuTamanho;
    for (i = 0; i < lista.length; i++) { if (lista[i].id !== entrada.id) total += (tamanhos[lista[i].id] || 0); }

    var descartados = 0;
    var estourou = false;
    while (lista.length > 1 && (lista.length > BACKUP_LIMIT || total > BACKUP_MAX_BYTES)) {
      var velho = lista.pop();
      total -= (tamanhos[velho.id] || tamanhoDeBackup(velho));
      descartados += 1;
      estourou = true;
    }

    var res = escreverBackups(lista);
    var rel = {
      ok: !!res.ok,
      id: entrada.id,
      total: lista.length,
      descartados: descartados,
      tetoBytes: BACKUP_MAX_BYTES,
      bytes: meuTamanho,
      erro: res.erro || '',
      mensagem: res.mensagem || ''
    };
    if (res.ok && descartados > 0) {
      rel.mensagem = 'O histórico local de backups atingiu o teto (' + Math.round(BACKUP_MAX_BYTES / 1024) +
        ' KB / ' + BACKUP_LIMIT + ' cópias) e ' + descartados + ' backup(s) antigo(s) foram descartados. ' +
        'O mais recente foi preservado. Exporte um backup em arquivo para guardar de verdade.';
    } else if (res.ok && res.bytes && res.bytes < meuTamanho) {
      rel.mensagem = 'Atenção: nem o backup mais recente coube no armazenamento local. Baixe um backup em arquivo.';
    } else if (!res.ok) {
      rel.mensagem = 'Não foi possível gravar o histórico local de backups: ' + (res.mensagem || '') +
        ' Isso NÃO afeta o salvamento dos dados.';
    }
    ultimoRelatorioBackup = rel;
    return entrada;
  }

  function ultimoBackup() { return ultimoRelatorioBackup; }

  function deleteBackup(id) {
    var lista = getBackups().filter(function (b) { return b && b.id !== id; });
    var res = escreverBackups(lista);
    return resultadoDe(res);
  }

  function nomeArquivoBackup(d) {
    d = d || new Date();
    return 'backup-georevest-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.json';
  }

  /* Download em arquivo: não ocupa cota nenhuma e sobrevive a limpar o
     navegador. Devolve o nome do arquivo para a UI mostrar. */
  function downloadBackup() {
    var conteudo = exportAll();
    var nome = nomeArquivoBackup(new Date());
    if (typeof global.Blob !== 'function' || typeof global.URL === 'undefined' ||
      !global.URL.createObjectURL || typeof global.document === 'undefined') {
      ultimoRelatorioBackup = {
        ok: false,
        mensagem: 'Este ambiente não permite baixar arquivo. Use copiar/colar o JSON de exportação.'
      };
      return { ok: false, nome: nome, mensagem: ultimoRelatorioBackup.mensagem };
    }
    var url = '';
    try {
      var blob = new global.Blob([conteudo], { type: 'application/json' });
      url = global.URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = nome;
      a.style.display = 'none';
      global.document.body.appendChild(a);
      a.click();
      global.document.body.removeChild(a);
      return { ok: true, nome: nome, bytes: S ? S.bytesOf(conteudo) : conteudo.length, mensagem: 'Backup baixado: ' + nome };
    } catch (e) {
      return { ok: false, nome: nome, mensagem: 'Não foi possível gerar o arquivo de backup: ' + (e && e.message ? e.message : 'erro desconhecido') };
    } finally {
      if (url) { try { global.URL.revokeObjectURL(url); } catch (e) { /* silent */ } }
    }
  }

  function restoreBackup(id) {
    var b = null;
    var lista = getBackups();
    for (var i = 0; i < lista.length; i++) { if (lista[i] && lista[i].id === id) { b = lista[i]; break; } }
    if (!b || !b.data) return false;
    /* Restaurar é destrutivo: guarda o estado atual antes, para que o
       backup sobreviva à própria restauração. */
    addBackup(true);
    var rel = novoRelatorio();
    db = sanitizarRaiz(b.data, rel);
    avisarCamposDescartados(rel);
    /* O rev nunca anda para trás: um backup antigo não pode fazer a aba
       seguinte achar que nada mudou. */
    if ((Number(db.__meta.rev) || 0) < revCarregada) db.__meta.rev = revCarregada;
    normalizarProtegido(null, false);
    var r = gravar('restauracao');
    avisarSubstituicao({ origem: 'restauracao', backupId: id, binarioRemovido: !!b.binarioRemovido });
    return !!(r && r.ok);
  }

  function reset() {
    addBackup(true);
    db = seedData();
    db.__meta.rev = Math.max(Number(db.__meta.rev) || 0, revCarregada);
    var r = gravar('reset');
    avisarSubstituicao({ origem: 'reset', gravacao: r });
    return db;
  }

  function persistActiveProposal(id) {
    if (S) S.write(EDITOR_KEY, String(id));
  }

  function getStoredActiveProposalId() {
    if (!S) return null;
    var v = S.readRaw(EDITOR_KEY);
    return (v === null || v === undefined || v === '') ? null : v;
  }

  function touch(obj) {
    obj.updatedAt = agoraISO();
  }

  /* ── Exclusões com rastro ───────────────────
     Sem tombstone, o registro excluído numa aba volta na próxima
     integração porque a outra aba ainda o tinha em memória. */

  function registrarExclusao(colecao, id) {
    if (!db.__excluidos) db.__excluidos = [];
    for (var i = 0; i < db.__excluidos.length; i++) {
      if (db.__excluidos[i].colecao === colecao && db.__excluidos[i].id === id) return;
    }
    db.__excluidos.push({ colecao: colecao, id: id, ts: agoraISO() });
    if (db.__excluidos.length > LIMITE_EXCLUIDOS) db.__excluidos.shift();
  }

  function dependentesDeCliente(id) {
    if (!db) return [];
    return (db.proposals || []).filter(function (p) { return p && p.clientId === id; });
  }

  function podeExcluirCliente(id) {
    return { ok: dependentesDeCliente(id).length === 0, dependentes: dependentesDeCliente(id).length };
  }

  function dependentesDeParceiro(id) {
    if (!db) return [];
    return (db.proposals || []).filter(function (p) {
      return p && Array.isArray(p.partners) && p.partners.some(function (pt) { return pt && pt.partnerId === id; });
    });
  }

  function podeExcluirParceiro(id) { return { ok: true, dependentes: dependentesDeParceiro(id).length }; }

  /* Nada liga proposal→template por id (modules.js:2676 copia o layout e
    olve o modelo antes de chamar addProposal), então o uso é medido por
     impressão digital do layout. É aviso, não bloqueio. */
  function usoDeTemplate(id) {
    if (!db) return [];
    var t = db.templates.filter(function (x) { return x && x.id === id; })[0];
    if (!t) return [];
    var alvo;
    try { alvo = JSON.stringify(t.layout); } catch (e) { return []; }
    return (db.proposals || []).filter(function (p) {
      if (!p) return false;
      if (p.modeloOrigem === id) return true;
      try { return JSON.stringify(p.layout) === alvo; } catch (e2) { return false; }
    });
  }

  function usoDeModeloNota(id) {
    if (!db) return [];
    return (db.invoices || []).filter(function (nf) { return nf && nf.modelId === id; });
  }

  /* ── Clientes ────────────────────────────── */

  function addClient(data) {
    var c = aplicarWhitelist(data || {}, CAMPOS.clients, null);
    c.id = uid('cl');
    c.createdAt = c.updatedAt = new Date();
    validarMascaraCliente(c);
    return inserirRegistro('clients', c, function (rec, r) {
      if (r.erro) rec.__erroGravacao = r;
      else delete rec.__erroGravacao;
    });
  }

  function validarMascaraCliente(c) {
    if (!F) return;
    if (c.cnpj && typeof c.cnpj === 'string' && F.formatCnpj(c.cnpj) !== c.cnpj) c.cnpj = F.formatCnpj(c.cnpj);
    if (c.cep && typeof c.cep === 'string' && F.formatCep(c.cep) !== c.cep) c.cep = F.formatCep(c.cep);
  }

  /* Aplica o patch no cliente e devolve o registro que está no banco
     depois de gravar, nunca a cópia que o merge pode ter substituído. */
  function updateClient(id, data) {
    var patch = aplicarWhitelist(data || {}, CAMPOS.clients, null);
    return escreverRegistro('clients', id, function (c) {
      CAMPOS.clients.forEach(function (k) {
        if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return;
        if (!temPropriedade(patch, k)) return;
        c[k] = patch[k];
      });
      validarMascaraCliente(c);
      touch(c);
    }, function (rec, r) {
      if (r.erro) rec.__erroGravacao = r;
      else delete rec.__erroGravacao;
    });
  }

  /* Cliente com proposta é dependência viva. Ou a proposta sai junto,
     ou o cliente fica. Nada de proposta órfã com o nome antigo impresso
     na capa. */
  function deleteClient(id, opcoes) {
    var deps = dependentesDeCliente(id);
    if (deps.length && !(opcoes && opcoes.cascata)) {
      return {
        ok: false,
        erro: 'em-uso',
        dependentes: deps.length,
        mensagem: 'Este cliente tem ' + deps.length + ' proposta(s) vinculada(s) e não foi excluído. ' +
          'Desvincule as propostas ou chame deleteClient(id, { cascata: true }).'
      };
    }
    db.clients = db.clients.filter(function (c) { return c.id !== id; });
    deps.forEach(function (p) {
      p.clientId = null;
      touch(p);
      aviso('ref:proposta:' + p.id + ':clientId', 'ref-orfa',
        'O cliente da proposta "' + (p.name || p.id) + '" foi excluído. O orçamento foi mantido sem vínculo para não perder o trabalho.');
    });
    registrarExclusao('clients', id);
    var r = save();
    /* O merge pode ter trocado a identidade das propostas dependentes
       durante a gravação acima. Sem esta volta, uma dependente que voltou
       da outra aba manteria o vínculo com um cliente que não existe mais -
       e a capa impressa continuaria mostrando o nome antigo. */
    var revistos = revincularClientesOrfaos(id);
    if (revistos) r = save();
    return { ok: r.ok, erro: r.erro, mensagem: r.mensagem, dependentes: deps.length, gravacao: r };
  }

  /* Procura, no banco atual, proposta que ainda aponte para o cliente
     excluído e devolve true se alguma precisou de reparo. */
  function revincularClientesOrfaos(clientId) {
    var mexeu = false;
    (db.proposals || []).forEach(function (p) {
      if (!p || p.clientId !== clientId) return;
      p.clientId = null;
      touch(p);
      aviso('ref:proposta:' + p.id + ':clientId', 'ref-orfa',
        'O cliente da proposta "' + (p.name || p.id) + '" foi excluído em outra aba. O orçamento foi mantido sem vínculo para não perder o trabalho.');
      mexeu = true;
    });
    return mexeu;
  }

  function findClient(id) {
    return (db.clients || []).filter(function (c) { return c && c.id === id; })[0] || null;
  }

  function searchClients(q) {
    q = (q || '').toLowerCase();
    if (!q) return db.clients;
    return db.clients.filter(function (c) {
      return (c.name || '').toLowerCase().indexOf(q) !== -1 ||
        (c.company || '').toLowerCase().indexOf(q) !== -1 ||
        (c.email || '').toLowerCase().indexOf(q) !== -1 ||
        (c.cnpj || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  /* ── Parceiros ──────────────────────────── */

  function normalizePartner(p) {
    if (!p) return p;
    /* Contato em forma de string derrubava o load em `c.phones`. O
       telefone dentro do telefone (modules.js lê ph.number) também. */
    p.contacts = sanearLista(p.contacts, 'os contatos do parceiro "' + (p.name || p.id || '?') + '"', recuperarContato);
    p.contacts.forEach(function (c) {
      if (!ehRegistro(c)) return;
      c.phones = sanearLista(c.phones, 'os telefones do contato "' + (c.name || c.id || '?') + '"', recuperarTelefone);
    });
    if (p.contract && !p.contract.dataUrl) delete p.contract;
    return p;
  }

  /* Contrato em base64 é o maior item do banco: 3,5 MB de PDF viram ~4,7 MB
     de string base64 e sozinhos quase esgotam a cota de 5 MB. Teto
     explícito e recusa com mensagem clara — truncar em silêncio
     entregaria um PDF ilegível meses depois. O teto bruto acompanha o
     limite que a UI já impõe (modules.js:2111) para não rejeitar o que a
     tela aceitou; o teto codificado é o que realmente protege a cota. */
  var CONTRATO_MAX_BYTES = 3.5 * 1024 * 1024;
  var CONTRATO_MAX_CODIFICADO = 2.5 * 1024 * 1024;

  function validarContrato(p) {
    if (!p || !p.contract || typeof p.contract !== 'object') return true;
    var bruto = p.contract.fileSize;
    if (typeof bruto !== 'number' || !isFinite(bruto)) bruto = 0;
    var codificado = (S && typeof p.contract.dataUrl === 'string') ? S.bytesOf(p.contract.dataUrl) : 0;
    if (bruto <= CONTRATO_MAX_BYTES && codificado <= CONTRATO_MAX_CODIFICADO) {
      if (p.__erroGravacao && p.__erroGravacao.erro === 'contrato-grande') delete p.__erroGravacao;
      return true;
    }
    /* A mensagem nomeia o teto que estourou: dizer "3.584 KB" quando o
       que barrou foi o teto codificado manda o usuário caçar o número
       errado. */
    var qual = codificado > CONTRATO_MAX_CODIFICADO ? 'codificado' : 'bruto';
    var teto = qual === 'codificado' ? CONTRATO_MAX_CODIFICADO : CONTRATO_MAX_BYTES;
    p.__erroGravacao = {
      erro: 'contrato-grande',
      mensagem: 'Espaço insuficiente: o arquivo de "' + (p.name || p.id) + '" ocupa ' +
        Math.round(bruto / 1024) + ' KB e vira ' + Math.round(codificado / 1024) +
        ' KB em base64; o teto ' + qual + ' é ' + Math.round(teto / 1024) + ' KB. ' +
        'Ele NÃO foi salvo e NÃO foi truncado - um PDF pela metade é pior que nenhum. ' +
        'Guarde o arquivo fora do app ou envie um exemplar menor.'
    };
    delete p.contract;
    aviso('contrato:' + p.id, 'contrato-grande', p.__erroGravacao.mensagem);
    return false;
  }

  function addPartner(data) {
    var p = aplicarWhitelist(data || {}, CAMPOS.partners, null);
    p.id = uid('pa');
    p.contacts = Array.isArray(p.contacts) ? p.contacts : [];
    p.createdAt = p.updatedAt = new Date();
    normalizePartner(p);
    validarContrato(p);
    return inserirRegistro('partners', p, function (rec, r) {
      if (r.erro && !(rec.__erroGravacao && rec.__erroGravacao.erro === 'contrato-grande')) rec.__erroGravacao = r;
    });
  }

  function updatePartner(id, data) {
    var patch = aplicarWhitelist(data || {}, CAMPOS.partners, null);
    return escreverRegistro('partners', id, function (p) {
      CAMPOS.partners.forEach(function (k) {
        if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return;
        if (!temPropriedade(patch, k)) return;
        p[k] = patch[k];
      });
      normalizePartner(p);
      validarContrato(p);
      touch(p);
    }, function (rec, r) {
      if (r.erro) rec.__erroGravacao = r;
      else if (rec.__erroGravacao && rec.__erroGravacao.erro !== 'contrato-grande') delete rec.__erroGravacao;
    });
  }

  /* Parceiro sai e o vínculo das propostas é desfeito, mas a comissão
     fica: ela é fato contábil já apurado, não estado do parceiro. */
  function deletePartner(id, opcoes) {
    var deps = dependentesDeParceiro(id);
    var parceiro = findPartner(id);
    var nome = parceiro ? parceiro.name : id;
    db.partners = db.partners.filter(function (p) { return p.id !== id; });
    deps.forEach(function (p) {
      (p.partners || []).forEach(function (pt) {
        if (!pt || pt.partnerId !== id) return;
        pt.partnerId = null;
        pt.parceiroNome = nome;
        pt.parceiroOrfao = true;
      });
      touch(p);
    });
    if (deps.length) {
      aviso('parceiro:excluido:' + id, 'integridade',
        'O parceiro "' + nome + '" foi excluído e saiu de ' + deps.length + ' proposta(s). ' +
        'As comissões dessas propostas foram preservadas com o nome do parceiro.');
    }
    if (opcoes && opcoes.manterHistorico === false) {
      deps.forEach(function (p) {
        p.partners = (p.partners || []).filter(function (pt) { return pt && pt.partnerId !== id; });
      });
    }
    registrarExclusao('partners', id);
    var r = save();
    /* Mesma volta do deleteClient: o merge pode ter trocado a identidade
       das propostas dependentes. A comissão continua lá, mas o vínculo com
       o parceiro inexistente precisa cair no registro que sobrou. */
    if (revincularParceirosOrfaos(id, nome)) r = save();
    return { ok: r.ok, erro: r.erro, mensagem: r.mensagem, dependentes: deps.length, gravacao: r };
  }

  /* Desfaz o vínculo preservando o nome e o valor da comissão, agora nos
     registros que realmente estão no banco. */
  function revincularParceirosOrfaos(partnerId, nome) {
    var mexeu = false;
    (db.proposals || []).forEach(function (p) {
      if (!p || !Array.isArray(p.partners)) return;
      var dentro = p.partners.some(function (pt) { return pt && pt.partnerId === partnerId; });
      if (!dentro) return;
      p.partners.forEach(function (pt) {
        if (!pt || pt.partnerId !== partnerId) return;
        pt.partnerId = null;
        pt.parceiroNome = nome;
        pt.parceiroOrfao = true;
      });
      touch(p);
      mexeu = true;
    });
    return mexeu;
  }

  function findPartner(id) {
    return (db.partners || []).filter(function (p) { return p && p.id === id; })[0] || null;
  }

  function searchPartners(q) {
    q = (q || '').toLowerCase();
    if (!q) return db.partners;
    return db.partners.filter(function (p) {
      var text = (p.name || '') + ' ' + (p.cnpj || '') + ' ' + (p.address || '');
      (p.contacts || []).forEach(function (c) {
        text += ' ' + (c.name || '') + ' ' + (c.email || '');
        (c.phones || []).forEach(function (ph) { text += ' ' + (ph.number || ''); });
      });
      return text.toLowerCase().indexOf(q) !== -1;
    });
  }

  /* ── Propostas ───────────────────────────── */

  /* Normaliza `partners` no caminho de escrita também, e não só no load:
   searchProposals() e getPartnerCommissionSummary() leem pt.partnerId
   sem conferir o tipo, e um item nulo escreveria no banco agora e
   explodiria na próxima vez que a aba abrir. */
  function normalizarVinculos(p) {
    var porId = indiceDeParceiros();
    p.partners = sanearLista(p.partners, 'os parceiros da proposta "' + (p.name || p.id) + '"', function (bruto) {
      return recuperarVinculoParceiro(bruto, porId);
    });
    p.partners.forEach(function (pt) {
      if (!ehRegistro(pt)) return;
      if (!pt.role) pt.role = 'commercial';
      if (!pt.commissionType) pt.commissionType = 'percent';
      if (pt.commissionValue === undefined) pt.commissionValue = 0;
      if (pt.showOnProposal === undefined) pt.showOnProposal = false;
    });
    return p.partners;
  }

  function addProposal(data) {
    var p = aplicarWhitelist(data || {}, CAMPOS.proposals, null);
    p.id = uid('pr');
    p.layout = p.layout || defaultLayout();
    p.createdAt = p.updatedAt = new Date();
    if (p.revision === undefined) p.revision = 1;
    if (!Array.isArray(p.revisions)) p.revisions = [];
    normalizarVinculos(p);
    return inserirRegistro('proposals', p, function (rec, r) {
      if (r.erro) rec.__erroGravacao = r;
      else delete rec.__erroGravacao;
    });
  }

  /* Aplica o patch, grava, e devolve o registro re-resolvido por id: o
     objeto que a chamada capturou pode ter virado órfã dentro do merge
     que roda durante a gravação (ver escreverRegistro). */
  function updateProposal(id, data) {
    var patch = aplicarWhitelist(data || {}, CAMPOS.proposals, null);
    return escreverRegistro('proposals', id, function (p) {
      CAMPOS.proposals.forEach(function (k) {
        if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return;
        if (!temPropriedade(patch, k)) return;
        p[k] = patch[k];
      });
      normalizarVinculos(p);
      if (p.revision === undefined) p.revision = 1;
      if (!Array.isArray(p.revisions)) p.revisions = [];
      touch(p);
    }, function (rec, r) {
      if (r.erro) rec.__erroGravacao = r;
      else delete rec.__erroGravacao;
    });
  }

  function proposalHasIssuedInvoice(id) {
    return (db.invoices || []).some(function (nf) {
      return nf && nf.proposalId === id && nf.status === 'issued';
    });
  }

  function deleteProposal(id) {
    if (proposalHasIssuedInvoice(id)) {
      return {
        ok: false,
        erro: 'nf-emitida',
        mensagem: 'Esta proposta já tem nota fiscal emitida e não pode ser excluída.'
      };
    }
    db.proposals = db.proposals.filter(function (p) { return p.id !== id; });
    if (db.activeProposalId === id) db.activeProposalId = (db.proposals[0] && db.proposals[0].id) || '';
    persistActiveProposal(db.activeProposalId);
    /* Nota que apontava para ela perde o vínculo, não o registro. */
    (db.invoices || []).forEach(function (nf) {
      if (nf && nf.proposalId === id) {
        nf.proposalId = null;
        aviso('ref:nota:' + nf.id + ':proposalId', 'ref-orfa',
          'A proposta da nota nº ' + (nf.number || nf.id) + ' foi excluída. A nota foi mantida sem vínculo.');
      }
    });
    registrarExclusao('proposals', id);
    var r = save();
    avisarSubstituicao({ origem: 'exclusao-proposta', propostaId: id });
    return { ok: r.ok, erro: r.erro, mensagem: r.mensagem, gravacao: r };
  }

  function getProposal(id) {
    return (db.proposals || []).filter(function (p) { return p && p.id === id; })[0] || null;
  }

  function searchProposals(q, status, partnerId) {
    q = (q || '').toLowerCase();
    return (db.proposals || []).filter(function (p) {
      var c = findClient(p.clientId);
      var hitName = (p.name || '').toLowerCase().indexOf(q) !== -1;
      var hitClient = c ? (c.name + ' ' + (c.company || '')).toLowerCase().indexOf(q) !== -1 : false;
      var hitStatus = !status || p.status === status;
      var hitPartner = !partnerId || (Array.isArray(p.partners) && p.partners.some(function (pt) { return pt.partnerId === partnerId; }));
      return (hitName || hitClient) && hitStatus && hitPartner;
    });
  }

  function findProposalsByPartner(partnerId) {
    if (!db || !Array.isArray(db.proposals) || !partnerId) return [];
    return db.proposals.filter(function (p) {
      return Array.isArray(p.partners) && p.partners.some(function (pt) {
        return pt.partnerId === partnerId;
      });
    });
  }

  function getPartnerCommissionSummary(partnerId) {
    var props = findProposalsByPartner(partnerId);
    var totalCommissions = 0;
    var totalVolume = 0;
    var count = props.length;

    props.forEach(function (p) {
      var propVal = global.CRE && global.CRE.proposalTotal ? global.CRE.proposalTotal(p.layout) : 0;
      totalVolume += propVal;
      var links = (p.partners || []).filter(function (pt) { return pt.partnerId === partnerId; });
      links.forEach(function (pt) {
        var val = Number(pt.commissionValue) || 0;
        if (pt.commissionType === 'percent') {
          totalCommissions += (propVal * (val / 100));
        } else {
          totalCommissions += val;
        }
      });
    });

    return {
      count: count,
      totalVolume: Math.round(totalVolume * 100) / 100,
      totalCommissions: Math.round(totalCommissions * 100) / 100
    };
  }

  function setActiveProposal(id) {
    db.activeProposalId = id;
    persistActiveProposal(id);
    return save();
  }

  function getActiveProposal() {
    if (!db.proposals.length) return null;
    var stored = getStoredActiveProposalId();
    var p = stored ? getProposal(stored) : null;
    if (p) { db.activeProposalId = p.id; return p; }
    p = getProposal(db.activeProposalId);
    return p || db.proposals[0];
  }

  /* ── Modelos ─────────────────────────────── */

  function addTemplate(name, layout) {
    var t = {
      id: uid('tm'),
      name: name || 'Modelo sem nome',
      layout: sanitizeProfundo(layout || defaultLayout(), 0),
      createdAt: new Date().toISOString()
    };
    /* addTemplate empurra no fim da lista; inserirRegistro faz unshift.
       O registro devolvido precisa ser o que está no banco, então a
       gravação é feita aqui e o objeto só é devolvido depois de
       re-resolvido por id. */
    integrarMudancaExterna();
    db.templates.push(t);
    save();
    return porId('templates', t.id) || t;
  }

  function deleteTemplate(id) {
    var usados = usoDeTemplate(id);
    db.templates = db.templates.filter(function (t) { return t && t.id !== id; });
    registrarExclusao('templates', id);
    var r = save();
    return {
      ok: r.ok,
      erro: r.erro,
      mensagem: usados.length
        ? 'Modelo excluído, mas ' + usados.length + ' proposta(s) foram criadas a partir dele. Elas continuam intactas.'
        : r.mensagem,
      usados: usados.length,
      gravacao: r
    };
  }

  /* ── Atraso derivado do vencimento ──────────
     Decisão de produto (AGENTS.md §6): atraso não é digitado, é derivado
     de dueDate + estado de pagamento. Vencida E não paga = atrasada. A
     regra mora em CRE_FISCAL.isOverdue, que já trata pago, cancelado,
     sem financeiro e vencimento ausente — o app não reimplementa nada
     disso.

     Duas portas de saída, porque leitura e escrita têm exigências
     diferentes:

     pagamentoEfetivo()   leitura: o que a UI deve mostrar. NÃO toca no
                          payload. Dado legado gravado com "overdue"
                          digitado à mão continua byte a byte como o
                          usuário deixou, e é isso que o teste de
                          leitura campo a campo do snapshot antigo
                          exige (mudar payment no load() faria aquele
                          teste apontar divergência em invoices).
     normalizarAtraso()   escrita: roda só quando o registro passa pelas
                          mãos do usuário (addInvoice/updateInvoice) e
                          materializa o valor derivado em payment, com
                          aviso rastreável. É o que faz o dado convergir
                          sem uma migração em massa no load(), que
                          reescreveria payload de terceiros na primeira
                          abertura.

     Consequência conhecida: nota legada intocada continua com o
     payment manual no arquivo até alguém editar aquela nota — e é
     pagamentoEfetivo() que a UI precisa ler enquanto isso não acontece. */

  /* Derivação pura, sem efeito colateral. Sem CRE_FISCAL não há data
     confiável para comparar, então nada é derivado - a mesma
     degradação silenciosa de corrigirDatas(). */
  function derivarAtraso(nf, refDate) {
    if (!nf || typeof nf !== 'object') return false;
    if (!F || typeof F.isOverdue !== 'function') return false;
    return F.isOverdue(nf, refDate) === true;
  }

  /* O payment que a UI deve enxergar: o derivado quando a regra fala,
     o valor gravado quando ela não tem o que dizer. */
  function pagamentoEfetivo(nf, refDate) {
    if (!nf || typeof nf !== 'object') return '';
    var atual = nf.payment || 'pending';
    if (!F || typeof F.isOverdue !== 'function') return atual;
    if (F.isOverdue(nf, refDate)) return 'overdue';
    if (atual !== 'overdue') return atual;

    /* Estava marcado como atrasado e a regra discorda. Sem vencimento
       não existe evidência contra a marcação: ela é do usuário e fica.
       Com vencimento válido, a marcação é legado e cede - "atrasado"
       com prazo no futuro é o bug que a decisão de derivar veio matar.
       Pago legado por cima de "overdue" devolve 'paid', não 'pending':
       dinheiro entrou e o cartão não pode esconder isso. */
    if (!F.toISODate(nf.dueDate)) return 'overdue';
    if (nf.paid === true) return 'paid';
    if (nf.geraFinanceiro === false) return 'nofin';
    return 'pending';
  }

  /* Materializa a derivação na escrita. Toda troca vira aviso: nada de
     dado do usuário muda fora do olho de quem estiver conferindo
     CRE_DATA.avisos(). Idempotente - reaplicar não muda nem duplica. */
  function normalizarAtraso(nf, refDate) {
    if (!nf || typeof nf !== 'object') return nf;
    var de = nf.payment || 'pending';
    var para = pagamentoEfetivo(nf, refDate);
    if (!para || para === de) return nf;
    nf.payment = para;
    aviso('atraso:' + nf.id + ':' + de + '>' + para, 'atraso',
      'A nota nº ' + (nf.number || nf.id) + ' estava como "' + de + '" e a regra de atraso ' +
      'derivada de dueDate diz "' + para + '" (vencimento ' + (F.toISODate(nf.dueDate) || 'sem data') +
      '). O pagamento foi gravado como "' + para + '". Para mudar, ajuste o vencimento ou marque como pago.');
    return nf;
  }

  /* ── Notas fiscais ───────────────────────── */

  function getInvoice(id) {
    return (db.invoices || []).filter(function (nf) { return nf && nf.id === id; })[0] || null;
  }

  function findInvoicesByProposal(proposalId) {
    return db.invoices.filter(function (nf) { return nf.proposalId === proposalId; });
  }

  function findInvoicesByClient(clientId) {
    return db.invoices.filter(function (nf) {
      if (nf.clientId === clientId) return true;
      var p = getProposal(nf.proposalId);
      return p && p.clientId === clientId;
    });
  }

  function nextNFNumber(type) {
    var seq = db.nfSequence || (db.nfSequence = {});
    var key = type || 'custom';
    var n = (parseInt(seq[key], 10) || 0) + 1;
    seq[key] = n;
    return padNFNumber(n);
  }

  function addInvoice(data) {
    var nf = aplicarWhitelist(data || {}, CAMPOS.invoices, null);
    nf.id = uid('nf');
    /* nextNFNumber escreve em db.nfSequence: precisa do banco já
       integrado, senão a sequência da outra aba é sobrescrita. */
    integrarMudancaExterna();
    if (!nf.number) nf.number = nextNFNumber(nf.type || 'custom');
    if (!nf.status) nf.status = 'draft';
    if (!nf.payment) nf.payment = 'pending';
    if (!nf.dueDate) nf.dueDate = '';
    if (!nf.paymentDate) nf.paymentDate = '';
    if (nf.geraFinanceiro === undefined) nf.geraFinanceiro = true;
    nf.createdAt = nf.updatedAt = new Date();
    corrigirDatas(nf);
    normalizarAtraso(nf);
    return inserirRegistro('invoices', nf, function (rec, r) {
      if (r.erro) rec.__erroGravacao = r;
      else delete rec.__erroGravacao;
    });
  }

  function updateInvoice(id, data) {
    var patch = aplicarWhitelist(data || {}, CAMPOS.invoices, null);
    return escreverRegistro('invoices', id, function (nf) {
      CAMPOS.invoices.forEach(function (k) {
        if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return;
        if (!temPropriedade(patch, k)) return;
        nf[k] = patch[k];
      });
      nf.emitente = nf.emitente || {};
      nf.destinatario = nf.destinatario || {};
      nf.modelData = nf.modelData || {};
      if (!Array.isArray(nf.items)) nf.items = [];
      corrigirDatas(nf);
      normalizarAtraso(nf);
      /* Carimbo monótono por aba (toque), não a hora do relógio: é ele
         que a mesclagem entre abas usa para desempatar. */
      touch(nf);
    }, function (rec, r) {
      if (r.erro) rec.__erroGravacao = r;
      else delete rec.__erroGravacao;
    });
  }

  function deleteInvoice(id) {
    db.invoices = db.invoices.filter(function (nf) { return nf.id !== id; });
    registrarExclusao('invoices', id);
    var r = save();
    return { ok: r.ok, erro: r.erro, mensagem: r.mensagem, gravacao: r };
  }

  /* ── Modelos de nota fiscal ──────────────── */

  function getInvoiceModels() {
    return db.invoiceModels || [];
  }

  function getInvoiceModel(id) {
    return (db.invoiceModels || []).filter(function (m) { return m && m.id === id; })[0] || null;
  }

  function addInvoiceModel(data) {
    var m = aplicarWhitelist(data || {}, CAMPOS.invoiceModels, null);
    m.id = uid('im');
    m.type = m.type || 'custom';
    if (m.geraFinanceiro === undefined) m.geraFinanceiro = true;
    m.fields = Array.isArray(m.fields) ? m.fields : [];
    m.createdAt = new Date().toISOString();
    return inserirRegistro('invoiceModels', m, function () { });
  }

  function updateInvoiceModel(id, data) {
    var patch = aplicarWhitelist(data || {}, CAMPOS.invoiceModels, null);
    return escreverRegistro('invoiceModels', id, function (m) {
      CAMPOS.invoiceModels.forEach(function (k) {
        if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return;
        if (!temPropriedade(patch, k)) return;
        m[k] = patch[k];
      });
      if (!Array.isArray(m.fields)) m.fields = [];
      touch(m);
    }, function () { });
  }

  /* Modelo em uso não sai: sem ele a impressão perde a seção
     "Dados da operação". A UI já avisa; aqui é a última linha. */
  function deleteInvoiceModel(id) {
    var usados = usoDeModeloNota(id);
    if (usados.length) {
      return {
        ok: false,
        erro: 'em-uso',
        dependentes: usados.length,
        mensagem: 'Este modelo não pode ser excluído: ' + usados.length + ' nota(s) do histórico usam ele. ' +
          'Sem o modelo, a impressão perde a seção "Dados da operação".'
      };
    }
    db.invoiceModels = db.invoiceModels.filter(function (m) { return m.id !== id; });
    registrarExclusao('invoiceModels', id);
    var r = save();
    return { ok: r.ok, erro: r.erro, mensagem: r.mensagem, gravacao: r };
  }

  /* ── Status de nota fiscal ──────────────── */

  function getInvoiceStatuses() {
    if (db.config && Array.isArray(db.config.invoiceStatuses) && db.config.invoiceStatuses.length) {
      return db.config.invoiceStatuses;
    }
    return defaultInvoiceStatuses();
  }

  function invoiceStatusLabel(key) {
    var s = getInvoiceStatuses().filter(function (x) { return x.key === key; })[0];
    return s ? s.label : '';
  }

  function ensureInvoiceStatusList() {
    if (!db.config) db.config = {};
    if (!Array.isArray(db.config.invoiceStatuses) || !db.config.invoiceStatuses.length) {
      db.config.invoiceStatuses = defaultInvoiceStatuses();
    }
    return db.config.invoiceStatuses;
  }

  function addInvoiceStatus(label) {
    label = String(label || '').trim();
    if (!label) return { error: 'Informe um nome para o status.' };
    var list = ensureInvoiceStatusList();
    var dup = list.some(function (s) { return s.label.toLowerCase() === label.toLowerCase(); });
    if (dup) return { error: 'Já existe um status com esse nome.' };
    var st = { key: statusSlugKey(label), label: label, locked: false };
    list.push(st);
    save();
    return st;
  }

  function deleteInvoiceStatus(key) {
    var list = ensureInvoiceStatusList();
    var item = list.filter(function (s) { return s.key === key; })[0];
    if (!item) return { error: 'Status não encontrado.' };
    if (item.locked) return { error: 'Este status é padrão e não pode ser excluído.' };
    var used = (db.invoices || []).some(function (nf) { return nf.status === key; });
    if (used) return { error: 'Este status está em uso por uma nota fiscal e não pode ser excluído.' };
    db.config.invoiceStatuses = list.filter(function (s) { return s.key !== key; });
    save();
    return {};
  }

  /* ── Config ──────────────────────────────── */

  function getConfig() {
    if (!db.config) db.config = { footer: defaultFooter() };
    if (!db.config.footer) db.config.footer = defaultFooter();
    return db.config;
  }

  function updateConfig(patch) {
    var limpo = aplicarWhitelist(patch || {}, CAMPOS_CONFIG, null);
    /* config não tem id, então não passa por escreverRegistro. Integra
       primeiro e re-resolve o objeto depois: o merge pode substituir
       db.config, e devolver o config antigo faria a UI reler campos que
       ela acabou de gravar sem encontrar nada. */
    integrarMudancaExterna();
    var cfg = getConfig();
    for (var k in limpo) {
      if (!temPropriedade(limpo, k)) continue;
      cfg[k] = limpo[k];
    }
    save();
    return getConfig();
  }

  /* Preenche apenas campos de rodapé que estejam vazios (não sobrescreve a edição) */
  function applyConfigDefaults(layoutFooter) {
    var cfg = getConfig();
    var f = cfg.footer || {};
    if (!layoutFooter) layoutFooter = {};
    if (layoutFooter.line1 === undefined || layoutFooter.line1 === '') layoutFooter.line1 = f.line1 || '';
    if (layoutFooter.line2 === undefined || layoutFooter.line2 === '') layoutFooter.line2 = f.line2 || '';
    if (layoutFooter.line3 === undefined || layoutFooter.line3 === '') layoutFooter.line3 = f.line3 || '';
    if (layoutFooter.headerImg === undefined || layoutFooter.headerImg === '') layoutFooter.headerImg = f.headerImg || '';
    return layoutFooter;
  }

  /* ── Export / Import ─────────────────────── */

  function exportAll() {
    return JSON.stringify({
      app: db,
      layoutTemplate: defaultLayout(),
      versao: FORMAT_VERSION,
      geradoEm: agoraISO(),
      geradoPor: TAB_ID
    }, null, 2);
  }

  function nomeChavesDesconhecidas(rel) {
    var out = [];
    for (var k in rel.desconhecidos) {
      if (!temPropriedade(rel.desconhecidos, k)) continue;
      out.push(k + ' (' + rel.desconhecidos[k] + 'x)');
    }
    return out;
  }

  /* Aceita o formato antigo (sem 'versao'), o formato atual e um dump
     cru do banco (sem o envelope 'app'). Importar é uma operação que
     sobrescreve tudo: por isso o estado atual vira backup antes. */
  function importAll(json) {
    var rel = novoRelatorio();
    var parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      ultimoRelatorioImport = { ok: false, mensagem: 'Arquivo inválido: o conteúdo não é um JSON legível.' };
      return false;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      ultimoRelatorioImport = { ok: false, mensagem: 'Arquivo inválido: o conteúdo não é um objeto de dados.' };
      return false;
    }
    var fonte = parsed.app;
    if (!fonte || typeof fonte !== 'object') fonte = parsed;
    if (!Array.isArray(fonte.clients) || !Array.isArray(fonte.proposals)) {
      ultimoRelatorioImport = {
        ok: false,
        mensagem: 'Arquivo inválido: não encontrei as listas "clients" e "proposals" que o Georevest usa.'
      };
      return false;
    }

    addBackup(true);
    db = sanitizarRaiz(fonte, rel);
    if ((Number(db.__meta.rev) || 0) < revCarregada) db.__meta.rev = revCarregada;
    normalizarProtegido(null, false);
    var r = gravar('importacao');

    var bloqueados = [];
    for (var b in rel.bloqueados) { if (temPropriedade(rel.bloqueados, b)) bloqueados.push(b); }
    ultimoRelatorioImport = {
      ok: true,
      gravacao: r,
      registros: rel.registros,
      idsGerados: rel.idsGerados,
      desconhecidos: nomeChavesDesconhecidas(rel),
      bloqueados: bloqueados,
      avisos: rel.avisos,
      mensagem: 'Importados ' + rel.registros + ' registros.' +
        (bloqueados.length ? ' Chaves perigosas ignoradas: ' + bloqueados.join(', ') + '.' : '') +
        (!r.ok ? ' ATENÇÃO: os dados entraram na tela mas NÃO foram gravados no navegador (' + r.mensagem + '). Exporte um arquivo agora.' : '')
    };
    avisarSubstituicao({ origem: 'importacao', gravacao: r });
    return true;
  }

  function lastImportReport() { return ultimoRelatorioImport; }

  /* ── Diagnóstico / API ──────────────────── */

  function diagnostico() {
    var uso = S ? S.usage() : { bytes: 0, quotaBytes: 0, fracao: 0, itens: [] };
    return {
      armazenamento: { disponivel: S ? S.available() : false },
      uso: uso,
      rev: revCarregada,
      dirty: pendenteDeGravacao,
      ultimoErro: ultimoErroGravacao,
      erroNormalizacao: ultimoErroNormalizacao,
      conflitos: ultimoConflito,
      avisos: getAvisos(),
      backupsLocais: { limite: BACKUP_LIMIT, tetoBytes: BACKUP_MAX_BYTES, ultimo: ultimoRelatorioBackup },
      formato: FORMAT_VERSION,
      aba: TAB_ID
    };
  }

  function readonly(ligar) {
    somenteLeitura = !!ligar;
    if (!somenteLeitura) pendenteDeGravacao = false;
    return somenteLeitura;
  }

  /* Relê o storage e integra. Force quando a UI quiser sincronizar sem
     esperar o próximo load() — ex.: ao voltar para a aba. */
  function sync() {
    if (!db) { return load(); }
    integrarMudancaExterna();
    if (pendenteDeGravacao) gravar('re-tentativa');
    return db;
  }

  if (S && typeof S.onExternalChange === 'function') {
    S.onExternalChange(function (info) {
      if (integrando) return;
      integrarMudancaExterna();
    });
  }
  if (S && typeof S.onQuotaError === 'function') {
    S.onQuotaError(function (info) {
      pendenteDeGravacao = true;
      ultimoErroGravacao = { erro: 'quota', mensagem: info && info.mensagem ? info.mensagem : 'Armazenamento cheio.', ts: agoraISO() };
      aviso('quota', 'quota', info && info.mensagem ? info.mensagem : 'Armazenamento local cheio: uma gravação foi recusada.');
    });
  }

  global.CRE_DATA = {
    load: load,
    save: save,
    sync: sync,
    reset: reset,
    uid: uid,
    defaultLayout: defaultLayout,
    defaultFooter: defaultFooter,
    defaultFiscal: defaultFiscal,
    defaultInvoiceModels: defaultInvoiceModels,
    todayLabel: todayLabel,
    getConfig: getConfig,
    updateConfig: updateConfig,
    applyConfigDefaults: applyConfigDefaults,
    addClient: addClient,
    updateClient: updateClient,
    deleteClient: deleteClient,
    podeExcluirCliente: podeExcluirCliente,
    dependentesDeCliente: dependentesDeCliente,
    findClient: findClient,
    searchClients: searchClients,
    addPartner: addPartner,
    updatePartner: updatePartner,
    deletePartner: deletePartner,
    podeExcluirParceiro: podeExcluirParceiro,
    dependentesDeParceiro: dependentesDeParceiro,
    findPartner: findPartner,
    searchPartners: searchPartners,
    PARTNER_ROLES: PARTNER_ROLES,
    findProposalsByPartner: findProposalsByPartner,
    getPartnerCommissionSummary: getPartnerCommissionSummary,
    addProposal: addProposal,
    updateProposal: updateProposal,
    deleteProposal: deleteProposal,
    proposalHasIssuedInvoice: proposalHasIssuedInvoice,
    getProposal: getProposal,
    searchProposals: searchProposals,
    setActiveProposal: setActiveProposal,
    getActiveProposal: getActiveProposal,
    addTemplate: addTemplate,
    deleteTemplate: deleteTemplate,
    usoDeTemplate: usoDeTemplate,
    getInvoice: getInvoice,
    findInvoicesByProposal: findInvoicesByProposal,
    findInvoicesByClient: findInvoicesByClient,
    addInvoice: addInvoice,
    updateInvoice: updateInvoice,
    deleteInvoice: deleteInvoice,
    getInvoiceModels: getInvoiceModels,
    getInvoiceModel: getInvoiceModel,
    addInvoiceModel: addInvoiceModel,
    updateInvoiceModel: updateInvoiceModel,
    deleteInvoiceModel: deleteInvoiceModel,
    usoDeModeloNota: usoDeModeloNota,
    getInvoiceStatuses: getInvoiceStatuses,
    invoiceStatusLabel: invoiceStatusLabel,
    addInvoiceStatus: addInvoiceStatus,
    deleteInvoiceStatus: deleteInvoiceStatus,
    nextNFNumber: nextNFNumber,
    derivarAtraso: derivarAtraso,
    pagamentoEfetivo: pagamentoEfetivo,
    getBackups: getBackups,
    addBackup: addBackup,
    deleteBackup: deleteBackup,
    restoreBackup: restoreBackup,
    downloadBackup: downloadBackup,
    ultimoBackup: ultimoBackup,
    nomeArquivoBackup: nomeArquivoBackup,
    exportAll: exportAll,
    importAll: importAll,
    lastImportReport: lastImportReport,
    lastConflito: lastConflito,
    onConflito: onConflito,
    /* Patch que o merge descartou porque o registro saiu do banco no meio
       da gravação. Caminho raro (restauração de backup é o caso comum), mas
       quando acontece a edição do usuário foi perdida sem que o retorno
       indicasse isso: a UI precisa de um gancho para avisar. */
    lastPatchPerdido: lastPatchPerdido,
    onPatchPerdido: onPatchPerdido,
    onStoreReplaced: onStoreReplaced,
    isDirty: isDirty,
    ultimoErro: ultimoErro,
    avisos: getAvisos,
    diagnostico: diagnostico,
    readonly: readonly,
    CONTRATO_MAX_BYTES: CONTRATO_MAX_BYTES,
    BACKUP_MAX_BYTES: BACKUP_MAX_BYTES,
    BACKUP_LIMIT: BACKUP_LIMIT,
    FORMAT_VERSION: FORMAT_VERSION,
    /* Estado da migração de "overdue" (AGENTS.md §6): a regra agora é
       CRE_FISCAL.isOverdue, exposta em derivarAtraso()/pagamentoEfetivo()
       e materializada na escrita (addInvoice/updateInvoice). O payload
       legado não é reescrito no load(). O que ainda lê nf.payment cru
       está listado aqui para o orquestrador repassar ao crm-ux. */
    NOTA_OVERDUE: 'Atraso derivado de dueDate via CRE_FISCAL.isOverdue. Leitura: CRE_DATA.pagamentoEfetivo(nf, refDate) e CRE_DATA.derivarAtraso(nf, refDate). Escrita: materializado em addInvoice/updateInvoice com aviso em CRE_DATA.avisos() (tipo "atraso"). Payload legado nunca é reescrito no load(). PENDENTE crm-ux (modules.js): tirar "overdue" das opções dos selects de pagamento (#nfPayment no formulário e o select inline da lista) e trocar nf.payment por CRE_DATA.pagamentoEfetivo(nf) em paymentPill(), no contador "Faturas Atrasadas" e em counts.overdue, no filtro invPayFilter, na impressão "Pagamento" e no toast de alteração inline - hoje todos leem nf.payment cru.'
  };

})(typeof window !== 'undefined' ? window : this);