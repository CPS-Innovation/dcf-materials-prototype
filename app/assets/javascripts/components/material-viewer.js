(() => {
  // Grab the viewer shell and the layout wrapper (used to toggle full-width mode).
  // Bail early if the page doesn't have the viewer.
  var viewer = document.getElementById('material-viewer')
  var layout = document.querySelector('.dcf-materials-layout')
  if (!viewer) return

  // --------------------------------------
  // Notes modal (side tray)
  // --------------------------------------

  var notesModal = document.getElementById('dcf-notes-modal')
  var lastNotesTrigger = null

  function isNotesOpen () {
    return !!(notesModal && !notesModal.hidden)
  }

  function openNotesModal (triggerEl) {
    if (!notesModal) return

    lastNotesTrigger = triggerEl || document.activeElement || null

    notesModal.hidden = false
    notesModal.classList.add('is-open')

    try {
      var heading = notesModal.querySelector('#dcf-notes-modal-title')
      var activeTab = viewer.querySelector('.dcf-doc-tab.is-active')
      var tabTitle = activeTab && activeTab.getAttribute('data-title')
      if (heading) {
        var base = 'Notes'
        heading.textContent = tabTitle ? base + ' – ' + tabTitle : base
      }
    } catch (e) {}

    var textarea = notesModal.querySelector('#dcf-note-text')
    if (textarea) {
      try { textarea.focus() } catch (e) {}
    }
  }

  function closeNotesModal () {
    if (!notesModal || notesModal.hidden) return

    notesModal.classList.remove('is-open')
    notesModal.hidden = true

    if (lastNotesTrigger && typeof lastNotesTrigger.focus === 'function') {
      try { lastNotesTrigger.focus() } catch (e) {}
    }
  }

  if (notesModal) {
    var notesForm = notesModal.querySelector('.dcf-notes-modal__form')
    if (notesForm) {
      notesForm.addEventListener('submit', function (e) {
        e.preventDefault()

        var textarea = notesModal.querySelector('#dcf-note-text')
        if (!textarea) return

        var text = (textarea.value || '').trim()
        if (!text) return

        var list = notesModal.querySelector('[data-notes-list]')
        var emptyMsg = notesModal.querySelector('[data-notes-empty]')
        if (!list) return

        if (emptyMsg) emptyMsg.hidden = true

        var noteEl = document.createElement('article')
        noteEl.className = 'dcf-note'

        var nameEl = document.createElement('h4')
        nameEl.className = 'govuk-heading-s'
        nameEl.textContent = '[User_name]'

        var dateEl = document.createElement('p')
        dateEl.className = 'govuk-body'
        dateEl.textContent = '[govukDateTime]'

        var textEl = document.createElement('p')
        textEl.className = 'govuk-body'
        textEl.textContent = text

        noteEl.appendChild(nameEl)
        noteEl.appendChild(dateEl)
        noteEl.appendChild(textEl)

        list.prepend(noteEl)

        textarea.value = ''

        var counter = notesModal.querySelector('#dcf-note-char-count')
        if (counter) {
          var max = parseInt(counter.getAttribute('data-maxlength') || '0', 10)
          if (max) {
            counter.textContent = 'You have ' + max + ' characters remaining'
          }
        }
      })
    }
  }

  document.addEventListener('click', function (e) {
    var closeEl = e.target && e.target.closest('[data-action="close-notes"]')
    if (!closeEl) return
    e.preventDefault()
    closeNotesModal()
  })

  document.addEventListener('click', function (e) {
    var trigger = e.target && e.target.closest('[data-action="open-notes"]')
    if (!trigger) return
    e.preventDefault()
    openNotesModal(trigger)
  })

  document.addEventListener('keydown', function (e) {
    if (!isNotesOpen()) return
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault()
      closeNotesModal()
    }
  })

  // --------------------------------------
  // Helpers
  // --------------------------------------

  function getMaterialJSONFromLink (link) {
    // 1) Preferred: normal card structure
    var scope = link.closest('.dcf-material-card')

    // 2) Also support table rows / other containers
    if (!scope) scope = link.closest('tr')
    if (!scope) scope = link.closest('[data-item-id]')
    if (!scope) scope = link.parentElement

    if (!scope) return null

    var tag = scope.querySelector('script.js-material-data[type="application/json"]')
    if (!tag) return null

    try { return JSON.parse(tag.textContent) } catch (e) { return null }
  }

  function esc (s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function toPublic (u) {
    if (!u) return ''
    if (/^https?:\/\//i.test(u)) return u
    if (u.startsWith('/public/')) return u
    if (u.startsWith('/assets/')) return '/public' + u.slice('/assets'.length)
    if (u.startsWith('/files/')) return '/public' + u
    if (u.startsWith('/')) return '/public' + u
    return '/public/' + u
  }

  function buildPdfViewerUrl (rawUrl) {
    var fileUrl = toPublic(rawUrl || '')
    return '/public/pdfjs/web/viewer.html?file=' + encodeURIComponent(fileUrl)
  }

  var _tabStore = { metaById: Object.create(null) }

  function stableId (meta, url) {
    var raw = (meta && (meta.ItemId || (meta.Material && meta.Material.Reference))) || url || Date.now().toString()
    return String(raw).replace(/[^a-zA-Z0-9_-]/g, '-')
  }

  function ensureShell () {
    var tabs = viewer.querySelector('#dcf-viewer-tabs')
    if (tabs) return tabs

    viewer.innerHTML = [
      '<div class="dcf-viewer__toolbar govuk-!-margin-bottom-4 govuk-body">',
        // LEFT group
        '<a href="#" class="govuk-link" data-action="close-viewer">Close all documents</a>',
        '<span aria-hidden="true" class="govuk-!-margin-horizontal-2">&nbsp; | &nbsp;</span>',
        '<a href="#" class="govuk-link" data-action="toggle-full" aria-pressed="false">View document full width</a>',

        // RIGHT group
        '<span class="dcf-viewer__toolbar-right">',
          '<a href="#" class="govuk-link" data-action="back-to-search" hidden>Back to search results</a>',
          '<span aria-hidden="true" class="govuk-!-margin-horizontal-2" data-role="back-to-search-sep" hidden>&nbsp; | &nbsp;</span>',
          '<span class="dcf-viewer__navcluster" data-role="search-nav"></span>',
        '</span>',
      '</div>',

      '<div id="dcf-viewer-tabs" class="dcf-viewer__tabs dcf-viewer__tabs--flush"></div>',
      '<div class="dcf-viewer__meta" data-meta-root></div>',

      '<div class="dcf-viewer__ops-bar" data-ops-root>',
        '<div class="dcf-ops-actions">',
          '<a href="#" class="govuk-button govuk-button--inverse dcf-ops-iconbtn" data-action="ops-icon">',
            '<span class="dcf-ops-icon" aria-hidden="true">',
              '<img src="/public/files/marquee-blue.svg" alt="" width="20" height="20" />',
            '</span>',
            '<span class="govuk-visually-hidden">Primary action</span>',
          '</a>',
          '<details class="dcf-action-menu" data-menu="document">',
            '<summary class="govuk-button govuk-button--inverse dcf-action-menu__summary">',
              'Document actions <span class="dcf-action-menu__icon" aria-hidden="true">▾</span>',
            '</summary>',
            '<ul class="dcf-action-menu__list" role="list">',
              '<li class="dcf-action-menu__item"><a href="#" class="govuk-link dcf-action-menu__link">Log an under or over redaction</a></li>',
              '<li class="dcf-action-menu__item"><a href="#" class="govuk-link dcf-action-menu__link">Rotate pages</a></li>',
              '<li class="dcf-action-menu__item"><a href="#" class="govuk-link dcf-action-menu__link">Discard pages</a></li>',
              '<li class="dcf-action-menu__item"><a href="#" class="govuk-link dcf-action-menu__link" data-action="mark-read">Mark as read</a></li>',
              '<li class="dcf-action-menu__item"><a href="#" class="govuk-link dcf-action-menu__link" data-action="mark-unread">Mark as unread</a></li>',
              '<li class="dcf-action-menu__item"><a href="#" class="govuk-link dcf-action-menu__link">Rename</a></li>',
              '<li class="dcf-action-menu__item"><a href="#" class="govuk-link dcf-action-menu__link">Delete page</a></li>',
            '</ul>',
          '</details>',
        '</div>',
      '</div>',

      '<iframe class="dcf-viewer__frame" src="" title="Preview" loading="lazy" referrerpolicy="no-referrer"></iframe>'
    ].join('')

    viewer.hidden = false
    viewer.setAttribute('tabindex', '-1')
    viewer.dataset.mode = 'document'

    // Recalculate visible tabs whenever the container resizes
    var tabsContainer = viewer.querySelector('#dcf-viewer-tabs')
    if (tabsContainer && typeof ResizeObserver !== 'undefined') {
      var _tabBarRO = new ResizeObserver(function () { renderTabBar() })
      _tabBarRO.observe(tabsContainer)
    }

    return tabsContainer
  }

  function setActiveTab (tabEl) {
    var tabs = viewer.querySelectorAll('#dcf-viewer-tabs .dcf-doc-tab')
    Array.prototype.forEach.call(tabs, function (btn) {
      btn.classList.toggle('is-active', btn === tabEl)
      btn.setAttribute('aria-selected', String(btn === tabEl))
      btn.setAttribute('tabindex', btn === tabEl ? '0' : '-1')
    })
  }

  // ------------------------------------------------------------------
  // renderTabBar — max 4 visible tabs, rest go into overflow dropdown
  // ------------------------------------------------------------------
  var MAX_VISIBLE_TABS = 4

  function escHtml (s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // Close the <details> overflow widget
  function closeOverflowDropdown () {
    var det = viewer.querySelector('.dcf-tab-overflow')
    if (det) det.open = false
  }

  function renderTabBar () {
    var tabsEl = viewer.querySelector('#dcf-viewer-tabs')
    if (!tabsEl) return

    var allTabs = Array.prototype.slice.call(tabsEl.querySelectorAll('.dcf-doc-tab'))

    // Show/hide tabs by index — first MAX_VISIBLE_TABS visible, rest hidden
    var hiddenTabs = []
    allTabs.forEach(function (t, i) {
      var hide = i >= MAX_VISIBLE_TABS
      t.style.display = hide ? 'none' : ''
      if (hide) hiddenTabs.push(t)
    })

    // Find or create the <details> overflow widget
    var det = tabsEl.querySelector('.dcf-tab-overflow')
    if (!det) {
      det = document.createElement('details')
      det.className = 'dcf-tab-overflow'

      var summary = document.createElement('summary')
      summary.className = 'dcf-tab-overflow-btn'
      det.appendChild(summary)

      tabsEl.appendChild(det)
    } else {
      // Always keep it as the last child
      tabsEl.appendChild(det)
    }

    if (hiddenTabs.length === 0) {
      det.style.display = 'none'
      det.open = false
      return
    }

    det.style.display = ''

    // Update summary label
    var summary = det.querySelector('summary')
    summary.innerHTML =
      '<span class="dcf-tab-overflow-badge">+' + hiddenTabs.length + '</span>' +
      '<span class="dcf-tab-overflow-label"> More items</span>'

    // Rebuild the dropdown list inside the <details>
    var drop = det.querySelector('.dcf-tab-overflow-dropdown')
    if (drop) drop.parentNode.removeChild(drop)

    drop = document.createElement('div')
    drop.className = 'dcf-tab-overflow-dropdown'

    var header = document.createElement('div')
    header.className = 'dcf-tab-overflow-dropdown__header'
    header.textContent = 'More items (' + hiddenTabs.length + ')'
    drop.appendChild(header)

    hiddenTabs.forEach(function (t) {
      var id = t.getAttribute('data-tab-id')
      var title = t.getAttribute('data-title') || 'Document'
      var isActive = t.classList.contains('is-active')

      var item = document.createElement('button')
      item.type = 'button'
      item.className = 'dcf-tab-overflow-dropdown__item' + (isActive ? ' is-active' : '')
      item.setAttribute('data-tab-id', id)
      item.innerHTML =
        '<span class="dcf-tab-overflow-dropdown__item-name">' + escHtml(title) + '</span>' +
        '<span class="dcf-tab-overflow-dropdown__item-close" data-close-tab-id="' + escHtml(id) + '">&#215;</span>'
      drop.appendChild(item)
    })

    det.appendChild(drop)
  }
  // ------------------------------------------------------------------

  function renderMeta (meta) {
    var rawId = (meta && (meta.ItemId || (meta.Material && meta.Material.Reference))) || Date.now()
    var bodyId = 'meta-' + String(rawId).replace(/[^a-zA-Z0-9_-]/g, '-')
    var html = buildMetaPanel(meta || {}, bodyId)
    var root = viewer.querySelector('[data-meta-root]')
    if (root) {
      root.outerHTML = html
    }
    var toggle = viewer.querySelector('[data-action="toggle-meta"]')
    if (toggle) toggle.setAttribute('aria-controls', bodyId)

  }

  function switchToTabById (id) {
    var tab = viewer.querySelector('#dcf-viewer-tabs .dcf-doc-tab[data-tab-id="' + id + '"]')
    if (!tab) return
    var meta = _tabStore.metaById[id] || {}
    var url = tab.getAttribute('data-url') || ''
    var title = tab.getAttribute('data-title') || 'Document'

    var iframe = viewer.querySelector('.dcf-viewer__frame')
    if (iframe && url) iframe.setAttribute('src', buildPdfViewerUrl(url))

    setActiveTab(tab)

    var itemId = tab.getAttribute('data-item-id')
    if (itemId) {
      var cardForTab = document.querySelector('.dcf-material-card[data-item-id="' + CSS.escape(itemId) + '"]')
      viewer._currentCard = cardForTab || null
      if (cardForTab) {
        setActiveCard(cardForTab)
      } else {
        setActiveCard(null)
      }
    } else {
      viewer._currentCard = null
      setActiveCard(null)
    }

    renderMeta(meta)

    var menuEl = viewer.querySelector('details.dcf-action-menu[data-menu="document"]')
    var isNewForMenu = true
    if (viewer._currentCard) isNewForMenu = (viewer._currentCard.dataset.isNew !== 'false')
    updateOpsMenuForStatus(menuEl, isNewForMenu)

    try { tab.focus() } catch (e) {}
  }

  function addOrActivateTab (meta, url, title) {
    var id = stableId(meta, url)
    var tabs = ensureShell()
    var existing = viewer.querySelector('#dcf-viewer-tabs .dcf-doc-tab[data-tab-id="' + id + '"]')
    if (!existing) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'dcf-doc-tab'
      btn.setAttribute('role', 'tab')
      btn.setAttribute('aria-selected', 'false')
      btn.setAttribute('data-tab-id', id)
      btn.setAttribute('data-item-id', (meta && (meta.ItemId || (meta.Material && meta.Material.ItemId))) || '')
      btn.setAttribute('data-url', url || '')
      btn.setAttribute('data-title', title || 'Document')
      btn.title = title || 'Document'
      btn.innerHTML =
        '<span class="dcf-doc-tab__label"></span>' +
        '<span class="dcf-doc-tab__close" aria-label="Close tab" role="button">×</span>' +
        '<span class="dcf-doc-tab__bar" aria-hidden="true"></span>'
      var label = btn.querySelector('.dcf-doc-tab__label')
      if (label) label.textContent = title || 'Document'
      tabs.appendChild(btn)
      _tabStore.metaById[id] = meta || {}
      existing = btn
    } else {
      _tabStore.metaById[id] = meta || _tabStore.metaById[id] || {}
      existing.setAttribute('data-url', url || existing.getAttribute('data-url') || '')
      existing.setAttribute('data-title', title || existing.getAttribute('data-title') || 'Document')
    }

    setActiveTab(existing)
    var iframe = viewer.querySelector('.dcf-viewer__frame')
    if (iframe) iframe.setAttribute('src', buildPdfViewerUrl(url))

    renderMeta(meta)
    renderTabBar()
  }

  function removeSearchStatus () {
    var s = document.getElementById('search-status')
    if (s) s.hidden = true
  }

  function rowsHTML (obj, mapping) {
    return mapping.map(function (m) {
      var v = (m.get ? m.get(obj) : obj && obj[m.key])
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return ''
      var valHTML = (m.render ? m.render(v) : esc(v))
      return (
        '<div class="govuk-summary-list__row">' +
          '<dt class="govuk-summary-list__key">' + esc(m.label) + '</dt>' +
          '<dd class="govuk-summary-list__value">' + valHTML + '</dd>' +
        '</div>'
      )
    }).join('')
  }

  function sectionHTML (title, rows) {
    if (!rows) return ''
    return (
      '<h3 class="govuk-heading-s govuk-!-margin-top-3 govuk-!-margin-bottom-1">' + esc(title) + '</h3>' +
      '<dl class="govuk-summary-list govuk-!-margin-bottom-2">' + rows + '</dl>'
    )
  }

  function sectionHTMLNoHeading (rows) {
    if (!rows) return ''
    return (
      '<dl class="govuk-summary-list govuk-!-margin-top-3 govuk-!-margin-bottom-2">' + rows + '</dl>'
    )
  }

  function setActiveCard (targetEl) {
    document
      .querySelectorAll('.dcf-material-card--active')
      .forEach(function (el) { el.classList.remove('dcf-material-card--active') })

    if (!targetEl) return

    var card = null

    if (typeof targetEl.closest === 'function') {
      card = targetEl.closest('.dcf-material-card')
    }

    if (!card && targetEl.classList && targetEl.classList.contains('dcf-material-card')) {
      card = targetEl
    }

    if (card) {
      card.classList.add('dcf-material-card--active')
    }
  }

  // --------------------------------------
  // Status helpers: New / Read / Unread
  // --------------------------------------

  function getCardStatusFromJSON (card) {
    var tag = card.querySelector('script.js-material-data[type="application/json"]')
    if (!tag) return null
    var data
    try { data = JSON.parse(tag.textContent) } catch (e) { return null }
    if (!data) return null

    if (typeof data.materialStatus === 'string') {
      return data.materialStatus
    }
    if (data.Material && typeof data.Material.materialStatus === 'string') {
      return data.Material.materialStatus
    }
    return null
  }

  function renderStatusTags (card) {
    if (!card) return
    var badge = card.querySelector('.dcf-material-card__badge')
    if (!badge) return

    // New behaviour:
    // - Show ONLY the "New" tag when isNew is true
    // - Otherwise hide/remove the badge entirely
    // (We keep Read/Unread statuses in data/localStorage for now, but we do not render them.)
    var isNew = card.dataset.isNew !== 'false'

    if (isNew) {
      badge.hidden = false
      badge.innerHTML = '<strong class="govuk-tag dcf-tag dcf-tag--new">New</strong>'
    } else {
      badge.innerHTML = ''
      badge.hidden = true
    }
  }

  function initCardStatus (card) {

    if (!card) return

    var status = 'New'
    var isNew = true
    var hasViewedClosed = false

    try {
      var caseId = (window.caseMaterials && window.caseMaterials.caseId) || card.getAttribute('data-case-id')
      var itemId = card.getAttribute('data-item-id')
      if (caseId && itemId) {
        var storedStatus = localStorage.getItem('matStatus:' + caseId + ':' + itemId)
        var storedIsNew = localStorage.getItem('matIsNew:' + caseId + ':' + itemId)
        var storedClosed = localStorage.getItem('matClosed:' + caseId + ':' + itemId)

        if (storedStatus) status = storedStatus
        if (storedIsNew !== null) isNew = (storedIsNew === 'true')
        if (storedClosed === 'true') hasViewedClosed = true
      }
    } catch (e) {}

    card.dataset.materialStatus = status
    card.dataset.isNew = String(isNew)
    card.dataset.hasViewedAndClosed = hasViewedClosed ? 'true' : 'false'

    var badge = card.querySelector('.dcf-material-card__badge')
    if (badge) {
      badge.dataset.rawStatus = status
    }

    renderStatusTags(card)
  }

  function markCardVisited (card) {
    if (!card) return
    if (card.dataset.hasVisited === 'true') return
    card.dataset.hasVisited = 'true'

    try {
      var caseId = (window.caseMaterials && window.caseMaterials.caseId) || card.getAttribute('data-case-id')
      var itemId = card.getAttribute('data-item-id')
      if (caseId && itemId) {
        localStorage.setItem('matVisited:' + caseId + ':' + itemId, 'true')
      }
    } catch (e) {}
  }

  function markCardClosed (card) {
    if (!card) return
    if (card.dataset.hasViewedAndClosed === 'true') return

    card.dataset.hasViewedAndClosed = 'true'

    try {
      var caseId = (window.caseMaterials && window.caseMaterials.caseId) || card.getAttribute('data-case-id')
      var itemId = card.getAttribute('data-item-id')
      if (caseId && itemId) {
        localStorage.setItem('matClosed:' + caseId + ':' + itemId, 'true')
      }
    } catch (e) {}

    renderStatusTags(card)
  }

  function setMaterialStatus (card, status) {
    // Kept for future: we still persist a Read/Unread status value,
    // but the UI no longer renders it (only the New tag is shown/hidden).
    if (!card) return

    var tag = card.querySelector('script.js-material-data[type="application/json"]')
    var data = null
    try { data = tag ? JSON.parse(tag.textContent) : null } catch (e) { data = null }

    if (data) {
      if ('materialStatus' in data) {
        data.materialStatus = status
      } else if (data.Material && typeof data.Material === 'object') {
        data.Material.materialStatus = status
      } else {
        data.materialStatus = status
      }
      try { tag.textContent = JSON.stringify(data) } catch (e) {}
    }

    card.dataset.materialStatus = status

    var badge = card.querySelector('.dcf-material-card__badge')
    if (badge) badge.dataset.rawStatus = status

    var itemId =
      (data && (data.ItemId || (data.Material && data.Material.ItemId) || data.itemId)) ||
      card.getAttribute('data-item-id')

    // Keep window.caseMaterials in sync if it exists
    if (itemId && window.caseMaterials && Array.isArray(window.caseMaterials.Material)) {
      var m = window.caseMaterials.Material.find(function (x) { return (x.ItemId || x.itemId) === itemId })
      if (m) {
        if ('materialStatus' in m) m.materialStatus = status
        else if (m.Material && typeof m.Material === 'object') m.Material.materialStatus = status
        else m.materialStatus = status
      }
    }

    try {
      var caseId2 = (window.caseMaterials && window.caseMaterials.caseId) || card.getAttribute('data-case-id')
      if (itemId && caseId2) {
        localStorage.setItem('matStatus:' + caseId2 + ':' + itemId, status)
      }
    } catch (e) {}
  }

  function setCardIsNew (card, isNew) {
    if (!card) return
    var next = !!isNew
    card.dataset.isNew = String(next)

    // Persist per-case/item toggle state
    try {
      var caseId = (window.caseMaterials && window.caseMaterials.caseId) || card.getAttribute('data-case-id')
      var itemId = card.getAttribute('data-item-id')
      if (caseId && itemId) {
        localStorage.setItem('matIsNew:' + caseId + ':' + itemId, String(next))
      }
    } catch (e) {}

    renderStatusTags(card)
  }

  function updateOpsMenuForStatus (menuEl, isNew) {
    if (!menuEl) return

    // New behaviour: menu toggles based on whether the item is "New"
    // - If New: show "Mark as read", hide "Mark as unread"
    // - If not New: show "Mark as unread", hide "Mark as read"
    var readItem = menuEl.querySelector('[data-action="mark-read"]')
    var unreadItem = menuEl.querySelector('[data-action="mark-unread"]')

    var showMarkRead = (isNew !== false) && (String(isNew) !== 'false')

    if (readItem) readItem.closest('li').hidden = !showMarkRead
    if (unreadItem) unreadItem.closest('li').hidden = showMarkRead
  }

  // --------------------------------------
  // Material actions (inline MoJ menu in meta)
  // --------------------------------------

  // Lookup of all possible actions (no generate-cps-docs)
  var MATERIAL_ACTIONS_LOOKUP = {
    'assess-unused': {
      id: 'assess-unused',
      label: 'Assess as unused'
    },
    'assess-no-longer-relevant': {
      id: 'assess-no-longer-relevant',
      label: 'Assess as no longer relevant'
    },
    'assess-disclosable': {
      id: 'assess-disclosable',
      label: 'Assess as disclosable'
    },
    'assess-disclosable-inspect': {
      id: 'assess-disclosable-inspect',
      label: 'Assess as disclosable by inspection'
    },
    'assess-not-disclosable': {
      id: 'assess-not-disclosable',
      label: 'Assess as not disclosable'
    },
    'assess-clearly-not': {
      id: 'assess-clearly-not',
      label: 'Assess as clearly not disclosable'
    },
    'assess-evidence': {
      id: 'assess-evidence',
      label: 'Assess as evidence'
    },
    'dispute-sensitivity': {
      id: 'dispute-sensitivity',
      label: 'Dispute sensitivity'
    },
    'request-updated-description': {
      id: 'request-updated-description',
      label: 'Request updated description'
    },
    'request-material': {
      id: 'request-material',
      label: 'Request material'
    }
  }

  // Action sets for different material types
  var MATERIAL_ACTION_SETS = {
    // If Material.Type == 'Statement' or 'Exhibit'
    statementOrExhibit: [
      'assess-unused',
      'assess-no-longer-relevant'
    ],

    // If Material.Type == 'Unused non-sensitive' or 'Sensitive'
    unusedOrSensitive: [
      'assess-disclosable',
      'assess-disclosable-inspect',
      'assess-not-disclosable',
      'assess-clearly-not',
      'assess-evidence',
      'dispute-sensitivity',
      'request-updated-description',
      'request-material'
    ]
  }

  // Try to derive the type for the current material
  function getMaterialTypeFromMeta (meta) {
    var candidate = null

    // 1) Try direct properties on the meta object (if it's already a single material)
    if (meta) {
      if (meta.Type || meta.MaterialType) {
        candidate = meta.Type || meta.MaterialType
      } else if (meta.Material && (meta.Material.Type || meta.Material.MaterialType)) {
        // Or if meta has a nested .Material object
        candidate = meta.Material.Type || meta.Material.MaterialType
      }
    }

    // 2) If we still don't know the type, try resolving by ItemId against window.caseMaterials.Material[]
    if (!candidate && window.caseMaterials && Array.isArray(window.caseMaterials.Material)) {
      // Work out an ItemId from meta OR the current card/tab
      var itemId =
        (meta && (meta.ItemId || meta.itemId)) ||
        (meta && meta.Material && (meta.Material.ItemId || meta.Material.itemId)) ||
        (viewer && viewer._currentCard && viewer._currentCard.getAttribute('data-item-id')) ||
        null

      if (itemId) {
        var found = window.caseMaterials.Material.find(function (m) {
          return (m.ItemId || m.itemId) === itemId
        })
        if (found) {
          // This is your canonical path: caseMaterials.Material[].Type / .MaterialType
          candidate = found.Type || found.MaterialType || candidate
        }
      }
    }

    return candidate ? String(candidate) : ''
  }

  function getActionsForMaterial (meta) {
    var rawType = getMaterialTypeFromMeta(meta)
    var type = rawType ? rawType.toLowerCase().trim() : ''
    var setIds

    if (!type) {
      // If we cannot resolve a type, fall back to all actions
      setIds = Object.keys(MATERIAL_ACTIONS_LOOKUP)
    } else if (type === 'statement' || type === 'exhibit') {
      setIds = MATERIAL_ACTION_SETS.statementOrExhibit
    } else if (type === 'unused non-sensitive' || type === 'sensitive' || type === 'unused sensitive') {
      setIds = MATERIAL_ACTION_SETS.unusedOrSensitive
    } else {
      // Unknown type but non-empty string – also show all actions
      setIds = Object.keys(MATERIAL_ACTIONS_LOOKUP)
    }

    return setIds
      .map(function (id) { return MATERIAL_ACTIONS_LOOKUP[id] })
      .filter(Boolean)
  }

  function buildInlineActionsMenu (meta) {
    var actions = getActionsForMaterial(meta)

    // No actions? Don't render the menu at all.
    if (!actions || !actions.length) {
      return ''
    }

    var itemsHTML = actions.map(function (a) {
      return (
        '<li class="dcf-action-menu__item">' +
          '<a href="#" class="govuk-link dcf-action-menu__link" data-action="' + esc(a.id) + '">' +
            esc(a.label) +
          '</a>' +
        '</li>'
      )
    }).join('')

    // Use <details> to avoid nested-button markup issues from moj-button-menu
    return (
      '<div class="dcf-meta-inline-actions">' +
        '<details class="dcf-action-menu" data-menu="material">' +
          '<summary class="govuk-button govuk-button--primary dcf-action-menu__summary">' +
            'Material actions <span class="dcf-action-menu__icon" aria-hidden="true">▾</span>' +
          '</summary>' +
          '<ul class="dcf-action-menu__list">' +
            itemsHTML +
          '</ul>' +
        '</details>' +
      '</div>'
    )
  }

  // --------------------------------------
  // Meta panel builder
  // --------------------------------------

function buildMetaPanel (meta, bodyId) {
  // Meta may either be a flat material object, or { Material: { ... } }
  var mat = (meta && meta.Material) || meta || {}

  // Related / digital structures
  var rel = (meta && meta.RelatedMaterials) || {}
  var dig = (meta && meta.DigitalRepresentation) || {}

  // Detect type – use shared helper so behaviour matches actions menu etc.
  var rawType = getMaterialTypeFromMeta(meta || mat) ||
                mat.Type ||
                (meta && meta.Type) ||
                ''
  var typeNorm = String(rawType).toLowerCase().trim()

  var isUnusedOrSensitive = (typeNorm === 'unused non-sensitive' || typeNorm === 'sensitive' || typeNorm === 'unused sensitive')
  var isExhibit   = (typeNorm === 'exhibit')
  var isStatement = (typeNorm === 'statement')

  // Any material (statement or exhibit) can be explicitly flagged as evidence
  var isEvidence = (mat.isEvidence === true || mat.isEvidence === 'true')


  // Disclosure objects
  var pol = (mat && mat.policeDisclosure) ||
            (meta && meta.Material && meta.Material.policeDisclosure) ||
            (meta && meta.policeDisclosure) ||
            {}
  var cps = (mat && mat.cpsDisclosure) ||
            (meta && meta.Material && meta.Material.cpsDisclosure) ||
            (meta && meta.cpsDisclosure) ||
            {}

  // When to show sections
  // - Statements and Exhibits: compact Police block only
  // - Unused / Sensitive: full Police + CPS blocks
  var hasPoliceSection = isUnusedOrSensitive || isExhibit || isStatement

  // For now, CPS appears only for unused / sensitive material.
  // (We’ll introduce Statement/Exhibit challenge flows later.)
  var hasCpsSection =
    isUnusedOrSensitive ||
    ((isExhibit || isStatement) && cps && typeof cps === 'object' && !!cps.status)



  // If/when you want CPS to appear for Exhibits, you can switch to:
  // var hasCpsSection =
  //   isUnusedOrSensitive ||
  //   (isExhibit && cps && typeof cps === 'object' && Object.keys(cps).length > 0)


  // Helper: render a status value as a GOV.UK tag
  function statusTagHTML (kind, value) {
    var text = (value == null ? '' : String(value)).trim()
    if (!text) return '—'

    var cls = 'govuk-tag'
    var lower = text.toLowerCase()

    if (kind === 'police') {
      // All police statuses use govuk-tag--grey — matches Disclosure screens (source of truth)
      cls += ' govuk-tag--grey'
    } else if (kind === 'cps') {
      // Yellow — disagreement / dispute flags
      if (lower === 'disagrees with police' || lower === 'sensitivity disputed') {
        cls += ' govuk-tag--yellow'
      // Light blue — unassessed / pending states + Evidence
      } else if (lower === 'to be assessed' || lower === 'to be reviewed' || lower === 'evidence') {
        cls += ' govuk-tag--light-blue'
      // Blue — all fully assessed CPS statuses
      } else {
        cls += ' govuk-tag--blue'
      }
    }

    return '<strong class="' + cls + '">' + esc(text) + '</strong>'
  }

  function rowsHTMLLocal (obj, mapping) {
    return mapping.map(function (m) {
      var v = (m.get ? m.get(obj) : obj && obj[m.key])
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return ''
      var valHTML = (m.render ? m.render(v) : esc(v))
      return (
        '<div class="govuk-summary-list__row">' +
          '<dt class="govuk-summary-list__key">' + esc(m.label) + '</dt>' +
          '<dd class="govuk-summary-list__value">' + valHTML + '</dd>' +
        '</div>'
      )
    }).join('')
  }

  function sectionHTMLLocal (title, rows) {
    if (!rows) return ''
    return (
      '<h3 class="govuk-heading-s govuk-!-margin-top-3 govuk-!-margin-bottom-1">' + esc(title) + '</h3>' +
      '<dl class="govuk-summary-list govuk-!-margin-bottom-2">' + rows + '</dl>'
    )
  }

  function sectionHTMLNoHeadingLocal (rows) {
    if (!rows) return ''
    return (
      '<dl class="govuk-summary-list govuk-!-margin-top-3 govuk-!-margin-bottom-2">' + rows + '</dl>'
    )
  }

  // ----------------------------------
  // Core material rows
  // ----------------------------------

  var materialRows

  if (isStatement) {
    // Statement-specific layout
    // TODO: most fields below not yet in data model — placeholders show gaps
    materialRows = rowsHTMLLocal(mat, [
      { key: 'Title',                         label: 'Title' },
      { key: 'MaterialClassification',        label: 'Classification' },
      // TODO: StatementNumber — not yet in data model
      { key: 'StatementNumber',               label: 'Statement number' },
      // TODO: StatementMadeOn — not yet in data model
      { key: 'StatementMadeOn',               label: 'Statement made on' },
      // TODO: WhenRecorded — not yet in data model (PeriodFrom is closest current proxy)
      { key: 'WhenRecorded',                  label: 'When recorded' },
      // TODO: WhereRecorded — not yet in data model (Location is closest current proxy)
      { key: 'WhereRecorded',                 label: 'Where recorded' },
      // TODO: WhenTranscribed — not yet in data model
      { key: 'WhenTranscribed',               label: 'When transcribed' },
      // TODO: PresentationOfImpactStatement — not yet in data model
      { key: 'PresentationOfImpactStatement', label: 'Presentation of impact statement' },
      // TODO: AppropriateAdult — not yet in data model
      { key: 'AppropriateAdult',              label: 'Appropriate adult' },
      { key: 'myFileUrl',                     label: 'File location (URL)', render: function (v) {
        if (!v || v === '#') return '\u2014'
        return '<a class="govuk-link" href="' + esc(v) + '" target="_blank" rel="noreferrer">' + esc(v) + '</a>'
      }}
    ])
  } else if (isUnusedOrSensitive) {
    // Unused non-sensitive / Sensitive layout
    materialRows = rowsHTMLLocal(mat, [
      { key: 'Reference',              label: 'Reference' },
      { key: 'Title',                  label: 'Title' },
      { key: 'MaterialClassification', label: 'Classification' },
      { key: 'Description',            label: 'Description' },
      { key: 'PeriodFrom',             label: 'Period from' },
      { key: 'ProducedbyWitnessId',    label: 'Produced by' }
    ])
  } else if (isExhibit) {
    // Exhibit layout
    materialRows = rowsHTMLLocal(mat, [
      { key: 'Reference',              label: 'Reference' },
      { key: 'exhibitName',            label: 'Title' },
      { key: 'MaterialClassification', label: 'Classification' },
      { key: 'exhibitDescription',     label: 'Description' },
      { key: 'Location',               label: 'Location' },
      { key: 'PeriodFrom',             label: 'Period from' },
      { key: 'PeriodTo',               label: 'Period to' },
      { key: 'ProducedbyWitnessId',    label: 'Produced by witness' },
      // TODO: RelatedPerson1 / RelatedPerson2 — not yet in data model (currently only RelatedParticipantId)
      { key: 'RelatedPerson1',         label: 'Related person 1' },
      { key: 'RelatedPerson2',         label: 'Related person 2' },
      { key: 'myFileUrl',              label: 'File location (URL)', render: function (v) {
        if (!v || v === '#') return '—'
        return '<a class="govuk-link" href="' + esc(v) + '" target="_blank" rel="noreferrer">' + esc(v) + '</a>'
      }}
    ])
  } else {
    // Default layout (fallback)
    materialRows = rowsHTMLLocal(mat, [
      { key: 'Reference',              label: 'Reference' },
      { key: 'Title',                  label: 'Title' },
      { key: 'MaterialClassification', label: 'Classification' },
      { key: 'RelatedPerson1',         label: 'Related person' },
      { key: 'Description',            label: 'Description' },
      { key: 'Location',               label: 'Location' },
      { key: 'PeriodFrom',             label: 'Period from' },
      { key: 'PeriodTo',               label: 'Period to' },
      { key: 'ProducedbyWitnessId',    label: 'Produced by' },
      { key: 'MaterialType',           label: 'Type' },
      { key: 'SentExternally',         label: 'Sent externally' },
      { key: 'RelatedParticipantId',   label: 'Related participant id' },
      { key: 'myFileUrl',              label: 'File location (URL)', render: function (v) {
        if (!v || v === '#') return '\u2014'
        return esc(v)
      }}
    ])
  }

  // ----------------------------------
  // Related material
  // ----------------------------------

  // Related material — label for first row differs by type
  var relatedRows = rowsHTMLLocal(rel, [
    {
      key: 'PreviousMaterialName',
      label: isExhibit ? 'Previous material reference' : 'Previous material name'
    },
    { key: 'HowMaterialRelates', label: 'How this material relates to previous material' }
  ])

  var digitalRows
  if (Array.isArray(dig.Items) && dig.Items.length) {
    digitalRows = dig.Items.map(function (it, idx) {
      var itemRows = rowsHTMLLocal(it, [
        { key: 'FileName',             label: 'File name' },
        { key: 'ExternalFileLocation', label: 'External file location' },
        { key: 'ExternalFileURL',      label: 'External file URL', render: function (v) {
          if (v === '#' || v === '') return '—'
          return '<a class="govuk-link" href="' + esc(v) + '" target="_blank" rel="noreferrer">' + esc(v) + '</a>'
        } },
        { key: 'DigitalSignature',     label: 'Digital signature' }
      ])
      return itemRows ? (
        '<div class="govuk-!-margin-bottom-2">' +
          '<h4 class="govuk-heading-s govuk-!-margin-bottom-1">Item ' + (idx + 1) + '</h4>' +
          '<dl class="govuk-summary-list govuk-!-margin-bottom-1">' + itemRows + '</dl>' +
        '</div>'
      ) : ''
    }).join('')
  } else {
    digitalRows = rowsHTMLLocal(dig, [
      { key: 'FileName',             label: 'File name' },
      { key: 'Document',             label: 'Document' },
      { key: 'ExternalFileLocation', label: 'External file location' },
      { key: 'ExternalFileURL',      label: 'External file URL', render: function (v) {
        if (v === '#' || v === '') return '—'
        return '<a class="govuk-link js-doc-link" href="' + esc(v) + '" target="_blank" rel="noreferrer">' + esc(v) + '</a>'
      } },
      { key: 'DigitalSignature',     label: 'Digital signature' }
    ])
  }

  // ----------------------------------
  // Police / CPS disclosure
  // ----------------------------------

  var policeRows = ''
  var cpsRows = ''

  if (hasPoliceSection) {
    if (isExhibit || isStatement) {
      // Compact block for Statements & Exhibits
      policeRows = rowsHTMLLocal(pol, [
        {
          label: 'Police disclosure status',
          get: function (obj) {
            var raw = obj && obj.status
            if ((raw == null || raw === '') && isEvidence) return 'Evidence'
            return raw
          },
          render: function (v) { return statusTagHTML('police', v) }
        },
        { key: 'rationale',   label: 'Rationale for disclosure decision' },
        { key: 'InspectedBy', label: 'Inspected by' },
        { key: 'inspectedOn', label: 'Inspected on' },
        { key: 'rebuttable',  label: 'Rebuttable' },
        // TODO: Sensitivity (not sensitive / sensitive) — not yet in data model for statements/exhibits
        { key: 'sensitivity',     label: 'Sensitivity' },
        // TODO: SensitivityRationale — not yet in data model for statements/exhibits
        { key: 'sensitivityRationale', label: 'Sensitivity rationale' },
        // TODO: Exception1Suspect and Exception1Description — currently 'exception'/'exceptionReason' are flat;
        // per-suspect exceptions need new data structure
        { key: 'exception',       label: 'Exception 1 - suspect' },
        { key: 'exceptionReason', label: 'Exception 1 - description' }
      ])
    } else {
      // Unused / Sensitive: full police block
      policeRows = rowsHTMLLocal(pol, [
        {
          key: 'status',
          label: 'Police disclosure status',
          render: function (v) { return statusTagHTML('police', v) }
        },
        { key: 'rationale',       label: 'Rationale for disclosure decision' },
        { key: 'InspectedBy',     label: 'Inspected by' },
        { key: 'inspectedOn',     label: 'Inspected on' },
        { key: 'rebuttable',      label: 'Rebuttable' },
        { key: 'sensitivity',     label: 'Sensitivity' },
        { key: 'sensitivityRationale', label: 'Sensitivity rationale' },
        { key: 'exception',       label: 'Exception 1 - suspect' },
        { key: 'exceptionReason', label: 'Exception 1 - description' }
      ])
    }
  }

  if (hasCpsSection) {
    cpsRows = rowsHTMLLocal(cps, [
      {
        key: 'status',
        label: 'Disclosure status',
        render: function (v) {
          var tag = statusTagHTML('cps', v)
          var disagree = (cps && cps.disagreesWithPolice === true)
          if (disagree) {
            tag += ' <strong class="govuk-tag govuk-tag--yellow">Disagrees with police</strong>'
          }
          return tag
        }
      },
      { key: 'rationale',          label: 'Rationale for disclosure decision' },
      // TODO: Sensitivity (CPS view) — not yet in data model
      { key: 'cpsSensitivity',     label: 'Sensitivity' },
      { key: 'SensitivityDispute', label: 'Sensitivity dispute' }
    ])
  }

  // ----------------------------------
  // Wrap meta panel
  // ----------------------------------

  var metaBar =
    '<div class="dcf-viewer__meta-bar">' +
      '<div class="dcf-meta-actions">' +
        '<div class="dcf-meta-right">' +
          '<a href="#" class="govuk-link js-meta-toggle dcf-meta-toggle" ' +
            'data-action="toggle-meta" ' +
            'aria-expanded="false" ' +
            'aria-controls="' + esc(bodyId) + '" ' +
            'data-controls="' + esc(bodyId) + '">' +
            '<span class="dcf-caret" aria-hidden="true">▸</span>' +
            '<span class="dcf-meta-linktext">Show details</span>' +
          '</a>' +
        '</div>' +
      '</div>' +
    '</div>'

  var inlineActions = buildInlineActionsMenu(meta)

  // ----------------------------------
  // Accordion helper for meta sections
  // ----------------------------------

  // Each call builds one accordion section object (expanded=false by default)
  function accordionSection (title, rows) {
    if (!rows) return null
    return (
      '<div class="govuk-accordion__section">' +
        '<div class="govuk-accordion__section-header">' +
          '<h3 class="govuk-accordion__section-heading">' +
            '<span class="govuk-accordion__section-button" id="' + esc(title.replace(/\s+/g,'-').toLowerCase()) + '-heading">' +
              esc(title) +
            '</span>' +
          '</h3>' +
        '</div>' +
        '<div class="govuk-accordion__section-content">' +
          '<dl class="govuk-summary-list govuk-!-margin-bottom-0">' + rows + '</dl>' +
        '</div>' +
      '</div>'
    )
  }

  // Build accordion sections — filter out nulls (empty sections are omitted)
  var accordionSections = [
    accordionSection('Related material',        relatedRows),
    policeRows ? accordionSection('Police disclosure status', policeRows) : null,
    cpsRows    ? accordionSection('CPS disclosure status',    cpsRows)    : null
  ].filter(Boolean).join('')

  return '' +
    '<div class="dcf-viewer__meta" data-meta-root>' +
      metaBar +
      '<div id="' + esc(bodyId) + '" class="dcf-viewer__meta-body" hidden>' +
        inlineActions +
        sectionHTMLNoHeadingLocal(materialRows) +
        (accordionSections
          ? '<div class="govuk-accordion dcf-meta-accordion" data-module="govuk-accordion" id="meta-accordion-' + esc(bodyId) + '">' +
              accordionSections +
            '</div>'
          : '') +
      '</div>' +
    '</div>'
}

  // --------------------------------------
  // Preview builder (pdf.js + chrome)
  // --------------------------------------

  function openMaterialPreview (link, opts) {
    opts = opts || {}
    var fromSearch = !!opts.fromSearch

    removeSearchStatus()

    // Pull meta for the material
    var meta = getMaterialJSONFromLink(link) || {}
    var url  = link.getAttribute('data-file-url') || link.getAttribute('href')

    if (!url && meta && meta.Material && meta.Material.myFileUrl) {
      url = meta.Material.myFileUrl
    }

    var title =
      link.getAttribute('data-title') ||
      (link.textContent || '').trim() ||
      'Selected file'

    // NEW: work out canonical ItemId from meta
    var itemId =
      (meta && (meta.ItemId ||
                (meta.Material && meta.Material.ItemId) ||
                meta.itemId)) || null

    var realCard = null

    // If we have an ItemId, try to find the real card in the left-hand list
    if (itemId) {
      try {
        realCard = document.querySelector(
          '.dcf-material-card[data-item-id="' + CSS.escape(itemId) + '"]'
        )
      } catch (e) {
        // CSS.escape might not exist in some older browsers; fall back
        realCard = document.querySelector(
          '.dcf-material-card[data-item-id="' + itemId.replace(/"/g, '\\"') + '"]'
        )
      }
    }

    // Fallback: use the card from the DOM that actually contains this link
    var closestCard = link.closest('.dcf-material-card')
    if (closestCard && !realCard && document.documentElement.contains(closestCard)) {
      realCard = closestCard
    }

    // Update viewer._currentCard + active state using the *real* card only
    if (realCard) {
      viewer._currentCard = realCard
      markCardVisited(realCard)
      setActiveCard(realCard)
    } else {
      viewer._currentCard = null
      setActiveCard(null)
    }

    // Normal viewer setup continues as before
    viewer.dataset.mode = 'document'
    viewer.dataset.fromSearch = fromSearch ? 'true' : 'false'

    if (!viewer.querySelector('#dcf-viewer-tabs')) ensureShell()

    // No JS init needed for the action menus (we use native <details>)

    // This creates/updates the tab and applies .is-active
    addOrActivateTab(meta, url, title)

    // Back-to-search visibility
    var backLink = viewer.querySelector('[data-action="back-to-search"]')
    var backSep  = viewer.querySelector('[data-role="back-to-search-sep"]')
    var canShowBackToSearch =
      (viewer.dataset.fromSearch === 'true') && !!viewer._lastSearchHTML
    if (backLink) backLink.hidden = !canShowBackToSearch
    if (backSep)  backSep.hidden  = !canShowBackToSearch

    console.log('Opening', {
      url: url,
      title: title,
      itemId: itemId
    })

    viewer.hidden = false
    try { viewer.focus({ preventScroll: true }) } catch (e) {}
  }

  // --------------------------------------
  // Helper for search navigation (Prev / Next)
  // --------------------------------------

  window.__dcfOpenMaterialFromSearch = function (hit) {
    if (!hit || !hit.href) return

    // Build a temporary, off-DOM card just so openMaterialPreview
    // can read its JSON meta in the usual way.
    var card = document.createElement('article')
    card.className = 'dcf-material-card'
    if (hit.itemId) card.setAttribute('data-item-id', hit.itemId)

    var script = document.createElement('script')
    script.type = 'application/json'
    script.className = 'js-material-data'
    try {
      script.textContent = JSON.stringify(hit.meta || {})
    } catch (e) {
      script.textContent = '{}'
    }

    var link = document.createElement('a')
    link.className = 'govuk-link dcf-viewer-link'
    link.setAttribute('href', hit.href)
    link.setAttribute('data-file-url', hit.href)
    if (hit.title) link.setAttribute('data-title', hit.title)

    card.appendChild(link)
    card.appendChild(script)

    // Let the normal preview flow run (this will create/update the tab)
    openMaterialPreview(link, { fromSearch: true })

    // EXTRA: explicitly activate the correct tab for this hit.
    // Use the same stableId logic as addOrActivateTab so we target
    // *exactly* the tab that was just created/updated.
    var id = stableId(hit.meta || {}, hit.href)
    if (id) {
      switchToTabById(id)
    }
  }

  // --------------------------------------
  // Intercepts: open previews from cards/links
  // --------------------------------------

  // Cards with explicit js-material-link (main materials list)
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest('a.js-material-link[data-file-url]')
    if (!link) return
    if (!viewer) return

    e.preventDefault()
    e.stopPropagation()

    var card = link.closest('.dcf-material-card')
    if (card) {
      viewer._currentCard = card
      markCardVisited(card)
      setActiveCard(card)
    }

    openMaterialPreview(link, { fromSearch: false })
  }, true)

  // NB: bubble-phase so material-search.js (capture) can update searchIndex first
  // Close overflow <details> when clicking outside it (bubble phase)
  document.addEventListener('click', function (e) {
    var det = viewer.querySelector('.dcf-tab-overflow')
    if (!det || !det.open) return
    var inOverflow = e.target && (
      e.target.closest('.dcf-tab-overflow')
    )
    if (!inOverflow) det.open = false
  }, false)

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest('a.dcf-viewer-link')
    if (!a) return
    if (a.getAttribute('target') === '_blank') return

    e.preventDefault()

    var fromSearch = (viewer.dataset.mode === 'search') || (viewer.dataset.fromSearch === 'true')

    openMaterialPreview(a, { fromSearch: fromSearch })
  }, false)

  // --------------------------------------
  // Viewer toolbar + meta actions
  // --------------------------------------

  viewer.addEventListener('click', function (e) {
    // --- Close button on a visible tab ---
    if (e.target && e.target.closest('.dcf-doc-tab__close')) {
      e.preventDefault()
      var btn = e.target.closest('.dcf-doc-tab')
      if (!btn) return
      var wasActive = btn.classList.contains('is-active')
      var id = btn.getAttribute('data-tab-id')

      var itemIdForClose = btn.getAttribute('data-item-id')
      if (itemIdForClose) {
        var cardForClose = document.querySelector('.dcf-material-card[data-item-id="' + CSS.escape(itemIdForClose) + '"]')
        if (cardForClose) markCardClosed(cardForClose)
      }

      if (id && _tabStore.metaById[id]) delete _tabStore.metaById[id]
      btn.parentNode && btn.parentNode.removeChild(btn)

      var anyTab = viewer.querySelector('#dcf-viewer-tabs .dcf-doc-tab')
      if (!anyTab) {
        var close = viewer.querySelector('[data-action="close-viewer"]')
        if (close) close.click()
        return
      }
      if (wasActive) {
        var last = Array.prototype.slice.call(viewer.querySelectorAll('#dcf-viewer-tabs .dcf-doc-tab')).pop()
        if (last) switchToTabById(last.getAttribute('data-tab-id'))
      }
      renderTabBar()
      return
    }

    // --- Close button inside the overflow dropdown ---
    if (e.target && e.target.closest('.dcf-tab-overflow-dropdown__item-close')) {
      e.preventDefault()
      e.stopPropagation()
      var closeId = e.target.closest('.dcf-tab-overflow-dropdown__item-close').getAttribute('data-close-tab-id')
      if (!closeId) return
      var tabToClose = viewer.querySelector('#dcf-viewer-tabs .dcf-doc-tab[data-tab-id="' + closeId + '"]')
      if (tabToClose) {
        var wasActiveInDrop = tabToClose.classList.contains('is-active')
        var itemIdDrop = tabToClose.getAttribute('data-item-id')
        if (itemIdDrop) {
          var cardDrop = document.querySelector('.dcf-material-card[data-item-id="' + CSS.escape(itemIdDrop) + '"]')
          if (cardDrop) markCardClosed(cardDrop)
        }
        if (_tabStore.metaById[closeId]) delete _tabStore.metaById[closeId]
        tabToClose.parentNode && tabToClose.parentNode.removeChild(tabToClose)
        var anyTabDrop = viewer.querySelector('#dcf-viewer-tabs .dcf-doc-tab')
        if (!anyTabDrop) {
          var closeDrop = viewer.querySelector('[data-action="close-viewer"]')
          if (closeDrop) closeDrop.click()
          return
        }
        if (wasActiveInDrop) {
          var lastDrop = Array.prototype.slice.call(viewer.querySelectorAll('#dcf-viewer-tabs .dcf-doc-tab')).pop()
          if (lastDrop) switchToTabById(lastDrop.getAttribute('data-tab-id'))
        }
      }
      renderTabBar()
      return
    }

    // --- Click a row in the overflow dropdown ---
    var dropItem = e.target && e.target.closest('.dcf-tab-overflow-dropdown__item')
    if (dropItem && !e.target.closest('.dcf-tab-overflow-dropdown__item-close')) {
      e.preventDefault()
      var dropId = dropItem.getAttribute('data-tab-id')
      if (dropId) switchToTabById(dropId)
      closeOverflowDropdown()
      renderTabBar()
      return
    }

    // --- Click on a visible tab ---
    var tabBtn = e.target && e.target.closest('#dcf-viewer-tabs .dcf-doc-tab')
    if (tabBtn && !e.target.closest('.dcf-doc-tab__close')) {
      e.preventDefault()
      var id2 = tabBtn.getAttribute('data-tab-id')
      if (id2) switchToTabById(id2)
      return
    }

    var a = e.target && e.target.closest('[data-action]')
    if (!a) return
    e.preventDefault()

    var action = a.getAttribute('data-action')

    if (action === 'close-viewer') {
      if (viewer._currentCard) {
        markCardClosed(viewer._currentCard)
      }

      viewer.innerHTML =
        '<p class="govuk-hint govuk-!-margin-bottom-3">' +
          'Select a material from the list to preview it here.' +
        '</p>'

      viewer.hidden = true
      viewer.dataset.mode = 'empty'
      viewer.dataset.fromSearch = 'false'

      if (layout) layout.classList.remove('is-full')

      document
        .querySelectorAll('.dcf-material-card--active')
        .forEach(function (el) { el.classList.remove('dcf-material-card--active') })

      return
    }

    if (action === 'toggle-full') {
      if (!layout) return

      var on = layout.classList.toggle('is-full')

      a.textContent = on ? 'Exit full width' : 'View document full width'
      a.setAttribute('aria-pressed', String(on))
      try { viewer.focus({ preventScroll: true }) } catch (e) {}

      return
    }

    if (action === 'back-to-search') {
      if (viewer._lastSearchHTML) {
        viewer._lastDocumentHTML = viewer.innerHTML

        viewer.dataset.mode = 'search'
        viewer.dataset.fromSearch = 'false'

        viewer.innerHTML = viewer._lastSearchHTML
        viewer.hidden = false

        var s = document.getElementById('search-status')
        if (s) {
          s.hidden = false
          var linkBack = s.querySelector('a[data-action="back-to-documents"]')
          var sepBack = s.querySelector('[data-role="back-to-documents-sep"]')
          if (linkBack) linkBack.hidden = false
          if (sepBack) sepBack.hidden = false
        }
      }
      return
    }

    if (action === 'toggle-meta') {
      var metaWrap = a.closest('.dcf-viewer__meta')
      var body =
        (function () {
          var id3 = a.getAttribute('aria-controls') || a.getAttribute('data-controls')
          if (!metaWrap || !id3) return null
          try { return metaWrap.querySelector('#' + CSS.escape(id3)) } catch (e) { return null }
        })() ||
        (metaWrap && metaWrap.querySelector('.dcf-viewer__meta-body'))

      if (!body) return

      var willHide = !body.hidden
      body.hidden = willHide
      a.setAttribute('aria-expanded', String(!willHide))

      var textSpan = a.querySelector('.dcf-meta-linktext')
      if (textSpan) textSpan.textContent = willHide ? 'Show details' : 'Hide details'

      var caret = a.querySelector('.dcf-caret')
      if (caret) caret.textContent = willHide ? '▸' : '▾'

      // Init the GOV.UK Accordion on first reveal — must be visible for layout to work
      if (!willHide && !body.dataset.accordionInited) {
        try {
          var accordionEl = body.querySelector('.dcf-meta-accordion[data-module="govuk-accordion"]')
          if (accordionEl && window.GOVUKFrontend && window.GOVUKFrontend.Accordion) {
            new window.GOVUKFrontend.Accordion(accordionEl, { rememberExpanded: false }).init()
            var controls = accordionEl.querySelector('.govuk-accordion__controls')
            if (controls) controls.hidden = true
            body.dataset.accordionInited = 'true'
          }
        } catch (e) {}
      }

      return
    }

    if (action === 'mark-read') {
      var card =
        (viewer && viewer._currentCard) ||
        viewer.querySelector('.dcf-material-card--active') ||
        document.querySelector('.dcf-material-card--active') ||
        null

      if (card) {
        // Business rule: marking as read removes the "New" tag (toggle off)
        setMaterialStatus(card, 'Read')   // kept for future
        setCardIsNew(card, false)
      } else {
        console.warn('mark-read: could not resolve current card')
      }

      var menu2 = a.closest('details.dcf-action-menu')
      if (menu2) {
        menu2.open = false
        updateOpsMenuForStatus(menu2, false)
      }

      return
    }

    if (action === 'mark-unread') {
      var card2 =
        (viewer && viewer._currentCard) ||
        viewer.querySelector('.dcf-material-card--active') ||
        document.querySelector('.dcf-material-card--active') ||
        null

      if (card2) {
        // Business rule: marking as unread reinstates the "New" tag (toggle on)
        setMaterialStatus(card2, 'Unread') // kept for future
        setCardIsNew(card2, true)
      } else {
        console.warn('mark-unread: could not resolve current card')
      }

      var menu3 = a.closest('details.dcf-action-menu')
      if (menu3) {
        menu3.open = false
        updateOpsMenuForStatus(menu3, true)
      }

      return
    }

    if ([
      'assess-unused',
      'assess-no-longer-relevant',
      'assess-disclosable',
      'assess-disclosable-inspect',
      'assess-not-disclosable',
      'assess-clearly-not',
      'assess-evidence',
      'dispute-sensitivity',
      'request-updated-description',
      'request-material'
    ].indexOf(action) !== -1) {

      // --- NAVIGATE to server routes for material actions ---
      var currentCard =
        (viewer && viewer._currentCard) ||
        viewer.querySelector('.dcf-material-card--active') ||
        document.querySelector('.dcf-material-card--active') ||
        null

      var itemId = currentCard && currentCard.getAttribute('data-item-id')
      if (!itemId) {
        console.warn('Material action: could not resolve itemId')
        return
      }

      // derive numeric caseId from URL: /cases/:caseId/...
      var m = (window.location.pathname || '').match(/\/cases\/(\d+)\//)
      var caseId = m && m[1] ? m[1] : null
      if (!caseId) {
        console.warn('Material action: could not resolve caseId from path')
        return
      }

      // Always return to viewer, re-opening the same item
      var returnUrl =
        '/cases/' + caseId + '/material?tab=view-materials&openItemId=' + encodeURIComponent(itemId)

      // Go through your existing resolver
      var target =
        '/cases/' + caseId + '/disclosure/actions/' + encodeURIComponent(action) +
        '?itemId=' + encodeURIComponent(itemId) +
        '&returnUrl=' + encodeURIComponent(returnUrl)

      // For demo/debugging purposes
      console.log('[Assess unused click]', { action, itemId, caseId, returnUrl, target })  

      window.location.href = target

      // ----------------------------------------------------

      var menuFromAction = a.closest('details.dcf-action-menu')
      if (menuFromAction) {
        menuFromAction.open = false
      }

      return
    }

    if (action === 'ops-icon') {
      console.log('Ops icon clicked')
      return
    }
  }, false)

  // --------------------------------------
  // "Go back to documents" (search → previous document)
  // --------------------------------------

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest('a[data-action="back-to-documents"]')
    if (!a) return

    e.preventDefault()

    if (viewer._lastDocumentHTML) {
      viewer.innerHTML = viewer._lastDocumentHTML
      viewer.hidden = false
      viewer.dataset.mode = 'document'
    } else {
      viewer.dataset.mode = 'document'
      viewer.dataset.fromSearch = 'false'

      viewer.innerHTML =
        '<p class="govuk-hint govuk-!-margin-bottom-3">' +
          'Select a material from the list to preview it here.' +
        '</p>'
      viewer.hidden = false
    }

    var s = document.getElementById('search-status')
    if (s) {
      s.hidden = true
      var link = s.querySelector('a[data-action="back-to-documents"]')
      var sep = s.querySelector('[data-role="back-to-documents-sep"]')
      if (link) link.hidden = true
      if (sep) sep.hidden = true
    }
  })

  // (No JS required for action menus now: we use <details>.)

  // --------------------------------------
  // Initial status badges
  // --------------------------------------

  ;(function initialiseMaterialStatuses () {
    var cards = document.querySelectorAll('.dcf-material-card')
    if (!cards.length) return
    cards.forEach(initCardStatus)
  })()

  // --------------------------------------
  // Meta link behaviour
  // --------------------------------------

  viewer.addEventListener('click', function (e) {
    var a = e.target && e.target.closest('a.js-doc-link')
    if (!a) return
    removeSearchStatus()
  }, true)

  // --------------------------------------
  // Deep link: openItemId=MAT-xxxxx
  // --------------------------------------s

  ;(function openFromQueryParam () {
    try {
      var params = new URLSearchParams(window.location.search || '')
      var openItemId = params.get('openItemId')
      if (!openItemId) return

      function safeEscape (value) {
        try {
          return (window.CSS && typeof CSS.escape === 'function')
            ? CSS.escape(value)
            : String(value).replace(/"/g, '\\"')
        } catch (e) {
          return String(value).replace(/"/g, '\\"')
        }
      }

      var attempts = 0
      var maxAttempts = 40 // ~2s

      function tryOpen () {
        attempts++

        var selector = '.dcf-material-card[data-item-id="' + safeEscape(openItemId) + '"]'
        var card = document.querySelector(selector)

        if (!card) {
          if (attempts < maxAttempts) return setTimeout(tryOpen, 50)
          return
        }

        // If the card is inside a collapsed GOV.UK accordion section, expand it
        try {
          var section = card.closest('.govuk-accordion__section')
          if (section) {
            var btn = section.querySelector('.govuk-accordion__section-button')
            var content = section.querySelector('.govuk-accordion__section-content')
            if (btn && content && content.hasAttribute('hidden')) {
              btn.click()
            }
          }
        } catch (e) {}

        // Find the normal material link on the card
        var link = card.querySelector('a.js-material-link[data-file-url]')
        if (!link) {
          if (attempts < maxAttempts) return setTimeout(tryOpen, 50)
          return
        }

        // Make it feel intentional
        try { card.scrollIntoView({ block: 'nearest' }) } catch (e) {}

        // ✅ Open directly (no programmatic click dependency)
        openMaterialPreview(link, { fromSearch: false })
      }

      tryOpen()
    } catch (e) {}
  })()

  window.__materialsPreviewReady = true
})()