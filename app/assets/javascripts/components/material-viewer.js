(() => {
  // Grab the viewer shell and the layout wrapper (used to toggle full-width mode).
  // Bail early if the page doesn't have the viewer.
  var viewer = document.getElementById('material-viewer')
  var layout = document.querySelector('.dcf-materials-layout')
  if (!viewer) return

  // --------------------------------------
  // Notes modal (side tray)
  // --------------------------------------

  // Cache the modal once; it lives in the page template, not inside the viewer.
  var notesModal = document.getElementById('dcf-notes-modal')
  var lastNotesTrigger = null

  function isNotesOpen () {
    return !!(notesModal && !notesModal.hidden)
  }

  // Opens the notes tray and moves focus into it.
  function openNotesModal (triggerEl) {
    if (!notesModal) return

    lastNotesTrigger = triggerEl || document.activeElement || null

    notesModal.hidden = false
    notesModal.classList.add('is-open')

    // Try to reflect the currently-active document title in the heading.
    try {
      var heading = notesModal.querySelector('#dcf-notes-modal-title')
      var activeTab = viewer.querySelector('.dcf-doc-tab.is-active')
      var tabTitle = activeTab && activeTab.getAttribute('data-title')
      if (heading) {
        var base = 'Notes'
        heading.textContent = tabTitle ? base + ' – ' + tabTitle : base
      }
    } catch (e) {}

    // Focus the textarea if present.
    var textarea = notesModal.querySelector('#dcf-note-text')
    if (textarea) {
      try { textarea.focus() } catch (e) {}
    }
  }

  // Closes the notes tray and returns focus to the thing that opened it.
  function closeNotesModal () {
    if (!notesModal || notesModal.hidden) return

    notesModal.classList.remove('is-open')
    notesModal.hidden = true

    if (lastNotesTrigger && typeof lastNotesTrigger.focus === 'function') {
      try { lastNotesTrigger.focus() } catch (e) {}
    }
  }

  // When the notes form is submitted, append a new note into the list.
  if (notesModal) {
    var notesForm = notesModal.querySelector('.dcf-notes-modal__form')
    if (notesForm) {
      notesForm.addEventListener('submit', function (e) {
        // For now we keep this entirely client-side
        e.preventDefault()

        var textarea = notesModal.querySelector('#dcf-note-text')
        if (!textarea) return

        var text = (textarea.value || '').trim()
        if (!text) return // nothing to add

        var list = notesModal.querySelector('[data-notes-list]')
        var emptyMsg = notesModal.querySelector('[data-notes-empty]')

        if (!list) return

        // Hide the "No notes..." message once we have at least one note
        if (emptyMsg) {
          emptyMsg.hidden = true
        }

        // Build the note block using your placeholder values
        var noteEl = document.createElement('article')
        noteEl.className = 'dcf-note'

        var nameEl = document.createElement('h4')
        nameEl.className = 'govuk-heading-s'
        nameEl.textContent = '[User_name]' // placeholder for now

        var dateEl = document.createElement('p')
        dateEl.className = 'govuk-body'
        dateEl.textContent = '[govukDateTime]' // placeholder – hook up govukDateTime server-side later

        var textEl = document.createElement('p')
        textEl.className = 'govuk-body'
        textEl.textContent = text

        noteEl.appendChild(nameEl)
        noteEl.appendChild(dateEl)
        noteEl.appendChild(textEl)

        // Add newest note at the top
        list.prepend(noteEl)

        // Clear the textarea + (optionally) reset char count
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

  // Global handler for anything with data-action="close-notes"
  document.addEventListener('click', function (e) {
    var closeEl = e.target && e.target.closest('[data-action="close-notes"]')
    if (!closeEl) return
    e.preventDefault()
    closeNotesModal()
  })

  // Global handler for anything with data-action="open-notes"
  document.addEventListener('click', function (e) {
    var trigger = e.target && e.target.closest('[data-action="open-notes"]')
    if (!trigger) return
    e.preventDefault()
    openNotesModal(trigger)
  })


  // Close the notes tray with Esc when it's open.
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

  // Given a clicked link inside a material card, find and
  // read the embedded JSON describing that material
  function getMaterialJSONFromLink (link) {
    var card = link.closest('.dcf-material-card')
    if (!card) return null
    var tag = card.querySelector('script.js-material-data[type="application/json"]')
    if (!tag) return null
    try { return JSON.parse(tag.textContent) } catch (e) { return null }
  }

  // Tiny HTML escaper to keep injected strings safe
  function esc (s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function buildPdfViewerUrl (rawUrl) {
    var fileUrl = toPublic(rawUrl || '')
    return '/public/pdfjs/web/viewer.html?file=' + encodeURIComponent(fileUrl)
  }

  // --- Tab state for multi-document viewing ---
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
        '<a href="#" class="govuk-link" data-action="close-viewer">Close documents</a>',
        '<span aria-hidden="true" class="govuk-!-margin-horizontal-2">&nbsp;|&nbsp;</span>',
        '<a href="#" class="govuk-link" data-action="toggle-full" aria-pressed="false">View full width</a>',
        // Only shown when document was opened from search
        '<span aria-hidden="true" class="govuk-!-margin-horizontal-2" data-role="back-to-search-sep" hidden>&nbsp;|&nbsp;</span>',
        '<a href="#" class="govuk-link" data-action="back-to-search" hidden>Back to search results</a>',
      '</div>',

      '<div id="dcf-viewer-tabs" class="dcf-viewer__tabs dcf-viewer__tabs--flush"></div>',
      '<div class="dcf-viewer__meta" data-meta-root></div>',

      // ops-bar
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
                // status actions
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
    // Build a new meta panel and swap it into [data-meta-root]
    var rawId = (meta && (meta.ItemId || (meta.Material && meta.Material.Reference))) || Date.now()
    var bodyId = 'meta-' + String(rawId).replace(/[^a-zA-Z0-9_-]/g, '-')
    var html = buildMetaPanel(meta || {}, bodyId)
    var root = viewer.querySelector('[data-meta-root]')
    if (root) {
      // Replace the whole wrapper to keep toggle JS happy
      root.outerHTML = html
    }
    // Update the toggle’s aria-controls to point at the current body id
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

    // point _currentCard to the card for this tab (so status/menu + card highlight reflect correctly)
    var itemId = tab.getAttribute('data-item-id')
    if (itemId) {
      var cardForTab = document.querySelector('.dcf-material-card[data-item-id="' + CSS.escape(itemId) + '"]')
      viewer._currentCard = cardForTab || null
      if (cardForTab) {
        setActiveCard(cardForTab)   // keep left-hand card in sync with active tab
      } else {
        setActiveCard(null)
      }
    } else {
      viewer._currentCard = null
      setActiveCard(null)
    }

    // update meta
    renderMeta(meta)

    // keep ops menu in sync
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
      // ensure latest meta stored (e.g., status changed)
      _tabStore.metaById[id] = meta || _tabStore.metaById[id] || {}
      existing.setAttribute('data-url', url || existing.getAttribute('data-url') || '')
      existing.setAttribute('data-title', title || existing.getAttribute('data-title') || 'Document')
    }
    // Activate and render
    setActiveTab(existing)
    var iframe = viewer.querySelector('.dcf-viewer__frame')
    if (iframe) iframe.setAttribute('src', buildPdfViewerUrl(url))

    renderMeta(meta)
  }

  // Just hides the search status instead of removing it
  function removeSearchStatus () {
    var s = document.getElementById('search-status')
    if (s) s.hidden = true
  }

  // Build the single visible “Document” tab in the viewer (flush styling)
  function buildDocTabs (title) {
    var safe = esc(title || 'Document')
    return (
      '<div id="dcf-viewer-tabs" class="dcf-viewer__tabs dcf-viewer__tabs--flush">' +
        '<button type="button" class="dcf-doc-tab is-active" aria-selected="true" title="' + safe + '">' +
          '<span class="dcf-doc-tab__label">' + safe + '</span>' +
          '<span class="dcf-doc-tab__close" aria-label="Close tab" role="button">×</span>' +
          '<span class="dcf-doc-tab__bar" aria-hidden="true"></span>' +
        '</button>' +
      '</div>'
    )
  }

  // Render GOV.UK summary list rows from mapping
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

  // Wrap rows in a titled GOV.UK summary list section
  function sectionHTML (title, rows) {
    if (!rows) return ''
    return (
      '<h3 class="govuk-heading-s govuk-!-margin-top-3 govuk-!-margin-bottom-1">' + esc(title) + '</h3>' +
      '<dl class="govuk-summary-list govuk-!-margin-bottom-2">' + rows + '</dl>'
    )
  }

  // Mark one card as “active” (visually selected) and clear any previous.
  // Accepts either a link inside the card OR the card element itself.
  function setActiveCard (targetEl) {
    // Clear any existing active card
    document
      .querySelectorAll('.dcf-material-card--active')
      .forEach(function (el) { el.classList.remove('dcf-material-card--active') })

    if (!targetEl) return

    var card = null

    // If we were given a descendant (e.g. a link), walk up to the card
    if (typeof targetEl.closest === 'function') {
      card = targetEl.closest('.dcf-material-card')
    }

    // Or if we were given the card directly
    if (!card && targetEl.classList && targetEl.classList.contains('dcf-material-card')) {
      card = targetEl
    }

    if (card) {
      card.classList.add('dcf-material-card--active')
    }
  }

  // Normalise file URLs so pdf.js can load them from /public
  function toPublic (u) {
    if (!u) return ''
    if (/^https?:\/\//i.test(u)) return u       // external absolute URL
    if (u.startsWith('/public/')) return u
    if (u.startsWith('/assets/')) return '/public' + u.slice('/assets'.length)
    if (u.startsWith('/files/')) return '/public' + u
    if (u.startsWith('/')) return '/public' + u
    return '/public/' + u
  }

  // --------------------------------------
  // Status helpers: New / Read / Unread
  // --------------------------------------

  // (kept for possible future use; no longer drives initial state)
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

  // Render status tags based on three bits of state:
  //   - materialStatus: "Read" or "Unread"
  //   - isNew:          true/false (all start true; becomes false once Read)
  //   - hasViewedAndClosed: true/false (set when user closes preview/tab)
  //
  // Rules:
  //   - New + not yet closed        → "New"
  //   - New + closed (not read)     → "New" + "Unread"
  //   - Not new + Unread            → "Unread"
  //   - Read                        → "Read"
  function renderStatusTags (card) {
    if (!card) return
    var badge = card.querySelector('.dcf-material-card__badge')
    if (!badge) return

    var status = (card.dataset.materialStatus || 'Unread').toLowerCase()
    var isNew = card.dataset.isNew !== 'false' // default true
    var hasViewedClosed = card.dataset.hasViewedAndClosed === 'true'

    var tags = []

    if (status === 'read') {
      // Once read, New disappears completely
      tags.push('<strong class="govuk-tag dcf-tag dcf-tag--read">Read</strong>')
    } else {
      // Unread branch
      if (isNew) {
        // Still considered "New"
        tags.push('<strong class="govuk-tag dcf-tag dcf-tag--new">New</strong>')

        // Only show Unread once user has closed the preview/tab at least once
        if (hasViewedClosed) {
          tags.push('<strong class="govuk-tag dcf-tag dcf-tag--unread">Unread</strong>')
        }
      } else {
        // Not new anymore, just unread
        tags.push('<strong class="govuk-tag dcf-tag dcf-tag--unread">Unread</strong>')
      }
    }

    if (!tags.length && badge.dataset.rawStatus) {
      badge.textContent = badge.dataset.rawStatus
    } else if (tags.length) {
      badge.innerHTML = tags.join(' ')
    }
  }

  // Initialise a card's status + flags:
  //   - status: "Read" or "Unread" (default Unread)
  //   - isNew:  all materials start life as New (true) until they are Read
  //   - hasViewedAndClosed: true once user has opened AND closed the preview/tab
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
    } catch (e) {
      // storage issues → fall back to defaults
    }

    card.dataset.materialStatus = status
    card.dataset.isNew = String(isNew)
    card.dataset.hasViewedAndClosed = hasViewedClosed ? 'true' : 'false'

    var badge = card.querySelector('.dcf-material-card__badge')
    if (badge) {
      badge.dataset.rawStatus = status
    }

    renderStatusTags(card)
  }

  // Track that the user has visited/opened this material.
  // DOES NOT affect visual tags – only closing preview/tab does that.
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

  // When the user closes the preview (or closes a tab) and the item
  // is still Unread, record that it has been viewed-and-closed at least once.
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

  // ---- helper: set material status on the card, its embedded JSON, and any global model ----
  function setMaterialStatus (card, status) {
    if (!card) return

    // Update the embedded JSON blob in the card (<script.js-material-data type="application/json">…</script>)
    var tag = card.querySelector('script.js-material-data[type="application/json"]')
    var data = null
    try { data = tag ? JSON.parse(tag.textContent) : null } catch (e) { data = null }

    if (data) {
      // normalise common shapes: either top-level materialStatus or nested under Material
      if ('materialStatus' in data) {
        data.materialStatus = status
      } else if (data.Material && typeof data.Material === 'object') {
        data.Material.materialStatus = status
      } else {
        data.materialStatus = status
      }
      try { tag.textContent = JSON.stringify(data) } catch (e) {}
    }

    // Update visible badge on the card (we keep rawStatus for fallback text-only rendering)
    var badge = card.querySelector('.dcf-material-card__badge')
    if (badge) {
      badge.dataset.rawStatus = status
    }

    // Store on the element for quick reads
    card.dataset.materialStatus = status

    // If it becomes Read, it's no longer "New"
    var statusLower = String(status).toLowerCase()
    if (statusLower === 'read') {
      card.dataset.isNew = 'false'
    }

    // If you hydrate a global model, update that too (so lists/summaries stay in sync)
    var itemId =
      (data && (data.ItemId || (data.Material && data.Material.ItemId) || data.itemId)) ||
      card.getAttribute('data-item-id')

    if (itemId && window.caseMaterials && Array.isArray(window.caseMaterials.Material)) {
      var m = window.caseMaterials.Material.find(x => (x.ItemId || x.itemId) === itemId)
      if (m) {
        // support either top-level or nested Material object shapes
        if ('materialStatus' in m) m.materialStatus = status
        else if (m.Material && typeof m.Material === 'object') m.Material.materialStatus = status
        else m.materialStatus = status
      }
    }

    // Optional: lightweight persistence across reloads for prototype use
    try {
      var caseId2 = (window.caseMaterials && window.caseMaterials.caseId) || card.getAttribute('data-case-id')
      if (itemId && caseId2) {
        localStorage.setItem('matStatus:' + caseId2 + ':' + itemId, status)
        if (statusLower === 'read') {
          localStorage.setItem('matIsNew:' + caseId2 + ':' + itemId, 'false')
        }
      }
    } catch (e) {}

    // Re-render tags with the new state
    renderStatusTags(card)
  }

  function updateOpsMenuForStatus (menuEl, status) {
    if (!menuEl) return
    var readItem = menuEl.querySelector('[data-action="mark-read"]')
    var unreadItem = menuEl.querySelector('[data-action="mark-unread"]')

    // If it's Read → show "Mark as unread", hide "Mark as read"
    // Otherwise (New/Unread/anything else) → show "Mark as read"
    var isRead = String(status).toLowerCase() === 'read'
    if (readItem) readItem.closest('li').hidden = isRead
    if (unreadItem) unreadItem.closest('li').hidden = !isRead
  }

  // --------------------------------------
  // Meta panel builder
  // --------------------------------------
  // Creates the “details” panel next to the PDF (material, related, digital, police, CPS)
  // Accepts the parsed material JSON and a stable id to hook up show/hide behaviour
  function buildMetaPanel (meta, bodyId) {
    var mat = (meta && meta.Material) || {}
    var rel = (meta && meta.RelatedMaterials) || {}
    var dig = (meta && meta.DigitalRepresentation) || {}
    var pol = (meta && meta.PoliceMaterial) || {}
    var cps = (meta && meta.CPSMaterial) || {}
    var insp = pol.Inspection || {}

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

    function sectionHTMLNoHeading (rows) {
      if (!rows) return ''
      return (
        '<dl class="govuk-summary-list govuk-!-margin-top-3 govuk-!-margin-bottom-2">' + rows + '</dl>'
      )
    }

    var materialRows = rowsHTMLLocal(mat, [
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

    var policeRows = rowsHTMLLocal(pol, [
      { key: 'DisclosureStatus',               label: 'Disclosure status' },
      { key: 'RationaleForDisclosureDecision', label: 'Rationale for disclosure decision' },
      { key: 'Rebuttable',                     label: 'Rebuttable' },
      { key: 'SensitivityRationale',           label: 'Sensitivity rationale' },
      { key: 'Description',                    label: 'Description' },
      { key: 'Exceptions',                     label: 'Exceptions', render: function (arr) {
        if (!Array.isArray(arr) || !arr.length) return '—'
        return '<ul class="govuk-list govuk-list--bullet govuk-!-margin-bottom-0">' +
               arr.map(function (x) { return '<li>' + esc(x) + '</li>' }).join('') +
               '</ul>'
      } },
      { label: 'Inspection date', get: function () { return insp.DateOfInspection } },
      { label: 'Inspected by',   get: function () { return insp.InspectedBy } }
    ])

    var cpsRows = rowsHTMLLocal(cps, [
      { key: 'DisclosureStatus',               label: 'Disclosure status' },
      { key: 'RationaleForDisclosureDecision', label: 'Rationale for disclosure decision' },
      { key: 'SensitivityDispute',             label: 'Sensitivity dispute' }
    ])

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


    var inlineActions =
      '<div class="dcf-meta-inline-actions">' +
        '<a href="#" class="govuk-button govuk-button--primary dcf-meta-secondary" data-action="reclassify">Assess as unused</a>' +
      '</div>'

    return '' +
      '<div class="dcf-viewer__meta" data-meta-root>' +
        metaBar +
        '<div id="' + esc(bodyId) + '" class="dcf-viewer__meta-body" hidden>' +
          inlineActions +
          sectionHTMLNoHeading(materialRows) +
          sectionHTMLLocal('Related materials',      relatedRows)  +
          sectionHTMLLocal('Digital representation', digitalRows)  +
          sectionHTMLLocal('Police material',        policeRows)   +
          sectionHTMLLocal('CPS material',           cpsRows)      +
        '</div>' +
      '</div>'
  }

  // --------------------------------------
  // Preview builder (pdf.js + chrome)
  // --------------------------------------
  // Accepts an optional { fromSearch } flag
  function openMaterialPreview (link, opts) {
    opts = opts || {}
    var fromSearch = !!opts.fromSearch

    // Clear / hide any search status banner when opening a doc
    removeSearchStatus()

    // Pull JSON + core attributes from the clicked link
    var meta = getMaterialJSONFromLink(link) || {}
    var url = link.getAttribute('data-file-url') || link.getAttribute('href')

    if (!url && meta && meta.Material && meta.Material.myFileUrl) {
      url = meta.Material.myFileUrl
    }

    var title = link.getAttribute('data-title') || (link.textContent || '').trim() || 'Selected file'

    // Remember the originating material card so ops menu actions can update it
    var card = link.closest('.dcf-material-card')
    if (card) {
      viewer._currentCard = card
      // Just record that it has been visited (does NOT affect New/Unread tags)
      markCardVisited(card)
      // And visually mark this card as the active one
      setActiveCard(card)
    }

    // We're now in "document" mode, and we remember whether this came from search
    viewer.dataset.mode = 'document'
    viewer.dataset.fromSearch = fromSearch ? 'true' : 'false'

    // Ensure viewer chrome exists
    if (!viewer.querySelector('#dcf-viewer-tabs')) ensureShell()

    // Update ops menu initialised state (MoJ menu relies on DOM present)
    var menu = viewer.querySelector('.moj-button-menu')
    if (menu && window.MOJFrontend && MOJFrontend.ButtonMenu) {
      try { new MOJFrontend.ButtonMenu({ container: menu }).init() } catch (e) {}
    }

    // Add or activate tab for this document
    addOrActivateTab(meta, url, title)

    // Show/hide "Go back to search results" depending on origin + stored search
    var backLink = viewer.querySelector('[data-action="back-to-search"]')
    var backSep = viewer.querySelector('[data-role="back-to-search-sep"]')
    var canShowBackToSearch = (viewer.dataset.fromSearch === 'true') && !!viewer._lastSearchHTML
    if (backLink) backLink.hidden = !canShowBackToSearch
    if (backSep) backSep.hidden = !canShowBackToSearch

    console.log('Opening', { url, title, itemId: meta && meta.ItemId })

    // Focus viewer for keyboard users
    viewer.hidden = false
    try { viewer.focus({ preventScroll: true }) } catch (e) {}
  }

  // --------------------------------------
  // Intercepts: open previews from cards/links
  // --------------------------------------

  // Capture clicks on any .js-material-link[data-file-url] and render in the viewer
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a.js-material-link[data-file-url]')
    if (!link) return
    if (!viewer) return

    e.preventDefault()
    e.stopPropagation()

    var card = link.closest('.dcf-material-card')
    if (card) {
      viewer._currentCard = card
      markCardVisited(card)
      setActiveCard(card) // highlight this card when opened from the list
    }

    // Cards on the left are "normal documents" (not from search)
    openMaterialPreview(link, { fromSearch: false })
  }, true)

  // Allow opening materials from elsewhere (e.g. injected search results) via .dcf-viewer-link
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest('a.dcf-viewer-link')
    if (!a) return
    if (a.getAttribute('target') === '_blank') return   // respect explicit new-tab links

    e.preventDefault()
    e.stopPropagation()

    // If the viewer is currently in search mode, this doc is "from search"
    var fromSearch = (viewer.dataset.mode === 'search')
    openMaterialPreview(a, { fromSearch: fromSearch })
  }, true)

  // --------------------------------------
  // Viewer toolbar + meta actions
  // --------------------------------------
  viewer.addEventListener('click', function (e) {
    // Close just the clicked tab (not the whole viewer)
    if (e.target && e.target.closest('.dcf-doc-tab__close')) {
      e.preventDefault()
      var btn = e.target.closest('.dcf-doc-tab')
      if (!btn) return
      var wasActive = btn.classList.contains('is-active')
      var id = btn.getAttribute('data-tab-id')

      // Mark underlying card as viewed-and-closed
      var itemIdForClose = btn.getAttribute('data-item-id')
      if (itemIdForClose) {
        var cardForClose = document.querySelector('.dcf-material-card[data-item-id="' + CSS.escape(itemIdForClose) + '"]')
        if (cardForClose) markCardClosed(cardForClose)
      }

      if (id && _tabStore.metaById[id]) delete _tabStore.metaById[id]
      btn.parentNode && btn.parentNode.removeChild(btn)
      // If no tabs remain, close the viewer
      var anyTab = viewer.querySelector('#dcf-viewer-tabs .dcf-doc-tab')
      if (!anyTab) {
        var close = viewer.querySelector('[data-action="close-viewer"]')
        if (close) close.click()
        return
      }
      // If we removed the active tab, switch to the last tab
      if (wasActive) {
        var last = Array.prototype.slice.call(viewer.querySelectorAll('#dcf-viewer-tabs .dcf-doc-tab')).pop()
        if (last) {
          switchToTabById(last.getAttribute('data-tab-id'))
        }
      }
      return
    }

    // Activate a tab when its button is clicked (excluding the close icon)
    var tabBtn = e.target.closest('#dcf-viewer-tabs .dcf-doc-tab')
    if (tabBtn && !e.target.closest('.dcf-doc-tab__close')) {
      e.preventDefault()
      var id = tabBtn.getAttribute('data-tab-id')
      if (id) {
        switchToTabById(id)
      }
      return
    }

    var a = e.target.closest('a[data-action]')
    if (!a) return
    e.preventDefault()

    var action = a.getAttribute('data-action')

    // Close the whole viewer and reset layout
    if (action === 'close-viewer') {
      // Mark whatever card is currently active as viewed-and-closed
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

      // Reset the split/full layout
      if (layout) layout.classList.remove('is-full')

      document
        .querySelectorAll('.dcf-material-card--active')
        .forEach(function (el) { el.classList.remove('dcf-material-card--active') })

      return
    }

    // Toggle the surrounding layout between split view and full-width
    if (action === 'toggle-full') {
      if (!layout) return

      var on = layout.classList.toggle('is-full')

      a.textContent = on ? 'Exit full width' : 'View full width'
      a.setAttribute('aria-pressed', String(on))
      try { viewer.focus({ preventScroll: true }) } catch (e) {}

      return
    }

    // Toolbar "Go back to search results" – restore last search into viewer
    if (action === 'back-to-search') {
      // Only do anything if we have stored search HTML (set by material-search.js)
      if (viewer._lastSearchHTML) {
        // *** CHANGED: remember the current document view so we can come back to it
        viewer._lastDocumentHTML = viewer.innerHTML

        viewer.dataset.mode = 'search'
        viewer.dataset.fromSearch = 'false'

        // Restore the search results fragment exactly as it was
        viewer.innerHTML = viewer._lastSearchHTML
        viewer.hidden = false

        // Re-show the search status banner and reveal "Back to documents"
        var s = document.getElementById('search-status')
        if (s) {
          s.hidden = false
          var link = s.querySelector('a[data-action="back-to-documents"]')
          var sep = s.querySelector('[data-role="back-to-documents-sep"]')
          if (link) link.hidden = false
          if (sep) sep.hidden = false
        }
      }
      return
    }


    // Show/hide the meta details panel (robust to id drift)
    if (action === 'toggle-meta') {
      var metaWrap = a.closest('.dcf-viewer__meta')
      var body =
        (function () {
          var id = a.getAttribute('aria-controls') || a.getAttribute('data-controls')
          if (!metaWrap || !id) return null
          try { return metaWrap.querySelector('#' + CSS.escape(id)) } catch (e) { return null }
        })() ||
        (metaWrap && metaWrap.querySelector('.dcf-viewer__meta-body'))

      if (!body) return

      // Toggle using the DOM state and keep the control’s text/aria in sync
      var willHide = !body.hidden // visible -> hide; hidden -> show
      body.hidden = willHide
      a.setAttribute('aria-expanded', String(!willHide))

      // Update only the inner text span (avoid nuking the caret span)
      var textSpan = a.querySelector('.dcf-meta-linktext')
      if (textSpan) textSpan.textContent = willHide ? 'Show details' : 'Hide details'

      // Flip the caret glyph
      var caret = a.querySelector('.dcf-caret')
      if (caret) caret.textContent = willHide ? '▸' : '▾'

      return
    }

    // “Mark as read” from the Document actions menu
    if (action === 'mark-read') {
      // find the card that opened the viewer (preferred), or fall back to the active card
      var card =
        (viewer && viewer._currentCard) ||
        viewer.querySelector('.dcf-material-card--active') ||
        document.querySelector('.dcf-material-card--active') ||
        null

      if (card) {
        setMaterialStatus(card, 'Read')
        updateOpsMenuForStatus(null, 'Read') // first call is harmless (menu resolved below)
      } else {
        console.warn('mark-read: could not resolve current card')
      }

      // close the MoJ menu politely and return focus to the toggle
      var menu2 = a.closest('.moj-button-menu')
      if (menu2) {
        var wrapper = menu2.querySelector('.moj-button-menu__wrapper')
        var toggle = menu2.querySelector('.moj-button-menu__toggle')
        if (wrapper) wrapper.hidden = true
        if (toggle) toggle.setAttribute('aria-expanded', 'false')
        if (toggle) toggle.focus()
        // Now that we have a concrete menu element, sync its items
        updateOpsMenuForStatus(menu2, 'Read')
      }

      return
    }

    // “Mark as unread” from the Document actions menu
    if (action === 'mark-unread') {
      var card2 =
        (viewer && viewer._currentCard) ||
        viewer.querySelector('.dcf-material-card--active') ||
        document.querySelector('.dcf-material-card--active') ||
        null

      if (card2) {
        // New behaviour: mark as Unread but do NOT reintroduce "New"
        setMaterialStatus(card2, 'Unread')
      } else {
        console.warn('mark-unread: could not resolve current card')
      }

      // Close the menu + return focus to the toggle
      var menu3 = a.closest('.moj-button-menu')
      if (menu3) {
        var wrapper2 = menu3.querySelector('.moj-button-menu__wrapper')
        var toggle2 = menu3.querySelector('.moj-button-menu__toggle')
        if (wrapper2) wrapper2.hidden = true
        if (toggle2) toggle2.setAttribute('aria-expanded', 'false')
        if (toggle2) toggle2.focus()
        // Reflect the new status in which menu item is visible
        updateOpsMenuForStatus(menu3, 'Unread')
      }

      return
    }

    // Placeholder for future behaviour
    if (action === 'reclassify') {
      console.log('Reclassify clicked')
      return
    }

    // Placeholder for future behaviour (duplicate kept as in original)
    if (action === 'reclassify') {
      console.log('Reclassify clicked')
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

    // *** CHANGED: restore the last document viewer HTML if we have it
    if (viewer._lastDocumentHTML) {
      viewer.innerHTML = viewer._lastDocumentHTML
      viewer.hidden = false
      viewer.dataset.mode = 'document'
    } else {
      // Fallback: original hint if no stored document view
      viewer.dataset.mode = 'document'
      viewer.dataset.fromSearch = 'false'

      viewer.innerHTML =
        '<p class="govuk-hint govuk-!-margin-bottom-3">' +
          'Select a material from the list to preview it here.' +
        '</p>'
      viewer.hidden = false
    }

    // Hide the search status and the inline link + separator
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
    var toggle = e.target.closest('.moj-button-menu__toggle')
    if (!toggle) return
    e.preventDefault()
    var menu = toggle.closest('.moj-button-menu')
    var wrapper = menu && menu.querySelector('.moj-button-menu__wrapper')
    if (!wrapper) return
    var expanded = toggle.getAttribute('aria-expanded') === 'true'
    toggle.setAttribute('aria-expanded', String(!expanded))
    wrapper.hidden = expanded
  })

  // Click-away to close the menu if open
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
  // Initial status badges on material cards
  // --------------------------------------
  ;(function initialiseMaterialStatuses () {
    var cards = document.querySelectorAll('.dcf-material-card')
    if (!cards.length) return
    cards.forEach(initCardStatus)
  })()

  // --------------------------------------
  // Meta link behaviour
  // --------------------------------------
  // If user clicks a document link *inside* the meta (opens a new tab),
  // we don’t block navigation — we just clear the search status banner
  viewer.addEventListener('click', function (e) {
    var a = e.target && e.target.closest('a.js-doc-link')
    if (!a) return
    removeSearchStatus()
  }, true)

  // Sanity flag for debugging / feature detection
  window.__materialsPreviewReady = true
})()
