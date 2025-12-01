// public/javascripts/material-search.js
(function () {
  var form   = document.querySelector('form.dcf-materials-search')
  var input  = form && form.querySelector('input[name="q"]')
  var viewer = document.getElementById('material-viewer')
  if (!form || !input || !viewer) return

  // Search status UI (safe if missing)
  var status    = document.getElementById('search-status')
  var zeroWrap  = status && status.querySelector('[data-zero]')
  var someWrap  = status && status.querySelector('[data-some]')
  var countEl   = status && status.querySelector('[data-search-count]')
  var termEls   = [].slice.call(document.querySelectorAll('[data-search-term]'))

  // Inline "Back to documents" link + separator (from the template)
  var backToDocsLink = status && status.querySelector('a[data-action="back-to-documents"]')
  var backToDocsSep  = status && status.querySelector('[data-role="back-to-documents-sep"]')

  // Optional: caseId via hidden input or body data attribute
  var caseId =
    (form.querySelector('input[name="caseId"]') && form.querySelector('input[name="caseId"]').value) ||
    (document.body && document.body.getAttribute('data-case-id')) ||
    ''

  // Render into the viewer in either "message" or "search results" mode
  function setViewer (html, options) {
    options = options || {}
    var mode = options.mode || 'message' // "message" | "results"

    if (mode === 'results') {
      // Store last search so the viewer can restore it later
      viewer._lastSearchHTML  = html
      viewer._lastSearchQuery = options.query || ''
      viewer.dataset.hasSearch = 'true'
      viewer.dataset.mode = 'search'

      viewer.innerHTML = html
    } else {
      // Plain message (e.g. "Searching…" or error)
      viewer.dataset.mode = 'message'
      viewer.innerHTML = html
    }

    viewer.hidden = false
    try { viewer.focus() } catch (e) {}
  }

  // --- helpers to determine result count -------------------------------------
  function num (val) {
    var n = Number(val)
    return isNaN(n) ? 0 : n
  }

  function countRenderedResults () {
    // Prefer an explicit data-results-count if the fragment provides it
    var container = viewer.querySelector('[data-results-count]')
    if (container) {
      return num(container.getAttribute('data-results-count'))
    }
    // Fallback: count rendered hits/cards
    return viewer.querySelectorAll('.dcf-search-hit, .dcf-material-card').length
  }

  function ensureStatus () {
    // If it still exists, refresh refs and return
    if (status && status.isConnected) {
      zeroWrap = status.querySelector('[data-zero]')
      someWrap = status.querySelector('[data-some]')
      countEl  = status.querySelector('[data-search-count]')
      termEls  = [].slice.call(status.querySelectorAll('[data-search-term]'))
      backToDocsLink = status.querySelector('a[data-action="back-to-documents"]')
      backToDocsSep  = status.querySelector('[data-role="back-to-documents-sep"]')
      return status
    }

    // Try to re-find (maybe re-rendered elsewhere)
    status = document.getElementById('search-status')
    if (!status) {
      // Rebuild the structure from your template and insert before viewer
      status = document.createElement('div')
      status.id = 'search-status'
      status.className = 'govuk-!-margin-bottom-3'
      status.setAttribute('aria-live', 'polite')
      status.hidden = true
      status.innerHTML = [
        '<div data-zero>',
          '<div class="dcf-search-meta govuk-!-margin-bottom-0">',
            'No results for “<span data-search-term></span>”.',
          '</div>',
        '</div>',
        '<div data-some hidden>',
          '<p class="dcf-search-meta">',
            '<strong><span data-search-count>0</span></strong>',
            ' results for “<span data-search-term></span>”',
            '<span data-role="back-to-documents-sep" hidden> | </span>',
            '<a href="#" class="govuk-link" data-action="back-to-documents" hidden>Back to documents</a>',
          '</p>',
          // Sort controls (fallback markup, matches template)
          '<div class="dcf-search-order govuk-!-margin-top-1 govuk-!-margin-bottom-2" aria-label="Search result sort options">',
            '<span class="dcf-search-order__label">Sort by:</span>',
            '<a href="#" class="govuk-link dcf-search-order__link" data-sort-key="date" aria-pressed="true">Date added</a>',
            '<span aria-hidden="true" class="dcf-search-order__separator">&nbsp;|&nbsp;</span>',
            '<a href="#" class="govuk-link dcf-search-order__link" data-sort-key="results" aria-pressed="false">Results per document</a>',
          '</div>',
        '</div>'
      ].join('')
      viewer.parentNode.insertBefore(status, viewer)
    }

    zeroWrap = status.querySelector('[data-zero]')
    someWrap = status.querySelector('[data-some]')
    countEl  = status.querySelector('[data-search-count]')
    termEls  = [].slice.call(status.querySelectorAll('[data-search-term]'))
    backToDocsLink = status.querySelector('a[data-action="back-to-documents"]')
    backToDocsSep  = status.querySelector('[data-role="back-to-documents-sep"]')

    return status
  }

  function updateStatusUI (count, q) {
    ensureStatus()
    if (!status) return

    // Always show the status block after a submit response arrives
    status.hidden = false

    // Update the query term everywhere
    termEls.forEach(function (el) { el.textContent = q || '' })

    // On every fresh search, keep "Back to documents" hidden.
    if (backToDocsLink) backToDocsLink.hidden = true
    if (backToDocsSep)  backToDocsSep.hidden  = true

    if (count > 0) {
      if (countEl) countEl.textContent = String(count)
      if (zeroWrap) zeroWrap.hidden = true
      if (someWrap) someWrap.hidden = false
    } else {
      if (zeroWrap) zeroWrap.hidden = false
      if (someWrap) someWrap.hidden = true
    }
  }

  // ---------------------------------------------------------------------------
  // Sorting utilities for "Sort by" controls
  // ---------------------------------------------------------------------------

  // Parse a date string into a timestamp so we can sort by it
  function parseMaterialDate (str) {
    if (!str) return null

    // Handle DD/MM/YYYY explicitly
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
      var parts = str.split('/') // [dd, mm, yyyy]
      return new Date(
        parseInt(parts[2], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[0], 10)
      ).getTime()
    }

    // Fallback – let the browser try
    var d = new Date(str)
    return isNaN(d.getTime()) ? null : d.getTime()
  }

  // Read the date for a hit/card: prefer data attribute, then JSON, then text
  function getCardDate (card) {
    if (!card) return null

    // 1) Prefer data-material-date on the card itself
    var raw = card.getAttribute('data-material-date')
    if (raw) return parseMaterialDate(raw)

    // 2) Or on a descendant (e.g. inner article/card)
    var dateNode = card.querySelector('[data-material-date]')
    if (dateNode && dateNode !== card) {
      var raw2 = dateNode.getAttribute('data-material-date')
      if (raw2) return parseMaterialDate(raw2)
    }

    // 3) Fallback: from embedded JSON (if present)
    var tag = card.querySelector('script.js-material-data[type="application/json"]')
    if (tag) {
      try {
        var json = JSON.parse(tag.textContent || '{}')

        // NEW: support both top-level date and nested Material.date
        if (json) {
          if (json.date) {
            return parseMaterialDate(json.date)
          }
          if (json.Material && json.Material.date) {
            return parseMaterialDate(json.Material.date)
          }
        }
      } catch (e) {
        // ignore parse errors
      }
    }

    // 4) Last resort: try to scrape "Date: ..." from text
    var text = card.textContent || ''
    var match = text.match(/Date:\s*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/)
    if (match && match[1]) {
      return parseMaterialDate(match[1])
    }

    return null
  }

  // Sort the visible search results in place
  function sortSearchResults (byKey) {
    // Try inside the viewer first, then anywhere on the page
    var container =
      viewer.querySelector('.dcf-search-results') ||
      document.querySelector('.dcf-search-results')

    if (!container) return

    // Treat each hit wrapper as the sortable unit
    var cards = Array.prototype.slice.call(
      container.querySelectorAll('.dcf-search-hit, .dcf-material-card')
    )
    if (!cards.length) return

    if (byKey === 'date') {
      cards.sort(function (a, b) {
        var da = getCardDate(a)
        var db = getCardDate(b)

        // Newest first; missing dates go last
        if (da === null && db === null) return 0
        if (da === null) return 1
        if (db === null) return -1
        return db - da
      })

      cards.forEach(function (card) {
        container.appendChild(card)
      })
    }

    if (byKey === 'results') {
      // For now, "Results per document" is a no-op on ordering.
      // You can later plug in logic to sort by per-document hit count.
      return
    }
  }

  // Toggle aria-pressed state on the sort links
  function updateSortControls (clickedLink) {
    var wrap = clickedLink.closest('.dcf-search-order')
    if (!wrap) return

    var links = wrap.querySelectorAll('.dcf-search-order__link')
    Array.prototype.forEach.call(links, function (lnk) {
      lnk.setAttribute('aria-pressed', lnk === clickedLink ? 'true' : 'false')
    })
  }

  // Global click handler: listen for clicks on sort controls
  document.addEventListener('click', function (event) {
    var link = event.target.closest('.dcf-search-order__link[data-sort-key]')
    if (!link) return

    event.preventDefault()

    var key = link.getAttribute('data-sort-key')
    if (!key) return

    updateSortControls(link)
    sortSearchResults(key)
  })

  // ---------------------------------------------------------------------------
  // Submit handler: AJAX search
  // ---------------------------------------------------------------------------

  form.addEventListener('submit', function (e) {
    if (!window.fetch) return // degrade gracefully
    e.preventDefault()

    var q = (input.value || '').trim()
    var url = new URL(form.action, window.location.origin)
    if (q) url.searchParams.set('q', q)
    if (caseId) url.searchParams.set('caseId', caseId)

    // Ask server for a fragment (your route can branch on this if you like)
    url.searchParams.set('fragment', '1')

    // Show "Searching…" as a message (not stored as results)
    setViewer(
      '<p class="govuk-hint govuk-!-margin-bottom-0">Searching…</p>',
      { mode: 'message' }
    )

    ensureStatus()
    if (status) status.hidden = true // hide status while loading

    fetch(url.toString(), { headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.text() })
      .then(function (html) {
        // Render and remember the search results
        setViewer(html, { mode: 'results', query: q })

        // Decide zero vs >0 **after** results render
        var count = countRenderedResults()
        updateStatusUI(count, q)
      })
      .catch(function () {
        setViewer(
          '<div class="govuk-inset-text govuk-!-margin-bottom-0">Search failed. Try again.</div>',
          { mode: 'message' }
        )
        updateStatusUI(0, q)
    })  
  }, false)
})()
// End of file: app/assets/javascripts/components/material-search.js