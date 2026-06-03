;(() => {
  var iframe  = document.getElementById('redact-preview-iframe')
  if (!iframe) return

  var data           = window.__previewData || {}
  var terms          = data.terms || []
  var areaRedactions = data.areaRedactions || []
  var overlay        = document.getElementById('dcf-preview-area-overlay')
  var pdfApp         = null

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

  function getPdfScrollTop () {
    try {
      return (pdfApp && pdfApp.pdfViewer && pdfApp.pdfViewer.container)
        ? pdfApp.pdfViewer.container.scrollTop
        : 0
    } catch (e) { return 0 }
  }

  function renderAreaOverlays () {
    if (!overlay || !areaRedactions.length) return
    Array.prototype.forEach.call(overlay.querySelectorAll('.dcf-area-preview-rect'), function (el) {
      overlay.removeChild(el)
    })
    var scrollTop = getPdfScrollTop()
    areaRedactions.forEach(function (item) {
      var div = document.createElement('div')
      div.className = 'dcf-area-preview-rect'
      div.style.left   = parseFloat(item['rect.xPct'])   + '%'
      div.style.top    = (parseFloat(item['rect.yAbsPx']) - scrollTop) + 'px'
      div.style.width  = parseFloat(item['rect.wPct'])   + '%'
      div.style.height = parseFloat(item['rect.hPx'])    + 'px'
      overlay.appendChild(div)
    })
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
        pdfApp = app
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

        renderAreaOverlays()

        try {
          app.pdfViewer.container.addEventListener('scroll', renderAreaOverlays)
        } catch (e) {}
      })
    } catch (e) {}
  }

  iframe.addEventListener('load', init)
})()
