(() => {
  var iframe = document.getElementById('redact-preview-iframe')

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

  function makeListItem (text, count, onRemoveAll, onRemoveInstance) {
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
            '<button type="button" class="dcf-redact-instance__remove govuk-link">Remove instance</button>' +
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
      '<button type="button" class="dcf-manual-list__remove govuk-link">Remove all</button>'

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

  function renderAssistedList () {
    var list   = document.getElementById('dcf-assisted-list')
    var empty  = document.getElementById('dcf-assisted-empty')
    var submit = document.getElementById('dcf-assisted-submit')
    if (!list) return
    list.innerHTML = ''
    if (assistedItems.size === 0) {
      if (empty)  empty.hidden         = false
      if (submit) submit.style.display = 'none'
      return
    }
    if (empty)  empty.hidden         = true
    if (submit) submit.style.display = ''
    assistedItems.forEach(function (count, text) {
      list.appendChild(makeListItem(text, count,
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

  // ── Manual: text selection ────────────────────────────────────────────────
  var manualItems = new Map()

  function renderManualList () {
    var list   = document.getElementById('dcf-manual-list')
    var empty  = document.getElementById('dcf-manual-empty')
    var submit = document.getElementById('dcf-manual-submit')
    if (!list) return
    list.innerHTML = ''
    if (manualItems.size === 0) {
      if (empty)  empty.hidden         = false
      if (submit) submit.style.display = 'none'
      return
    }
    if (empty)  empty.hidden         = true
    if (submit) submit.style.display = ''
    manualItems.forEach(function (count, text) {
      list.appendChild(makeListItem(text, count,
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

  // ── Initialise assisted items from findings data ──────────────────────────
  var restore   = window.__redactRestore
  var findings  = window.__assistedFindings || []

  if (restore && restore.mode === 'assisted') {
    var confirmedSet = new Set(restore.confirmed || [])
    findings.forEach(function (f) {
      if (confirmedSet.has(f.value)) {
        assistedItems.set(f.value, Number((restore.instanceCount && restore.instanceCount[f.value]) || f.instances))
      }
    })
  } else {
    findings.forEach(function (f) { assistedItems.set(f.value, f.instances) })
  }
  renderAssistedList()

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
      })
    } catch (e) {}
  }

  iframe.addEventListener('load', init)
})()
