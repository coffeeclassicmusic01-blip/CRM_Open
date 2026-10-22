/* ============================================================
   GEOREVEST STUDIO — fiscal.js
   CNPJ/CPF/CEP, dinheiro pt-BR, datas e tabelas fiscais offline.
   Módulo PURO: sem DOM, sem localStorage, sem rede. Zero dependência.

   REGRA DE OURO DESTE ARQUIVO (a armadilha que só aparece quando a
   nota é rejeitada na hora de emitir):

     SERVIÇO  -> item da Lista de Serviços (LC 116/2003), emitido em NFS-e.
                 NÃO usa NCM e NÃO usa CFOP.
     PRODUTO  -> NCM no cadastro do item + CFOP no documento fiscal.
                 NÃO usa item da LC 116.

   Dado tributário sem fonte oficial citada é opinião. Toda tabela aqui
   embaixo tem "fonte" + "fonteAcesso" por entrada e um metadado
   "_FONTE" exportado. Código não confirmado entra como "confirmado: false".
   ============================================================ */

(function (global) {
  'use strict';

  var FONTE_CONSULTA = '2026-10-08';

  /* ── Helpers internos ─────────────────────────── */

  function digits(v) {
    if (v == null) return '';
    return String(v).replace(/\D/g, '');
  }

  function trimmed(v) {
    if (v == null) return '';
    return String(v).replace(/^\s+|\s+$/g, '');
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function pad4(n) {
    var s = String(n);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  // Dígitos todos iguais (000, 111, 999) passam no mod-11 sem esforço.
  // Não correspondem a nenhum documento emitido e são o erro mais comum
  // de validador online — e é exatamente o que o seed do app usa hoje.
  function isRepeated(d) {
    return /^(\d)\1*$/.test(d);
  }

  function normKey(v) {
    return trimmed(v).toLowerCase();
  }

  function inList(value, list) {
    var k = normKey(value);
    for (var i = 0; i < list.length; i++) {
      if (list[i] === k) return true;
    }
    return false;
  }

  /* ── Dígito verificador mod-11 ────────────────── */

  var CNPJ_PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  var CNPJ_PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  var CPF_PESOS_DV1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  var CPF_PESOS_DV2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

  // resto 0 ou 1 -> dígito 0. resto 2..10 -> 11 - resto.
  // O "> 1" (e não "> 0") é o que faz o dígito cair em 0 quando o resto é 1.
  function dvMod11(base, pesos) {
    var soma = 0;
    for (var i = 0; i < pesos.length; i++) {
      soma += Number(base.charAt(i)) * pesos[i];
    }
    var resto = soma % 11;
    return resto > 1 ? 11 - resto : 0;
  }

  /* ── CNPJ / CPF ───────────────────────────────── */

  function isValidCnpj(v) {
    var d = digits(v);
    if (d.length !== 14 || isRepeated(d)) return false;
    if (dvMod11(d.substr(0, 12), CNPJ_PESOS_DV1) !== Number(d.charAt(12))) return false;
    return dvMod11(d.substr(0, 13), CNPJ_PESOS_DV2) === Number(d.charAt(13));
  }

  function isValidCpf(v) {
    var d = digits(v);
    if (d.length !== 11 || isRepeated(d)) return false;
    if (dvMod11(d.substr(0, 9), CPF_PESOS_DV1) !== Number(d.charAt(9))) return false;
    return dvMod11(d.substr(0, 10), CPF_PESOS_DV2) === Number(d.charAt(10));
  }

  function formatCnpj(v) {
    var d = digits(v);
    if (d.length < 12 || d.length > 14) return trimmed(v);
    var s = d.substr(0, 2) + '.' + d.substr(2, 3) + '.' + d.substr(5, 3) + '/' + d.substr(8, 4);
    if (d.length === 12) return s;
    return s + '-' + d.substring(12);
  }

  function formatCpf(v) {
    var d = digits(v);
    if (d.length < 10 || d.length > 11) return trimmed(v);
    var s = d.substr(0, 3) + '.' + d.substr(3, 3) + '.' + d.substr(6, 3) + '-';
    if (d.length === 10) return s + d.charAt(9);
    return s + d.substring(9);
  }

  /* ── CEP ──────────────────────────────────────── */

  // Só o formato é validado offline. Não validamos prefixo por região:
  // a numeração muda e uma regra fixa rejeitaria CEP legítimo.
  function isValidCep(v) {
    return digits(v).length === 8;
  }

  function formatCep(v) {
    var d = digits(v);
    if (d.length < 5 || d.length > 8) return trimmed(v);
    if (d.length === 5) return d + '-';
    return d.substr(0, 5) + '-' + d.substr(5);
  }

  function parseCep(v) {
    var d = digits(v);
    return d.length === 8 ? d : '';
  }

  /* ── Dinheiro pt-BR ───────────────────────────── */

  function round2(n) {
    if (typeof n !== 'number' || n !== n || !isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  // Desambiguação do separador (a ordem importa):
  //  1. há "," -> é o decimal pt-BR; "." é sempre milhar.
  //  2. não há "," e há exatamente um "." seguido de 1-2 dígitos -> decimal.
  //     "1.234" é milhar porque "234" tem 3 dígitos. "3.5" é decimal.
  //  3. resto: "." é milhar e some inteiro.
  // Sem isso, parseBRL (js/app.js:161) tratava "3.5" como 35 e "1.234,56"
  // como 1.23456 — erro de 10x que corrompia o total da proposta.
  function parseMoney(v) {
    if (typeof v === 'number') return round2(v);
    if (v == null) return 0;

    var s = trimmed(String(v).replace(/[^\d.,-]/g, ''));
    if (!s) return 0;

    var neg = false;
    if (s.charAt(0) === '-') {
      neg = true;
      s = s.substring(1);
    }

    var out;
    if (s.indexOf(',') !== -1) {
      var limpo = s.replace(/\./g, '');
      var p = limpo.lastIndexOf(',');
      out = limpo.substring(0, p).replace(/,/g, '') + '.' + limpo.substring(p + 1);
    } else if (s.indexOf('.') !== -1) {
      var iDot = s.lastIndexOf('.');
      var depois = s.substring(iDot + 1);
      if (s.indexOf('.') === iDot && depois.length > 0 && depois.length <= 2) {
        out = s;
      } else {
        out = s.replace(/\./g, '');
      }
    } else {
      out = s;
    }

    var n = parseFloat(out);
    // Nunca devolver NaN: ele se propaga em silêncio numa soma e só aparece
    // como "R$ NaN" no documento impresso. 0 deixa o validador avisar.
    if (typeof n !== 'number' || n !== n || !isFinite(n)) return 0;
    return neg ? round2(-n) : round2(n);
  }

  // Montagem manual em vez de toLocaleString: o separador de milhar e a
  // vírgula decimal são fixos por contrato, e assim o resultado não muda
  // se o runtime vier sem os dados de locale pt-BR.
  function formatMoney(v) {
    var n = parseMoney(v);
    var neg = n < 0;
    var partes = String(round2(Math.abs(n))).split('.');
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var dec = partes[1] || '';
    while (dec.length < 2) dec += '0';
    return (neg ? '-R$ ' : 'R$ ') + inteiro + ',' + dec;
  }

  /* ── Contato ──────────────────────────────────── */

  // Deliberadamente permissiva: recusar um e-mail válido é pior que
  // deixar passar lixo, porque o app roda offline e não pode confirmar.
  var EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/;

  function isValidEmail(v) {
    return EMAIL_RE.test(trimmed(v));
  }

  function isValidPhoneBR(v) {
    var d = digits(v);
    if (!d) return false;
    if ((d.length === 12 || d.length === 13) && d.substr(0, 2) === '55') {
      d = d.substring(2);
    }
    if (d.length !== 10 && d.length !== 11) return false;
    if (isRepeated(d)) return false;
    var ddd = Number(d.substr(0, 2));
    if (ddd < 11 || ddd > 99) return false;
    // 11 dígitos só existe como celular, e celular brasileiro tem nono dígito 9.
    return d.length === 10 || d.charAt(2) === '9';
  }

  /* ── Datas ────────────────────────────────────── */

  function mkLocal(y, mo, d, h, mi, s) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null;
    var dt = new Date(y, mo - 1, d, h, mi, s);
    // O construtor Date rola data inválida em vez de falhar (30/02 vira 02/03).
    // Só o round-trip separa "existe no calendário" de "foi normalizado".
    if (y < 100) dt.setFullYear(y);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function isDate(v) {
    return Object.prototype.toString.call(v) === '[object Date]';
  }

  // NUNCA usar toISOString(): ele converte para UTC e em America/Sao_Paulo
  // (UTC-3) empurra qualquer data para o dia anterior. É o off-by-one que
  // estamos corrigindo aqui — vencimento virando "ontem" marca tudo como atrasado.
  function toISODate(d) {
    if (d == null) return '';
    var dt;

    if (isDate(d)) {
      dt = d;
    } else if (typeof d === 'string') {
      var s = trimmed(d);
      if (!s) return '';
      var mData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      var mISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
      var mBR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);

      if (mISO) {
        // Com fuso explícito o valor é um instante: converte e usa as partes
        // locais. Sem fuso, monta local — new Date('2026-10-01') seria UTC.
        dt = mISO[8] ? new Date(s.replace(' ', 'T')) : mkLocal(
          Number(mISO[1]), Number(mISO[2]), Number(mISO[3]),
          Number(mISO[4]), Number(mISO[5]), Number(mISO[6] || 0)
        );
      } else if (mData) {
        dt = mkLocal(Number(mData[1]), Number(mData[2]), Number(mData[3]), 0, 0, 0);
      } else if (mBR) {
        dt = mkLocal(Number(mBR[3]), Number(mBR[2]), Number(mBR[1]), 0, 0, 0);
      } else {
        return '';
      }
    } else {
      return '';
    }

    if (!dt || isNaN(dt.getTime())) return '';
    return pad4(dt.getFullYear()) + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function isValidISODate(v) {
    if (isDate(v)) return !isNaN(v.getTime());
    if (typeof v !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var p = v.split('-');
    return mkLocal(Number(p[0]), Number(p[1]), Number(p[2]), 0, 0, 0) !== null;
  }

  /* ── Atraso derivado do vencimento ────────────── */

  var STATUS_PAGO = ['paid', 'pago', 'liquidado', 'quitado', 'liquida', 'quitada'];
  var STATUS_CANCELADO = ['cancelado', 'cancelada', 'cancelled', 'canceled', 'cancel'];
  var PAYMENT_PAGO = ['paid', 'pago', 'liquidado', 'quitado'];
  var PAYMENT_SEM_FINANCEIRO = ['nofin', 'sem-financeiro'];

  // O campo "payment" manual do app (pending/partial/paid/overdue/nofin) é
  // a chave que modules.js filtra hoje, por isso ele entra junto de
  // "status". "nofin" nunca conta como atraso: documento sem financeiro não
  // pode aparecer no cartão "Faturas Atrasadas".
  function isOverdue(nf, refDate) {
    if (!nf || typeof nf !== 'object') return false;
    if (inList(nf.status, STATUS_CANCELADO)) return false;
    if (nf.paid === true) return false;
    if (inList(nf.payment, PAYMENT_PAGO) || inList(nf.status, STATUS_PAGO)) return false;
    if (inList(nf.payment, PAYMENT_SEM_FINANCEIRO) || nf.geraFinanceiro === false) return false;

    var due = toISODate(nf.dueDate);
    if (!due) return false;

    var ref = toISODate(refDate);
    if (!ref) ref = todayISO();

    // Ambas em YYYY-MM-DD: comparação por string é segura e não depende
    // de fuso nem de Date.
    return due < ref;
  }

  /* ── Aviso de documento interno ───────────────── */

  var DISCLAIMER = 'Documento interno de comprovação, sem valor fiscal. ' +
    'Não é NF-e nem NFS-e, não substitui documento fiscal emitido pela SEFAZ ' +
    'e não possui validade legal para fins de tribulação.';

  function taxDisclaimer() {
    return DISCLAIMER;
  }

  /* ── Tabela CFOP (uso exclusivo de PRODUTO) ────── */

  /* Subconjunto da tabela CFOP oficial — somente as naturezas de operação
     que o app realmente emite hoje. NÃO é a tabela completa.
     Órgão emissor: CONFAZ (competência exclusiva). Ato: Convênio SINIEF
     s/nº de 15/12/1970, Anexo II, na nova redação dada pelo Ajuste SINIEF
     03/24 (efeitos a partir de 01/06/2024).
      Texto literal lido em 08/10/2026 em
      https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cfop_cvsn_1-6.24
     Subconjunto: 5101, 5102, 5949, 6101, 6102.
     Ficaram de fora: devoluções (1202, 5202 e afins), remessas (5904, 6904
     e afins), substituição tributária (5405, 6405 e afins) e operações de
     entrada — nenhuma é emitida por este app hoje. */
  var FOOTER_CFOP = [
    {
      codigo: '5101',
      descricao: 'Venda de produção do estabelecimento',
      grupo: '5.1',
      grupoOficial: '5000 - SAÍDAS OU PRESTAÇÕES DE SERVIÇOS PARA O ESTADO',
      tipo: 'produto',
      origem: 'propria',
      interestadual: false,
      confirmado: true,
      fonte: 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop',
      fonteAcesso: FONTE_CONSULTA
    },
    {
      codigo: '5102',
      descricao: 'Venda de mercadoria adquirida ou recebida de terceiros',
      grupo: '5.1',
      grupoOficial: '5000 - SAÍDAS OU PRESTAÇÕES DE SERVIÇOS PARA O ESTADO',
      tipo: 'produto',
      origem: 'terceiros',
      interestadual: false,
      confirmado: true,
      fonte: 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop',
      fonteAcesso: FONTE_CONSULTA
    },
    {
      codigo: '5949',
      descricao: 'Outra saída de mercadoria ou prestação de serviço não especificada',
      grupo: '5.1',
      grupoOficial: '5000 - SAÍDAS OU PRESTAÇÕES DE SERVIÇOS PARA O ESTADO',
      tipo: 'produto',
      origem: 'nao-classificavel',
      interestadual: false,
      confirmado: true,
      generico: true,
      nota: 'Texto do Anexo II cobre "prestação de serviço"; a origem ' +
        '(produção própria ou mercadoria de terceiros) não é dedutível do código. ' +
        'Genérico: se existe código específico para a operação, ele prevalece. ' +
        'Redação literal do Anexo II: "Classificam-se neste código as outras ' +
        'saídas de mercadorias ou prestações de serviços que não tenham sido ' +
        'especificadas neste grupo."',
      fonte: 'https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cfop_cvsn_1-6.24',
      fonteAcesso: FONTE_CONSULTA
    },
    {
      codigo: '6101',
      descricao: 'Venda de produção do estabelecimento',
      grupo: '6.1',
      grupoOficial: '6000 - SAÍDAS OU PRESTAÇÕES DE SERVIÇOS PARA OUTROS ESTADOS',
      tipo: 'produto',
      origem: 'propria',
      interestadual: true,
      confirmado: true,
      fonte: 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop',
      fonteAcesso: FONTE_CONSULTA
    },
    {
      codigo: '6102',
      descricao: 'Venda de mercadoria adquirida ou recebida de terceiros',
      grupo: '6.1',
      grupoOficial: '6000 - SAÍDAS OU PRESTAÇÕES DE SERVIÇOS PARA OUTROS ESTADOS',
      tipo: 'produto',
      origem: 'terceiros',
      interestadual: true,
      confirmado: true,
      fonte: 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop',
      fonteAcesso: FONTE_CONSULTA
    }
  ];

  var FOOTER_CFOP_FONTE = {
    ato: 'Convênio SINIEF s/nº de 15 de dezembro de 1970, Anexo II, com alterações pelos Ajustes SINIEF (nova redação vigente dada pelo Ajuste SINIEF 03/24, efeitos a partir de 01/06/2024)',
    orgao: 'CONFAZ — detentor da competência exclusiva para estabelecer o CFOP',
    url: 'https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cfop_cvsn_1-6.24',
    urlNormativa: 'https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/cfop_cvsn_1-6.24',
    urlEspelho: 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop',
    orgaoNormativo: 'CONFAZ (Ajustes SINIEF)',
    consultadoEm: FONTE_CONSULTA,
    subconjunto: '5101, 5102, 5949, 6101, 6102',
    ressalva: 'O texto de 5949 foi lido literalmente no Anexo II publicado pelo CONFAZ (url) em 08/10/2026 — o espelho da Receita Federal (urlEspelho), consultado no mesmo dia, não traz 5949; os demais códigos do subconjunto foram relidos no espelho em 08/10/2026, sem alteração desde 01/10/2026. Havendo divergência entre o espelho e o Anexo II, prevalece o Anexo II. Antes de emitir, conferir o enquadramento com o contador.'
  };

  /* ── NCM (uso exclusivo de PRODUTO) ────────────── */

  function isValidNcm(v) {
    return digits(v).length === 8;
  }

  function formatNcm(v) {
    var d = digits(v);
    if (d.length < 4 || d.length > 8) return trimmed(v);
    if (d.length <= 4) return d;
    if (d.length <= 6) return d.substr(0, 4) + '.' + d.substr(4);
    return d.substr(0, 4) + '.' + d.substr(4, 2) + '.' + d.substr(6);
  }

  /* A tabela NCM completa tem ~1.500 posições e NÃO cabe aqui. Este é um
     subconjunto curado para os itens que uma empresa de engenharia
     geotécnica faturaria como produto (membranas, materiais de concreto,
    Solo britado, bombas de rebaixamento e equipamentos de sondagem).
     Serviço não entra aqui — vai na Lista de Serviços da LC 116. */
  /* As descrições abaixo vieram do espelho CSV da balança comercial lido em
      01/10/2026. O certificado HTTPS desse host (*.economia.gov.br, emitido
      pela SERPRO) venceu em 03/10/2026 e desde então a conexão é recusada —
      retestado em 08/10/2026 (erro de cadeia no certificado do servidor, não
      é bloqueio local). O espelho é mantido apenas como procedência da
      leitura; para obter a tabela vigente hoje, usar a página oficial da
      Receita Federal ou o JSON direto do módulo Classif (Portal Único/
      Siscomex), que respondem com HTTP 200 sem captcha. */
  var NCM_ESPELHO_URL = 'https://balanca.economia.gov.br/balanca/bd/tabelas/NCM.csv';
  /* Última leitura efetiva do CSV do espelho. Difere de FONTE_CONSULTA porque
     o host continua com o certificado vencido e a fonte não pôde ser reaberta. */
  var NCM_ESPELHO_ACESSO = '2026-10-01';
  var NCM_TABELA_URL = 'https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/classificacao-fiscal-de-mercadorias/download-ncm-nomenclatura-comum-do-mercosul';
  var NCM_TABELA_DOWNLOAD = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json';

  var FOOTER_NCM = [
    {
      codigo: '3918.10.00',
      descricao: 'Revestimentos de pavimentos, etc, de polímeros de cloreto vinila',
      confirmado: false,
      nota: 'Código informado pelo cliente e ainda NÃO conferido pelo contador. ' +
        'A descrição foi extraída literalmente da tabela oficial (abaixo), mas a ' +
        'adequação deste NCM ao produto efetivamente faturado depende de ' +
        'validação contábil antes do primeiro documento.',
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '6807.10.00',
      descricao: 'Obras de asfalto ou de produtos semelhantes (por exemplo, breu ou pez), em rolos',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '6807.90.00',
      descricao: 'Outras obras de asfalto ou de produtos semelhantes (por exemplo, breu ou pez)',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '6810.11.00',
      descricao: 'Blocos e tijolos para a construção, de cimento, de concreto ou de pedra artificial, mesmo armadas',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '6810.91.00',
      descricao: 'Elementos pré-fabricados para a construção ou engenharia civil, de cimento, de concreto ou de pedra artificial, mesmo armadas',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '3824.40.00',
      descricao: 'Aditivos preparados para cimentos, argamassas ou concretos (betões)',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '3824.50.00',
      descricao: 'Argamassas e concretos (betões), não refratários',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '3506.91.10',
      descricao: 'Adesivos à base de borracha',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '3506.91.90',
      descricao: 'Outros adesivos à base de plásticos',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '2715.00.00',
      descricao: 'Misturas betuminosas à base de asfalto ou de betume naturais, de betume de petróleo, de alcatrão mineral ou de breu de alcatrão mineral (por exemplo, mástiques betuminosas e cut-backs)',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '2517.10.00',
      descricao: 'Calhaus, cascalho, pedras britadas, dos tipos geralmente usados em concreto ou para empedramento de estradas, de vias férreas ou outros balastros, seixos rolados e sílex, mesmo tratados termicamente',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '2523.29.10',
      descricao: 'Cimentos "portland", comuns',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '8413.81.00',
      descricao: 'Outras bombas para líquidos',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '8413.70.10',
      descricao: 'Eletrobombas submersíveis',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '8421.21.00',
      descricao: 'Aparelhos para filtrar ou depurar água',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '8207.19.90',
      descricao: 'Outras ferramentas de perfuração ou de sondagem, de metais comuns, inclusive partes',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '8430.41.30',
      descricao: 'Máquinas de sondagem, rotativas, autopropulsadas',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    },
    {
      codigo: '8430.49.20',
      descricao: 'Outras máquinas de sondagem, rotativas',
      confirmado: true,
      fonte: NCM_ESPELHO_URL,
      fonteAcesso: NCM_ESPELHO_ACESSO
    }
  ];

  var FOOTER_NCM_FONTE = {
    ato: 'Nomenclatura Comum do Mercosul (NCM) — aprovada pelo Mercosul (Decisão do Conselho do Mercado Comum / Resolução do Grupo Mercado Comum) e internalizada no Brasil pela Resolução GECEX nº 272/2021 e suas alterações',
    orgao: 'MDIC/Secex — módulo Classif do Portal Único do Comércio Exterior (tabela vigente); página oficial de download mantida pela Receita Federal',
    url: NCM_TABELA_URL,
    urlDownloadDireto: NCM_TABELA_DOWNLOAD,
    urlVerificadaEm: '2026-10-08',
    espelhoConsultado: NCM_ESPELHO_URL,
    espelhoSituacao: 'O certificado HTTPS de balanca.economia.gov.br (*.economia.gov.br, SERPRO) venceu em 03/10/2026 e em 08/10/2026 a conexão foi recusada pelo cliente TLS. O espelho fica registrado apenas como procedência da leitura de 01/10/2026 — não usar como link ativo.',
    consultadoEm: FONTE_CONSULTA,
    tabelaVigente: 'JSON oficial do Classif declara "Vigente em 08/10/2026", ato "Resolução Gecex nº 926/2026" (lido em 08/10/2026)',
    subconjunto: '18 posições curadas para engenharia geotécnica + 1 pendente (3918.10.00)',
    ressalva: 'A tabela completa tem cerca de 1.500 posições e não é embutida aqui. ' +
      'Este subconjunto não substitui a consulta à tabela vigente no momento da emissão. ' +
      'As descrições gravadas vieram do espelho de 01/10/2026; em 08/10/2026 cada ' +
      'posição foi revalidada contra o caminho hierárquico do JSON oficial do Classif ' +
      '(cada nível traz só o seu fragmento — a concatenação vem em arquivo separado da ' +
      'interface do Portal Único). Corrigidas para a redação oficial: 3824.40.00, ' +
      '3824.50.00, 2715.00.00, 8430.41.30 e o erro de digitação de 6810.11.00. ' +
      'Divergência mantida de propósito, à espera do contador: 2517.10.00, 2523.29.10 ' +
      'e 3918.10.00. Sínteses do caminho hierárquico (não literais no nível do código) ' +
      'em 6810.11.00, 6810.91.00, 3506.91.90, 8413.81.00, 8207.19.90 e 8430.41.30 — ' +
      'conferir a tabela vigente e o contador antes de emitir.'
  };

  /* ── Lista de Serviços LC 116/2003 (uso exclusivo de SERVIÇO) ── */

  var LC116_FONTE_URL = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm';

  /* Apenas 7.02 e 7.03. 7.17 (escoramento e contenção de encostas),
     7.19 (fiscalização de obras) e 7.20 (aerofotogrametria/topografia)
     são relevantes para o setor, mas o texto vigente delas não foi conferido
     nem validado pelo contador nesta fase — e a LC 214/2025 já alterou o
     regime de vários itens do 7. Preferimos item faltando a item errado. */
  var FOOTER_LC116 = [
    {
      codigo: '7.02',
      item: '7',
      descricao: 'Execução, por administração, empreitada ou subempreitada, de obras de ' +
        'construção civil, hidráulica ou elétrica e de outras obras semelhantes, ' +
        'inclusive sondagem, perfuração de poços, escavação, drenagem e irrigação, ' +
        'terraplanagem, pavimentação, concretagem e a instalação e montagem de ' +
        'produtos, peças e equipamentos (exceto o fornecimento de mercadorias ' +
        'produzidas pelo prestador de serviços fora do local da prestação dos serviços, ' +
        'que fica sujeito ao ICMS).',
      confirmado: true,
      fonte: LC116_FONTE_URL,
      fonteAcesso: FONTE_CONSULTA
    },
    {
      codigo: '7.03',
      item: '7',
      descricao: 'Elaboração de planos diretores, estudos de viabilidade, estudos ' +
        'organizacionais e outros, relacionados com obras e serviços de engenharia; ' +
        'elaboração de anteprojetos, projetos básicos e projetos executivos para ' +
        'trabalhos de engenharia.',
      confirmado: true,
      fonte: LC116_FONTE_URL,
      fonteAcesso: FONTE_CONSULTA
    }
  ];

  var FOOTER_LC116_FONTE = {
    ato: 'Lei Complementar nº 116, de 31 de julho de 2003 — Lista de Serviços anexa',
    orgao: 'Presidência da República / Casa Civil (Planalto)',
    url: LC116_FONTE_URL,
    consultadoEm: FONTE_CONSULTA,
    subconjunto: '7.02 e 7.03',
    foraDoSubconjunto: [
      {
        codigo: '7.17',
        motivo: 'Ainda não conferido nem validado pelo contador nesta fase; não incluído para evitar dado incorreto.'
      },
      {
        codigo: '7.19',
        motivo: 'Ainda não conferido nem validado pelo contador nesta fase; não incluído para evitar dado incorreto.'
      },
      {
        codigo: '7.20',
        motivo: 'Ainda não conferido nem validado pelo contador nesta fase; não incluído para evitar dado incorreto.'
      }
    ],
    ressalva: 'O texto de 7.02 contém o parêntese do art. 7º, § 2º, I (exceção do ' +
      'fornecimento de mercadorias sujeitas ao ICMS). A alteração de redação de subitens ' +
      'do item 7 (7.02, 7.19 e 14.14) foi dada pela Lei Complementar nº 218, de 2025; ' +
      'o regime de efeitos de algumas alterações consta da LC 214/2025 — conferir a redação vigente antes de emitir.'
  };

  /* ── Buscas nas tabelas ────────────────────────── */

  function findByCodigo(tabela, codigo) {
    if (!tabela || !codigo) return null;
    var alvo = digits(codigo);
    for (var i = 0; i < tabela.length; i++) {
      if (digits(tabela[i].codigo) === alvo) return tabela[i];
    }
    return null;
  }

  function findCfop(codigo) {
    return findByCodigo(FOOTER_CFOP, codigo);
  }

  function findNcm(codigo) {
    return findByCodigo(FOOTER_NCM, codigo);
  }

  function findLc116(codigo) {
    if (!codigo) return null;
    var alvo = trimmed(codigo);
    for (var i = 0; i < FOOTER_LC116.length; i++) {
      if (FOOTER_LC116[i].codigo === alvo) return FOOTER_LC116[i];
    }
    return null;
  }

  /* ── API pública ───────────────────────────────── */

  global.CRE_FISCAL = {
    isValidCnpj: isValidCnpj,
    isValidCpf: isValidCpf,
    isValidCep: isValidCep,
    formatCnpj: formatCnpj,
    formatCpf: formatCpf,
    formatCep: formatCep,
    parseCep: parseCep,
    parseMoney: parseMoney,
    formatMoney: formatMoney,
    isValidEmail: isValidEmail,
    isValidPhoneBR: isValidPhoneBR,
    todayISO: todayISO,
    toISODate: toISODate,
    isValidISODate: isValidISODate,
    isOverdue: isOverdue,
    taxDisclaimer: taxDisclaimer,
    FOOTER_CFOP: FOOTER_CFOP,
    FOOTER_NCM: FOOTER_NCM,
    isValidNcm: isValidNcm,
    formatNcm: formatNcm,
    FOOTER_LC116: FOOTER_LC116,
    FOOTER_CFOP_FONTE: FOOTER_CFOP_FONTE,
    FOOTER_NCM_FONTE: FOOTER_NCM_FONTE,
    FOOTER_LC116_FONTE: FOOTER_LC116_FONTE,
    findCfop: findCfop,
    findNcm: findNcm,
    findLc116: findLc116
  };

})(typeof window !== 'undefined' ? window : this);