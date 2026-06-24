;(() => {
  var iframe = document.getElementById('redact-preview-iframe')

  // ── Mode panels & toggle ──────────────────────────────────────────────────
  var modeRadios = document.querySelectorAll('input[name="redact-mode"]')
  var panels = {
    assisted: document.getElementById('panel-assisted'),
    manual:   document.getElementById('panel-manual'),
    area:     document.getElementById('panel-area')
  }

  modeRadios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      var target = radio.value
      Object.values(panels).forEach(function (p) { if (p) p.classList.remove('dcf-redact-panel--visible') })
      if (panels[target]) panels[target].classList.add('dcf-redact-panel--visible')
      applyHighlights()
      exitDrawMode()
      updateUnsavedTag()
    })
  })

  // ── PDF.js find ───────────────────────────────────────────────────────────
  var pdfApp = null

  function dispatchFind (terms) {
    pdfApp.eventBus.dispatch('find', {
      source: {},
      type: '',
      query: terms,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false
    })
  }

  var _highlightObserver = null

  function classifyHighlights () {
    try {
      var doc = iframe.contentDocument
      if (!doc) return

      var allTerms = new Map()
      ;[manualInstHighlight, assistedInstHighlight].forEach(function (hlMap) {
        hlMap.forEach(function (indexMap, text) {
          if (!allTerms.has(text)) allTerms.set(text, indexMap)
        })
      })
      if (allTerms.size === 0) return

      allTerms.forEach(function (indexMap, text) {
        var tl = text.toLowerCase()
        var spans = []
        doc.querySelectorAll('.textLayer .highlight').forEach(function (span) {
          var st = span.textContent.toLowerCase().trim()
          if (st === tl || (st.length > 3 && tl.startsWith(st + ' ')) || (st.length > 3 && tl.endsWith(' ' + st))) {
            spans.push(span)
          }
        })
        spans.forEach(function (span, i) {
          span.classList.remove('dcf-highlight--saved', 'dcf-highlight--rejected')
          var state = indexMap.get(i)
          if (state === 'saved')    span.classList.add('dcf-highlight--saved')
          if (state === 'rejected') span.classList.add('dcf-highlight--rejected')
        })
      })
    } catch (e) {}
  }

  function setupHighlightObserver () {
    if (_highlightObserver) _highlightObserver.disconnect()
    try {
      var doc = iframe.contentDocument
      if (!doc) return
      _highlightObserver = new doc.defaultView.MutationObserver(function (mutations) {
        var relevant = mutations.some(function (m) {
          if (m.type === 'childList') {
            return Array.from(m.addedNodes).some(function (n) {
              return (n.classList && n.classList.contains('highlight')) ||
                     (n.querySelectorAll && n.querySelectorAll('.highlight').length > 0)
            })
          }
          if (m.type === 'attributes' && m.attributeName === 'class') {
            return m.target.classList && m.target.classList.contains('highlight')
          }
          return false
        })
        if (relevant) classifyHighlights()
      })
      _highlightObserver.observe(doc.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class']
      })
    } catch (e) {}
  }

  function injectHighlightStyle () {
    try {
      var doc = iframe.contentDocument
      var el = doc.createElement('style')
      var wave = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 1.5 Q1.5 0 3 1.5 Q4.5 3 6 1.5' fill='none' stroke='%231d70b8' stroke-width='1.5'/%3E%3C/svg%3E"
      var waveSelected = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 1.5 Q1.5 0 3 1.5 Q4.5 3 6 1.5' fill='none' stroke='%23003078' stroke-width='1.5'/%3E%3C/svg%3E"
      el.textContent =
        '.textLayer .highlight {' +
          'background: url("' + wave + '") repeat-x left bottom / 6px 3px, rgba(29,112,184,0.12) !important;' +
          'padding-bottom: 2px !important;' +
        '}' +
        '.textLayer .highlight.selected {' +
          'background: url("' + waveSelected + '") repeat-x left bottom / 6px 3px, rgba(29,112,184,0.25) !important;' +
          'padding-bottom: 2px !important;' +
        '}' +
        '.textLayer .highlight.dcf-highlight--saved {' +
          'background: url("' + wave + '") repeat-x left bottom / 6px 3px, rgba(0,112,60,0.20) !important;' +
          'padding-bottom: 2px !important;' +
        '}' +
        '.textLayer .highlight.dcf-highlight--saved.selected {' +
          'background: url("' + waveSelected + '") repeat-x left bottom / 6px 3px, rgba(0,112,60,0.35) !important;' +
          'padding-bottom: 2px !important;' +
        '}' +
        '.textLayer .highlight.dcf-highlight--rejected {' +
          'background: rgba(244,119,56,0.25) !important;' +
          'padding-bottom: 2px !important;' +
        '}' +
        '.textLayer .highlight.dcf-highlight--rejected.selected {' +
          'background: rgba(244,119,56,0.45) !important;' +
          'padding-bottom: 2px !important;' +
        '}'
      doc.head.appendChild(el)
    } catch (e) {}
  }

  function focusInstance (term, index) {
    if (!pdfApp) return

    pdfApp.eventBus.dispatch('find', {
      source: {}, type: '', query: term,
      caseSensitive: false, entireWord: false,
      highlightAll: true, findPrevious: false
    })
    if (index === 0) return
    setTimeout(function () {
      var step = 0
      ;(function next () {
        pdfApp.eventBus.dispatch('find', {
          source: {}, type: 'again', query: term,
          caseSensitive: false, entireWord: false,
          highlightAll: true, findPrevious: false
        })
        if (++step < index) setTimeout(next, 60)
      })()
    }, 80)
  }

  function applyHighlights () {
    if (!pdfApp) return
    var assistedActive = panels.assisted && panels.assisted.classList.contains('dcf-redact-panel--visible')
    var manualActive   = panels.manual   && panels.manual.classList.contains('dcf-redact-panel--visible')
    var cartTerms = []
    var _seenCart = new Set()
    cartItems.forEach(function (item, key) {
      var t = item.text || key
      if (!_seenCart.has(t)) { _seenCart.add(t); cartTerms.push(t) }
    })

    if (assistedActive) {
      var assistedTerms = Array.from(assistedItems.keys()).concat(cartTerms)
      if (assistedTerms.length) { dispatchFind(assistedTerms); return }
    }
    if (manualActive) {
      var manualTerms = Array.from(manualItems.keys()).concat(cartTerms)
      if (manualTerms.length) { dispatchFind(manualTerms); return }
    }
    if (cartTerms.length) { dispatchFind(cartTerms); return }
    pdfApp.eventBus.dispatch('findbarclose', { source: {} })
  }

  // ── Shared helpers ────────────────────────────────────────────────────────
  var fullDocText = ''

  function extractFullText (pdfDocument) {
    var pages = pdfDocument.numPages
    var promises = []
    for (var i = 1; i <= pages; i++) {
      promises.push(
        pdfDocument.getPage(i)
          .then(function (page) { return page.getTextContent() })
          .then(function (tc) { return tc.items.map(function (it) { return it.str }).join(' ') })
      )
    }
    Promise.all(promises).then(function (texts) {
      fullDocText = texts.join(' ')
      // Sync state totals to actual document snippet counts now that text is loaded
      syncStateTotals(assistedItems, assistedInstState)
      syncStateTotals(manualItems, manualInstState)
      renderAssistedList()
      renderManualList()
    })
  }

  function syncStateTotals (itemsMap, stateMap) {
    itemsMap.forEach(function (count, text) {
      var snippets = getContextSnippets(text)
      if (!snippets || snippets.length === 0) return
      var actual = snippets.length
      var s = stateMap.get(text)
      if (!s || s.total === actual) return
      s.total = actual
      var used = s.accepted + s.rejected
      if (used > actual) s.accepted = Math.max(0, actual - s.rejected)
    })
  }

  function countInDoc (text) {
    if (!text || !fullDocText) return 0
    var escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return (fullDocText.match(new RegExp(escaped, 'gi')) || []).length
  }

  function escHtml (str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function updateUnsavedTag () {
    var count = cartItems.size
    var counter = document.getElementById('dcf-cart-count')
    if (counter) {
      counter.hidden = count === 0
      counter.textContent = '(' + count + ')'
    }
  }

  var caseIdMatch = window.location.pathname.match(/\/cases\/(\d+)\//)
  var caseId = caseIdMatch ? caseIdMatch[1] : null

  function classifySelection (text, cb) {
    if (!caseId) return cb('Unclassified')
    fetch('/cases/' + caseId + '/material/redact/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: text })
    })
      .then(function (r) { return r.json() })
      .then(function (data) { cb(data.type || 'Unclassified') })
      .catch(function () { cb('Unclassified') })
  }

  function getContextSnippets (text) {
    if (!fullDocText || !text) return null
    var snippets = []
    var escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    var re = new RegExp(escaped, 'gi')
    var match
    while ((match = re.exec(fullDocText)) !== null) {
      var start = match.index
      var end   = start + match[0].length
      var before = fullDocText.slice(Math.max(0, start - 200), start)
      var after  = fullDocText.slice(end, end + 200)
      snippets.push({
        before: before.trim().split(/\s+/).filter(Boolean).slice(-5).join(' '),
        term:   match[0],
        after:  after.trim().split(/\s+/).filter(Boolean).slice(0, 5).join(' ')
      })
    }
    return snippets
  }

  // ── Per-instance state ────────────────────────────────────────────────────
  // Each state entry: { accepted: n, rejected: n, total: n }
  // pending = total - accepted - rejected
  var assistedInstState = new Map()
  var manualInstState   = new Map()
  var cartItems         = new Map()   // key → { text, type, source } or area: { count, type, source:'area', areaId }
  var cartInstanceCounter = 0
  var manualInstHighlight   = new Map()  // text → Map<instanceIndex, 'saved'|'rejected'>
  var assistedInstHighlight = new Map()

  function getInstHighlight (source, text) {
    var m = source === 'assisted' ? assistedInstHighlight : manualInstHighlight
    if (!m.has(text)) m.set(text, new Map())
    return m.get(text)
  }

  function initInstState (stateMap, text, total) {
    stateMap.set(text, { accepted: 0, rejected: 0, total: total })
  }

  function getPending (stateMap, itemsMap, text) {
    var s = stateMap.get(text)
    if (!s) return itemsMap.get(text) || 0
    return Math.max(0, s.total - s.accepted - s.rejected)
  }

  function getAccepted (stateMap, text) {
    var s = stateMap.get(text)
    return s ? s.accepted : 0
  }

  function getItemDisplayState (stateMap, itemsMap, text) {
    if (getPending(stateMap, itemsMap, text) > 0) return 'pending'
    return getAccepted(stateMap, text) > 0 ? 'saved' : 'not-required'
  }

  // ── Shared cart ───────────────────────────────────────────────────────────────
  function getActiveForm () {
    if (panels.assisted && panels.assisted.classList.contains('dcf-redact-panel--visible'))
      return document.getElementById('dcf-assisted-form')
    if (panels.manual && panels.manual.classList.contains('dcf-redact-panel--visible'))
      return document.getElementById('dcf-manual-form')
    if (panels.area && panels.area.classList.contains('dcf-redact-panel--visible'))
      return document.getElementById('dcf-area-form')
    return document.getElementById('dcf-assisted-form')
  }

  function resetAll () {
    cartItems.clear()
    assistedItems.clear()
    assistedInstState.clear()
    manualItems.clear()
    manualTypes.clear()
    manualInstState.clear()
    areaItems = []
    areaCounter = 0
    areaItemStates.clear()
    findings.forEach(function (f) {
      assistedItems.set(f.value, f.instances)
      assistedTypes.set(f.value, f.type || null)
      initInstState(assistedInstState, f.value, f.instances)
    })
    exitDrawMode()
    renderCart()
    renderAssistedList()
    renderManualList()
    renderAreaList()
    applyHighlights()
  }

  function renderCart () {
    var cartDiv  = document.getElementById('dcf-redaction-cart')
    var cartList = document.getElementById('dcf-cart-list')
    var emptyMsg = document.getElementById('dcf-cart-empty-msg')
    if (!cartList) return
    cartList.innerHTML = ''
    var hasItems = cartItems.size > 0
    if (emptyMsg) emptyMsg.hidden = hasItems

    // Group text items by term — one cart line per unique term
    var termGroups = new Map()
    cartItems.forEach(function (item, key) {
      if (item.source === 'area') return
      if (!termGroups.has(item.text)) termGroups.set(item.text, { keys: [], item: item })
      termGroups.get(item.text).keys.push(key)
    })
    termGroups.forEach(function (group, text) {
      var count = group.keys.length
      var li = document.createElement('li')
      li.className = 'dcf-cart-item'
      li.setAttribute('data-term', text)
      li.innerHTML =
        '<span class="govuk-body-s">' + escHtml(text) + (count > 1 ? ' (' + count + ')' : '') + '</span>' +
        '<button type="button" class="dcf-cart-remove">' + (count > 1 ? 'Remove all' : 'Remove') + '</button>'
      li.querySelector('.dcf-cart-remove').addEventListener('click', function () {
        removeFromCart(group.keys[0])
      })
      cartList.appendChild(li)
    })
    // Area items render individually
    cartItems.forEach(function (item, key) {
      if (item.source !== 'area') return
      var li = document.createElement('li')
      li.className = 'dcf-cart-item'
      li.innerHTML =
        '<span class="govuk-body-s">' + escHtml(key) + '</span>' +
        '<button type="button" class="dcf-cart-remove">Remove</button>'
      li.querySelector('.dcf-cart-remove').addEventListener('click', function () {
        removeFromCart(key)
      })
      cartList.appendChild(li)
    })

    var existingActions = cartDiv ? cartDiv.querySelector('.dcf-cart-actions') : null
    if (existingActions) existingActions.remove()

    if (hasItems && cartDiv) {
      var actions = document.createElement('div')
      actions.className = 'govuk-button-group govuk-!-margin-top-6 govuk-!-margin-bottom-0 dcf-cart-actions'
      actions.innerHTML =
        '<button type="button" class="govuk-button dcf-cart-preview">Preview redactions</button>' +
        '<button type="button" class="govuk-link dcf-cart-reset">Clear cart</button>'
      actions.querySelector('.dcf-cart-preview').addEventListener('click', function () {
        var form = getActiveForm()
        if (form) form.requestSubmit()
      })
      actions.querySelector('.dcf-cart-reset').addEventListener('click', resetAll)
      cartDiv.appendChild(actions)
    }

    updateUnsavedTag()
    classifyHighlights()
  }

  function addToCart (text, source) {
    var stateMap = source === 'assisted' ? assistedInstState : manualInstState
    var itemsMap = source === 'assisted' ? assistedItems     : manualItems
    var typesMap = source === 'assisted' ? assistedTypes     : manualTypes
    var count = getAccepted(stateMap, text) + getPending(stateMap, itemsMap, text)
    if (count === 0) return
    var type = typesMap.get(text) || 'Unclassified'
    cartItems.set(text, { count: count, type: type, source: source })
    itemsMap.delete(text)
    renderCart()
    if (source === 'assisted') renderAssistedList()
    else renderManualList()
    applyHighlights()
  }

  function removeFromCart (key) {
    var item = cartItems.get(key)
    if (!item) return
    if (item.source === 'area') {
      cartItems.delete(key)
      areaItemStates.set(item.areaId, 'pending')
      renderCart()
      renderAreaList()
      return
    }
    var text = item.text
    // Remove all cart entries for this term and reset to fully pending
    var keysToDelete = []
    cartItems.forEach(function (ci, ck) { if (ci.text === text) keysToDelete.push(ck) })
    keysToDelete.forEach(function (k) { cartItems.delete(k) })
    var stateMap = item.source === 'assisted' ? assistedInstState : manualInstState
    var s = stateMap.get(text)
    if (s) { s.accepted = 0; s.rejected = 0; stateMap.set(text, s) }
    renderCart()
    if (item.source === 'assisted') renderAssistedList()
    else renderManualList()
    applyHighlights()
  }

  // ── Cart focus (click highlight in PDF → open term in cart) ─────────────────
  function focusCartItem (term) {
    var cartList = document.getElementById('dcf-cart-list')
    var _termInCart = false
    cartItems.forEach(function (item, key) { if ((item.text || key) === term) _termInCart = true })
    if (cartList && _termInCart) {
      var cartLi = cartList.querySelector('li[data-term="' + term.replace(/"/g, '\\"') + '"]')
      if (cartLi) {
        cartLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        cartLi.classList.add('dcf-cart-focused')
        setTimeout(function () { cartLi.classList.remove('dcf-cart-focused') }, 1400)
        return
      }
    }
    var assistedActive = panels.assisted && panels.assisted.classList.contains('dcf-redact-panel--visible')
    var manualActive   = panels.manual   && panels.manual.classList.contains('dcf-redact-panel--visible')
    var listId = assistedActive ? 'dcf-assisted-list' : manualActive ? 'dcf-manual-list' : null
    if (!listId) return
    var list = document.getElementById(listId)
    if (!list) return

    var targetDetails = null
    list.querySelectorAll('.govuk-details').forEach(function (d) {
      var strong = d.querySelector('.govuk-details__summary-text strong')
      if (strong && strong.textContent.trim() === term) targetDetails = d
    })
    if (!targetDetails) return

    targetDetails.open = true
    targetDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    targetDetails.classList.add('dcf-cart-focused')
    setTimeout(function () { targetDetails.classList.remove('dcf-cart-focused') }, 1400)
  }

  function updateSubmitGates () {}

  // ── List item (text redactions) ───────────────────────────────────────────
  function makeListItem (text, stateMap, itemsMap, onAcceptInstance, onIgnoreInstance, onAcceptAll, onIgnoreAll, onAddToCart, onUndo, source) {
    var li = document.createElement('li')
    li.className = 'dcf-manual-list__item'

    var pending      = getPending(stateMap, itemsMap, text)
    var displayState = getItemDisplayState(stateMap, itemsMap, text)
    var snippets = getContextSnippets(text)
    var shownSnippets = snippets ? (displayState === 'pending' ? snippets.slice(0, pending) : snippets) : null

    var stateTag = displayState !== 'pending'
      ? '<div class="govuk-!-margin-top-2"><strong class="govuk-tag govuk-tag--' +
          (displayState === 'saved' ? 'green">Saved' : 'orange">Not required') +
        '</strong></div>'
      : ''

    var detailsBody = ''
    if (shownSnippets === null) {
      detailsBody = '<p class="govuk-body-s">Loading context…</p>'
    } else if (shownSnippets.length === 0) {
      detailsBody = '<p class="govuk-body-s">No context available.</p>'
    } else if (shownSnippets.length === 1) {
      var s0 = shownSnippets[0]
      detailsBody =
        '<div class="dcf-redact-instance">' +
          '<button type="button" class="dcf-redact-instance__focus govuk-body-s">' +
            (s0.before ? escHtml(s0.before) + ' ' : '') +
            '<strong>' + escHtml(s0.term) + '</strong>' +
            (s0.after ? ' ' + escHtml(s0.after) : '') +
          '</button>' +
          stateTag +
        '</div>'
    } else {
      detailsBody = shownSnippets.map(function (s, i) {
        var html =
          '<div class="dcf-redact-instance">' +
            '<button type="button" class="dcf-redact-instance__focus govuk-body-s">' +
              (s.before ? escHtml(s.before) + ' ' : '') +
              '<strong>' + escHtml(s.term) + '</strong>' +
              (s.after ? ' ' + escHtml(s.after) : '') +
            '</button>' +
            (displayState === 'pending'
              ? '<div class="dcf-redact-instance__actions">' +
                  '<button type="button" class="dcf-redact-instance__accept govuk-link" data-instance-index="' + i + '">Save</button>' +
                  '<button type="button" class="dcf-redact-instance__remove govuk-link" data-instance-index="' + i + '">Ignore</button>' +
                '</div>'
              : '') +
          '</div>'
        if (i < shownSnippets.length - 1) {
          html += '<hr class="govuk-section-break govuk-section-break--m govuk-section-break--visible">'
        }
        return html
      }).join('')
      if (displayState !== 'pending') detailsBody += stateTag
    }

    var singleInstanceBtns = (displayState === 'pending' && shownSnippets && shownSnippets.length === 1 && pending === 1)
      ? '<div class="govuk-button-group govuk-!-margin-top-4 govuk-!-margin-bottom-1">' +
          '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-redact-instance__accept">Save</button>' +
          '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-redact-instance__remove">Ignore</button>' +
        '</div>'
      : ''

    var sState = stateMap.get(text)
    li.innerHTML =
      '<details class="govuk-details govuk-!-margin-bottom-1" data-term="' + escHtml(text) + '">' +
        '<summary class="govuk-details__summary">' +
          '<span class="govuk-details__summary-text">' +
            '<strong>' + escHtml(text) + '</strong>' +
            (displayState === 'pending'
              ? ' (' + pending + ')'
              : displayState === 'saved'
                ? ' <strong class="govuk-tag govuk-tag--green govuk-!-margin-left-1">Saved</strong>'
                : ' <strong class="govuk-tag govuk-tag--orange govuk-!-margin-left-1">Not required</strong>') +
          '</span>' +
        '</summary>' +
        '<div class="govuk-details__text dcf-redact-context">' + detailsBody + '</div>' +
      '</details>' +
      singleInstanceBtns +
      (pending > 1 && onAcceptAll && onIgnoreAll
        ? '<div class="govuk-button-group govuk-!-margin-top-4 govuk-!-margin-bottom-1">' +
            '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-term-accept-all">Save all</button>' +
            '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-term-ignore-all">Ignore all</button>' +
          '</div>'
        : (displayState !== 'pending' && sState && sState.total > 1
          ? '<div class="govuk-button-group govuk-!-margin-top-4 govuk-!-margin-bottom-1 dcf-dynamic-undo-all">' +
              '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-undo-all-static">Undo all</button>' +
            '</div>'
          : '')) +
      (displayState === 'pending' && (onAddToCart || onUndo)
        ? '<div class="dcf-bucket-controls dcf-bucket-controls--term">' +
            (onAddToCart ? '<button type="button" class="govuk-link dcf-add-to-cart">Save</button>' : '') +
            (onUndo ? '<button type="button" class="govuk-link dcf-undo-selection">Undo</button>' : '') +
          '</div>'
        : '')

    li.querySelectorAll('.dcf-redact-instance__accept').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
        var cKey = null
        if (getPending(stateMap, itemsMap, text) > 0) { s.accepted++; stateMap.set(text, s) }
        if (source && s.accepted > 0) {
          var typesMap = source === 'assisted' ? assistedTypes : manualTypes
          cKey = text + '|' + (++cartInstanceCounter)
          cartItems.set(cKey, { text: text, type: typesMap.get(text) || 'Unclassified', source: source })
          renderCart()
        }
        var original = btn.parentNode
        var container = original.parentNode
        if (btn.parentNode.classList.contains('dcf-redact-instance__actions')) {
          // Multi-instance: inline Saved tag + Undo link replacing the actions div
          var savedWrapper = document.createElement('div')
          savedWrapper.className = 'govuk-!-margin-top-2'
          savedWrapper.innerHTML =
            '<strong class="govuk-tag govuk-tag--green">Saved</strong>' +
            ' <button type="button" class="govuk-link dcf-undo-instance">Undo</button>'
          container.replaceChild(savedWrapper, original)
          savedWrapper.querySelector('.dcf-undo-instance').addEventListener('click', function () {
            var sPreUndo = stateMap.get(text)
            var wasAllSaved = sPreUndo && sPreUndo.accepted === sPreUndo.total && sPreUndo.rejected === 0
            if (cKey) cartItems.delete(cKey)
            var s2 = stateMap.get(text)
            if (s2 && s2.accepted > 0) { s2.accepted--; stateMap.set(text, s2) }
            renderCart()
            container.replaceChild(original, savedWrapper)
            if (wasAllSaved) {
              var dynUndoDiv = li.querySelector('.dcf-dynamic-undo-all')
              if (dynUndoDiv) {
                var newBG = document.createElement('div')
                newBG.className = 'govuk-button-group govuk-!-margin-top-4 govuk-!-margin-bottom-1'
                newBG.innerHTML =
                  '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-term-accept-all">Save all</button>' +
                  '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-term-ignore-all">Ignore all</button>'
                dynUndoDiv.parentNode.replaceChild(newBG, dynUndoDiv)
              }
            }
            classifyHighlights()
          })
          var sNow = stateMap.get(text)
          if (sNow && sNow.total > 1 && sNow.accepted === sNow.total && sNow.rejected === 0) {
            var acceptAllBtnDyn = li.querySelector('.dcf-term-accept-all')
            if (acceptAllBtnDyn) {
              var existingBtnGrp = acceptAllBtnDyn.parentNode
              var dynUndoAllDiv = document.createElement('div')
              dynUndoAllDiv.className = 'govuk-button-group govuk-!-margin-top-4 govuk-!-margin-bottom-1 dcf-dynamic-undo-all'
              dynUndoAllDiv.innerHTML = '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0">Undo all</button>'
              existingBtnGrp.parentNode.replaceChild(dynUndoAllDiv, existingBtnGrp)
              dynUndoAllDiv.querySelector('.govuk-button').addEventListener('click', function () {
                var sU = stateMap.get(text)
                if (sU) { sU.accepted = 0; sU.rejected = 0; stateMap.set(text, sU) }
                var delKeys = []
                cartItems.forEach(function (ci, ck) { if (ci.text === text) delKeys.push(ck) })
                delKeys.forEach(function (k) { cartItems.delete(k) })
                renderCart()
                if (source === 'assisted') { renderAssistedList(); } else { renderManualList(); }
                applyHighlights()
              })
            }
          }
          classifyHighlights()
        } else {
          // Single-instance main button: Saved tag inside details + secondary Undo button below
          var addedTag = null
          var detailsEl = li.querySelector('.govuk-details')
          if (detailsEl) {
            var instanceEl = detailsEl.querySelector('.dcf-redact-instance')
            if (instanceEl) {
              addedTag = document.createElement('div')
              addedTag.className = 'govuk-!-margin-top-2'
              addedTag.innerHTML = '<strong class="govuk-tag govuk-tag--green">Saved</strong>'
              instanceEl.appendChild(addedTag)
            }
          }
          var undoWrapper = document.createElement('div')
          undoWrapper.className = 'govuk-!-margin-top-4 govuk-!-margin-bottom-1'
          undoWrapper.innerHTML = '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-undo-term">Undo</button>'
          container.replaceChild(undoWrapper, original)
          undoWrapper.querySelector('.dcf-undo-term').addEventListener('click', function () {
            if (cKey) cartItems.delete(cKey)
            var s2 = stateMap.get(text)
            if (s2 && s2.accepted > 0) { s2.accepted--; stateMap.set(text, s2) }
            renderCart()
            if (addedTag && addedTag.parentNode) addedTag.parentNode.removeChild(addedTag)
            container.replaceChild(original, undoWrapper)
            classifyHighlights()
          })
          classifyHighlights()
        }
      })
    })
    li.querySelectorAll('.dcf-redact-instance__remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
        if (getPending(stateMap, itemsMap, text) > 0) { s.rejected++; stateMap.set(text, s) }
        var original = btn.parentNode
        var container = original.parentNode
        var wrapper = document.createElement('div')
        wrapper.className = 'govuk-!-margin-top-2'
        if (btn.parentNode.classList.contains('dcf-redact-instance__actions')) {
          // Per-instance link: orange tag + undo inline
          wrapper.innerHTML =
            '<strong class="govuk-tag govuk-tag--orange">Not required</strong>' +
            ' <button type="button" class="govuk-link dcf-undo-instance">Undo</button>'
          container.replaceChild(wrapper, original)
          wrapper.querySelector('.dcf-undo-instance').addEventListener('click', function () {
            if (s.rejected > 0) { s.rejected--; stateMap.set(text, s) }
            container.replaceChild(original, wrapper)
            classifyHighlights()
          })
        } else {
          // Main button (singleInstanceBtns): secondary undo button; add tag inside <details>
          var addedTag = null
          var detailsEl = li.querySelector('.govuk-details')
          if (detailsEl) {
            var instanceEl = detailsEl.querySelector('.dcf-redact-instance')
            if (instanceEl) {
              addedTag = document.createElement('div')
              addedTag.className = 'govuk-!-margin-top-2'
              addedTag.innerHTML = '<strong class="govuk-tag govuk-tag--orange">Not required</strong>'
              instanceEl.appendChild(addedTag)
            }
          }
          wrapper.className = 'govuk-!-margin-top-4 govuk-!-margin-bottom-1'
          wrapper.innerHTML = '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-undo-term">Undo</button>'
          container.replaceChild(wrapper, original)
          wrapper.querySelector('.dcf-undo-term').addEventListener('click', function () {
            if (s.rejected > 0) { s.rejected--; stateMap.set(text, s) }
            if (addedTag && addedTag.parentNode) addedTag.parentNode.removeChild(addedTag)
            container.replaceChild(original, wrapper)
            classifyHighlights()
          })
        }
        classifyHighlights()
      })
    })
    li.querySelectorAll('.dcf-redact-instance__focus').forEach(function (btn, i) {
      btn.addEventListener('click', function () { focusInstance(text, i) })
    })
    var staticUndoAll = li.querySelector('.dcf-undo-all-static')
    if (staticUndoAll) {
      staticUndoAll.addEventListener('click', function () {
        var sU = stateMap.get(text)
        if (sU) { sU.accepted = 0; sU.rejected = 0; stateMap.set(text, sU) }
        var delKeys = []
        cartItems.forEach(function (ci, ck) { if (ci.text === text) delKeys.push(ck) })
        delKeys.forEach(function (k) { cartItems.delete(k) })
        renderCart()
        if (source === 'assisted') { renderAssistedList(); } else { renderManualList(); }
        applyHighlights()
      })
    }
    li.addEventListener('click', function (e) {
      if (e.target.classList.contains('dcf-term-accept-all')) {
        var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
        var totalCount = s.total
        var keysToDelete = []
        cartItems.forEach(function (item, key) { if (item.text === text) keysToDelete.push(key) })
        keysToDelete.forEach(function (k) { cartItems.delete(k) })
        s.accepted = totalCount; s.rejected = 0; stateMap.set(text, s)
        var addedKeys = []
        if (source) {
          var typesMap = source === 'assisted' ? assistedTypes : manualTypes
          for (var ci = 0; ci < totalCount; ci++) {
            var cKey = text + '|' + (++cartInstanceCounter)
            cartItems.set(cKey, { text: text, type: typesMap.get(text) || 'Unclassified', source: source })
            addedKeys.push(cKey)
          }
          renderCart()
        }
        li.querySelectorAll('.dcf-redact-instance').forEach(function (instanceDiv) {
          var focusBtn = instanceDiv.querySelector('.dcf-redact-instance__focus')
          while (instanceDiv.lastChild) instanceDiv.removeChild(instanceDiv.lastChild)
          if (focusBtn) instanceDiv.appendChild(focusBtn)

          var savedWrapper = document.createElement('div')
          savedWrapper.className = 'govuk-!-margin-top-2'
          savedWrapper.innerHTML =
            '<strong class="govuk-tag govuk-tag--green">Saved</strong>' +
            ' <button type="button" class="govuk-link dcf-undo-instance">Undo</button>'
          instanceDiv.appendChild(savedWrapper)

          savedWrapper.querySelector('.dcf-undo-instance').addEventListener('click', function () {
            var keyToRemove = null
            cartItems.forEach(function (ci, ck) { if (!keyToRemove && ci.text === text) keyToRemove = ck })
            if (keyToRemove) cartItems.delete(keyToRemove)
            var s2 = stateMap.get(text)
            if (s2 && s2.accepted > 0) { s2.accepted--; stateMap.set(text, s2) }
            renderCart()

            var actionsDiv = document.createElement('div')
            actionsDiv.className = 'dcf-redact-instance__actions'
            actionsDiv.innerHTML =
              '<button type="button" class="dcf-redact-instance__accept govuk-link">Save</button>' +
              '<button type="button" class="dcf-redact-instance__remove govuk-link">Ignore</button>'

            actionsDiv.querySelector('.dcf-redact-instance__accept').addEventListener('click', function () {
              var s3 = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
              if (getPending(stateMap, itemsMap, text) > 0) { s3.accepted++; stateMap.set(text, s3) }
              if (source) {
                var typesMap = source === 'assisted' ? assistedTypes : manualTypes
                var cKey = text + '|' + (++cartInstanceCounter)
                cartItems.set(cKey, { text: text, type: typesMap.get(text) || 'Unclassified', source: source })
                renderCart()
              }
              var greenTag = document.createElement('div')
              greenTag.className = 'govuk-!-margin-top-2'
              greenTag.innerHTML = '<strong class="govuk-tag govuk-tag--green">Saved</strong>'
              instanceDiv.replaceChild(greenTag, actionsDiv)
              classifyHighlights()
            })

            actionsDiv.querySelector('.dcf-redact-instance__remove').addEventListener('click', function () {
              var s3 = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
              if (getPending(stateMap, itemsMap, text) > 0) { s3.rejected++; stateMap.set(text, s3) }
              var notReqWrapper = document.createElement('div')
              notReqWrapper.className = 'govuk-!-margin-top-2'
              notReqWrapper.innerHTML =
                '<strong class="govuk-tag govuk-tag--orange">Not required</strong>' +
                ' <button type="button" class="govuk-link dcf-undo-instance">Undo</button>'
              instanceDiv.replaceChild(notReqWrapper, actionsDiv)
              notReqWrapper.querySelector('.dcf-undo-instance').addEventListener('click', function () {
                if (s3.rejected > 0) { s3.rejected--; stateMap.set(text, s3) }
                instanceDiv.replaceChild(actionsDiv, notReqWrapper)
                classifyHighlights()
              })
              classifyHighlights()
            })

            instanceDiv.replaceChild(actionsDiv, savedWrapper)
            classifyHighlights()
          })
        })
        var btnGroup = e.target.parentNode
        var btnGroupParent = btnGroup.parentNode
        var undoAcceptDiv = document.createElement('div')
        undoAcceptDiv.className = 'govuk-!-margin-top-2 govuk-!-margin-bottom-1'
        undoAcceptDiv.innerHTML = '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-undo-term">Undo all</button>'
        btnGroupParent.replaceChild(undoAcceptDiv, btnGroup)
        undoAcceptDiv.querySelector('.dcf-undo-term').addEventListener('click', function () {
          var s2 = stateMap.get(text)
          if (s2) { s2.accepted = 0; s2.rejected = 0; stateMap.set(text, s2) }
          addedKeys.forEach(function (k) { cartItems.delete(k) })
          renderCart()
          if (source === 'assisted') { renderAssistedList(); } else { renderManualList(); }
          applyHighlights()
        })
        classifyHighlights()
        return
      }
      if (e.target.classList.contains('dcf-term-ignore-all')) {
        var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
        var totalCount = s.total
        var keysToDelete = []
        cartItems.forEach(function (item, key) { if (item.text === text) keysToDelete.push(key) })
        keysToDelete.forEach(function (k) { cartItems.delete(k) })
        renderCart()
        s.accepted = 0; s.rejected = totalCount; stateMap.set(text, s)
        li.querySelectorAll('.dcf-redact-instance').forEach(function (instanceDiv) {
          var focusBtn = instanceDiv.querySelector('.dcf-redact-instance__focus')
          var tag = document.createElement('div')
          tag.className = 'govuk-!-margin-top-2'
          tag.innerHTML = '<strong class="govuk-tag govuk-tag--orange">Not required</strong>'
          while (instanceDiv.lastChild) instanceDiv.removeChild(instanceDiv.lastChild)
          if (focusBtn) instanceDiv.appendChild(focusBtn)
          instanceDiv.appendChild(tag)
        })
        var btnGroup = e.target.parentNode
        var btnGroupParent = btnGroup.parentNode
        var undoIgnoreDiv = document.createElement('div')
        undoIgnoreDiv.className = 'govuk-!-margin-top-2 govuk-!-margin-bottom-1'
        undoIgnoreDiv.innerHTML = '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-undo-term">Undo all</button>'
        btnGroupParent.replaceChild(undoIgnoreDiv, btnGroup)
        undoIgnoreDiv.querySelector('.dcf-undo-term').addEventListener('click', function () {
          var s2 = stateMap.get(text)
          if (s2) { s2.accepted = 0; s2.rejected = 0; stateMap.set(text, s2) }
          if (source === 'assisted') { renderAssistedList(); } else { renderManualList(); }
          applyHighlights()
        })
        classifyHighlights()
        return
      }
    })
    var addToCartBtn = li.querySelector('.dcf-add-to-cart')
    if (addToCartBtn && onAddToCart) addToCartBtn.addEventListener('click', function () { onAddToCart() })
    var undoBtn = li.querySelector('.dcf-undo-selection')
    if (undoBtn && onUndo) undoBtn.addEventListener('click', function () { onUndo() })

    return li
  }

  // ── Bucket section (groups terms of the same type) ────────────────────────
  function makeBucketSection (type, terms, itemsMap, stateMap, renderFn, onAddToCartForTerm, onUndoForTerm, source) {
    var section = document.createElement('section')
    section.className = 'dcf-redact-bucket'

    var totalOccurrences = terms.reduce(function (sum, text) {
      var s = stateMap.get(text)
      return sum + (s ? s.total : (itemsMap.get(text) || 0))
    }, 0)

    var heading = document.createElement('h3')
    heading.className = 'govuk-heading-s dcf-redact-bucket__heading'
    heading.innerHTML =
      '<strong class="govuk-tag govuk-tag--purple">' + escHtml(type) + '</strong>' +
      ' <span class="govuk-body-s govuk-!-margin-left-1 govuk-!-margin-bottom-0">' +
        totalOccurrences + ' occurrence' + (totalOccurrences !== 1 ? 's' : '') +
      '</span>'
    section.appendChild(heading)

    var ul = document.createElement('ul')
    ul.className = 'dcf-bucket-terms govuk-list'
    terms.forEach(function (text) {
      ul.appendChild(makeListItem(text, stateMap, itemsMap,
        null,
        null,
        function () {
          // Accept all — move whole term to cart
          var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
          s.accepted += getPending(stateMap, itemsMap, text)
          stateMap.set(text, s)
          if (source && s.accepted > 0) {
            var typesMap = source === 'assisted' ? assistedTypes : manualTypes
            cartItems.set(text, { count: s.accepted, type: typesMap.get(text) || 'Unclassified', source: source })
            renderCart()
          }
          renderFn()
          classifyHighlights()
        },
        function () {
          // Ignore all — mark all instances as rejected, keep item in list
          var total = (stateMap.get(text) || {}).total || itemsMap.get(text) || 0
          stateMap.set(text, { accepted: 0, rejected: total, total: total })
          if (source) { cartItems.delete(text); renderCart() }
          renderFn()
          classifyHighlights()
        },
        onAddToCartForTerm ? function () { onAddToCartForTerm(text) } : null,
        onUndoForTerm      ? function () { onUndoForTerm(text)      } : null,
        source
      ))
    })
    section.appendChild(ul)

    return section
  }

  // ── Group items by type ───────────────────────────────────────────────────
  function groupByType (itemsMap, typesMap) {
    var groups = new Map()
    itemsMap.forEach(function (count, text) {
      var type = typesMap.get(text) || 'Unclassified'
      if (!groups.has(type)) groups.set(type, [])
      groups.get(type).push(text)
    })
    return Array.from(groups.entries()).sort(function (a, b) {
      if (a[0] === 'Unclassified') return 1
      if (b[0] === 'Unclassified') return -1
      return 0
    })
  }

  // ── Assisted ──────────────────────────────────────────────────────────────
  var assistedItems = new Map()
  var assistedTypes = new Map()

  function renderAssistedList () {
    var list  = document.getElementById('dcf-assisted-list')
    var empty = document.getElementById('dcf-assisted-empty')
    if (!list) return
    list.innerHTML = ''
    if (assistedItems.size === 0) {
      if (empty) empty.hidden = false
      return
    }
    if (empty) empty.hidden = true
    groupByType(assistedItems, assistedTypes).forEach(function (entry) {
      list.appendChild(makeBucketSection(entry[0], entry[1], assistedItems, assistedInstState,
        function () {
          renderAssistedList()
          applyHighlights()
        },
        null,
        null,
        'assisted'
      ))
    })
  }


  var btnAssistedEl = document.getElementById('btn-assisted')
  if (btnAssistedEl) {
    btnAssistedEl.addEventListener('click', function () {
      if (assistedItems.size === 0) {
        findings.forEach(function (f) {
          if (!cartItems.has(f.value)) {
            assistedItems.set(f.value, f.instances)
            assistedTypes.set(f.value, f.type || null)
            initInstState(assistedInstState, f.value, f.instances)
          }
        })
        renderAssistedList()
        applyHighlights()
      }
    })
  }

  function serialiseAllToForm (form) {
    form.querySelectorAll('input[data-redaction]').forEach(function (el) { el.remove() })

    // Text redactions — aggregate by unique term before serialising
    var _submitted = new Map()
    cartItems.forEach(function (item, key) {
      if (item.source === 'area') return
      if (!_submitted.has(item.text)) _submitted.set(item.text, item.source)
    })
    _submitted.forEach(function (src, text) {
      var stateMap = src === 'assisted' ? assistedInstState : manualInstState
      var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: 0 }
      ;[
        ['confirmedRedactions', text],
        ['instanceCount[' + text + ']', s.total],
        ['acceptedCount[' + text + ']', s.accepted],
        ['rejectedCount[' + text + ']', s.rejected]
      ].forEach(function (pair) {
        var inp = document.createElement('input')
        inp.type = 'hidden'; inp.name = pair[0]; inp.value = pair[1]
        inp.setAttribute('data-redaction', '1')
        form.appendChild(inp)
      })
    })

    // Area redactions (accepted items with rect data)
    var areaIndex = 0
    areaItems
      .filter(function (item) { return areaItemStates.get(item.id) === 'accepted' })
      .forEach(function (item) {
        ;[
          ['type',        item.type],
          ['label',       item.label],
          ['rect.xPct',   item.rect.xPct.toFixed(2)],
          ['rect.yAbsPx', item.rect.yAbsPx.toFixed(2)],
          ['rect.wPct',   item.rect.wPct.toFixed(2)],
          ['rect.hPx',    item.rect.hPx.toFixed(2)]
        ].forEach(function (pair) {
          var inp = document.createElement('input')
          inp.type = 'hidden'
          inp.name = 'areaRedactions[' + areaIndex + '][' + pair[0] + ']'
          inp.value = pair[1]
          inp.setAttribute('data-redaction', '1')
          form.appendChild(inp)
        })
        areaIndex++
      })
  }

  var assistedForm = document.getElementById('dcf-assisted-form')
  if (assistedForm) {
    assistedForm.addEventListener('submit', function () { serialiseAllToForm(this) })
  }

  // ── Area: state ───────────────────────────────────────────────────────────
  var areaItems      = []
  var areaCounter    = 0
  var areaItemStates = new Map()  // id → 'pending'|'accepted'
  var pendingAreaType = null
  var isDrawing      = false
  var drawStart      = null
  var rubberBand     = null

  // ── Manual ────────────────────────────────────────────────────────────────
  var manualItems = new Map()
  var manualTypes = new Map()
  var pendingAutoOpen = null

  function renderManualList () {
    var list = document.getElementById('dcf-manual-list')
    if (!list) return
    var openTerms = new Set()
    list.querySelectorAll('details[open][data-term]').forEach(function (d) {
      openTerms.add(d.getAttribute('data-term'))
    })
    list.innerHTML = ''
    if (manualItems.size === 0) { pendingAutoOpen = null; return }
    groupByType(manualItems, manualTypes).forEach(function (entry) {
      list.appendChild(makeBucketSection(entry[0], entry[1], manualItems, manualInstState,
        function () {
          renderManualList()
          applyHighlights()
        },
        null,
        null,
        'manual'
      ))
    })
    list.querySelectorAll('details[data-term]').forEach(function (d) {
      var term = d.getAttribute('data-term')
      if (openTerms.has(term) || term === pendingAutoOpen) d.open = true
    })
    pendingAutoOpen = null
  }

  function onIframeMouseUp () {
    if (!panels.manual || !panels.manual.classList.contains('dcf-redact-panel--visible')) return
    try {
      var sel  = iframe.contentWindow.getSelection()
      var text = sel ? sel.toString().trim() : ''
      if (!text || text.length < 2) return
      if (manualItems.has(text)) return
      var count = countInDoc(text)
      manualItems.set(text, count)
      initInstState(manualInstState, text, count)
      syncStateTotals(manualItems, manualInstState)
      pendingAutoOpen = text
      renderManualList()
      applyHighlights()
      sel.removeAllRanges()
      classifySelection(text, function (type) {
        manualTypes.set(text, type)
        var s = manualInstState.get(text)
        if (!s || (s.accepted === 0 && s.rejected === 0)) {
          renderManualList()
        }
      })
    } catch (e) {}
  }

  var manualForm = document.getElementById('dcf-manual-form')
  if (manualForm) {
    manualForm.addEventListener('submit', function () { serialiseAllToForm(this) })
  }

  // ── Area: draw mode + cart ────────────────────────────────────────────────

  var areaOverlay = document.getElementById('dcf-area-overlay')

  function getOverlayPos (e) {
    var rect = areaOverlay.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top,  rect.height))
    }
  }

  function enterDrawMode (type) {
    pendingAreaType = type
    Object.values(panels).forEach(function (p) { if (p) p.classList.remove('dcf-redact-panel--visible') })
    if (panels.area) panels.area.classList.add('dcf-redact-panel--visible')
    var exitRow = document.getElementById('dcf-area-exit-draw')
    if (exitRow) exitRow.hidden = false
    if (areaOverlay) areaOverlay.classList.add('dcf-area-overlay--active')
    applyHighlights()
  }

  function exitDrawMode () {
    pendingAreaType = null
    isDrawing = false
    if (rubberBand && rubberBand.parentNode) {
      rubberBand.parentNode.removeChild(rubberBand)
      rubberBand = null
    }
    if (areaOverlay) areaOverlay.classList.remove('dcf-area-overlay--active')
    var exitRow = document.getElementById('dcf-area-exit-draw')
    if (exitRow) exitRow.hidden = true
  }

  function makeAreaBucketSection (type, items, renderFn) {
    var section = document.createElement('section')
    section.className = 'dcf-redact-bucket'

    var heading = document.createElement('h3')
    heading.className = 'govuk-heading-s dcf-redact-bucket__heading'
    heading.innerHTML =
      '<strong class="govuk-tag govuk-tag--purple">' + escHtml(type) + '</strong>' +
      ' <span class="govuk-body-s govuk-!-margin-left-1 govuk-!-margin-bottom-0">' +
        items.length + ' occurrence' + (items.length !== 1 ? 's' : '') +
      '</span>'
    section.appendChild(heading)

    var ul = document.createElement('ul')
    ul.className = 'dcf-bucket-terms govuk-list'
    items.forEach(function (item) {
      var li = document.createElement('li')
      li.className = 'dcf-manual-list__item'
      li.innerHTML =
        '<p class="govuk-body govuk-!-margin-bottom-1"><strong>' + escHtml(item.label) + '</strong></p>' +
        '<div class="govuk-button-group govuk-!-margin-top-2 govuk-!-margin-bottom-0">' +
          '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-area-accept">Save</button>' +
          '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-area-ignore">Ignore</button>' +
        '</div>'
      li.querySelector('.dcf-area-accept').addEventListener('click', function () {
        areaItemStates.set(item.id, 'accepted')
        cartItems.set(item.label, { count: 1, type: item.type, source: 'area', areaId: item.id })
        renderCart()
        renderFn()
      })
      li.querySelector('.dcf-area-ignore').addEventListener('click', function () {
        areaItems = areaItems.filter(function (a) { return a.id !== item.id })
        areaItemStates.delete(item.id)
        renderFn()
      })
      ul.appendChild(li)
    })
    section.appendChild(ul)

    return section
  }

  function getPdfScrollTop () {
    try {
      return (pdfApp && pdfApp.pdfViewer && pdfApp.pdfViewer.container)
        ? pdfApp.pdfViewer.container.scrollTop
        : 0
    } catch (e) { return 0 }
  }

  function renderAreaRects () {
    if (!areaOverlay) return
    Array.prototype.forEach.call(areaOverlay.querySelectorAll('.dcf-area-rect-item'), function (el) {
      areaOverlay.removeChild(el)
    })
    var scrollTop = getPdfScrollTop()
    areaItems.forEach(function (item) {
      var isCarted = areaItemStates.get(item.id) === 'accepted'
      var div = document.createElement('div')
      div.className = 'dcf-area-rect-item' + (isCarted ? ' dcf-area-rect-item--carted' : '')
      div.style.left   = item.rect.xPct + '%'
      div.style.top    = (item.rect.yAbsPx - scrollTop) + 'px'
      div.style.width  = item.rect.wPct + '%'
      div.style.height = item.rect.hPx + 'px'
      areaOverlay.appendChild(div)
    })
  }

  function renderAreaList () {
    var list  = document.getElementById('dcf-area-list')
    var empty = document.getElementById('dcf-area-empty')
    var panel = document.getElementById('panel-area')
    if (!list) return
    list.innerHTML = ''
    renderAreaRects()

    var existing = panel ? panel.querySelector('.dcf-area-actions') : null
    if (existing) existing.remove()

    var pendingItems = areaItems.filter(function (item) {
      return areaItemStates.get(item.id) !== 'accepted'
    })

    if (pendingItems.length === 0) {
      if (empty) empty.hidden = areaItems.length > 0
      updateUnsavedTag()
      renderCart()
      return
    }
    if (empty) empty.hidden = true

    var groups = new Map()
    pendingItems.forEach(function (item) {
      if (!groups.has(item.type)) groups.set(item.type, [])
      groups.get(item.type).push(item)
    })
    groups.forEach(function (items, type) {
      list.appendChild(makeAreaBucketSection(type, items, function () {
        renderAreaList()
      }))
    })

    updateUnsavedTag()
    renderCart()
  }

  var btnAreaDraw = document.getElementById('btn-area-draw')
  if (btnAreaDraw) {
    btnAreaDraw.addEventListener('click', function () {
      enterDrawMode('Other')
    })
  }

  // Draw mode: mousedown on overlay starts a drag
  if (areaOverlay) {
    areaOverlay.addEventListener('mousedown', function (e) {
      if (!pendingAreaType) return
      e.preventDefault()
      isDrawing = true
      drawStart = getOverlayPos(e)
      rubberBand = document.createElement('div')
      rubberBand.className = 'dcf-area-rubber-band'
      areaOverlay.appendChild(rubberBand)
      updateRubberBand(drawStart, drawStart)
    })
  }

  function updateRubberBand (start, end) {
    if (!rubberBand) return
    var x = Math.min(start.x, end.x)
    var y = Math.min(start.y, end.y)
    rubberBand.style.left   = x + 'px'
    rubberBand.style.top    = y + 'px'
    rubberBand.style.width  = Math.abs(end.x - start.x) + 'px'
    rubberBand.style.height = Math.abs(end.y - start.y) + 'px'
  }

  document.addEventListener('mousemove', function (e) {
    if (!isDrawing || !rubberBand) return
    updateRubberBand(drawStart, getOverlayPos(e))
  })

  document.addEventListener('mouseup', function (e) {
    if (!isDrawing) return
    isDrawing = false
    var end = getOverlayPos(e)
    if (rubberBand && rubberBand.parentNode) {
      rubberBand.parentNode.removeChild(rubberBand)
      rubberBand = null
    }
    var w = Math.abs(end.x - drawStart.x)
    var h = Math.abs(end.y - drawStart.y)
    if (w < 10 || h < 10) return  // ignore accidental tiny drags
    var overlayRect = areaOverlay.getBoundingClientRect()
    var scrollTop   = getPdfScrollTop()
    areaCounter++
    var newId = 'area-' + areaCounter
    areaItems.push({
      id:    newId,
      label: 'Area ' + areaCounter,
      type:  pendingAreaType,
      rect: {
        xPct:   Math.min(drawStart.x, end.x) / overlayRect.width * 100,
        yAbsPx: Math.min(drawStart.y, end.y) + scrollTop,
        wPct:   w / overlayRect.width * 100,
        hPx:    h
      }
    })
    areaItemStates.set(newId, 'pending')
    renderAreaList()
    // Stay in draw mode so user can add more areas of the same type
  })

  // Escape cancels draw mode
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && pendingAreaType) {
      exitDrawMode()
    }
  })

  // "Exit drawing mode" banner button
  var cancelDrawBtn = document.getElementById('dcf-area-cancel-draw')
  if (cancelDrawBtn) {
    cancelDrawBtn.addEventListener('click', exitDrawMode)
  }

  // Form submit — encode area data as hidden inputs (accepted items only)
  var areaForm = document.getElementById('dcf-area-form')
  if (areaForm) {
    areaForm.addEventListener('submit', function () { serialiseAllToForm(this) })
  }

  // ── Initialise assisted items from findings data ──────────────────────────
  var restore   = window.__redactRestore
  var findings  = window.__assistedFindings || []

  if (restore && restore.mode === 'assisted') {
    var confirmedSet = new Set(restore.confirmed || [])
    findings.forEach(function (f) {
      if (confirmedSet.has(f.value)) {
        var rejected  = Number((restore.rejectedCount  && restore.rejectedCount[f.value])  || 0)
        var accepted  = Number((restore.acceptedCount  && restore.acceptedCount[f.value])  || 0)
        var submitted = Number((restore.instanceCount  && restore.instanceCount[f.value])  || f.instances)
        var total     = submitted + rejected
        cartItems.set(f.value, { count: submitted, type: f.type || 'Unclassified', source: 'assisted' })
        assistedTypes.set(f.value, f.type || null)
        assistedInstState.set(f.value, { accepted: accepted, rejected: rejected, total: total })
      } else {
        assistedItems.set(f.value, f.instances)
        assistedTypes.set(f.value, f.type || null)
        initInstState(assistedInstState, f.value, f.instances)
      }
    })
  } else {
    findings.forEach(function (f) {
      assistedItems.set(f.value, f.instances)
      assistedTypes.set(f.value, f.type || null)
      initInstState(assistedInstState, f.value, f.instances)
    })
  }
  renderCart()
  renderAssistedList()

  if (restore && restore.mode === 'manual') {
    ;(restore.confirmed || []).forEach(function (text) {
      var rejected  = Number((restore.rejectedCount  && restore.rejectedCount[text])  || 0)
      var accepted  = Number((restore.acceptedCount  && restore.acceptedCount[text])  || 0)
      var submitted = Number((restore.instanceCount  && restore.instanceCount[text])  || 0)
      var total     = submitted + rejected
      cartItems.set(text, { count: submitted, type: 'Unclassified', source: 'manual' })
      manualInstState.set(text, { accepted: accepted, rejected: rejected, total: total })
    })
    renderCart()
    renderManualList()
  }

  var initialMode = (restore && restore.mode) ? restore.mode : 'manual'
  var targetRadio = document.querySelector('input[name="redact-mode"][value="' + initialMode + '"]')
  if (targetRadio) {
    targetRadio.checked = true
    targetRadio.dispatchEvent(new Event('change'))
  }

  // ── Iframe init ───────────────────────────────────────────────────────────
  if (!iframe) return

  function waitForPdfApp (iframeWindow, cb) {
    var attempts = 0
    var id = setInterval(function () {
      try {
        var app = iframeWindow.PDFViewerApplication
        if (app && app.pdfDocument) {
          clearInterval(id)
          cb(app)
        } else if (++attempts > 80) {
          clearInterval(id)
        }
      } catch (e) {
        clearInterval(id)
      }
    }, 250)
  }

  function init () {
    try {
      waitForPdfApp(iframe.contentWindow, function (app) {
        pdfApp = app
        injectHighlightStyle()
        setupHighlightObserver()
        extractFullText(app.pdfDocument)
        applyHighlights()
        try {
          iframe.contentDocument.addEventListener('mouseup', onIframeMouseUp)
          iframe.contentDocument.addEventListener('click', function (e) {
            var el = e.target
            while (el) {
              if (el.classList && el.classList.contains('highlight')) {
                var term = el.textContent.trim()
                if (term) focusCartItem(term)
                break
              }
              el = el.parentElement
            }
          }, false)
        } catch (e) {}
        try {
          pdfApp.pdfViewer.container.addEventListener('scroll', function () {
            renderAreaRects()
          })
        } catch (e) {}
      })
    } catch (e) {}
  }

  iframe.addEventListener('load', init)
})()
