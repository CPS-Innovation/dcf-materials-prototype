// public/javascripts/components/material-viewer.js
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
    var card = link.closest('.dcf-material-card')
    if (!card) return null
    var tag = card.querySelector('script.js-material-data[type="application/json"]')
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
        '<a href="#" class="govuk-link" data-action="close-viewer">Close documents</a>',
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
          '<div class="moj-button-menu" data-module="moj-button-menu">',
            '<button type="button" class="govuk-button govuk-button--inverse moj-button-menu__toggle" aria-haspopup="true" aria-expanded="false">',
              'Document actions <span class="moj-button-menu__icon" aria-hidden="true">▾</span>',
            '</button>',
            '<div class="moj-button-menu__wrapper" hidden>',
              '<ul class="moj-button-menu__list" role="menu">',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link">Log an under or over redaction</a></li>',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link">View redaction log history</a></li>',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link">Turn on potential redactions</a></li>',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link">Rotate pages</a></li>',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link">Discard pages</a></li>',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link" data-action="mark-read">Mark as read</a></li>',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link" data-action="mark-unread">Mark as unread</a></li>',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link">Rename</a></li>',
                '<li class="moj-button-menu__item" role="none"><a role="menuitem" href="#" class="moj-button-menu__link">Delete page</a></li>',
              '</ul>',
            '</div>',
          '</div>',
        '</div>',
      '</div>',

      '<iframe class="dcf-viewer__frame" src="" title="Preview" loading="lazy" referrerpolicy="no-referrer"></iframe>'
    ].join('')

    viewer.hidden = false
    viewer.setAttribute('tabindex', '-1')
    viewer.dataset.mode = 'document'

    return viewer.querySelector('#dcf-viewer-tabs')
  }

  function setActiveTab (tabEl) {
    var tabs = viewer.querySelectorAll('#dcf-viewer-tabs .dcf-doc-tab')
    Array.prototype.forEach.call(tabs, function (btn) {
      btn.classList.toggle('is-active', btn === tabEl)
      btn.setAttribute('aria-selected', String(btn === tabEl))
      btn.setAttribute('tabindex', btn === tabEl ? '0' : '-1')
    })
  }

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

    var menuEl = viewer.querySelector('.moj-button-menu')
    var status = (viewer._currentCard && viewer._currentCard.dataset.materialStatus) || null
    updateOpsMenuForStatus(menuEl, status)

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
      btn.setAttribute('data-item-id', (meta && meta.ItemId) || '')
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

    var status = (card.dataset.materialStatus || 'Unread').toLowerCase()
    var isNew = card.dataset.isNew !== 'false'
    var hasViewedClosed = card.dataset.hasViewedAndClosed === 'true'

    var tags = []

    if (status === 'read') {
      tags.push('<strong class="govuk-tag dcf-tag dcf-tag--read">Read</strong>')
    } else {
      if (isNew) {
        tags.push('<strong class="govuk-tag dcf-tag dcf-tag--new">New</strong>')

        if (hasViewedClosed) {
          tags.push('<strong class="govuk-tag dcf-tag dcf-tag--unread">Unread</strong>')
        }
      } else {
        tags.push('<strong class="govuk-tag dcf-tag dcf-tag--unread">Unread</strong>')
      }
    }

    if (!tags.length && badge.dataset.rawStatus) {
      badge.textContent = badge.dataset.rawStatus
    } else if (tags.length) {
      badge.innerHTML = tags.join(' ')
    }
  }

  function initCardStatus (card) {
    if (!card) return

    var status = 'Unread'
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

    var badge = card.querySelector('.dcf-material-card__badge')
    if (badge) {
      badge.dataset.rawStatus = status
    }

    card.dataset.materialStatus = status

    var statusLower = String(status).toLowerCase()
    if (statusLower === 'read') {
      card.dataset.isNew = 'false'
    }

    var itemId =
      (data && (data.ItemId || (data.Material && data.Material.ItemId) || data.itemId)) ||
      card.getAttribute('data-item-id')

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
        if (statusLower === 'read') {
          localStorage.setItem('matIsNew:' + caseId2 + ':' + itemId, 'false')
        }
      }
    } catch (e) {}

    renderStatusTags(card)
  }

  function updateOpsMenuForStatus (menuEl, status) {
    if (!menuEl) return
    var readItem = menuEl.querySelector('[data-action="mark-read"]')
    var unreadItem = menuEl.querySelector('[data-action="mark-unread"]')
    var isRead = String(status).toLowerCase() === 'read'
    if (readItem) readItem.closest('li').hidden = isRead
    if (unreadItem) unreadItem.closest('li').hidden = !isRead
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
      'assess-unused'
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
    } else if (type === 'unused non-sensitive' || type === 'sensitive') {
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
        '<li class="moj-button-menu__item" role="none">' +
          '<a href="#" role="menuitem" class="moj-button-menu__link" data-action="' + esc(a.id) + '">' +
            esc(a.label) +
          '</a>' +
        '</li>'
      )
    }).join('')

    return (
      '<div class="dcf-meta-inline-actions">' +
        '<div class="moj-button-menu" data-module="moj-button-menu">' +
          '<button type="button" class="govuk-button govuk-button--secondary moj-button-menu__toggle" aria-haspopup="true" aria-expanded="false">' +
            'Material actions <span class="moj-button-menu__icon" aria-hidden="true">▾</span>' +
          '</button>' +
          '<div class="moj-button-menu__wrapper" hidden>' +
            '<ul class="moj-button-menu__list" role="menu">' +
              itemsHTML +
            '</ul>' +
          '</div>' +
        '</div>' +
      '</div>'
    )
  }

  // --------------------------------------
  // Meta panel builder
  // --------------------------------------

    function buildMetaPanel (meta, bodyId) {
    // Meta may either be a flat material object, or { Material: { ... } }
    var mat = (meta && meta.Material) || meta || {}

    // Related / digital structures (as before)
    var rel = (meta && meta.RelatedMaterials) || {}
    var dig = (meta && meta.DigitalRepresentation) || {}

    // Detect type – prefer mat.Type but fall back to meta.Type
    var rawType = mat.Type || (meta && meta.Type) || ''
    var typeNorm = String(rawType).toLowerCase().trim()
    var isUnusedOrSensitive = (typeNorm === 'unused non-sensitive' || typeNorm === 'sensitive')

    // Disclosure objects ONLY exist on Unused non-sensitive / Sensitive
    var pol = (mat && mat.policeDisclosure) ||
              (meta && meta.policeDisclosure) ||
              {}
    var cps = (mat && mat.cpsDisclosure) ||
              (meta && meta.cpsDisclosure) ||
              {}

    // Helper: render a status value as a GOV.UK tag
    function statusTagHTML (kind, value) {
      var text = (value == null ? '' : String(value)).trim()
      if (!text) return '—'

      var cls = 'govuk-tag'
      var lower = text.toLowerCase()

      if (kind === 'police') {
        // disclosureStatuses.police
        if (lower === 'passes disclosure test') {
          cls += ' govuk-tag--green'
        } else if (lower === 'does not pass disclosure test') {
          cls += ' govuk-tag--yellow'
        }
      } else if (kind === 'cps') {
        // disclosureStatuses.cps
        if (lower === 'to be assessed') {
          cls += ' govuk-tag--grey'
        } else if (lower === 'disclosable') {
          // "light blue" – turquoise is the lighter govuk tag
          cls += ' govuk-tag--turquoise'
        } else if (lower === 'disclosable by inspection') {
          cls += ' govuk-tag--purple'
        } else if (lower === 'not disclosable') {
          cls += ' govuk-tag--orange'
        } else if (lower === 'clearly not disclosable') {
          cls += ' govuk-tag--red'
        } else if (lower === 'evidence') {
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

    // ...rest of your buildMetaPanel exactly as you already have it...


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

    if (isUnusedOrSensitive) {
      // Desired layout for Unused non-sensitive / Sensitive
      materialRows = rowsHTMLLocal(mat, [
        { key: 'Reference',              label: 'Reference' },
        { key: 'Title',                  label: 'Title' },
        { key: 'MaterialClassification', label: 'Classification' },
        { key: 'Description',            label: 'Description' },
        { key: 'PeriodFrom',             label: 'Period from' },
        { key: 'ProducedbyWitnessId',    label: 'Produced by witness' }
      ])
    } else {
      // Default layout (Statements, Exhibits, etc)
      materialRows = rowsHTMLLocal(mat, [
        { key: 'Title',                  label: 'Title' },
        { key: 'Reference',              label: 'Reference' },
        { key: 'ProducedbyWitnessId',    label: 'Produced by (witness id)' },
        { key: 'MaterialClassification', label: 'Material classification' },
        { key: 'MaterialType',           label: 'Material type' },
        { key: 'SentExternally',         label: 'Sent externally' },
        { key: 'RelatedParticipantId',   label: 'Related participant id' },
        { key: 'Incident',               label: 'Incident' },
        { key: 'Location',               label: 'Location' },
        { key: 'PeriodFrom',             label: 'Period from' },
        { key: 'PeriodTo',               label: 'Period to' }
      ])
    }

    // ----------------------------------
    // Related + digital (unchanged)
    // ----------------------------------

    var relatedRows = rowsHTMLLocal(rel, [
      { key: 'RelatesToItem',    label: 'Relates to item' },
      { key: 'RelatedItemId',    label: 'Related item id' },
      { key: 'RelationshipType', label: 'Relationship type' }
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
    // Police / CPS disclosure (new model)
    // ----------------------------------

    var policeRows = ''
    var cpsRows = ''

    if (isUnusedOrSensitive) {
      policeRows = rowsHTMLLocal(pol, [
        {
          key: 'status',
          label: 'Police disclosure status',
          render: function (v) { return statusTagHTML('police', v) }
        },
        { key: 'rationale',       label: 'Disclosure rationale' },
        { key: 'rebuttable',      label: 'Rebuttable' },
        { key: 'exception',       label: 'Exception' },
        { key: 'exceptionReason', label: 'Exception reason' },
        { key: 'InspectedBy',     label: 'Inspected by' },
        { key: 'inspectedOn',     label: 'Inspected on' }
      ])

      cpsRows = rowsHTMLLocal(cps, [
        {
          key: 'status',
          label: 'Disclosure status',
          render: function (v) { return statusTagHTML('cps', v) }
        },
        { key: 'rationale',          label: 'Disclosure rationale' },
        { key: 'SensitivityDispute', label: 'Sensitivity dispute' }
      ])
    }


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

    return '' +
      '<div class="dcf-viewer__meta" data-meta-root>' +
        metaBar +
        '<div id="' + esc(bodyId) + '" class="dcf-viewer__meta-body" hidden>' +
          inlineActions +
          sectionHTMLNoHeadingLocal(materialRows) +
          sectionHTMLLocal('Related materials',      relatedRows)  +
          sectionHTMLLocal('Digital representation', digitalRows)  +
          (policeRows ? sectionHTMLLocal('Police disclosure status', policeRows) : '') +
          (cpsRows    ? sectionHTMLLocal('CPS disclosure status',    cpsRows)    : '') +
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

    var meta = getMaterialJSONFromLink(link) || {}
    var url = link.getAttribute('data-file-url') || link.getAttribute('href')

    if (!url && meta && meta.Material && meta.Material.myFileUrl) {
      url = meta.Material.myFileUrl
    }

    var title = link.getAttribute('data-title') || (link.textContent || '').trim() || 'Selected file'

    var card = link.closest('.dcf-material-card')
    if (card) {
      viewer._currentCard = card
      markCardVisited(card)
      setActiveCard(card)
    }

    viewer.dataset.mode = 'document'
    viewer.dataset.fromSearch = fromSearch ? 'true' : 'false'

    if (!viewer.querySelector('#dcf-viewer-tabs')) ensureShell()

    var menu = viewer.querySelector('.moj-button-menu')
    if (menu && window.MOJFrontend && MOJFrontend.ButtonMenu) {
      try { new MOJFrontend.ButtonMenu({ container: menu }).init() } catch (e) {}
    }

    addOrActivateTab(meta, url, title)

    var backLink = viewer.querySelector('[data-action="back-to-search"]')
    var backSep = viewer.querySelector('[data-role="back-to-search-sep"]')
    var canShowBackToSearch = (viewer.dataset.fromSearch === 'true') && !!viewer._lastSearchHTML
    if (backLink) backLink.hidden = !canShowBackToSearch
    if (backSep) backSep.hidden = !canShowBackToSearch

    console.log('Opening', { url: url, title: title, itemId: meta && meta.ItemId })

    viewer.hidden = false
    try { viewer.focus({ preventScroll: true }) } catch (e) {}
  }

  // --------------------------------------
  // Helper for search navigation (Prev / Next)
  // --------------------------------------

  window.__dcfOpenMaterialFromSearch = function (hit) {
    if (!hit || !hit.href) return

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

    openMaterialPreview(link, { fromSearch: true })
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
        if (last) {
          switchToTabById(last.getAttribute('data-tab-id'))
        }
      }
      return
    }

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

      return
    }

    if (action === 'mark-read') {
      var card =
        (viewer && viewer._currentCard) ||
        viewer.querySelector('.dcf-material-card--active') ||
        document.querySelector('.dcf-material-card--active') ||
        null

      if (card) {
        setMaterialStatus(card, 'Read')
        updateOpsMenuForStatus(null, 'Read')
      } else {
        console.warn('mark-read: could not resolve current card')
      }

      var menu2 = a.closest('.moj-button-menu')
      if (menu2) {
        var wrapper = menu2.querySelector('.moj-button-menu__wrapper')
        var toggle = menu2.querySelector('.moj-button-menu__toggle')
        if (wrapper) wrapper.hidden = true
        if (toggle) toggle.setAttribute('aria-expanded', 'false')
        if (toggle) toggle.focus()
        updateOpsMenuForStatus(menu2, 'Read')
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
        setMaterialStatus(card2, 'Unread')
      } else {
        console.warn('mark-unread: could not resolve current card')
      }

      var menu3 = a.closest('.moj-button-menu')
      if (menu3) {
        var wrapper2 = menu3.querySelector('.moj-button-menu__wrapper')
        var toggle2 = menu3.querySelector('.moj-button-menu__toggle')
        if (wrapper2) wrapper2.hidden = true
        if (toggle2) toggle2.setAttribute('aria-expanded', 'false')
        if (toggle2) toggle2.focus()
        updateOpsMenuForStatus(menu3, 'Unread')
      }

      return
    }

    if ([
      'assess-unused',
      'assess-disclosable',
      'assess-disclosable-inspect',
      'assess-not-disclosable',
      'assess-clearly-not',
      'assess-evidence',
      'dispute-sensitivity',
      'request-updated-description',
      'request-material'
    ].indexOf(action) !== -1) {

      var currentCard =
        (viewer && viewer._currentCard) ||
        viewer.querySelector('.dcf-material-card--active') ||
        document.querySelector('.dcf-material-card--active') ||
        null

      console.log('Material action:', action, 'on card:', currentCard)

      var menuFromAction = a.closest('.moj-button-menu')
      if (menuFromAction) {
        var wrapperInline = menuFromAction.querySelector('.moj-button-menu__wrapper')
        var toggleInline  = menuFromAction.querySelector('.moj-button-menu__toggle')
        if (wrapperInline && toggleInline) {
          wrapperInline.hidden = true
          toggleInline.setAttribute('aria-expanded', 'false')
          toggleInline.focus()
        }
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

  // --------------------------------------
  // Ops menu (MoJ button menu) open/close
  // --------------------------------------

  viewer.addEventListener('click', function (e) {
    var toggle = e.target && e.target.closest('.moj-button-menu__toggle')
    if (!toggle) return
    e.preventDefault()
    var menu = toggle.closest('.moj-button-menu')
    var wrapper = menu && menu.querySelector('.moj-button-menu__wrapper')
    if (!wrapper) return
    var expanded = toggle.getAttribute('aria-expanded') === 'true'
    toggle.setAttribute('aria-expanded', String(!expanded))
    wrapper.hidden = expanded
  })

  document.addEventListener('click', function (evt) {
    if (!viewer) return
    var openToggle = viewer.querySelector('.moj-button-menu__toggle[aria-expanded="true"]')
    if (!openToggle) return
    if (!evt.target.closest('.moj-button-menu')) {
      openToggle.setAttribute('aria-expanded', 'false')
      var wrap = openToggle.closest('.moj-button-menu').querySelector('.moj-button-menu__wrapper')
      if (wrap) wrap.hidden = true
    }
  })

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

  window.__materialsPreviewReady = true
})()
