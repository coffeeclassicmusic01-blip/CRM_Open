/* ============================================================
   GEOREVEST STUDIO — storage.js
   Wrapper fino sobre localStorage: deteccao de quota e de
   armazenamento indisponivel. Namespace window.CRE_STORAGE.
   Sem DOM, sem rede, sem dependencia.
   ============================================================ */

(function (global) {
  'use strict';

  /* O app so escreve em chaves com este prefixo. E a allowlist que
     impede um valor injetado de criar chave '__proto__' ou similar. */
  var PREFIXO_PERMITIDO = 'georevest-';

  /* localStorage nao expoe cota. ~5 MB e o limite classico do Chrome/Edge
     por origem (10 MB no Firefox, 5 MB no Safari). E uma ESTIMATIVA para
     exibir na tela — nao um numero medido, e nunca usado como corte. */
  var QUOTA_ESTIMADA_BYTES = 5 * 1024 * 1024;

  var PREFS = '_georevest_retencao_';   /* rev isolado, evita parse do blob inteiro */
  var LIMITE_PREFS = 40;

  /* ── Backend ─────────────────────────────────────────────── */

  function backend() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  /* available() responde SO se a API existe e le. No modo privado do
     Safari getItem funciona e setItem lanca — quem descobre isso e write(),
     no momento do uso. Detectar no load derrubaria o app inteiro nesses
     navegadores. */
  function available() {
    var s = backend();
    if (!s) return false;
    try { s.getItem(PREFIXO_PERMITIDO + '__probe'); return true; } catch (e) { return false; }
  }

  /* ── Quota ───────────────────────────────────────────────── */

  function isQuotaError(e) {
    if (!e) return false;
    var n = String(e.name || '');
    if (n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || n === 'QuotaExceeded') return true;
    /* Chrome/Edge: DOMException legado code 22. Firefox antigo: number 1014. */
    if (e.code === 22 || e.code === 1014) return true;
    if (e.number === 22 || e.number === 1014) return true;
    return false;
  }

  function ehChavePermitida(key) {
    return typeof key === 'string' && key.length > 0 && key.indexOf(PREFIXO_PERMITIDO) === 0;
  }

  function ehChavePreferida(key) {
    return ehChavePermitida(key) && key.indexOf(PREFS) === 0;
  }

  /* ── Bytes ───────────────────────────────────────────────── */

  function bytesOf(str) {
    var s = (str === null || str === undefined) ? '' : String(str);
    if (typeof global.TextEncoder === 'function') {
      try { return new global.TextEncoder().encode(s).length; } catch (e) { /* segue para o fallback */ }
    }
    var n = 0;
    try { n = unescape(encodeURIComponent(s)).length; } catch (e) { n = s.length; }
    return n;
  }

  function kb(bytes) {
    return Math.round((bytes / 1024) * 10) / 10;
  }

  function falha(erro, mensagem, bytes, detalhe) {
    var r = { ok: false, erro: erro, mensagem: mensagem, bytes: bytes || 0 };
    if (detalhe) r.detalhe = detalhe;
    return r;
  }

  /* ── Leitura / escrita ───────────────────────────────────── */

  function readRaw(key) {
    var s = backend();
    if (!s) return null;
    try {
      var v = s.getItem(key);
      return (v === undefined) ? null : v;
    } catch (e) { return null; }
  }

  function read(key, fallback) {
    var raw = readRaw(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function write(key, value) {
    var s = backend();
    if (!s) {
      return falha('unavailable',
        'Este navegador ou esta janela nao permite armazenamento local. Nada foi salvo.', 0);
    }
    if (!ehChavePermitida(key)) {
      /* erro fica no conjunto que a UI conhece ('quota','unavailable',
         'serialize','unknown'); o motivo vai em `detalhe`. */
      return falha('unknown',
        'Chave de armazenamento recusada: "' + key + '". O app só grava em chaves que começam com "' +
        PREFIXO_PERMITIDO + '".', 0, 'chave-fora-do-prefixo');
    }

    var str;
    if (typeof value === 'string') {
      str = value;
    } else {
      try { str = JSON.stringify(value); } catch (e) {
        return falha('serialize',
          'Nao foi possivel serializar o dado para salvar (valor circular ou nao serializavel).', 0);
      }
      if (typeof str !== 'string') {
        return falha('serialize', 'O valor informado nao e serializavel.', 0);
      }
    }

    var bytes = bytesOf(str);
    try {
      s.setItem(key, str);
    } catch (e) {
      if (isQuotaError(e)) {
        var msg = 'Espaco insuficiente no armazenamento do navegador: os dados nao foram salvos ' +
          '(esta gravacao ocuparia ' + kb(bytes) + ' KB). Exporte um backup em arquivo e limpe ' +
          'o historico de backups.';
        avisarQuota(key, msg);
        return falha('quota', msg, bytes);
      }
      return falha('unavailable',
        'O navegador recusou a gravacao. Nada foi salvo — exporte um backup antes de continuar.', bytes);
    }
    return { ok: true, bytes: bytes, chave: key };
  }

  function remove(key) {
    var s = backend();
    if (!s) return { ok: false, erro: 'unavailable', mensagem: 'Armazenamento local indisponivel.', bytes: 0 };
    if (!ehChavePermitida(key)) return falha('unknown', 'Chave de armazenamento recusada.', 0, 'chave-fora-do-prefixo');
    try { s.removeItem(key); return { ok: true, bytes: 0, chave: key }; } catch (e) {
      return falha('unknown', 'Nao foi possivel remover "' + key + '".', 0);
    }
  }

  /* ── Carimbo de revisao (otimizacao) ─────────────────────── */

  /* O rev autoritativo vive DENTRO do payload. Aqui fica so um espelho
     minimo, para que outra aba detecte mudanca sem parsear o blob inteiro.
     Falha ao gravar este espelho e inofensiva: a aba seguinte cai no
     caminho lento (comparacao de texto) e continua correta. */
  function chavePreferida(key) { return PREFS + key; }

  function stamp(key, rev) {
    if (!ehChavePermitida(key)) return false;
    var s = backend();
    if (!s) return false;
    try {
      var k = chavePreferida(key);
      s.setItem(k, String(rev));
      /* Não deixa o espelho crescer sem limite se o código da chave mudar. */
      var n;
      try { n = s.length; } catch (e) { n = 0; }
      if (n > LIMITE_PREFS + 8) {
        for (var i = 0; i < n; i++) {
          var kk;
          try { kk = s.key(i); } catch (e2) { break; }
          if (kk && kk.indexOf(PREFS) === 0 && kk !== k) { try { s.removeItem(kk); } catch (e3) { /* silent */ } }
        }
      }
      return true;
    } catch (e) { return false; }
  }

  function stampOf(key) {
    var raw = readRaw(chavePreferida(key));
    if (raw === null) return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  /* ── Uso de espaco (so para exibir) ──────────────────────── */

  /* navigator.storage.estimate() devolve Promise. Ler .quota direto daria
   undefined e a tela cairia no padrao sem nunca melhorar, entao o
   resultado fica guardado para as proximas leituras. */
var cotaConhecida = 0;
var fonteConhecida = 'padrao-navegador';

  function estimarCota() {
    try {
      if (global.navigator && global.navigator.storage && typeof global.navigator.storage.estimate === 'function') {
        var est = global.navigator.storage.estimate();
        if (est && typeof est.then === 'function') {
          est.then(function (r) {
            if (r && r.quota > 0) { cotaConhecida = r.quota; fonteConhecida = 'estimate-api'; }
          }, function () { /* sem cota pelo navegador: segue na estimativa */ });
          return;
        }
        if (est && est.quota > 0) { cotaConhecida = est.quota; fonteConhecida = 'estimate-api'; }
      }
    } catch (e) { /* segue com a estimativa padrao */ }
  }

  function usage() {
    var s = backend();
    var itens = [];
    var total = 0;
    if (s) {
      try {
        var n = s.length;
        for (var i = 0; i < n; i++) {
          var k = s.key(i);
          if (!k || k.indexOf(PREFIXO_PERMITIDO) !== 0) continue;
          var b = bytesOf(s.getItem(k));
          itens.push({ chave: k, bytes: b });
          total += b;
        }
      } catch (e) { /* enumeracao indisponivel: reporta 0 em vez de mentir */ }
    }

    /* estimate() cobre a origem inteira (IndexedDB, Cache, etc.) e NAO e
       o limite de localStorage. Serviu de ordem de grandeza. */
    if (!cotaConhecida) estimarCota();
    var quotaBytes = cotaConhecida || QUOTA_ESTIMADA_BYTES;
    var fonteQuota = cotaConhecida ? fonteConhecida : 'padrao-navegador';

    return {
      bytes: total,
      itens: itens,
      quotaBytes: quotaBytes,
      fracao: quotaBytes > 0 ? Math.round((total / quotaBytes) * 1000) / 1000 : 0,
      fonteQuota: fonteQuota,
      estimativa: true,
      nota: 'Medido: o que o app ocupa em localStorage. Estimado: a cota, que o navegador nao expoe.'
    };
  }

  /* ── Avisos: quota e mudanca externa ─────────────────────── */

  var quotaCbs = [];
  var changeCbs = [];
  var bound = false;

  function avisarQuota(key, mensagem) {
    for (var i = 0; i < quotaCbs.length; i++) {
      try { quotaCbs[i]({ chave: key, mensagem: mensagem, uso: usage() }); } catch (e) { /* silent */ }
    }
  }

  function onQuotaError(cb) {
    if (typeof cb !== 'function') return function () { };
    quotaCbs.push(cb);
    return function () { var i = quotaCbs.indexOf(cb); if (i !== -1) quotaCbs.splice(i, 1); };
  }

  function avisarMudanca(chave) {
    for (var i = 0; i < changeCbs.length; i++) {
      try { changeCbs[i]({ chave: chave }); } catch (e) { /* silent */ }
    }
  }

  function onExternalChange(cb, canal) {
    if (typeof cb !== 'function') return function () { };
    changeCbs.push(cb);
    ligarEventos();
    var bc = null;
    /* Otimizacao. A deteccao por rev no load() funciona sem isto. */
    if (canal && typeof global.BroadcastChannel === 'function') {
      try {
        bc = new global.BroadcastChannel('georevest-sync');
        bc.onmessage = function () { avisarMudanca(null); };
      } catch (e) { bc = null; }
    }
    return function () {
      var i = changeCbs.indexOf(cb);
      if (i !== -1) changeCbs.splice(i, 1);
      if (bc) { try { bc.close(); } catch (e) { /* silent */ } }
    };
  }

  function ligarEventos() {
    if (bound) return;
    bound = true;
    if (typeof global.addEventListener !== 'function') return;
    try {
      global.addEventListener('storage', function (e) {
        if (!e || typeof e.key !== 'string') return;
        if (e.key.indexOf(PREFIXO_PERMITIDO) !== 0) return;
        avisarMudanca(e.key);
      });
    } catch (e) { /* silent */ }
  }

  /* Notifica as outras abas depois de uma escrita confirmada. */
  function broadcast() {
    if (typeof global.BroadcastChannel !== 'function') return false;
    try {
      var bc = new global.BroadcastChannel('georevest-sync');
      bc.postMessage('changed');
      setTimeout(function () { try { bc.close(); } catch (e) { /* silent */ } }, 0);
      return true;
    } catch (e) { return false; }
  }

  global.CRE_STORAGE = {
    read: read,
    readRaw: readRaw,
    write: write,
    remove: remove,
    bytesOf: bytesOf,
    isQuotaError: isQuotaError,
    available: available,
    usage: usage,
    onQuotaError: onQuotaError,
    onExternalChange: onExternalChange,
    broadcast: broadcast,
    stamp: stamp,
    stampOf: stampOf,
    PREFIXO_PERMITIDO: PREFIXO_PERMITIDO,
    QUOTA_ESTIMADA_BYTES: QUOTA_ESTIMADA_BYTES
  };

})(typeof window !== 'undefined' ? window : this);