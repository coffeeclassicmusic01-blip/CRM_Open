/* ============================================================
   GEOREVEST STUDIO — editor.js
   Editor de propostas (portado de CRM_Layout) expandido com:
   - Ribbon estilo Word (fonte, parágrafo, inserir, edição)
   - Cor do texto / realce, listas, recuo, link, imagem, tabela
   - Tamanho de papel (A4/Carta) e orientação (retrato/paisagem)
   - Zoom, contagem de palavras e localizar / substituir
   - Persistência vinculada à proposta ativa do CRM
   ============================================================ */

(function (global) {
  'use strict';

  var data = global.CRE_DATA;

  /* ── Constantes ──────────────────────────── */

  var HEADER_H = 35;                       /* altura do cabeçalho fixo (mm) */
  var PAGE = { width: 210, height: 297 };  /* dimensões atuais ajustadas */
  var DEFAULT_ZOOM = 100;

  var BLOCK_TYPES = {
    cover:       { label: 'Capa',              icon: '📄' },
    commercial:  { label: 'Proposta Comercial', icon: '💰' },
    custom:      { label: 'Bloco Livre',        icon: '📝' }
  };

  var FONT_SIZES = { 1: '8pt', 2: '10pt', 3: '12pt', 4: '14pt', 5: '18pt', 6: '24pt', 7: '36pt' };

  /* ── Estado ──────────────────────────────── */

  var state = null;
  var _snapshotLock = false;      /* true = builders renderam no modo leitura */
  var _snapshotRev = 0;           /* revisão exibida no badge da capa no snapshot */
  var _snapshotMargins = null;    /* margens do layout do snapshot (para buildClients) */
  var _cmpRev = null;             /* revisão atual usada no comparador (p/ propostas não-ativas) */

  function ensureState() {
    if (!state) state = { blocks: [], footer: {}, margins: {}, paper: { size: 'A4', orientation: 'portrait' }, zoom: DEFAULT_ZOOM };
    if (!state.footer) state.footer = {};
    var f = data.defaultFooter();
    if (state.footer.line1 === undefined) state.footer.line1 = f.line1;
    if (state.footer.line2 === undefined) state.footer.line2 = f.line2;
    if (state.footer.line3 === undefined) state.footer.line3 = f.line3;
    if (state.footer.headerImg === undefined) state.footer.headerImg = f.headerImg;
    if (!state.margins) state.margins = { top: 0, right: 20, bottom: 0, left: 20 };
    ['top', 'right', 'bottom', 'left'].forEach(function (k) {
      if (state.margins[k] === undefined) state.margins[k] = 0;
    });
    if (!state.paper) state.paper = { size: 'A4', orientation: 'portrait' };
    if (!state.paper.size) state.paper.size = 'A4';
    if (!state.paper.orientation) state.paper.orientation = 'portrait';
    if (!state.zoom) state.zoom = DEFAULT_ZOOM;
    (state.blocks || []).forEach(function (b) {
      if (!b || !b.data) return;
      if (!Array.isArray(b.data.extras)) b.data.extras = [];
      if (!Array.isArray(b.hidden)) b.hidden = [];
      b.data.formatted = b.data.formatted || {};
    });
  }

  /* ── Undo / Redo ─────────────────────────── */

  var undoStack = [];
  var redoStack = [];
  var HISTORY_LIMIT = 100;

  function pushHistory() {
    var snap = JSON.stringify(state);
    if (undoStack[undoStack.length - 1] === snap) return;
    undoStack.push(snap);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function applySnapshot(snap) {
    closeModal();
    state = JSON.parse(snap);
    ensureState();
    loadFooterInputs();
    applyPaper();
    saveToStorage();
    render();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state));
    applySnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state));
    applySnapshot(redoStack.pop());
  }

  function updateHistoryButtons() {
    var u = $('#btnUndo');
    var r = $('#btnRedo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  /* ── Registro de campos ──────────────────── */

  var _fieldCounter = 0;
  var fieldSetters = {};
  var imageResizeSetters = {};
  var moveSetters = {};

  function fieldId() { return 'f' + (++_fieldCounter); }

  function reg(el, setter, label) {
    var id = fieldId();
    el.setAttribute('data-field-id', id);
    fieldSetters[id] = setter;
    if (label && document.body) {
      el.setAttribute('role', 'textbox');
      el.setAttribute('aria-label', label);
      if (MULTILINE_TAG.test(el.tagName)) el.setAttribute('aria-multiline', 'true');
      var hint = ensureEditHint();
      if (hint) el.setAttribute('aria-describedby', hint.id);
    }
    return id;
  }

  /* ── Helpers ─────────────────────────────── */

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.from((c || document).querySelectorAll(s)); };

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  function toText(v) {
    var d = document.createElement('div');
    d.innerHTML = v == null ? '' : String(v);
    return d.textContent || d.innerText || '';
  }

  function rich(set, d, key) {
    return function (v) {
      var html = String(v || '');
      var txt = toText(html).replace(/\s+/g, ' ').trim();
      set(txt);
      if (!d.formatted) d.formatted = {};
      if (html.indexOf('<') !== -1 && txt) d.formatted[key] = html;
      else delete d.formatted[key];
    };
  }

  function clearFmtOnChange(d, fk, plainVal) {
    if (!d || !d.formatted || !fk) return;
    var fhtml = d.formatted[fk];
    if (fhtml === undefined) return;
    if (toText(fhtml) === plainVal) return;
    delete d.formatted[fk];
    if (!Object.keys(d.formatted).length) d.formatted = {};
  }

  function rebaseFormatted(d, prefix, arrLen) {
    if (!d || !d.formatted) return;
    var next = {};
    for (var k in d.formatted) {
      if (k.indexOf(prefix) === 0) {
        var i = parseInt(k.slice(prefix.length), 10);
        if (i >= 0 && i < arrLen) next[prefix + i] = d.formatted[k];
      } else {
        next[k] = d.formatted[k];
      }
    }
    d.formatted = next;
  }

  function rebaseFromPath(block, path) {
    var prefix = null;
    var arr = mdlArray(block, path);
    if (!arr) return;
    if (path === 'paragraphs') prefix = 'para_';
    else if (path === 'contractorItems') prefix = 'ci_';
    else if (path === 'clientItems') prefix = 'cli_';
    else if (path === 'bank.lines') prefix = 'bank_';
    else return;
    rebaseFormatted(block.data, prefix, arr.length);
  }

  function genId() {
    return 'b' + Date.now().toString(36) + '_' + (++_fieldCounter);
  }

  function isHidden(block, key) {
    return Array.isArray(block.hidden) && block.hidden.indexOf(key) !== -1;
  }

  function mm2px(mm) { return mm * 96 / 25.4; }
  function px2mm(px) { return px * 25.4 / 96; }
  function zFx() { return (state.zoom || DEFAULT_ZOOM) / 100; }

  /* ── Acessibilidade (JS) ─────────────────── */

  var editHintEl = null;
  var liveRegionEl = null;
  var announceTimer = null;

  /* Tags de conteúdo multilinha: o texto visível muda a cada render,
     então o nome acessível vem do rótulo do campo, nunca do conteúdo. */
  var MULTILINE_TAG = /^(P|DIV|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE)$/;

  function srOnly(el) {
    el.style.position = 'absolute';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.overflow = 'hidden';
    el.style.clip = 'rect(0 0 0 0)';
    el.style.clipPath = 'inset(50%)';
    el.style.whiteSpace = 'nowrap';
    el.style.border = '0';
    el.style.padding = '0';
    el.style.margin = '-1px';
    return el;
  }

  function ensureEditHint() {
    if (editHintEl && editHintEl.parentNode) return editHintEl;
    if (!document.body) return null;
    editHintEl = srOnly(document.createElement('span'));
    editHintEl.id = 'editorEditHint';
    editHintEl.className = 'sr-only';
    editHintEl.textContent = 'Campo de texto editável. O conteúdo é gravado ao sair do campo; use Tab para avançar para o próximo controle.';
    document.body.appendChild(editHintEl);
    return editHintEl;
  }

  function ensureLiveRegion() {
    if (liveRegionEl && liveRegionEl.parentNode) return liveRegionEl;
    if (!document.body) return null;
    liveRegionEl = srOnly(document.createElement('div'));
    liveRegionEl.id = 'editorLiveRegion';
    liveRegionEl.className = 'sr-only';
    liveRegionEl.setAttribute('role', 'status');
    liveRegionEl.setAttribute('aria-live', 'polite');
    liveRegionEl.setAttribute('aria-atomic', 'true');
    document.body.appendChild(liveRegionEl);
    return liveRegionEl;
  }

  /* Instrução compartilhada pelos itens da barra lateral: o nome
     acessível é "Bloco 3 de 7: X", a instrução vai em descrição. */
  var moveHintEl = null;

  function ensureMoveHint() {
    if (moveHintEl && moveHintEl.parentNode) return moveHintEl;
    if (!document.body) return null;
    moveHintEl = srOnly(document.createElement('span'));
    moveHintEl.id = 'editorMoveHint';
    moveHintEl.className = 'sr-only';
    moveHintEl.textContent = 'Enter rola até a página, F2 abre a edição do bloco, Alt com as setas para cima e para baixo move o bloco na lista.';
    document.body.appendChild(moveHintEl);
    return moveHintEl;
  }

  /* Limpa antes de escrever: região viva só relê se o texto mudar. */
  function announce(msg) {
    var el = ensureLiveRegion();
    if (!el) return;
    el.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { el.textContent = msg; }, 60);
  }

  /* O scroll suave é JS e passa por cima do prefers-reduced-motion
     que o tokens.css já aplica nas transições de CSS. */
  function scrollBehavior() {
    try {
      if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'auto';
    } catch (e) { /* sem matchMedia: mantém o comportamento padrão */ }
    return 'smooth';
  }

  /* ── Foco dos overlays (#modalOverlay, #findOverlay) ────────
     O app.js não faz focus trap e, no Escape, remove a classe
     .open direto do overlay (fora de closeModal). Por isso o
     encerramento é observado pela classe, e não só por uma
     chamada explícita de closeModal. */

  var overlayTrap = { container: null, returnTo: null, returnSelector: null, handler: null, observer: null };

  var FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], ' +
    '[tabindex]:not([tabindex="-1"])';

  function focusableWithin(root) {
    if (!root) return [];
    return $$(FOCUSABLE_SEL, root).filter(function (el) {
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
    });
  }

  function releaseOverlayTrap(skipRestore) {
    if (overlayTrap.handler) document.removeEventListener('keydown', overlayTrap.handler, true);
    if (overlayTrap.observer) overlayTrap.observer.disconnect();
    var back = overlayTrap.returnTo;
    var sel = overlayTrap.returnSelector;
    overlayTrap.handler = null;
    overlayTrap.observer = null;
    overlayTrap.container = null;
    overlayTrap.returnTo = null;
    overlayTrap.returnSelector = null;
    if (skipRestore) return;
    if (back && back.focus && document.contains(back)) { back.focus(); return; }
    /* O render() pode ter destruído o elemento de origem (itens da
       barra lateral são recriados): volta pelo seletor. */
    if (sel) {
      var alt = document.querySelector(sel);
      if (alt && alt.focus) alt.focus();
    }
  }

  function trapOverlay(container, initialFocus, returnSelector) {
    if (!container) return;
    releaseOverlayTrap(true);
    overlayTrap.container = container;
    overlayTrap.returnTo = document.activeElement;
    overlayTrap.returnSelector = returnSelector || null;

    overlayTrap.handler = function (e) {
      if (e.key !== 'Tab') return;
      var list = focusableWithin(container);
      if (!list.length) { e.preventDefault(); return; }
      var first = list[0], last = list[list.length - 1];
      var cur = document.activeElement;
      if (e.shiftKey) {
        if (cur === first || !container.contains(cur)) { e.preventDefault(); last.focus(); }
      } else {
        if (cur === last || !container.contains(cur)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', overlayTrap.handler, true);

    if (global.MutationObserver) {
      overlayTrap.observer = new global.MutationObserver(function () {
        if (!container.classList.contains('open')) releaseOverlayTrap(false);
      });
      overlayTrap.observer.observe(container, { attributes: true, attributeFilter: ['class'] });
    }

    var target = (initialFocus && container.contains(initialFocus)) ? initialFocus : focusableWithin(container)[0];
    if (target && target.focus) target.focus();
  }

  /* ── DOM refs ────────────────────────────── */

  var docEl, blockListEl, overlayEl, modalTitleEl, modalBodyEl;
  var footerLine1El, footerLine2El, footerLine3El, headerImgEl;
  var paperSizeEl, paperOrientEl, zoomInputEl;
  var proposalSelectEl, sbProposalNameEl, sbZoomEl, sbWordsEl, sbPageEl, sbPaperEl, sbAutosaveEl, sbRevisionEl;
  var revBannerEl, revBannerNoteEl, btnUnlockRevEl;
  var btnSaveProposalEl, btnDiscardChangesEl, etDirtyDotEl;
  var printStyleEl;
  var activeEditable = null;
  var savedRange = null;
  var selectedBlockId = null;

  /* ── Dirty tracking (manual save) ────────── */

  var isDirty = false;
  var cleanSnapshot = null; /* JSON string of last-saved state */

  function markDirty() {
    if (!isDirty) {
      isDirty = true;
      if (btnSaveProposalEl)    btnSaveProposalEl.disabled    = false;
      if (btnDiscardChangesEl)  btnDiscardChangesEl.disabled  = false;
      if (etDirtyDotEl)         etDirtyDotEl.classList.add('visible');
      announce('Alterações não salvas.');
    }
    scheduleAutosave();
  }

  function clearDirty() {
    var wasDirty = isDirty;
    isDirty = false;
    cleanSnapshot = JSON.stringify(state);
    if (btnSaveProposalEl)    btnSaveProposalEl.disabled    = true;
    if (btnDiscardChangesEl)  btnDiscardChangesEl.disabled  = true;
    if (etDirtyDotEl)         etDirtyDotEl.classList.remove('visible');
    if (wasDirty) announce('Alterações salvas.');
  }

  /* ── Autosave ─────────────────────────────── */

  var AUTOSAVE_DELAY = 4000;
  var autosaveTimer = null;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function updateAutosaveStamp() {
    if (!sbAutosaveEl) return;
    var d = new Date();
    sbAutosaveEl.textContent = 'Salvo às ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function isProposalApproved() {
    if (_snapshotLock) return true;
    var prop = getActiveProposal();
    return !!(prop && prop.status === 'approved');
  }

  function commercialFingerprint(layout) {
    var parts = [];
    (layout.blocks || []).forEach(function (b) {
      if (b && b.type === 'commercial') {
        parts.push(JSON.stringify(b.data.cols || []));
        (b.data.rows || []).forEach(function (r) { parts.push(JSON.stringify(r)); });
        parts.push(b.data.showTotal === false ? 'nt' : 't');
        (b.data.extras || []).forEach(function (ex) {
          if (ex && ex.type === 'table') {
            parts.push('X:' + JSON.stringify(ex.cols || []));
            (ex.rows || []).forEach(function (r) { parts.push(JSON.stringify(r)); });
            parts.push(ex.showTotal === false ? 'nt' : 't');
          }
        });
      }
    });
    return parts.join('|');
  }

  function currentBudgetTotal() {
    return (global.CRE && global.CRE.proposalTotal) ? (global.CRE.proposalTotal(state) || 0) : 0;
  }

  function capRevisions(list, max) {
    if (!Array.isArray(list)) return [];
    max = max || 25;
    var approved = list.filter(function (r) { return r && (r.status === 'approved' || r.locked); });
    var others = list.filter(function (r) { return !(r && (r.status === 'approved' || r.locked)); });
    var recent = others.slice(-Math.max(0, max - approved.length));
    var merged = approved.concat(recent).sort(function (a, b) { return (a.rev || 0) - (b.rev || 0); });
    return merged.slice(0, max * 2);
  }

  function revisionRecord(note) {
    return {
      rev: 0,
      date: new Date().toISOString(),
      total: Math.round(currentBudgetTotal() * 100) / 100,
      status: (getActiveProposal() || {}).status || 'draft',
      note: note || '',
      layout: JSON.parse(JSON.stringify(state || {}))
    };
  }

  function trackBudgetRevision(prop) {
    if (!prop || !state) return;
    var fp = commercialFingerprint(state);
    var prev = prop._budgetFp;
    if (prev === undefined) {
      data.updateProposal(prop.id, { _budgetFp: fp });
      return;
    }
    if (fp === prev) return;
    var rev = (prop.revision || 1) + 1;
    var list = Array.isArray(prop.revisions) ? prop.revisions.slice() : [];
    var rec = revisionRecord('Alteração na tabela de valores');
    rec.rev = rev;
    list.push(rec);
    data.updateProposal(prop.id, { revision: rev, revisions: capRevisions(list), _budgetFp: fp });
  }

  function formatRevDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function updateRevisionNote(prop, revNo, note) {
    if (!prop || !Array.isArray(prop.revisions)) return;
    var list = prop.revisions.slice();
    for (var i = 0; i < list.length; i++) {
      if (list[i].rev === revNo) { list[i].note = note; break; }
    }
    data.updateProposal(prop.id, { revisions: list });
  }

  function findRevision(prop, revNo) {
    var list = Array.isArray(prop && prop.revisions) ? prop.revisions : [];
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].rev === revNo) return list[i];
    }
    return null;
  }

  function createManualRevision(note) {
    var prop = getActiveProposal();
    if (!prop || !state) return false;
    if (prop.status === 'approved') return false;
    pushHistory();
    var rev = (prop.revision || 1) + 1;
    var list = Array.isArray(prop.revisions) ? prop.revisions.slice() : [];
    var rec = revisionRecord(note || '');
    rec.rev = rev;
    list.push(rec);
    data.updateProposal(prop.id, {
      revision: rev,
      revisions: capRevisions(list),
      _budgetFp: commercialFingerprint(state)
    });
    render();
    updateStatusBar();
    updateRevUI();
    return true;
  }

  function duplicateRevision(revNo, prop) {
    var external = arguments.length > 1;
    if (typeof prop === 'string') prop = data.getProposal(prop);
    prop = prop || getActiveProposal();
    if (!prop) return false;
    var item = findRevision(prop, revNo);
    if (!item || !item.layout) return false;
    var rev = (prop.revision || 1) + 1;
    var nl = Array.isArray(prop.revisions) ? prop.revisions.slice() : [];
    var rec = revisionRecord('Cópia da Rev ' + revNo);
    rec.rev = rev;
    rec.status = 'draft';
    rec.layout = item.layout;
    nl.push(rec);
    data.updateProposal(prop.id, { revision: rev, revisions: capRevisions(nl) });
    if (!external) {
      updateStatusBar();
      updateRevUI();
    }
    return true;
  }

  function exportHistory(prop) {
    if (typeof prop === 'string') prop = data.getProposal(prop);
    prop = prop || getActiveProposal();
    if (!prop) return;
    var payload = {
      proposal: prop.name || 'Proposta',
      id: prop.id,
      status: prop.status || 'draft',
      currentRevision: prop.revision || 1,
      exportedAt: new Date().toISOString(),
      revisions: Array.isArray(prop.revisions) ? prop.revisions : []
    };
    var name = (prop.name || 'proposta').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name + '-historico-revisoes.json';
    a.click();
    URL.revokeObjectURL(url);
    if (global.CRE && global.CRE.toast) global.CRE.toast('Histórico de revisões exportado.', 'success');
  }

  function openNewRevisionModal() {
    var prop = getActiveProposal();
    if (!prop) return;
    if (prop.status === 'approved') {
      if (global.CRE && global.CRE.toast) global.CRE.toast('A proposta está aprovada. Gere uma nova revisão para liberar a edição.', 'warning');
      return;
    }
    modalTitleEl.textContent = 'Nova Revisão — ' + (prop.name || 'Proposta');
    modalBodyEl.innerHTML =
      '<p style="font-size:12px;color:var(--muted);margin:0 0 10px">Registra um marco manual sem alterar o conteúdo atual (atual: Rev ' + (prop.revision || 1) + ').</p>' +
      '<label><span>Observação desta revisão</span><textarea id="newRevNote" class="input" rows="3" placeholder="Ex.: Orçamento validado com o cliente…"></textarea></label>' +
      '<div class="btn-row">' +
        '<button class="btn btn-secondary" id="modalCancelBtn3">Cancelar</button>' +
        '<button class="btn btn-primary" id="newRevConfirm">Criar Revisão</button>' +
      '</div>';
    openModal();
    $('#newRevConfirm', modalBodyEl).addEventListener('click', function () {
      var note = $('#newRevNote', modalBodyEl).value;
      closeModal();
      if (createManualRevision(note)) {
        if (global.CRE && global.CRE.toast) global.CRE.toast('Nova revisão criada.', 'success');
      } else {
        if (global.CRE && global.CRE.toast) global.CRE.toast('Não foi possível criar a revisão.', 'error');
      }
    });
    $('#modalCancelBtn3', modalBodyEl).addEventListener('click', closeModal);
  }

  function openCompareModal(prop, prefillRev) {
    if (typeof prop === 'string') prop = data.getProposal(prop);
    if (typeof prop === 'number') { prefillRev = prop; prop = undefined; }
    prop = prop || getActiveProposal();
    if (!prop) return;
    _cmpRev = prop.revision || 1;
    var isActive = prop === getActiveProposal();
    var list = (Array.isArray(prop.revisions) ? prop.revisions.slice() : []).sort(function (a, b) { return (a.rev || 0) - (b.rev || 0); });
    var cur = (prop.revision || 1);
    var refs = [{ rev: 0, label: 'Atual — Rev ' + cur }];
    list.forEach(function (r) {
      refs.push({ rev: r.rev, label: 'Rev ' + r.rev + ' — ' + formatRevDate(r.date) });
    });
    function opts(sel) {
      return refs.map(function (r) {
        return '<option value="' + r.rev + '"' + (r.rev === sel ? ' selected' : '') + '>' + esc(r.label) + '</option>';
      }).join('');
    }
    var defA = 0;
    var defB = (prefillRev !== undefined && prefillRev !== null) ? prefillRev : (list.length ? list[list.length - 1].rev : 0);
    var curTotal = isActive ? currentBudgetTotal() : (global.CRE.proposalTotal(prop.layout) || 0);
    var curLayout = isActive ? state : (prop.layout || data.defaultLayout());
    modalTitleEl.textContent = 'Comparar Revisões — ' + (prop.name || 'Proposta');
    modalBodyEl.innerHTML =
      '<div class="rev-cmp-row">' +
        '<label><span>Revisão A</span><select id="cmpA" class="input">' + opts(defA) + '</select></label>' +
        '<label><span>Revisão B</span><select id="cmpB" class="input">' + opts(defB) + '</select></label>' +
      '</div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="cmpRun">Comparar</button></div>' +
      '<div id="cmpResult"></div>';
    openModal();
    $('#cmpA', modalBodyEl).addEventListener('change', renderCmp);
    $('#cmpB', modalBodyEl).addEventListener('change', renderCmp);
    $('#cmpRun', modalBodyEl).addEventListener('click', renderCmp);
    function renderCmp() {
      var selA = parseInt(($('#cmpA', modalBodyEl) || {}).value, 10);
      var selB = parseInt(($('#cmpB', modalBodyEl) || {}).value, 10);
      var a = isNaN(selA) ? 0 : selA;
      var b = isNaN(selB) ? 0 : selB;
      var ra = { rev: a, total: a === 0 ? (curTotal || 0) : 0, layout: a === 0 ? curLayout : null };
      var rb = { rev: b, total: b === 0 ? (curTotal || 0) : 0, layout: b === 0 ? curLayout : null };
      list.forEach(function (r) {
        if (r.rev === a) { ra.total = r.total || 0; ra.layout = r.layout || null; }
        if (r.rev === b) { rb.total = r.total || 0; rb.layout = r.layout || null; }
      });
      $('#cmpResult', modalBodyEl).innerHTML = buildCompareHTML(ra, rb);
    }
    renderCmp();
  }

  function compareTarget(ref) {
    if (!ref) return null;
    var layout = ref.layout || state;
    var blocks = (layout && layout.blocks) || [];
    var order = [];
    var com = null;
    var extras = [];
    blocks.forEach(function (b) {
      if (!b) return;
      order.push(b.type);
      if (!b.data) return;
      if (b.type === 'commercial') com = b.data;
      (b.data.extras || []).forEach(function (ex) { if (ex) extras.push(ex); });
    });
    return {
      revLabel: ref.rev === 0 ? 'Atual (Rev ' + (_cmpRev !== null ? _cmpRev : (getActiveProposal() || {}).revision) + ')' : 'Rev ' + ref.rev,
      revNo: ref.rev,
      total: ref.total || 0,
      order: order,
      com: com,
      extras: extras
    };
  }

  function countExtras(extras) {
    var c = { text: 0, image: 0, table: 0 };
    extras.forEach(function (e) { if (c[e.type] !== undefined) c[e.type]++; });
    return c;
  }

  function cellState(rows, ri, ci) {
    if (!rows || ri >= rows.length) return { v: '', absent: true };
    var r = rows[ri];
    if (!r || ci >= r.length) return { v: '', absent: true };
    return { v: r[ci] == null ? '' : String(r[ci]), absent: false };
  }

  function buildCompareHTML(ra, rb) {
    var ta = compareTarget(ra);
    var tb = compareTarget(rb);
    if (!ta || !tb) return '<p style="color:var(--muted);font-size:13px">Selecione duas revisões para comparar.</p>';
    var html = '';
    var delta = Math.round((tb.total - ta.total) * 100) / 100;
    var dc = delta > 0 ? 'delta-up' : (delta < 0 ? 'delta-down' : 'delta-same');
    var dt = delta === 0 ? 'R$ 0,00' : (delta > 0 ? '+' : '−') + global.CRE.fmtBRL(Math.abs(delta));
    html += '<div class="cmp-summary">' +
      '<div class="cmp-row"><span>' + esc(ta.revLabel) + '</span><span class="ta-right">' + global.CRE.fmtBRL(ta.total) + '</span></div>' +
      '<div class="cmp-row"><span>' + esc(tb.revLabel) + '</span><span class="ta-right">' + global.CRE.fmtBRL(tb.total) + '</span></div>' +
      '<div class="cmp-row cmp-delta"><span>Δ Total</span><span class="ta-right ' + dc + '">' + dt + '</span></div>' +
      '</div>';
    var ao = (ta.order || []).join(' → ');
    var bo = (tb.order || []).join(' → ');
    if (ao !== bo) {
      html += '<div class="cmp-note">Estrutura do documento mudou:<br><em>Rev A:</em> ' + esc(ao) + '<br><em>Rev B:</em> ' + esc(bo) + '</div>';
    }
    html += commercialDiffHTML(ta, tb);
    html += extrasDiffHTML(ta, tb);
    return html;
  }

  function tableDiffHTML(ca, cb, label) {
    var colsA = (ca && ca.cols) || [], rowsA = (ca && ca.rows) || [];
    var colsB = (cb && cb.cols) || [], rowsB = (cb && cb.rows) || [];
    var nCols = Math.max(colsA.length, colsB.length);
    var nRows = Math.max(rowsA.length, rowsB.length);
    if (!nCols && !nRows) return null;
    var head = '<thead><tr><th class="diff-idx"></th>';
    for (var ci = 0; ci < nCols; ci++) {
      var ha = ci < colsA.length ? String(colsA[ci]) : '';
      var hb = ci < colsB.length ? String(colsB[ci]) : '';
      var cls = 'diff-same';
      if (ci >= colsA.length && ci < colsB.length) cls = 'diff-added';
      else if (ci < colsA.length && ci >= colsB.length) cls = 'diff-removed';
      else if (ha !== hb) cls = 'diff-changed';
      head += '<th class="' + cls + '">' + esc(hb || ha) + '</th>';
    }
    head += '</tr></thead>';
    var body = '<tbody>';
    for (var ri = 0; ri < nRows; ri++) {
      body += '<tr><td class="diff-idx">' + (ri + 1) + '</td>';
      for (var rci = 0; rci < nCols; rci++) {
        var a = cellState(rowsA, ri, rci);
        var b = cellState(rowsB, ri, rci);
        var c = 'diff-same';
        var v = '';
        if (b.absent && a.absent) { c = 'diff-same'; v = ''; }
        else if (a.absent && !b.absent) { c = 'diff-added'; v = b.v; }
        else if (!a.absent && b.absent) { c = 'diff-removed'; v = a.v; }
        else if (a.v !== b.v) { c = 'diff-changed'; v = b.v; }
        else { c = 'diff-same'; v = a.v; }
        body += '<td class="' + c + '">' + esc(v) + '</td>';
      }
      body += '</tr>';
    }
    body += '</tbody>';
    var showA = ca ? (ca.showTotal !== false) : false;
    var showB = cb ? (cb.showTotal !== false) : false;
    var showNote = showA !== showB ? '<div class="cmp-note">Exibição do total automático mudou: ' + (showA ? 'ativo' : 'desativado') + ' → ' + (showB ? 'ativo' : 'desativado') + '.</div>' : '';
    return '<h4>' + esc(label) + '</h4><div class="modal-table-wrap"><table class="modal-tbl diff-tbl">' + head + body + '</table></div>' + showNote;
  }

  function commercialDiffHTML(ta, tb) {
    var ca = ta.com, cb = tb.com;
    if (!ca && !cb) return '<div class="cmp-note">Nenhuma tabela comercial nas revisões selecionadas.</div>';
    var h = tableDiffHTML(ca, cb, 'Tabela comercial');
    if (h === null) return '<div class="cmp-note">Tabela comercial vazia nas duas revisões.</div>';
    return h;
  }

  function extrasDiffHTML(ta, tb) {
    var ca = countExtras(ta.extras);
    var cb = countExtras(tb.extras);
    var html = '<div class="cmp-extras">';
    html += '<div><strong>Parágrafos:</strong> ' + ca.text + ' → ' + cb.text + (ca.text !== cb.text ? ' <span class="diff-changed-tag">(+' + (cb.text - ca.text) + ')</span>' : '') + '</div>';
    html += '<div><strong>Imagens:</strong> ' + ca.image + ' → ' + cb.image + (ca.image !== cb.image ? ' <span class="diff-changed-tag">(+' + (cb.image - ca.image) + ')</span>' : '') + '</div>';
    html += '<div><strong>Tabelas:</strong> ' + ca.table + ' → ' + cb.table + (ca.table !== cb.table ? ' <span class="diff-changed-tag">(+' + (cb.table - ca.table) + ')</span>' : '') + '</div>';
    var tA = ta.extras.filter(function (e) { return e.type === 'table'; });
    var tB = tb.extras.filter(function (e) { return e.type === 'table'; });
    var n = Math.max(tA.length, tB.length);
    for (var i = 0; i < n; i++) {
      var a = tA[i] || null;
      var b = tB[i] || null;
      var aStr = a ? JSON.stringify([a.cols, a.rows, a.showTotal]) : '(sem tabela)';
      var bStr = b ? JSON.stringify([b.cols, b.rows, b.showTotal]) : '(sem tabela)';
      var changed = aStr !== bStr;
      html += '<div class="cmp-extra-table">Tabela extra ' + (i + 1) + ': <span class="' + (changed ? 'diff-changed-tag' : 'delta-same') + '">' + (changed ? 'alterada' : 'inalterada') + '</span></div>';
      if (changed) {
        var th = tableDiffHTML(a, b, 'Tabela extra ' + (i + 1));
        if (th !== null) html += th;
      }
    }
    var anyExtras = ta.extras.length || tb.extras.length;
    if (!anyExtras) html += '<div class="delta-same">Sem conteúdo extra nas revisões selecionadas.</div>';
    html += '</div>';
    return html;
  }

  function restoreRevision(revNo) {
    var prop = getActiveProposal();
    if (!prop) return false;
    var item = findRevision(prop, revNo);
    if (!item || !item.layout) return false;
    if (cloneRevisionAsNew(prop, revNo, 'Restaurado de Rev ' + revNo) === false) return false;
    state = JSON.parse(JSON.stringify(item.layout));
    ensureState();
    loadFooterInputs();
    applyPaper();
    render();
    cleanSnapshot = JSON.stringify(state);
    clearDirty();
    updateStatusBar();
    return true;
  }

  /* Cria uma nova revisão no topo a partir do layout congelado de outra revisão.
     Opera APENAS no registro da proposta (data layer), sem tocar no editor. */
  function cloneRevisionAsNew(prop, revNo, note) {
    if (!prop) return false;
    var item = findRevision(prop, revNo);
    if (!item || !item.layout) return false;
    var rev = (prop.revision || 1) + 1;
    var nl = Array.isArray(prop.revisions) ? prop.revisions.slice() : [];
    var rec = {
      rev: rev,
      date: new Date().toISOString(),
      total: item.total || 0,
      status: prop.status || 'draft',
      note: note || ('Restaurado de Rev ' + revNo),
      layout: JSON.parse(JSON.stringify(item.layout))
    };
    nl.push(rec);
    data.updateProposal(prop.id, {
      revision: rev,
      revisions: capRevisions(nl),
      _budgetFp: commercialFingerprint(item.layout),
      layout: JSON.parse(JSON.stringify(item.layout))
    });
    return rev;
  }

  function restoreRevisionFrom(propId, revNo) {
    var p = data.getProposal(propId);
    if (!p) return false;
    return cloneRevisionAsNew(p, revNo, 'Restaurado de Rev ' + revNo);
  }

  /* Lista as revisões de uma proposta (mais a "Atual" quando não há registro
     para a revisão corrente). Usado pelo dropdown da aba Propostas. */
  function listRevisions(propId) {
    var p = data.getProposal(propId);
    if (!p) return [];
    var cur = p.revision || 1;
    var recs = (Array.isArray(p.revisions) ? p.revisions.slice() : []).sort(function (a, b) { return (b.rev || 0) - (a.rev || 0); });
    var hasCur = recs.some(function (r) { return (r.rev || 0) === cur; });
    var out = [];
    if (!hasCur) {
      out.push({
        rev: cur,
        date: p.updatedAt || p.createdAt,
        total: global.CRE.proposalTotal(p.layout || data.defaultLayout()) || 0,
        status: p.status || 'draft',
        note: '',
        current: true
      });
    }
    recs.forEach(function (r) {
      out.push({
        rev: r.rev,
        date: r.date,
        total: r.total || 0,
        status: r.status,
        note: r.note || '',
        current: (r.rev || 0) === cur
      });
    });
    return out.slice(0, 30);
  }

  /* Visualiza uma revisão (snapshot read-only) em modal próprio, com ações. */
  function viewRevision(propId, revNo) {
    var p = data.getProposal(propId);
    if (!p) return;
    var item = (revNo && revNo > 0) ? findRevision(p, revNo) : null;
    var layout, rev, total, when, status, isCurrent;
    if (item && item.layout) {
      layout = item.layout;
      rev = item.rev || (p.revision || 1);
      total = item.total || 0;
      when = formatRevDate(item.date);
      status = item.status || p.status || 'draft';
      isCurrent = (item.rev || 0) === (p.revision || 1);
    } else {
      layout = p.layout || data.defaultLayout();
      rev = p.revision || 1;
      total = global.CRE.proposalTotal(layout) || 0;
      when = formatRevDate(p.updatedAt || p.createdAt);
      status = p.status || 'draft';
      isCurrent = true;
    }
    var snap = renderSnapshotHTML(layout, { rev: rev, when: when, total: total });
    var html =
      '<div class="snapshot-toolbar">' +
        '<span class="rev-badge">Rev ' + rev + '</span>' +
        '<span class="muted">' + when + '</span>' +
        '<span class="val-badge">' + global.CRE.fmtBRL(total) + '</span>' +
        global.CRE.statusPill(status) +
        (isCurrent ? '<span class="snapshot-cur">versão atual</span>' : '') +
        '<span class="sp"></span>' +
        '<button type="button" class="btn btn-sm btn-secondary" id="snapCmp" title="Comparar duas revisões">Comparar…</button>' +
        '<button type="button" class="btn btn-sm btn-secondary" id="snapDup" title="Duplicar como nova revisão (sem trocar a atual)">Duplicar</button>' +
        '<button type="button" class="btn btn-sm btn-secondary" id="snapExp" title="Exportar histórico em JSON">Exportar</button>' +
        '<button type="button" class="btn btn-sm btn-primary" id="snapRestore" title="Reaplica esta versão e grava uma revisão nova no topo">Restaurar</button>' +
      '</div>' +
      '<div class="snapshot-wrap">' + snap + '</div>';
    var appModal = document.getElementById('appModal');
    var appModalCard = appModal ? appModal.querySelector('.modal') : null;
    if (appModalCard) appModalCard.classList.add('modal-xl');
    function cleanupXL() { if (appModalCard) appModalCard.classList.remove('modal-xl'); }
    global.CRE.openModal('Visualizar Revisão — ' + (p.name || 'Proposta'), html);
    function afterMutate() {
      cleanupXL();
      if (global.CRE_MODULES && global.CRE_MODULES.renderProposals) global.CRE_MODULES.renderProposals();
      if (global.CRE_EDITOR) {
        global.CRE_EDITOR.refreshProposalSelect();
        if (global.CRE_EDITOR.getActiveProposalId && global.CRE_EDITOR.getActiveProposalId() === p.id) {
          global.CRE_EDITOR.loadProposal(data.getProposal(p.id));
        }
      }
    }
    var body = document.getElementById('appModalBody');
    var btnRestore = $('#snapRestore', body);
    if (btnRestore) btnRestore.addEventListener('click', function () {
      cleanupXL();
      global.CRE.confirm('Restaurar revisão', 'Isso reaplica a Rev ' + rev + ' como conteúdo atual e grava a revisão ' + (rev + 1) + ' no topo. Deseja continuar?', function () {
        var ok = restoreRevisionFrom(p.id, rev);
        global.CRE.toast(ok ? 'Revisão restaurada como nova revisão.' : 'Não foi possível restaurar essa revisão.', ok ? 'success' : 'error');
        afterMutate();
      }, 'Restaurar');
    });
    var btnDup = $('#snapDup', body);
    if (btnDup) btnDup.addEventListener('click', function () {
      cleanupXL();
      global.CRE.confirm('Duplicar revisão', 'Cria uma cópia da Rev ' + rev + ' como nova revisão (sem trocar a atual). Deseja continuar?', function () {
        var ok = duplicateRevision(rev, p);
        global.CRE.toast(ok ? 'Revisão duplicada.' : 'Não foi possível duplicar essa revisão.', ok ? 'success' : 'error');
        afterMutate();
      }, 'Duplicar');
    });
    var btnCmp = $('#snapCmp', body);
    if (btnCmp) btnCmp.addEventListener('click', function () {
      cleanupXL();
      global.CRE.closeModal();
      openCompareModal(p, rev);
    });
    var btnExp = $('#snapExp', body);
    if (btnExp) btnExp.addEventListener('click', function () { exportHistory(p); });
    var apClose = document.getElementById('appModalClose');
    if (apClose) apClose.addEventListener('click', cleanupXL);
    if (appModal) appModal.addEventListener('click', function (e) { if (e.target === appModal) cleanupXL(); });
  }

  function openHistoryModal() {
    var prop = getActiveProposal();
    if (!prop) return;
    var list = Array.isArray(prop.revisions) ? prop.revisions.slice() : [];
    if (!list.length) {
      if (global.CRE && global.CRE.toast) global.CRE.toast('Ainda não há revisões salvas neste orçamento.', 'info');
      return;
    }
    var sorted = list.slice().sort(function (a, b) { return (a.rev || 0) - (b.rev || 0); });
    var deltaCls = function (d) { return d > 0 ? 'delta-up' : (d < 0 ? 'delta-down' : 'delta-same'); };
    var deltaTxt = function (d) { return d === 0 ? '—' : (d > 0 ? '+' : '−') + global.CRE.fmtBRL(Math.abs(d)); };
    var rows = sorted.slice().reverse().map(function (r, ri, rev) {
      var prev = rev[ri + 1];
      var d = prev ? ((r.total || 0) - (prev.total || 0)) : 0;
      return '<tr>' +
        '<td><span class="rev-badge">Rev ' + r.rev + '</span></td>' +
        '<td>' + esc(formatRevDate(r.date)) + '</td>' +
        '<td>' + global.CRE.statusPill(r.status || 'draft') + '</td>' +
        '<td class="ta-right">' + global.CRE.fmtBRL(r.total || 0) + '</td>' +
        '<td class="ta-right ' + (prev ? deltaCls(d) : 'delta-same') + '" title="Diferença em relação à revisão anterior">' + (prev ? deltaTxt(d) : '—') + '</td>' +
        '<td><input class="input input-sm rev-note" data-rev="' + r.rev + '" value="' + esc(r.note || '') + '" aria-label="Observação da revisão ' + r.rev + '" title="Observação da revisão (Ctrl+Enter para salvar)"></td>' +
        '<td><div class="row-actions">' +
          '<button type="button" class="mini-btn" data-rev-restore="' + r.rev + '" aria-label="Restaurar revisão ' + r.rev + ' (cria uma nova no topo)">Restaurar</button>' +
          '<button type="button" class="mini-btn" data-rev-duplicate="' + r.rev + '" aria-label="Duplicar revisão ' + r.rev + ' como nova revisão">Duplicar</button>' +
          '<button type="button" class="mini-btn" data-rev-compare="' + r.rev + '" aria-label="Comparar revisão ' + r.rev + ' com a versão atual">Comparar</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
    var html = '<div class="btn-row" style="margin:0 0 10px">' +
        '<button type="button" class="btn btn-sm btn-secondary" id="histCompare">Comparar revisões…</button>' +
        '<button type="button" class="btn btn-sm btn-secondary" id="histExport">Exportar histórico (JSON)</button>' +
      '</div>' +
      '<p style="font-size:12px;color:var(--muted);margin:0 0 10px">Restaurar reaplica esta versão e grava uma revisão nova no topo. Revisões aprovadas não são removidas pela retenção.</p>' +
      '<div class="modal-table-wrap"><table class="modal-tbl rev-hist-tbl">' +
      '<thead><tr><th>Revisão</th><th>Data</th><th>Status</th><th>Total</th><th>Δ</th><th>Observação</th><th>Ação</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div>';
    modalTitleEl.textContent = 'Histórico do Orçamento — ' + (prop.name || 'Proposta');
    modalBodyEl.innerHTML = html;
    openModal();
    $$('[data-rev-restore]', modalBodyEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = parseInt(btn.dataset.revRestore, 10);
        closeModal();
        if (restoreRevision(target)) {
          if (global.CRE && global.CRE.toast) global.CRE.toast('Revisão restaurada como nova revisão.', 'success');
        } else {
          if (global.CRE && global.CRE.toast) global.CRE.toast('Não foi possível restaurar essa revisão.', 'error');
        }
      });
    });
    $$('[data-rev-duplicate]', modalBodyEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = parseInt(btn.dataset.revDuplicate, 10);
        closeModal();
        if (duplicateRevision(target)) {
          if (global.CRE && global.CRE.toast) global.CRE.toast('Revisão duplicada.', 'success');
        } else {
          if (global.CRE && global.CRE.toast) global.CRE.toast('Não foi possível duplicar essa revisão.', 'error');
        }
      });
    });
    $$('[data-rev-compare]', modalBodyEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCompareModal(parseInt(btn.dataset.revCompare, 10));
      });
    });
    var btnCmp = $('#histCompare', modalBodyEl);
    if (btnCmp) btnCmp.addEventListener('click', function () { openCompareModal(); });
    var btnExp = $('#histExport', modalBodyEl);
    if (btnExp) btnExp.addEventListener('click', exportHistory);
    $$('.rev-note', modalBodyEl).forEach(function (inp) {
      inp.addEventListener('change', function () {
        updateRevisionNote(prop, parseInt(inp.dataset.rev, 10), inp.value);
        if (global.CRE && global.CRE.toast) global.CRE.toast('Observação da revisão atualizada.', 'success');
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          updateRevisionNote(prop, parseInt(inp.dataset.rev, 10), inp.value);
          closeModal();
          if (global.CRE && global.CRE.toast) global.CRE.toast('Observação da revisão atualizada.', 'success');
        }
      });
    });
  }

  function revBadgeHTML() {
    var rev = _snapshotRev || (getActiveProposal() || {}).revision || 1;
    if (rev <= 1) return '';
    return ' <span class="rev-on-sheet">Rev ' + rev + '</span>';
  }

  function updateRevUI() {
    var prop = getActiveProposal();
    var rev = (prop && prop.revision) || 1;
    var locked = !!(prop && prop.status === 'approved');
    if (sbRevisionEl) sbRevisionEl.textContent = 'Rev ' + rev;
    if (revBannerEl) revBannerEl.classList.toggle('hidden', !locked);
    if (revBannerNoteEl && locked) {
      revBannerNoteEl.textContent = 'Total estimado: ' + global.CRE.fmtBRL(currentBudgetTotal()) + '. Para alterar o orçamento, gere uma nova revisão.';
    }
  }

  function unlockProposal() {
    var prop = getActiveProposal();
    if (!prop) return;
    var rev = (prop.revision || 1) + 1;
    var list = Array.isArray(prop.revisions) ? prop.revisions.slice() : [];
    var rec = revisionRecord('Reaberto para revisão após aprovação');
    rec.rev = rev;
    list.push(rec);
    data.updateProposal(prop.id, {
      status: 'draft',
      revision: rev,
      revisions: capRevisions(list),
      _budgetFp: commercialFingerprint(state)
    });
    render();
    updateStatusBar();
    if (global.CRE && global.CRE.toast) global.CRE.toast('Nova revisão gerada. Orçamento liberado para edição.', 'success');
  }

  function autosave() {
    autosaveTimer = null;
    var prop = getActiveProposal();
    if (!prop) return;
    commitActiveEdit();
    if (JSON.stringify(state) === cleanSnapshot) return;
    data.updateProposal(prop.id, { layout: state });
    trackBudgetRevision(prop);
    updateRevUI();
    clearDirty();
    updateAutosaveStamp();
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosave, AUTOSAVE_DELAY);
  }

  function cancelAutosave() {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  }

  /* ── Substituição integral do store ────────────────────────
     O state do editor é uma CÓPIA do layout gravado. Sem este
     callback o autosave grava a cópia velha por cima daquilo que o
     usuário acabou de restaurar/importar/resetar, 4 segundos depois.
     A recarga daqui é somente leitura: nenhuma escrita é feita
     enquanto o store é trocado (skipWrites em loadProposal). */

  var _recarregandoStore = false;

  var ORIGENS_STORE = {
    'restauracao': 'Backup restaurado.',
    'reset': 'Dados redefinidos para o padrão.',
    'importacao': 'Dados importados.',
    'exclusao-proposta': 'Proposta excluída.',
    'aba-externa': 'Dados sincronizados com outra aba.'
  };

  /* Sem proposta no store novo: estado vazio navegável. autosave e
     saveProposal já são no-op quando getActiveProposal() devolve null,
     então nada é gravado por aqui nem depois. */
  function emptyEditorState() {
    cancelAutosave();
    activeEditable = null;
    savedRange = null;
    state = JSON.parse(JSON.stringify(data.defaultLayout()));
    ensureState();
    undoStack = [];
    redoStack = [];
    selectedBlockId = null;
    loadFooterInputs();
    applyPaper();
    loadedProposalId = null;
    if (proposalSelectEl) proposalSelectEl.value = '';
    /* isDirty=false antes: clearDirty() não anuncia "Alterações salvas"
       para alterações que na verdade foram descartadas. */
    isDirty = false;
    clearDirty();
    render();
    updateHistoryButtons();
    updateRevUI();
    updateStatusBar();
  }

  function onStoreReplaced(info) {
    if (_recarregandoStore) return;
    if (!docEl || !overlayEl) return;

    var origem = (info && info.origem) || '';
    var sujo = isDirty;
    var carregada = loadedProposalId;

    /* Excluir uma proposta ALHEIA não mexe no layout aberto: manter
       state, undo e alterações pendentes intactos. Só saímos da
       proposta quando ela própria foi a excluída. */
    if (origem === 'exclusao-proposta' && (!carregada || data.getProposal(carregada))) return;

    _recarregandoStore = true;
    try {
      cancelAutosave();
      /* Descarta a edição em andamento sem passar por commitActiveEdit:
         gravá-la agora seria justamente a escrita velha que evitamos. */
      activeEditable = null;
      savedRange = null;

      var alvo = carregada ? data.getProposal(carregada) : null;
      var sumiu = !!(carregada && !alvo);
      if (!alvo) alvo = data.getActiveProposal();

      if (alvo) loadProposal(alvo, { silent: true, skipWrites: true });
      else emptyEditorState();

      /* Modal aberto aponta para o layout anterior (e o render() já
         limpou fieldSetters): fecha depois da recarga para que o
         focus-trap volte pelo seletor no DOM novo. */
      if (overlayEl.classList.contains('open')) closeModal();

      var frase = ORIGENS_STORE[origem] || 'Banco de dados substituído no navegador.';
      var extra = '';
      if (sumiu) {
        extra = alvo
          ? ' A proposta aberta não existe mais; o editor abriu "' + (alvo.name || 'proposta sem nome') + '".'
          : ' A proposta aberta não existe mais e não há outra para abrir.';
      }
      if (sujo) extra += ' As alterações não salvas desta proposta foram descartadas.';
      announce(frase + extra);
      if ((sujo || sumiu) && global.CRE && global.CRE.toast) {
        global.CRE.toast(frase + extra, sujo ? 'warning' : 'info');
      }
    } finally {
      _recarregandoStore = false;
    }
  }

  function saveProposal() {
    commitActiveEdit();
    var prop = getActiveProposal();
    if (!prop) return;
    data.updateProposal(prop.id, { layout: state });
    trackBudgetRevision(prop);
    updateRevUI();
    clearDirty();
    updateAutosaveStamp();
    cancelAutosave();
    render();
    updateStatusBar();
    if (global.CRE) global.CRE.toast('Proposta salva com sucesso!', 'success');
  }

  function discardChanges() {
    cancelAutosave();
    if (!isDirty) return;
    var doDiscard = function () {
      if (!cleanSnapshot) {
        var prop = getActiveProposal();
        if (!prop) return;
        var fresh = data.getProposal(prop.id);
        if (fresh) {
          var layout = fresh.layout || data.defaultLayout();
          state = JSON.parse(JSON.stringify(layout));
        }
      } else {
        state = JSON.parse(cleanSnapshot);
      }
      undoStack = [];
      redoStack = [];
      ensureState();
      loadFooterInputs();
      applyPaper();
      render();
      updateHistoryButtons();
      clearDirty();
      if (global.CRE && global.CRE.toast) global.CRE.toast('Alterações descartadas. Proposta restaurada.', 'info');
    };

    if (global.CRE && global.CRE.confirm) {
      global.CRE.confirm(
        'Desfazer Alterações',
        'Deseja descartar todas as alterações não salvas e voltar ao último salvamento?',
        doDiscard,
        'Descartar'
      );
    } else {
      doDiscard();
    }
  }

  /* ── Paper / Zoom ────────────────────────── */

  function applyPaper() {
    var sz = state.paper.size || 'A4';
    var o = state.paper.orientation || 'portrait';
    var dims = sz === 'Letter' ? { w: 215.9, h: 279.4 } : { w: 210, h: 297 };
    PAGE.width = o === 'landscape' ? dims.h : dims.w;
    PAGE.height = o === 'landscape' ? dims.w : dims.h;
    docEl.className = 'document paper-' + sz + ' orient-' + o;
    printStyleEl.textContent = '@page { size: ' + sz + ' ' + o + '; margin: 0 }';
    if (paperSizeEl) { paperSizeEl.value = sz; }
    if (paperOrientEl) { paperOrientEl.value = o; }
    syncPaperLabel();
  }

  function syncPaperLabel() {
    var sz = state.paper.size || 'A4';
    var o = state.paper.orientation || 'portrait';
    if (sbPaperEl) sbPaperEl.textContent = sz + ' · ' + (o === 'portrait' ? 'Retrato' : 'Paisagem');
  }

  function applyZoom() {
    var z = state.zoom || DEFAULT_ZOOM;
    docEl.style.zoom = (z / 100);
    if (zoomInputEl) zoomInputEl.value = z;
    if (sbZoomEl) sbZoomEl.textContent = z + '%';
  }

  /* ── Renderização ────────────────────────── */

  function render() {
    fieldSetters = {};
    imageResizeSetters = {};
    moveSetters = {};
    _fieldCounter = 0;
    applyPaper();
    renderPages();
    recalcAllTableTotals();
    renderSidebar();
    updatePageNumbers();
    applyZoom();
    updateStatusBar();
    if (selectedBlockId) {
      if (!state.blocks.some(function (b) { return b.id === selectedBlockId; })) {
        selectedBlockId = null;
      } else {
        var selPage = $('.page[data-block-id="' + selectedBlockId + '"]');
        if (selPage) selPage.classList.add('selected');
        highlightBlock(selectedBlockId);
      }
    }
  }

  function renderPages() {
    docEl.innerHTML = '';
    state.blocks.forEach(function (block, i) {
      var page = document.createElement('section');
      page.className = 'page editing';
      page.dataset.blockId = block.id;
      page.title = 'Duplo clique para editar as informações do bloco';
      page.innerHTML =
        buildHeader() +
        '<div class="page-body ' + esc(block.type) + '">' +
          buildPageContent(block) +
        '</div>' +
        buildFooter(state, i, null) +
        buildPageControls(block.id) +
        buildMarginGuides(block.id) +
        '<div class="page-badge">' + (BLOCK_TYPES[block.type] ? BLOCK_TYPES[block.type].icon : '') + ' ' + esc(block.label) + '</div>';
      docEl.appendChild(page);
    });
    applyMargins();
    attachInlineEditors();
    attachMarginGuides();
    attachImageResize();
    attachMovables();
    attachBlockDblClick();
    attachPageSelection();
  }

  function buildHeader() {
    return '<header><img src="' + esc(state.footer.headerImg) + '"></header>';
  }

  /* Rodapé: só vira <a> quando o texto realmente é uma URL.
     Caractere por caractere permitido — esc() não escapa aspas,
     então o href precisa ficar fora do alcance de quebrar o atributo. */
  var URLISH = /^(https?:\/\/|www\.)[\w\-./?=&%#~:+@]*$/i;
  var DOMISH = /^[\w-]+(\.[\w-]+)+([\/?#][\w\-./?=&%#~:+@]*)?$/;

  function footerLinkHTML(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    var isUrl = URLISH.test(t) || (DOMISH.test(t) && /\.[a-z]{2,}([\/?#]|$)/i.test(t));
    if (!isUrl) return esc(t);
    var href = /^https?:\/\//i.test(t) ? t : 'https://' + t.replace(/^www\./i, '');
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(t) + '</a>';
  }

  /* Linha "Rev N · data · total": sempre DERIVADA de revMeta ou da
     proposta ativa — nunca é campo persistido em state.footer. */
  function revLineHTML(revMeta) {
    if (revMeta) {
      return '<span class="rev-footer">Rev ' + esc(revMeta.rev) +
        (revMeta.when ? ' · ' + esc(revMeta.when) : '') +
        ' · Total ' + esc(global.CRE.fmtBRL(revMeta.total || 0)) + '</span>';
    }
    var prop = getActiveProposal();
    if (!prop || (prop.revision || 1) <= 1) return '';
    var recs = prop.revisions || [];
    var last = recs.length ? recs[recs.length - 1] : null;
    var when = last ? formatRevDate(last.date) : '';
    return '<span class="rev-footer">Rev ' + esc(prop.revision || 1) +
      (when ? ' · ' + esc(when) : '') +
      ' · Total ' + esc(global.CRE.fmtBRL(currentBudgetTotal())) + '</span>';
  }

  /* Corpo comum do rodapé. Quem renderiza (buildFooter) e quem
     reescreve durante a edição (updateFooterText) usam ESTA função,
     senão a linha de revisão some ao editar um campo. */
  function footerBodyHTML(layout, revLine, idx) {
    var f = (layout && layout.footer) || {};
    return esc(f.line1) + '<br>' +
      esc(f.line2) + '<br>' +
      footerLinkHTML(f.line3) +
      revLine +
      '<span class="page-num">' + (idx + 1) + '</span>';
  }

  function footerHTML(layout, idx, revMeta) {
    layout = layout || state;
    var m = layout.margins || {};
    return '<footer' + (revMeta ? ' style="left:' + (m.left || 0) + 'mm;right:' + (m.right || 0) + 'mm"' : '') + '>' +
      footerBodyHTML(layout, revLineHTML(revMeta), idx) +
    '</footer>';
  }

  function buildFooter(layout, idx, revMeta) {
    return footerHTML(layout, idx, revMeta);
  }

  /* Render read-only de um layout CONGELADO (snapshot de revisão).
     Não altera o state do editor: apenas usa os construtores de bloco
     em modo leitura e devolve o HTML para o visualizador. */
  function renderSnapshotHTML(layout, revMeta) {
    _snapshotLock = true;
    _snapshotRev = (revMeta && revMeta.rev) || 1;
    var prevPageW = PAGE.width, prevPageH = PAGE.height;
    var out = '';
    try {
      layout = layout || {};
      var f = layout.footer || {};
      var m = layout.margins || {};
      var ml = m.left || 0, mr = m.right || 0, mtop = m.top || 0, mb = m.bottom || 0;
      _snapshotMargins = m;
      var sz = (layout.paper && layout.paper.size) || 'A4';
      var or = (layout.paper && layout.paper.orientation) || 'portrait';
      var dims = sz === 'Letter' ? { w: 215.9, h: 279.4 } : { w: 210, h: 297 };
      PAGE.width = or === 'landscape' ? dims.h : dims.w;
      PAGE.height = or === 'landscape' ? dims.w : dims.h;
      var himg = f.headerImg || '';
      var blocks = layout.blocks || [];
      out = '<div class="document snapshot-doc paper-' + sz + ' orient-' + or + '">';
      blocks.forEach(function (block, i) {
        var bid = (block && block.id) || i;
        out += '<section class="page" data-block-id="' + esc(bid) + '">';
        out += '<header>' + (himg ? '<img src="' + esc(himg) + '">' : '') + '</header>';
        out += '<div class="page-body ' + esc(block && block.type) + '" style="padding-top:' + mtop + 'mm;padding-right:' + mr + 'mm;padding-bottom:' + mb + 'mm;padding-left:' + ml + 'mm;height:' + (PAGE.height - HEADER_H - mb) + 'mm;overflow:hidden">' +
                 buildPageContent(block) +
               '</div>';
        out += buildFooter(layout, i, revMeta) + '</section>';
      });
      out += '</div>';
    } finally {
      PAGE.width = prevPageW;
      PAGE.height = prevPageH;
      _snapshotMargins = null;
      _snapshotLock = false;
      _snapshotRev = 0;
    }
    var tmp = document.createElement('div');
    tmp.innerHTML = out;
    $$('.page .signature', tmp).forEach(function (s) {
      var m = layout.margins || {};
      s.style.left = (m.left || 0) + 'mm';
      s.style.right = (m.right || 0) + 'mm';
      s.style.bottom = Math.max(30, m.bottom || 0) + 'mm';
    });
    $$('[contenteditable]', tmp).forEach(function (el) {
      el.contentEditable = 'false';
      el.removeAttribute('data-field-id');
    });
    /* rótulo de leitor de tela só faz sentido no editor:
       no snapshot o elemento é somente leitura. */
    $$('[role="textbox"]', tmp).forEach(function (el) {
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      el.removeAttribute('aria-multiline');
      el.removeAttribute('aria-describedby');
    });
    $$('.resize-handle', tmp).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    return tmp.innerHTML;
  }

  function buildMarginGuides(blockId) {
    return '' +
      '<div class="margin-guide mg-left" data-block="' + blockId + '" data-side="left" title="Arraste para ajustar a margem esquerda">' +
        '<span class="mg-handle">&#9654;</span><span class="mg-label">0 mm</span></div>' +
      '<div class="margin-guide mg-right" data-block="' + blockId + '" data-side="right" title="Arraste para ajustar a margem direita">' +
        '<span class="mg-handle">&#9664;</span><span class="mg-label">0 mm</span></div>' +
      '<div class="margin-guide mg-top" data-block="' + blockId + '" data-side="top" title="Arraste para ajustar a margem superior">' +
        '<span class="mg-handle">&#9660;</span><span class="mg-label">0 mm</span></div>' +
      '<div class="margin-guide mg-bottom" data-block="' + blockId + '" data-side="bottom" title="Arraste para ajustar a margem inferior">' +
        '<span class="mg-handle">&#9650;</span><span class="mg-label">0 mm</span></div>';
  }

  function applyMargins() {
    var top = state.margins.top || 0;
    var right = state.margins.right || 0;
    var bottom = state.margins.bottom || 0;
    var left = state.margins.left || 0;

    $$('.page-body', docEl).forEach(function (body) {
      body.style.paddingTop = top + 'mm';
      body.style.paddingRight = right + 'mm';
      body.style.paddingBottom = bottom + 'mm';
      body.style.paddingLeft = left + 'mm';
      body.style.height = (PAGE.height - HEADER_H - bottom) + 'mm';
      body.style.overflow = 'hidden';
    });

    $$('.page footer', docEl).forEach(function (f) {
      f.style.left = left + 'mm';
      f.style.right = right + 'mm';
    });

    var sigBottom = Math.max(30, bottom);
    $$('.page .signature', docEl).forEach(function (s) {
      s.style.left = left + 'mm';
      s.style.right = right + 'mm';
      s.style.bottom = sigBottom + 'mm';
    });

    $$('.margin-guide', docEl).forEach(function (g) {
      var side = g.dataset.side;
      var mm = state.margins[side] || 0;
      if (side === 'left') {
        g.style.left = mm2px(mm) + 'px';
        g.style.top = mm2px(HEADER_H) + 'px';
        g.style.bottom = '0';
        g.style.right = 'auto';
      } else if (side === 'right') {
        g.style.right = mm2px(mm) + 'px';
        g.style.top = mm2px(HEADER_H) + 'px';
        g.style.bottom = '0';
        g.style.left = 'auto';
      } else if (side === 'top') {
        g.style.top = mm2px(HEADER_H + mm) + 'px';
        g.style.left = mm2px(left) + 'px';
        g.style.right = mm2px(right) + 'px';
        g.style.bottom = 'auto';
      } else if (side === 'bottom') {
        g.style.bottom = mm2px(mm) + 'px';
        g.style.left = mm2px(left) + 'px';
        g.style.right = mm2px(right) + 'px';
        g.style.top = 'auto';
      }
      updateGuideLabel(g, mm);
    });
  }

  function updateGuideLabel(el, mm) {
    var label = el.querySelector('.mg-label');
    if (label) {
      label.textContent = mm.toFixed(0).replace('.', ',') + ' mm';
      label.className = 'mg-label ' + (mm > 0 ? 'on' : '');
    }
  }

  var activeDrag = null;

  function attachMarginGuides() {
    $$('.margin-guide', docEl).forEach(function (guide) {
      guide.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startMarginDrag(guide, e);
      });
    });
  }

  function startMarginDrag(guide, e) {
    var side = guide.dataset.side;
    pushHistory();
    document.body.classList.add('dragging-margin');
    document.body.classList.add(side === 'left' || side === 'right' ? 'mg-drag-h' : 'mg-drag-v');
    guide.classList.add('dragging');
    activeDrag = {
      guide: guide,
      side: side,
      startX: e.clientX,
      startY: e.clientY,
      startVal: state.margins[side] || 0
    };
  }

  document.addEventListener('mousemove', function (e) {
    if (activeDrag) {
      var d = activeDrag;
      var dx = e.clientX - d.startX;
      var dy = e.clientY - d.startY;
      var val;
      if (d.side === 'left') val = d.startVal + px2mm(dx / zFx());
      else if (d.side === 'right') val = d.startVal - px2mm(dx / zFx());
      else if (d.side === 'top') val = d.startVal + px2mm(dy / zFx());
      else val = d.startVal - px2mm(dy / zFx());
      val = Math.max(0, Math.min(60, val));
      state.margins[d.side] = Math.round(val * 10) / 10;
      applyMargins();
    }
    if (imageDrag) {
      var id = imageDrag;
      var dx2 = px2mm((e.clientX - id.sx) / zFx());
      var dy2 = px2mm((e.clientY - id.sy) / zFx());
      var w = Math.max(8, Math.min(PAGE.width, px2mm(id.startW) + dx2));
      var h = Math.max(8, Math.min(PAGE.height, px2mm(id.startH) + dy2));
      id.img.style.width = w + 'mm';
      id.img.style.height = h + 'mm';
    }
    if (moveDrag && moveDrag.active) {
      var md = moveDrag;
var m = _snapshotMargins || state.margins || {};
      var mL = m.left || 0, mR = m.right || 0, mT = m.top || 0, mB = m.bottom || 0;
      var r = md.el.getBoundingClientRect();
      var mw = px2mm(r.width / zFx());
      var mh = px2mm(r.height / zFx());
      var x = Math.round((md.baseX + px2mm((e.clientX - md.startX) / zFx())) * 10) / 10;
      var y = Math.round((md.baseY + px2mm((e.clientY - md.startY) / zFx())) * 10) / 10;
      x = Math.max(mL, Math.min(PAGE.width - mR - mw, x));
      y = Math.max(HEADER_H + mT, Math.min(PAGE.height - mB - mh, y));
      md.el.style.left = x + 'mm';
      md.el.style.top = y + 'mm';
      md.curX = x;
      md.curY = y;
    }
  });

  document.addEventListener('mouseup', function () {
    if (activeDrag) {
      if (activeDrag.guide) activeDrag.guide.classList.remove('dragging');
      activeDrag = null;
      document.body.classList.remove('dragging-margin', 'mg-drag-h', 'mg-drag-v');
      saveToStorage();
    }
    if (imageDrag) {
      if (imageDrag.wrap) {
        persistImageSize(imageDrag.wrap);
        imageDrag.wrap.classList.remove('resizing');
      }
      imageDrag = null;
      document.body.classList.remove('resizing-img');
      saveToStorage();
    }
    if (moveDrag) {
      var md = moveDrag;
      if (md.el.dataset.moveId !== undefined && md.curX !== undefined) {
        var mset = moveSetters[parseInt(md.el.dataset.moveId, 10)];
        if (mset) mset(md.curX, md.curY);
      }
      moveDrag = null;
      document.body.classList.remove('moving-img');
      saveToStorage();
    }
  });

  var imageDrag = null;

  function attachImageResize() {
    $$('.img-wrap .resize-handle', docEl).forEach(function (handle) {
      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startImageResize(handle, e);
      });
    });
  }

  function startImageResize(handle, e) {
    var wrap = handle.closest('.img-wrap');
    var img = wrap.querySelector('img');
    var rect = img.getBoundingClientRect();
    pushHistory();
    document.body.classList.add('resizing-img');
    imageDrag = { wrap: wrap, img: img, startW: rect.width / zFx(), startH: rect.height / zFx(), sx: e.clientX, sy: e.clientY };
  }

  function persistImageSize(wrap) {
    var img = wrap.querySelector('img');
    var w = Math.round(px2mm(img.getBoundingClientRect().width / zFx()) * 10) / 10;
    var h = Math.round(px2mm(img.getBoundingClientRect().height / zFx()) * 10) / 10;
    if (!wrap.dataset.resizeId) return;
    var setter = imageResizeSetters[parseInt(wrap.dataset.resizeId, 10)];
    if (setter) setter('resize', w, h);
  }

  var moveDrag = null;

  function attachMovables() {
    $$('[data-movable]', docEl).forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        if (e.target.closest('.resize-handle')) return;
        pushHistory();
        var editable = el.isContentEditable;
        if (!editable) {
          e.preventDefault();
          e.stopPropagation();
        }
        moveDrag = {
          el: el,
          active: !editable,
          startX: e.clientX,
          startY: e.clientY,
          baseX: parseFloat(el.style.left) || 0,
          baseY: parseFloat(el.style.top) || 0
        };
        if (moveDrag.active) document.body.classList.add('moving-img');
      });
    });
  }

  function buildPageControls(blockId) {
    return '<div class="page-controls" role="group" aria-label="Controles da página">' +
      '<button data-action="moveUp" data-id="' + blockId + '" title="Mover para cima" aria-label="Mover página para cima"><span aria-hidden="true">&#9650;</span></button>' +
      '<button data-action="moveDown" data-id="' + blockId + '" title="Mover para baixo" aria-label="Mover página para baixo"><span aria-hidden="true">&#9660;</span></button>' +
      '<button data-action="duplicate" data-id="' + blockId + '" title="Duplicar" aria-label="Duplicar página"><span aria-hidden="true">&#10697;</span></button>' +
      '<button data-action="edit" data-id="' + blockId + '" title="Editar bloco" aria-label="Editar bloco desta página"><span aria-hidden="true">&#9998;</span></button>' +
      '<button data-action="delete" data-id="' + blockId + '" title="Remover bloco" class="del-btn" aria-label="Remover bloco desta página"><span aria-hidden="true">&#10005;</span></button>' +
    '</div>';
  }

  /* ── Construtores de conteúdo ────────────── */

  function buildPageContent(block) {
    var html;
    switch (block.type) {
      case 'cover':       html = buildCover(block); break;
      case 'clients':     html = buildClients(block); break;
      case 'technical':   html = buildTechnical(block); break;
      case 'obligations': html = buildObligations(block); break;
      case 'commercial':  html = buildCommercial(block); break;
      case 'closing':     html = buildClosing(block); break;
      case 'gallery':     html = buildGallery(block); break;
      case 'custom':      html = buildCustom(block); break;
      default:            html = '<p>Tipo de bloco desconhecido</p>';
    }
    html += buildExtras(block);
    return html;
  }

  function buildExtras(block) {
    var d = block.data;
    if (!Array.isArray(d.extras)) d.extras = [];
    var locked = isProposalApproved();
    var html = '';

    d.extras.forEach(function (ex, ei) {
      if (ex.type === 'text') {
        var p = document.createElement('p');
        p.className = 'editable';
        p.contentEditable = locked ? 'false' : 'true';
        p.spellcheck = false;
        p.innerHTML = ex.fmt || esc(ex.content || '');
        if (!locked) reg(p, rich((function (i) { return function (v) { d.extras[i].content = v; }; })(ei), ex, 'fmt'),
          (block.label || 'Bloco') + ' — parágrafo extra ' + (ei + 1));
        html += '<div class="extra-el">' + p.outerHTML +
          (locked ? '' : '<button class="content-del" data-action="delExtra" data-id="' + esc(block.id) + '" data-eid="' + ei + '" title="Remover parágrafo" aria-label="Remover parágrafo extra ' + (ei + 1) + '"></button>') + '</div>';
      } else if (ex.type === 'image') {
        var w = parseFloat(ex.width) || 120;
        var h = parseFloat(ex.height) || 0;
        var wrap = document.createElement('span');
        wrap.className = 'img-wrap';
        var img = document.createElement('img');
        img.src = ex.src || '';
        img.style.width = w + 'mm';
        if (h > 0) img.style.height = h + 'mm';
        wrap.appendChild(img);
        if (!locked) {
          var handle = document.createElement('span');
          handle.className = 'resize-handle';
          wrap.appendChild(handle);
          var rid = _fieldCounter++;
          wrap.dataset.resizeId = rid;
          imageResizeSetters[rid] = (function (i) {
            return function (step, nw, nh) { d.extras[i].width = nw; d.extras[i].height = nh; };
          })(ei);
        }
        html += '<div class="extra-el">' + wrap.outerHTML +
          (locked ? '' : '<button class="content-del" data-action="delExtra" data-id="' + esc(block.id) + '" data-eid="' + ei + '" title="Remover imagem" aria-label="Remover imagem extra ' + (ei + 1) + '"></button>') + '</div>';
      } else if (ex.type === 'table') {
        normalizeTable(ex);
        html += '<div class="extra-el">' + buildTableHTML({
          blockId: block.id,
          blockLabel: block.label || block.type,
          eid: ei,
          data: ex,
          locked: locked,
          setCol: (function (i) { return function (ci) { return function (v) { d.extras[i].cols[ci] = v; }; }; })(ei),
          setCell: (function (i) { return function (ri, ci) { return function (v) { d.extras[i].rows[ri][ci] = v; }; }; })(ei),
          addColAction: 'exColAdd', addRowAction: 'exRowAdd',
          delColAction: 'exColDel', delRowAction: 'exRowDel',
          showTotal: !!ex.showTotal
        }) +
          (locked ? '' : '<button class="content-del" data-action="delExtra" data-id="' + esc(block.id) + '" data-eid="' + ei + '" title="Remover tabela" aria-label="Remover tabela extra ' + (ei + 1) + '"></button>') + '</div>';
      }
    });

    if (!locked) {
      html += '<div class="add-tools">' +
        '<button class="btn btn-sm btn-secondary" data-action="addExtra" data-id="' + esc(block.id) + '" data-type="text">+ Parágrafo</button>' +
        '<button class="btn btn-sm btn-secondary" data-action="addExtra" data-id="' + esc(block.id) + '" data-type="image">+ Imagem</button>' +
        '<button class="btn btn-sm btn-secondary" data-action="addExtra" data-id="' + esc(block.id) + '" data-type="table">+ Tabela</button>' +
        '</div>';
    }

    return html;
  }

  function buildCover(block) {
    var d = block.data;
    var html = '';
    var bl = block.label || 'Capa';

    html += '<div class="date">';
    var dateEl = document.createElement('span');
    dateEl.className = 'editable';
    dateEl.contentEditable = 'true';
    dateEl.spellcheck = false;
    dateEl.innerHTML = (d.formatted && d.formatted.date) || esc(d.date || '');
    reg(dateEl, rich(function (v) { d.date = v; }, d, 'date'), bl + ' — data');
    html += dateEl.outerHTML;
    html += '</div>';

    html += '<p class="bold">' + esc(d.recipient) + '</p>';
    html += '<p class="bold">' + esc(d.proposalNumber) + revBadgeHTML() + '</p>';
    html += '<p>' + esc(d.contactName) + '</p>';
    html += '<p>' + esc(d.contactPhone) + '</p>';
    html += '<p>' + esc(d.address) + '</p>';

    html += '<div class="contact"><p class="bold">Contato Georevest</p>';
    (d.georevestContacts || []).forEach(function (c, ci) {
      var p = document.createElement('p');

      var nameSpan = document.createElement('span');
      nameSpan.className = 'editable';
      nameSpan.contentEditable = 'true';
      nameSpan.spellcheck = false;
      nameSpan.innerHTML = (c.formatted && c.formatted.name) || esc(c.name || '');
      reg(nameSpan, rich(function (v) { c.name = v; }, c, 'name'), bl + ' — contato Georevest ' + (ci + 1) + ' — nome');

      var roleSpan = document.createElement('span');
      roleSpan.className = 'editable';
      roleSpan.contentEditable = 'true';
      roleSpan.spellcheck = false;
      roleSpan.innerHTML = (c.formatted && c.formatted.role) || esc(c.role || '');
      reg(roleSpan, rich(function (v) { c.role = v; }, c, 'role'), bl + ' — contato Georevest ' + (ci + 1) + ' — cargo');

      var phoneSpan = document.createElement('span');
      phoneSpan.className = 'editable';
      phoneSpan.contentEditable = 'true';
      phoneSpan.spellcheck = false;
      phoneSpan.innerHTML = (c.formatted && c.formatted.phone) || esc(c.phone || '');
      reg(phoneSpan, rich(function (v) { c.phone = v; }, c, 'phone'), bl + ' — contato Georevest ' + (ci + 1) + ' — telefone');

      var emailSpan = document.createElement('span');
      emailSpan.className = 'editable';
      emailSpan.contentEditable = 'true';
      emailSpan.spellcheck = false;
      emailSpan.innerHTML = (c.formatted && c.formatted.email) || esc(c.email || '');
      reg(emailSpan, rich(function (v) { c.email = v; }, c, 'email'), bl + ' — contato Georevest ' + (ci + 1) + ' — e-mail');

      p.innerHTML = '';
      p.appendChild(nameSpan);
      p.appendChild(document.createTextNode(' - '));
      p.appendChild(roleSpan);
      p.appendChild(document.createElement('br'));
      p.appendChild(document.createTextNode('Telefone: '));
      p.appendChild(phoneSpan);
      p.appendChild(document.createElement('br'));
      p.appendChild(document.createTextNode('e-mail: '));
      p.appendChild(emailSpan);

      html += p.outerHTML;
    });
    html += '</div>';

    var prop = getActiveProposal();
    if (prop && Array.isArray(prop.partners)) {
      var visiblePartners = prop.partners.filter(function (pt) { return pt.showOnProposal; });
      if (visiblePartners.length) {
        html += '<div class="cover-partners" style="margin-top:14px;padding:8px 12px;border-left:3px solid var(--accent, #f59e0b);background:rgba(0,0,0,0.03);border-radius:4px">';
        html += '<p class="bold" style="font-size:0.85rem;margin:0 0 4px 0;color:var(--text, #1e293b)">Parceria Técnica / Operacional</p>';
        visiblePartners.forEach(function (pt) {
          var part = data.findPartner(pt.partnerId);
          var rInfo = data.PARTNER_ROLES && data.PARTNER_ROLES[pt.role] ? data.PARTNER_ROLES[pt.role] : { label: pt.role, icon: '🤝' };
          if (part) {
            html += '<p style="margin:2px 0;font-size:0.82rem"><strong>' + esc(part.name) + '</strong> (' + rInfo.icon + ' ' + esc(rInfo.label) + ')' +
              (part.cnpj ? ' · CNPJ: ' + esc(part.cnpj) : '') +
              (pt.notes ? ' · <em>' + esc(pt.notes) + '</em>' : '') +
            '</p>';
          }
        });
        html += '</div>';
      }
    }

    return html;
  }

  function buildClients(block) {
    var d = block.data;
    var m = state.margins || {};
    var mL = m.left || 0, mR = m.right || 0, mT = m.top || 0, mB = m.bottom || 0;
    var bl = block.label || 'Clientes';

    var h1 = document.createElement('h1');
    h1.className = 'editable';
    h1.contentEditable = 'true';
    h1.spellcheck = false;
    h1.innerHTML = (d.formatted && d.formatted.title) || esc(d.title || '');
    reg(h1, rich(function (v) { d.title = v; }, d, 'title'), bl + ' — título');

    h1.style.position = 'absolute';
    h1.style.margin = '0';
    var tw = parseFloat(d.titleWidth);
    var tx = parseFloat(d.titleX);
    var ty = parseFloat(d.titleY);
    if (isNaN(tw)) tw = Math.max(40, PAGE.width - mL - mR);
    if (isNaN(tx)) tx = mL;
    if (isNaN(ty)) ty = HEADER_H + mT;
    tw = Math.min(tw, PAGE.width - mL - mR);
    h1.style.width = tw + 'mm';
    tx = Math.max(mL, Math.min(PAGE.width - mR - tw, tx));
    ty = Math.max(HEADER_H + mT, Math.min(PAGE.height - mB - 8, ty));
    h1.style.left = tx + 'mm';
    h1.style.top = ty + 'mm';

    var tMoveId = _fieldCounter++;
    h1.dataset.moveId = tMoveId;
    h1.setAttribute('data-movable', '1');
    moveSetters[tMoveId] = function (nx, ny) {
      d.titleX = nx;
      d.titleY = ny;
    };

    var titleHtml = isHidden(block, 'title') ? '' : h1.outerHTML;

    var w = parseFloat(d.imgWidth) || 160;
    var h = parseFloat(d.imgHeight) || 0;

    var wrap = document.createElement('div');
    wrap.className = 'img-wrap clients-wrap';
    wrap.style.position = 'absolute';

    var img = document.createElement('img');
    img.className = 'clients';
    img.src = d.image;
    img.style.width = w + 'mm';
    if (h > 0) img.style.height = h + 'mm';
    wrap.appendChild(img);

    var handle = document.createElement('span');
    handle.className = 'resize-handle';
    wrap.appendChild(handle);

    var resizeId = _fieldCounter++;
    wrap.dataset.resizeId = resizeId;
    imageResizeSetters[resizeId] = function (step, nw, nh) {
      d.imgWidth = nw;
      d.imgHeight = nh;
    };

    var moveId = _fieldCounter++;
    wrap.dataset.moveId = moveId;
    wrap.setAttribute('data-movable', '1');
    moveSetters[moveId] = function (nx, ny) {
      d.imgX = nx;
      d.imgY = ny;
    };

    var x = parseFloat(d.imgX);
    var y = parseFloat(d.imgY);
    if (isNaN(x)) x = mL + Math.max(0, (PAGE.width - mL - mR - w) / 2);
    if (isNaN(y)) y = HEADER_H + mT + 20;
    var hh = h > 0 ? h : w * 0.62;
    x = Math.max(mL, Math.min(PAGE.width - mR - w, x));
    y = Math.max(HEADER_H + mT, Math.min(PAGE.height - mB - hh, y));
    wrap.style.left = x + 'mm';
    wrap.style.top = y + 'mm';

    return titleHtml + wrap.outerHTML;
  }

  function buildTechnical(block) {
    var d = block.data;
    var html = '';
    var bl = block.label || 'Proposta Técnica';

    var h1 = document.createElement('h1');
    h1.className = 'editable';
    h1.contentEditable = 'true';
    h1.spellcheck = false;
    h1.innerHTML = (d.formatted && d.formatted.title) || esc(d.title || '');
    reg(h1, rich(function (v) { d.title = v; }, d, 'title'), bl + ' — título');
    if (!isHidden(block, 'title')) html += h1.outerHTML;

    var h2 = document.createElement('h2');
    h2.className = 'editable';
    h2.contentEditable = 'true';
    h2.spellcheck = false;
    h2.innerHTML = (d.formatted && d.formatted.subtitle) || esc(d.subtitle || '');
    reg(h2, rich(function (v) { d.subtitle = v; }, d, 'subtitle'), bl + ' — subtítulo');
    if (!isHidden(block, 'subtitle')) html += h2.outerHTML;

    (d.paragraphs || []).forEach(function (p, pi) {
      var pEl = document.createElement('p');
      pEl.className = 'editable';
      pEl.contentEditable = 'true';
      pEl.spellcheck = false;
      pEl.innerHTML = (d.formatted && d.formatted['para_' + pi]) || esc(p);
      reg(pEl, rich((function (index) { return function (v) { d.paragraphs[index] = v; }; })(pi), d, 'para_' + pi),
        bl + ' — parágrafo ' + (pi + 1));
      html += '<div class="par-el">' + pEl.outerHTML +
        '<button class="content-del" data-action="delTechPara" data-id="' + esc(block.id) + '" data-pi="' + pi + '" title="Remover parágrafo" aria-label="Remover parágrafo ' + (pi + 1) + '"></button></div>';
    });
    html += '<div class="add-tools">' +
      '<button class="btn btn-sm btn-secondary" data-action="addTechPara" data-id="' + esc(block.id) + '">+ Parágrafo</button>' +
      '</div>';

    return html;
  }

  function buildObligations(block) {
    var d = block.data;
    var html = '';

    var h2 = document.createElement('h2');
    h2.className = 'editable';
    h2.contentEditable = 'true';
    h2.spellcheck = false;
    h2.innerHTML = (d.formatted && d.formatted.title) || esc(d.title || '');
    reg(h2, rich(function (v) { d.title = v; }, d, 'title'), (block.label || 'Bloco') + ' — título');
    if (!isHidden(block, 'title')) html += h2.outerHTML;

    var h3a = document.createElement('h3');
    h3a.className = 'editable';
    h3a.contentEditable = 'true';
    h3a.spellcheck = false;
    h3a.innerHTML = (d.formatted && d.formatted.contractorTitle) || esc(d.contractorTitle || '');
    reg(h3a, rich(function (v) { d.contractorTitle = v; }, d, 'contractorTitle'),
      (block.label || 'Bloco') + ' — subtítulo contratada');
    if (!isHidden(block, 'contractorTitle')) html += h3a.outerHTML;

    html += '<ul>';
    (d.contractorItems || []).forEach(function (item, ii) {
      var li = document.createElement('li');
      var span = document.createElement('span');
      span.className = 'editable';
      span.contentEditable = 'true';
      span.spellcheck = false;
      span.innerHTML = (d.formatted && d.formatted['ci_' + ii]) || esc(item);
      reg(span, rich((function (index) { return function (v) { d.contractorItems[index] = v; }; })(ii), d, 'ci_' + ii),
        (block.label || 'Bloco') + ' — item contratada ' + (ii + 1));
      var btn = document.createElement('button');
      btn.className = 'content-del';
      btn.setAttribute('data-action', 'delObItem');
      btn.setAttribute('data-id', block.id);
      btn.setAttribute('data-list', 'contractorItems');
      btn.setAttribute('data-ii', ii);
      btn.title = 'Remover item';
      btn.setAttribute('aria-label', 'Remover item contratada ' + (ii + 1));
      li.appendChild(span);
      li.appendChild(btn);
      html += li.outerHTML;
    });
    html += '</ul>';
    html += '<div class="add-tools">' +
      '<button class="btn btn-sm btn-secondary" data-action="addObItem" data-id="' + esc(block.id) + '" data-list="contractorItems">+ Item Contratada</button>' +
      '</div>';

    var h3b = document.createElement('h3');
    h3b.className = 'editable';
    h3b.contentEditable = 'true';
    h3b.spellcheck = false;
    h3b.innerHTML = (d.formatted && d.formatted.clientTitle) || esc(d.clientTitle || '');
    reg(h3b, rich(function (v) { d.clientTitle = v; }, d, 'clientTitle'),
      (block.label || 'Bloco') + ' — subtítulo contratante');
    if (!isHidden(block, 'clientTitle')) html += h3b.outerHTML;

    html += '<ul>';
    (d.clientItems || []).forEach(function (item, ii) {
      var li = document.createElement('li');
      var span = document.createElement('span');
      span.className = 'editable';
      span.contentEditable = 'true';
      span.spellcheck = false;
      span.innerHTML = (d.formatted && d.formatted['cli_' + ii]) || esc(item);
      reg(span, rich((function (index) { return function (v) { d.clientItems[index] = v; }; })(ii), d, 'cli_' + ii),
        (block.label || 'Bloco') + ' — item contratante ' + (ii + 1));
      var btn = document.createElement('button');
      btn.className = 'content-del';
      btn.setAttribute('data-action', 'delObItem');
      btn.setAttribute('data-id', block.id);
      btn.setAttribute('data-list', 'clientItems');
      btn.setAttribute('data-ii', ii);
      btn.title = 'Remover item';
      btn.setAttribute('aria-label', 'Remover item contratante ' + (ii + 1));
      li.appendChild(span);
      li.appendChild(btn);
      html += li.outerHTML;
    });
    html += '</ul>';
    html += '<div class="add-tools">' +
      '<button class="btn btn-sm btn-secondary" data-action="addObItem" data-id="' + esc(block.id) + '" data-list="clientItems">+ Item Contratante</button>' +
      '</div>';

    return html;
  }

  function buildCommercial(block) {
    var d = block.data;
    var html = '';

    normalizeCommercial(d);

    var locked = isProposalApproved();

    var h1 = document.createElement('h1');
    h1.className = 'editable';
    h1.contentEditable = 'true';
    h1.spellcheck = false;
    h1.innerHTML = (d.formatted && d.formatted.title) || esc(d.title || '');
    reg(h1, rich(function (v) { d.title = v; }, d, 'title'), (block.label || 'Bloco') + ' — título');
    if (!isHidden(block, 'title')) html += h1.outerHTML;

    var pNum = document.createElement('p');
    pNum.className = 'bold editable';
    pNum.contentEditable = 'true';
    pNum.spellcheck = false;
    pNum.innerHTML = (d.formatted && d.formatted.proposalNumber) || esc(d.proposalNumber || '');
    reg(pNum, rich(function (v) { d.proposalNumber = v; }, d, 'proposalNumber'),
      (block.label || 'Bloco') + ' — número da proposta');
    html += pNum.outerHTML;

    var pDesc = document.createElement('p');
    pDesc.className = 'editable';
    pDesc.contentEditable = 'true';
    pDesc.spellcheck = false;
    pDesc.innerHTML = (d.formatted && d.formatted.description) || esc(d.description || '');
    reg(pDesc, rich(function (v) { d.description = v; }, d, 'description'),
      (block.label || 'Bloco') + ' — descrição');
    html += pDesc.outerHTML;

    html += buildCommercialTable(block, locked);

    return html;
  }

  function buildCommercialTable(block, locked) {
    var d = block.data;
    return '<div class="com-tbl-wrap">' + buildTableHTML({
      blockId: block.id,
      blockLabel: block.label || block.type,
      eid: undefined,
      data: d,
      locked: locked,
      setCol: function (ci) { return function (v) { d.cols[ci] = v; }; },
      setCell: function (ri, ci) { return function (v) { d.rows[ri][ci] = v; }; },
      addColAction: 'comColAdd', addRowAction: 'comRowAdd',
      delColAction: 'comColDel', delRowAction: 'comRowDel',
      showTotal: d.showTotal !== false
    }) + '</div>';
  }

  function buildTableHTML(o) {
    var d = o.data;
    var locked = !!o.locked;
    var eidAttr = o.eid !== undefined ? ' data-eid="' + o.eid + '"' : '';
    var bl = o.blockLabel || o.blockId || 'Tabela';
    var colName = function (ci) {
      var c = String(d.cols[ci] == null ? '' : d.cols[ci]).trim();
      return c || ('coluna ' + (ci + 1));
    };
    var html = '<table class="com-table"><thead><tr>';

    d.cols.forEach(function (label, ci) {
      var th = document.createElement('th');
      th.className = 'editable';
      th.contentEditable = locked ? 'false' : 'true';
      th.spellcheck = false;
      th.textContent = label;
      if (!locked) reg(th, o.setCol(ci), bl + ' — coluna ' + colName(ci));
      html += th.outerHTML;
    });
    if (locked) {
      html += '<th class="com-del-cell"></th>';
    } else {
      html += '<th class="com-del-cell"><button class="com-del-btn" data-action="' + o.delColAction + '" data-id="' + esc(o.blockId) + '"' + eidAttr + ' data-col="' + (d.cols.length - 1) + '" title="Excluir última coluna" aria-label="Excluir última coluna da tabela"><span aria-hidden="true">&#10005;</span></button></th>';
    }

    html += '</tr></thead><tbody>';

    d.rows.forEach(function (row, ri) {
      html += '<tr>';
      row.forEach(function (cell, ci) {
        var td = document.createElement('td');
        td.className = 'editable';
        td.contentEditable = locked ? 'false' : 'true';
        td.spellcheck = false;
        td.textContent = cell;
        if (!locked) reg(td, o.setCell(ri, ci),
          bl + ' — item ' + (ri + 1) + ', coluna ' + colName(ci));
        html += td.outerHTML;
      });
      if (locked) {
        html += '<td class="com-del-cell"></td>';
      } else {
        html += '<td class="com-del-cell"><button class="com-del-btn" data-action="' + o.delRowAction + '" data-id="' + esc(o.blockId) + '"' + eidAttr + ' data-row="' + ri + '" title="Excluir linha" aria-label="Excluir linha ' + (ri + 1) + ' da tabela"><span aria-hidden="true">&#10005;</span></button></td>';
      }
      html += '</tr>';
    });

    html += '</tbody>';

    if (o.showTotal) {
      var tci = global.CRE.totalColIndex(d.cols);
      if (tci !== null) {
        html += '<tfoot><tr class="com-total-row">';
        d.cols.forEach(function (c, ci) {
          if (ci === tci) html += '<td class="com-total-val"></td>';
          else html += '<td>' + (ci === 0 ? 'Total' : '') + '</td>';
        });
        html += '<td class="com-del-cell"></td></tr></tfoot>';
      }
    }

    html += '</table>';

    if (locked) {
      html += '<div class="com-tbl-tools com-tbl-locked"><span>Valores bloqueados — orçamento aprovado</span></div>';
    } else {
      html += '<div class="com-tbl-tools">' +
        '<button class="btn btn-sm btn-secondary" data-action="' + o.addColAction + '" data-id="' + esc(o.blockId) + '"' + eidAttr + '>+ Coluna</button>' +
        '<button class="btn btn-sm btn-secondary" data-action="' + o.addRowAction + '" data-id="' + esc(o.blockId) + '"' + eidAttr + '>+ Linha</button>' +
      '</div>';
    }

    return html;
  }

  function normalizeCommercial(d) {
    if (!Array.isArray(d.cols)) d.cols = ['Item', 'Quantidade', 'Descrição', 'Valor'];
    if (!Array.isArray(d.rows)) d.rows = [['1', '1', '', '']];
    if (d.showTotal === undefined) d.showTotal = true;
    normalizeTable(d);
  }

  var TOTAL_RE = /valor|total|pre\u00e7o|preco|custo|price|v\.? ?total/i;

  function recalcTableTotals(t) {
    var row = t.querySelector('tr.com-total-row');
    if (!row) return;
    var heads = Array.from(t.querySelectorAll('thead th')).filter(function (h) {
      return !h.classList.contains('com-del-cell');
    });
    var ci = -1;
    for (var i = 0; i < heads.length; i++) {
      if (TOTAL_RE.test((heads[i].textContent || '').trim())) { ci = i; break; }
    }
    if (ci < 0) { row.style.display = 'none'; return; }
    row.style.display = '';
    var sum = 0;
    Array.from(t.querySelectorAll('tbody tr')).forEach(function (tr) {
      var td = tr.cells[ci];
      if (td) sum += global.CRE.parseBRL(td.textContent);
    });
    var cell = row.querySelector('.com-total-val');
    if (cell) cell.textContent = global.CRE.fmtBRL(sum);
  }

  function recalcAllTableTotals() {
    $$('.com-table', docEl).forEach(recalcTableTotals);
  }

  function normalizeTable(t) {
    if (!Array.isArray(t.cols)) t.cols = ['Item', 'Quantidade', 'Descrição', 'Valor'];
    if (t.cols.length < 1) t.cols.push('');
    if (!Array.isArray(t.rows) || t.rows.length < 1) t.rows = [t.cols.map(function () { return ''; })];
    t.rows.forEach(function (r) {
      while (r.length < t.cols.length) r.push('');
      if (r.length > t.cols.length) r.length = t.cols.length;
    });
  }

  function makeExtra(type) {
    if (type === 'text')  return { type: 'text', content: '' };
    if (type === 'image') return { type: 'image', src: 'assets/reservatorio-1.jpg', width: 120, height: 0 };
    if (type === 'table') return { type: 'table', cols: ['Item', 'Quantidade', 'Descrição', 'Valor'], rows: [['1', '1', '', '']] };
    return null;
  }

  function blockById(blockId) {
    return state.blocks.find(function (b) { return b.id === blockId; });
  }

  function mdlArray(block, path) {
    var parts = String(path || '').split('.');
    var v = block.data;
    for (var i = 0; i < parts.length && v != null; i++) v = v[parts[i]];
    return Array.isArray(v) ? v : null;
  }

  function getCommercialData(blockId) {
    var b = blockById(blockId);
    return b ? b.data : null;
  }

  function addCommercialColumn(blockId) {
    var d = getCommercialData(blockId);
    if (!d) return;
    pushHistory();
    normalizeCommercial(d);
    d.cols.push('');
    d.rows.forEach(function (r) { r.push(''); });
    saveToStorage();
    render();
  }

  function addCommercialRow(blockId) {
    var d = getCommercialData(blockId);
    if (!d) return;
    pushHistory();
    normalizeCommercial(d);
    d.rows.push(d.cols.map(function () { return ''; }));
    saveToStorage();
    render();
  }

  function removeCommercialColumn(blockId, ci) {
    var d = getCommercialData(blockId);
    if (!d) return;
    pushHistory();
    normalizeCommercial(d);
    if (d.cols.length <= 2) return;
    d.cols.splice(ci, 1);
    d.rows.forEach(function (r) { r.splice(ci, 1); });
    saveToStorage();
    render();
  }

  function removeCommercialRow(blockId, ri) {
    var d = getCommercialData(blockId);
    if (!d) return;
    pushHistory();
    normalizeCommercial(d);
    if (d.rows.length <= 1) return;
    d.rows.splice(ri, 1);
    saveToStorage();
    render();
  }

  function addTechPara(blockId) {
    var b = blockById(blockId);
    if (!b) return;
    pushHistory();
    b.data.paragraphs = b.data.paragraphs || [];
    b.data.paragraphs.push('');
    saveToStorage();
    render();
  }

  function delTechPara(blockId, pi) {
    var b = blockById(blockId);
    if (!b) return;
    pushHistory();
    b.data.paragraphs = b.data.paragraphs || [];
    b.data.paragraphs.splice(pi, 1);
    rebaseFormatted(b.data, 'para_', b.data.paragraphs.length);
    saveToStorage();
    render();
  }

  function addObItem(blockId, listKey) {
    var b = blockById(blockId);
    if (!b) return;
    pushHistory();
    b.data[listKey] = b.data[listKey] || [];
    b.data[listKey].push('');
    saveToStorage();
    render();
  }

  function delObItem(blockId, listKey, ii) {
    var b = blockById(blockId);
    if (!b) return;
    pushHistory();
    b.data[listKey] = b.data[listKey] || [];
    b.data[listKey].splice(ii, 1);
    rebaseFormatted(b.data, listKey === 'contractorItems' ? 'ci_' : 'cli_', b.data[listKey].length);
    saveToStorage();
    render();
  }

  function addExtra(blockId, type) {
    var b = blockById(blockId);
    if (!b) return;
    pushHistory();
    b.data.extras = b.data.extras || [];
    var ex = makeExtra(type);
    if (ex) b.data.extras.push(ex);
    saveToStorage();
    render();
  }

  function delExtra(blockId, eid) {
    var b = blockById(blockId);
    if (!b) return;
    pushHistory();
    b.data.extras = b.data.extras || [];
    b.data.extras.splice(eid, 1);
    saveToStorage();
    render();
  }

  function extraTableOp(blockId, op, eid, idx) {
    var b = blockById(blockId);
    if (!b || !Array.isArray(b.data.extras) || !b.data.extras[eid]) return;
    var ex = b.data.extras[eid];
    if (ex.type !== 'table') return;
    pushHistory();
    normalizeTable(ex);
    if (op === 'addCol') {
      ex.cols.push('');
      ex.rows.forEach(function (r) { r.push(''); });
    } else if (op === 'addRow') {
      ex.rows.push(ex.cols.map(function () { return ''; }));
    } else if (op === 'delCol') {
      if (ex.cols.length <= 2) return;
      ex.cols.splice(idx, 1);
      ex.rows.forEach(function (r) { r.splice(idx, 1); });
    } else if (op === 'delRow') {
      if (ex.rows.length <= 1) return;
      ex.rows.splice(idx, 1);
    }
    saveToStorage();
    render();
  }

  function buildClosing(block) {
    var d = block.data;
    var html = '';
    var bl = block.label || 'Bloco';
    var closingLabels = {
      payment: 'pagamento',
      production: 'prazo de produção',
      installation: 'instalação',
      warranty: 'garantia',
      validity: 'validade'
    };

    var fields = [
      { key: 'payment' },
      { key: 'production' },
      { key: 'installation' },
      { key: 'warranty', spaced: true },
      { key: 'validity', spaced: true }
    ];

    fields.forEach(function (f) {
      var p = document.createElement('p');
      p.className = 'editable' + (f.spaced ? ' spaced' : '');
      p.contentEditable = 'true';
      p.spellcheck = false;
      p.innerHTML = (d.formatted && d.formatted[f.key]) || esc(d[f.key] || '');
      reg(p, rich((function (k) { return function (v) { d[k] = v; }; })(f.key), d, f.key),
        bl + ' — ' + (closingLabels[f.key] || f.key));
      html += p.outerHTML;
    });

    if (d.bank) {
      html += '<div class="bank">';
      var bh3 = document.createElement('h3');
      bh3.className = 'editable';
      bh3.contentEditable = 'true';
      bh3.spellcheck = false;
      bh3.innerHTML = (d.formatted && d.formatted.bankTitle) || esc(d.bank.title || '');
      reg(bh3, rich(function (v) { d.bank.title = v; }, d, 'bankTitle'), bl + ' — dados bancários, título');
      html += bh3.outerHTML;

      (d.bank.lines || []).forEach(function (line, li) {
        var bp = document.createElement('p');
        bp.className = 'editable';
        bp.contentEditable = 'true';
        bp.spellcheck = false;
        bp.innerHTML = (d.formatted && d.formatted['bank_' + li]) || esc(line);
        reg(bp, rich((function (index) { return function (v) { d.bank.lines[index] = v; }; })(li), d, 'bank_' + li),
          bl + ' — dados bancários, linha ' + (li + 1));
        html += bp.outerHTML;
      });
      html += '</div>';
    }

    if (d.signature) {
      html += '<div class="signature">';

      var phoneSpan = document.createElement('span');
      phoneSpan.className = 'editable';
      phoneSpan.contentEditable = 'true';
      phoneSpan.spellcheck = false;
      phoneSpan.innerHTML = (d.formatted && d.formatted.sigPhone) || esc(d.signature.phone || '');
      reg(phoneSpan, rich(function (v) { d.signature.phone = v; }, d, 'sigPhone'), bl + ' — assinatura, telefone');
      html += phoneSpan.outerHTML;

      var greetingHtml = (d.formatted && d.formatted.greeting) || '', greetingTxt = d.signature.greeting || '';
      html += (greetingHtml ? greetingHtml : esc(greetingTxt)) + '<br><br>';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'editable';
      nameSpan.contentEditable = 'true';
      nameSpan.spellcheck = false;
      nameSpan.innerHTML = (d.formatted && d.formatted.sigName) || esc(d.signature.name || '');
      reg(nameSpan, rich(function (v) { d.signature.name = v; }, d, 'sigName'), bl + ' — assinatura, nome');
      html += nameSpan.outerHTML;

      html += ' ';

      var emailSpan = document.createElement('span');
      emailSpan.className = 'editable';
      emailSpan.contentEditable = 'true';
      emailSpan.spellcheck = false;
      emailSpan.innerHTML = (d.formatted && d.formatted.sigEmail) || esc(d.signature.email || '');
      reg(emailSpan, rich(function (v) { d.signature.email = v; }, d, 'sigEmail'), bl + ' — assinatura, e-mail');
      html += emailSpan.outerHTML;

      html += '</div>';
    }

    return html;
  }

  function isBlankHtml(html) {
    return !String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  }

  function buildCustom(block) {
    var d = block.data;
    var div = document.createElement('div');
    div.className = 'editable';
    div.contentEditable = 'true';
    div.spellcheck = false;
    div.style.minHeight = '12mm';
    if (!isBlankHtml(d.html)) div.innerHTML = d.html;
    div.setAttribute('data-placeholder', 'Bloco Livre — clique aqui e digite o conteúdo...');
    reg(div, function (v) { d.html = v; }, (block.label || 'Bloco') + ' — conteúdo livre');
    return div.outerHTML;
  }

  function buildGallery(block) {
    var d = block.data;
    var html = '';
    var bl = block.label || 'Bloco';

    var h2 = document.createElement('h2');
    h2.className = 'editable';
    h2.contentEditable = 'true';
    h2.spellcheck = false;
    h2.innerHTML = (d.formatted && d.formatted.title) || esc(d.title || '');
    reg(h2, rich(function (v) { d.title = v; }, d, 'title'), bl + ' — título');
    if (!isHidden(block, 'title')) html += h2.outerHTML;

    if (!Array.isArray(d.items)) d.items = [];
    html += '<div class="gallery-grid">';
    d.items.forEach(function (it, ii) {
      var w = parseFloat(it.width) || 90;
      var h = parseFloat(it.height) || 0;
      var wrap = document.createElement('span');
      wrap.className = 'img-wrap gallery-item';
      var img = document.createElement('img');
      img.src = it.src || '';
      img.style.width = w + 'mm';
      if (h > 0) img.style.height = h + 'mm';
      wrap.appendChild(img);
      var handle = document.createElement('span');
      handle.className = 'resize-handle';
      wrap.appendChild(handle);
      var rid = _fieldCounter++;
      wrap.dataset.resizeId = rid;
      imageResizeSetters[rid] = (function (i) {
        return function (step, nw, nh) { d.items[i].width = nw; d.items[i].height = nh; };
      })(ii);
      html += '<div class="gallery-item-wrap">' + wrap.outerHTML +
        '<button class="content-del" data-action="galleryDel" data-id="' + esc(block.id) + '" data-gi="' + ii + '" title="Remover imagem" aria-label="Remover imagem ' + (ii + 1) + ' da galeria"></button></div>';
    });
    html += '</div>';
    html += '<div class="add-tools">' +
      '<button class="btn btn-sm btn-secondary" data-action="galleryAdd" data-id="' + esc(block.id) + '">+ Imagem</button>' +
      '</div>';

    return html;
  }

  function addGalleryItem(blockId) {
    var b = blockById(blockId);
    if (!b) return;
    pushHistory();
    b.data.items = b.data.items || [];
    var used = b.data.items.length % 4;
    b.data.items.push({ src: 'assets/reservatorio-' + (used + 1) + '.jpg', width: 90, height: 0 });
    saveToStorage();
    render();
  }

  function delGalleryItem(blockId, gi) {
    var b = blockById(blockId);
    if (!b) return;
    pushHistory();
    b.data.items.splice(gi, 1);
    saveToStorage();
    render();
  }

  /* ── Editores inline ─────────────────────── */

  function commitActiveEdit() {
    if (!activeEditable) return;
    activeEditable.blur();
    activeEditable = null;
  }

  function saveEditable(el) {
    if (!el || !el.getAttribute('data-field-id')) return;
    var fieldId = el.getAttribute('data-field-id');
    var setter = fieldSetters[fieldId];
    if (!setter) return;
    if (el.tagName === 'TH' || el.tagName === 'TD') {
      var cellValue = el.innerText;
      el.textContent = cellValue;
      setter(cellValue);
    } else {
      normalizeFontTags(el);
      setter(el.innerHTML);
    }
  }

  function attachInlineEditors() {
    $$('.editable', docEl).forEach(function (el) {
      el.addEventListener('focus', function () {
        activeEditable = this;
        pushHistory();
        var pg = this.closest('.page');
        if (pg && pg.dataset.blockId) selectBlock(pg.dataset.blockId);
      });
      el.addEventListener('mousedown', function () {
        activeEditable = this;
      });
      el.addEventListener('input', function () {
        markDirty();
        updateStatusBar();
        var tbl = this.closest('.com-table');
        if (tbl) recalcTableTotals(tbl);
      });
      el.addEventListener('blur', function () {
        saveEditable(this);
        if (activeEditable === this) activeEditable = null;
      });
      el.addEventListener('keydown', function (e) {
        if ((this.tagName === 'TD' || this.tagName === 'TH') && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.blur();
        }
      });
      el.addEventListener('click', function (e) {
        if (this.tagName === 'A') e.preventDefault();
      });
      if (el.getAttribute('data-placeholder')) {
        el.addEventListener('dblclick', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var range = document.createRange();
          range.selectNodeContents(this);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          this.focus();
        });
      }
    });
  }

  function attachBlockDblClick() {
    $$('.page', docEl).forEach(function (page) {
      page.addEventListener('dblclick', function (e) {
        if (e.target.closest('button, .resize-handle, .margin-guide, .content-del, .add-tools, .com-tbl-tools')) return;
        var blockId = page.dataset.blockId;
        if (blockId) openEditModal(blockId);
      });
    });
  }

  function normalizeFontTags(el) {
    if (!el) return;
    el.querySelectorAll('font[size]').forEach(function (f) {
      if (!f.style.fontSize && FONT_SIZES[f.getAttribute('size')]) {
        f.style.fontSize = FONT_SIZES[f.getAttribute('size')];
        f.removeAttribute('size');
      }
    });
  }

  function applyLineHeight(val) {
    var ok = false;
    try { ok = document.execCommand('lineHeight', false, val); } catch (e) { ok = false; }
    if (ok) return;
    var sel = document.getSelection();
    if (sel.rangeCount) {
      var node = sel.getRangeAt(0).commonAncestorContainer;
      var el = node.nodeType === 1 ? node : node.parentElement;
      el = el && el.closest ? (el.closest('.editable') || el) : el;
      if (el) el.style.lineHeight = val;
    }
  }

  /* ── Ribbon (Word-like) ──────────────────── */

  function isInEditable() {
    var sel = document.getSelection();
    if (!sel.rangeCount) return false;
    var c = sel.getRangeAt(0).commonAncestorContainer;
    var el = c.nodeType === 1 ? c : c.parentElement;
    return !!el.closest('.editable');
  }

  function restoreRange() {
    if (!savedRange) return;
    try {
      var sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange.cloneRange());
    } catch (e) { /* silent */ }
  }

  document.addEventListener('selectionchange', function () {
    var sel = document.getSelection();
    if (sel && sel.rangeCount) {
      var r = sel.getRangeAt(0);
      if (r) {
        var c = r.commonAncestorContainer;
        var el = c.nodeType === 1 ? c : c.parentElement;
        if (el && el.closest && el.closest('.editable')) {
          savedRange = r.cloneRange();
          activeEditable = el.closest('.editable');
        }
      }
    }
    if (isInEditable()) syncRibbon();
  });

  function syncRibbon() {
    $$('.ribbon .rb-btn[data-cmd]').forEach(function (btn) {
      var cmd = btn.dataset.cmd;
      if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline' ||
          cmd === 'strikeThrough' || cmd === 'subscript' || cmd === 'superscript' ||
          cmd === 'justifyLeft' || cmd === 'justifyCenter' || cmd === 'justifyRight' ||
          cmd === 'justifyFull' || cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') {
        var on = false;
        try { on = document.queryCommandState(cmd); } catch (e) { on = false; }
        btn.classList.toggle('active', on);
      }
    });
    var fontSel = $('.ribbon select[data-cmd="fontName"]');
    var sizeSel = $('.ribbon select[data-cmd="fontSize"]');
    var lhSel = $('.ribbon select[data-cmd="lineHeight"]');
    if (fontSel) { try { fontSel.value = document.queryCommandValue('fontName').replace(/['"]/g, ''); } catch (e) {} }
    if (sizeSel) { try { var sv = document.queryCommandValue('fontSize'); sizeSel.value = FONT_SIZES[sv] ? sv : (FONT_SIZES[sv] ? sv : '3'); } catch (e) {} }
    if (lhSel) { try { lhSel.value = String(parseFloat(document.queryCommandValue('lineHeight')) || 2); } catch (e) {} }
  }

  function editableFromRange() {
    var sel = document.getSelection();
    if (sel && sel.rangeCount) {
      var c = sel.getRangeAt(0).commonAncestorContainer;
      var el = c.nodeType === 1 ? c : c.parentElement;
      if (el && el.closest) return el.closest('.editable');
    }
    if (savedRange) {
      var c2 = savedRange.commonAncestorContainer;
      var el2 = c2.nodeType === 1 ? c2 : c2.parentElement;
      if (el2 && el2.closest) return el2.closest('.editable');
    }
    return null;
  }

  function saveActive() {
    var el = activeEditable || editableFromRange();
    saveEditable(el);
    saveToStorage();
    updateStatusBar();
  }

  function insertTableCmd() {
    restoreRange();
    var html = '<table class="com-table" style="margin:4mm 0;border-collapse:collapse;width:100%">' +
      '<tbody>' +
      '<tr><td style="border:.25mm solid #111;padding:2mm">&nbsp;</td><td style="border:.25mm solid #111;padding:2mm">&nbsp;</td></tr>' +
      '<tr><td style="border:.25mm solid #111;padding:2mm">&nbsp;</td><td style="border:.25mm solid #111;padding:2mm">&nbsp;</td></tr>' +
      '</tbody></table><br>';
    try { document.execCommand('insertHTML', false, html); } catch (e) { /* silent */ }
    saveActive();
  }

  function initRibbon() {
    $$('.ribbon .rb-btn[data-cmd]').forEach(function (btn) {
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); restoreRange(); });
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var cmd = btn.dataset.cmd;
        restoreRange();
        try {
          if (cmd === 'insertTable') insertTableCmd();
          else document.execCommand(cmd, false, null);
        } catch (err) { /* silent */ }
        saveActive();
        syncRibbon();
      });
    });

    $$('.ribbon select[data-cmd]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var cmd = sel.dataset.cmd;
        var val = sel.value;
        restoreRange();
        try {
          if (cmd === 'fontName') document.execCommand('fontName', false, val);
          else if (cmd === 'fontSize') document.execCommand('fontSize', false, val);
          else if (cmd === 'lineHeight') applyLineHeight(val);
        } catch (err) { /* silent */ }
        saveActive();
      });
    });

    var textColor = $('#textColor');
    var hiliteColor = $('#hiliteColor');
    if (textColor) {
      textColor.addEventListener('input', function () {
        restoreRange();
        try { document.execCommand('foreColor', false, textColor.value); } catch (e) {}
        saveActive();
      });
    }
    if (hiliteColor) {
      hiliteColor.addEventListener('input', function () {
        restoreRange();
        try { document.execCommand('hiliteColor', false, hiliteColor.value); } catch (e) {}
        saveActive();
      });
    }

    $('#rbLink').addEventListener('click', function () {
      var url = prompt('URL do link:', 'https://');
      if (!url) return;
      restoreRange();
      try { document.execCommand('createLink', false, url); } catch (e) {}
      saveActive();
    });

    $('#rbImage').addEventListener('click', function () {
      restoreRange();
      $('#imgInput').click();
    });

    $('#imgInput').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        restoreRange();
        try { document.execCommand('insertImage', false, reader.result); } catch (err) {}
        saveActive();
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    $('#rbWords').addEventListener('click', function () {
      var stats = countWords();
      global.CRE.openModal('Contagem',
        '<div class="stat-grid" style="grid-template-columns:1fr 1fr;margin-bottom:8px">' +
          '<div class="stat-card"><div><div class="stat-num">' + stats.words + '</div><div class="stat-lbl">Palavras</div></div></div>' +
          '<div class="stat-card"><div><div class="stat-num">' + stats.chars + '</div><div class="stat-lbl">Caracteres</div></div></div>' +
        '</div>' +
        '<div class="btn-row" style="justify-content:flex-end"><button class="btn btn-secondary" id="cfWordsClose">Fechar</button></div>');
      $('#cfWordsClose').addEventListener('click', global.CRE.closeModal);
    });

    $('#rbFind').addEventListener('click', openFind);
  }

  function countWords() {
    var txt = '';
    $$('.editable', docEl).forEach(function (el) { txt += ' ' + (el.innerText || ''); });
    var words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
    var chars = txt.replace(/\s+/g, '').length;
    return { words: words, chars: chars };
  }

  function updateStatusBar() {
    var stats = countWords();
    var nPages = state.blocks.length || 0;
    if (sbWordsEl) sbWordsEl.textContent = stats.words + ' palavras · ' + stats.chars + ' caracteres';
    if (sbPageEl) sbPageEl.textContent = nPages + (nPages === 1 ? ' página' : ' páginas');
    var prop = getActiveProposal();
    if (sbProposalNameEl && prop) sbProposalNameEl.textContent = prop.name || 'Proposta sem nome';
    syncPaperLabel();
    updateRevUI();
  }

  /* ── Localizar / substituir ──────────────── */

  var findState = null;

  function creEscapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function findCollect() {
    var q = $('#findQuery').value.trim();
    if (!q) return [];
    var regex = new RegExp(creEscapeRegExp(q), 'ig');
    var out = [];
    $$('.editable', docEl).forEach(function (el) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = walker.nextNode())) {
        var text = n.nodeValue || '';
        if (!text) continue;
        var re = new RegExp(creEscapeRegExp(q), 'ig');
        var m;
        while ((m = re.exec(text))) {
          out.push({ el: el, node: n, start: m.index, len: m[0].length });
        }
      }
    });
    return out;
  }

  function findRefresh() {
    findState = { q: $('#findQuery').value.trim(), matches: findCollect(), idx: -1 };
    updateFindInfo();
  }

  function updateFindInfo() {
    var info = $('#findInfo');
    if (!info) return;
    if (!findState || !findState.q) {
      info.innerHTML = '';
      return;
    }
    info.innerHTML = findState.matches.length
      ? (findState.idx + 1) + ' de <mark>' + findState.matches.length + '</mark> ocorrência(s)'
      : 'Nenhuma ocorrência encontrada.';
  }

  function findNavigate() {
    if (!findState || !findState.matches.length) return;
    findState.idx = (findState.idx + 1) % findState.matches.length;
    var m = findState.matches[findState.idx];
    m.el.focus();
    var sel = global.getSelection();
    var range = document.createRange();
    range.setStart(m.node, m.start);
    range.setEnd(m.node, m.start + m.len);
    sel.removeAllRanges();
    sel.addRange(range);
    m.el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    updateFindInfo();
  }

  function findReplaceCurrent() {
    if (!findState || !findState.matches.length) return;
    var m = findState.matches[findState.idx];
    var rep = $('#findReplace').value;
    m.node.nodeValue = m.node.nodeValue.slice(0, m.start) + rep + m.node.nodeValue.slice(m.start + m.len);
    saveEditable(m.el);
    saveToStorage();
    updateStatusBar();
    findRefresh();
    findNavigate();
  }

  function findReplaceAll() {
    var q = $('#findQuery').value.trim();
    var rep = $('#findReplace').value;
    if (!q) return;
    findState = { q: q, matches: findCollect(), idx: -1 };
    var matches = findState.matches;
    if (!matches.length) { updateFindInfo(); return; }
    for (var i = matches.length - 1; i >= 0; i--) {
      var m = matches[i];
      m.node.nodeValue = m.node.nodeValue.slice(0, m.start) + rep + m.node.nodeValue.slice(m.start + m.len);
    }
    var touched = {};
    matches.forEach(function (mm) { touched[mm.el.getAttribute('data-field-id')] = mm.el; });
    for (var id in touched) saveEditable(touched[id]);
    saveToStorage();
    updateStatusBar();
    render();
    findRefresh();
  }

  function openFind() {
    var ov = $('#findOverlay');
    if (!ov) return;
    ov.classList.add('open');
    var q = $('#findQuery');
    q.value = '';
    trapOverlay(ov, q);
    q.focus();
    findRefresh();
  }

  function closeFind() {
    var ov = $('#findOverlay');
    if (ov) ov.classList.remove('open');
    findState = null;
  }

  function initFind() {
    $('#btnFindNext').addEventListener('click', findNavigate);
    $('#btnFindReplace').addEventListener('click', findReplaceCurrent);
    $('#btnFindReplaceAll').addEventListener('click', findReplaceAll);
    $('#btnFindDone').addEventListener('click', closeFind);
    $('#findClose').addEventListener('click', closeFind);
    $('#findQuery').addEventListener('input', findRefresh);
    $('#findOverlay').addEventListener('click', function (e) { if (e.target === this) closeFind(); });
  }

  /* ── Sidebar ─────────────────────────────── */

  function renderSidebar() {
    blockListEl.innerHTML = '';
    var total = state.blocks.length;
    var hint = ensureMoveHint();
    state.blocks.forEach(function (block, i) {
      var el = document.createElement('div');
      el.className = 'block-item';
      el.dataset.blockId = block.id;
      el.draggable = true;
      el.setAttribute('role', 'listitem');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', 'Bloco ' + (i + 1) + ' de ' + total + ': ' + block.label);
      if (hint) el.setAttribute('aria-describedby', hint.id);
      el.innerHTML =
        '<span class="drag-handle" aria-hidden="true">&#9776;</span>' +
        '<span class="block-label">' + (BLOCK_TYPES[block.type] ? BLOCK_TYPES[block.type].icon : '') + ' ' + esc(block.label) + '</span>' +
        '<span class="block-actions">' +
          '<button data-action="editBlock" data-id="' + block.id + '" title="Editar" aria-label="Editar bloco ' + (i + 1) + ': ' + esc(block.label) + '"><span aria-hidden="true">&#9998;</span></button>' +
          '<button data-action="duplicate" data-id="' + block.id + '" title="Duplicar" aria-label="Duplicar bloco ' + (i + 1) + ': ' + esc(block.label) + '"><span aria-hidden="true">&#10697;</span></button>' +
          '<button data-action="delete" data-id="' + block.id + '" title="Remover" class="delete-btn" aria-label="Remover bloco ' + (i + 1) + ': ' + esc(block.label) + '"><span aria-hidden="true">&#10005;</span></button>' +
        '</span>';
      el.addEventListener('click', function (e) {
        if (e.target.closest('.block-actions')) return;
        scrollToBlock(block.id);
        selectBlock(block.id);
      });
      el.addEventListener('dblclick', function (e) {
        if (e.target.closest('.block-actions')) return;
        openEditModal(block.id);
      });
      /* Reordenação por teclado: mesma gravação do drag, mas determinística. */
      el.addEventListener('keydown', function (e) {
        var delta = 0;
        if (e.altKey && e.key === 'ArrowUp') delta = -1;
        else if (e.altKey && e.key === 'ArrowDown') delta = 1;
        if (delta !== 0 && this.contains(e.target)) {
          e.preventDefault();
          moveBlockBy(this.dataset.blockId, delta, 'sidebar');
          return;
        }
        if (e.target !== this) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          scrollToBlock(this.dataset.blockId);
          selectBlock(this.dataset.blockId);
        } else if (e.key === 'F2') {
          e.preventDefault();
          openEditModal(this.dataset.blockId);
        }
      });
      blockListEl.appendChild(el);
    });
    attachSidebarDragDrop();
  }

  function highlightBlock(blockId) {
    $$('.block-item', blockListEl).forEach(function (el) { el.classList.remove('active'); });
    var el = $('.block-item[data-block-id="' + blockId + '"]');
    if (el) {
      el.classList.add('active');
      if (el.scrollIntoView) el.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
    }
  }

  function selectBlock(blockId) {
    selectedBlockId = blockId || null;
    $$('.page', docEl).forEach(function (p) {
      p.classList.toggle('selected', selectedBlockId && p.dataset.blockId === selectedBlockId);
    });
    if (selectedBlockId) highlightBlock(selectedBlockId);
  }

  function attachPageSelection() {
    $$('.page', docEl).forEach(function (page) {
      page.addEventListener('mousedown', function (e) {
        if (e.target.closest('.editable, .page-controls, .margin-guide, .resize-handle, .content-del, .add-tools, .com-tbl-tools')) return;
        var blockId = page.dataset.blockId;
        if (blockId) selectBlock(blockId);
      });
    });
  }

  function scrollToBlock(blockId) {
    var page = $('.page[data-block-id="' + blockId + '"]');
    if (page) page.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  }

  function updatePageNumbers() {
    $$('.page-num', docEl).forEach(function (span, i) {
      span.textContent = i + 1;
    });
  }

  var draggedId = null;

  /* Reordenação por teclado (Alt+↑/Alt+↓ na barra lateral) e pelos
     botões ▲/▼ da página — mesma gravação do drag. */
  function moveBlockBy(blockId, delta, source) {
    var total = state.blocks.length;
    var idx = -1;
    for (var i = 0; i < total; i++) {
      if (state.blocks[i].id === blockId) { idx = i; break; }
    }
    if (idx === -1) return false;

    var next = idx + delta;
    if (next < 0 || next >= total) {
      announce(idx === 0 ? 'Já é o primeiro bloco.' : 'Já é o último bloco.');
      return false;
    }

    pushHistory();
    var moved = state.blocks.splice(idx, 1)[0];
    state.blocks.splice(next, 0, moved);
    selectedBlockId = moved.id;
    saveToStorage();
    render();
    announce('Bloco ' + (idx + 1) + ' de ' + total + ' movido para a posição ' + (next + 1) + ' de ' + total);

    var focusEl;
    if (source === 'sidebar') {
      focusEl = $('.block-item[data-block-id="' + moved.id + '"]');
    } else {
      focusEl = $('.page-controls [data-action="' + (delta < 0 ? 'moveUp' : 'moveDown') + '"][data-id="' + moved.id + '"]', docEl);
    }
    if (focusEl && focusEl.focus) focusEl.focus();
    return true;
  }

  function attachSidebarDragDrop() {
    $$('.block-item', blockListEl).forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        draggedId = this.dataset.blockId;
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', function () {
        this.classList.remove('dragging');
        draggedId = null;
        $$('.block-item', blockListEl).forEach(function (e2) { e2.classList.remove('drag-over'); });
      });
      el.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drag-over');
      });
      el.addEventListener('dragleave', function () {
        this.classList.remove('drag-over');
      });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        if (!draggedId) return;
        var targetId = this.dataset.blockId;
        if (draggedId === targetId) return;
        var fromIdx = state.blocks.findIndex(function (b) { return b.id === draggedId; });
        var toIdx = state.blocks.findIndex(function (b) { return b.id === targetId; });
        if (fromIdx === -1 || toIdx === -1) return;
        pushHistory();
        var moved = state.blocks.splice(fromIdx, 1)[0];
        var insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
        state.blocks.splice(insertAt, 0, moved);
        saveToStorage();
        render();
      });
    });
  }

  /* ── Ações de página (delegação) ─────────── */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (!docEl.contains(btn) && !blockListEl.contains(btn)) return;
    var action = btn.dataset.action;
    var id = btn.dataset.id;

    if (action === 'delete') {
      if (confirm('Remover este bloco?')) {
        pushHistory();
        state.blocks = state.blocks.filter(function (b) { return b.id !== id; });
        saveToStorage();
        render();
      }
    } else if (action === 'duplicate') {
      var block = state.blocks.find(function (b) { return b.id === id; });
      if (block) {
        pushHistory();
        var copy = JSON.parse(JSON.stringify(block));
        copy.id = genId();
        copy.label += ' (cópia)';
        var idx = state.blocks.indexOf(block);
        state.blocks.splice(idx + 1, 0, copy);
        saveToStorage();
        render();
      }
    } else if (action === 'moveUp') {
      moveBlockBy(id, -1, 'page');
    } else if (action === 'moveDown') {
      moveBlockBy(id, 1, 'page');
    } else if (action === 'edit' || action === 'editBlock') {
      openEditModal(id);
    } else if (action === 'comRowAdd') {
      addCommercialRow(id);
    } else if (action === 'comRowDel') {
      removeCommercialRow(id, parseInt(btn.dataset.row, 10));
    } else if (action === 'comColAdd') {
      addCommercialColumn(id);
    } else if (action === 'comColDel') {
      removeCommercialColumn(id, parseInt(btn.dataset.col, 10));
    } else if (action === 'addTechPara') {
      addTechPara(id);
    } else if (action === 'delTechPara') {
      delTechPara(id, parseInt(btn.dataset.pi, 10));
    } else if (action === 'addObItem') {
      addObItem(id, btn.dataset.list);
    } else if (action === 'delObItem') {
      delObItem(id, btn.dataset.list, parseInt(btn.dataset.ii, 10));
    } else if (action === 'addExtra') {
      addExtra(id, btn.dataset.type);
    } else if (action === 'delExtra') {
      delExtra(id, parseInt(btn.dataset.eid, 10));
    } else if (action === 'galleryAdd') {
      addGalleryItem(id);
    } else if (action === 'galleryDel') {
      delGalleryItem(id, parseInt(btn.dataset.gi, 10));
    } else if (action === 'exColAdd') {
      extraTableOp(id, 'addCol', parseInt(btn.dataset.eid, 10));
    } else if (action === 'exRowAdd') {
      extraTableOp(id, 'addRow', parseInt(btn.dataset.eid, 10));
    } else if (action === 'exColDel') {
      extraTableOp(id, 'delCol', parseInt(btn.dataset.eid, 10), parseInt(btn.dataset.col, 10));
    } else if (action === 'exRowDel') {
      extraTableOp(id, 'delRow', parseInt(btn.dataset.eid, 10), parseInt(btn.dataset.row, 10));
    }
  });

  /* ── Modal (bloco) ───────────────────────── */

  function openModal(returnSelector) {
    overlayEl.classList.add('open');
    trapOverlay(overlayEl, focusableWithin(modalBodyEl)[0] || $('#modalClose'), returnSelector);
  }
  function closeModal() { overlayEl.classList.remove('open'); }

  /* ── Adicionar bloco ─────────────────────── */

  function buildAddBlockForm() {
    var html = '<div class="block-type-grid" role="radiogroup" aria-label="Tipo de bloco">';
    var types = Object.keys(BLOCK_TYPES);
    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      html += '<div class="block-type-option" data-type="' + t + '" role="radio" aria-checked="false" tabindex="' + (i === 0 ? '0' : '-1') + '">' +
        '<span class="bt-icon" aria-hidden="true">' + BLOCK_TYPES[t].icon + '</span>' +
        '<span class="bt-label">' + esc(BLOCK_TYPES[t].label) + '</span>' +
      '</div>';
    }
    html += '</div>';
    html += '<label><span>Nome do bloco</span><input type="text" id="newBlockLabel" placeholder="Ex: Proposta Técnica"></label>';
    html += '<div class="btn-row">';
    html += '<button class="btn btn-secondary" id="modalCancelBtn">Cancelar</button>';
    html += '<button class="btn btn-primary" id="modalAddBtn" disabled>Adicionar</button>';
    html += '</div>';
    return html;
  }

  function createDefaultBlock(type, label) {
    var id = genId();
    var defaults = {
      cover: {
        date: '', recipient: '', proposalNumber: '', contactName: '', contactPhone: '', address: '',
        georevestContacts: [{ name: '', role: '', phone: '', email: '' }]
      },
      clients: { title: label, image: 'assets/clientes-atendidos.jpg' },
      technical: { title: label, subtitle: '', paragraphs: [''] },
      obligations: { title: label, contractorTitle: 'Obrigações da Contratada:', contractorItems: [''], clientTitle: 'Obrigações da Contratante:', clientItems: [''] },
      commercial: { title: label, proposalNumber: '', description: '', cols: ['Item', 'Quantidade', 'Descrição', 'Valor'], rows: [['1', '1', '', '']] },
      closing: { payment: '', production: '', installation: '', warranty: '', validity: '', bank: { title: 'Referências Bancárias:', lines: [''] }, signature: { greeting: 'Atenciosamente,', name: '', phone: '', email: '' } },
      gallery: { title: 'Galeria', items: [{ src: 'assets/reservatorio-1.jpg', width: 90, height: 60 }] },
      custom: { html: '' }
    };
    defaults.cover.extras = [];
    defaults.clients.extras = [];
    defaults.technical.extras = [];
    defaults.obligations.extras = [];
    defaults.commercial.extras = [];
    defaults.closing.extras = [];
    defaults.gallery.extras = [];
    defaults.custom.extras = [];
    var data = defaults[type] || {};
    data.formatted = {};
    return { id: id, type: type, label: label, data: data, hidden: [] };
  }

  /* ── Editar bloco ────────────────────────── */

  function openEditModal(blockId) {
    var block = blockById(blockId);
    if (!block) return;
    if (block.type === 'custom') return;
    modalTitleEl.textContent = 'Editar: ' + block.label;
    modalBodyEl.innerHTML = buildEditForm(block);
    openModal('.block-item[data-block-id="' + String(blockId).replace(/"/g, '\\"') + '"]');
    attachEditFormEvents(block);
  }

  /* ── Clamp de valores numéricos no save ───── */

  /* O min/max do input não vale sozinho: type=number devolve o valor
     digitado mesmo fora do intervalo. Aqui ele é aplicado de fato e
     o valor resultante é comunicado ao usuário. */
  function applyNumericClamp(input) {
    var raw = input.value;
    if (raw === '' || raw === null || raw === undefined) return null;
    var n = parseFloat(String(raw).replace(',', '.'));
    if (isNaN(n)) return null;
    var min = input.getAttribute('min'), max = input.getAttribute('max');
    min = (min === null) ? null : parseFloat(min);
    max = (max === null) ? null : parseFloat(max);
    var out = n;
    if (min !== null && !isNaN(min) && out < min) out = min;
    if (max !== null && !isNaN(max) && out > max) out = max;
    if (out === n) return null;
    input.value = String(out);
    var label = input.getAttribute('data-label') || input.dataset.key || 'Valor';
    return label + ' ajustado para ' + out + ' mm (informado: ' + n + ' mm).';
  }

  /* Espelha os limites que buildClients aplica ao renderizar: o que
     não cabe na área imprimível não pode ser persistido como está. */
  function clampClientGeometry(d) {
    var m = state.margins || {};
    var mL = m.left || 0, mR = m.right || 0, mT = m.top || 0, mB = m.bottom || 0;
    var notes = [];

    function parse(v) {
      if (v === '' || v === null || v === undefined) return null;
      var n = parseFloat(String(v).replace(',', '.'));
      return isNaN(n) ? null : n;
    }
    function put(key, label, n, out) {
      out = Math.round(out * 100) / 100;
      d[key] = out;
      if (out !== n) notes.push(label + ' ajustado para ' + out + ' mm (informado: ' + n + ' mm).');
    }

    var tw = parse(d.titleWidth);
    if (tw !== null) {
      var twMax = PAGE.width - mL - mR;
      if (tw > twMax) { put('titleWidth', 'Largura do título', tw, twMax); tw = twMax; }
    }
    var twUsed = (tw !== null) ? tw : Math.max(40, PAGE.width - mL - mR);

    var tx = parse(d.titleX);
    if (tx !== null) {
      put('titleX', 'Posição X do título', tx,
        Math.max(mL, Math.min(PAGE.width - mR - twUsed, tx)));
    }
    var ty = parse(d.titleY);
    if (ty !== null) {
      put('titleY', 'Posição Y do título', ty,
        Math.max(HEADER_H + mT, Math.min(PAGE.height - mB - 8, ty)));
    }

    var w = parse(d.imgWidth);
    var h = parse(d.imgHeight);
    var wUsed = (w !== null && w !== 0) ? w : 160;
    if (h !== null && h !== 0) {
      var hMax = PAGE.height - HEADER_H - mT - mB;
      if (h > hMax) { put('imgHeight', 'Altura da imagem', h, hMax); h = hMax; }
    }

    var x = parse(d.imgX);
    if (x !== null) {
      put('imgX', 'Posição X da imagem', x,
        Math.max(mL, Math.min(PAGE.width - mR - wUsed, x)));
    }
    var y = parse(d.imgY);
    if (y !== null) {
      var hh = (h !== null && h > 0) ? h : wUsed * 0.62;
      put('imgY', 'Posição Y da imagem', y,
        Math.max(HEADER_H + mT, Math.min(PAGE.height - mB - hh, y)));
    }

    return notes;
  }

  function attachEditFormEvents(block) {
    var form = modalBodyEl;
    var saveBtn = $('#modalSaveBtn', form);
    var cancelBtn = $('#modalCancelBtn2', form);

    cancelBtn.addEventListener('click', closeModal);

    $$('.m-tab', form).forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.dataset.tab;
        $$('.m-tab', form).forEach(function (t) { t.classList.toggle('active', t === tab); });
        $$('.m-tabpanel', form).forEach(function (p) { p.classList.toggle('active', p.dataset.panel === name); });
      });
    });

    var addParaBtn = $('#addParagraph', form);
    if (addParaBtn) {
      addParaBtn.addEventListener('click', function () {
        pushHistory();
        block.data.paragraphs = block.data.paragraphs || [];
        block.data.paragraphs.push('');
        modalBodyEl.innerHTML = buildEditForm(block);
        attachEditFormEvents(block);
      });
    }

    var tbAddCol = $('#tblAddCol', form);
    if (tbAddCol) {
      tbAddCol.addEventListener('click', function () {
        pushHistory();
        block.data.cols = block.data.cols || [];
        block.data.rows = block.data.rows || [];
        block.data.cols.push('');
        block.data.rows.forEach(function (r) { r.push(''); });
        modalBodyEl.innerHTML = buildEditForm(block);
        attachEditFormEvents(block);
      });
    }

    var tbAddRow = $('#tblAddRow', form);
    if (tbAddRow) {
      tbAddRow.addEventListener('click', function () {
        pushHistory();
        block.data.cols = block.data.cols || [];
        block.data.rows = block.data.rows || [];
        block.data.rows.push(block.data.cols.map(function () { return ''; }));
        modalBodyEl.innerHTML = buildEditForm(block);
        attachEditFormEvents(block);
      });
    }

    $$('[data-tbl-act]', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushHistory();
        var act = btn.dataset.tblAct;
        if (act === 'rowDel') {
          if (block.data.rows.length > 1) block.data.rows.splice(parseInt(btn.dataset.row, 10), 1);
        } else if (act === 'colDel') {
          var ci = parseInt(btn.dataset.col, 10);
          if (block.data.cols.length > 2) {
            block.data.cols.splice(ci, 1);
            block.data.rows.forEach(function (r) { r.splice(ci, 1); });
          }
        } else if (act === 'extraRowDel') {
          var er = block.data.extras[parseInt(btn.dataset.eid, 10)];
          if (er && er.type === 'table' && er.rows.length > 1) er.rows.splice(parseInt(btn.dataset.row, 10), 1);
        } else if (act === 'extraColDel') {
          var ec = block.data.extras[parseInt(btn.dataset.eid, 10)];
          if (ec && ec.type === 'table' && ec.cols.length > 2) {
            var ecc = parseInt(btn.dataset.col, 10);
            ec.cols.splice(ecc, 1);
            ec.rows.forEach(function (r) { r.splice(ecc, 1); });
          }
        } else if (act === 'extraColAdd') {
          var ea = block.data.extras[parseInt(btn.dataset.eid, 10)];
          if (ea && ea.type === 'table') {
            ea.cols.push('');
            ea.rows.forEach(function (r) { r.push(''); });
          }
        } else if (act === 'extraRowAdd') {
          var eb = block.data.extras[parseInt(btn.dataset.eid, 10)];
          if (eb && eb.type === 'table') eb.rows.push(eb.cols.map(function () { return ''; }));
        }
        modalBodyEl.innerHTML = buildEditForm(block);
        attachEditFormEvents(block);
      });
    });

    $$('[data-mdl-del]', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushHistory();
        var arr = mdlArray(block, btn.dataset.mdlDel);
        if (arr) arr.splice(parseInt(btn.dataset.idx, 10), 1);
        rebaseFromPath(block, btn.dataset.mdlDel);
        modalBodyEl.innerHTML = buildEditForm(block);
        attachEditFormEvents(block);
      });
    });

    $$('[data-mdl-add]', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushHistory();
        var arr = mdlArray(block, btn.dataset.mdlAdd);
        if (!arr) return;
        var last = btn.dataset.mdlAdd.split('.').pop();
        if (last === 'georevestContacts') arr.push({ name: '', role: '', phone: '', email: '' });
        else if (last === 'items') arr.push({ src: 'assets/reservatorio-2.jpg', width: 90, height: 0 });
        else arr.push('');
        modalBodyEl.innerHTML = buildEditForm(block);
        attachEditFormEvents(block);
      });
    });

    $$('[data-mdl-extra-del]', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushHistory();
        if (Array.isArray(block.data.extras)) {
          block.data.extras.splice(parseInt(btn.dataset.eid, 10), 1);
        }
        modalBodyEl.innerHTML = buildEditForm(block);
        attachEditFormEvents(block);
      });
    });

    $$('[data-mdl-extra-add]', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushHistory();
        if (!Array.isArray(block.data.extras)) block.data.extras = [];
        var ex = makeExtra(btn.dataset.type);
        if (ex) block.data.extras.push(ex);
        modalBodyEl.innerHTML = buildEditForm(block);
        attachEditFormEvents(block);
      });
    });

    $$('.add-item-btn', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushHistory();
        var list = btn.dataset.list;
        if (Array.isArray(block.data[list])) {
          block.data[list].push('');
          modalBodyEl.innerHTML = buildEditForm(block);
          attachEditFormEvents(block);
        }
      });
    });

    $$('[data-hide-key]', form).forEach(function (cb) {
      cb.addEventListener('change', function () {
        pushHistory();
        var key = cb.dataset.hideKey;
        var i = block.hidden.indexOf(key);
        if (cb.checked) {
          if (i !== -1) block.hidden.splice(i, 1);
        } else {
          if (i === -1) block.hidden.push(key);
        }
        saveToStorage();
        render();
      });
    });

    saveBtn.addEventListener('click', function () {
      pushHistory();
      var labelInput = $('#editLabel', form);
      if (labelInput) block.label = labelInput.value;

      var clampNotes = [];
      $$('[data-num]', form).forEach(function (input) {
        var note = applyNumericClamp(input);
        if (note) clampNotes.push(note);
      });

      $$('.edit-field', form).forEach(function (input) {
        var key = input.dataset.key;
        var subkey = input.dataset.subkey;
        var idx = input.dataset.idx;
        var rIdx = input.dataset.row;
        var cIdx = input.dataset.col;
        var eid = input.dataset.eid;

        if (eid !== undefined) {
          var ex = block.data.extras[parseInt(eid, 10)];
          if (!ex) return;
          if (rIdx !== undefined && cIdx !== undefined) {
            ex.rows[parseInt(rIdx, 10)][parseInt(cIdx, 10)] = input.value;
          } else if (key === 'cols') {
            ex.cols[parseInt(idx, 10)] = input.value;
          } else if (key === 'showTotal') {
            ex.showTotal = input.checked;
          } else if (key === 'content') {
            clearFmtOnChange(ex, 'fmt', input.value);
            ex.content = input.value;
          } else if (key === 'src') {
            ex.src = input.value;
          } else if (key === 'width') {
            ex.width = parseFloat(input.value) || 0;
          } else if (key === 'height') {
            ex.height = parseFloat(input.value) || 0;
          }
          return;
        }

        if (rIdx !== undefined && cIdx !== undefined) {
          block.data.rows[parseInt(rIdx, 10)][parseInt(cIdx, 10)] = input.value;
        } else if (key === 'bank' && subkey === 'lines' && idx !== undefined) {
          if (!block.data.bank) block.data.bank = { lines: [] };
          block.data.bank.lines[parseInt(idx, 10)] = input.value;
          clearFmtOnChange(block.data, 'bank_' + parseInt(idx, 10), input.value);
        } else if (idx !== undefined && subkey !== undefined) {
          block.data[key][parseInt(idx)][subkey] = input.value;
          if (key === 'georevestContacts') {
            var cobj = block.data[key][parseInt(idx)];
            if (cobj && cobj.formatted) {
              if (toText(cobj.formatted[subkey] || '') === input.value) { /* keep */ }
              else delete cobj.formatted[subkey];
              if (cobj.formatted && !Object.keys(cobj.formatted).length) delete cobj.formatted;
            }
          } else {
            clearFmtOnChange(block.data, String(subkey), input.value);
          }
        } else if (idx !== undefined) {
          block.data[key][parseInt(idx)] = input.value;
          var fkIdx = key === 'paragraphs' ? 'para_' : key === 'contractorItems' ? 'ci_' : key === 'clientItems' ? 'cli_' : key + '_';
          clearFmtOnChange(block.data, fkIdx + parseInt(idx, 10), input.value);
        } else if (subkey !== undefined) {
          block.data[key][subkey] = input.value;
          var fkSub;
          if (key === 'bank') fkSub = subkey === 'title' ? 'bankTitle' : String(subkey);
          else if (key === 'signature') fkSub = subkey === 'phone' ? 'sigPhone' : subkey === 'name' ? 'sigName' : subkey === 'email' ? 'sigEmail' : String(subkey);
          else fkSub = String(subkey);
          clearFmtOnChange(block.data, fkSub, input.value);
        } else if (key === 'showTotal') {
          block.data.showTotal = input.checked;
        } else {
          block.data[key] = input.value;
          clearFmtOnChange(block.data, String(key), input.value);
        }
      });

      if (block.type === 'clients') {
        clampNotes = clampNotes.concat(clampClientGeometry(block.data));
      }

      saveToStorage();
      render();
      closeModal();
      if (clampNotes.length) {
        var clampMsg = clampNotes.join(' ');
        announce(clampMsg);
        if (global.CRE && global.CRE.toast) global.CRE.toast(clampMsg, 'warning');
      }
    });
  }

  function buildEditForm(block) {
    var html = '';
    html += '<label><span>Nome do bloco</span><input type="text" id="editLabel" value="' + esc(block.label) + '"></label>';

    var d = block.data;
    var locked = isProposalApproved();

    if (block.type === 'cover') {
      html += fg(ef('Data', 'date', d.date), ef('N° Proposta', 'proposalNumber', d.proposalNumber));
      html += ef('Destinatário', 'recipient', d.recipient);
      html += fg(ef('Contato', 'contactName', d.contactName), ef('Telefone', 'contactPhone', d.contactPhone));
      html += ef('Endereço', 'address', d.address);
      (d.georevestContacts || []).forEach(function (c, i) {
        html += '<div class="mdl-extra">';
        html += '<p class="mdl-extra-tag">Contato Georevest ' + (i + 1) + '</p>';
        html += fg(ef('Nome', 'georevestContacts', c.name, 'name', i), ef('Cargo', 'georevestContacts', c.role, 'role', i));
        html += fg(ef('Telefone', 'georevestContacts', c.phone, 'phone', i), ef('Email', 'georevestContacts', c.email, 'email', i));
        html += '<button type="button" class="btn btn-sm btn-danger" data-mdl-del="georevestContacts" data-idx="' + i + '">Remover contato</button>';
        html += '</div>';
      });
      html += '<button class="btn btn-sm btn-secondary" data-mdl-add="georevestContacts" style="margin-top:8px">+ Adicionar contato</button>';
    } else if (block.type === 'technical') {
      html += fg(ef('Título', 'title', d.title), ef('Subtítulo', 'subtitle', d.subtitle));
      (d.paragraphs || []).forEach(function (p, i) {
        html += efDel('Parágrafo ' + (i + 1), 'paragraphs', p, i);
      });
      html += '<button class="btn btn-sm btn-secondary" id="addParagraph" style="margin-top:8px">+ Adicionar parágrafo</button>';
    } else if (block.type === 'obligations') {
      html += ef('Título', 'title', d.title);
      html += ef('Título Contratada', 'contractorTitle', d.contractorTitle);
      (d.contractorItems || []).forEach(function (item, i) {
        html += efDel('Item ' + (i + 1), 'contractorItems', item, i);
      });
      html += '<button class="btn btn-sm btn-secondary add-item-btn" data-list="contractorItems" style="margin-top:8px">+ Item Contratada</button>';
      html += ef('Título Contratante', 'clientTitle', d.clientTitle);
      (d.clientItems || []).forEach(function (item, i) {
        html += efDel('Item ' + (i + 1), 'clientItems', item, i);
      });
      html += '<button class="btn btn-sm btn-secondary add-item-btn" data-list="clientItems" style="margin-top:8px">+ Item Contratante</button>';
    } else if (block.type === 'commercial') {
      normalizeCommercial(d);
      var ro = locked ? ' readonly' : '';
      var dis = locked ? ' disabled' : '';
      html += fg(ef('Título', 'title', d.title), ef('N° Proposta', 'proposalNumber', d.proposalNumber));
      html += ef('Descrição', 'description', d.description);
      html += '<hr style="border-color:#30363d;margin:14px 0">';
      html += '<p style="font-size:12px;color:#8b949e;margin:0 0 8px">Tabela Comercial' + (locked ? ' — somente leitura (aprovado)' : '') + '</p>';
      html += '<div class="modal-table-wrap">';
      html += '<table class="modal-tbl">';
      html += '<thead>';
      html += '<tr>';
      html += '<th class="mdl-x-th"></th>';
      d.cols.forEach(function (label, ci) {
        html += '<th><input class="edit-field" data-key="cols" data-idx="' + ci + '"' + ro + ' value="' + esc(label) + '"></th>';
      });
      html += '</tr><tr>';
      html += '<td class="mdl-x-th"></td>';
      d.cols.forEach(function (label, ci) {
        html += '<th class="mdl-x"><button type="button" class="mdl-x-btn" data-tbl-act="colDel" data-col="' + ci + '"' + dis + ' title="Excluir coluna" aria-label="Excluir coluna ' + (ci + 1) + ' da tabela"><span aria-hidden="true">&#10005;</span></button></th>';
      });
      html += '</tr>';
      html += '</thead><tbody>';
      d.rows.forEach(function (row, ri) {
        html += '<tr>';
        html += '<td class="mdl-x"><button type="button" class="mdl-x-btn" data-tbl-act="rowDel" data-row="' + ri + '"' + dis + ' title="Excluir linha" aria-label="Excluir linha ' + (ri + 1) + ' da tabela"><span aria-hidden="true">&#10005;</span></button></td>';
        row.forEach(function (cell, ci) {
          html += '<td><input class="edit-field" data-row="' + ri + '" data-col="' + ci + '"' + ro + ' value="' + esc(cell) + '"></td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
      html += '<div class="btn-row" style="margin-top:8px">';
      html += '<button class="btn btn-sm btn-secondary" id="tblAddCol"' + dis + '>+ Coluna</button>';
      html += '<button class="btn btn-sm btn-secondary" id="tblAddRow"' + dis + '>+ Linha</button>';
      html += '</div>';
      html += '<label class="check-line" style="margin-top:10px"><input type="checkbox" class="edit-field" data-key="showTotal"' + (d.showTotal !== false ? ' checked' : '') + (locked ? ' disabled' : '') + '> <span>Exibir total autom\u00e1tico</span></label>';
    } else if (block.type === 'gallery') {
      html += ef('T\u00edtulo', 'title', d.title);
      (d.items || []).forEach(function (it, i) {
        html += '<div class="mdl-extra">';
        html += '<p class="mdl-extra-tag">Imagem ' + (i + 1) + '</p>';
        html += ef('URL da Imagem', 'items', it.src, 'src', i);
        html += '<div style="display:flex;gap:8px">';
        html += efn('Largura (mm)', 'items', it.width, 'width', i);
        html += efn('Altura (mm)', 'items', it.height, 'height', i);
        html += '</div>';
        html += '<button type="button" class="btn btn-sm btn-danger" data-mdl-del="items" data-idx="' + i + '">Remover imagem</button>';
        html += '</div>';
      });
      html += '<button class="btn btn-sm btn-secondary" data-mdl-add="items" style="margin-top:8px">+ Adicionar imagem</button>';
    } else if (block.type === 'closing') {
      html += ef('Pagamento', 'payment', d.payment);
      html += fg(ef('Produção', 'production', d.production), ef('Instalação', 'installation', d.installation));
      html += fg(ef('Garantia', 'warranty', d.warranty), ef('Validade', 'validity', d.validity));
      if (d.bank) {
        html += '<hr style="border-color:#30363d;margin:12px 0">';
        html += ef('Título Bancário', 'bank', d.bank.title, 'title');
        d.bank.lines = d.bank.lines || [];
        d.bank.lines.forEach(function (line, i) {
          html += efDel('Linha ' + (i + 1), 'bank', line, i, 'lines');
        });
        html += '<button class="btn btn-sm btn-secondary" data-mdl-add="bank.lines" style="margin-top:8px">+ Adicionar linha bancária</button>';
      }
      if (d.signature) {
        html += '<hr style="border-color:#30363d;margin:12px 0">';
        html += ef('Saudação', 'signature', d.signature.greeting, 'greeting');
        html += fg(ef('Nome', 'signature', d.signature.name, 'name'), ef('Telefone', 'signature', d.signature.phone, 'phone'));
        html += ef('Email', 'signature', d.signature.email, 'email');
      }
    } else if (block.type === 'clients') {
      var cm = state.margins || {};
      var cL = cm.left || 0, cR = cm.right || 0, cT = cm.top || 0, cB = cm.bottom || 0;
      var boxMaxW = Math.max(10, PAGE.width - cL - cR);
      var boxMaxY = Math.max(10, PAGE.height - cB - 8);
      html += ef('Título', 'title', d.title);
      html += ef('URL da Imagem', 'image', d.image);
      html += '<p class="mdl-extra-tag">Título — posição e tamanho (mm)</p>';
      html += fg(
        efn('Título — posição X', 'titleX', d.titleX, null, null, cL, boxMaxW),
        efn('Título — posição Y', 'titleY', d.titleY, null, null, HEADER_H + cT, boxMaxY)
      );
      html += efn('Título — largura', 'titleWidth', d.titleWidth, null, null, 10, boxMaxW);
      html += '<p class="mdl-extra-tag">Imagem — posição e tamanho (mm)</p>';
      html += fg(
        efn('Imagem — posição X', 'imgX', d.imgX, null, null, cL, boxMaxW),
        efn('Imagem — posição Y', 'imgY', d.imgY, null, null, HEADER_H + cT, boxMaxY)
      );
      html += '<div style="display:flex;gap:8px">';
      html += efn('Largura (mm)', 'imgWidth', d.imgWidth, null, null, 10, boxMaxW);
      html += efn('Altura (mm) — 0 = automática', 'imgHeight', d.imgHeight, null, null, 0,
        Math.max(10, PAGE.height - HEADER_H - cT - cB));
      html += '</div>';
    } else if (block.type === 'custom') {
      html += '<label><span>Conteúdo HTML</span><textarea class="edit-field" data-key="html" rows="10">' + esc(d.html || '') + '</textarea></label>';
    }

    var vis = buildVisibilityForm(block);
    var extra = buildExtrasForm(d);

    var tabs = '<button type="button" class="m-tab active" data-tab="content">Conteúdo</button>';
    var panels = '<div class="m-tabpanel active" data-panel="content">' + html + '</div>';
    if (vis) {
      tabs += '<button type="button" class="m-tab" data-tab="vis">Visibilidade</button>';
      panels += '<div class="m-tabpanel" data-panel="vis">' + vis + '</div>';
    }
    tabs += '<button type="button" class="m-tab" data-tab="extras">Extras</button>';
    panels += '<div class="m-tabpanel" data-panel="extras">' + extra + '</div>';

    html = '<div class="modal-tabs">' + tabs + '</div>';
    html += '<div class="modal-tabpanels">' + panels + '</div>';
    html += '<div class="btn-row">';
    html += '<button class="btn btn-secondary" id="modalCancelBtn2">Cancelar</button>';
    html += '<button class="btn btn-primary" id="modalSaveBtn">Salvar</button>';
    html += '</div>';

    return html;
  }

  function visibilityKeys(block) {
    if (block.type === 'clients')    return [{ key: 'title', label: 'Título' }];
    if (block.type === 'technical')  return [{ key: 'title', label: 'Título' }, { key: 'subtitle', label: 'Subtítulo' }];
    if (block.type === 'obligations') return [
      { key: 'title', label: 'Título' },
      { key: 'contractorTitle', label: 'Título da Contratada' },
      { key: 'clientTitle', label: 'Título da Contratante' }
    ];
    if (block.type === 'commercial') return [{ key: 'title', label: 'Título' }];
    return [];
  }

  function buildVisibilityForm(block) {
    var keys = visibilityKeys(block);
    if (!keys.length) return '';
    if (!Array.isArray(block.hidden)) block.hidden = [];
    var html = '<hr style="border-color:#30363d;margin:14px 0">';
    html += '<p style="font-size:12px;color:#8b949e;margin:0 0 8px">Visibilidade</p>';
    keys.forEach(function (k) {
      var checked = block.hidden.indexOf(k.key) === -1 ? 'checked' : '';
      html += '<label class="check-line"><input type="checkbox" data-hide-key="' + esc(k.key) + '" ' + checked + '> <span>' + esc(k.label) + '</span></label>';
    });
    return html;
  }

  function ef(label, key, value, subkey, idx) {
    var attrs = 'class="edit-field" data-key="' + esc(key) + '"';
    if (subkey !== undefined && subkey !== null) attrs += ' data-subkey="' + esc(String(subkey)) + '"';
    if (idx !== undefined && idx !== null) attrs += ' data-idx="' + idx + '"';
    return '<label><span>' + esc(label) + '</span><input type="text" ' + attrs + ' value="' + esc(value || '') + '"></label>';
  }

  function efn(label, key, value, subkey, idx, min, max) {
    if (min === undefined || min === null) min = 0;
    if (max === undefined || max === null) max = 297;
    var attrs = 'class="edit-field" data-num="1" data-label="' + esc(label) + '" data-key="' + esc(key) + '"';
    if (subkey !== undefined && subkey !== null) attrs += ' data-subkey="' + esc(String(subkey)) + '"';
    if (idx !== undefined && idx !== null) attrs += ' data-idx="' + idx + '"';
    var v = (value === 0 || value) ? value : '';
    return '<label><span>' + esc(label) + '</span><input type="number" min="' + min + '" max="' + max + '" step="0.5" ' + attrs + ' value="' + esc(v) + '"></label>';
  }

  function efDel(label, key, value, idx, subkey) {
    var path = subkey ? key + '.' + subkey : key;
    var attrs = 'class="edit-field" data-key="' + esc(key) + '"';
    if (subkey) attrs += ' data-subkey="' + esc(subkey) + '"';
    attrs += ' data-idx="' + idx + '"';
    return '<div class="mdl-row">' +
      '<label><span>' + esc(label) + '</span><input type="text" ' + attrs + ' value="' + esc(value || '') + '"></label>' +
      '<button type="button" class="mdl-x-btn" data-mdl-del="' + esc(path) + '" data-idx="' + idx + '" title="Excluir" aria-label="Excluir ' + esc(label) + '"><span aria-hidden="true">&#10005;</span></button>' +
      '</div>';
  }

  function fg() {
    return '<div class="fld-grid">' + Array.prototype.slice.call(arguments).join('') + '</div>';
  }

  function buildExtrasForm(d) {
    if (!Array.isArray(d.extras)) d.extras = [];
    var html = '';
    if (d.extras.length) {
      html += '<hr style="border-color:#30363d;margin:14px 0">';
      html += '<p style="font-size:12px;color:#8b949e;margin:0 0 8px">Conteúdo extra</p>';
    }
    d.extras.forEach(function (ex, ei) {
      html += '<div class="mdl-extra">';
      html += '<p class="mdl-extra-tag">' + (ex.type === 'text' ? 'Parágrafo' : ex.type === 'image' ? 'Imagem' : 'Tabela') + '</p>';
      if (ex.type === 'text') {
        html += '<label><span>Texto</span><textarea class="edit-field" data-eid="' + ei + '" data-key="content" rows="3">' + esc(ex.content || '') + '</textarea></label>';
      } else if (ex.type === 'image') {
        html += '<label><span>URL da Imagem</span><input type="text" class="edit-field" data-eid="' + ei + '" data-key="src" value="' + esc(ex.src || '') + '"></label>';
        html += '<div style="display:flex;gap:8px">';
        html += '<label style="flex:1"><span>Largura (mm)</span><input type="number" min="10" max="210" step="0.5" class="edit-field" data-num="1" data-label="Largura (mm) do extra ' + (ei + 1) + '" data-eid="' + ei + '" data-key="width" value="' + esc(ex.width || '') + '"></label>';
        html += '<label style="flex:1"><span>Altura (mm)</span><input type="number" min="0" max="297" step="0.5" class="edit-field" data-num="1" data-label="Altura (mm) do extra ' + (ei + 1) + '" data-eid="' + ei + '" data-key="height" value="' + esc(ex.height || '') + '"></label>';
        html += '</div>';
      } else if (ex.type === 'table') {
        normalizeTable(ex);
        html += '<div class="modal-table-wrap"><table class="modal-tbl"><thead><tr><th class="mdl-x-th"></th>';
        ex.cols.forEach(function (label, ci) {
          html += '<th><input class="edit-field" data-eid="' + ei + '" data-key="cols" data-idx="' + ci + '" value="' + esc(label) + '"></th>';
        });
        html += '</tr><tr><td class="mdl-x-th"></td>';
        ex.cols.forEach(function (label, ci) {
          html += '<th class="mdl-x"><button type="button" class="mdl-x-btn" data-tbl-act="extraColDel" data-eid="' + ei + '" data-col="' + ci + '" title="Excluir coluna" aria-label="Excluir coluna ' + (ci + 1) + ' da tabela extra ' + (ei + 1) + '"><span aria-hidden="true">&#10005;</span></button></th>';
        });
        html += '</tr></thead><tbody>';
        ex.rows.forEach(function (row, ri) {
          html += '<tr><td class="mdl-x"><button type="button" class="mdl-x-btn" data-tbl-act="extraRowDel" data-eid="' + ei + '" data-row="' + ri + '" title="Excluir linha" aria-label="Excluir linha ' + (ri + 1) + ' da tabela extra ' + (ei + 1) + '"><span aria-hidden="true">&#10005;</span></button></td>';
          row.forEach(function (cell, ci) {
            html += '<td><input class="edit-field" data-eid="' + ei + '" data-row="' + ri + '" data-col="' + ci + '" value="' + esc(cell) + '"></td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<div class="btn-row" style="margin-top:8px">';
        html += '<button class="btn btn-sm btn-secondary" data-tbl-act="extraColAdd" data-eid="' + ei + '">+ Coluna</button>';
        html += '<button class="btn btn-sm btn-secondary" data-tbl-act="extraRowAdd" data-eid="' + ei + '">+ Linha</button>';
        html += '</div>';
        html += '<label class="check-line" style="margin-top:8px"><input type="checkbox" class="edit-field" data-eid="' + ei + '" data-key="showTotal"' + (ex.showTotal !== false ? ' checked' : '') + '> <span>Exibir total autom\u00e1tico</span></label>';
      }
      html += '<button type="button" class="btn btn-sm btn-danger" data-mdl-extra-del data-eid="' + ei + '">Remover</button>';
      html += '</div>';
    });
    html += '<div class="btn-row" style="margin-top:8px">';
    html += '<button class="btn btn-sm btn-secondary" data-mdl-extra-add data-type="text">+ Parágrafo</button>';
    html += '<button class="btn btn-sm btn-secondary" data-mdl-extra-add data-type="image">+ Imagem</button>';
    html += '<button class="btn btn-sm btn-secondary" data-mdl-extra-add data-type="table">+ Tabela</button>';
    html += '</div>';
    return html;
  }

  /* ── Rodapé ──────────────────────────────── */

  function loadFooterInputs() {
    footerLine1El.value = state.footer.line1 || '';
    footerLine2El.value = state.footer.line2 || '';
    footerLine3El.value = state.footer.line3 || '';
    headerImgEl.value = state.footer.headerImg || '';
  }

  function setupFooterListeners() {
    var inputs = [footerLine1El, footerLine2El, footerLine3El, headerImgEl];
    inputs.forEach(function (el) { el.addEventListener('focus', pushHistory); });
    footerLine1El.addEventListener('input', function () { state.footer.line1 = footerLine1El.value; saveToStorage(); updateFooterText(); });
    footerLine2El.addEventListener('input', function () { state.footer.line2 = footerLine2El.value; saveToStorage(); updateFooterText(); });
    footerLine3El.addEventListener('input', function () { state.footer.line3 = footerLine3El.value; saveToStorage(); updateFooterText(); });
    headerImgEl.addEventListener('input', function () { state.footer.headerImg = headerImgEl.value; saveToStorage(); updateHeaderImages(); });
  }

  function updateFooterText() {
    var revLine = revLineHTML(null);
    $$('.page footer', docEl).forEach(function (f, i) {
      var pageNum = f.querySelector('.page-num');
      var num = pageNum ? parseInt(pageNum.textContent, 10) : 0;
      f.innerHTML = footerBodyHTML(state, revLine, (num > 0 ? num : i + 1) - 1);
    });
  }

  function updateHeaderImages() {
    $$('.page header img', docEl).forEach(function (img) {
      img.src = state.footer.headerImg;
    });
  }

  /* ── Persistência (proposta ativa) ───────── */

  function getActiveProposal() {
    var id = proposalSelectEl ? proposalSelectEl.value : '';
    return data.getProposal(id) || data.getActiveProposal();
  }

  /* Preenche os dados do cliente no bloco "Capa" a partir do cadastro */
  function syncCoverFromClient(proposal) {
    var prop = proposal || getActiveProposal();
    var client = prop && prop.clientId ? data.findClient(prop.clientId) : null;
    if (!client) return false;
    var cover = (state.blocks || []).find(function (b) { return b.type === 'cover' && b.data; });
    if (!cover) return false;
    var d = cover.data;
    var changed = false;
    function setIf(pos, val) {
      if (val && d[pos] !== val) {
        d[pos] = val;
        changed = true;
      }
    }
    var company = (client.company || client.name || '').trim();
    var name = (client.name || '').trim();
    var phone = (client.phone || '').trim();
    var address = (client.address || '').trim();
    if (company) setIf('recipient', company);
    if (name) setIf('contactName', 'Contato: ' + name);
    if (phone) setIf('contactPhone', 'Telefone: ' + phone);
    if (address) setIf('address', 'Endereço da obra: ' + address);
    return changed;
  }

  function saveToStorage() {
    markDirty();
  }

  function refreshProposalSelect() {
    if (!proposalSelectEl) return;
    var prev = proposalSelectEl.value;
    proposalSelectEl.innerHTML = '';
    data.load().proposals.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || 'Proposta sem nome';
      proposalSelectEl.appendChild(opt);
    });
    if (prev && data.getProposal(prev)) proposalSelectEl.value = prev;
    else {
      var act = data.getActiveProposal();
      if (act) proposalSelectEl.value = act.id;
    }
  }

  function loadProposal(proposal, opts) {
    opts = opts || {};
    undoStack = [];
    redoStack = [];
    selectedBlockId = null;
    cancelAutosave();
    var layout = proposal.layout || data.defaultLayout();
    state = JSON.parse(JSON.stringify(layout));
    ensureState();
    loadFooterInputs();
    applyPaper();
    refreshProposalSelect();
    if (proposalSelectEl) proposalSelectEl.value = proposal.id;
    /* skipWrites: recarga vinda de onStoreReplaced — o store acabou de
       ser trocado e nada deve ser gravado durante a troca. */
    if (!opts.skipWrites && syncCoverFromClient(proposal)) {
      data.updateProposal(proposal.id, { layout: state });
    }
    cleanSnapshot = JSON.stringify(state);
    clearDirty();
    loadedProposalId = proposal.id;
    render();
    if (!opts.skipWrites) trackBudgetRevision(proposal);
    updateRevUI();
    updateHistoryButtons();
    updateStatusBar();
    if (opts.scroll) {
      var ws = $('#workspace');
      if (ws) {
        ws.scrollTop = 0;
        ws.scrollLeft = 0;
      }
    }
  }

  /* ── Ativação (ao abrir a aba Layouts) ───── */

  function activate() {
    ensureState();
    refreshProposalSelect();
    var prop = getActiveProposal();
    if (!prop) return;
    var currentlyLoaded = loadedProposalId;
    if (currentlyLoaded !== prop.id) {
      loadedProposalId = prop.id;
      loadProposal(prop, { silent: true });
    } else {
      if (syncCoverFromClient(prop)) {
        saveToStorage();
        render();
      } else {
        updateStatusBar();
        applyPaper();
        applyZoom();
      }
    }
  }

  var loadedProposalId = null;

  /* ── Init ────────────────────────────────── */

  function initEditor() {
    docEl = $('#document');
    blockListEl = $('#blockList');
    overlayEl = $('#modalOverlay');
    modalTitleEl = $('#modalTitle');
    modalBodyEl = $('#modalBody');
    footerLine1El = $('#footerLine1');
    footerLine2El = $('#footerLine2');
    footerLine3El = $('#footerLine3');
    headerImgEl = $('#headerImg');
    paperSizeEl = $('#paperSize');
    paperOrientEl = $('#paperOrient');
    zoomInputEl = $('#zoomInput');
    proposalSelectEl = $('#proposalSelect');
    sbProposalNameEl = $('#sbProposalName');
    sbZoomEl = $('#sbZoom');
    sbWordsEl = $('#sbWords');
    sbPageEl = $('#sbPage');
    sbPaperEl = $('#sbPaper');
    sbAutosaveEl = $('#sbAutosave');
    sbRevisionEl = $('#sbRevision');
    revBannerEl = $('#revBanner');
    revBannerNoteEl = $('#revBannerNote');
    btnUnlockRevEl = $('#btnUnlockRev');
    btnSaveProposalEl = $('#btnSaveProposal');
    btnDiscardChangesEl = $('#btnDiscardChanges');
    etDirtyDotEl = $('#etDirtyDot');

    if (!docEl || !overlayEl) return;

    if (blockListEl) blockListEl.setAttribute('role', 'list');
    if (etDirtyDotEl) {
      /* indicador visual: o estado "não salvo" é anunciado pelo
         announce() de markDirty/clearDirty, não pelo próprio ponto. */
      etDirtyDotEl.setAttribute('aria-hidden', 'true');
      etDirtyDotEl.setAttribute('role', 'presentation');
    }
    ensureEditHint();
    ensureLiveRegion();

    if (btnSaveProposalEl) btnSaveProposalEl.addEventListener('click', saveProposal);
    if (btnDiscardChangesEl) btnDiscardChangesEl.addEventListener('click', discardChanges);
    if (btnUnlockRevEl) btnUnlockRevEl.addEventListener('click', unlockProposal);

    var style = document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 0 }';
    document.head.appendChild(style);
    printStyleEl = style;

    data.load();

    $('#modalClose').addEventListener('click', closeModal);
    overlayEl.addEventListener('click', function (e) { if (e.target === overlayEl) closeModal(); });

    $('#btnAddBlock').addEventListener('click', function () {
      modalTitleEl.textContent = 'Adicionar Bloco';
      modalBodyEl.innerHTML = buildAddBlockForm();
      openModal('#btnAddBlock');
      attachAddBlockEvents();
    });

    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);

    $('#btnPrint').addEventListener('click', function () {
      if (activeEditable) activeEditable.blur();
      applyPaper();
      window.print();
    });
    $('#btnExport').addEventListener('click', exportState);
    $('#btnImport').addEventListener('click', function () { $('#fileInput').click(); });
    $('#btnExportHTML').addEventListener('click', exportHTML);
    $('#btnShareMail').addEventListener('click', shareMail);
    $('#btnShareWa').addEventListener('click', shareWa);
    var btnNf = $('#btnNf');
    if (btnNf && global.CRE_MODULES) {
      btnNf.addEventListener('click', function () {
        var prop = getActiveProposal();
        if (prop) global.CRE_MODULES.openInvoiceList(prop.id);
      });
    }
    $('#btnToggleSidebar').addEventListener('click', function () {
      document.body.classList.toggle('sb-collapsed');
    });
    $('#btnNew').addEventListener('click', function () {
      global.CRE.confirm('Novo layout', 'Começar do layout padrão? O conteúdo atual da proposta será substituído.', function () {
        pushHistory();
        state = data.defaultLayout();
        ensureState();
        loadFooterInputs();
        applyPaper();
        saveToStorage();
        render();
      }, 'Começar');
    });
    $('#btnSaveAsTemplate').addEventListener('click', function () {
      var name = prompt('Nome do modelo:', 'Modelo ' + (data.load().templates.length + 1));
      if (!name) return;
      data.addTemplate(name, state);
    });

    var btnHistory = $('#btnHistory');
    if (btnHistory) btnHistory.addEventListener('click', openHistoryModal);

    var btnNewRev = $('#btnNewRev');
    if (btnNewRev) btnNewRev.addEventListener('click', openNewRevisionModal);

    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        var mo = $('#modalOverlay');
        if (mo && mo.classList.contains('open')) closeModal();
        else openHistoryModal();
      } else if (e.key === 'd' || e.key === 'D') {
        if (e.altKey) {
          e.preventDefault();
          openCompareModal();
        }
      }
    });

    $('#fileInput').addEventListener('change', importState);
    $('#imgInput').addEventListener('change', function () { /* handled in ribbon */ });

    paperSizeEl.addEventListener('change', function () {
      pushHistory();
      state.paper.size = paperSizeEl.value;
      applyPaper();
      saveToStorage();
      render();
    });
    paperOrientEl.addEventListener('change', function () {
      pushHistory();
      state.paper.orientation = paperOrientEl.value;
      applyPaper();
      saveToStorage();
      render();
    });

    zoomInputEl.addEventListener('change', function () {
      var v = parseInt(zoomInputEl.value, 10) || 100;
      v = Math.max(25, Math.min(200, v));
      state.zoom = v;
      applyZoom();
    });
    $('#zoomIn').addEventListener('click', function () {
      var v = Math.min(200, (state.zoom || 100) + 10);
      state.zoom = v;
      applyZoom();
    });
    $('#zoomOut').addEventListener('click', function () {
      var v = Math.max(25, (state.zoom || 100) - 10);
      state.zoom = v;
      applyZoom();
    });

    proposalSelectEl.addEventListener('change', function () {
      var nextId = proposalSelectEl.value;
      commitActiveEdit();
      if (isDirty) {
        var leave = confirm('Você possui alterações não salvas nesta proposta. Deseja descartá-las e abrir outra proposta?');
        if (!leave) {
          var curr = getActiveProposal();
          if (curr) proposalSelectEl.value = curr.id;
          return;
        }
      }
      activeEditable = null;
      var prop = data.getProposal(nextId);
      if (prop) {
        loadedProposalId = prop.id;
        data.setActiveProposal(prop.id);
        loadProposal(prop, { silent: true, scroll: true });
      }
    });

    window.addEventListener('beforeunload', function (e) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        openFind();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var fo = $('#findOverlay');
        if (fo && fo.classList.contains('open')) closeFind();
      }
    });

    setupFooterListeners();
    initRibbon();
    initFind();

    loadedProposalId = null;
    activate();

    /* Registrado por último: depois do primeiro load, para que uma
       integração disparada durante o próprio activate() não reentre. */
    if (data && typeof data.onStoreReplaced === 'function') data.onStoreReplaced(onStoreReplaced);
  }

  function attachAddBlockEvents() {
    var selectedType = null;
    var opts = $$('.block-type-option', modalBodyEl);

    function selectOption(opt, moveFocus) {
      opts.forEach(function (o) {
        var on = o === opt;
        o.classList.toggle('selected', on);
        o.setAttribute('aria-checked', on ? 'true' : 'false');
        o.setAttribute('tabindex', on ? '0' : '-1');
      });
      selectedType = opt.dataset.type;
      var labelInput = $('#newBlockLabel', modalBodyEl);
      if (labelInput && !labelInput.value) labelInput.value = BLOCK_TYPES[selectedType].label;
      $('#modalAddBtn', modalBodyEl).disabled = false;
      if (moveFocus && opt.focus) opt.focus();
    }

    opts.forEach(function (opt, oi) {
      opt.addEventListener('click', function () { selectOption(opt, false); });
      opt.addEventListener('keydown', function (e) {
        var j = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (oi + 1) % opts.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (oi - 1 + opts.length) % opts.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = opts.length - 1;
        else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          selectOption(opt, true);
          return;
        }
        if (j >= 0 && j < opts.length) {
          e.preventDefault();
          selectOption(opts[j], true);
        }
      });
    });

    $('#modalCancelBtn', modalBodyEl).addEventListener('click', closeModal);

    $('#modalAddBtn', modalBodyEl).addEventListener('click', function () {
      if (!selectedType) return;
      pushHistory();
      var label = ($('#newBlockLabel', modalBodyEl).value) || BLOCK_TYPES[selectedType].label;
      var newBlock = createDefaultBlock(selectedType, label);
      state.blocks.push(newBlock);
      saveToStorage();
      render();
      closeModal();
      setTimeout(function () { scrollToBlock(newBlock.id); }, 100);
    });
  }

  /* ── Export / Import ─────────────────────── */

  function exportState() {
    commitActiveEdit();
    var active = getActiveProposal();
    var name = (active && active.name) || 'proposta';
    var json = JSON.stringify(state, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importState(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = JSON.parse(reader.result);
        if (imported.blocks) {
          pushHistory();
          state = imported;
          ensureState();
          loadFooterInputs();
          applyPaper();
          saveToStorage();
          render();
        } else {
          alert('Formato de arquivo inválido.');
        }
      } catch (err) {
        alert('Erro ao ler o arquivo: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /* ── Exportar HTML standalone ────────────── */

  var EXPORT_CSS = [
    'html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}',
    '*{box-sizing:border-box}',
    '.document{margin:0 auto}',
    '.page{width:210mm;height:297mm;background:#fff;position:relative;overflow:hidden;page-break-after:always;color:#111}',
    '.document.paper-A4.orient-portrait{width:210mm}',
    '.document.paper-A4.orient-portrait .page{width:210mm;height:297mm}',
    '.document.paper-A4.orient-landscape{width:297mm}',
    '.document.paper-A4.orient-landscape .page{width:297mm;height:210mm}',
    '.document.paper-Letter.orient-portrait{width:215.9mm}',
    '.document.paper-Letter.orient-portrait .page{width:215.9mm;height:279.4mm}',
    '.document.paper-Letter.orient-landscape{width:279.4mm}',
    '.document.paper-Letter.orient-landscape .page{width:279.4mm;height:215.9mm}',
    '.page header{height:35mm;border-bottom:1.35mm solid #1685bd}',
    '.page header img{width:100%;height:35mm;display:block;object-fit:cover}',
    '.page-body{font-size:14.5pt;line-height:1.52}',
    '.page-body p{margin:0 0 3.2mm}',
    '.bold{font-weight:700}',
    '.date{text-align:right;margin:10mm 0 4mm}',
    '.contact{margin-top:17mm}',
    '.page footer{position:absolute;bottom:4.2mm;left:20mm;right:20mm;text-align:center;font-size:9.2pt;line-height:1.35}',
    '.page footer span{display:block;margin-top:.8mm}',
    '.page h1{font-size:15pt;text-align:center;margin:10mm 0 10mm}',
    '.page h2{font-size:15pt;margin:0 0 9mm}',
    '.page h3{font-size:14.5pt;margin:11mm 0 5mm}',
    '.technical h2{text-align:center}',
    '.technical p{text-align:justify;margin-bottom:5mm}',
    '.obligations h2{margin-top:9mm}',
    '.obligations h3{margin-top:11mm}',
    '.obligations ul{margin:0;padding-left:7mm}',
    '.obligations li{padding-left:1mm;margin-bottom:1.5mm;text-align:justify}',
    '.commercial h1{margin-top:12mm;margin-bottom:10mm}',
    '.commercial>p{margin-left:5mm;margin-right:5mm}',
    '.com-tbl-wrap{margin-top:7mm}',
    '.com-table{width:100%;border-collapse:collapse;font-size:11pt;line-height:1.3}',
    '.com-table th,.com-table td{border:.25mm solid #111;padding:2mm 2.5mm;vertical-align:top;text-align:left;word-wrap:break-word;overflow-wrap:break-word}',
    '.com-table thead th{text-align:center;font-weight:700;background:#1685bd10}',
    '.com-table tbody td:first-child,.com-table thead th:first-child{width:14mm;min-width:14mm;text-align:center}',
    '.com-total-row td{font-weight:700;background:#1685bd10;border-top:.5mm solid #111}',
    '.com-total-val{text-align:right}',
    '.gallery-grid{display:flex;flex-wrap:wrap;gap:6mm;margin-top:6mm}',
    '.gallery-item{display:inline-block;line-height:0}',
    '.gallery-item img{display:block}',
    '.img-wrap{display:inline-block;line-height:0}',
    '.technical .par-el p{margin-bottom:4mm}',
    '.extra-el{margin:0 0 4mm}',
    '.extra-el .img-wrap{display:block}',
    '.final,.closing{margin-top:9mm}',
    '.final p,.closing p{text-align:justify}',
    '.spaced{margin-top:17mm!important}',
    '.bank{margin-top:20mm}',
    '.bank h3{margin:0 0 5mm}',
    '.signature{position:absolute;left:0;right:0;bottom:30mm;display:flex;flex-direction:column;line-height:1.4}',
    '.signature span{float:right}',
    '.item{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:9mm;min-height:39mm;margin:6mm 5mm 0;padding-bottom:4mm;border-bottom:.25mm solid #111;font-size:12.5pt;line-height:1.25}',
    '.item img{width:65mm;height:auto;display:block}',
    '.item small{font-size:11pt}',
    '@media print{html,body{height:auto}.page{box-shadow:none;margin:0}}'
  ].join('\n');

  function imgToDataURL(img) {
    try {
      if (!img || !img.naturalWidth) return null;
      var c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.9);
    } catch (e) { return null; }
  }

  function exportHTML() {
    commitActiveEdit();
    var clone = docEl.cloneNode(true);
    clone.style.removeProperty('zoom');
    clone.querySelectorAll('.page-controls, .margin-guide, .page-badge, .resize-handle, .content-del, .add-tools, .com-del-cell, .com-del-btn, .com-tbl-tools').forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    var sources = Array.from(docEl.querySelectorAll('img'));
    var targets = Array.from(clone.querySelectorAll('img'));
    targets.forEach(function (t, i) {
      var d = imgToDataURL(sources[i]);
      if (d) t.src = d;
    });
    clone.querySelectorAll('[contenteditable]').forEach(function (el) { el.setAttribute('contenteditable', 'false'); });
    /* rótulos do editor não fazem sentido na cópia exportada:
       os campos são somente leitura lá e o #editorEditHint não existe. */
    clone.querySelectorAll('[role="textbox"]').forEach(function (el) {
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      el.removeAttribute('aria-multiline');
      el.removeAttribute('aria-describedby');
      el.removeAttribute('data-field-id');
    });
    clone.querySelectorAll('.editable').forEach(function (el) { el.classList.remove('editable'); });
    clone.querySelectorAll('.page.editing').forEach(function (el) { el.classList.remove('editing'); });
    clone.querySelectorAll('.page.selected').forEach(function (el) { el.classList.remove('selected'); });

    var prop = getActiveProposal();
    var title = esc((prop && prop.name) || 'Proposta Georevest');
    var htmlDoc = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + title + '</title><style>' + EXPORT_CSS + '</style></head>' +
      '<body><div class="export-wrap">' + clone.outerHTML + '</div></body></html>';
    var filename = ((prop && prop.name) || 'proposta').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html';
    var blob = new Blob([htmlDoc], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Compartilhar (e-mail / WhatsApp) ────── */

  function getClientForProposal() {
    var prop = getActiveProposal();
    return prop ? (data.findClient(prop.clientId) || null) : null;
  }

  function buildShareText() {
    var prop = getActiveProposal();
    if (!prop) return '';
    var c = data.findClient(prop.clientId);
    var lines = [];
    lines.push('Olá' + (c ? ' ' + (c.name || '') : '') + '! Segue a proposta da Georevest.');
    lines.push('');
    lines.push('Proposta: ' + (prop.name || ''));
    if (c) lines.push('Cliente: ' + (c.company || c.name || ''));
    lines.push('');
    (state.blocks || []).forEach(function (b) {
      if (b && b.type === 'commercial' && b.data && Array.isArray(b.data.rows)) {
        var cols = b.data.cols || [];
        var ci = global.CRE.totalColIndex(cols);
        if (ci === null || ci === undefined) ci = cols.length - 1;
        b.data.rows.forEach(function (r) {
          if (!Array.isArray(r)) return;
          var di = 2;
          if (ci === 2) {
            di = (String(cols[1] || '').toLowerCase().indexOf('desc') !== -1) ? 1 : 0;
          }
          var desc = r[di] || '';
          if (!desc) {
            for (var k = 0; k < r.length; k++) {
              if (k !== ci && r[k]) { desc = r[k]; break; }
            }
          }
          var val = r[ci];
          if (desc && val !== undefined && val !== '') lines.push('• ' + desc + ': ' + val);
        });
      }
    });
    lines.push('');
    lines.push('Valor total estimado: ' + global.CRE.fmtBRL(global.CRE.proposalTotal(state)));
    lines.push('');
    lines.push(state.footer.line1 || '');
    lines.push(state.footer.line2 || '');
    lines.push(state.footer.line3 || '');
    var cl = state.blocks.find(function (b) { return b && b.type === 'closing' && b.data && b.data.signature; });
    if (cl) {
      lines.push('');
      lines.push(cl.data.signature.greeting || 'Atenciosamente,');
      lines.push(cl.data.signature.name || '');
      lines.push(cl.data.signature.phone || '');
      lines.push(cl.data.signature.email || '');
    }
    return lines.join('\n');
  }

  function shareMail() {
    commitActiveEdit();
    var prop = getActiveProposal();
    var c = getClientForProposal();
    var subj = 'Proposta ' + ((prop && prop.name) || 'Georevest') + ' - Georevest';
    var body = buildShareText() + '\n\n(Você receberá o PDF/HTML da proposta em anexo.)';
    window.location.href = 'mailto:' + ((c && c.email) || '') +
      '?subject=' + encodeURIComponent(subj) +
      '&body=' + encodeURIComponent(body);
  }

  function shareWa() {
    commitActiveEdit();
    var c = getClientForProposal();
    var n = '';
    if (c && c.phone) {
      n = String(c.phone).replace(/\D/g, '');
      if (n.indexOf('55') !== 0) n = '55' + n;
    }
    if (!n) n = '551141174417';
    var txt = buildShareText();
    window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(txt), '_blank');
  }

  /* ── Boot ────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditor);
  } else {
    initEditor();
  }

  global.CRE_EDITOR = {
    activate: activate,
    getState: function () { return state; },
    getActiveProposalId: function () { return (getActiveProposal() || {}).id || null; },
    loadProposal: loadProposal,
    refreshProposalSelect: refreshProposalSelect,
    saveProposal: saveProposal,
    discardChanges: discardChanges,
    isDirty: function () { return isDirty; },
    openHistoryModal: openHistoryModal,
    openCompareModal: openCompareModal,
    openNewRevisionModal: openNewRevisionModal,
    createManualRevision: createManualRevision,
    exportHistory: exportHistory,
    listRevisions: listRevisions,
    viewRevision: viewRevision,
    duplicateRevision: duplicateRevision,
    restoreRevisionFrom: restoreRevisionFrom,
    refreshEditor: function () {
      render();
      updateStatusBar();
      updateRevUI();
    }
  };

})(window);