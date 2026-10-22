/* ============================================================
   GEOREVEST STUDIO — modules.js
   Dashboard, Propostas, Clientes e Configurações.
   ============================================================ */

(function (global) {
  'use strict';

  var CRE = global.CRE;
  var D = global.CRE_DATA;
  var $ = CRE.$;
  var $$ = CRE.$$;
  var esc = CRE.esc;

  /* ── Sinal de gravação ─────────────────────
     Toda escrita passa por CRE_DATA.save(), e o localStorage pode recusar
     (quota, armazenamento bloqueado, registro que sumiu no merge entre
     abas). Prometer "salvo com sucesso" sem olhar o retorno é mentir para
     o usuário no momento em que ele mais precisa da verdade: os dados
     dele estão só na tela, não no disco. */

  function falhaDeGravacao(rec) {
    /* null = o id não existe mais no banco (exclusão em outra aba): o
       patch foi descartado por escreverRegistro()/inserirRegistro(). */
    if (rec === null) return 'A alteração não foi aplicada: o registro não está mais no banco (possível alteração em outra aba).';
    if (D.isDirty && D.isDirty()) {
      var e = (D.ultimoErro && D.ultimoErro()) || null;
      return (e && e.mensagem) || 'Falha ao gravar no armazenamento local.';
    }
    return '';
  }

  /* Exclusões e deletes devolvem { ok, erro, mensagem }. */
  function falhaDeOperacao(res) {
    if (res && res.ok === false) {
      return res.mensagem || res.error || 'A operação foi recusada.';
    }
    return falhaDeGravacao();
  }

  /* Erro de digitação: marca o campo (aria-invalid + foco) e avisa.
     Decisão binária continua em CRE.confirm. */
  function marcaErro(el, msg) {
    if (el) {
      el.setAttribute('aria-invalid', 'true');
      el.addEventListener('input', function limpa() {
        el.removeAttribute('aria-invalid');
        el.removeEventListener('input', limpa);
      });
      if (el.focus) el.focus();
    }
    CRE.toast(msg, 'error');
  }

  /* ── Validação de cadastro ───────────────────────
     Tudo offline, via CRE_FISCAL (nenhum fetch). Vazio não bloqueia: campo
     opcional. Preenchido errado bloqueia — CNPJ/CPF inválido não pode virar
     documento emitido, e e-mail/telefone quebrados não entram no cadastro. */

  function erroDePessoa(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 11) return CRE_FISCAL.isValidCpf(d) ? '' : 'CPF inválido: confira os dígitos verificadores.';
    if (d.length === 14) return CRE_FISCAL.isValidCnpj(d) ? '' : 'CNPJ inválido: confira os dígitos verificadores.';
    return 'Informe o CNPJ com 14 dígitos ou o CPF com 11.';
  }

  function erroDeEmail(v) {
    v = String(v || '').trim();
    if (!v) return '';
    return CRE_FISCAL.isValidEmail(v) ? '' : 'E-mail inválido (exemplo: nome@empresa.com.br).';
  }

  function erroDeTelefone(v) {
    v = String(v || '').trim();
    if (!v) return '';
    return CRE_FISCAL.isValidPhoneBR(v) ? '' : 'Telefone inválido: use DDD + número (10 ou 11 dígitos).';
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ══════════════ DASHBOARD ══════════════ */

  function fitStatNums() {
    $$('#statGrid .stat-num').forEach(function (el) {
      el.style.fontSize = '';
      var base = parseFloat(window.getComputedStyle(el).fontSize) || 24;
      el.style.fontSize = base + 'px';
      while (el.scrollWidth > el.clientWidth + 1 && base > 10) {
        base -= 0.5;
        el.style.fontSize = base + 'px';
      }
    });
  }

  window.addEventListener('resize', function () {
    var v = $('#view-dashboard');
    if (v && v.classList.contains('active')) fitStatNums();
  });

  var MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  var dashPeriod = 'all';
  try {
    var dpStored = localStorage.getItem('georevest-dash-period');
    if (dpStored) dashPeriod = dpStored;
  } catch (e) { /* silent */ }
  var PERIOD_LABEL = { month: 'mês', '3m': '3m', '6m': '6m', '12m': '12m' };
  var FOLLOWUP_DAYS = 7;

  function periodRange() {
    var m = { month: 1, '3m': 3, '6m': 6, '12m': 12 }[dashPeriod];
    if (!m) return { start: 0, end: Infinity, prev: null, months: 6, label: 'Tudo' };
    var now = new Date();
    function sm(d, off) { return new Date(d.getFullYear(), d.getMonth() + off, 1).getTime(); }
    var curStart = sm(now, -(m - 1));
    var curEnd = now.getTime();
    return {
      start: curStart, end: curEnd, months: m, label: PERIOD_LABEL[dashPeriod],
      prev: { start: sm(now, -(2 * m - 1)), end: sm(now, -(m - 1)) }
    };
  }

  function periodSuffix() {
    return dashPeriod === 'all' ? '' : ' · ' + PERIOD_LABEL[dashPeriod];
  }

  function inRange(ts, r) {
    var t = new Date(ts).getTime();
    if (isNaN(t)) return false;
    return t >= r.start && t < r.end;
  }

  function timeAgo(ts) {
    var t = new Date(ts).getTime();
    if (isNaN(t)) return '—';
    var sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return 'agora';
    var min = Math.round(sec / 60);
    if (min < 60) return 'há ' + min + ' min';
    var hr = Math.round(min / 60);
    if (hr < 24) return 'há ' + hr + 'h';
    var day = Math.round(hr / 24);
    if (day === 1) return 'ontem';
    if (day < 30) return 'há ' + day + ' dias';
    return CRE.fmtDate(ts);
  }

  function compactBRL(v) {
    var n = parseFloat(v) || 0;
    if (n >= 1000) return (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
    return String(Math.round(n));
  }

  function renderMonthChart(count) {
    var box = $('#dashChart');
    if (!box) return;
    count = count || 6;
    var data = D.load();
    var proposals = data.proposals || [];
    var now = new Date();
    var months = [];
    for (var i = count - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var lbl = count > 6 ? MONTH_NAMES[d.getMonth()] + '/' + String(d.getFullYear()).slice(2) : MONTH_NAMES[d.getMonth()];
      months.push({ key: d.getFullYear() + '/' + pad2(d.getMonth() + 1), label: lbl, count: 0, rev: 0 });
    }
    proposals.forEach(function (p) {
      var pd = new Date(p.createdAt);
      var k = pd.getFullYear() + '/' + pad2(pd.getMonth() + 1);
      var m = months.find(function (x) { return x.key === k; });
      if (m) {
        m.count++;
        m.rev += (CRE.proposalTotal(p.layout) || 0);
      }
    });
    var max = months.reduce(function (acc, m) { return Math.max(acc, m.rev); }, 0) || 1;
    box.innerHTML = '<div class="bar-chart">' + months.map(function (m) {
      var h = Math.max(5, Math.round(m.rev / max * 100));
      return '<div class="chart-col">' +
        '<div class="chart-val" title="' + CRE.fmtBRL(m.rev) + '">' + compactBRL(m.rev) + '</div>' +
        '<div class="chart-bar" style="height:' + h + '%" title="' + m.count + ' proposta(s) · Total: ' + CRE.fmtBRL(m.rev) + '"></div>' +
        '<div class="chart-lbl">' + m.label + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ── Avisos de integridade dos dados ────────

     CRE_DATA.avisos() devolve o que o módulo de dados registrou ao carregar
     ou gravar (campo descartado, CNPJ que não fecha dígito, derivação de
     atraso). Sem tela antes disto, o dado problemático ficava invisível.
     Os dois mounts abaixo são criados por JS: nenhum deles é HTML novo. */

  var AVISO_TIPO_LABEL = {
    'campo-descartado': 'Campo descartado',
    'ref-orfa': 'Referência removida',
    'patch-perdido': 'Alteração não aplicada',
    'atraso': 'Derivação de atraso',
    'cnpj': 'CNPJ'
  };

  function avisoData(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return ' · ' + d.toLocaleString('pt-BR');
  }

  function avisosListaHtml(lista, limite) {
    var itens = limite ? lista.slice(0, limite) : lista;
    return itens.map(function (a) {
      var tipo = AVISO_TIPO_LABEL[a.tipo] || a.tipo || 'Aviso';
      return '<p style="margin:0 0 8px">' +
        '<span class="muted" style="font-size:12px">' + esc(tipo) +
        (a.vezes > 1 ? ' · repetido ' + a.vezes + '×' : '') + esc(avisoData(a.ts)) + '</span><br>' +
        esc(a.mensagem || '') +
      '</p>';
    }).join('');
  }

  function renderAvisos() {
    var lista = D.avisos ? D.avisos() : [];

    var grid = $('.settings-grid');
    var cardCfg = $('#cfgAvisos');
    if (grid) {
      if (lista.length) {
        if (!cardCfg) {
          cardCfg = document.createElement('div');
          cardCfg.className = 'card';
          cardCfg.id = 'cfgAvisos';
          grid.insertBefore(cardCfg, grid.firstChild);
        }
        cardCfg.innerHTML =
          '<div class="card-head"><h2>Avisos de dados (' + lista.length + ')</h2></div>' +
          '<div class="card-body">' +
            '<p class="muted" style="margin-top:0">O armazenamento registrou estas inconsistências ao carregar ou gravar. Nada aqui apaga dado: a correção entra quando você editar o registro apontado.</p>' +
            avisosListaHtml(lista, 0) +
          '</div>';
      } else if (cardCfg && cardCfg.parentNode) {
        cardCfg.parentNode.removeChild(cardCfg);
      }
    }

    var statGrid = $('#statGrid');
    var cardDash = $('#dashAvisos');
    if (statGrid) {
      if (lista.length) {
        if (!cardDash) {
          cardDash = document.createElement('div');
          cardDash.className = 'card';
          cardDash.id = 'dashAvisos';
          statGrid.parentNode.insertBefore(cardDash, statGrid);
        }
        cardDash.innerHTML =
          '<div class="card-head"><h2>Avisos de dados (' + lista.length + ')</h2></div>' +
          '<div class="card-body">' +
            avisosListaHtml(lista, 3) +
            (lista.length > 3 ? '<p class="muted">… e mais ' + (lista.length - 3) + ' aviso(s). A lista completa está em Configurações.</p>' : '') +
            '<div class="btn-row">' +
              '<button type="button" class="btn btn-secondary btn-sm" id="dashAvisosGo">Ver em Configurações</button>' +
            '</div>' +
          '</div>';
        var go = $('#dashAvisosGo');
        if (go) go.addEventListener('click', function () { CRE.switchTab('settings'); });
      } else if (cardDash && cardDash.parentNode) {
        cardDash.parentNode.removeChild(cardDash);
      }
    }
  }

  function renderDashboard() {
    var db = D.load();
    var proposals = db.proposals || [];
    var clients = db.clients || [];

    $$('#dashPeriodTabs [data-dash-period]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.dashPeriod === dashPeriod);
    });

    var pr = periodRange();
    var now = new Date();
    function win(s, e) {
      var w = { count: 0, draft: 0, sent: 0, approved: 0, rejected: 0, rev: 0, approvedRev: 0 };
      proposals.forEach(function (p) {
        var t = new Date(p.createdAt).getTime();
        if (isNaN(t) || t < s || t > e) return;
        w.count++;
        var total = CRE.proposalTotal(p.layout) || 0;
        w.rev += total;
        if (p.status === 'approved') { w.approved++; w.approvedRev += total; }
        else if (p.status === 'sent') w.sent++;
        else if (p.status === 'rejected') w.rejected++;
        else w.draft++;
      });
      return w;
    }
    var cur = win(pr.start, pr.end);
    var prev = pr.prev ? win(pr.prev.start, pr.prev.end) : null;

    var clientCount = clients.filter(function (c) { return inRange(c.createdAt, pr); }).length;

    var total = cur.count;
    var approvedRate = total > 0 ? Math.round(cur.approved / total * 100) : 0;
    var prevRate = (prev && prev.count) ? Math.round(prev.approved / prev.count * 100) : null;

    /* Financeiro */
    var cfg = D.getConfig();
    var goal = parseFloat(cfg.monthlyGoal) || 0;
    var curKey = now.getFullYear() + '/' + pad2(now.getMonth() + 1);
    var monthRev = proposals.reduce(function (acc, p) {
      var d = new Date(p.createdAt);
      return acc + ((d.getFullYear() + '/' + pad2(d.getMonth() + 1)) === curKey ? (CRE.proposalTotal(p.layout) || 0) : 0);
    }, 0);
    var dayOfMonth = now.getDate();
    var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    var projected = dayOfMonth > 0 ? (monthRev / dayOfMonth) * daysInMonth : monthRev;
    var projPct = goal > 0 ? Math.round(projected / goal * 100) : 0;
    var goalPct = goal > 0 ? Math.round(monthRev / goal * 100) : 0;

    /* Faturamento (documentos emitidos). nofin fica de fora: contar nota
       que não gera recebimento junto com o que é "a receber" mente o
       comparativo com a Receita Aprovada logo ao lado. */
    var faturado = (db.invoices || []).reduce(function (acc, nf) {
      if (nf.status !== 'issued') return acc;
      if (pag(nf) === 'nofin') return acc;
      if (!inRange(nf.issuedAt || nf.createdAt, pr)) return acc;
      return acc + (parseFloat(nf.total) || 0);
    }, 0);
    faturado = Math.round(faturado * 100) / 100;
    var gap = Math.round((cur.approvedRev - faturado) * 100) / 100;

    function deltaPct(curV, prevV) {
      if (prevV == null || prevV <= 0) return null;
      var p = Math.round(((curV - prevV) / prevV) * 1000) / 10;
      if (p === 0) return '0%';
      return (p > 0 ? '+' : '−') + Math.abs(p) + '%';
    }
    function dlLine(curV, prevV) {
      if (!pr.prev) return '';
      var s = deltaPct(curV, prevV);
      if (s === null) return '<div class="stat-delta delta-same">— sem dados no período anterior</div>';
      return '<div class="stat-delta ' + (s.charAt(0) === '+' ? 'delta-up' : (s.charAt(0) === '−' ? 'delta-down' : 'delta-same')) + '">' + s + ' vs período anterior</div>';
    }
    function convLine() {
      if (!pr.prev) return '';
      if (!prev || !prev.count) return '<div class="stat-delta delta-same">— sem dados no período anterior</div>';
      var pp = Math.round((approvedRate - prevRate) * 10) / 10;
      var s = (pp >= 0 ? '+' : '−') + Math.abs(pp) + ' pp';
      return '<div class="stat-delta ' + (pp >= 0 ? 'delta-up' : 'delta-down') + '">' + s + ' vs período anterior</div>';
    }
    var psfx = periodSuffix();
    var fatCls = gap > 0 ? 'delta-down' : 'delta-same';
    var fatTxt = cur.approvedRev > 0
      ? 'Faturado ' + Math.round(faturado / cur.approvedRev * 100) + '% do aprovado' + (gap > 0 ? ' · a faturar ' + CRE.fmtBRL(gap) : '')
      : 'Sem aprovados no período';
    var projCls = goal && projPct >= 100 ? 'delta-up' : (goal && projPct < 70 ? 'delta-down' : 'delta-same');

    var statHtml =
      '<div class="stat-card"><div class="stat-ic">📄</div><div><div class="stat-num">' + cur.count + '</div><div class="stat-lbl">Propostas' + psfx + '</div></div></div>' +
      '<div class="stat-card"><div class="stat-ic">🏢</div><div><div class="stat-num">' + clientCount + '</div><div class="stat-lbl">Clientes Atendidos' + psfx + '</div></div></div>' +
      '<div class="stat-card"><div class="stat-ic">📤</div><div><div class="stat-num">' + cur.sent + '</div><div class="stat-lbl">Enviadas p/ Cliente' + psfx + '</div></div></div>' +
      '<div class="stat-card"><div class="stat-ic">✅</div><div><div class="stat-num">' + cur.approved + '</div><div class="stat-lbl">Aprovadas / Fechadas' + psfx + '</div></div></div>' +
      '<div class="stat-card"><div class="stat-ic">📊</div><div><div class="stat-num">' + approvedRate + '%</div><div class="stat-lbl">Taxa de Conversão' + psfx + '</div>' + convLine() + '</div></div>' +
      '<div class="stat-card"><div class="stat-ic">💰</div><div><div class="stat-num">' + CRE.fmtBRL(cur.rev) + '</div><div class="stat-lbl">Pipeline' + psfx + '</div>' + dlLine(cur.rev, prev ? prev.rev : null) + '</div></div>' +
      '<div class="stat-card"><div class="stat-ic">🏆</div><div><div class="stat-num">' + CRE.fmtBRL(cur.approvedRev) + '</div><div class="stat-lbl">Receita Aprovada' + psfx + '</div>' + dlLine(cur.approvedRev, prev ? prev.approvedRev : null) + '</div></div>' +
      '<div class="stat-card"><div class="stat-ic">🧾</div><div><div class="stat-num">' + CRE.fmtBRL(faturado) + '</div><div class="stat-lbl">Faturado (NF)' + psfx + '</div><div class="stat-delta ' + fatCls + '">' + fatTxt + '</div></div></div>' +
      '<div class="stat-card"><div class="stat-ic">🎯</div><div><div class="stat-num">' + CRE.fmtBRL(monthRev) + '</div><div class="stat-lbl">Receita Mês' + (goal ? ' · Meta ' + compactBRL(goal) : '') + '</div>' +
        (goal ? '<div class="goalbar" title="Progresso da meta: ' + goalPct + '%"><div class="goalbar-fill" style="width:' + Math.min(100, goalPct) + '%"></div></div>' : '') +
        '<div class="stat-delta ' + projCls + '">⏳ Projeção: ' + CRE.fmtBRL(projected) + (goal ? ' · ' + projPct + '% da meta' : '') + '</div>' +
      '</div></div>';
    $('#statGrid').innerHTML = statHtml;
    fitStatNums();
    renderAvisos();

    renderMonthChart(pr.months);

    /* Recents */
    var sorted = proposals.slice().sort(function (a, b) {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    }).slice(0, 5);
    $('#dashRecent').innerHTML = sorted.length
      ? sorted.map(function (p) {
          var c = D.findClient(p.clientId);
          var total = CRE.proposalTotal(p.layout);
          return '<div class="list-row">' +
            '<div class="lr-main"><div class="lr-title">' + esc(p.name || 'Sem nome') + '</div>' +
            '<div class="lr-sub">' + esc(c ? (c.company || c.name) : 'Sem cliente') + ' · <span class="val-badge">' + CRE.fmtBRL(total) + '</span></div></div>' +
            CRE.statusPill(p.status) +
            '<button class="mini-btn primary wide" data-open-prop="' + p.id + '" title="Abrir no Editor">Abrir</button>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhuma proposta ainda.</p>';

    $$('#dashRecent [data-open-prop]').forEach(function (btn) {
      btn.addEventListener('click', function () { openProposal(btn.dataset.openProp); });
    });

    /* Pipeline (interactive!) */
    var pipe = total
      ? '<div class="pipeline-bar">' +
          (cur.draft    ? '<span class="pipe-draft"    style="width:' + Math.round(cur.draft / total * 100) + '%" title="Rascunho: ' + cur.draft + '"></span>' : '') +
          (cur.sent     ? '<span class="pipe-sent"     style="width:' + Math.round(cur.sent / total * 100) + '%" title="Enviadas: ' + cur.sent + '"></span>' : '') +
          (cur.approved ? '<span class="pipe-approved" style="width:' + Math.round(cur.approved / total * 100) + '%" title="Aprovadas: ' + cur.approved + '"></span>' : '') +
          (cur.rejected ? '<span class="pipe-rejected" style="width:' + Math.round(cur.rejected / total * 100) + '%" title="Recusadas: ' + cur.rejected + '"></span>' : '') +
        '</div>' +
        '<div class="pipe-legend">' +
          '<span style="cursor:pointer" data-filter-pipe="draft"><i class="pipe-draft"></i>Rascunho (' + cur.draft + ')</span>' +
          '<span style="cursor:pointer" data-filter-pipe="sent"><i class="pipe-sent"></i>Enviadas (' + cur.sent + ')</span>' +
          '<span style="cursor:pointer" data-filter-pipe="approved"><i class="pipe-approved"></i>Aprovadas (' + cur.approved + ')</span>' +
          '<span style="cursor:pointer" data-filter-pipe="rejected"><i class="pipe-rejected"></i>Recusadas (' + cur.rejected + ')</span>' +
        '</div>'
      : '<p class="muted">Sem propostas para exibir no período.</p>';
    $('#dashPipeline').innerHTML = pipe;

    $$('[data-filter-pipe]').forEach(function (el) {
      el.addEventListener('click', function () {
        var sel = $('#propStatusFilter');
        if (sel) sel.value = el.dataset.filterPipe;
        CRE.switchTab('proposals');
      });
    });

    /* Last clients with colorful initials */
    var recentClients = clients.slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); }).slice(0, 5);
    $('#dashClients').innerHTML = recentClients.length
      ? recentClients.map(function (c) {
          var bg = CRE.avatarGradient(c.name);
          return '<div class="list-row">' +
            '<div class="client-av" style="background:' + bg + '">' + esc(CRE.initials(c.name)) + '</div>' +
            '<div class="lr-main"><div class="lr-title">' + esc(c.name) + '</div>' +
            '<div class="lr-sub">' + esc(c.company || '—') + (c.phone ? ' · ' + esc(c.phone) : '') + '</div></div>' +
            '<button class="mini-btn wide" data-open-client="' + c.id + '">Ver</button>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhum cliente cadastrado.</p>';

    $$('#dashClients [data-open-client]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedClientId = btn.dataset.openClient;
        CRE.switchTab('clients');
        renderClients();
      });
    });

    renderFollowUps();
    renderActivity();
  }

  function renderFollowUps() {
    var box = $('#dashFollowup');
    if (!box) return;
    var proposals = D.load().proposals || [];
    var nowTs = Date.now();
    var th = FOLLOWUP_DAYS * 86400000;
    var list = proposals.filter(function (p) {
      if (p.status !== 'sent') return false;
      var t = new Date(p.updatedAt).getTime();
      return !isNaN(t) && (nowTs - t) > th;
    }).sort(function (a, b) { return new Date(a.updatedAt) - new Date(b.updatedAt); }).slice(0, 6);
    box.innerHTML = list.length ? list.map(function (p) {
      var c = D.findClient(p.clientId);
      var total = CRE.proposalTotal(p.layout);
      var days = Math.max(1, Math.round((nowTs - new Date(p.updatedAt).getTime()) / 86400000));
      return '<div class="list-row">' +
        '<div class="lr-main"><div class="lr-title">' + esc(p.name || 'Sem nome') + '</div>' +
        '<div class="lr-sub">' + esc(c ? (c.company || c.name) : 'Sem cliente') + ' · <span class="' + (days > 14 ? 'delta-down' : '') + '">há ' + days + ' dias sem resposta</span></div></div>' +
        '<button class="mini-btn" data-fu-wa="' + p.id + '" title="Cobrança via WhatsApp">💬</button>' +
        '<button class="mini-btn primary wide" data-fu-open="' + p.id + '" title="Abrir no Editor">Abrir</button>' +
      '</div>';
    }).join('') : '<p class="muted">Nenhuma proposta enviada aguardando retorno. ✅</p>';

    $$('#dashFollowup [data-fu-wa]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = D.getProposal(btn.dataset.fuWa);
        if (!p) return;
        var c = D.findClient(p.clientId);
        var total = CRE.proposalTotal(p.layout);
        var phone = c && c.phone ? String(c.phone).replace(/\D/g, '') : '';
        if (phone && phone.indexOf('55') !== 0) phone = '55' + phone;
        var text = 'Olá ' + (c ? c.name : '') + '! Ainda estamos aguardando seu retorno sobre a proposta "' + (p.name || '') + '" no valor de ' + CRE.fmtBRL(total) + '. Ficamos à disposição!';
        if (phone) {
          window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank');
        } else {
          CRE.copy(text, 'Cobrança copiada para a área de transferência!');
        }
      });
    });
    $$('#dashFollowup [data-fu-open]').forEach(function (btn) {
      btn.addEventListener('click', function () { openProposal(btn.dataset.fuOpen); });
    });
  }

  function renderActivity() {
    var box = $('#dashActivity');
    if (!box) return;
    var db = D.load();
    var events = [];
    (db.proposals || []).forEach(function (p) {
      events.push({ ts: p.createdAt, icon: '📄', title: 'Proposta criada', sub: (p.name || 'Sem nome'), kind: 'proposal', id: p.id });
      (p.revisions || []).forEach(function (rv) {
        events.push({ ts: rv.date, icon: '🔁', title: 'Revisão ' + (rv.rev || 1) + ' criada', sub: (p.name || 'Sem nome') + (rv.note ? ' · ' + rv.note : ''), kind: 'proposal', id: p.id });
      });
    });
    (db.invoices || []).forEach(function (nf) {
      var t = nf.total != null ? (parseFloat(nf.total) || 0) : 0;
      events.push({
        ts: nf.status === 'issued' ? (nf.issuedAt || nf.createdAt) : nf.createdAt,
        icon: '🧾', title: (nf.status === 'issued' ? 'NF ' + (nf.number || '') + ' emitida' : (nf.status === 'cancelled' ? 'NF ' + (nf.number || '') + ' cancelada' : 'NF ' + (nf.number || '') + ' registrada')),
        sub: CRE.fmtBRL(t) + (nf.proposalId ? ' · ' + ((D.getProposal(nf.proposalId) || {}).name || '') : ''),
        kind: 'invoice', id: nf.id, pid: nf.proposalId
      });
    });
    events = events.filter(function (e) { return !isNaN(new Date(e.ts).getTime()); });
    events.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
    events = events.slice(0, 12);
    box.innerHTML = events.length ? events.map(function (e) {
      var attr = e.kind === 'invoice' ? 'data-act-inv="' + e.id + '"' : 'data-act-prop="' + e.id + '"';
      return '<div class="feed-row" ' + attr + '>' +
        '<div class="feed-ic">' + e.icon + '</div>' +
        '<div class="feed-main"><div class="feed-title">' + esc(e.title) + '</div><div class="feed-sub">' + esc(e.sub || '') + '</div></div>' +
        '<div class="feed-time" title="' + CRE.fmtDateTime(e.ts) + '">' + timeAgo(e.ts) + '</div>' +
      '</div>';
    }).join('') : '<p class="muted">Nenhuma atividade registrada ainda.</p>';

    $$('#dashActivity [data-act-prop]').forEach(function (el) {
      el.addEventListener('click', function () { openProposal(el.dataset.actProp); });
    });
    $$('#dashActivity [data-act-inv]').forEach(function (el) {
      el.addEventListener('click', function () {
        var nf = D.getInvoice(el.dataset.actInv);
        if (!nf) return;
        if (nf.proposalId && D.getProposal(nf.proposalId)) openInvoiceList(nf.proposalId);
        else CRE.switchTab('invoices');
      });
    });
  }

  /* ══════════════ PROPOSTAS ══════════════ */

  function openProposal(id) {
    if (global.CRE_EDITOR && global.CRE_EDITOR.isDirty && global.CRE_EDITOR.isDirty()) {
      CRE.confirm('Alterações não salvas',
        'Você tem alterações não salvas no editor. Descartar e abrir esta proposta?',
        function () { abrirProposta(id); }, 'Descartar e abrir');
      return;
    }
    abrirProposta(id);
  }

  function abrirProposta(id) {
    D.setActiveProposal(id);
    if (global.CRE_EDITOR) global.CRE_EDITOR.loadProposal(D.getProposal(id), { silent: true, scroll: true });
    CRE.switchTab('editor');
  }

  function renderPropFilterChips(allProps, activeStatus) {
    var container = $('#propFilterChips');
    if (!container) return;
    var counts = { all: allProps.length, draft: 0, sent: 0, approved: 0, rejected: 0 };
    allProps.forEach(function (p) { if (counts[p.status] !== undefined) counts[p.status]++; });
    var items = [
      { key: '', label: 'Todas as Propostas', count: counts.all },
      { key: 'draft', label: 'Rascunhos', count: counts.draft },
      { key: 'sent', label: 'Enviadas', count: counts.sent },
      { key: 'approved', label: 'Aprovadas', count: counts.approved },
      { key: 'rejected', label: 'Recusadas', count: counts.rejected }
    ];
    container.innerHTML = items.map(function (it) {
      var act = it.key === (activeStatus || '') ? ' active' : '';
      return '<button type="button" class="chip' + act + '" data-chip-prop-st="' + it.key + '">' +
        '<span>' + esc(it.label) + '</span>' +
        '<span class="chip-badge">' + it.count + '</span>' +
      '</button>';
    }).join('');
    $$('[data-chip-prop-st]', container).forEach(function (chip) {
      chip.addEventListener('click', function () {
        var sel = $('#propStatusFilter');
        if (sel) sel.value = chip.dataset.chipPropSt;
        renderProposals();
      });
    });
  }

  function renderProposals() {
    var q = $('#propSearch').value || '';
    var st = $('#propStatusFilter').value || '';
    var allProps = D.load().proposals || [];
    var list = D.searchProposals(q, st);

    renderPropFilterChips(allProps, st);

    var tbody = $('#propTable tbody');
    tbody.innerHTML = list.map(function (p) {
      var c = D.findClient(p.clientId);
      var total = CRE.proposalTotal(p.layout);
      var clientStr = c
        ? '<div class="strong">' + esc(c.company || c.name) + '</div>' + (c.company ? '<div class="muted">' + esc(c.name) + '</div>' : '')
        : '<span class="muted">—</span>';

      var partnersList = Array.isArray(p.partners) ? p.partners : [];
      var partnersStr = '';
      if (partnersList.length) {
        partnersStr = '<div class="prop-partner-badges">' +
          partnersList.map(function (pt) {
            var part = D.findPartner(pt.partnerId);
            var rInfo = D.PARTNER_ROLES && D.PARTNER_ROLES[pt.role] ? D.PARTNER_ROLES[pt.role] : { label: pt.role, icon: '🤝' };
            var partName = part ? part.name : 'Parceiro';
            var commText = pt.commissionValue ? (pt.commissionType === 'percent' ? pt.commissionValue + '%' : CRE.fmtBRL(pt.commissionValue)) : '';
            return '<span class="prop-partner-chip" title="' + esc(rInfo.label) + (commText ? ' · ' + commText : '') + '">' +
              rInfo.icon + ' ' + esc(partName) +
            '</span>';
          }).join('') +
        '</div>';
      } else {
        partnersStr = '<span class="muted">—</span>';
      }

      return '<tr>' +
        '<td class="strong"><span class="prop-name-cell">' +
        '<span class="prop-name">' + esc(p.name || 'Sem nome') + '</span>' +
        '<button type="button" class="mini-btn rev-drop-btn" data-rev-drop="' + p.id + '" title="Ver e visualizar revisões do orçamento">Rev ' + (p.revision || 1) + ' ▾</button>' +
      '</span></td>' +
        '<td>' + clientStr + '</td>' +
        '<td>' + partnersStr + '</td>' +
        '<td><span class="val-badge">' + CRE.fmtBRL(total) + '</span></td>' +
        '<td><select class="input input-sm status-select" data-prop="' + p.id + '">' +
          ['draft', 'sent', 'approved', 'rejected'].map(function (s) {
            return '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + CRE.statusLabel(s) + '</option>';
          }).join('') +
        '</select></td>' +
        '<td class="muted">' + CRE.fmtDate(p.createdAt) + '</td>' +
        '<td class="muted">' + CRE.fmtDate(p.updatedAt) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="mini-btn primary wide" data-edit-prop="' + p.id + '" title="Abrir no editor visual">Abrir</button>' +
          '<button class="mini-btn" data-edit-prop-meta="' + p.id + '" title="Editar dados e parceiros da proposta">✏️</button>' +
          '<button class="mini-btn" data-share-prop="' + p.id + '" title="Compartilhar pelo WhatsApp">💬</button>' +
          '<button class="mini-btn" data-nf-prop="' + p.id + '" title="Documentos">🧾</button>' +
          '<button class="mini-btn" data-dup-prop="' + p.id + '" title="Duplicar">📋</button>' +
          '<button class="mini-btn danger" data-del-prop="' + p.id + '" title="Excluir">✕</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    $('#propEmpty').classList.toggle('show', !list.length);

    $$('.status-select', tbody).forEach(function (sel) {
      sel.addEventListener('change', function () {
        var upd = D.updateProposal(sel.dataset.prop, { status: sel.value });
        var falha = falhaDeGravacao(upd);
        renderProposals();
        if (falha) {
          CRE.toast('Status NÃO foi salvo: ' + falha, 'error');
        } else {
          CRE.toast('Status da proposta alterado para ' + CRE.statusLabel(sel.value) + '.', 'success');
        }
        if (global.CRE_EDITOR && CRE.currentTab === 'editor') global.CRE_EDITOR.refreshEditor();
        if (!CRE.currentTab || CRE.currentTab === 'dashboard') renderDashboard();
      });
    });
    $$('[data-edit-prop]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function () { openProposal(btn.dataset.editProp); });
    });
    $$('[data-edit-prop-meta]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function () { openProposalModal(btn.dataset.editPropMeta); });
    });
    $$('[data-share-prop]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = D.getProposal(btn.dataset.shareProp);
        if (!p) return;
        var c = D.findClient(p.clientId);
        var total = CRE.proposalTotal(p.layout);
        var phone = c && c.phone ? String(c.phone).replace(/\D/g, '') : '';
        if (phone && phone.indexOf('55') !== 0) phone = '55' + phone;
        var text = 'Olá ' + (c ? c.name : '') + '! Segue o resumo da proposta comercial "' + (p.name || '') + '" no valor de ' + CRE.fmtBRL(total) + '. Estamos à disposição!';
        if (phone) {
          window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank');
        } else {
          CRE.copy(text, 'Resumo da proposta copiado para a área de transferência!');
        }
      });
    });
    $$('[data-nf-prop]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function () { openInvoiceList(btn.dataset.nfProp); });
    });
    $$('[data-dup-prop]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function () { duplicateProposal(btn.dataset.dupProp); });
    });
    $$('[data-del-prop]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (D.proposalHasIssuedInvoice(btn.dataset.delProp)) {
          CRE.toast('Esta proposta possui documento(s) emitido(s) e não pode ser excluída.', 'error');
          return;
        }
        CRE.confirm('Excluir proposta', 'Tem certeza que deseja excluir esta proposta?', function () {
          var res = D.deleteProposal(btn.dataset.delProp);
          var falha = falhaDeOperacao(res);
          if (falha) {
            CRE.toast('Proposta NÃO excluída: ' + falha, 'error');
          } else {
            CRE.toast('Proposta excluída.', 'info');
          }
          renderProposals();
          if (global.CRE_EDITOR) global.CRE_EDITOR.refreshProposalSelect();
        }, 'Excluir');
      });
    });
    $$('[data-rev-drop]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleRevPopover(btn);
      });
    });
  }

  /* ── Dropdown de revisões (aba Propostas) ── */

  function toggleRevPopover(btn) {
    var id = btn.dataset.revDrop;
    var existing = document.getElementById('rev-pop-' + id);
    if (existing) { existing.remove(); return; }
    $$('.rev-pop').forEach(function (el) { el.remove(); });
    var list = (global.CRE_EDITOR && global.CRE_EDITOR.listRevisions) ? global.CRE_EDITOR.listRevisions(id) : [];
    var pop = document.createElement('div');
    pop.className = 'rev-pop';
    pop.id = 'rev-pop-' + id;
    var items = list.map(function (r) {
      return '<div class="rev-pop-item' + (r.current ? ' current' : '') + '" data-snap-view="' + id + ':' + r.rev + '" title="Visualizar esta revisão" tabindex="0">' +
        '<span class="rev-badge">Rev ' + r.rev + '</span>' +
        '<span class="rev-pop-date">' + esc(CRE.fmtDateTime(r.date)) + '</span>' +
        '<span class="rev-pop-total">' + CRE.fmtBRL(r.total) + '</span>' +
        CRE.statusPill(r.status) +
      '</div>';
    }).join('');
    pop.innerHTML =
      '<div class="rev-pop-title">Revisões do orçamento</div>' +
      (items || '<p class="rev-pop-empty">Nenhuma revisão salva.</p>') +
      '<div class="rev-pop-actions">' +
        '<button type="button" class="btn btn-sm btn-secondary" data-pop-cmp="' + id + '">Comparar…</button>' +
        '<button type="button" class="btn btn-sm btn-secondary" data-pop-exp="' + id + '">Exportar (JSON)</button>' +
      '</div>';
    var cell = btn.closest('.prop-name-cell');
    if (!cell) return;
    cell.appendChild(pop);
    $$('[data-snap-view]', pop).forEach(function (el) {
      var open = function () {
        var parts = String(el.dataset.snapView).split(':');
        pop.remove();
        if (global.CRE_EDITOR && global.CRE_EDITOR.viewRevision) global.CRE_EDITOR.viewRevision(parts[0], parseInt(parts[1], 10) || 0);
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
    });
    var btnCmp = $('[data-pop-cmp]', pop);
    if (btnCmp) btnCmp.addEventListener('click', function () {
      pop.remove();
      if (global.CRE_EDITOR && global.CRE_EDITOR.openCompareModal) global.CRE_EDITOR.openCompareModal(id);
    });
    var btnExp = $('[data-pop-exp]', pop);
    if (btnExp) btnExp.addEventListener('click', function () {
      if (global.CRE_EDITOR && global.CRE_EDITOR.exportHistory) global.CRE_EDITOR.exportHistory(id);
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.rev-pop') && !e.target.closest('.rev-drop-btn')) {
      $$('.rev-pop').forEach(function (el) { el.remove(); });
    }
  });

  function duplicateProposal(id) {
    var p = D.getProposal(id);
    if (!p) return;
    var copy = D.addProposal({
      name: (p.name || 'Proposta') + ' (cópia)',
      clientId: p.clientId,
      status: 'draft',
      partners: Array.isArray(p.partners) ? JSON.parse(JSON.stringify(p.partners)) : [],
      layout: JSON.parse(JSON.stringify(p.layout || D.defaultLayout()))
    });
    var falha = falhaDeGravacao(copy);
    if (falha) {
      CRE.toast('Duplicação NÃO foi salva: ' + falha, 'error');
      renderProposals();
      if (global.CRE_EDITOR) global.CRE_EDITOR.refreshProposalSelect();
      return null;
    }
    CRE.toast('Proposta duplicada com sucesso!', 'success');
    renderProposals();
    if (global.CRE_EDITOR) global.CRE_EDITOR.refreshProposalSelect();
    return copy;
  }

  var tempProposalPartners = [];

  function openProposalModal(propId) {
    var isEdit = !!propId;
    var prop = isEdit ? D.getProposal(propId) : null;
    if (isEdit && !prop) return;

    var curName = prop ? (prop.name || '') : '';
    var curClientId = prop ? (prop.clientId || '') : '';
    var curStatus = prop ? (prop.status || 'draft') : 'draft';
    var curTemplate = '';

    tempProposalPartners = isEdit && Array.isArray(prop.partners)
      ? JSON.parse(JSON.stringify(prop.partners))
      : [];

    function render() {
      var db = D.load();

      var clientOpts = db.clients.length
        ? db.clients.map(function (c) {
            var sel = curClientId === c.id ? ' selected' : '';
            return '<option value="' + c.id + '"' + sel + '>' + esc((c.company || c.name)) + '</option>';
          }).join('')
        : '<option value="">— Nenhum cliente cadastrado —</option>';
      clientOpts += '<option value="__new__">＋ Cadastrar novo cliente…</option>';

      var statusOpts = ['draft', 'sent', 'approved', 'rejected'].map(function (s) {
        return '<option value="' + s + '"' + (curStatus === s ? ' selected' : '') + '>' + CRE.statusLabel(s) + '</option>';
      }).join('');

      var tmplSection = '';
      if (!isEdit) {
        var tmplOpts = '<option value="">Layout padrão</option>' +
          db.templates.map(function (t) {
            var sel2 = curTemplate === t.id ? ' selected' : '';
            return '<option value="' + t.id + '"' + sel2 + '>' + esc(t.name) + '</option>';
          }).join('');
        tmplSection = '<label><span>Layout inicial</span><select id="npTemplate" class="input">' + tmplOpts + '</select></label>';
      }

      var html = '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<label><span>Nome da proposta</span><input type="text" id="npName" class="input" value="' + esc(curName) + '" placeholder="Ex: Proposta Manta ATO 800"></label>' +
        '<div class="client-detail-grid">' +
          '<label><span>Cliente</span><select id="npClient" class="input">' + clientOpts + '</select></label>' +
          '<label><span>Status</span><select id="npStatus" class="input">' + statusOpts + '</select></label>' +
        '</div>' +
        tmplSection +
        '<hr style="margin:4px 0">' +
        '<div class="proposal-partners-section">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
            '<div>' +
              '<span style="font-weight:600;font-size:0.95rem">Parceiros Envolvidos</span> ' +
              '<span class="muted" style="font-size:0.8rem">(Comissão/RT, Execução Técnica, Co-branding)</span>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-secondary" id="btnAddPropPartner">+ Adicionar Parceiro</button>' +
          '</div>' +
          '<div id="propPartnersList" class="partner-bind-container"></div>' +
        '</div>' +
        '<div class="btn-row" style="justify-content:flex-end;margin-top:8px">' +
          '<button type="button" class="btn btn-secondary" id="npCancel">Cancelar</button>' +
          '<button type="button" class="btn btn-primary" id="npSave">' + (isEdit ? 'Salvar alterações' : 'Criar proposta') + '</button>' +
        '</div>' +
      '</div>';

      CRE.openModal(isEdit ? 'Editar proposta e parceiros' : 'Nova proposta', html);

      function renderPartnerRows() {
        var listEl = $('#propPartnersList');
        if (!listEl) return;
        if (!tempProposalPartners.length) {
          listEl.innerHTML = '<p class="muted" style="font-size:0.85rem;margin:6px 0">Nenhum parceiro vinculado a esta proposta. Clique em "+ Adicionar Parceiro" para vincular.</p>';
          return;
        }

        var rolesKeys = Object.keys(D.PARTNER_ROLES);

        listEl.innerHTML = tempProposalPartners.map(function (item, idx) {
          var pOpts = db.partners.map(function (pt) {
            return '<option value="' + pt.id + '"' + (item.partnerId === pt.id ? ' selected' : '') + '>' + esc(pt.name) + '</option>';
          }).join('');

          var rOpts = rolesKeys.map(function (rk) {
            var rInfo = D.PARTNER_ROLES[rk];
            return '<option value="' + rk + '"' + (item.role === rk ? ' selected' : '') + '>' + rInfo.icon + ' ' + esc(rInfo.label) + '</option>';
          }).join('');

          return '<div class="partner-bind-row" data-pbr-idx="' + idx + '">' +
            '<div class="pbr-top">' +
              '<select class="input input-sm pbr-partner" data-idx="' + idx + '" title="Parceiro">' + pOpts + '</select>' +
              '<select class="input input-sm pbr-role" data-idx="' + idx + '" title="Papel do parceiro">' + rOpts + '</select>' +
              '<button type="button" class="mini-btn danger pbr-remove" data-idx="' + idx + '" title="Remover este parceiro">✕</button>' +
            '</div>' +
            '<div class="pbr-bottom">' +
              '<div class="pbr-commission">' +
                '<span>Comissão / RT:</span>' +
                '<select class="input input-sm pbr-comm-type" data-idx="' + idx + '" style="width:65px">' +
                  '<option value="percent"' + (item.commissionType === 'percent' ? ' selected' : '') + '>%</option>' +
                  '<option value="fixed"' + (item.commissionType === 'fixed' ? ' selected' : '') + '>R$</option>' +
                '</select>' +
                '<input type="number" step="0.1" min="0" class="input input-sm pbr-comm-val" data-idx="' + idx + '" value="' + (item.commissionValue || 0) + '" style="width:75px">' +
              '</div>' +
              '<label class="pbr-show">' +
                '<input type="checkbox" class="pbr-show-cb" data-idx="' + idx + '"' + (item.showOnProposal ? ' checked' : '') + '> ' +
                '<span>Exibir no PDF/Capa</span>' +
              '</label>' +
            '</div>' +
          '</div>';
        }).join('');

        $$('#propPartnersList .pbr-partner').forEach(function (el) {
          el.addEventListener('change', function () {
            var i = parseInt(el.dataset.idx, 10);
            if (tempProposalPartners[i]) tempProposalPartners[i].partnerId = el.value;
          });
        });
        $$('#propPartnersList .pbr-role').forEach(function (el) {
          el.addEventListener('change', function () {
            var i = parseInt(el.dataset.idx, 10);
            if (tempProposalPartners[i]) tempProposalPartners[i].role = el.value;
          });
        });
        $$('#propPartnersList .pbr-comm-type').forEach(function (el) {
          el.addEventListener('change', function () {
            var i = parseInt(el.dataset.idx, 10);
            if (tempProposalPartners[i]) tempProposalPartners[i].commissionType = el.value;
          });
        });
        $$('#propPartnersList .pbr-comm-val').forEach(function (el) {
          el.addEventListener('input', function () {
            var i = parseInt(el.dataset.idx, 10);
            if (tempProposalPartners[i]) tempProposalPartners[i].commissionValue = parseFloat(el.value) || 0;
          });
        });
        $$('#propPartnersList .pbr-show-cb').forEach(function (el) {
          el.addEventListener('change', function () {
            var i = parseInt(el.dataset.idx, 10);
            if (tempProposalPartners[i]) tempProposalPartners[i].showOnProposal = el.checked;
          });
        });
        $$('#propPartnersList .pbr-remove').forEach(function (el) {
          el.addEventListener('click', function () {
            var i = parseInt(el.dataset.idx, 10);
            tempProposalPartners.splice(i, 1);
            renderPartnerRows();
          });
        });
      }

      renderPartnerRows();

      $('#btnAddPropPartner').addEventListener('click', function () {
        if (!db.partners.length) {
          CRE.toast('Nenhum parceiro cadastrado. Cadastre primeiro na aba Parceiros.', 'error');
          return;
        }
        tempProposalPartners.push({
          partnerId: db.partners[0].id,
          role: 'commercial',
          commissionType: 'percent',
          commissionValue: 5,
          showOnProposal: false,
          notes: ''
        });
        renderPartnerRows();
      });

      $('#npCancel').addEventListener('click', CRE.closeModal);

      $('#npClient').addEventListener('change', function () {
        if (this.value === '__new__') {
          this.value = curClientId;
          curName = ($('#npName').value || '').trim();
          curStatus = $('#npStatus') ? $('#npStatus').value : curStatus;
          if ($('#npTemplate')) curTemplate = $('#npTemplate').value;
          openClientForm(null, function (saved) {
            curClientId = saved.id;
            render();
          }, render);
        } else {
          curClientId = this.value;
        }
      });

      $('#npSave').addEventListener('click', function () {
        var name = ($('#npName').value || '').trim() || (isEdit ? prop.name : ('Proposta ' + (db.proposals.length + 1)));
        var clientId = $('#npClient').value || '';
        var status = $('#npStatus').value || 'draft';

        var fields = [
          { key: 'npName', label: 'Nome da proposta', value: name, type: 'string', required: true },
          { key: 'npClient', label: 'Cliente', value: clientId, type: 'string', required: true }
        ];
        var errs = CRE_VALIDATORS.validate(fields);
        var errCount = 0;
        for (var ek in errs) { if (errs.hasOwnProperty(ek)) errCount++; }
        if (errCount > 0) {
          var root = $('.modal-content') || $('.modal');
          if (CRE_VALIDATORS.renderErrors) {
            var htmlErr = CRE_VALIDATORS.renderErrors(errs);
            var box = root ? root.querySelector('.cre-resumo-erros') : null;
            if (!box && root) {
              var dbox = document.createElement('div');
              dbox.className = 'cre-resumo-erros';
              root.insertBefore(dbox, root.firstChild);
              box = dbox;
            }
            if (box) box.innerHTML = htmlErr;
          }
          var firstKey = null;
          for (var fk in errs) { if (errs.hasOwnProperty(fk)) { firstKey = fk; break; } }
          if (firstKey) {
            var fel = $('#' + firstKey);
            if (fel) { fel.focus(); fel.classList.add('is-invalid'); }
          }
          return;
        }

        if (isEdit) {
          var upd = D.updateProposal(prop.id, {
            name: name,
            clientId: clientId,
            status: status,
            partners: tempProposalPartners
          });
          var falhaUpd = falhaDeGravacao(upd);
          if (falhaUpd) {
            CRE.toast('Alterações NÃO foram salvas: ' + falhaUpd, 'error');
            return;
          }
          CRE.closeModal();
          CRE.toast('Proposta e parceiros atualizados com sucesso!', 'success');
          renderProposals();
          if (global.CRE_EDITOR) global.CRE_EDITOR.refreshProposalSelect();
        } else {
          var tmplId = $('#npTemplate') ? $('#npTemplate').value : '';
          var layout = D.defaultLayout();
          if (tmplId) {
            var tmpl = db.templates.find(function (t) { return t.id === tmplId; });
            if (tmpl && tmpl.layout) layout = JSON.parse(JSON.stringify(tmpl.layout));
          }
          var newProp = D.addProposal({
            name: name,
            clientId: clientId,
            status: status,
            layout: layout,
            partners: tempProposalPartners
          });
          var falhaAdd = falhaDeGravacao(newProp);
          if (falhaAdd) {
            CRE.toast('Proposta NÃO foi salva: ' + falhaAdd, 'error');
            return;
          }
          CRE.closeModal();
          CRE.toast('Proposta criada com sucesso!', 'success');
          openProposal(newProp.id);
        }
      });
    }

    render();
  }

  function createProposal() {
    openProposalModal(null);
  }

  /* ══════════════ NOTAS FISCAIS ══════════════ */

  var INVOICE_TYPE_LABELS = { produto: 'Produto', remessa: 'Remessa', servico: 'Serviço', custom: 'Personalizada' };
  var PAYMENT_LABELS = { pending: 'Pendente', partial: 'Parcial', paid: 'Pago', overdue: 'Atrasado', nofin: 'Não gera financeiro' };

  var NFA_OPEN = false;
  var MODEL_OPEN = false;
  var nfFromTable = false;
  var nfaInvoice = null;
  var nfaProposal = null;
  var nfaModel = null;
  var nfaIsNew = false;
  var nfaListProposalId = '';
  var modelState = null;

  function todayStr() {
    var dd = new Date();
    return dd.getFullYear() + '-' + pad2(dd.getMonth() + 1) + '-' + pad2(dd.getDate());
  }

  function invDay(s) {
    if (!s) return '—';
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return CRE.fmtDate(s);
  }

  function slugKey(s) {
    var t = String(s || '').toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* silent */ }
    t = t.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return t || ('campo_' + Date.now().toString(36));
  }

  var INVOICE_STATUS_PILLS = { draft: 'pill-draft', issued: 'pill-approved', cancelled: 'pill-rejected', returned: 'pill-overdue' };

  function invoiceStatusPill(nf) {
    var st = D.getInvoiceStatuses().filter(function (s) { return s.key === nf.status; })[0];
    var cls = INVOICE_STATUS_PILLS[nf.status] || 'pill-pending';
    return '<span class="pill ' + cls + '">' + esc(st ? st.label : (nf.status || '—')) + '</span>';
  }

  function paymentPill(p) {
    var cls = { pending: 'pill-pending', partial: 'pill-partial', paid: 'pill-paid', overdue: 'pill-overdue', nofin: 'pill-draft' };
    return '<span class="pill ' + (cls[p] || 'pill-pending') + '">' + esc(PAYMENT_LABELS[p] || 'Pendente') + '</span>';
  }

  /* Leitura do pagamento SEMPRE pela regra derivada (CRE_DATA.pagamentoEfetivo):
     "overdue" é consequência de dueDate, nunca escolha do usuário — ver
     CRE_DATA.NOTA_OVERDUE. nf.payment cru só entra por essa porta. */
  function pag(nf) {
    if (D.pagamentoEfetivo) return D.pagamentoEfetivo(nf);
    return (nf && nf.payment) || 'pending';
  }

  function paymentPillOf(nf) { return paymentPill(pag(nf)); }

  /* "Atrasado" aparece selecionado quando a regra diz, mas vem disabled:
     é derivado, então o usuário não volta a escolher essa opção. */
  function paymentOptionsHtml(nf) {
    var efetivo = pag(nf);
    var html = '';
    if (efetivo === 'overdue') {
      html += '<option value="overdue" selected disabled>' + esc(PAYMENT_LABELS.overdue) + ' (derivado do vencimento)</option>';
    }
    ['pending', 'partial', 'paid', 'nofin'].forEach(function (pp) {
      html += '<option value="' + pp + '"' + (efetivo === pp ? ' selected' : '') + '>' + esc(PAYMENT_LABELS[pp]) + '</option>';
    });
    return html;
  }

  /* Itens do documento saem da MESMA varredura que o total: tudo que é
     tabela comercial — bloco principal e tabelas extras — vira linha.
     Antes as extras entravam só no total (proposalTotal) e sumiam dos
     itens, então o formulário já abria inconsistente. */
  var COL_VALOR_RE = /valor|total|pre\u00e7o|preco|custo|price|v\.? ?total/i;

  function collectProposalItems(proposal) {
    var items = [];
    function pushTable(d) {
      if (!d) return;
      var cols = d.cols || [];
      var qi = -1, di = -1, vi = -1;
      cols.forEach(function (c, i) {
        var s = String(c || '').toLowerCase();
        if (s.indexOf('quant') !== -1) qi = i;
        else if (/descri/.test(s)) di = i;
        else if (COL_VALOR_RE.test(String(c || '')) && vi === -1) vi = i;
      });
      (d.rows || []).forEach(function (r) {
        var desc = di !== -1 ? String(r[di] || '') : (Array.isArray(r) ? r.join(' ') : '');
        var qty = qi !== -1 ? String(r[qi] || '1') : '1';
        var val = vi !== -1 ? (global.CRE.parseBRL(r[vi]) || 0) : 0;
        if (String(desc).trim() || val > 0) {
          items.push({ descricao: String(desc).trim(), quantidade: qty, unidade: 'un', valor: val });
        }
      });
    }
    var layout = proposal && proposal.layout;
    if (!layout || !Array.isArray(layout.blocks)) return items;
    layout.blocks.forEach(function (b) {
      if (!b || b.type !== 'commercial' || !b.data) return;
      pushTable(b.data);
      (b.data.extras || []).forEach(function (ex) {
        if (ex && ex.type === 'table') pushTable(ex);
      });
    });
    return items;
  }

  function totalDosItens(items) {
    var t = (items || []).reduce(function (acc, it) {
      return acc + (parseFloat(it && it.valor) || 0);
    }, 0);
    return Math.round(t * 100) / 100;
  }

  function prefillInvoice(proposal, model) {
    var cfg = D.getConfig();
    var fiscal = cfg.fiscal || {};
    var c = proposal ? D.findClient(proposal.clientId) : null;
    var type = model ? (model.type || 'custom') : 'custom';
    var mdata = {};
    (model && model.fields || []).forEach(function (f) {
      if (f.type === 'select' && Array.isArray(f.options) && f.options.length) {
        if (model.type === 'remessa' && f.key === 'naturezaOperacao') mdata[f.key] = f.options[1] || f.options[0];
        else if (model.type === 'servico' && f.key === 'tributacao') mdata[f.key] = f.options[0];
        else if (model.type === 'servico' && f.key === 'retencao') mdata[f.key] = f.options[0];
        else mdata[f.key] = f.options[0];
      } else if (f.type === 'number') {
        mdata[f.key] = '';
      } else {
        mdata[f.key] = '';
      }
    });
    var itens = collectProposalItems(proposal);
    return {
      id: null,
      proposalId: proposal ? proposal.id : '',
      clientId: proposal ? proposal.clientId : '',
      modelId: model ? model.id : '',
      type: type,
      geraFinanceiro: model ? model.geraFinanceiro !== false : true,
      number: '',
      status: 'draft',
      payment: model && model.geraFinanceiro === false ? 'nofin' : 'pending',
      dueDate: '',
      paymentDate: '',
      issuedAt: todayStr(),
      emitente: {
        razaoSocial: fiscal.razaoSocial || '', cnpj: fiscal.cnpj || '', ie: fiscal.ie || '',
        im: fiscal.im || '', endereco: fiscal.endereco || '', cidade: fiscal.cidade || '',
        telefone: fiscal.telefone || '', email: fiscal.email || ''
      },
      destinatario: {
        razaoSocial: c ? (c.company || c.name || '') : '', cnpj: c ? (c.cnpj || '') : '',
        ie: c ? (c.inscricaoEstadual || '') : '', im: c ? (c.inscricaoMunicipal || '') : '',
        endereco: c ? (c.address || '') : '', telefone: c ? (c.phone || '') : '', email: c ? (c.email || '') : ''
      },
      referencia: proposal ? (proposal.name || '') : '',
      items: itens,
      /* Mesma fonte que os itens: soma das linhas que o usuário vai ver.
         Ler proposalTotal aqui trazia as tabelas extras no total e não nas
         linhas, e o recálculo do formulário jogava a diferença fora. */
      total: totalDosItens(itens),
      modelData: mdata,
      observacoes: ''
    };
  }

  function openInvoiceList(proposalId) {
    var prop = D.getProposal(proposalId);
    if (!prop) return;
    NFA_OPEN = true;
    MODEL_OPEN = false;
    nfFromTable = false;
    nfaListProposalId = proposalId;
    var list = D.findInvoicesByProposal(proposalId);
    var rows = list.length
      ? list.map(function (nf) {
          return '<div class="list-row">' +
            '<div class="lr-main"><div class="lr-title">🧾 ' + esc(INVOICE_TYPE_LABELS[nf.type] || nf.type || 'Documento') + ' · nº ' + esc(nf.number || '—') + '</div>' +
            '<div class="lr-sub">' + esc(CRE.fmtDate(nf.issuedAt)) + ' · ' + esc(CRE.fmtBRL(nf.total || 0)) + '</div></div>' +
            invoiceStatusPill(nf) +
            '<button class="mini-btn" data-nf-act="editnf" data-id="' + nf.id + '" title="Editar">✏️</button>' +
            '<button class="mini-btn" data-nf-act="printnf" data-id="' + nf.id + '" title="Imprimir comprovante">🖨️</button>' +
            '<button class="mini-btn danger" data-nf-act="delnf" data-id="' + nf.id + '" title="Excluir">✕</button>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhum documento para esta proposta ainda.</p>';

    var models = D.getInvoiceModels().map(function (m) {
      return '<option value="' + m.id + '">' + esc(m.name) + '</option>';
    }).join('');

    CRE.openModal('Documentos da proposta — ' + esc(prop.name),
      '<p class="muted" style="margin-top:0">O documento já vem preenchido com os dados da sua empresa, do cliente e os itens desta proposta. Revise e salve.</p>' +
      '<p class="muted">' + esc(CRE_FISCAL.taxDisclaimer()) + '</p>' +
      '<div style="max-height:300px;overflow:auto">' + rows + '</div>' +
      '<hr>' +
      '<label><span>Emitir novo documento (modelo)</span><select id="nfNewModel" class="input">' + models + '</select></label>' +
      '<div class="btn-row" style="justify-content:flex-end">' +
        '<button type="button" class="btn btn-secondary" data-nf-act="cancel2">Fechar</button>' +
        '<button type="button" class="btn btn-primary" data-nf-act="new">+ Novo documento</button>' +
      '</div>');
  }

  function openInvoiceForm(opts) {
    var prop, model;
    if (opts.invoiceId) {
      nfaInvoice = JSON.parse(JSON.stringify(D.getInvoice(opts.invoiceId)));
      if (!nfaInvoice) return;
      if (!nfaInvoice.referencia) nfaInvoice.referencia = '';
      prop = D.getProposal(nfaInvoice.proposalId);
      model = D.getInvoiceModel(nfaInvoice.modelId) || null;
      if (!model) {
        var mk = nfaInvoice.modelData && typeof nfaInvoice.modelData === 'object'
          ? Object.keys(nfaInvoice.modelData) : [];
        model = {
          id: '', name: nfaInvoice.modelId || '', type: nfaInvoice.type || 'custom',
          geraFinanceiro: nfaInvoice.geraFinanceiro !== false,
          fields: mk.map(function (k) { return { key: k, label: k, type: 'text', required: false, options: [] }; })
        };
      }
      nfaIsNew = false;
    } else {
      prop = D.getProposal(opts.proposalId);
      if (!prop) return;
      model = D.getInvoiceModel(opts.modelId) || D.getInvoiceModels()[0] || null;
      if (!model) { CRE.toast('Cadastre um modelo de documento nas Configurações antes de emitir.', 'error'); return; }
      nfaInvoice = prefillInvoice(prop, model);
      nfaIsNew = true;
    }
    nfaProposal = prop;
    nfaModel = model;
    NFA_OPEN = true;
    MODEL_OPEN = false;
    rerenderInvoiceForm();
  }

  function rerenderInvoiceForm() {
    CRE.openModal(nfaIsNew ? 'Emitir documento (nota de serviço)' : 'Editar documento (nota de serviço)', buildInvoiceForm());
    renderInvoiceItems(nfaInvoice.items || []);
  }

  function buildInvoiceForm() {
    var nf = nfaInvoice;
    var e = nf.emitente || {};
    var d = nf.destinatario || {};
    var isNew = nfaIsNew;
    var modelOpts = D.getInvoiceModels().map(function (m) {
      return '<option value="' + m.id + '"' + (nfaModel && nfaModel.id === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>';
    }).join('');

    var html = '';
    html += '<div class="client-detail-grid" style="margin-bottom:2px">' +
      '<label><span>Número</span><input type="text" id="nfNumber" class="input" value="' + esc(nf.number || '') + '" placeholder="Automático"></label>' +
      '<label><span>Data de emissão</span><input type="date" id="nfDate" class="input" value="' + esc(nf.issuedAt || todayStr()) + '"></label>' +
    '</div>';
    html += '<label><span>Status</span><select id="nfStatus" class="input">' +
      D.getInvoiceStatuses().map(function (s) {
        return '<option value="' + s.key + '"' + (nf.status === s.key ? ' selected' : '') + '>' + esc(s.label) + '</option>';
      }).join('') +
    '</select></label>';
    html += '<div class="client-detail-grid" style="margin-bottom:2px">' +
      '<label><span>Status de pagamento</span><select id="nfPayment" class="input">' +
        paymentOptionsHtml(nf) +
      '</select></label>' +
      '<label><span>Vencimento</span><input type="date" id="nfDueDate" class="input" value="' + esc(nf.dueDate || '') + '"></label>' +
      '<label><span>Data do pagamento</span><input type="date" id="nfPaymentDate" class="input" value="' + esc(nf.paymentDate || '') + '"></label>' +
    '</div>';
    if (isNew) {
      html += '<label><span>Modelo de documento</span><select id="nfModelSel" class="input">' + modelOpts + '</select></label>';
    }

    html += '<hr style="margin:14px 0">';
    html += '<p class="section-label">Emitente</p>';
    html += '<div class="client-detail-grid">' +
      nfField('e-razao', 'Razão social', e.razaoSocial) +
      nfField('e-cnpj', 'CNPJ', e.cnpj) +
      nfField('e-ie', 'Inscrição Estadual', e.ie) +
      nfField('e-im', 'Inscrição Municipal', e.im) +
      nfField('e-addr', 'Endereço', e.endereco, true) +
      nfField('e-cidade', 'Cidade / UF', e.cidade) +
      nfField('e-phone', 'Telefone', e.telefone) +
      nfField('e-email', 'E-mail', e.email) +
    '</div>';

    html += '<hr style="margin:14px 0">';
    html += '<p class="section-label">Dados da proposta</p>';
    html += '<label><span>Proposta / Referência</span><input type="text" id="nfRef" class="input" value="' + esc(nf.referencia || '') + '"></label>';

    html += '<hr style="margin:14px 0">';
    html += '<p class="section-label">Destinatário (cliente)</p>';
    html += '<div class="client-detail-grid">' +
      nfField('d-razao', 'Nome / Razão social', d.razaoSocial) +
      nfField('d-cnpj', 'CNPJ / CPF', d.cnpj) +
      nfField('d-ie', 'Inscrição Estadual', d.ie) +
      nfField('d-im', 'Inscrição Municipal', d.im) +
      nfField('d-addr', 'Endereço', d.endereco, true) +
      nfField('d-phone', 'Telefone', d.telefone) +
      nfField('d-email', 'E-mail', d.email) +
    '</div>';

    if (nfaModel && nfaModel.fields && nfaModel.fields.length) {
      html += '<hr style="margin:14px 0">';
      html += '<p class="section-label">Campos do modelo</p>';
      nfaModel.fields.forEach(function (f) {
        html += buildModelFieldInput(f, (nf.modelData || {})[f.key]);
      });
    }

    html += '<hr style="margin:14px 0">';
    html += '<p class="section-label">Itens</p>';
    html += '<div class="modal-table-wrap"><table class="modal-tbl"><thead><tr>' +
      '<th>Descrição</th><th style="width:70px">Qtd</th><th style="width:70px">Un.</th><th style="width:130px">Valor</th><th class="mdl-x-th"></th>' +
      '</tr></thead><tbody id="nfItemsBody"></tbody></table></div>';
    html += '<div class="btn-row" style="justify-content:flex-start;margin-top:8px">' +
      '<button type="button" class="btn btn-sm btn-secondary" data-nf-act="additem">+ Item</button>' +
    '</div>';
    html += '<div class="nf-total-row"><span>Total:</span><strong data-nf-total>' + esc(CRE.fmtBRL(nf.total || 0)) + '</strong></div>';
    html += '<label><span>Observações</span><textarea id="nfObs" class="input" rows="2">' + esc(nf.observacoes || '') + '</textarea></label>';

    html += '<div class="btn-row" style="justify-content:flex-end">' +
      '<button type="button" class="btn btn-secondary" data-nf-act="cancel2">Cancelar</button>' +
      '<button type="button" class="btn btn-primary" data-nf-act="save">Salvar documento</button>' +
    '</div>';
    return html;
  }

  function nfField(id, label, value, full) {
    return '<label' + (full ? ' class="full"' : '') + '><span>' + esc(label) + '</span><input type="text" class="input" data-nf-f="' + id + '" value="' + esc(value || '') + '"></label>';
  }

  function buildModelFieldInput(f, val) {
    var attrs = ' class="input" data-nf-mf="' + esc(f.key) + '"';
    if (f.type === 'textarea') {
      return '<label><span>' + esc(f.label) + '</span><textarea' + attrs + ' rows="2">' + esc(val || '') + '</textarea></label>';
    }
    if (f.type === 'select') {
      var opts = (f.options || []).map(function (o) {
        return '<option value="' + esc(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('');
      return '<label><span>' + esc(f.label) + '</span><select' + attrs + '>' + opts + '</select></label>';
    }
    if (f.type === 'number') {
      return '<label><span>' + esc(f.label) + '</span><input type="number" step="any"' + attrs + ' value="' + esc(val || '') + '"></label>';
    }
    if (f.type === 'date') {
      return '<label><span>' + esc(f.label) + '</span><input type="date"' + attrs + ' value="' + esc(val || '') + '"></label>';
    }
    return '<label><span>' + esc(f.label) + '</span><input type="text"' + attrs + ' value="' + esc(val || '') + '"></label>';
  }

  function renderInvoiceItems(items) {
    var body = $('#nfItemsBody');
    if (!body) return;
    body.innerHTML = items.map(function (it, i) {
      var valTxt = (parseFloat(it.valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return '<tr>' +
        '<td><input type="text" data-item-desc value="' + esc(it.descricao || '') + '"></td>' +
        '<td><input type="text" data-item-qtd value="' + esc(it.quantidade || '1') + '"></td>' +
        '<td><input type="text" data-item-unit value="' + esc(it.unidade || 'un') + '"></td>' +
        '<td><input type="text" data-item-val value="' + esc(valTxt) + '"></td>' +
        '<td class="mdl-x"><button type="button" class="mdl-x-btn" data-nf-act="delitem" data-idx="' + i + '" title="Excluir item">✕</button></td>' +
      '</tr>';
    }).join('');
    updateNfTotal();
  }

  function updateNfTotal() {
    var total = 0;
    $$('[data-item-val]').forEach(function (el) {
      total += CRE.parseBRL(el.value);
    });
    var disp = $('[data-nf-total]');
    if (disp) disp.textContent = CRE.fmtBRL(total);
  }

  function readInvoiceFromForm() {
    var nf = nfaInvoice;
    var numEl = $('#nfNumber');
    if (numEl) nf.number = numEl.value.trim();
    var dtEl = $('#nfDate');
    if (dtEl) nf.issuedAt = dtEl.value || null;
    var stEl = $('#nfStatus');
    if (stEl) nf.status = stEl.value;
    var payEl = $('#nfPayment');
    if (payEl) {
      nf.payment = payEl.value;
      /* geraFinanceiro NÃO sai do dropdown: vem do modelo (prefillInvoice)
         e uma remessa "sem financeiro" não vira financeira porque o usuário
         trocou o pagamento. */
      if (nf.payment === 'paid' && !nf.paymentDate) nf.paymentDate = todayStr();
    }
    var dueEl = $('#nfDueDate');
    if (dueEl) nf.dueDate = dueEl.value;
    var pdEl = $('#nfPaymentDate');
    if (pdEl) nf.paymentDate = pdEl.value;
    var refEl = $('#nfRef');
    if (refEl) nf.referencia = refEl.value;

    var em = nf.emitente = nf.emitente || {};
    ['razaoSocial', 'cnpj', 'ie', 'im', 'endereco', 'cidade', 'telefone', 'email'].forEach(function (k, i) {
      var ids = ['e-razao', 'e-cnpj', 'e-ie', 'e-im', 'e-addr', 'e-cidade', 'e-phone', 'e-email'];
      var el = $('[data-nf-f="' + ids[i] + '"]');
      if (el) em[k] = el.value;
    });

    var de = nf.destinatario = nf.destinatario || {};
    ['razaoSocial', 'cnpj', 'ie', 'im', 'endereco', 'telefone', 'email'].forEach(function (k, i) {
      var ids = ['d-razao', 'd-cnpj', 'd-ie', 'd-im', 'd-addr', 'd-phone', 'd-email'];
      var el = $('[data-nf-f="' + ids[i] + '"]');
      if (el) de[k] = el.value;
    });

    var md = nf.modelData = nf.modelData || {};
    (nfaModel.fields || []).forEach(function (f) {
      var el = $('[data-nf-mf="' + f.key + '"]');
      if (!el) return;
      md[f.key] = f.type === 'number' ? (parseFloat(el.value) || 0) : el.value;
    });

    nf.items = [];
    $$('[data-item-desc]').forEach(function (di) {
      var row = di.closest('tr');
      var desc = di.value.trim();
      var qtd = row.querySelector('[data-item-qtd]').value;
      var unit = row.querySelector('[data-item-unit]').value;
      var val = CRE.parseBRL(row.querySelector('[data-item-val]').value);
      if (desc || val) nf.items.push({ descricao: desc, quantidade: qtd || '1', unidade: unit || 'un', valor: val });
    });
    nf.total = totalDosItens(nf.items);
    var obsEl = $('#nfObs');
    if (obsEl) nf.observacoes = obsEl.value;
    return nf;
  }

  function saveInvoiceFromForm() {
    var nf = readInvoiceFromForm();
    var saved = nfaIsNew ? D.addInvoice(nf) : D.updateInvoice(nf.id, nf);
    var falha = falhaDeGravacao(saved);
    if (falha) {
      /* Modal fica aberto com o que o usuário digitou: fechar aqui seria
         perder o trabalho sem ter gravado nada. */
      CRE.toast('Documento NÃO salvo: ' + falha, 'error');
      return;
    }
    NFA_OPEN = false;
    CRE.toast('Documento salvo.', 'success');
    if (nfFromTable) {
      CRE.closeModal();
      renderInvoices();
      if (selectedClientId) renderClientDetail();
    } else {
      openInvoiceList(nf.proposalId);
    }
  }

  function deleteInvoiceById(id) {
    var nf = D.getInvoice(id);
    if (!nf) return;
    var propId = nf.proposalId;
    if (nf.status === 'issued') {
      CRE.toast('Documento emitido não pode ser excluído. Mude o status para Cancelado.', 'error');
      return;
    }
    CRE.confirm('Excluir documento (comprovante interno)',
      'Excluir o documento nº ' + (nf.number || '—') + '? ' + CRE_FISCAL.taxDisclaimer(),
      function () {
        var res = D.deleteInvoice(id);
        var falha = falhaDeOperacao(res);
        if (falha) {
          CRE.toast('Documento NÃO excluído: ' + falha, 'error');
        } else {
          NFA_OPEN = false;
          CRE.toast('Documento excluído.', 'info');
        }
        openInvoiceList(propId);
      }, 'Excluir');
  }

  /* ══════════════ ABA NOTAS (tabela geral) ══════════════ */

  function proposalOptionsFor(clientId) {
    var db = D.load();
    var props = clientId ? db.proposals.filter(function (p) { return p.clientId === clientId; }) : db.proposals;
    if (!props.length) return '<option value="">—</option>';
    return props.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name || 'Sem nome') + '</option>';
    }).join('');
  }

  function openInvoiceFromScratch() {
    var db = D.load();
    var clientOpts = db.clients.length
      ? db.clients.map(function (c) {
          return '<option value="' + c.id + '">' + esc(c.company || c.name) + '</option>';
        }).join('')
      : '<option value="">—</option>';
    var firstClient = db.clients[0] ? db.clients[0].id : '';
    var modelOpts = D.getInvoiceModels().map(function (m) {
      return '<option value="' + m.id + '">' + esc(m.name) + '</option>';
    }).join('');
    var propOpts = proposalOptionsFor(firstClient);
    var noPreset = !db.clients.length;

    CRE.openModal('Emitir documento (nota de serviço)',
      '<p class="muted" style="margin-top:0">Selecione o cliente e o orçamento que serão vinculados ao documento.</p>' +
      (noPreset ? '<p class="muted" style="color:var(--danger-h)">Cadastre clientes e propostas antes de emitir documentos.</p>' : '') +
      '<p class="muted">' + esc(CRE_FISCAL.taxDisclaimer()) + '</p>' +
      '<label><span>Cliente</span><select id="invClientSel" class="input">' + clientOpts + '</select></label>' +
      '<label><span>Orçamento / Proposta</span><select id="invPropSel" class="input">' + propOpts + '</select></label>' +
      '<label><span>Modelo de documento</span><select id="invModelSel" class="input">' + modelOpts + '</select></label>' +
      '<div class="btn-row" style="justify-content:flex-end">' +
        '<button class="btn btn-secondary" id="invCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="invNext">Continuar</button>' +
      '</div>');

    $('#invCancel').addEventListener('click', CRE.closeModal);
    $('#invClientSel').addEventListener('change', function () {
      $('#invPropSel').innerHTML = proposalOptionsFor($('#invClientSel').value);
    });
    $('#invNext').addEventListener('click', function () {
      var propId = $('#invPropSel').value;
      if (!propId) {
        marcaErro($('#invPropSel'), 'Este cliente ainda não possui orçamentos. Crie uma proposta primeiro.');
        return;
      }
      var modelId = $('#invModelSel').value;
      nfFromTable = true;
      CRE.closeModal();
      openInvoiceForm({ proposalId: propId, modelId: modelId });
    });
  }

  function invTotal(invoices, filter) {
    return invoices.reduce(function (acc, nf) {
      return acc + (filter(nf) ? (parseFloat(nf.total) || 0) : 0);
    }, 0);
  }

  function renderInvFilterChips(allInvoices, activeStatus, activePay) {
    var container = $('#invFilterChips');
    if (!container) return;
    var counts = {
      all: allInvoices.length,
      issued: allInvoices.filter(function (n) { return n.status === 'issued'; }).length,
      draft: allInvoices.filter(function (n) { return n.status === 'draft'; }).length,
      paid: allInvoices.filter(function (n) { return pag(n) === 'paid'; }).length,
      pending: allInvoices.filter(function (n) { return pag(n) === 'pending'; }).length,
      overdue: allInvoices.filter(function (n) { return pag(n) === 'overdue'; }).length
    };
    var items = [
      { type: 'all', key: '', label: 'Todos os Documentos', count: counts.all, active: !activeStatus && !activePay },
      { type: 'st', key: 'issued', label: 'Emitidas', count: counts.issued, active: activeStatus === 'issued' },
      { type: 'st', key: 'draft', label: 'Rascunhos', count: counts.draft, active: activeStatus === 'draft' },
      { type: 'pay', key: 'paid', label: 'Pagas', count: counts.paid, active: activePay === 'paid' },
      { type: 'pay', key: 'pending', label: 'Pendentes', count: counts.pending, active: activePay === 'pending' },
      { type: 'pay', key: 'overdue', label: 'Atrasadas', count: counts.overdue, active: activePay === 'overdue' }
    ];
    container.innerHTML = items.map(function (it) {
      var act = it.active ? ' active' : '';
      return '<button type="button" class="chip' + act + '" data-chip-inv-type="' + it.type + '" data-chip-inv-key="' + it.key + '">' +
        '<span>' + esc(it.label) + '</span>' +
        '<span class="chip-badge">' + it.count + '</span>' +
      '</button>';
    }).join('');
    $$('[data-chip-inv-type]', container).forEach(function (chip) {
      chip.addEventListener('click', function () {
        var t = chip.dataset.chipInvType;
        var k = chip.dataset.chipInvKey;
        if (t === 'all') {
          $('#invStatusFilter').value = '';
          $('#invPayFilter').value = '';
        } else if (t === 'st') {
          $('#invStatusFilter').value = k;
          $('#invPayFilter').value = '';
        } else if (t === 'pay') {
          $('#invStatusFilter').value = '';
          $('#invPayFilter').value = k;
        }
        renderInvoices();
      });
    });
  }

  function renderInvoiceStats(invoices) {
    var box = $('#invStatGrid');
    if (!box) return;
    var issued = invoices.filter(function (nf) { return nf.status === 'issued'; });
    var paid = invTotal(invoices, function (nf) { return pag(nf) === 'paid'; });
    var openAmt = invTotal(invoices, function (nf) { return pag(nf) !== 'paid' && pag(nf) !== 'nofin'; });
    var overdue = invoices.filter(function (nf) { return pag(nf) === 'overdue'; }).length;
    box.innerHTML =
      '<div class="stat-card"><div class="stat-ic">🧾</div><div><div class="stat-num">' + issued.length + '/' + invoices.length + '</div><div class="stat-lbl">Emitidas / Total</div></div></div>' +
      '<div class="stat-card"><div class="stat-ic">💰</div><div><div class="stat-num">' + CRE.fmtBRL(paid) + '</div><div class="stat-lbl">Recebido (Pago)</div></div></div>' +
      '<div class="stat-card"><div class="stat-ic">⏳</div><div><div class="stat-num">' + CRE.fmtBRL(openAmt) + '</div><div class="stat-lbl">A Receber (Em Aberto)</div></div></div>' +
      '<div class="stat-card"><div class="stat-ic">⚠️</div><div><div class="stat-num">' + overdue + '</div><div class="stat-lbl">Faturas Atrasadas</div></div></div>';
  }

  function renderInvoices() {
    var q = ($('#invSearch').value || '').toLowerCase();
    var st = $('#invStatusFilter').value || '';
    var pay = $('#invPayFilter').value || '';
    var allNfs = D.load().invoices || [];

    renderInvFilterChips(allNfs, st, pay);

    var list = allNfs.filter(function (nf) {
      var p = D.getProposal(nf.proposalId);
      var c = p ? D.findClient(p.clientId) : (nf.clientId ? D.findClient(nf.clientId) : null);
      var hay = (nf.number || '') + ' ' + (c ? (c.name + ' ' + (c.company || '')) : '') + ' ' + (p ? p.name : (nf.referencia || ''));
      var hit = hay.toLowerCase().indexOf(q) !== -1;
      var hitSt = !st || nf.status === st;
      var hitPay = !pay || pag(nf) === pay;
      return hit && hitSt && hitPay;
    });

    renderInvoiceStats(list);

    var tbody = $('#invTable tbody');
    tbody.innerHTML = list.map(function (nf) {
      var p = D.getProposal(nf.proposalId);
      var c = p ? D.findClient(p.clientId) : (nf.clientId ? D.findClient(nf.clientId) : null);
      var clientName = c ? (c.company ? esc(c.company) + '<div class="muted">' + esc(c.name) + '</div>' : esc(c.name)) : '<span class="muted">—</span>';
      var propName = p ? p.name : (nf.referencia || '—');
      var typeLabel = INVOICE_TYPE_LABELS[nf.type] || nf.type || 'Nota';
      var finTag = nf.geraFinanceiro === false || pag(nf) === 'nofin' ? '' : ' <span title="Gera financeiro">💰</span>';
      return '<tr>' +
        '<td class="strong">' + esc(nf.number || '—') + '<div class="muted" style="font-weight:500">' + esc(typeLabel) + finTag + '</div></td>' +
        '<td>' + clientName + '</td>' +
        '<td>' + (p ? '<a href="#" class="inv-prop-link" data-inv-open-prop="' + p.id + '">' + esc(propName) + '</a>' : esc(propName)) + '</td>' +
        '<td class="muted">' + invDay(nf.issuedAt) + '</td>' +
        '<td class="muted">' + invDay(nf.dueDate) + '</td>' +
        '<td class="ta-right strong"><span class="val-badge">' + CRE.fmtBRL(nf.total || 0) + '</span></td>' +
        '<td>' + invoiceStatusPill(nf) + '</td>' +
        '<td><select class="input input-sm status-select inv-pay-sel" data-inv-pay="' + nf.id + '">' +
          paymentOptionsHtml(nf) +
        '</select></td>' +
        '<td><div class="row-actions">' +
          '<button class="mini-btn primary" data-inv-edit="' + nf.id + '" title="Editar documento">✏️</button>' +
          '<button class="mini-btn" data-inv-print="' + nf.id + '" title="Imprimir comprovante">🖨️</button>' +
          '<button class="mini-btn danger" data-inv-del="' + nf.id + '" title="Excluir">✕</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    $('#invEmpty').classList.toggle('show', !list.length);

    $$('#invTable [data-inv-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        nfFromTable = true;
        openInvoiceForm({ invoiceId: btn.dataset.invEdit });
      });
    });
    $$('#invTable [data-inv-print]').forEach(function (btn) {
      btn.addEventListener('click', function () { doInvoicePrint(btn.dataset.invPrint); });
    });
    $$('#invTable [data-inv-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nf = D.getInvoice(btn.dataset.invDel);
        if (nf && nf.status === 'issued') {
          CRE.toast('Documento emitido não pode ser excluído. Mude o status para Cancelado.', 'error');
          return;
        }
        CRE.confirm('Excluir documento (comprovante interno)',
          'Excluir o documento nº ' + (nf && nf.number ? nf.number : '') + '? ' + CRE_FISCAL.taxDisclaimer(),
          function () {
            var res = D.deleteInvoice(btn.dataset.invDel);
            var falha = falhaDeOperacao(res);
            if (falha) {
              CRE.toast('Documento NÃO excluído: ' + falha, 'error');
            } else {
              CRE.toast('Documento excluído.', 'info');
            }
            renderInvoices();
            if (selectedClientId) renderClientDetail();
          }, 'Excluir');
      });
    });
    $$('#invTable [data-inv-open-prop]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        openProposal(a.dataset.invOpenProp);
      });
    });
    $$('#invTable .inv-pay-sel').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var upd = { payment: sel.value };
        if (sel.value === 'paid' && !D.getInvoice(sel.dataset.invPay).paymentDate) upd.paymentDate = todayStr();
        var res = D.updateInvoice(sel.dataset.invPay, upd);
        var falha = falhaDeGravacao(res);
        if (falha) {
          CRE.toast('Pagamento NÃO salvo: ' + falha, 'error');
          renderInvoices();
          return;
        }
        CRE.toast('Status de pagamento atualizado para ' + PAYMENT_LABELS[pag(D.getInvoice(sel.dataset.invPay))] + '.', 'success');
        renderInvoices();
        if (selectedClientId) renderClientDetail();
      });
    });
  }

  /* ── Impressão da nota fiscal ─────────────── */

  var INVOICE_PRINT_CSS = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'html,body{background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:12px}',
    '.nf{width:190mm;margin:0 auto;padding:8mm 10mm 16mm}',
    '.nf-head{border-bottom:1.2mm solid #1685bd;padding-bottom:4mm;margin-bottom:6mm;display:flex;flex-wrap:wrap;justify-content:space-between;gap:4mm}',
    '.nf-logo strong{display:block;font-size:15px}',
    '.nf-logo span{display:block;font-size:11px;margin-top:1px}',
    '.nf-title{font-size:17px;font-weight:800;text-align:right;align-self:center}',
    '.nf-meta{width:100%;display:flex;gap:10mm;justify-content:space-between;font-size:12px;margin-top:3mm}',
    'h3{font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin:6mm 0 2mm;color:#1685bd}',
    '.box{border:.5mm solid #111;border-radius:2mm;padding:3mm 4mm;margin-top:2mm}',
    '.box table{width:100%;border-collapse:collapse}',
    '.box th{text-align:left;font-size:10px;text-transform:uppercase;color:#444;padding:1mm 1mm 2mm;border-bottom:.2mm solid #999;width:30mm}',
    '.box td{font-size:12px;padding:1mm 1mm;vertical-align:top}',
    'table.items{width:100%;border-collapse:collapse;margin-top:2mm}',
    'table.items th{background:#e8f1f7;font-size:11px;text-transform:uppercase;text-align:left;padding:2.5mm 2mm;border:.3mm solid #111}',
    'table.items td{padding:2.5mm 2mm;border:.25mm solid #111;vertical-align:top;font-size:12px}',
    'table.items td.c,table.items th.c{text-align:center}',
    'table.items td.r,table.items th.r{text-align:right}',
    'table.items tr.tot td{font-weight:800;font-size:13px;background:#e8f1f7}',
    '.obs{margin-top:5mm;border:.4mm solid #111;border-radius:2mm;padding:3mm;min-height:12mm;font-size:12px}',
    '.nf-foot{margin-top:8mm;border-top:.4mm solid #999;padding-top:3mm;text-align:center;font-size:11px;color:#444;line-height:1.5}',
    '.nf-title-sub{font-size:11px;font-weight:600}',
    '.nf-title-warn{font-size:9px;font-weight:700;letter-spacing:.5px}',
    '.nf-alert{margin-top:4mm;border:.5mm solid #111;background:#f4f4f4;padding:3mm;font-size:11px;font-weight:700;text-align:center;line-height:1.5}',
    '.nf-foot .nf-disclaimer{margin-top:2mm;border-top:.3mm solid #999;padding-top:2mm;font-size:10px;font-weight:700}',
    '@media print{html,body{width:100%}.nf{width:auto;padding:0}}'
  ].join('\n');

  /* Título por tipo de operação. O padrão é o documento interno: nenhum
     tipo de dado produz afirmação de valor fiscal. */
  var DOCUMENTO_TITULO = {
    produto: 'NOTA DE PRODUTO',
    remessa: 'NOTA DE REMESSA',
    servico: 'NOTA DE SERVIÇO'
  };

  function tituloDoDocumento(nf) {
    var t = nf && nf.type ? String(nf.type).toLowerCase() : '';
    return DOCUMENTO_TITULO[t] || 'COMPROVANTE INTERNO';
  }

  /* Devolve { titulo, corpo }: título vira doc.title (texto puro, não HTML)
     e corpo é montado já escapado, sem <script> e sem document.write. */
  function buildInvoicePrintHtml(nf, prop, model) {
    var e = nf.emitente || {};
    var d = nf.destinatario || {};
    var rotuloTipo = esc(String(INVOICE_TYPE_LABELS[nf.type] || nf.type || 'Documento').toUpperCase());
    var mdata = nf.modelData || {};
    var stInfo = D.getInvoiceStatuses().filter(function (s) { return s.key === nf.status; })[0];
    /* statusTxt é rótulo livre digitado pelo usuário em Configurações —
       sempre esc, ou `<img src=x onerror=...>` roda com acesso ao
       localStorage inteiro na janela impressa. */
    var statusTxt = esc(String(stInfo ? stInfo.label : (nf.status || '—')));
    var disclaim = esc(CRE_FISCAL.taxDisclaimer());

    var modelRows = (model && model.fields || []).map(function (f) {
      var v = mdata[f.key];
      if (v === undefined || v === null || v === '') return '';
      return '<tr><th>' + esc(f.label) + '</th><td>' + esc(v) + '</td></tr>';
    }).join('');

    var itemsRows = (nf.items || []).map(function (it) {
      return '<tr><td>' + esc(it.descricao || '') + '</td><td class="c">' + esc(it.quantidade || '') + '</td>' +
        '<td class="c">' + esc(it.unidade || '') + '</td><td class="r">' + esc(CRE.fmtBRL(it.valor || 0)) + '</td></tr>';
    }).join('');

    var headEsq = e.razaoSocial
      ? '<div class="nf-logo"><strong>' + esc(e.razaoSocial) + '</strong>' +
        '<span>CNPJ: ' + esc(e.cnpj || '—') + ' · IE: ' + esc(e.ie || '—') + ' · IM: ' + esc(e.im || '—') + '</span>' +
        '<span>' + esc(e.endereco || '') + (e.cidade ? ' · ' + esc(e.cidade) : '') + '</span></div>'
      : '<div class="nf-logo"><strong>Georevest Engenharia Ltda.</strong></div>';

    return {
      titulo: 'Comprovante interno nº ' + String(nf.number || '') + ' — ' + tituloDoDocumento(nf),
      corpo: '<div class="nf">' +
        '<div class="nf-head">' +
          headEsq +
          '<div class="nf-title">' + esc(tituloDoDocumento(nf)) + '<br>' +
            '<span class="nf-title-sub">' + rotuloTipo + '</span><br>' +
            '<span class="nf-title-warn">DOCUMENTO INTERNO — SEM VALOR FISCAL</span></div>' +
          '<div class="nf-meta">' +
            '<span><strong>Nº:</strong> ' + esc(nf.number || '—') + '</span>' +
            '<span><strong>Data:</strong> ' + esc(CRE.fmtDate(nf.issuedAt)) + '</span>' +
            '<span><strong>Status:</strong> ' + statusTxt + '</span>' +
            '<span><strong>Pagamento:</strong> ' + esc(PAYMENT_LABELS[pag(nf)] || 'Pendente') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="nf-alert">' + disclaim + '</div>' +
        '<h3>Emitente</h3>' +
        '<div class="box"><table>' +
          '<tr><th>Razão social</th><td>' + esc(e.razaoSocial || '—') + '</td></tr>' +
          '<tr><th>CNPJ / IE / IM</th><td>' + esc(e.cnpj || '—') + ' · ' + esc(e.ie || '—') + ' · ' + esc(e.im || '—') + '</td></tr>' +
          '<tr><th>Endereço</th><td>' + esc(e.endereco || '—') + (e.cidade ? ' · ' + esc(e.cidade) : '') + '</td></tr>' +
          '<tr><th>Contato</th><td>' + esc(e.telefone || '—') + (e.email ? ' · ' + esc(e.email) : '') + '</td></tr>' +
        '</table></div>' +
        '<h3>Destinatário</h3>' +
        '<div class="box"><table>' +
          '<tr><th>Nome</th><td>' + esc(d.razaoSocial || '—') + '</td></tr>' +
          '<tr><th>CNPJ / CPF</th><td>' + esc(d.cnpj || '—') + '</td></tr>' +
          '<tr><th>IE / IM</th><td>' + esc(d.ie || '—') + ' · ' + esc(d.im || '—') + '</td></tr>' +
          '<tr><th>Endereço</th><td>' + esc(d.endereco || '—') + '</td></tr>' +
          '<tr><th>Contato</th><td>' + esc(d.telefone || '—') + (d.email ? ' · ' + esc(d.email) : '') + '</td></tr>' +
        '</table></div>' +
        (modelRows ? '<h3>Dados da operação</h3><div class="box"><table>' + modelRows + '</table></div>' : '') +
        '<h3>Itens</h3>' +
        '<table class="items">' +
          '<thead><tr><th>Descrição</th><th class="c" style="width:12mm">Qtd</th><th class="c" style="width:14mm">Un.</th><th class="r" style="width:30mm">Valor</th></tr></thead>' +
          '<tbody>' + itemsRows +
          '<tr class="tot"><td colspan="3" class="r">TOTAL</td><td class="r">' + esc(CRE.fmtBRL(nf.total || 0)) + '</td></tr>' +
          '</tbody>' +
        '</table>' +
        (nf.observacoes ? '<h3>Observações</h3><div class="obs">' + esc(nf.observacoes) + '</div>' : '') +
        '<div class="nf-foot">' +
          esc(e.razaoSocial || '') + '<br>' +
          esc(e.endereco || '') + '<br>' +
          esc(e.telefone || '') + (e.email ? ' · ' + esc(e.email) : '') +
          '<div class="nf-disclaimer">' + disclaim + '</div>' +
        '</div>' +
      '</div>'
    };
  }

  function doInvoicePrint(id) {
    var nf = D.getInvoice(id);
    if (!nf) return;
    var prop = D.getProposal(nf.proposalId);
    var model = D.getInvoiceModel(nf.modelId);
    var doc = buildInvoicePrintHtml(nf, prop, model);
    var w = window.open('', '_blank', 'width=920,height=720');
    if (!w) {
      CRE.toast('Habilite pop-ups no navegador para imprimir o comprovante.', 'error');
      return;
    }
    /* Nada de document.write: o corpo vem escapado do builder, o CSS vai
       como nó de texto e não existe <script> na página impressa. */
    try {
      var d = w.document;
      d.title = doc.titulo;
      var st = d.createElement('style');
      st.appendChild(d.createTextNode(INVOICE_PRINT_CSS));
      (d.head || d.documentElement).appendChild(st);
      d.body.innerHTML = doc.corpo;
      w.focus();
      setTimeout(function () {
        if (w && !w.closed) { try { w.print(); } catch (e) { /* bloqueio do navegador */ } }
      }, 300);
    } catch (err) {
      CRE.toast('Não foi possível montar a janela de impressão: ' + (err && err.message ? err.message : 'erro desconhecido'), 'error');
    }
  }

  /* ── Modelos de nota fiscal ──────────────── */

  function renderInvoiceModels() {
    var box = $('#invoiceModelList');
    if (!box) return;
    var list = D.getInvoiceModels();
    box.innerHTML = list.length
      ? list.map(function (m) {
          var n = (m.fields || []).length;
          var fin = m.geraFinanceiro !== false ? '💰 Financeiro' : '🚫 Sem financeiro';
          return '<div class="template-item">' +
            '<span class="tm-name">🧾 ' + esc(m.name) +
              ' <span class="muted" style="font-weight:400">· ' + esc(INVOICE_TYPE_LABELS[m.type] || m.type || 'Personalizada') + ' · ' + n + ' campo(s)</span></span>' +
            '<span class="pill ' + (m.geraFinanceiro !== false ? 'pill-paid' : 'pill-draft') + '" style="margin-right:6px">' + esc(fin) + '</span>' +
            '<button class="mini-btn" data-edit-im="' + m.id + '" title="Editar">✏️</button>' +
            '<button class="mini-btn danger" data-del-im="' + m.id + '" title="Excluir">✕</button>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhum modelo de documento cadastrado.</p>';

    $$('#invoiceModelList [data-edit-im]').forEach(function (btn) {
      btn.addEventListener('click', function () { openInvoiceModelForm(btn.dataset.editIm); });
    });
    $$('#invoiceModelList [data-del-im]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.delIm;
        var m = D.getInvoiceModel(id);
        var inUse = D.load().invoices.some(function (nf) { return nf.modelId === id; });
        if (inUse) {
          CRE.toast('Este modelo não pode ser excluído: existem documentos com ele no histórico.', 'error');
          return;
        }
        CRE.confirm('Excluir modelo de documento', 'Excluir o modelo "' + (m ? m.name : '') + '"?', function () {
          var res = D.deleteInvoiceModel(id);
          var falha = falhaDeOperacao(res);
          if (falha) { CRE.toast('Modelo NÃO excluído: ' + falha, 'error'); return; }
          CRE.toast('Modelo excluído.', 'info');
          renderInvoiceModels();
        }, 'Excluir');
      });
    });
  }

  function openInvoiceModelForm(modelId) {
    MODEL_OPEN = true;
    NFA_OPEN = false;
    if (modelId) {
      var found = D.getInvoiceModel(modelId);
      modelState = found ? JSON.parse(JSON.stringify(found)) : null;
    } else {
      modelState = null;
    }
    if (!modelState) {
      modelState = { name: '', type: 'custom', geraFinanceiro: true, fields: [{ key: '', label: '', type: 'text', required: false, options: [] }] };
    }
    rerenderInvoiceModelForm();
  }

  function rerenderInvoiceModelForm() {
    CRE.openModal(modelState.id ? 'Editar modelo de documento' : 'Novo modelo de documento', buildInvoiceModelForm());
  }

  function buildInvoiceModelForm() {
    var html = '';
    html += '<label><span>Nome do modelo</span><input type="text" id="nmName" class="input" value="' + esc(modelState.name || '') + '" placeholder="Ex: Nota de Serviço BH"></label>';
    html += '<label><span>Tipo do documento</span><select id="nmType" class="input">' +
      ['produto', 'remessa', 'servico', 'custom'].map(function (t) {
        return '<option value="' + t + '"' + (modelState.type === t ? ' selected' : '') + '>' + esc(INVOICE_TYPE_LABELS[t] || t) + '</option>';
      }).join('') +
    '</select></label>';
    html += '<label><span>Gera financeiro</span><select id="nmFin" class="input">' +
      '<option value="1"' + (modelState.geraFinanceiro !== false ? ' selected' : '') + '>Sim — gera lançamento financeiro</option>' +
      '<option value="0"' + (modelState.geraFinanceiro === false ? ' selected' : '') + '>Não — apenas fiscal</option>' +
    '</select></label>';
    html += '<p class="muted" style="margin:-2px 0 0">Indica se os documentos emitidos com este modelo movimentam o financeiro (recebimentos) ou são apenas fiscais.</p>';
    html += '<hr style="margin:14px 0">';
    html += '<p class="section-label">Campos do modelo</p>';
    modelState.fields.forEach(function (f, i) {
      html += buildModelFieldEditor(i);
    });
    html += '<button type="button" class="btn btn-sm btn-secondary" data-im-act="addfield">+ Adicionar campo</button>';
    html += '<div class="btn-row" style="justify-content:flex-end;margin-top:14px">' +
      '<button type="button" class="btn btn-secondary" data-im-act="cancel">Cancelar</button>' +
      '<button type="button" class="btn btn-primary" data-im-act="save">Salvar modelo</button>' +
    '</div>';
    return html;
  }

  function buildModelFieldEditor(i) {
    var f = modelState.fields[i] || {};
    var typeOpts = ['text', 'textarea', 'number', 'date', 'select'].map(function (t) {
      var labels = { text: 'Texto', textarea: 'Texto longo', number: 'Número', date: 'Data', select: 'Lista (opções)' };
      return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + labels[t] + '</option>';
    }).join('');
    var showOpts = f.type === 'select' ? '' : ' style="display:none"';
    return '<div class="mdl-extra">' +
      '<p class="mdl-extra-tag">Campo ' + (i + 1) + '</p>' +
      '<label><span>Rótulo do campo</span><input type="text" class="input" data-im-f="label" data-idx="' + i + '" value="' + esc(f.label || '') + '"></label>' +
      '<div style="display:flex;gap:8px">' +
        '<label style="flex:1"><span>Tipo</span><select class="input" data-im-f="type" data-idx="' + i + '">' + typeOpts + '</select></label>' +
        '<label class="check-line" style="align-self:flex-end;margin-bottom:18px"><input type="checkbox" data-im-f="required" data-idx="' + i + '"' + (f.required ? ' checked' : '') + '> Obrigatório</label>' +
      '</div>' +
      '<label' + showOpts + ' data-im-opts-wrap="' + i + '"><span>Opções (separadas por vírgula)</span><textarea class="input" data-im-f="options" data-idx="' + i + '" rows="2">' + esc((f.options || []).join(', ')) + '</textarea></label>' +
      '<div class="btn-row" style="justify-content:flex-start"><button type="button" class="btn btn-sm btn-danger" data-im-act="delfield" data-idx="' + i + '">Remover campo</button></div>' +
    '</div>';
  }

  function saveInvoiceModel() {
    var name = ($('#nmName') ? $('#nmName').value : '').trim();
    var type = $('#nmType') ? $('#nmType').value : 'custom';
    var finEl = $('#nmFin');
    var geraFinanceiro = finEl ? finEl.value === '1' : modelState.geraFinanceiro !== false;
    if (!name) { marcaErro($('#nmName'), 'Informe um nome para o modelo.'); return; }
    var fields = [];
    for (var i = 0; i < modelState.fields.length; i++) {
      var lab = $('[data-im-f="label"][data-idx="' + i + '"]');
      if (!lab || !lab.value.trim()) continue;
      var typ = $('[data-im-f="type"][data-idx="' + i + '"]');
      var req = $('[data-im-f="required"][data-idx="' + i + '"]');
      var optsEl = $('[data-im-f="options"][data-idx="' + i + '"]');
      var typVal = typ ? typ.value : 'text';
      var opts = (typVal === 'select' && optsEl)
        ? optsEl.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        : [];
      fields.push({
        key: slugKey(lab.value.trim()),
        label: lab.value.trim(),
        type: typVal,
        required: !!(req && req.checked),
        options: typVal === 'select' ? opts : undefined
      });
    }
    if (!fields.length) { CRE.toast('Adicione ao menos um campo ao modelo.', 'error'); return; }
    var data = { name: name, type: type, geraFinanceiro: geraFinanceiro, fields: fields };
    var saved = modelState.id ? D.updateInvoiceModel(modelState.id, data) : D.addInvoiceModel(data);
    var falha = falhaDeGravacao(saved);
    if (falha) {
      CRE.toast('Modelo NÃO salvo: ' + falha, 'error');
      return;
    }
    MODEL_OPEN = false;
    CRE.closeModal();
    renderInvoiceModels();
  }

  /* ── Status de nota fiscal (Configurações) ── */

  function renderInvoiceStatuses() {
    var box = $('#invoiceStatusList');
    if (!box) return;
    box.innerHTML = D.getInvoiceStatuses().map(function (s) {
      var lock = s.locked ? ' 🔒' : '';
      var del = s.locked
        ? ''
        : '<button class="mini-btn danger" data-del-status="' + s.key + '" title="Excluir">✕</button>';
      return '<div class="template-item">' +
        '<span class="tm-name">' + esc(s.label) + lock +
          ' <span class="muted" style="font-weight:400">· ' + esc(s.key) + '</span></span>' +
        del +
      '</div>';
    }).join('');

    $$('#invoiceStatusList [data-del-status]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var res = D.deleteInvoiceStatus(btn.dataset.delStatus);
        if (res && res.error) { CRE.toast(res.error, 'error'); return; }
        var falha = falhaDeOperacao(res);
        if (falha) { CRE.toast('Status NÃO excluído: ' + falha, 'error'); return; }
        CRE.toast('Status excluído.', 'info');
        renderInvoiceStatuses();
      });
    });
  }

  /* ── Delegada de eventos (notas/modelos) ─── */

  function handleNfAct(el) {
    var act = el.dataset.nfAct;
    if (act === 'cancel2') {
      NFA_OPEN = false;
      CRE.closeModal();
    } else if (act === 'new') {
      var m = $('#nfNewModel');
      var modelId = m ? m.value : '';
      var listPropId = nfaListProposalId || currentNfProposalId();
      nfFromTable = false;
      openInvoiceForm({ proposalId: listPropId, modelId: modelId });
    } else if (act === 'editnf') {
      nfFromTable = false;
      openInvoiceForm({ invoiceId: el.dataset.id });
    } else if (act === 'printnf') {
      doInvoicePrint(el.dataset.id);
    } else if (act === 'delnf') {
      deleteInvoiceById(el.dataset.id);
    } else if (act === 'save') {
      saveInvoiceFromForm();
    } else if (act === 'additem') {
      readInvoiceFromForm();
      nfaInvoice.items.push({ descricao: '', quantidade: '1', unidade: 'un', valor: 0 });
      renderInvoiceItems(nfaInvoice.items);
    } else if (act === 'delitem') {
      readInvoiceFromForm();
      if (nfaInvoice.items.length > 0) {
        nfaInvoice.items.splice(parseInt(el.dataset.idx, 10), 1);
        renderInvoiceItems(nfaInvoice.items);
      }
    }
  }

  function currentNfProposalId() {
    return (nfaProposal && nfaProposal.id) || (nfaInvoice && nfaInvoice.proposalId) || '';
  }

  function initInvoiceEvents() {
    var body = $('#appModalBody');

    body.addEventListener('click', function (e) {
      var el = e.target.closest('[data-nf-act]');
      if (el && NFA_OPEN) {
        handleNfAct(el);
        return;
      }
      var im = e.target.closest('[data-im-act]');
      if (!im || !MODEL_OPEN) return;
      var act = im.dataset.imAct;
      if (act === 'cancel') {
        MODEL_OPEN = false;
        CRE.closeModal();
      } else if (act === 'addfield') {
        modelState.fields.push({ key: '', label: '', type: 'text', required: false, options: [] });
        rerenderInvoiceModelForm();
      } else if (act === 'delfield') {
        modelState.fields.splice(parseInt(im.dataset.idx, 10), 1);
        rerenderInvoiceModelForm();
      } else if (act === 'save') {
        saveInvoiceModel();
      }
    });

    body.addEventListener('change', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === 'nfModelSel' && NFA_OPEN) {
        var m = D.getInvoiceModel(t.value);
        if (m) {
          var prev = {};
          try { prev = JSON.parse(JSON.stringify(readInvoiceFromForm())); } catch (err) { prev = {}; }
          nfaModel = m;
          nfaInvoice = prefillInvoice(nfaProposal, m);
          ['emitente', 'destinatario', 'referencia', 'observacoes', 'items', 'number', 'status', 'dueDate', 'paymentDate'].forEach(function (k) {
            if (prev[k] !== undefined) nfaInvoice[k] = prev[k];
          });
          nfaInvoice.payment = (nfaInvoice.geraFinanceiro !== false) ? (prev.payment || 'pending') : 'nofin';
          (m.fields || []).forEach(function (f) {
            if (prev.modelData && prev.modelData[f.key] !== undefined && prev.modelData[f.key] !== '') {
              nfaInvoice.modelData[f.key] = prev.modelData[f.key];
            }
          });
          nfaInvoice.total = totalDosItens(nfaInvoice.items);
          rerenderInvoiceForm();
        }
      }
      if (MODEL_OPEN && t.hasAttribute('data-im-f') && t.dataset.imF === 'type') {
        var i = t.dataset.idx;
        var wrap = $('[data-im-opts-wrap="' + i + '"]');
        if (wrap) wrap.style.display = t.value === 'select' ? '' : 'none';
      }
    });

    body.addEventListener('input', function (e) {
      var t = e.target;
      if (t && t.hasAttribute('data-item-val') && NFA_OPEN) updateNfTotal();
    });

    $('#appModalClose').addEventListener('click', closeInvoiceStates);
    $('#appModal').addEventListener('click', function (e) {
      if (e.target === $('#appModal')) closeInvoiceStates();
    });
  }

  function readItemsFromDom() {
    var items = [];
    $$('[data-item-desc]').forEach(function (di) {
      var row = di.closest('tr');
      var desc = di.value.trim();
      var qtd = row.querySelector('[data-item-qtd]').value;
      var unit = row.querySelector('[data-item-unit]').value;
      var val = CRE.parseBRL(row.querySelector('[data-item-val]').value);
      if (desc || val) items.push({ descricao: desc, quantidade: qtd || '1', unidade: unit || 'un', valor: val });
    });
    return items;
  }

  function closeInvoiceStates() {
    NFA_OPEN = false;
    MODEL_OPEN = false;
  }

  /* ══════════════ CLIENTES ══════════════ */

  var selectedClientId = null;

  function renderClients() {
    var db = D.load();
    var q = ($('#clientSearch').value || '').toLowerCase();

    var list = D.searchClients(q);
    $('#clientList').innerHTML = list.length
      ? list.map(function (c) {
          var active = selectedClientId === c.id ? ' active' : '';
          var bg = CRE.avatarGradient(c.name);
          var propsCount = D.load().proposals.filter(function (p) { return p.clientId === c.id; }).length;
          return '<div class="client-item' + active + '" data-client="' + c.id + '">' +
            '<div class="client-av" style="background:' + bg + '">' + esc(CRE.initials(c.name)) + '</div>' +
            '<div class="ci-main">' +
              '<div class="ci-name">' + esc(c.name) + '</div>' +
              '<div class="ci-sub">' + esc(c.company || 'Pessoa física') + ' · ' + propsCount + ' prop.</div>' +
            '</div>' +
            '<button class="mini-btn danger" data-del-client="' + c.id + '" title="Excluir cliente">✕</button>' +
          '</div>';
        }).join('')
      : '<p class="muted" style="padding:10px">Nenhum cliente encontrado.</p>';

    $$('#clientList .client-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (e.target.closest('[data-del-client]')) return;
        selectedClientId = item.dataset.client;
        renderClientDetail();
        renderClients();
      });
    });

    $$('#clientList [data-del-client]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        CRE.confirm('Excluir cliente', 'Excluir este cliente? As propostas vinculadas permanecerão salvas.', function () {
          var res = D.deleteClient(btn.dataset.delClient);
          var falha = falhaDeOperacao(res);
          if (falha) {
            CRE.toast('Cliente NÃO excluído: ' + falha, 'error');
            return;
          }
          CRE.toast('Cliente excluído.', 'info');
          if (selectedClientId === btn.dataset.delClient) selectedClientId = null;
          renderClients();
        }, 'Excluir');
      });
    });

    if (!selectedClientId && list.length) selectedClientId = list[0].id;
    renderClientDetail();
  }

  function renderClientDetail() {
    var box = $('#clientDetail');
    var c = D.findClient(selectedClientId);
    if (!c) {
      $('#clientDetailTitle').textContent = 'Detalhes do cliente';
      box.innerHTML = '<p class="muted">Selecione ou crie um cliente para ver os detalhes completos.</p>';
      return;
    }
    $('#clientDetailTitle').textContent = c.company || c.name;

    var bg = CRE.avatarGradient(c.name);
    var cleanPhone = c.phone ? String(c.phone).replace(/\D/g, '') : '';
    var waPhone = cleanPhone ? (cleanPhone.indexOf('55') === 0 ? cleanPhone : '55' + cleanPhone) : '';

    var heroHtml =
      '<div class="client-hero">' +
        '<div class="client-hero-av" style="background:' + bg + '">' + esc(CRE.initials(c.name)) + '</div>' +
        '<div class="client-hero-main">' +
          '<h3 class="client-hero-name">' + esc(c.name) + '</h3>' +
          '<div class="client-hero-sub">' + esc(c.company || 'Cliente') + (c.phone ? ' · ' + esc(c.phone) : '') + '</div>' +
          '<div class="client-quick-actions" style="margin-top:10px">' +
            (waPhone ? '<a href="https://wa.me/' + waPhone + '" target="_blank" class="cqa-btn wa" title="Conversar no WhatsApp"><span>💬</span> WhatsApp</a>' : '') +
            (c.email ? '<a href="mailto:' + esc(c.email) + '" class="cqa-btn" title="Enviar e-mail"><span>✉️</span> E-mail</a>' : '') +
            (cleanPhone ? '<a href="tel:' + cleanPhone + '" class="cqa-btn" title="Ligar"><span>📞</span> Ligar</a>' : '') +
            (c.cnpj ? '<button class="cqa-btn" data-copy-cnpj="' + esc(c.cnpj) + '" title="Copiar CNPJ"><span>📋</span> Copiar CNPJ</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';

    var props = D.load().proposals.filter(function (p) { return p.clientId === c.id; });
    var propRows = props.length
      ? props.map(function (p) {
          var val = CRE.proposalTotal(p.layout);
          return '<div class="list-row">' +
            '<div class="lr-main"><div class="lr-title">' + esc(p.name || 'Sem nome') + '</div>' +
            '<div class="lr-sub">' + CRE.fmtDate(p.createdAt) + ' · <span class="val-badge">' + CRE.fmtBRL(val) + '</span></div></div>' +
            CRE.statusPill(p.status) +
            '<button class="mini-btn primary wide" data-cprop="' + p.id + '">Abrir</button>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhuma proposta vinculada.</p>';

    var invs = D.findInvoicesByClient(c.id);
    var invRows = invs.length
      ? invs.map(function (nf) {
          var p = D.getProposal(nf.proposalId);
          return '<div class="list-row">' +
            '<div class="lr-main"><div class="lr-title">🧾 Doc. ' + esc(nf.number || '—') + '</div>' +
            '<div class="lr-sub">' + esc(p ? p.name : (nf.referencia || 'Sem orçamento')) + ' · <span class="val-badge">' + CRE.fmtBRL(nf.total || 0) + '</span></div></div>' +
            invoiceStatusPill(nf) +
            paymentPillOf(nf) +
            '<button class="mini-btn" data-cinv-edit="' + nf.id + '" title="Editar documento">✏️</button>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhum documento vinculado a este cliente.</p>';

    box.innerHTML =
      heroHtml +
      '<div class="client-detail-grid">' +
        '<div class="field-detail"><span>Nome do Contato <button class="copy-btn-inline" data-copy-txt="' + esc(c.name) + '" title="Copiar">📋</button></span><div>' + esc(c.name) + '</div></div>' +
        '<div class="field-detail"><span>Empresa / Condomínio</span><div>' + esc(c.company || '—') + '</div></div>' +
        '<div class="field-detail"><span>CNPJ <button class="copy-btn-inline" data-copy-txt="' + esc(c.cnpj) + '" title="Copiar">📋</button></span><div>' + esc(c.cnpj || '—') + '</div></div>' +
        '<div class="field-detail"><span>Telefone <button class="copy-btn-inline" data-copy-txt="' + esc(c.phone) + '" title="Copiar">📋</button></span><div>' + esc(c.phone || '—') + '</div></div>' +
        '<div class="field-detail"><span>Inscrição Estadual</span><div>' + esc(c.inscricaoEstadual || '—') + '</div></div>' +
        '<div class="field-detail"><span>Inscrição Municipal</span><div>' + esc(c.inscricaoMunicipal || '—') + '</div></div>' +
        '<div class="field-detail full"><span>E-mail <button class="copy-btn-inline" data-copy-txt="' + esc(c.email) + '" title="Copiar">📋</button></span><div>' + esc(c.email || '—') + '</div></div>' +
        '<div class="field-detail full"><span>Endereço Completo <button class="copy-btn-inline" data-copy-txt="' + esc(c.address) + '" title="Copiar">📋</button></span><div>' + esc(c.address || '—') + '</div></div>' +
        (c.notes ? '<div class="field-detail full"><span>Observações</span><div>' + esc(c.notes) + '</div></div>' : '') +
      '</div>' +
      '<hr>' +
      '<p class="section-label">Propostas deste Cliente (' + props.length + ')</p>' +
      propRows +
      '<hr>' +
      '<p class="section-label">Documentos deste Cliente (' + invs.length + ')</p>' +
      invRows +
      '<div class="btn-row" style="margin-top:16px">' +
        '<button class="btn btn-secondary btn-sm" id="editClientBtn">Editar cadastro</button>' +
        '<button class="btn btn-primary btn-sm" id="newPropForClient">+ Nova proposta para este cliente</button>' +
      '</div>';

    $$('#clientDetail [data-copy-txt]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        CRE.copy(btn.dataset.copyTxt);
      });
    });
    $$('#clientDetail [data-copy-cnpj]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        CRE.copy(btn.dataset.copyCnpj, 'CNPJ copiado!');
      });
    });

    $('#editClientBtn').addEventListener('click', function () { openClientForm(c.id); });
    $('#newPropForClient').addEventListener('click', function () {
      CRE.openModal('Nova proposta',
        '<label><span>Nome da proposta</span><input type="text" id="npName" class="input" placeholder="Ex: Impermeabilização de reservatório"></label>' +
        '<label><span>Status</span><select id="npStatus2" class="input">' +
          '<option value="draft">Rascunho</option>' +
          '<option value="sent">Enviada</option>' +
          '<option value="approved">Aprovada</option>' +
          '<option value="rejected">Recusada</option>' +
        '</select></label>' +
        '<div class="btn-row" style="justify-content:flex-end">' +
          '<button class="btn btn-secondary" id="npCancel2">Cancelar</button>' +
          '<button class="btn btn-primary" id="npCreate2">Criar proposta</button>' +
        '</div>');
      $('#npCancel2').addEventListener('click', CRE.closeModal);
      $('#npCreate2').addEventListener('click', function () {
        var name = ($('#npName').value || '').trim() || ('Proposta para ' + c.name);
        var prop = D.addProposal({ name: name, clientId: c.id, status: $('#npStatus2').value || 'draft', layout: D.defaultLayout() });
        var falha = falhaDeGravacao(prop);
        if (falha) {
          CRE.toast(falha, 'error');
          return;
        }
        CRE.closeModal();
        CRE.toast('Proposta criada com sucesso!', 'success');
        openProposal(prop.id);
      });
    });

    $$('#clientDetail [data-cprop]').forEach(function (btn) {
      btn.addEventListener('click', function () { openProposal(btn.dataset.cprop); });
    });
    $$('#clientDetail [data-cinv-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        nfFromTable = true;
        openInvoiceForm({ invoiceId: btn.dataset.cinvEdit });
      });
    });
  }

  function openClientForm(clientId, onSaved, onCancel) {
    var c = clientId ? D.findClient(clientId) : null;
    CRE.openModal(c ? 'Editar cliente' : 'Novo cliente',
      '<label><span>Nome</span><input type="text" id="cfName" class="input" value="' + esc(c ? c.name : '') + '" placeholder="Nome do contato principal"></label>' +
      '<label><span>Empresa / Condomínio</span><input type="text" id="cfCompany" class="input" value="' + esc(c ? c.company : '') + '" placeholder="Razão social ou nome do condomínio"></label>' +
      '<div class="client-detail-grid">' +
        '<label style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px"><span>CNPJ</span><input type="text" id="cfCnpj" class="input" value="' + esc(c ? c.cnpj : '') + '" placeholder="00.000.000/0000-00"></label>' +
        '<label style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px"><span>Inscrição Estadual</span><input type="text" id="cfIe" class="input" value="' + esc(c ? c.inscricaoEstadual : '') + '"></label>' +
        '<label style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px"><span>Inscrição Municipal</span><input type="text" id="cfIm" class="input" value="' + esc(c ? c.inscricaoMunicipal : '') + '"></label>' +
        '<label style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px"><span>Telefone</span><input type="text" id="cfPhone" class="input" value="' + esc(c ? c.phone : '') + '" placeholder="(11) 9 9999-9999"></label>' +
      '</div>' +
      '<label><span>E-mail</span><input type="text" id="cfEmail" class="input" value="' + esc(c ? c.email : '') + '" placeholder="contato@empresa.com.br"></label>' +
      '<label><span>Endereço da obra / cobrança</span><input type="text" id="cfAddr" class="input" value="' + esc(c ? c.address : '') + '" placeholder="Rua, número, bairro, cidade - UF"></label>' +
      '<label><span>Observações internas</span><textarea id="cfNotes" class="input" rows="3" style="resize:vertical" placeholder="Informações adicionais do cliente...">' + esc(c ? c.notes : '') + '</textarea></label>' +
      '<div class="btn-row" style="justify-content:flex-end">' +
        '<button class="btn btn-secondary" id="cfCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="cfSave">' + (c ? 'Salvar alterações' : 'Cadastrar cliente') + '</button>' +
      '</div>');

    $('#cfCancel').addEventListener('click', function () {
      CRE.closeModal();
      if (typeof onCancel === 'function') onCancel();
    });
    $('#cfSave').addEventListener('click', function () {
      var data = {
        name: ($('#cfName').value || '').trim(),
        company: ($('#cfCompany').value || '').trim(),
        cnpj: ($('#cfCnpj').value || '').trim(),
        inscricaoEstadual: ($('#cfIe').value || '').trim(),
        inscricaoMunicipal: ($('#cfIm').value || '').trim(),
        phone: ($('#cfPhone').value || '').trim(),
        email: ($('#cfEmail').value || '').trim(),
        address: ($('#cfAddr').value || '').trim(),
        notes: ($('#cfNotes').value || '').trim()
      };
      var fields = [
        { key: 'cfName', label: 'Nome', value: data.name, type: 'string' },
        { key: 'cfCompany', label: 'Empresa', value: data.company, type: 'string' },
        { key: 'cfCnpj', label: 'CNPJ', value: data.cnpj, type: 'cnpj' },
        { key: 'cfEmail', label: 'E-mail', value: data.email, type: 'email' },
        { key: 'cfPhone', label: 'Telefone', value: data.phone, type: 'telefone' }
      ];
      var errs = CRE_VALIDATORS.validate(fields);
      if (!data.name && !data.company) {
        errs.cfName = errs.cfName || 'Informe pelo menos o Nome ou a Empresa.';
      }
      var errCount = 0;
      for (var ek in errs) { if (errs.hasOwnProperty(ek)) errCount++; }
      if (errCount > 0) {
        var root = $('.modal-content') || $('.modal');
        if (CRE_VALIDATORS.renderErrors) {
          var htmlErr = CRE_VALIDATORS.renderErrors(errs);
          var box = root ? root.querySelector('.cre-resumo-erros') : null;
          if (!box && root) {
            var dbox = document.createElement('div');
            dbox.className = 'cre-resumo-erros';
            root.insertBefore(dbox, root.firstChild);
            box = dbox;
          }
          if (box) box.innerHTML = htmlErr;
        }
        var firstKey = null;
        for (var fk in errs) { if (errs.hasOwnProperty(fk)) { firstKey = fk; break; } }
        if (firstKey) {
          var fel = $('#' + firstKey);
          if (fel) { fel.focus(); fel.classList.add('is-invalid'); }
        }
        return;
      }
      var saved = c ? D.updateClient(c.id, data) : D.addClient(data);
      var falha = falhaDeGravacao(saved);
      if (falha) {
        /* Modal abre ainda: sem gravação confirmada, fechar seria fingir
           que o cadastro entrou no banco. */
        CRE.toast('Cliente NÃO salvo: ' + falha, 'error');
        return;
      }
      CRE.toast(c ? 'Cliente atualizado com sucesso!' : 'Novo cliente cadastrado!', 'success');
      selectedClientId = saved.id;
      CRE.closeModal();
      if (typeof onSaved === 'function') {
        onSaved(saved);
      } else {
        renderClients();
      }
    });
  }

  /* ══════════════ PARCEIROS ══════════════ */

  var selectedPartnerId = null;
  var PARTNER_FORM_OPEN = false;
  var pfState = null;
  var pendingContract = null;
  var CONTRACT_MAX = 3.5 * 1024 * 1024;

  function renderPartners() {
    var db = D.load();
    var q = ($('#partnerSearch').value || '').toLowerCase();

    var list = D.searchPartners(q);
    $('#partnerList').innerHTML = list.length
      ? list.map(function (p) {
          var active = selectedPartnerId === p.id ? ' active' : '';
          var grad = CRE.avatarGradient(p.name || 'P');
          var propsCount = D.findProposalsByPartner(p.id).length;
          var subTxt = propsCount + (propsCount === 1 ? ' proposta' : ' propostas') + (p.cnpj ? ' · ' + p.cnpj : '');
          return '<div class="client-item' + active + '" data-partner="' + p.id + '">' +
            '<div class="client-av" style="background:' + grad + ';color:#fff">' + esc(CRE.initials(p.name)) + '</div>' +
            '<div class="ci-main">' +
              '<div class="ci-name">' + esc(p.name || 'Sem nome') + '</div>' +
              '<div class="ci-sub">' + esc(subTxt) + '</div>' +
            '</div>' +
            '<button class="mini-btn danger" data-del-partner="' + p.id + '" title="Excluir">✕</button>' +
          '</div>';
        }).join('')
      : '<p class="muted" style="padding:10px">Nenhum parceiro encontrado.</p>';

    $$('#partnerList .client-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (e.target.closest('[data-del-partner]')) return;
        selectedPartnerId = item.dataset.partner;
        renderPartnerDetail();
        renderPartners();
      });
    });

    $$('#partnerList [data-del-partner]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        CRE.confirm('Excluir parceiro', 'Excluir este parceiro de negócios?', function () {
          var res = D.deletePartner(btn.dataset.delPartner);
          var falha = falhaDeOperacao(res);
          if (falha) {
            CRE.toast('Parceiro NÃO excluído: ' + falha, 'error');
            return;
          }
          if (selectedPartnerId === btn.dataset.delPartner) selectedPartnerId = null;
          CRE.toast('Parceiro excluído com sucesso.', 'info');
          renderPartners();
        }, 'Excluir');
      });
    });

    if (!selectedPartnerId && list.length) selectedPartnerId = list[0].id;
    renderPartnerDetail();
  }

  function contractSizeTxt(c) {
    var bytes = (c && c.fileSize) || 0;
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function contractDisplay(p) {
    if (!p.contract || !p.contract.dataUrl) {
      return '<p class="muted">Nenhum contrato anexado.</p>';
    }
    return '<div class="contract-chip">' +
      '<span class="cc-icon">📄</span>' +
      '<span class="cc-main">' + esc(p.contract.fileName || 'contrato') + '</span>' +
      '<span class="cc-sub">' + esc(contractSizeTxt(p.contract)) + '</span>' +
      '<button class="mini-btn" data-dl-contract="' + p.id + '" title="Baixar contrato">Baixar</button>' +
    '</div>';
  }

  function downloadContract(id, pending) {
    var dataUrl = '';
    var fileName = 'contrato-de-parceria';
    if (pending && pending.dataUrl) {
      dataUrl = pending.dataUrl;
      fileName = pending.fileName || fileName;
    } else {
      var p = D.findPartner(id);
      if (p && p.contract && p.contract.dataUrl) {
        dataUrl = p.contract.dataUrl;
        fileName = p.contract.fileName || fileName;
      }
    }
    if (!dataUrl) return;
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = fileName;
    a.click();
  }

  function renderPartnerDetail() {
    var box = $('#partnerDetail');
    var p = D.findPartner(selectedPartnerId);
    if (!p) {
      $('#partnerDetailTitle').textContent = 'Detalhes do parceiro';
      box.innerHTML = '<p class="muted">Selecione ou crie um parceiro para ver os detalhes.</p>';
      return;
    }
    $('#partnerDetailTitle').textContent = p.name || 'Parceiro';

    var grad = CRE.avatarGradient(p.name || 'P');
    var partnerProps = D.findProposalsByPartner(p.id);
    var commSummary = D.getPartnerCommissionSummary(p.id);
    var contacts = p.contacts || [];
    var nContacts = contacts.length;

    var firstPhone = '', firstEmail = '';
    contacts.forEach(function (c) {
      if (!firstEmail && c.email) firstEmail = c.email;
      if (!firstPhone) {
        (c.phones || []).some(function (ph) {
          var d = String(ph.number || '').replace(/\D/g, '');
          if (d.length >= 10) { firstPhone = d; return true; }
          return false;
        });
      }
    });
    var waNum = firstPhone ? (firstPhone.indexOf('55') === 0 ? firstPhone : '55' + firstPhone) : '';

    var heroHtml =
      '<div class="client-hero">' +
        '<div class="client-hero-av" style="background:' + grad + '">' + esc(CRE.initials(p.name)) + '</div>' +
        '<div class="client-hero-main">' +
          '<h3 class="client-hero-name">' + esc(p.name || 'Sem nome') + '</h3>' +
          '<div class="client-hero-sub">' +
            (p.cnpj ? 'CNPJ: ' + esc(p.cnpj) : 'Parceiro') +
            (p.address ? ' · ' + esc(p.address) : '') +
            ' · ' + partnerProps.length + (partnerProps.length === 1 ? ' proposta' : ' propostas') +
          '</div>' +
          '<div class="client-quick-actions" style="margin-top:10px">' +
            (waNum ? '<a href="https://wa.me/' + waNum + '" target="_blank" class="cqa-btn wa" title="Conversar no WhatsApp"><span>💬</span> WhatsApp</a>' : '') +
            (firstEmail ? '<a href="mailto:' + esc(firstEmail) + '" class="cqa-btn" title="Enviar e-mail"><span>✉️</span> E-mail</a>' : '') +
            (firstPhone ? '<a href="tel:' + firstPhone + '" class="cqa-btn" title="Ligar"><span>📞</span> Ligar</a>' : '') +
            (p.cnpj ? '<button class="cqa-btn" data-copy-partner-cnpj="' + esc(p.cnpj) + '" title="Copiar CNPJ"><span>📋</span> Copiar CNPJ</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';

    var contactsHtml = nContacts
      ? contacts.map(function (c, i) {
          var phonesHtml = (c.phones || []).length
            ? (c.phones || []).map(function (ph) {
                var raw = String(ph.number || '').replace(/\D/g, '');
                var isWpp = raw.length >= 10;
                var cWa = raw ? (raw.indexOf('55') === 0 ? raw : '55' + raw) : '';
                var btns = '';
                if (isWpp) btns += '<a href="https://wa.me/' + cWa + '" target="_blank" rel="noopener" class="mini-btn" title="Conversar no WhatsApp">💬</a>';
                if (raw) btns += '<a href="tel:' + raw + '" class="mini-btn" title="Ligar">📞</a>';
                if (ph.number) btns += '<button class="mini-btn" data-copy-txt="' + esc(ph.number) + '" title="Copiar número">📋</button>';
                return '<div class="pc-row">' +
                  '<span class="pc-phone">' + esc(ph.number || '') + '</span>' +
                  '<span class="pc-actions">' + btns + '</span>' +
                '</div>';
              }).join('')
            : '<div class="pc-row"><span class="pc-phone muted">Sem telefone</span></div>';

          var emailBtns = c.email
            ? '<span class="pc-actions">' +
                '<a href="mailto:' + esc(c.email) + '" class="mini-btn" title="Enviar e-mail">✉️ E-mail</a>' +
                '<button class="mini-btn" data-copy-txt="' + esc(c.email) + '" title="Copiar e-mail">📋 Copiar</button>' +
              '</span>'
            : '';

          return '<div class="contact-box">' +
            '<div class="pc-main">' +
              '<div class="pc-name">' + esc(c.name || ('Contato ' + (i + 1))) + '</div>' +
              (c.email ? '<div class="pc-email">' + esc(c.email) + '</div>' : '') +
            '</div>' +
            emailBtns +
            '<div class="pc-phones">' + phonesHtml + '</div>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhum contato cadastrado.</p>';

    var propsHtml = '';
    if (partnerProps.length) {
      propsHtml =
        '<div class="stat-grid" style="margin-bottom:16px">' +
          '<div class="stat-card"><div class="stat-ic">📋</div><div><div class="stat-num">' + commSummary.count + '</div><div class="stat-lbl">Propostas Vinculadas</div></div></div>' +
          '<div class="stat-card"><div class="stat-ic">💰</div><div><div class="stat-num">' + CRE.fmtBRL(commSummary.totalVolume) + '</div><div class="stat-lbl">Volume Total</div></div></div>' +
          '<div class="stat-card"><div class="stat-ic">🤝</div><div><div class="stat-num" style="color:var(--success)">' + CRE.fmtBRL(commSummary.totalCommissions) + '</div><div class="stat-lbl">Comissões Previstas</div></div></div>' +
        '</div>' +
        '<div style="max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius)">' +
        '<table class="table">' +
          '<thead><tr><th>Proposta</th><th>Papel</th><th>Status</th><th>Valor</th><th>Comissão / RT</th><th class="ta-right">Ação</th></tr></thead>' +
          '<tbody>' +
          partnerProps.map(function (pr) {
            var links = (pr.partners || []).filter(function (pt) { return pt.partnerId === p.id; });
            var roleBadges = links.map(function (pt) {
              var rInfo = D.PARTNER_ROLES[pt.role] || { label: pt.role, icon: '🤝' };
              return '<span class="pill pill-draft" style="font-size:0.75rem">' + rInfo.icon + ' ' + esc(rInfo.label) + '</span>';
            }).join(' ');

            var commValTotal = 0;
            var propTotal = CRE.proposalTotal(pr.layout);
            links.forEach(function (pt) {
              var v = Number(pt.commissionValue) || 0;
              if (pt.commissionType === 'percent') commValTotal += propTotal * (v / 100);
              else commValTotal += v;
            });

            return '<tr>' +
              '<td class="strong">' + esc(pr.name || 'Sem nome') + '</td>' +
              '<td>' + roleBadges + '</td>' +
              '<td>' + CRE.statusPill(pr.status) + '</td>' +
              '<td>' + CRE.fmtBRL(propTotal) + '</td>' +
              '<td style="font-weight:600;color:var(--success)">' + (commValTotal > 0 ? CRE.fmtBRL(commValTotal) : '—') + '</td>' +
              '<td class="ta-right"><button class="mini-btn primary" data-open-partner-prop="' + pr.id + '" title="Abrir proposta no editor">Abrir</button></td>' +
            '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>' +
        '</div>';
    } else {
      propsHtml = '<p class="muted">Nenhuma proposta vinculada a este parceiro ainda.</p>';
    }

    box.innerHTML =
      heroHtml +
      '<div class="client-detail-grid" style="margin-top:16px">' +
        '<div class="field-detail"><span>CNPJ <button class="copy-btn-inline" data-copy-partner-cnpj="' + esc(p.cnpj) + '" title="Copiar">📋</button></span><div>' + esc(p.cnpj || '—') + '</div></div>' +
        '<div class="field-detail"><span>Endereço <button class="copy-btn-inline" data-copy-txt="' + esc(p.address) + '" title="Copiar">📋</button></span><div>' + esc(p.address || '—') + '</div></div>' +
      '</div>' +
      '<hr style="margin:16px 0">' +
      '<p class="section-label">Contatos de Negócio (' + nContacts + ')</p>' +
      '<div class="contact-list">' + contactsHtml + '</div>' +
      '<hr style="margin:16px 0">' +
      '<p class="section-label">Contrato de Parceria</p>' +
      contractDisplay(p) +
      '<hr style="margin:16px 0">' +
      '<p class="section-label">Propostas Vinculadas (' + partnerProps.length + ')</p>' +
      propsHtml +
      '<div class="btn-row" style="margin-top:16px">' +
        '<button class="btn btn-secondary btn-sm" id="editPartnerBtn">✏️ Editar parceiro</button>' +
      '</div>';

    $('#editPartnerBtn').addEventListener('click', function () { openPartnerForm(p.id); });

    var dl = $('#partnerDetail [data-dl-contract]');
    if (dl) dl.addEventListener('click', function () { downloadContract(p.id); });

    $$('#partnerDetail [data-open-partner-prop]').forEach(function (b) {
      b.addEventListener('click', function () {
        openProposal(b.dataset.openPartnerProp);
      });
    });

    $$('#partnerDetail [data-copy-partner-cnpj]').forEach(function (b) {
      b.addEventListener('click', function () {
        CRE.copy(b.dataset.copyPartnerCnpj, 'CNPJ copiado!');
      });
    });

    $$('#partnerDetail [data-copy-txt]').forEach(function (b) {
      b.addEventListener('click', function () {
        CRE.copy(b.dataset.copyTxt, 'Copiado!');
      });
    });
  }

  function openPartnerForm(partnerId) {
    var p = partnerId ? D.findPartner(partnerId) : null;
    pfState = {
      _id: p ? p.id : null,
      name: p ? (p.name || '') : '',
      cnpj: p ? (p.cnpj || '') : '',
      address: p ? (p.address || '') : '',
      contacts: p && Array.isArray(p.contacts)
        ? JSON.parse(JSON.stringify(p.contacts))
        : [{ id: D.uid('pc'), name: '', email: '', phones: [{ id: D.uid('pp'), number: '' }] }],
      contract: p && p.contract ? JSON.parse(JSON.stringify(p.contract)) : null
    };
    pendingContract = null;
    PARTNER_FORM_OPEN = true;
    rerenderPartnerForm();
  }

  function rerenderPartnerForm() {
    CRE.openModal(pfState._id ? 'Editar parceiro' : 'Novo parceiro', buildPartnerForm());
    bindPartnerSave();
  }

  function buildPartnerForm() {
    var p = pfState;
    var html = '<label><span>Nome da empresa / parceiro</span><input type="text" id="pfName" class="input" value="' + esc(p.name || '') + '"></label>';
    html += '<label><span>CNPJ</span><input type="text" id="pfCnpj" class="input" value="' + esc(p.cnpj || '') + '" placeholder="00.000.000/0000-00"></label>';
    html += '<label><span>Endereço</span><input type="text" id="pfAddr" class="input" value="' + esc(p.address || '') + '"></label>';

    html += '<hr style="margin:12px 0">';
    html += '<p class="section-label">Contatos (' + (p.contacts || []).length + ')</p>';
    (p.contacts || []).forEach(function (c, i) { html += buildContactBlock(i); });
    html += '<button type="button" class="btn btn-sm btn-secondary" data-pf-act="add-contact" style="margin-top:8px">+ Adicionar contato</button>';

    html += '<hr style="margin:14px 0">';
    html += '<p class="section-label">Contrato de parceria</p>';
    html += buildContractField();

    html += '<div class="btn-row" style="justify-content:flex-end;margin-top:14px">' +
      '<button class="btn btn-secondary" id="pfCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="pfSave">' + (pfState._id ? 'Salvar' : 'Adicionar parceiro') + '</button>' +
      '</div>';
    return html;
  }

  function buildContactBlock(i) {
    var c = pfState.contacts[i] || {};
    var phones = Array.isArray(c.phones) ? c.phones : [];
    var html = '<div class="pf-contact">' +
      '<p class="pf-contact-tag">Contato ' + (i + 1) + '</p>' +
      '<label><span>Nome do contato</span><input type="text" class="input" data-pf-cname="' + i + '" value="' + esc(c.name || '') + '"></label>' +
      '<label><span>E-mail</span><input type="email" class="input" data-pf-cemail="' + i + '" value="' + esc(c.email || '') + '"></label>' +
      '<div class="pf-phones">';
    phones.forEach(function (ph, j) {
      html += '<label class="pf-phone"><span>Telefone ' + (j + 1) + '</span>' +
        '<div class="pf-phone-row">' +
        '<input type="text" class="input" data-pf-cphone="' + i + '" data-pf-phone="' + j + '" value="' + esc(ph.number || '') + '" placeholder="(11) 9 0000-0000">' +
        '<button type="button" class="mdl-x-btn" data-pf-act="del-phone" data-idx="' + i + '" data-phone="' + j + '" title="Excluir telefone">&#10005;</button>' +
        '</div></label>';
    });
    html += '</div>';
    html += '<div class="btn-row" style="justify-content:flex-start;margin-top:6px">' +
      '<button type="button" class="btn btn-sm btn-secondary" data-pf-act="add-phone" data-idx="' + i + '">+ Telefone</button>' +
      '<button type="button" class="btn btn-sm btn-danger" data-pf-act="del-contact" data-idx="' + i + '">Remover contato</button>' +
      '</div></div>';
    return html;
  }

  function buildContractField() {
    var c = pendingContract || ((pfState.contract && pfState.contract.dataUrl) ? pfState.contract : null);
    var html = '<input type="file" id="pfContractFile" class="pf-file-hide" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png">';
    if (c) {
      html += '<div class="contract-chip">' +
        '<span class="cc-icon">📄</span>' +
        '<span class="cc-main">' + esc(c.fileName || 'contrato') + '</span>' +
        '<span class="cc-sub">' + esc(contractSizeTxt(c)) + '</span>' +
        '<button type="button" class="mini-btn" data-pf-act="dl-contract" title="Baixar contrato">Baixar</button>' +
        '<button type="button" class="mini-btn danger" data-pf-act="rm-contract" title="Remover contrato">✕</button>' +
        '</div>';
    } else {
      html += '<button type="button" class="btn btn-sm btn-secondary" data-pf-act="pick-file">📎 Anexar contrato</button>';
    }
    html += '<p class="muted" style="margin:6px 0 0">Formatos: PDF, Word, JPG ou PNG (máx. ~3,5 MB).</p>';
    return html;
  }

  function readPartnerForm(st) {
    st = st || pfState;
    var nameEl = $('#pfName'), cnpjEl = $('#pfCnpj'), addrEl = $('#pfAddr');
    if (nameEl) st.name = nameEl.value;
    if (cnpjEl) st.cnpj = cnpjEl.value;
    if (addrEl) st.address = addrEl.value;
    (st.contacts || []).forEach(function (c, i) {
      var nEl = $('[data-pf-cname="' + i + '"]');
      var eEl = $('[data-pf-cemail="' + i + '"]');
      if (nEl) c.name = nEl.value;
      if (eEl) c.email = eEl.value;
      (c.phones || []).forEach(function (ph, j) {
        var el = $('[data-pf-cphone="' + i + '"][data-pf-phone="' + j + '"]');
        if (el) ph.number = el.value;
      });
    });
    return st;
  }

  function bindPartnerSave() {
    $('#pfCancel').addEventListener('click', function () {
      PARTNER_FORM_OPEN = false;
      CRE.closeModal();
    });
    $('#pfSave').addEventListener('click', function () {
      var st = readPartnerForm(pfState);
      var contract = pendingContract || ((st.contract && st.contract.dataUrl) ? st.contract : null);
      var data = {
        name: (st.name || '').trim(),
        cnpj: (st.cnpj || '').trim(),
        address: (st.address || '').trim(),
        contacts: (st.contacts || []).map(function (c) {
          return {
            id: c.id || D.uid('pc'),
            name: (c.name || '').trim(),
            email: (c.email || '').trim(),
            phones: (c.phones || []).map(function (ph) {
              return { id: ph.id || D.uid('pp'), number: (ph.number || '').trim() };
            })
          };
        }),
        contract: contract
      };
      var fields = [
        { key: 'pfName', label: 'Nome', value: data.name, type: 'string', required: true },
        { key: 'pfCnpj', label: 'CNPJ', value: data.cnpj, type: 'cnpj' }
      ];
      var errs = CRE_VALIDATORS.validate(fields);
      var errCount = 0;
      for (var ek in errs) { if (errs.hasOwnProperty(ek)) errCount++; }
      if (errCount > 0) {
        var root = $('.modal-content') || $('.modal');
        if (CRE_VALIDATORS.renderErrors) {
          var htmlErr = CRE_VALIDATORS.renderErrors(errs);
          var box = root ? root.querySelector('.cre-resumo-erros') : null;
          if (!box && root) {
            var dbox = document.createElement('div');
            dbox.className = 'cre-resumo-erros';
            root.insertBefore(dbox, root.firstChild);
            box = dbox;
          }
          if (box) box.innerHTML = htmlErr;
        }
        var firstKey = null;
        for (var fk in errs) { if (errs.hasOwnProperty(fk)) { firstKey = fk; break; } }
        if (firstKey) {
          var fel = $('#' + firstKey);
          if (fel) { fel.focus(); fel.classList.add('is-invalid'); }
        }
        return;
      }
      var saved = pfState._id ? D.updatePartner(pfState._id, data) : D.addPartner(data);
      var falha = falhaDeGravacao(saved);
      if (falha) {
        CRE.toast('Parceiro NÃO salvo: ' + falha, 'error');
        return;
      }
      selectedPartnerId = saved.id;
      PARTNER_FORM_OPEN = false;
      CRE.closeModal();
      CRE.toast(pfState._id ? 'Parceiro atualizado com sucesso!' : 'Novo parceiro cadastrado!', 'success');
      renderPartners();
    });
  }

  function initPartnerEvents() {
    var body = $('#appModalBody');

    body.addEventListener('click', function (e) {
      var el = e.target.closest('[data-pf-act]');
      if (!el || !PARTNER_FORM_OPEN) return;
      var act = el.dataset.pfAct;
      readPartnerForm(pfState);

      if (act === 'add-contact') {
        pfState.contacts.push({ id: D.uid('pc'), name: '', email: '', phones: [{ id: D.uid('pp'), number: '' }] });
        rerenderPartnerForm();
      } else if (act === 'del-contact') {
        var ci = parseInt(el.dataset.idx, 10);
        if (pfState.contacts.length > 1) pfState.contacts.splice(ci, 1);
        rerenderPartnerForm();
      } else if (act === 'add-phone') {
        var ai = parseInt(el.dataset.idx, 10);
        if (pfState.contacts[ai]) pfState.contacts[ai].phones.push({ id: D.uid('pp'), number: '' });
        rerenderPartnerForm();
      } else if (act === 'del-phone') {
        var di = parseInt(el.dataset.idx, 10);
        var pj = parseInt(el.dataset.phone, 10);
        if (pfState.contacts[di] && pfState.contacts[di].phones.length > 1) {
          pfState.contacts[di].phones.splice(pj, 1);
        }
        rerenderPartnerForm();
      } else if (act === 'pick-file') {
        var fi = $('#pfContractFile');
        if (fi) fi.click();
      } else if (act === 'rm-contract') {
        pendingContract = null;
        pfState.contract = null;
        rerenderPartnerForm();
      } else if (act === 'dl-contract') {
        downloadContract(pfState._id || selectedPartnerId, pendingContract);
      }
    });

    body.addEventListener('change', function (e) {
      if (!PARTNER_FORM_OPEN) return;
      if (e.target && e.target.id === 'pfContractFile') {
        var file = e.target.files[0];
        if (!file) return;
        if (file.size > CONTRACT_MAX) {
          CRE.toast('O arquivo excede o limite de ~3,5 MB do armazenamento local. Escolha um arquivo menor.', 'error');
          e.target.value = '';
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          pendingContract = { fileName: file.name, fileSize: file.size, type: file.type, dataUrl: reader.result };
          e.target.value = '';
          CRE.toast('Contrato carregado com sucesso!', 'success');
          rerenderPartnerForm();
        };
        reader.readAsDataURL(file);
      }
    });

    function closePartnerFormFlag() { PARTNER_FORM_OPEN = false; }

    $('#appModalClose').addEventListener('click', closePartnerFormFlag);
    $('#appModal').addEventListener('click', function (e) { if (e.target === $('#appModal')) closePartnerFormFlag(); });
  }

  /* ══════════════ CONFIGURAÇÕES ══════════════ */

  function renderSettings() {
    var cfg = D.getConfig();
    var f = cfg.footer || {};
    $('#cfgFooter1').value = f.line1 || '';
    $('#cfgFooter2').value = f.line2 || '';
    $('#cfgFooter3').value = f.line3 || '';
    $('#cfgHeaderImg').value = f.headerImg || '';
    $('#cfgGoal').value = cfg.monthlyGoal || '';

    var fisc = cfg.fiscal || {};
    if ($('#cfgFiscRazao')) $('#cfgFiscRazao').value = fisc.razaoSocial || '';
    if ($('#cfgFiscCnpj')) $('#cfgFiscCnpj').value = fisc.cnpj || '';
    if ($('#cfgFiscIe')) $('#cfgFiscIe').value = fisc.ie || '';
    if ($('#cfgFiscIm')) $('#cfgFiscIm').value = fisc.im || '';
    if ($('#cfgFiscCnae')) $('#cfgFiscCnae').value = fisc.cnae || '';
    if ($('#cfgFiscRegime')) $('#cfgFiscRegime').value = fisc.regime || '';
    if ($('#cfgFiscAddr')) $('#cfgFiscAddr').value = fisc.endereco || '';
    if ($('#cfgFiscCidade')) $('#cfgFiscCidade').value = fisc.cidade || '';
    if ($('#cfgFiscPhone')) $('#cfgFiscPhone').value = fisc.telefone || '';
    if ($('#cfgFiscEmail')) $('#cfgFiscEmail').value = fisc.email || '';

    renderTemplateList();
    renderInvoiceModels();
    renderInvoiceStatuses();
    renderAvisos();
  }

  function renderBackups() {
    var backs = D.getBackups();
    var html = backs.length
      ? backs.map(function (b) {
          var d = new Date(b.ts);
          var when = isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
          var nc = (b.data && b.data.clients) ? b.data.clients.length : 0;
          var np = (b.data && b.data.proposals) ? b.data.proposals.length : 0;
          return '<div class="template-item">' +
            '<span class="tm-name">🕘 ' + esc(when) + ' · ' + nc + ' clientes · ' + np + ' propostas</span>' +
            '<button class="mini-btn wide" data-restore-bk="' + b.id + '" title="Restaurar">Restaurar</button>' +
            '<button class="mini-btn danger" data-del-bk="' + b.id + '" title="Excluir">✕</button>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhum backup ainda. Os backups são criados automaticamente conforme você edita.</p>';

    CRE.openModal('Histórico de backups', html +
      '<div class="btn-row" style="justify-content:flex-end;margin-top:12px">' +
        '<button class="btn btn-secondary btn-sm" id="bkNew">+ Criar backup agora</button>' +
        '<button class="btn btn-primary btn-sm" id="bkClose">Fechar</button>' +
      '</div>');

    $('#bkClose').addEventListener('click', CRE.closeModal);
    $('#bkNew').addEventListener('click', function () {
      D.addBackup(true);
      renderBackups();
    });
    $$('#appModal [data-del-bk]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        D.deleteBackup(btn.dataset.delBk);
        renderBackups();
      });
    });
    $$('#appModal [data-restore-bk]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        CRE.confirm('Restaurar backup', 'Isso substituirá os dados atuais por este backup. Deseja continuar?', function () {
          var ok = D.restoreBackup(btn.dataset.restoreBk);
          if (ok) {
            if (global.CRE_EDITOR) global.CRE_EDITOR.refreshProposalSelect();
            selectedClientId = null;
            CRE.closeModal();
            renderDashboard();
            renderProposals();
            renderClients();
            renderSettings();
          } else {
            CRE.toast('Falha ao restaurar o backup.', 'error');
          }
        }, 'Restaurar');
      });
    });
  }

  function renderTemplateList() {
    var db = D.load();
    var box = $('#templateList');
    if (!box) return;
    box.innerHTML = db.templates.length
      ? db.templates.map(function (t) {
          return '<div class="template-item">' +
            '<span class="tm-name">📐 ' + esc(t.name) + '</span>' +
            '<button class="mini-btn" data-load-tm="' + t.id + '" title="Usar em nova proposta">+</button>' +
            '<button class="mini-btn danger" data-del-tm="' + t.id + '" title="Excluir">✕</button>' +
          '</div>';
        }).join('')
      : '<p class="muted">Nenhum modelo salvo. Use o botão <strong>Modelo</strong> na aba Layouts.</p>';

    $$('#templateList [data-del-tm]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var res = D.deleteTemplate(btn.dataset.delTm);
        var falha = falhaDeOperacao(res);
        if (falha) { CRE.toast('Modelo NÃO excluído: ' + falha, 'error'); return; }
        if (res && res.mensagem) { CRE.toast(res.mensagem, 'info'); }
        else { CRE.toast('Modelo excluído.', 'info'); }
        renderTemplateList();
      });
    });
    $$('#templateList [data-load-tm]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = db.templates.find(function (x) { return x.id === btn.dataset.loadTm; });
        if (!t) return;
        var prop = D.addProposal({
          name: 'Proposta (' + t.name + ')',
          layout: JSON.parse(JSON.stringify(t.layout || D.defaultLayout()))
        });
        var falha = falhaDeGravacao(prop);
        if (falha) {
          CRE.toast(falha, 'error');
          return;
        }
        if (global.CRE_EDITOR) global.CRE_EDITOR.refreshProposalSelect();
        CRE.toast('Proposta criada com sucesso!', 'success');
        openProposal(prop.id);
      });
    });
  }

  function initSettingsEvents() {
    $('#cfgSaveFooter').addEventListener('click', function () {
      D.updateConfig({
        footer: {
          line1: $('#cfgFooter1').value,
          line2: $('#cfgFooter2').value,
          line3: $('#cfgFooter3').value,
          headerImg: $('#cfgHeaderImg').value
        },
        monthlyGoal: parseFloat($('#cfgGoal').value) || 0
      });
      /* updateConfig não devolve o resultado do save: o sinal é o flag de
         sujeira do módulo de dados (save() limpa ao concluir). */
      var falha = falhaDeGravacao();
      CRE.toast(falha ? 'Configurações NÃO salvas: ' + falha : 'Rodapé e meta do mês salvos com sucesso!', falha ? 'error' : 'success');
      renderDashboard();
    });

    var fisBtn = $('#cfgSaveFiscal');
    if (fisBtn) {
      fisBtn.addEventListener('click', function () {
        D.updateConfig({
          fiscal: {
            razaoSocial: $('#cfgFiscRazao').value,
            cnpj: $('#cfgFiscCnpj').value,
            ie: $('#cfgFiscIe').value,
            im: $('#cfgFiscIm').value,
            cnae: $('#cfgFiscCnae').value,
            regime: $('#cfgFiscRegime').value,
            endereco: $('#cfgFiscAddr').value,
            cidade: $('#cfgFiscCidade').value,
            telefone: $('#cfgFiscPhone').value,
            email: $('#cfgFiscEmail').value
          }
        });
        var falhaFisc = falhaDeGravacao();
        CRE.toast(falhaFisc
          ? 'Dados fiscais NÃO salvos: ' + falhaFisc
          : 'Dados fiscais da empresa atualizados com sucesso!',
        falhaFisc ? 'error' : 'success');
      });
    }

    var newImBtn = $('#btnNewInvoiceModel');
    if (newImBtn) newImBtn.addEventListener('click', function () { openInvoiceModelForm(null); });

    var addStBtn = $('#btnAddInvoiceStatus');
    if (addStBtn) {
      addStBtn.addEventListener('click', function () {
        var input = $('#newInvoiceStatus');
        var res = D.addInvoiceStatus(input ? input.value : '');
        if (res && res.error) { CRE.toast(res.error, 'error'); return; }
        var falha = falhaDeGravacao();
        if (falha) { CRE.toast('Status NÃO salvo: ' + falha, 'error'); return; }
        if (input) input.value = '';
        renderInvoiceStatuses();
      });
    }

    var bkBtn = $('#cfgBackups');
    if (bkBtn) bkBtn.addEventListener('click', renderBackups);

    $('#cfgExportAll').addEventListener('click', function () {
      download('georevest-studio-backup-' + new Date().toISOString().slice(0, 10) + '.json', D.exportAll());
    });

    $('#cfgImportAll').addEventListener('click', function () { $('#appImportAll').click(); });

    $('#appImportAll').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var ok = D.importAll(reader.result);
        var rep = D.lastImportReport ? D.lastImportReport() : null;
        if (ok) {
          /* importAll devolve true mesmo quando o gravador recusou: o
             relatório diz se os dados entraram no disco ou só na tela. */
          var gravou = rep && rep.gravacao ? rep.gravacao.ok !== false : !D.isDirty();
          if (global.CRE_EDITOR) global.CRE_EDITOR.refreshProposalSelect();
          renderSettings();
          renderProposals();
          renderDashboard();
          if (gravou) CRE.toast((rep && rep.mensagem) || 'Dados importados com sucesso!', 'success');
          else CRE.toast((rep && rep.mensagem) || 'Importado, mas a gravação falhou.', 'error');
        } else {
          CRE.toast((rep && rep.mensagem) || 'Arquivo inválido.', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('#cfgReset').addEventListener('click', function () {
      CRE.confirm('Restaurar dados',
        'Isso substituirá todos os dados atuais pelos dados de exemplo. Deseja continuar?',
        function () {
          D.reset();
          var falha = falhaDeGravacao();
          if (falha) CRE.toast('Restauração NÃO gravada: ' + falha, 'error');
          else CRE.toast('Dados de exemplo restaurados.', 'info');
          if (global.CRE_EDITOR) global.CRE_EDITOR.refreshProposalSelect();
          selectedClientId = null;
          renderDashboard();
          renderProposals();
          renderClients();
          renderSettings();
          CRE.switchTab('dashboard');
        }, 'Restaurar');
    });
  }

  /* ══════════════ Wire up ══════════════ */

  function on(id, evt, handler) {
    var el = typeof id === 'string' ? $(id.charAt(0) === '#' ? id : '#' + id) : id;
    if (el) el.addEventListener(evt, handler);
  }

  on('propSearch', 'input', renderProposals);
  on('propStatusFilter', 'change', renderProposals);
  on('btnCreateProposal', 'click', createProposal);
  on('btnNewProposalQuick', 'click', createProposal);
  on('dashNewProposal', 'click', createProposal);
  on('qaNewProp', 'click', createProposal);

  on('btnAddClient', 'click', function () { openClientForm(null); });
  on('dashNewClient', 'click', function () { openClientForm(null); });
  on('qaNewClient', 'click', function () { openClientForm(null); });
  on('clientSearch', 'input', renderClients);

  on('btnAddPartner', 'click', function () { openPartnerForm(null); });
  on('partnerSearch', 'input', renderPartners);

  on('btnNewInvoice', 'click', openInvoiceFromScratch);
  on('qaNewInv', 'click', openInvoiceFromScratch);
  on('qaOpenEditor', 'click', function () { CRE.switchTab('editor'); });

  on('invSearch', 'input', renderInvoices);
  on('invStatusFilter', 'change', renderInvoices);
  on('invPayFilter', 'change', renderInvoices);

  $$('#dashPeriodTabs [data-dash-period]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      dashPeriod = btn.dataset.dashPeriod;
      try { localStorage.setItem('georevest-dash-period', dashPeriod); } catch (e) { /* silent */ }
      renderDashboard();
    });
  });

  initSettingsEvents();
  initPartnerEvents();
  initInvoiceEvents();

  global.CRE_MODULES = {
    renderDashboard: renderDashboard,
    renderProposals: renderProposals,
    renderInvoices: renderInvoices,
    renderClients: renderClients,
    renderPartners: renderPartners,
    renderSettings: renderSettings,
    createProposal: createProposal,
    openProposalModal: openProposalModal,
    openClientForm: openClientForm,
    openPartnerForm: openPartnerForm,
    openInvoiceList: openInvoiceList
  };

  renderDashboard();

})(window);