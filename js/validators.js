/* ============================================================
   GEOREVEST STUDIO — validators.js
   Regras de formulário e mensagens de erro em pt-BR.

   A checagem fiscal mora em fiscal.js (CRE_FISCAL) e é a única fonte de
   verdade de CNPJ/CPF/CEP/e-mail/telefone/dinheiro/data. Este arquivo só
   decide *quando* olhar e *o que* dizer — nunca reimplementa dígito
   verificador, porque uma segunda implementação é como um terceiro
   código: passa no teste e erra no documento emitido.

   Funções puras (sem DOM): validate, required, cnpj, cpf, cep, email,
   telefone, data, money, ncm, documento — todas devolvem '' quando o
   valor está válido, e a mensagem quando não está.
   Com DOM: renderErrors e attach.

   Ordem de carga no index.html: fiscal.js antes de validators.js.
   ============================================================ */

(function (global) {
  'use strict';

  /* ── Rótulos ───────────────────────────────────── */

  function trimmed(v) {
    if (v == null) return '';
    return String(v).replace(/^\s+|\s+$/g, '');
  }

  function F() {
    return global.CRE_FISCAL;
  }

  /* O artigo do aviso ("Informe o CNPJ" / "Informe a Data") é o detalhe
     que faz a mensagem parecer escrita por gente. O acento é removido só
     para casar rótulos digitados com e sem acento — sem depender de
     locale, que pode faltar no runtime. */
  var FEMININO = [
    'data', 'razao social', 'senha', 'chave', 'cidade', 'empresa',
    'proposta', 'descricao', 'categoria', 'modalidade', 'validade',
    'moeda', 'quantidade', 'unidade', 'analise', 'observacao',
    'especialidade', 'inscricao estadual', 'inscricao municipal',
    'natureza da operacao', 'condicao de pagamento'
  ];

  var MASCULINO = [
    'cnpj', 'cpf', 'cep', 'ncm', 'nome', 'telefone', 'celular',
    'whatsapp', 'e-mail', 'email', 'documento', 'valor', 'preco',
    'total', 'cliente', 'parceiro', 'vencimento', 'projeto', 'servico',
    'orcamento', 'numero', 'titulo', 'arquivo', 'bairro', 'logradouro',
    'municipio', 'complemento', 'cnae', 'cfop', 'site', 'link',
    'vendedor', 'responsavel', 'contato', 'telefone comercial'
  ];

  function chaveTexto(v) {
    return String(v == null ? '' : v)
      .toLowerCase()
      .replace(/[áàâãä]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòôõö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/ç/g, 'c')
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  function achouNaLista(lista, texto) {
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] === texto) return true;
    }
    return false;
  }

  function achouComoPrefixo(lista, texto) {
    for (var i = 0; i < lista.length; i++) {
      if (texto.indexOf(lista[i]) === 0) return true;
    }
    return false;
  }

  function artigo(rotulo) {
    var k = chaveTexto(rotulo);
    if (achouNaLista(FEMININO, k) || achouComoPrefixo(FEMININO, k)) return 'a ';
    if (achouNaLista(MASCULINO, k) || achouComoPrefixo(MASCULINO, k)) return 'o ';
    return 'o ';
  }

  function rotuloDe(valor, padrao) {
    return trimmed(valor) || padrao;
  }

  function estaVazio(v) {
    if (v == null) return true;
    if (typeof v === 'string') return trimmed(v) === '';
    if (typeof v === 'boolean') return v === false;
    return false;
  }

  function soDigitos(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /* ── Checagens puras (mensagem ou '') ──────────── */

  function required(value, label) {
    var rot = rotuloDe(label, 'campo');
    if (value === false) return 'Marque ' + artigo(rot) + rot + '.';
    if (estaVazio(value)) return 'Informe ' + artigo(rot) + rot + '.';
    return '';
  }

  function cnpj(value, label) {
    if (estaVazio(value)) return '';
    var rot = rotuloDe(label, 'CNPJ');
    if (F().isValidCnpj(value)) return '';
    return rot + ' inválido. Confira os 14 dígitos.';
  }

  function cpf(value, label) {
    if (estaVazio(value)) return '';
    var rot = rotuloDe(label, 'CPF');
    if (F().isValidCpf(value)) return '';
    return rot + ' inválido. Confira os 11 dígitos.';
  }

  function documento(value, label) {
    if (estaVazio(value)) return '';
    var rot = rotuloDe(label, 'Documento');
    if (F().isValidCpf(value) || F().isValidCnpj(value)) return '';
    return rot + ' inválido. Informe CPF com 11 dígitos ou CNPJ com 14.';
  }

  function cep(value, label) {
    if (estaVazio(value)) return '';
    var rot = rotuloDe(label, 'CEP');
    if (F().isValidCep(value)) return '';
    return rot + ' inválido. São 8 dígitos.';
  }

  function email(value, label) {
    if (estaVazio(value)) return '';
    var rot = rotuloDe(label, 'E-mail');
    if (F().isValidEmail(value)) return '';
    return rot + ' inválido. Use o formato nome@dominio.com.br.';
  }

  function telefone(value, label) {
    if (estaVazio(value)) return '';
    var rot = rotuloDe(label, 'Telefone');
    if (F().isValidPhoneBR(value)) return '';
    return rot + ' inválido. Informe DDD e número, 10 ou 11 dígitos.';
  }

  function ncm(value, label) {
    if (estaVazio(value)) return '';
    var rot = rotuloDe(label, 'NCM');
    if (soDigitos(value).length === 8) return '';
    return rot + ' inválido. São 8 dígitos.';
  }

  /* O app usa <input type="date"> (AAAA-MM-DD), mas o valor chega de
     importação e de formulário montado à mão em DD/MM/AAAA — aceitar os
     dois formatos evita dizer "inválido" para uma data que existe. */
  function data(value, label) {
    if (estaVazio(value)) return '';
    if (F().isValidISODate(value)) return '';
    if (typeof value === 'string') {
      var br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed(value));
      if (br) {
        var iso = br[3] + '-' + pad2(Number(br[2])) + '-' + pad2(Number(br[1]));
        if (F().isValidISODate(iso)) return '';
      }
    }
    var rot = rotuloDe(label, '');
    return (rot ? rot + ' — ' : '') + 'data inválida. Use AAAA-MM-DD ou DD/MM/AAAA.';
  }

  /* parseMoney devolve 0 para lixo, então "0" e "abc" são indistinguíveis
     pelo número. O dígito no texto é o que separa um zero legítimo de
     uma entrada que não é dinheiro. */
  function money(value, label) {
    if (estaVazio(value)) return '';
    if (typeof value === 'number') {
      if (isFinite(value)) return '';
      return 'Valor inválido. Use números, por exemplo 1.234,56.';
    }
    var limpo = String(value).replace(/[^\d.,-]/g, '');
    if (!/\d/.test(limpo)) {
      var rot = rotuloDe(label, '');
      return (rot ? rot + ' — ' : '') + 'valor inválido. Use números, por exemplo 1.234,56.';
    }
    return '';
  }

  /* ── Inferência de tipo ────────────────────────── */

  function inferirTipo(texto) {
    var k = chaveTexto(texto);
    if (!k) return 'text';
    if (k.indexOf('cnpj') !== -1) return 'cnpj';
    if (k.indexOf('cpf') !== -1) return 'cpf';
    if (k.indexOf('documento') !== -1 || k.indexOf('document') !== -1) return 'documento';
    if (k.indexOf('ncm') !== -1) return 'ncm';
    if (k.indexOf('cfop') !== -1) return 'text';
    if (k.indexOf('e-mail') !== -1 || k.indexOf('email') !== -1 || k.indexOf('mail') !== -1) return 'email';
    if (k.indexOf('telefone') !== -1 || k.indexOf('celular') !== -1 ||
        k.indexOf('whatsapp') !== -1 || k.indexOf('phone') !== -1 ||
        k.indexOf('fone') !== -1) return 'telefone';
    if (k.indexOf('valor') !== -1 || k.indexOf('preco') !== -1 ||
        k.indexOf('price') !== -1 || k.indexOf('money') !== -1 ||
        k === 'total' || k.indexOf('total ') === 0) return 'money';
    if (k.indexOf('data') !== -1 || k.indexOf('date') !== -1 ||
        k.indexOf('vencimento') !== -1 || k.indexOf('emissao') !== -1 ||
        k.indexOf('due') !== -1) return 'data';
    if (k.indexOf('cep') !== -1) return 'cep';
    return 'text';
  }

  var ALIAS_TIPO = {
    tel: 'telefone',
    phone: 'telefone',
    celular: 'telefone',
    date: 'data',
    dinheiro: 'money',
    valor: 'money',
    texto: 'text',
    string: 'text'
  };

  function checar(f) {
    if (!f) return '';
    var rot = trimmed(f.label) || trimmed(f.key) || trimmed(f.name) || 'campo';
    var obrig = f.required === true || f.required === 'true' || f.required === 1;

    if (obrig) {
      var falta = required(f.value, rot);
      if (falta) return falta;
    }
    if (estaVazio(f.value)) return '';

    var t = String(f.type || 'text').toLowerCase();
    if (ALIAS_TIPO[t]) t = ALIAS_TIPO[t];
    if (t === 'text' || t === 'number' || t === 'select' || t === 'textarea' ||
        t === 'checkbox' || t === 'radio' || t === 'tel' || t === 'date') {
      if (t === 'tel') t = 'telefone';
      else if (t === 'date') t = 'data';
      else if (t === 'text') t = inferirTipo(rot + ' ' + (f.key || '') + ' ' + (f.name || ''));
    }

    switch (t) {
      case 'cnpj': return cnpj(f.value, rot);
      case 'cpf': return cpf(f.value, rot);
      case 'documento': return documento(f.value, rot);
      case 'cep': return cep(f.value, rot);
      case 'email': return email(f.value, rot);
      case 'telefone': return telefone(f.value, rot);
      case 'ncm': return ncm(f.value, rot);
      case 'data': return data(f.value, rot);
      case 'money': return money(f.value, rot);
      default: return '';
    }
  }

  /* Descritor: { key, label, value, type, required }.
     O primeiro erro de cada chave vence — o usuário lê uma frase por
     campo, não uma fila de acusações. */
  function validate(fields) {
    var erros = {};
    if (!fields || typeof fields.length !== 'number') return erros;
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f) continue;
      var chave = trimmed(f.key) || trimmed(f.name);
      if (!chave) continue;
      if (erros[chave]) continue;
      var msg = checar(f);
      if (msg) erros[chave] = msg;
    }
    return erros;
  }

  /* ── DOM: escape, campos e mensagens ───────────── */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function chaveCampo(el) {
    if (!el) return '';
    return el.getAttribute('data-field') || el.getAttribute('name') || el.getAttribute('id') || '';
  }

  function campos(root) {
    var out = [];
    if (!root || !root.querySelectorAll) return out;
    var els = root.querySelectorAll('input, select, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var t = String(el.type || '').toLowerCase();
      if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image') continue;
      if (el.disabled) continue;
      if (!chaveCampo(el)) continue;
      out.push(el);
    }
    return out;
  }

  function rotulo(el) {
    var r = el.getAttribute('data-label') || el.getAttribute('aria-label') || '';
    if (trimmed(r)) return trimmed(r);
    if (el.id && el.ownerDocument && el.id.indexOf('"') === -1) {
      var lab = el.ownerDocument.querySelector('label[for="' + el.id + '"]');
      if (lab && trimmed(lab.textContent)) return trimmed(lab.textContent);
    }
    if (trimmed(el.getAttribute('placeholder'))) return trimmed(el.getAttribute('placeholder'));
    return chaveCampo(el);
  }

  function valor(el) {
    var t = String(el.type || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio') return !!el.checked;
    return el.value;
  }

  function obrigatorio(el) {
    if (el.getAttribute('required') != null) return true;
    if (el.getAttribute('aria-required') === 'true') return true;
    var d = el.getAttribute('data-required');
    return d != null && d !== 'false' && d !== '0';
  }

  function tipo(el) {
    var declarado = String(el.getAttribute('data-validate') || '').toLowerCase();
    if (declarado) return declarado;
    var t = String(el.type || '').toLowerCase();
    if (t === 'email') return 'email';
    if (t === 'tel') return 'telefone';
    if (t === 'date') return 'data';
    return inferirTipo(chaveCampo(el) + ' ' + (el.id || ''));
  }

  function descritor(el) {
    return {
      key: chaveCampo(el),
      label: rotulo(el),
      value: valor(el),
      type: tipo(el),
      required: obrigatorio(el)
    };
  }

  function idErro(chave) {
    return 'erro-' + String(chave).replace(/[^A-Za-z0-9_-]/g, '-');
  }

  function acharCampo(root, chave) {
    var els = campos(root);
    for (var i = 0; i < els.length; i++) {
      if (chaveCampo(els[i]) === chave) return els[i];
    }
    return null;
  }

  function caixaErro(el, id) {
    var pai = el.parentNode;
    if (!pai) return null;
    var filhos = pai.childNodes;
    for (var i = 0; i < filhos.length; i++) {
      if (filhos[i].nodeType === 1 && filhos[i].getAttribute &&
          filhos[i].getAttribute('id') === id) return filhos[i];
    }
    var doc = el.ownerDocument || global.document;
    if (!doc) return null;
    var caixa = doc.createElement('span');
    caixa.setAttribute('id', id);
    caixa.className = 'cre-campo-erro';
    pai.insertBefore(caixa, el.nextSibling);
    return caixa;
  }

  /* aria-invalid + aria-describedby: o leitor de tela anuncia a mensagem
     quando o foco chega ao campo. A caixa nasce colada ao campo para não
     depender do resumo no topo estar visível. */
  function aplicarErro(el, msg, chave) {
    var id = idErro(chave);
    var caixa = caixaErro(el, id);
    if (caixa) {
      while (caixa.firstChild) caixa.removeChild(caixa.firstChild);
      var doc = el.ownerDocument || global.document;
      if (doc) caixa.appendChild(doc.createTextNode(msg));
    }
    el.setAttribute('aria-invalid', 'true');
    var desc = el.getAttribute('aria-describedby') || '';
    if ((' ' + desc + ' ').indexOf(' ' + id + ' ') === -1) {
      el.setAttribute('aria-describedby', desc ? desc + ' ' + id : id);
    }
  }

  function limparErro(el, chave) {
    var id = idErro(chave);
    el.removeAttribute('aria-invalid');
    var desc = el.getAttribute('aria-describedby');
    if (desc) {
      var partes = desc.split(/\s+/);
      var fora = [];
      for (var i = 0; i < partes.length; i++) {
        if (partes[i] && partes[i] !== id) fora.push(partes[i]);
      }
      if (fora.length) el.setAttribute('aria-describedby', fora.join(' '));
      else el.removeAttribute('aria-describedby');
    }
    var pai = el.parentNode;
    if (!pai) return;
    var filhos = pai.childNodes;
    for (var j = filhos.length - 1; j >= 0; j--) {
      if (filhos[j].nodeType === 1 && filhos[j].getAttribute &&
          filhos[j].getAttribute('id') === id && filhos[j].className === 'cre-campo-erro') {
        pai.removeChild(filhos[j]);
      }
    }
  }

  function marcar(root, erros) {
    var els = campos(root);
    for (var i = 0; i < els.length; i++) {
      var chave = chaveCampo(els[i]);
      if (erros && erros[chave]) aplicarErro(els[i], erros[chave], chave);
      else limparErro(els[i], chave);
    }
  }

  /* renderErrors(errors) -> HTML do resumo, pronto para inserir.
     Com root, também marca os campos (aria-invalid) e liga cada mensagem
     ao campo pelo id — é o que torna o resumo navegável por teclado. */
  function renderErrors(erros, root) {
    var chaves = [];
    if (erros) {
      for (var k in erros) {
        if (Object.prototype.hasOwnProperty.call(erros, k) && erros[k]) chaves.push(k);
      }
    }
    if (root && root.querySelectorAll) marcar(root, erros || {});
    if (!chaves.length) return '';

    var titulo = chaves.length === 1
      ? '1 campo precisa de correção antes de enviar:'
      : chaves.length + ' campos precisam de correção antes de enviar:';

    var html = '<div class="cre-resumo-erros" id="cre-resumo-erros" role="alert" tabindex="-1">' +
      '<p>' + esc(titulo) + '</p><ul>';
    for (var i = 0; i < chaves.length; i++) {
      var alvo = root ? acharCampo(root, chaves[i]) : null;
      var msg = esc(erros[chaves[i]]);
      html += '<li>' + (alvo && alvo.id ? '<a href="#' + esc(alvo.id) + '">' + msg + '</a>' : msg) + '</li>';
    }
    html += '</ul></div>';
    return html;
  }

  function limparResumo(root) {
    if (!root || !root.querySelectorAll) return;
    var velhos = root.querySelectorAll('.cre-resumo-erros');
    for (var i = velhos.length - 1; i >= 0; i--) {
      if (velhos[i].parentNode) velhos[i].parentNode.removeChild(velhos[i]);
    }
    var explicito = root.querySelector('[data-erro-resumo]');
    if (explicito) explicito.innerHTML = '';
  }

  function mostrarResumo(root, erros) {
    var html = renderErrors(erros, null);
    if (!html) return;
    limparResumo(root);
    var alvo = root.querySelector ? root.querySelector('[data-erro-resumo]') : null;
    if (alvo) {
      alvo.innerHTML = html;
    } else if (root.insertAdjacentHTML) {
      root.insertAdjacentHTML('afterbegin', html);
    }
  }

  /* ── attach(root) ──────────────────────────────── */

  /* blur valida campo a campo (sem roubar o foco de volta), submit
     valida tudo, impede o envio e leva o foco ao primeiro inválido —
     quem corrige não precisa procurar onde está o erro. */
  function attach(root) {
    if (!root || !root.addEventListener) return null;
    if (root._creValidadores) return root._creValidadores;

    function semErros() {
      var els = campos(root);
      for (var i = 0; i < els.length; i++) {
        if (els[i].getAttribute('aria-invalid') === 'true') return false;
      }
      return true;
    }

    function checarEl(el) {
      var chave = chaveCampo(el);
      var msg = checar(descritor(el));
      if (msg) aplicarErro(el, msg, chave);
      else limparErro(el, chave);
      return msg;
    }

    function onBlur(e) {
      checarEl(e.target);
      if (semErros()) limparResumo(root);
    }

    function onSubmit(e) {
      var els = campos(root);
      var erros = {};
      var primeiro = null;
      for (var i = 0; i < els.length; i++) {
        var msg = checarEl(els[i]);
        if (!msg) continue;
        var chave = chaveCampo(els[i]);
        if (!erros[chave]) erros[chave] = msg;
        if (!primeiro) primeiro = els[i];
      }
      if (!primeiro) {
        limparResumo(root);
        return true;
      }
      // Só preventDefault: parar a propagação mataria o handler de save
      // que modules.js registra no mesmo formulário.
      if (e && e.preventDefault) e.preventDefault();
      mostrarResumo(root, erros);
      if (primeiro && primeiro.focus) primeiro.focus();
      return false;
    }

    var els = campos(root);
    for (var i = 0; i < els.length; i++) {
      els[i].addEventListener('blur', onBlur, false);
    }
    root.addEventListener('submit', onSubmit, true);

    var api = {
      root: root,
      campos: function () { return campos(root); },
      validarTudo: function () {
        var lista = campos(root);
        var erros = {};
        for (var j = 0; j < lista.length; j++) {
          var msg = checar(descritor(lista[j]));
          if (msg && !erros[chaveCampo(lista[j])]) erros[chaveCampo(lista[j])] = msg;
        }
        return erros;
      },
      limpar: function () {
        var lista = campos(root);
        for (var j = 0; j < lista.length; j++) limparErro(lista[j], chaveCampo(lista[j]));
        limparResumo(root);
      }
    };
    root._creValidadores = api;
    return api;
  }

  /* ── API pública ───────────────────────────────── */

  global.CRE_VALIDATORS = {
    validate: validate,
    required: required,
    cnpj: cnpj,
    cpf: cpf,
    documento: documento,
    cep: cep,
    email: email,
    telefone: telefone,
    ncm: ncm,
    data: data,
    money: money,
    renderErrors: renderErrors,
    attach: attach
  };

})(typeof window !== 'undefined' ? window : this);
