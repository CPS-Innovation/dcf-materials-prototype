// public/javascripts/material-search.js
(function () {
  var form   = document.querySelector('form.dcf-materials-search')
  var input  = form && form.querySelector('input[name="q"]')
  var viewer = document.getElementById('material-viewer')
  if (!form || !input || !viewer) return

  // ------------------------------------------------------------
  // SEARCH STATUS UI
  // ------------------------------------------------------------

  var status    = document.getElementById('search-status')
  var zeroWrap  = status && status.querySelector('[data-zero]')
  var someWrap  = status && status.querySelector('[data-some]')
  var countEl   = status && status.querySelector('[data-search-count]')
  var termEls   = [].slice.call(document.querySelectorAll('[data-search-term]'))
  var backToDocsLink = status && status.querySelector('a[data-action="back-to-documents"]')
  var backToDocsSep  = status && status.querySelector('[data-role="back-to-documents-sep"]')

  function navCluster () {
    return viewer.querySelector('[data-role="search-nav"]')
  }

  // Optional caseId
  var caseId =
    (form.querySelector('input[name="caseId"]') && form.querySelector('input[name="caseId"]').value) ||
    (document.body && document.body.getAttribute('data-case-id')) ||
    ''

  function setViewer (html, options) {
    options = options || {}
    var mode = options.mode || 'message'

    if (mode === 'results') {
      viewer._lastSearchHTML  = html
      viewer._lastSearchQuery = options.query || ''
      viewer.dataset.hasSearch = 'true'
      viewer.dataset.mode = 'search'
      viewer.innerHTML = html
    } else {
      viewer.dataset.mode = 'message'
      viewer.innerHTML = html
    }

    viewer.hidden = false
    try { viewer.focus() } catch (e) {}
  }

  function num (val) {
    var n = Number(val)
    return isNaN(n) ? 0 : n
  }

  function countRenderedResults () {
    var container = viewer.querySelector('[data-results-count]')
    if (container) return num(container.getAttribute('data-results-count'))
    return viewer.querySelectorAll('.dcf-search-hit, .dcf-material-card').length
  }

  function ensureStatus () {
    if (status && status.isConnected) {
      zeroWrap = status.querySelector('[data-zero]')
      someWrap = status.querySelector('[data-some]')
      countEl  = status.querySelector('[data-search-count]')
      termEls  = [].slice.call(status.querySelectorAll('[data-search-term]'))
      backToDocsLink = status.querySelector('a[data-action="back-to-documents"]')
      backToDocsSep  = status.querySelector('[data-role="back-to-documents-sep"]')
      return status
    }
    status = document.getElementById('search-status')
    return status
  }

  function updateStatusUI (count, q) {
    ensureStatus()
    if (!status) return

    status.hidden = false
    termEls.forEach(function (el) { el.textContent = q || '' })

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

  // ------------------------------------------------------------
  // SEARCH NAVIGATION SUPPORT (Back / Prev / Next)
  // ------------------------------------------------------------

  // We keep a *data* model of the hits, not DOM nodes, so navigation
  // still works after the viewer replaces the search HTML.
  var searchIndex = -1
  var searchItems = []   // [{ href, title, meta, itemId }]

  // Build structured hits from whatever is currently rendered in the viewer
  function buildHitsFromViewer () {
    var hits = Array.prototype.slice.call(
      viewer.querySelectorAll('.dcf-search-hit')
    ).map(function (hit) {
      var link = hit.querySelector('a.dcf-viewer-link') || hit.querySelector('a')
      var script = hit.querySelector('script.js-material-data')
      var meta = {}
      if (script) {
        try { meta = JSON.parse(script.textContent) } catch (e) { meta = {} }
      }
      var href = link && (link.getAttribute('data-file-url') || link.getAttribute('href')) || ''
      var title = link ? (link.getAttribute('data-title') || link.textContent.trim()) : ''
      var itemId = hit.getAttribute('data-item-id') || ''
      return { href: href, title: title, meta: meta, itemId: itemId }
    })

    viewer._searchHits = hits
    searchItems = hits
  }

  function buildSearchList () {
    searchItems = viewer._searchHits || []
  }

  // ------------------------------------------------------------
  // HIGHLIGHT ACTIVE CARD + TAB FOR CURRENT SEARCH HIT
  // ------------------------------------------------------------

  function highlightMaterialsUI (itemId) {
    if (!itemId) return

    // 1) Left-hand accordion card
    var cards = document.querySelectorAll('.dcf-materials-panel .dcf-material-card')
    cards.forEach(function (card) {
      card.classList.remove('dcf-material-card--active')
    })

    var activeCard = document.querySelector(
      '.dcf-materials-panel .dcf-material-card[data-item-id="' + itemId + '"]'
    )
    if (activeCard) {
      activeCard.classList.add('dcf-material-card--active')
    }

    // 2) Tabs above the viewer
    var tabs = document.querySelectorAll('.dcf-doc-tab')
    tabs.forEach(function (tab) {
      tab.classList.remove('is-active')
    })

    var activeTab = document.querySelector(
      '.dcf-doc-tab[data-item-id="' + itemId + '"]'
    )
    if (activeTab) {
      activeTab.classList.add('is-active')
    }
  }


  function updateNavUI () {
    var cluster = navCluster()
    if (!cluster) return

    var fromSearch = viewer.dataset.fromSearch === 'true'
    var inDocument = viewer.dataset.mode === 'document'

    if (!fromSearch || !inDocument || searchItems.length <= 1) {
      cluster.innerHTML = ''
      return
    }

    var html = []

    if (searchIndex > 0) {
      html.push(
        '<a href="#" class="govuk-link" data-action="nav-prev">&lt; Previous</a>'
      )
    }

    if (searchIndex < searchItems.length - 1) {
      if (html.length) {
        html.push('<span class="sep">&nbsp;|&nbsp;</span>')
      }
      html.push(
        '<a href="#" class="govuk-link" data-action="nav-next">Next &gt;</a>'
      )
    }

    cluster.innerHTML = html.join('')
  }

  function openSearchResultAt (idx) {
    if (idx < 0 || idx >= searchItems.length) return
    searchIndex = idx

    var hit = searchItems[idx]
    if (!hit) return

    // Ask the viewer script to open this hit inside the viewer.
    if (window.__dcfOpenMaterialFromSearch) {
      window.__dcfOpenMaterialFromSearch(hit)
    } else if (hit.href) {
      // Fallback: worst case, navigate directly
      window.location = hit.href
    }

    // NEW: sync the left-hand card + tab with this search hit
    highlightMaterialsUI(hit.itemId)

    updateNavUI()
  }


  // When user clicks a search result, we:
  //  - record which hit index was clicked
  //  - mark that the viewer journey is "from search"
  //  - open the hit inside the viewer (so no "old" behaviour)
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest('.dcf-search-hit a, .dcf-material-card a.js-material-link')
    if (!link) return
    if (viewer.dataset.mode !== 'search') return

    buildHitsFromViewer()

    var href = link.getAttribute('data-file-url') || link.getAttribute('href') || ''
    searchIndex = searchItems.findIndex(function (hit) { return hit && hit.href === href })
    if (searchIndex < 0) searchIndex = 0

    viewer.dataset.fromSearch = 'true'

    // NEW: if this click came from a search hit, always route via the
    // search navigation helper (so it opens in the viewer, not a new tab)
    if (link.closest('.dcf-search-hit')) {
      e.preventDefault()
      openSearchResultAt(searchIndex)
    }

    // After material-viewer.js has opened the viewer shell, we can
    // render the Prev / Next nav row.
    setTimeout(updateNavUI, 20)
  }, true)


  // ------------------------------------------------------------
  // NAVIGATION CONTROLS HANDLER (Prev / Next / Back to search)
  // ------------------------------------------------------------

  viewer.addEventListener('click', function (e) {
    var a = e.target && e.target.closest('[data-action]')
    if (!a) return

    var action = a.getAttribute('data-action')

    if (action === 'nav-back-search') {
      // Legacy – we now use the viewer toolbar's [data-action="back-to-search"]
      var back = viewer.querySelector('[data-action="back-to-search"]')
      if (back) back.click()
      return
    }

    if (action === 'nav-prev') {
      e.preventDefault()
      buildSearchList()
      openSearchResultAt(searchIndex - 1)
      return
    }

    if (action === 'nav-next') {
      e.preventDefault()
      buildSearchList()
      openSearchResultAt(searchIndex + 1)
      return
    }
  })

  // ------------------------------------------------------------
  // SORTING
  // ------------------------------------------------------------

  function parseMaterialDate (str) {
    if (!str) return null
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
      var p = str.split('/')
      return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])).getTime()
    }
    var d = new Date(str)
    return isNaN(d.getTime()) ? null : d.getTime()
  }

  function getCardDate (card) {
    if (!card) return null
    var raw = card.getAttribute('data-material-date')
    if (raw) return parseMaterialDate(raw)
    var script = card.querySelector('script.js-material-data[type="application/json"]')
    if (script) {
      try {
        var data = JSON.parse(script.textContent)
        if (data.date) return parseMaterialDate(data.date)
      } catch (e) {}
    }
    return null
  }

  function sortSearchResults (by) {
    var container =
      viewer.querySelector('.dcf-search-results') ||
      document.querySelector('.dcf-search-results')
    if (!container) return

    var cards = Array.prototype.slice.call(
      container.querySelectorAll('.dcf-search-hit, .dcf-material-card')
    )
    if (!cards.length) return

    if (by === 'date') {
      cards.sort(function (a, b) {
        var da = getCardDate(a)
        var db = getCardDate(b)
        if (da === null && db === null) return 0
        if (da === null) return 1
        if (db === null) return -1
        return db - da
      })
      cards.forEach(function (c) { container.appendChild(c) })
    }
  }

  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest('.dcf-search-order__link[data-sort-key]')
    if (!link) return
    e.preventDefault()
    var key = link.getAttribute('data-sort-key')
    sortSearchResults(key)
  })

  // ------------------------------------------------------------
  // AJAX SEARCH SUBMIT
  // ------------------------------------------------------------

  form.addEventListener('submit', function (e) {
    if (!window.fetch) return
    e.preventDefault()

    var q = (input.value || '').trim()
    var url = new URL(form.action, window.location.origin)
    if (q) url.searchParams.set('q', q)
    if (caseId) url.searchParams.set('caseId', caseId)
    url.searchParams.set('fragment', '1')

    setViewer('<p class="govuk-hint">Searching…</p>', { mode: 'message' })
    ensureStatus()
    if (status) status.hidden = true

    fetch(url.toString(), { headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.text() })
      .then(function (html) {
        setViewer(html, { mode: 'results', query: q })

        // Capture structured hits for this search
        buildHitsFromViewer()
        searchIndex = -1

        var count = countRenderedResults()
        updateStatusUI(count, q)
      })
      .catch(function () {
        setViewer('<div class="govuk-inset-text">Search failed.</div>', { mode: 'message' })
        updateStatusUI(0, q)
      })
  })
})()
