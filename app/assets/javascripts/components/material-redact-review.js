(() => {
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

  var _focusStyleEl = null

  function setFocusGreen () {
    try {
      var doc = iframe.contentDocument
      if (!_focusStyleEl) {
        _focusStyleEl = doc.createElement('style')
        _focusStyleEl.textContent =
          '.textLayer .highlight{--highlight-selected-bg-color:rgb(0 170 0 / 0.55) !important}'
        doc.head.appendChild(_focusStyleEl)
      }
    } catch (e) {}
  }

  function focusInstance (term, index) {
    if (!pdfApp) return
    setFocusGreen()

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

    if (assistedActive) {
      var assistedTerms = Array.from(assistedItems.keys())
      if (assistedTerms.length) { dispatchFind(assistedTerms); return }
    }
    if (manualActive) {
      var manualTerms = Array.from(manualItems.keys())
      if (manualTerms.length) { dispatchFind(manualTerms); return }
    }
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
      renderAssistedList()
      renderManualList()
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
    var tag = document.getElementById('dcf-unsaved-tag')
    if (!tag) return
    var count = assistedItems.size + manualItems.size + areaItems.length
    tag.hidden = count === 0
    tag.textContent = count + ' possible redaction' + (count !== 1 ? 's' : '')
  }

  var caseIdMatch = window.location.pathname.match(/\/cases\/(\d+)\//)
  var caseId = caseIdMatch ? caseIdMatch[1] : null

  function classifySelection (text, cb) {
    if (!caseId) return cb('Fragment')
    fetch('/cases/' + caseId + '/material/redact/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: text })
    })
      .then(function (r) { return r.json() })
      .then(function (data) { cb(data.type || 'Fragment') })
      .catch(function () { cb('Fragment') })
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

  function makeListItem (text, count, type, onRemoveAll, onRemoveInstance) {
    var li = document.createElement('li')
    li.className = 'dcf-manual-list__item'

    var snippets = getContextSnippets(text)
    var detailsBody = ''
    if (snippets === null) {
      detailsBody = '<p class="govuk-body-s">Loading context…</p>'
    } else if (snippets.length === 0) {
      detailsBody = '<p class="govuk-body-s">No context available.</p>'
    } else {
      detailsBody = snippets.map(function (s, i) {
        var html =
          '<div class="dcf-redact-instance">' +
            '<button type="button" class="dcf-redact-instance__focus govuk-body-s">' +
              (s.before ? escHtml(s.before) + ' ' : '') +
              '<strong>' + escHtml(s.term) + '</strong>' +
              (s.after ? ' ' + escHtml(s.after) : '') +
            '</button>' +
            '<button type="button" class="dcf-redact-instance__remove govuk-link">Reject instance</button>' +
          '</div>'
        if (i < snippets.length - 1) {
          html += '<hr class="govuk-section-break govuk-section-break--m govuk-section-break--visible">'
        }
        return html
      }).join('')
    }

    li.innerHTML =
      '<details class="govuk-details govuk-!-margin-bottom-1">' +
        '<summary class="govuk-details__summary">' +
          '<span class="govuk-details__summary-text">' +
            '<strong>' + escHtml(text) + '</strong>' +
            ' — appears ' + count + ' time' + (count !== 1 ? 's' : '') +
          '</span>' +
        '</summary>' +
        '<div class="govuk-details__text dcf-redact-context">' + detailsBody + '</div>' +
      '</details>' +
      (type ? '<div class="govuk-!-margin-top-2 govuk-!-margin-bottom-2"><strong class="govuk-tag govuk-tag--red govuk-!-font-size-14">' + escHtml(type) + '</strong></div>' : '') +
      '<button type="button" class="dcf-manual-list__remove govuk-link">Reject all</button>'

    li.querySelector('.dcf-manual-list__remove').addEventListener('click', onRemoveAll)
    li.querySelectorAll('.dcf-redact-instance__remove').forEach(function (btn) {
      btn.addEventListener('click', onRemoveInstance)
    })
    li.querySelectorAll('.dcf-redact-instance__focus').forEach(function (btn, i) {
      btn.addEventListener('click', function () { focusInstance(text, i) })
    })
    return li
  }

  // ── Assisted: remove-link list ────────────────────────────────────────────
  var assistedItems = new Map()
  var assistedTypes = new Map()

  function renderAssistedList () {
    var list   = document.getElementById('dcf-assisted-list')
    var empty  = document.getElementById('dcf-assisted-empty')
    var submit = document.getElementById('dcf-assisted-submit')
    if (!list) return
    list.innerHTML = ''
    if (assistedItems.size === 0) {
      if (empty)  empty.hidden         = false
      if (submit) submit.style.display = 'none'
      updateUnsavedTag()
      return
    }
    if (empty)  empty.hidden         = true
    if (submit) submit.style.display = ''
    assistedItems.forEach(function (count, text) {
      list.appendChild(makeListItem(text, count, assistedTypes.get(text) || null,
        function () {
          assistedItems.delete(text)
          renderAssistedList()
          applyHighlights()
        },
        function () {
          var n = assistedItems.get(text) || 0
          if (n <= 1) { assistedItems.delete(text) } else { assistedItems.set(text, n - 1) }
          renderAssistedList()
          applyHighlights()
        }
      ))
    })
    updateUnsavedTag()
  }

  var manualResetBtn = document.getElementById('dcf-manual-reset-btn')
  if (manualResetBtn) {
    manualResetBtn.addEventListener('click', function () {
      manualItems.clear()
      manualTypes.clear()
      renderManualList()
      applyHighlights()
    })
  }

  var assistedResetBtn = document.getElementById('dcf-assisted-reset-btn')
  if (assistedResetBtn) {
    assistedResetBtn.addEventListener('click', function () {
      assistedItems.clear()
      renderAssistedList()
      applyHighlights()
    })
  }

  var btnAssistedEl = document.getElementById('btn-assisted')
  if (btnAssistedEl) {
    btnAssistedEl.addEventListener('click', function () {
      if (assistedItems.size === 0) {
        findings.forEach(function (f) {
          assistedItems.set(f.value, f.instances)
          assistedTypes.set(f.value, f.type || null)
        })
        renderAssistedList()
        applyHighlights()
      }
    })
  }

  var assistedForm = document.getElementById('dcf-assisted-form')
  if (assistedForm) {
    assistedForm.addEventListener('submit', function () {
      this.querySelectorAll('input[data-assisted]').forEach(function (el) { el.remove() })
      assistedItems.forEach(function (count, text) {
        var inp = document.createElement('input')
        inp.type  = 'hidden'
        inp.name  = 'confirmedRedactions'
        inp.setAttribute('data-assisted', '1')
        inp.value = text
        assistedForm.appendChild(inp)

        var countInp = document.createElement('input')
        countInp.type  = 'hidden'
        countInp.name  = 'instanceCount[' + text + ']'
        countInp.setAttribute('data-assisted', '1')
        countInp.value = count
        assistedForm.appendChild(countInp)
      })
    })
  }

  // ── Area: state ───────────────────────────────────────────────────────────
  var areaItems    = []
  var areaCounter  = 0
  var pendingAreaType = null
  var isDrawing    = false
  var drawStart    = null
  var rubberBand   = null

  // ── Manual: text selection ────────────────────────────────────────────────
  var manualItems = new Map()
  var manualTypes = new Map()

  function renderManualList () {
    var list   = document.getElementById('dcf-manual-list')
    var empty  = document.getElementById('dcf-manual-empty')
    var submit = document.getElementById('dcf-manual-submit')
    if (!list) return
    list.innerHTML = ''
    if (manualItems.size === 0) {
      if (empty)  empty.hidden         = false
      if (submit) submit.style.display = 'none'
      updateUnsavedTag()
      return
    }
    if (empty)  empty.hidden         = true
    if (submit) submit.style.display = ''
    manualItems.forEach(function (count, text) {
      list.appendChild(makeListItem(text, count, manualTypes.get(text) || null,
        function () {
          manualItems.delete(text)
          renderManualList()
          applyHighlights()
        },
        function () {
          var n = manualItems.get(text) || 0
          if (n <= 1) { manualItems.delete(text) } else { manualItems.set(text, n - 1) }
          renderManualList()
          applyHighlights()
        }
      ))
    })
    updateUnsavedTag()
  }

  function onIframeMouseUp () {
    if (!panels.manual || !panels.manual.classList.contains('dcf-redact-panel--visible')) return
    try {
      var sel  = iframe.contentWindow.getSelection()
      var text = sel ? sel.toString().trim() : ''
      if (!text || text.length < 2) return
      if (manualItems.has(text)) return
      manualItems.set(text, countInDoc(text))
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
      this.querySelectorAll('input[data-manual]').forEach(function (el) { el.remove() })
      manualItems.forEach(function (count, text) {
        var inp = document.createElement('input')
        inp.type  = 'hidden'
        inp.name  = 'confirmedRedactions'
        inp.setAttribute('data-manual', '1')
        inp.value = text
        manualForm.appendChild(inp)

        var countInp = document.createElement('input')
        countInp.type  = 'hidden'
        countInp.name  = 'instanceCount[' + text + ']'
        countInp.setAttribute('data-manual', '1')
        countInp.value = count
        manualForm.appendChild(countInp)
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

  function makeAreaListItem (item, onRemove) {
    var li = document.createElement('li')
    li.className = 'dcf-manual-list__item'
    li.innerHTML =
      '<p class="govuk-body govuk-!-margin-bottom-1"><strong>' + escHtml(item.label) + '</strong></p>' +
      '<div class="govuk-!-margin-bottom-2"><strong class="govuk-tag govuk-tag--red govuk-!-font-size-14">' + escHtml(item.type) + '</strong></div>' +
      '<button type="button" class="dcf-manual-list__remove govuk-link">Reject</button>'
    li.querySelector('.dcf-manual-list__remove').addEventListener('click', onRemove)
    return li
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
    if (!list) return
    list.innerHTML = ''
    renderAreaRects()
    if (areaItems.length === 0) {
      if (empty)  empty.hidden         = false
      if (submit) submit.style.display = 'none'
      updateUnsavedTag()
      return
    }
    if (empty)  empty.hidden         = true
    if (submit) submit.style.display = ''
    areaItems.forEach(function (item) {
      list.appendChild(makeAreaListItem(item, function () {
        areaItems = areaItems.filter(function (a) { return a.id !== item.id })
        renderAreaList()
      }))
    })
    updateUnsavedTag()
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
    areaItems.push({
      id:    'area-' + areaCounter,
      label: 'Area ' + areaCounter,
      type:  pendingAreaType,
      rect: {
        xPct:   Math.min(drawStart.x, end.x) / overlayRect.width * 100,
        yAbsPx: Math.min(drawStart.y, end.y) + scrollTop,
        wPct:   w / overlayRect.width * 100,
        hPx:    h
      }
    })
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
      exitDrawMode()
      renderAreaList()
    })
  }

  // Form submit — encode area data as hidden inputs
  var areaForm = document.getElementById('dcf-area-form')
  if (areaForm) {
    areaForm.addEventListener('submit', function () {
      this.querySelectorAll('input[data-area]').forEach(function (el) { el.remove() })
      areaItems.forEach(function (item, i) {
        ;[
          ['type', item.type],
          ['label', item.label],
          ['rect.x', item.rect.x.toFixed(2)],
          ['rect.y', item.rect.y.toFixed(2)],
          ['rect.w', item.rect.w.toFixed(2)],
          ['rect.h', item.rect.h.toFixed(2)]
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
        assistedItems.set(f.value, Number((restore.instanceCount && restore.instanceCount[f.value]) || f.instances))
        assistedTypes.set(f.value, f.type || null)
      }
    })
  } else {
    findings.forEach(function (f) {
      assistedItems.set(f.value, f.instances)
      assistedTypes.set(f.value, f.type || null)
    })
  }
  renderAssistedList()

  if (findings.length) {
    var btnAssisted = document.getElementById('btn-assisted')
    if (btnAssisted) btnAssisted.textContent = 'View AI suggestions'
  }

  if (restore && restore.mode === 'manual') {
    ;(restore.confirmed || []).forEach(function (text) {
      manualItems.set(text, Number((restore.instanceCount && restore.instanceCount[text]) || 0))
    })
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
        extractFullText(app.pdfDocument)
        applyHighlights()
        try {
          iframe.contentDocument.addEventListener('mouseup', onIframeMouseUp)
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
