;(() => {
  var iframe = document.getElementById('redact-preview-iframe')
  if (!iframe) return

  var data  = window.__previewData || {}
  var terms = data.terms || []

  function injectBlackStyle (iframeDoc) {
    var style = iframeDoc.createElement('style')
    style.textContent =
      '.textLayer .highlight {' +
      '  background-color: #000 !important;' +
      '  color: transparent !important;' +
      '  border-radius: 0 !important;' +
      '  mix-blend-mode: normal !important;' +
      '  opacity: 1 !important;' +
      '}'
    iframeDoc.head.appendChild(style)
  }

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
        injectBlackStyle(iframe.contentDocument)

        if (terms.length) {
          app.eventBus.dispatch('find', {
            source:       {},
            type:         '',
            query:        terms,
            caseSensitive: false,
            entireWord:   false,
            highlightAll: true,
            findPrevious: false,
            matchDiacritics: false
          })
        }
      })
    } catch (e) {}
  }

  iframe.addEventListener('load', init)
})()
