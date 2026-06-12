;(() => {
  var iframe = document.getElementById('redact-preview-iframe')

  // ── Mode panels & toggle ──────────────────────────────────────────────────
  var modeButtons = document.querySelectorAll('[data-panel]')
  var panels = {
    assisted: document.getElementById('panel-assisted'),
    manual:   document.getElementById('panel-manual'),
    area:     document.getElementById('panel-area')
  }

  modeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-panel')
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

  function injectHighlightStyle () {
    try {
      var doc = iframe.contentDocument
      var el = doc.createElement('style')
      el.textContent =
        '.textLayer .highlight { background-color: rgba(219,255,60,0.45) !important; }' +
        '.textLayer .highlight.selected { background-color: rgba(219,255,60,0.75) !important; }'
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
    var cartKeys = Array.from(cartItems.keys())

    if (assistedActive) {
      var assistedTerms = Array.from(assistedItems.keys()).concat(cartKeys)
      if (assistedTerms.length) { dispatchFind(assistedTerms); return }
    }
    if (manualActive) {
      var manualTerms = Array.from(manualItems.keys()).concat(cartKeys)
      if (manualTerms.length) { dispatchFind(manualTerms); return }
    }
    if (cartKeys.length) { dispatchFind(cartKeys); return }
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
  var cartItems         = new Map()   // text → { count, type, source: 'assisted'|'manual' }

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
    findings.forEach(function (f) {
      assistedItems.set(f.value, f.instances)
      assistedTypes.set(f.value, f.type || null)
      initInstState(assistedInstState, f.value, f.instances)
    })
    renderCart()
    renderAssistedList()
    renderManualList()
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

    cartItems.forEach(function (item, text) {
      var li = document.createElement('li')
      li.className = 'dcf-cart-item'
      li.innerHTML =
        '<span class="govuk-body-s">' + escHtml(text) + ' (' + item.count + ')</span>' +
        '<button type="button" class="dcf-cart-remove">Remove</button>'
      li.querySelector('.dcf-cart-remove').addEventListener('click', function () {
        removeFromCart(text)
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

  function removeFromCart (text) {
    var item = cartItems.get(text)
    if (!item) return
    var itemsMap = item.source === 'assisted' ? assistedItems : manualItems
    var stateMap = item.source === 'assisted' ? assistedInstState : manualInstState
    var s = stateMap.get(text)
    var total = s ? s.total : item.count
    itemsMap.set(text, total)
    stateMap.set(text, { accepted: 0, rejected: 0, total: total })
    cartItems.delete(text)
    renderCart()
    if (item.source === 'assisted') renderAssistedList()
    else renderManualList()
    applyHighlights()
  }

  // ── Cart focus (click highlight in PDF → open term in cart) ─────────────────
  function focusCartItem (term) {
    var cartList = document.getElementById('dcf-cart-list')
    if (cartList && cartItems.has(term)) {
      var cartLi = null
      cartList.querySelectorAll('li').forEach(function (li) {
        var strong = li.querySelector('strong')
        if (strong && strong.textContent.trim() === term) cartLi = li
      })
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
  function makeListItem (text, stateMap, itemsMap, onAcceptInstance, onIgnoreInstance, onAcceptAll, onIgnoreAll, onAddToCart, onUndo) {
    var li = document.createElement('li')
    li.className = 'dcf-manual-list__item'

    var pending  = getPending(stateMap, itemsMap, text)
    var snippets = getContextSnippets(text)
    var shownSnippets = snippets ? snippets.slice(0, pending) : null

    var detailsBody = ''
    if (shownSnippets === null) {
      detailsBody = '<p class="govuk-body-s">Loading context…</p>'
    } else if (pending === 0) {
      detailsBody = '<p class="govuk-body-s govuk-!-colour-secondary">All instances reviewed.</p>'
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
            '<div class="dcf-redact-instance__actions">' +
              '<button type="button" class="dcf-redact-instance__accept govuk-link">Add to cart</button>' +
              '<button type="button" class="dcf-redact-instance__remove govuk-link">Ignore</button>' +
            '</div>' +
          '</div>'
        if (i < shownSnippets.length - 1) {
          html += '<hr class="govuk-section-break govuk-section-break--m govuk-section-break--visible">'
        }
        return html
      }).join('')
    }

    var singleInstanceBtns = (shownSnippets && shownSnippets.length === 1 && pending === 1)
      ? '<div class="govuk-button-group govuk-!-margin-top-2 govuk-!-margin-bottom-1">' +
          '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-redact-instance__accept">Add to cart</button>' +
          '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-redact-instance__remove">Ignore</button>' +
        '</div>'
      : ''

    li.innerHTML =
      '<details class="govuk-details govuk-!-margin-bottom-1">' +
        '<summary class="govuk-details__summary">' +
          '<span class="govuk-details__summary-text">' +
            '<strong>' + escHtml(text) + '</strong>' +
            ' (' + pending + ')' +
          '</span>' +
        '</summary>' +
        '<div class="govuk-details__text dcf-redact-context">' + detailsBody + '</div>' +
      '</details>' +
      singleInstanceBtns +
      (pending > 1 && onAcceptAll && onIgnoreAll
        ? '<div class="govuk-button-group govuk-!-margin-top-2 govuk-!-margin-bottom-1">' +
            '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-term-accept-all">Add all to cart</button>' +
            '<button type="button" class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-term-ignore-all">Ignore all</button>' +
          '</div>'
        : '') +
      ((onAddToCart || onUndo)
        ? '<div class="dcf-bucket-controls dcf-bucket-controls--term">' +
            (onAddToCart ? '<button type="button" class="govuk-link dcf-add-to-cart">Add to cart</button>' : '') +
            (onUndo ? '<button type="button" class="govuk-link dcf-undo-selection">Undo</button>' : '') +
          '</div>'
        : '')

    li.querySelectorAll('.dcf-redact-instance__accept').forEach(function (btn, i) {
      btn.addEventListener('click', function () { onAcceptInstance(i) })
    })
    li.querySelectorAll('.dcf-redact-instance__remove').forEach(function (btn, i) {
      btn.addEventListener('click', function () { onIgnoreInstance(i) })
    })
    li.querySelectorAll('.dcf-redact-instance__focus').forEach(function (btn, i) {
      btn.addEventListener('click', function () { focusInstance(text, i) })
    })
    var termAcceptAll = li.querySelector('.dcf-term-accept-all')
    if (termAcceptAll) termAcceptAll.addEventListener('click', onAcceptAll)
    var termIgnoreAll = li.querySelector('.dcf-term-ignore-all')
    if (termIgnoreAll) termIgnoreAll.addEventListener('click', onIgnoreAll)
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
        function () {
          // Accept one instance — update cart with running accepted count
          var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
          if (getPending(stateMap, itemsMap, text) > 0) { s.accepted++; stateMap.set(text, s) }
          if (source && s.accepted > 0) {
            var typesMap = source === 'assisted' ? assistedTypes : manualTypes
            cartItems.set(text, { count: s.accepted, type: typesMap.get(text) || 'Unclassified', source: source })
            renderCart()
          }
          if (getPending(stateMap, itemsMap, text) === 0) itemsMap.delete(text)
          renderFn()
        },
        function () {
          // Ignore one instance
          var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
          if (getPending(stateMap, itemsMap, text) > 0) { s.rejected++; stateMap.set(text, s) }
          if (getPending(stateMap, itemsMap, text) === 0) {
            itemsMap.delete(text)
            if (getAccepted(stateMap, text) === 0) {
              stateMap.delete(text)
              if (source) { cartItems.delete(text); renderCart() }
            }
          }
          renderFn()
        },
        function () {
          // Accept all — move whole term to cart
          var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: itemsMap.get(text) || 0 }
          s.accepted += getPending(stateMap, itemsMap, text)
          stateMap.set(text, s)
          if (source && s.accepted > 0) {
            var typesMap = source === 'assisted' ? assistedTypes : manualTypes
            cartItems.set(text, { count: s.accepted, type: typesMap.get(text) || 'Unclassified', source: source })
            itemsMap.delete(text)
            renderCart()
          }
          renderFn()
        },
        function () {
          // Ignore all — remove entirely (including any cart entry)
          itemsMap.delete(text)
          stateMap.delete(text)
          if (source) { cartItems.delete(text); renderCart() }
          renderFn()
        },
        onAddToCartForTerm ? function () { onAddToCartForTerm(text) } : null,
        onUndoForTerm      ? function () { onUndoForTerm(text)      } : null
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

  var assistedForm = document.getElementById('dcf-assisted-form')
  if (assistedForm) {
    assistedForm.addEventListener('submit', function () {
      this.querySelectorAll('input[data-cart]').forEach(function (el) { el.remove() })
      cartItems.forEach(function (item, text) {
        var stateMap = item.source === 'assisted' ? assistedInstState : manualInstState
        var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: item.count }

        var inp = document.createElement('input')
        inp.type = 'hidden'; inp.name = 'confirmedRedactions'
        inp.setAttribute('data-cart', '1'); inp.value = text
        assistedForm.appendChild(inp)

        var countInp = document.createElement('input')
        countInp.type = 'hidden'; countInp.name = 'instanceCount[' + text + ']'
        countInp.setAttribute('data-cart', '1'); countInp.value = item.count
        assistedForm.appendChild(countInp)

        var accInp = document.createElement('input')
        accInp.type = 'hidden'; accInp.name = 'acceptedCount[' + text + ']'
        accInp.setAttribute('data-cart', '1'); accInp.value = s.accepted
        assistedForm.appendChild(accInp)

        var rejInp = document.createElement('input')
        rejInp.type = 'hidden'; rejInp.name = 'rejectedCount[' + text + ']'
        rejInp.setAttribute('data-cart', '1'); rejInp.value = s.rejected
        assistedForm.appendChild(rejInp)
      })
    })
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

  function renderManualList () {
    var list = document.getElementById('dcf-manual-list')
    if (!list) return
    list.innerHTML = ''
    if (manualItems.size === 0) return
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
      renderManualList()
      applyHighlights()
      sel.removeAllRanges()
      classifySelection(text, function (type) {
        manualTypes.set(text, type)
        renderManualList()
      })
    } catch (e) {}
  }

  var manualForm = document.getElementById('dcf-manual-form')
  if (manualForm) {
    manualForm.addEventListener('submit', function () {
      this.querySelectorAll('input[data-cart]').forEach(function (el) { el.remove() })
      cartItems.forEach(function (item, text) {
        var stateMap = item.source === 'assisted' ? assistedInstState : manualInstState
        var s = stateMap.get(text) || { accepted: 0, rejected: 0, total: item.count }

        var inp = document.createElement('input')
        inp.type = 'hidden'; inp.name = 'confirmedRedactions'
        inp.setAttribute('data-cart', '1'); inp.value = text
        manualForm.appendChild(inp)

        var countInp = document.createElement('input')
        countInp.type = 'hidden'; countInp.name = 'instanceCount[' + text + ']'
        countInp.setAttribute('data-cart', '1'); countInp.value = item.count
        manualForm.appendChild(countInp)

        var accInp = document.createElement('input')
        accInp.type = 'hidden'; accInp.name = 'acceptedCount[' + text + ']'
        accInp.setAttribute('data-cart', '1'); accInp.value = s.accepted
        manualForm.appendChild(accInp)

        var rejInp = document.createElement('input')
        rejInp.type = 'hidden'; rejInp.name = 'rejectedCount[' + text + ']'
        rejInp.setAttribute('data-cart', '1'); rejInp.value = s.rejected
        manualForm.appendChild(rejInp)
      })
    })
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
    if (pdfApp) pdfApp.eventBus.dispatch('findbarclose', { source: {} })
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
      escHtml(type) +
      ' <strong class="govuk-tag govuk-tag--blue govuk-!-font-size-14 govuk-!-margin-left-1">' +
        items.length + ' occurrence' + (items.length !== 1 ? 's' : '') +
      '</strong>'
    section.appendChild(heading)

    var single = items.length === 1
    var itemBtnClass    = single ? 'govuk-button govuk-button--secondary govuk-!-margin-bottom-0' : 'govuk-link'
    var itemActionsClass = single ? 'govuk-button-group govuk-!-margin-top-3 govuk-!-margin-bottom-0' : 'dcf-redact-instance__actions'

    var ul = document.createElement('ul')
    ul.className = 'dcf-bucket-terms govuk-list'
    items.forEach(function (item) {
      var li = document.createElement('li')
      li.className = 'dcf-manual-list__item'
      li.innerHTML =
        '<p class="govuk-body govuk-!-margin-bottom-1"><strong>' + escHtml(item.label) + '</strong></p>' +
        '<div class="' + itemActionsClass + '">' +
          '<button type="button" class="dcf-redact-instance__accept ' + itemBtnClass + '">Accept</button>' +
          '<button type="button" class="dcf-redact-instance__remove ' + itemBtnClass + '">Ignore</button>' +
        '</div>'
      li.querySelector('.dcf-redact-instance__accept').addEventListener('click', function () {
        areaItemStates.set(item.id, 'accepted')
        renderFn()
      })
      li.querySelector('.dcf-redact-instance__remove').addEventListener('click', function () {
        areaItems = areaItems.filter(function (a) { return a.id !== item.id })
        areaItemStates.delete(item.id)
        renderFn()
      })
      ul.appendChild(li)
    })
    section.appendChild(ul)

    if (!single) {
      var controls = document.createElement('div')
      controls.className = 'govuk-button-group govuk-!-margin-top-3'

      var ignoreAllBtn = document.createElement('button')
      ignoreAllBtn.type      = 'button'
      ignoreAllBtn.className = 'govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-bucket__reject-all'
      ignoreAllBtn.textContent = 'Ignore all'
      ignoreAllBtn.addEventListener('click', function () {
        var idsToRemove = new Set(items.map(function (item) { return item.id }))
        areaItems = areaItems.filter(function (a) { return !idsToRemove.has(a.id) })
        idsToRemove.forEach(function (id) { areaItemStates.delete(id) })
        renderFn()
      })

      var acceptAllBtn = document.createElement('button')
      acceptAllBtn.type      = 'button'
      acceptAllBtn.className = 'govuk-button govuk-button--secondary govuk-!-margin-bottom-0 dcf-bucket__accept-all'
      acceptAllBtn.textContent = 'Accept all'
      acceptAllBtn.addEventListener('click', function () {
        items.forEach(function (item) {
          if (areaItemStates.get(item.id) === 'pending') areaItemStates.set(item.id, 'accepted')
        })
        renderFn()
      })

      controls.appendChild(ignoreAllBtn)
      controls.appendChild(acceptAllBtn)
      section.appendChild(controls)
    }

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
      var div = document.createElement('div')
      div.className = 'dcf-area-rect-item'
      div.style.left   = item.rect.xPct + '%'
      div.style.top    = (item.rect.yAbsPx - scrollTop) + 'px'
      div.style.width  = item.rect.wPct + '%'
      div.style.height = item.rect.hPx + 'px'
      areaOverlay.appendChild(div)
    })
  }

  function renderAreaList () {
    var list   = document.getElementById('dcf-area-list')
    var empty  = document.getElementById('dcf-area-empty')
    var submit = document.getElementById('dcf-area-submit')
    var header = document.getElementById('dcf-area-header')
    if (!list) return
    list.innerHTML = ''
    renderAreaRects()
    if (areaItems.length === 0) {
      if (empty)  empty.hidden          = true
      if (submit) submit.style.display  = 'none'
      updateUnsavedTag()
      updateSubmitGates()
      return
    }
    if (header) header.hidden         = false
    if (empty)  empty.hidden          = true
    if (submit) submit.style.display  = ''

    var groups = new Map()
    areaItems.forEach(function (item) {
      if (!groups.has(item.type)) groups.set(item.type, [])
      groups.get(item.type).push(item)
    })
    groups.forEach(function (items, type) {
      list.appendChild(makeAreaBucketSection(type, items, function () {
        renderAreaList()
      }))
    })
    updateUnsavedTag()
    updateSubmitGates()
  }

  // Intercept clicks on items inside the "Redact area" button menu
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest('a')
    if (!link) return
    var menu = link.closest('.moj-button-menu')
    if (!menu || !menu.querySelector('.dcf-btn-redact-area')) return
    e.preventDefault()
    var type = (link.textContent || '').trim()
    if (!type) return
    enterDrawMode(type)
  }, false)

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

  // Clear and reset
  var areaResetBtn = document.getElementById('dcf-area-reset-btn')
  if (areaResetBtn) {
    areaResetBtn.addEventListener('click', function () {
      areaItems   = []
      areaCounter = 0
      areaItemStates.clear()
      var h = document.getElementById('dcf-area-header')
      if (h) h.hidden = true
      exitDrawMode()
      renderAreaList()
    })
  }

  // Form submit — encode area data as hidden inputs (accepted items only)
  var areaForm = document.getElementById('dcf-area-form')
  if (areaForm) {
    areaForm.addEventListener('submit', function () {
      this.querySelectorAll('input[data-area]').forEach(function (el) { el.remove() })
      areaItems
        .filter(function (item) { var s = areaItemStates.get(item.id); return s === 'accepted' || s === 'pending' })
        .forEach(function (item, i) {
          ;[
            ['type', item.type],
            ['label', item.label],
            ['rect.xPct',   item.rect.xPct.toFixed(2)],
            ['rect.yAbsPx', item.rect.yAbsPx.toFixed(2)],
            ['rect.wPct',   item.rect.wPct.toFixed(2)],
            ['rect.hPx',    item.rect.hPx.toFixed(2)]
          ].forEach(function (pair) {
            var inp = document.createElement('input')
            inp.type  = 'hidden'
            inp.name  = 'areaRedactions[' + i + '][' + pair[0] + ']'
            inp.value = pair[1]
            inp.setAttribute('data-area', '1')
            areaForm.appendChild(inp)
          })
        })
    })
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

  if (restore) {
    var targetBtn = document.querySelector('[data-panel="' + restore.mode + '"]')
    if (targetBtn) targetBtn.click()
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
