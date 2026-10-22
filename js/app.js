/* ============================================================
   GEOREVEST STUDIO — app.js
   Navegação por abas, modal compartilhado, toasts, cópia e utilitários.
   ============================================================ */

(function (global) {
  'use strict';

  /* ── Helpers ─────────────────────────────── */

  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.from((c || document).querySelectorAll(s)); }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    /* Serialização de texto escapa &, < e > mas NÃO aspas — e este helper
       é usado o tempo todo dentro de atributos delimitados por aspas
       (value="…", title="…"). Sem escapar aspas, um dado com " quebrava
       para fora do atributo e injetava evento. */
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(d) {
    if (!d) return '—';
    var dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    var dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function initials(name) {
    name = (name || '').trim();
    if (!name) return '?';
    var parts = name.split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  var AVATAR_GRADIENTS = [
    'linear-gradient(135deg, #0284c7, #0369a1)', // Ocean Blue
    'linear-gradient(135deg, #059669, #047857)', // Emerald Green
    'linear-gradient(135deg, #7c3aed, #6d28d9)', // Royal Violet
    'linear-gradient(135deg, #ea580c, #c2410c)', // Warm Amber/Orange
    'linear-gradient(135deg, #db2777, #be185d)', // Rose
    'linear-gradient(135deg, #0891b2, #0e7490)', // Cyan Slate
    'linear-gradient(135deg, #4f46e5, #3730a3)', // Indigo
    'linear-gradient(135deg, #d97706, #b45309)'  // Golden bronze
  ];

  function avatarGradient(str) {
    var hash = 0;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
    var idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
    return AVATAR_GRADIENTS[idx];
  }

  function statusLabel(status) {
    var map = { draft: 'Rascunho', sent: 'Enviada', approved: 'Aprovada', rejected: 'Recusada' };
    return map[status] || 'Rascunho';
  }

  function statusPill(status) {
    var st = status || 'draft';
    return '<span class="pill pill-' + st + '"><span class="pill-dot"></span>' + esc(statusLabel(st)) + '</span>';
  }

  /* ── Toasts de Notificação ───────────────── */

  function showToast(message, type, duration) {
    var container = $('#toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    type = type || 'info';
    duration = duration || 3200;

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    var iconMap = {
      success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    toast.innerHTML =
      '<span class="toast-ic">' + (iconMap[type] || iconMap.info) + '</span>' +
      '<div class="toast-msg">' + esc(message) + '</div>' +
      '<button class="toast-close" title="Fechar" aria-label="Fechar notificação">&times;</button>' +
      (type === 'error' ? '' : '<div class="toast-progress"><div class="toast-bar" style="animation-duration:' + duration + 'ms"></div></div>');

    container.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add('show');
    });

    var timer = null;
    if (type !== 'error') {
      timer = setTimeout(function () {
        dismissToast(toast);
      }, duration);
    }

    var closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (timer) clearTimeout(timer);
        dismissToast(toast);
      });
    }
  }

  function dismissToast(toast) {
    if (!toast || toast.classList.contains('hide')) return;
    toast.classList.add('hide');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 280);
  }

  /* ── Copiar texto para Clipboard ─────────── */

  function copyText(text, successMsg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast(successMsg || 'Copiado para a área de transferência!', 'success');
      }).catch(function () {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(successMsg || 'Copiado para a área de transferência!', 'success');
    } catch (e) {
      showToast('Não foi possível copiar', 'error');
    }
    document.body.removeChild(ta);
  }

  /* ── Financeiro (BRL) ────────────────────── */

  var TOTAL_COL_RE = /valor|total|pre\u00e7o|preco|custo|price|v\.? ?total/i;

  /* Uma implementação, uma semântica. A regra viva está em fiscal.js
     (CRE_FISCAL.parseMoney): "3.5" é 3,5 e "1.234,56" é 1234,56. Manter
     uma segunda regra aqui é exatamente como o bug de casa decimal
     sobreviveu. fiscal.js carrega antes de app.js em index.html e é
     pré-requisito declarado do app. */
  function parseBRL(str) {
    return global.CRE_FISCAL.parseMoney(str);
  }

  function fmtBRL(v) {
    var n = parseFloat(v) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function totalColIndex(cols) {
    if (!Array.isArray(cols)) return null;
    for (var i = 0; i < cols.length; i++) {
      if (TOTAL_COL_RE.test(String(cols[i] || ''))) return i;
    }
    return null;
  }

  function tableTotal(d) {
    var ci = totalColIndex(d && d.cols);
    if (ci === null) return 0;
    return (d.rows || []).reduce(function (acc, r) {
      return acc + parseBRL(r && r[ci]);
    }, 0);
  }

  function proposalTotal(layout) {
    var total = 0;
    var blocks = layout && layout.blocks;
    if (!Array.isArray(blocks)) return 0;
    blocks.forEach(function (b) {
      var d = b && b.data;
      if (!d) return;
      if (b.type === 'commercial') total += tableTotal(d);
      (d.extras || []).forEach(function (ex) {
        if (ex && ex.type === 'table') total += tableTotal(ex);
      });
    });
    return Math.round(total * 100) / 100;
  }

  /* ── Modal compartilhado ─────────────────── */

  var appModal = $('#appModal');
  var appModalTitle = $('#appModalTitle');
  var appModalBody = $('#appModalBody');
  var modalLastActive = null;
  var modalTrapHandler = null;

  function getFocusable(el) {
    if (!el) return [];
    var selectors = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    var nodes = el.querySelectorAll(selectors);
    var res = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var style = window.getComputedStyle ? window.getComputedStyle(n) : { display: 'block', visibility: 'visible' };
      if (style.display === 'none' || style.visibility === 'hidden' || n.getAttribute('aria-hidden') === 'true') continue;
      res.push(n);
    }
    return res;
  }

  function openModal(title, html) {
    modalLastActive = document.activeElement;
    appModalTitle.textContent = title;
    appModalBody.innerHTML = html;
    appModal.classList.add('open');
    var appMain = $('#app-main');
    if (appMain && typeof appMain.setAttribute === 'function') {
      try { appMain.setAttribute('inert', ''); } catch (e) { /* degrade */ }
    }
    var focusables = getFocusable(appModal);
    if (focusables.length > 0) {
      try { focusables[0].focus(); } catch (e) { /* no focus */ }
    } else if (appModal && typeof appModal.focus === 'function') {
      try { appModal.focus(); } catch (e) { /* no focus */ }
    }
    if (modalTrapHandler) {
      window.removeEventListener('keydown', modalTrapHandler);
      modalTrapHandler = null;
    }
    modalTrapHandler = function (e) {
      if (!appModal.classList.contains('open')) return;
      if (e.key === 'Tab') {
        var f = getFocusable(appModal);
        if (f.length === 0) { e.preventDefault(); return; }
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { last.focus(); e.preventDefault(); }
        } else {
          if (document.activeElement === last) { first.focus(); e.preventDefault(); }
        }
      }
    };
    window.addEventListener('keydown', modalTrapHandler);
  }

  function closeModal() {
    if (!appModal) return;
    appModal.classList.remove('open');
    appModalBody.innerHTML = '';
    var appMain = $('#app-main');
    if (appMain && typeof appMain.removeAttribute === 'function') {
      try { appMain.removeAttribute('inert'); } catch (e) { /* degrade */ }
    }
    if (modalTrapHandler) {
      window.removeEventListener('keydown', modalTrapHandler);
      modalTrapHandler = null;
    }
    if (modalLastActive && typeof modalLastActive.focus === 'function') {
      try { modalLastActive.focus(); } catch (e) { /* no focus */ }
    }
    modalLastActive = null;
  }

  var appModalCloseBtn = $('#appModalClose');
  if (appModalCloseBtn) appModalCloseBtn.addEventListener('click', closeModal);
  if (appModal) {
    appModal.addEventListener('click', function (e) {
      if (e.target === appModal) closeModal();
    });
  }

  function confirmDialog(title, message, onOk, okLabel) {
    openModal(title,
      '<div class="confirm-content">' +
        '<div class="confirm-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
        '<p class="confirm-text" id="confirmMsg">' + esc(message) + '</p>' +
      '</div>' +
      '<div class="btn-row" style="justify-content:flex-end;margin-top:18px">' +
        '<button class="btn btn-secondary" id="cfNo" aria-describedby="confirmMsg">Cancelar</button>' +
        '<button class="btn btn-danger" id="cfYes" aria-describedby="confirmMsg">' + esc(okLabel || 'Confirmar') + '</button>' +
      '</div>');
    var cfNo = $('#cfNo');
    if (cfNo && typeof cfNo.focus === 'function') {
      try { cfNo.focus(); } catch (e) { /* no focus */ }
    }
    $('#cfNo').addEventListener('click', closeModal);
    $('#cfYes').addEventListener('click', function () {
      closeModal();
      if (typeof onOk === 'function') onOk();
    });
  }

  /* ── Navegação por abas ──────────────────── */

  var tabs = $$('#tabsNav .tab');
  var views = $$('.view');
  var currentTab = 'dashboard';

  function switchTab(name) {
    currentTab = name;
    tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); if (t.setAttribute) t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false'); });
    views.forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });

    if (name === 'editor' && global.CRE_EDITOR) {
      global.CRE_EDITOR.activate();
    }
    if (name === 'dashboard' && global.CRE_MODULES) {
      global.CRE_MODULES.renderDashboard();
    }
    if (name === 'proposals' && global.CRE_MODULES) {
      global.CRE_MODULES.renderProposals();
    }
    if (name === 'invoices' && global.CRE_MODULES) {
      global.CRE_MODULES.renderInvoices();
    }
    if (name === 'clients' && global.CRE_MODULES) {
      global.CRE_MODULES.renderClients();
    }
    if (name === 'partners' && global.CRE_MODULES) {
      global.CRE_MODULES.renderPartners();
    }
    if (name === 'settings' && global.CRE_MODULES) {
      global.CRE_MODULES.renderSettings();
    }
  }

  tabs.forEach(function (t) {
    if (t.setAttribute) t.setAttribute('aria-selected', t.dataset.tab === currentTab ? 'true' : 'false');
    t.addEventListener('click', function () { switchTab(t.dataset.tab); });
  });

  /* ── Atalhos de Teclado Modal ────────────── */

  function showShortcutsModal() {
    var shortcuts = [
      { key: 'Ctrl + B', desc: 'Negrito no editor' },
      { key: 'Ctrl + I', desc: 'Itálico no editor' },
      { key: 'Ctrl + U', desc: 'Sublinhado no editor' },
      { key: 'Ctrl + Z', desc: 'Desfazer alteração' },
      { key: 'Ctrl + Shift + Z', desc: 'Refazer alteração' },
      { key: 'Ctrl + S', desc: 'Salvar proposta ativa' },
      { key: 'Ctrl + Shift + S', desc: 'Salvar e criar nova revisão do orçamento' },
      { key: 'Ctrl + H', desc: 'Histórico de revisões do orçamento' },
      { key: 'Ctrl + Alt + D', desc: 'Comparar revisões do orçamento' },
      { key: 'Ctrl + P', desc: 'Imprimir ou salvar PDF' },
      { key: 'Ctrl + F', desc: 'Localizar e substituir no texto' },
      { key: 'Ctrl + K', desc: 'Abrir a paleta de comandos' },
      { key: 'Esc', desc: 'Fechar janela ou modal aberta' },
      { key: '?', desc: 'Abrir esta tela de ajuda de atalhos' }
    ];

    var rows = shortcuts.map(function (s) {
      return '<div class="shortcut-row"><span class="shortcut-key"><kbd>' + esc(s.key) + '</kbd></span><span class="shortcut-desc">' + esc(s.desc) + '</span></div>';
    }).join('');

    openModal('Atalhos de Teclado',
      '<div class="shortcuts-box">' + rows + '</div>' +
      '<div class="btn-row" style="justify-content:flex-end;margin-top:16px">' +
        '<button class="btn btn-primary" id="scClose">Entendido</button>' +
      '</div>');
    $('#scClose').addEventListener('click', closeModal);
  }

  var shortcutsBtn = $('#btnShortcuts');
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener('click', showShortcutsModal);
  }

  /* ── Paleta de Comandos (Ctrl+K) ─────────── */

  var cmdItems = [];
  var cmdActive = -1;
  var cmdOverlayEl = null;

  function cmdRun(label, fn, hint) {
    return { label: label, hint: hint || '', run: fn };
  }

  function buildCommands() {
    var list = [];
    list.push({ section: 'Navegação' });
    list.push(cmdRun('Dashboard', function () { switchTab('dashboard'); }, 'Início'));
    list.push(cmdRun('Propostas', function () { switchTab('proposals'); }, ''));
    list.push(cmdRun('Notas Fiscais', function () { switchTab('invoices'); }, ''));
    list.push(cmdRun('Layouts', function () { switchTab('editor'); }, 'Estúdio de Layout'));
    list.push(cmdRun('Clientes', function () { switchTab('clients'); }, ''));
    list.push(cmdRun('Parceiros', function () { switchTab('partners'); }, ''));
    list.push(cmdRun('Configurações', function () { switchTab('settings'); }, ''));
    list.push({ section: 'Ações rápidas' });
    list.push(cmdRun('Nova proposta', function () { var b = $('#btnNewProposalQuick'); if (b) b.click(); }, ''));
    list.push(cmdRun('Novo cliente', function () {
      switchTab('clients');
      setTimeout(function () { var b = $('#btnAddClient'); if (b) b.click(); }, 30);
    }, ''));
    list.push(cmdRun('Alternar tema', function () { var b = $('#btnTheme'); if (b) b.click(); }, 'Claro/Escuro'));
    list.push(cmdRun('Atalhos de teclado', showShortcutsModal, '?'));
    if (currentTab === 'editor' && global.CRE_EDITOR) {
      list.push({ section: 'Editor' });
      list.push(cmdRun('Adicionar bloco', function () { var b = $('#btnAddBlock'); if (b) b.click(); }, ''));
      list.push(cmdRun('Salvar proposta', function () { global.CRE_EDITOR.saveProposal(); }, 'Ctrl + S'));
      list.push(cmdRun('Nova revisão', function () { global.CRE_EDITOR.openNewRevisionModal(); }, 'Ctrl + Shift + S'));
      list.push(cmdRun('Histórico de revisões', function () { global.CRE_EDITOR.openHistoryModal(); }, 'Ctrl + H'));
      list.push(cmdRun('Comparar revisões', function () { global.CRE_EDITOR.openCompareModal(); }, 'Ctrl + Alt + D'));
      list.push(cmdRun('Descartar alterações', function () { global.CRE_EDITOR.discardChanges(); }, ''));
      list.push(cmdRun('Salvar como modelo', function () { var b = $('#btnSaveAsTemplate'); if (b) b.click(); }, ''));
      list.push(cmdRun('Novo layout padrão', function () { var b = $('#btnNew'); if (b) b.click(); }, ''));
      list.push(cmdRun('Imprimir / PDF', function () { var b = $('#btnPrint'); if (b) b.click(); }, ''));
      list.push(cmdRun('Exportar HTML', function () { var b = $('#btnExportHTML'); if (b) b.click(); }, ''));
      list.push(cmdRun('Exportar JSON', function () { var b = $('#btnExport'); if (b) b.click(); }, ''));
      list.push(cmdRun('Importar JSON', function () { var b = $('#btnImport'); if (b) b.click(); }, ''));
      list.push(cmdRun('Enviar por e-mail', function () { var b = $('#btnShareMail'); if (b) b.click(); }, ''));
      list.push(cmdRun('Enviar por WhatsApp', function () { var b = $('#btnShareWa'); if (b) b.click(); }, ''));
      list.push(cmdRun('Localizar e substituir', function () { var b = $('#rbFind'); if (b) b.click(); }, 'Ctrl + F'));
      list.push(cmdRun('Contagem de palavras', function () { var b = $('#rbWords'); if (b) b.click(); }, ''));
      list.push(cmdRun('Alternar barra lateral', function () { var b = $('#btnToggleSidebar'); if (b) b.click(); }, ''));
    }
    return list;
  }

  var cmdLastActive = null;
  var cmdTrapHandler = null;

  function ensureCmdDom() {
    if (cmdOverlayEl) return;
    var ov = document.createElement('div');
    ov.id = 'cmdOverlay';
    ov.className = 'cmd-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'cmdSearch');
    ov.innerHTML =
      '<div class="cmd-box">' +
        '<div class="cmd-search-wrap">' +
          '<span class="cmd-search-icon" aria-hidden="true">⌘</span>' +
          '<input type="text" id="cmdSearch" class="cmd-search" placeholder="Digite para filtrar comandos..." autocomplete="off" spellcheck="false">' +
          '<kbd class="cmd-esc" aria-hidden="true">Esc</kbd>' +
        '</div>' +
        '<div class="cmd-list" id="cmdList" role="listbox"></div>' +
      '</div>';
    document.body.appendChild(ov);
    cmdOverlayEl = ov;
    $('#cmdSearch', ov).addEventListener('input', function () {
      cmdActive = -1;
      renderCmdList();
    });
    $('#cmdSearch', ov).addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveCmdActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveCmdActive(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runCmdActive(); }
    });
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeCommandPalette(); });
    ov.addEventListener('mouseover', function (e) {
      var it = e.target.closest('.cmd-item');
      if (it) {
        var idx = parseInt(it.dataset.idx, 10);
        if (!isNaN(idx)) { cmdActive = idx; updateCmdSelection(); }
      }
    });
  }

  function renderCmdList() {
    var q = ($('#cmdSearch', cmdOverlayEl).value || '').toLowerCase().trim();
    var raw = buildCommands();
    var listEl = $('#cmdList', cmdOverlayEl);
    listEl.innerHTML = '';
    var items = [];
    var section = '';
    raw.forEach(function (it) {
      if (it.section) { section = it.section; return; }
      var hits = !q || it.label.toLowerCase().indexOf(q) !== -1 || it.hint.toLowerCase().indexOf(q) !== -1;
      if (!hits) return;
      if (section && (!items.length || items[items.length - 1]._sec !== section)) {
        items.push({ _sec: section, _head: true });
      }
      it._sec = section;
      items.push(it);
    });
    cmdItems = items;
    if (cmdItems.length) {
      if (cmdActive < 0 || cmdActive >= cmdItems.length || cmdItems[cmdActive]._head) cmdActive = -1;
      for (var i = 0; i < cmdItems.length && cmdActive === -1; i++) {
        if (!cmdItems[i]._head) cmdActive = i;
      }
    }
    items.forEach(function (it, i) {
      if (it._head) {
        var h = document.createElement('div');
        h.className = 'cmd-section';
        h.textContent = it._sec;
        listEl.appendChild(h);
        return;
      }
      var row = document.createElement('div');
      row.className = 'cmd-item' + (i === cmdActive ? ' sel' : '');
      row.dataset.idx = i;
      var label = document.createElement('span');
      label.className = 'cmd-label';
      label.textContent = it.label;
      row.appendChild(label);
      if (it.hint) {
        var hint = document.createElement('span');
        hint.className = 'cmd-hint';
        hint.textContent = it.hint;
        row.appendChild(hint);
      }
      row.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        runCmdAt(parseInt(row.dataset.idx, 10));
      });
      listEl.appendChild(row);
    });
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'cmd-empty';
      empty.textContent = 'Nenhum comando encontrado.';
      listEl.appendChild(empty);
    }
  }

  function moveCmdActive(delta) {
    if (!cmdItems.length) return;
    var max = cmdItems.length - 1;
    do {
      cmdActive += delta;
      if (cmdActive < 0) cmdActive = max;
      if (cmdActive > max) cmdActive = 0;
    } while (cmdItems[cmdActive]._head);
    updateCmdSelection();
  }

  function updateCmdSelection() {
    $$('.cmd-item', $('#cmdList', cmdOverlayEl)).forEach(function (row) {
      var idx = parseInt(row.dataset.idx, 10);
      row.classList.toggle('sel', idx === cmdActive);
      if (idx === cmdActive) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function runCmdActive() {
    if (!cmdItems.length || cmdActive < 0) return;
    runCmdAt(cmdActive);
  }

  function runCmdAt(idx) {
    var it = cmdItems[idx];
    if (!it || it._head) return;
    closeCommandPalette();
    try { it.run(); } catch (e) { /* silent */ }
  }

  function openCommandPalette() {
    ensureCmdDom();
    cmdLastActive = document.activeElement;
    cmdOverlayEl.classList.add('open');
    var appMain = $('#app-main');
    if (appMain && typeof appMain.setAttribute === 'function') {
      try { appMain.setAttribute('inert', ''); } catch (e) { /* degrade */ }
    }
    var input = $('#cmdSearch', cmdOverlayEl);
    input.value = '';
    cmdActive = -1;
    renderCmdList();
    setTimeout(function () { input.focus(); }, 0);
    if (cmdTrapHandler) {
      window.removeEventListener('keydown', cmdTrapHandler);
      cmdTrapHandler = null;
    }
    cmdTrapHandler = function (e) {
      if (!(cmdOverlayEl && cmdOverlayEl.classList.contains('open'))) return;
      if (e.key === 'Tab') {
        var f = getFocusable(cmdOverlayEl);
        if (f.length === 0) { e.preventDefault(); return; }
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { last.focus(); e.preventDefault(); }
        } else {
          if (document.activeElement === last) { first.focus(); e.preventDefault(); }
        }
      }
    };
    window.addEventListener('keydown', cmdTrapHandler);
  }

  function closeCommandPalette() {
    if (cmdOverlayEl) cmdOverlayEl.classList.remove('open');
    var appMain = $('#app-main');
    if (appMain && typeof appMain.removeAttribute === 'function') {
      try { appMain.removeAttribute('inert'); } catch (e) { /* degrade */ }
    }
    if (cmdTrapHandler) {
      window.removeEventListener('keydown', cmdTrapHandler);
      cmdTrapHandler = null;
    }
    if (cmdLastActive && typeof cmdLastActive.focus === 'function') {
      try { cmdLastActive.focus(); } catch (e) { /* no focus */ }
    }
    cmdLastActive = null;
  }

  var cmdBtn = $('#btnCommandPalette');
  if (cmdBtn) cmdBtn.addEventListener('click', openCommandPalette);

  /* Global Keyboard Listeners */
  window.addEventListener('keydown', function (e) {
    // Paleta de comandos (Ctrl+K)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (cmdOverlayEl && cmdOverlayEl.classList.contains('open')) closeCommandPalette();
      else openCommandPalette();
      return;
    }
    // Esc: close command palette or any modal
    if (e.key === 'Escape') {
      if (cmdOverlayEl && cmdOverlayEl.classList.contains('open')) {
        closeCommandPalette();
        return;
      }
      var modalOpen = $('.modal-overlay.open');
      if (modalOpen) {
        closeModal();
        var edModal = $('#modalOverlay');
        if (edModal) edModal.classList.remove('open');
        var findModal = $('#findOverlay');
        if (findModal) findModal.classList.remove('open');
      }
    }
    // ? when not typing in an input
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && !e.target.isContentEditable) {
      e.preventDefault();
      showShortcutsModal();
    }
    // Ctrl+S / Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (currentTab === 'editor' && global.CRE_EDITOR && typeof global.CRE_EDITOR.saveProposal === 'function') {
        global.CRE_EDITOR.saveProposal();
        if (e.shiftKey && typeof global.CRE_EDITOR.openNewRevisionModal === 'function') {
          global.CRE_EDITOR.openNewRevisionModal();
        }
      } else if (global.CRE_DATA && typeof global.CRE_DATA.save === 'function') {
        /* Fora do editor não há tela aberta para "salvar": o que existe é
           gravar o que estiver pendente no localStorage. Só prometemos
           sucesso se o storage aceitou. */
        var r = global.CRE_DATA.save();
        if (r && r.ok) showToast('Dados gravados no armazenamento local.', 'success');
        else showToast('Falha ao gravar: ' + ((r && r.mensagem) || 'armazenamento local indisponível.'), 'error');
      } else {
        showToast('Nada para salvar aqui.', 'info');
      }
    }
  });

  /* ── Status de Conexão Online/Offline ───── */

  var connDot = $('#connDot');
  function updateConnStatus() {
    if (!connDot) return;
    if (navigator.onLine) {
      connDot.className = 'status-dot online';
      connDot.title = 'Online — Dados salvos localmente';
      connDot.setAttribute('aria-label', 'Conexão online');
    } else {
      connDot.className = 'status-dot offline';
      connDot.title = 'Modo Offline — Dados salvos localmente';
      connDot.setAttribute('aria-label', 'Conexão offline');
    }
    var connLabel = $('#connLabel');
    if (connLabel) {
      connLabel.textContent = navigator.onLine ? 'Online' : 'Offline';
    }
  }
  window.addEventListener('online', updateConnStatus);
  window.addEventListener('offline', updateConnStatus);
  updateConnStatus();

  /* ── Tema claro / escuro ─────────────────── */

  var THEME_KEY = 'georevest-theme';
  var themeBtn = $('#btnTheme');

  function updateThemeButton(theme) {
    if (!themeBtn) return;
    if (theme === 'light') {
      themeBtn.innerHTML = '<span class="tb-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></span><span>Escuro</span>';
    } else {
      themeBtn.innerHTML = '<span class="tb-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></span><span>Claro</span>';
    }
  }

  function applyTheme(t, userTriggered) {
    var theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* silent */ }
    updateThemeButton(theme);
    try {
      var saved = localStorage.getItem(ACCENT_KEY) || '';
      if (saved) applyAccent(saved);
    } catch (e) { /* silent */ }
    if (userTriggered) {
      showToast(theme === 'light' ? 'Tema claro ativado' : 'Tema escuro ativado', 'info', 1600);
    }
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* silent */ }
    var theme = saved;
    if (!theme) {
      try {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
          theme = 'light';
        } else {
          theme = 'dark';
        }
      } catch (e) {
        theme = 'dark';
      }
    }
    applyTheme(theme, false);
  }

  initTheme();

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(cur === 'light' ? 'dark' : 'light', true);
    });
  }

  /* ── Personalização de tema (cor de destaque) ── */

  var ACCENT_KEY = 'georevest-accent';

  function shade(hex, per) {
    hex = String(hex || '').replace('#', '');
    if (hex.length !== 6) return hex;
    var n = parseInt(hex, 16);
    var target = per < 0 ? 0 : 255;
    var p = Math.abs(per) / 100;
    var r = Math.round(((n >> 16) & 255) * (1 - p) + target * p);
    var g = Math.round(((n >> 8) & 255) * (1 - p) + target * p);
    var b = Math.round((n & 255) * (1 - p) + target * p);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function syncAccentUI(h) {
    $$('.swatch[data-accent]').forEach(function (b) {
      b.classList.toggle('active', String(b.dataset.accent).toLowerCase() === String(h).toLowerCase());
    });
    var custom = $('#cfgAccentCustom');
    if (custom && h && !custom.matches(':focus')) custom.value = h;
  }

  function applyAccent(hex) {
    var h = /^#?([0-9a-f]{6})$/i.test(hex) ? '#' + String(hex).replace('#', '').toLowerCase() : '';
    var html = document.documentElement;
    if (!h) return;
    var isLight = (html.getAttribute('data-theme') || 'dark') === 'light';
    html.style.setProperty('--accent', h);
    html.style.setProperty('--accent-h', shade(h, isLight ? -18 : 16));
    html.style.setProperty('--accent-soft', h + (isLight ? '1a' : '28'));
    try { localStorage.setItem(ACCENT_KEY, h); } catch (e) { /* silent */ }
    syncAccentUI(h);
  }

  function clearAccent() {
    var html = document.documentElement;
    html.style.removeProperty('--accent');
    html.style.removeProperty('--accent-h');
    html.style.removeProperty('--accent-soft');
    try { localStorage.removeItem(ACCENT_KEY); } catch (e) { /* silent */ }
    syncAccentUI('');
    showToast('Cor padrão restaurada.', 'info', 1600);
  }

  function initThemeCustomization() {
    var saved = '';
    try { saved = localStorage.getItem(ACCENT_KEY) || ''; } catch (e) { /* silent */ }
    if (saved) applyAccent(saved);
    else syncAccentUI('');

    $$('.swatch[data-accent]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.accent) {
          applyAccent(b.dataset.accent);
          showToast('Cor de destaque atualizada!', 'success', 1600);
        } else {
          clearAccent();
        }
      });
    });
    var custom = $('#cfgAccentCustom');
    if (custom) {
      custom.addEventListener('input', function () { applyAccent(custom.value); });
    }
    var reset = $('#cfgThemeReset');
    if (reset) reset.addEventListener('click', clearAccent);
  }

  initThemeCustomization();

  /* ── API pública ─────────────────────────── */

  global.CRE = {
    $: $,
    $$: $$,
    esc: esc,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    initials: initials,
    avatarGradient: avatarGradient,
    statusLabel: statusLabel,
    statusPill: statusPill,
    parseBRL: parseBRL,
    fmtBRL: fmtBRL,
    totalColIndex: totalColIndex,
    tableTotal: tableTotal,
    proposalTotal: proposalTotal,
    applyTheme: applyTheme,
    applyAccent: applyAccent,
    clearAccent: clearAccent,
    openModal: openModal,
    closeModal: closeModal,
    confirm: confirmDialog,
    toast: showToast,
    copy: copyText,
    showShortcuts: showShortcutsModal,
    switchTab: switchTab,
    get currentTab() { return currentTab; }
  };

})(window);