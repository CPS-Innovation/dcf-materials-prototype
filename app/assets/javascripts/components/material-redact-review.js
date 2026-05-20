(() => {
  var iframe = document.getElementById('redact-preview-iframe')
  var checkboxes = document.querySelectorAll('input[name="confirmedRedactions"]')

  // ── Mode panels & toggle ──────────────────────────────────────────────────
  var modeButtons = document.querySelectorAll('[data-panel]')
  var panels = {
    assisted: document.getElementById('panel-assisted'),
    manual:   document.getElementById('panel-manual')
  }

  modeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-panel')
      Object.values(panels).forEach(function (p) { if (p) p.classList.remove('dcf-redact-panel--visible') })
      if (panels[target]) panels[target].classList.add('dcf-redact-panel--visible')
      applyHighlights()
    })
  })

  // ── Assisted: PDF.js find highlights ─────────────────────────────────────
  var pdfApp = null

  function getActiveValues () {
    return Array.from(checkboxes)
      .filter(function (cb) { return cb.checked })
      .map(function (cb) { return cb.value })
  }

  function applyHighlights () {
    if (!pdfApp) return
    if (!panels.assisted || !panels.assisted.classList.contains('dcf-redact-panel--visible')) {
      pdfApp.eventBus.dispatch('findbarclose', { source: {} })
      return
    }
    var active = getActiveValues()
    if (!active.length) {
      pdfApp.eventBus.dispatch('findbarclose', { source: {} })
      return
    }
    pdfApp.eventBus.dispatch('find', {
      source: {},
      type: '',
      query: active,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false
    })
  }

  checkboxes.forEach(function (cb) {
    cb.addEventListener('change', applyHighlights)
  })

  // ── Manual: text selection ────────────────────────────────────────────────
  var fullDocText = ''
  var manualItems = new Map()

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
    Promise.all(promises).then(function (texts) { fullDocText = texts.join(' ') })
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

  function renderManualList () {
    var list  = document.getElementById('dcf-manual-list')
    var empty = document.getElementById('dcf-manual-empty')
    if (!list) return
    list.innerHTML = ''
    if (manualItems.size === 0) {
      if (empty) empty.hidden = false
      return
    }
    if (empty) empty.hidden = true
    manualItems.forEach(function (count, text) {
      var li = document.createElement('li')
      li.className = 'dcf-manual-list__item'
      li.innerHTML =
        '<span class="dcf-manual-list__text">' + escHtml(text) + '</span> ' +
        ' <strong> — Appears ' + count + ' time' + (count !== 1 ? 's' : '') + '</strong>' +
        '<br><button type="button" class="dcf-manual-list__remove govuk-link">Remove</button>'
      li.querySelector('.dcf-manual-list__remove').addEventListener('click', function () {
        manualItems.delete(text)
        renderManualList()
      })
      list.appendChild(li)
    })
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
      sel.removeAllRanges()
    } catch (e) {}
  }

  var manualForm = document.getElementById('dcf-manual-form')
  if (manualForm) {
    manualForm.addEventListener('submit', function () {
      this.querySelectorAll('input[data-manual]').forEach(function (el) { el.remove() })
      manualItems.forEach(function (_, text) {
        var inp = document.createElement('input')
        inp.type  = 'hidden'
        inp.name  = 'confirmedRedactions'
        inp.setAttribute('data-manual', '1')
        inp.value = text
        manualForm.appendChild(inp)
      })
    })
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
        try { iframe.contentDocument.addEventListener('mouseup', onIframeMouseUp) } catch (e) {}
      })
    } catch (e) {}
  }

  iframe.addEventListener('load', init)
})()
