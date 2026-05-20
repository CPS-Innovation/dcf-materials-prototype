(() => {
  var iframe = document.getElementById('redact-preview-iframe')
  var checkboxes = document.querySelectorAll('input[name="confirmedRedactions"]')
  console.log('[redact] init — iframe:', !!iframe, 'checkboxes:', checkboxes.length)
  if (!iframe || !checkboxes.length) return

  var pdfApp = null

  function getActiveValues () {
    return Array.from(checkboxes)
      .filter(function (cb) { return cb.checked })
      .map(function (cb) { return cb.value })
  }

  function applyHighlights () {
    if (!pdfApp) { console.log('[redact] applyHighlights: no pdfApp yet'); return }
    var active = getActiveValues()
    console.log('[redact] dispatching find with:', active)
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

  function waitForPdfApp (iframeWindow, cb) {
    var attempts = 0
    var id = setInterval(function () {
      try {
        var app = iframeWindow.PDFViewerApplication
        if (app && app.pdfDocument) {
          clearInterval(id)
          console.log('[redact] pdfApp ready')
          cb(app)
        } else {
          if (++attempts % 8 === 0) console.log('[redact] waiting…', attempts, 'app:', !!app, 'doc:', !!(app && app.pdfDocument))
          if (attempts > 80) clearInterval(id)
        }
      } catch (e) {
        console.log('[redact] cross-origin error:', e.message)
        clearInterval(id)
      }
    }, 250)
  }

  function init () {
    console.log('[redact] iframe load fired')
    try {
      waitForPdfApp(iframe.contentWindow, function (app) {
        pdfApp = app
        applyHighlights()
      })
    } catch (e) {
      console.log('[redact] init error:', e.message)
    }
  }

  iframe.addEventListener('load', init)

  checkboxes.forEach(function (cb) {
    cb.addEventListener('change', applyHighlights)
  })
})()
