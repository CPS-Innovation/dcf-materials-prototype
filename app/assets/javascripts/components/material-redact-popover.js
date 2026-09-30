// app/assets/javascripts/components/material-redact-popover.js
(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  ready(function () {
    var viewer = document.getElementById('material-viewer')
    var popover = document.getElementById('dcf-material-redact-popover')
    var footer = document.getElementById('dcf-material-redact-footer')
    if (!viewer || !popover || !footer) return

    var tagSelect = document.getElementById('material-popover-tag-select')
    var noteGroup = document.getElementById('material-popover-note-group')
    var redactButton = document.getElementById('material-popover-redact-button')
    var findMatchingButton = document.getElementById('material-popover-find-matching-button')
    var cancelLink = document.getElementById('material-popover-cancel-link')
    var removeAllLink = document.getElementById('dcf-material-redact-remove-all')
    var countEl = document.getElementById('dcf-material-redact-count')

    var iframe = null
    var currentItemId = null
    var redactionCount = 0
    var pendingRange = null // cloned Range from the iframe, captured on mouseup

    // ------------------------------------------------------------------
    // Same idea as material-redact-review.js's waitForPdfApp — the
    // iframe's own `load` event fires once its HTML shell is ready, not
    // once PDF.js has actually parsed and rendered the document's text
    // layer, so selection can't be trusted until PDFViewerApplication has
    // a document loaded.
    // ------------------------------------------------------------------
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

    function activeTabItemId () {
      var activeTab = viewer.querySelector('.dcf-doc-tab.is-active')
      return activeTab ? activeTab.getAttribute('data-item-id') : null
    }

    // A fresh document (a different tab, or the same tab reloaded) has no
    // redactions yet by definition — any overlays drawn on the previous
    // document were already discarded when the iframe navigated away from
    // it. Only redacting one document/tab at a time (see material-redact.js)
    // means there's no state to carry across documents here.
    function resetForNewDocument () {
      redactionCount = 0
      currentItemId = activeTabItemId()
      hideFooter()
      closePopover()
    }

    // The mark's appearance lives in the iframe's own document (a
    // parent-page stylesheet can't reach into it) — same approach
    // material-redact-review.js uses for its highlight styling. Position/
    // size are set inline per mark since those are per-selection, not
    // shared appearance.
    function injectRedactionMarkStyle (iframeDoc) {
      if (iframeDoc.getElementById('dcf-material-redaction-style')) return
      var el = iframeDoc.createElement('style')
      el.id = 'dcf-material-redaction-style'
      el.textContent = '.dcf-material-redaction-mark { position: absolute; background: #0b0c0c; pointer-events: none; z-index: 100; }'
      iframeDoc.head.appendChild(el)
    }

    function onIframeLoad () {
      try {
        waitForPdfApp(iframe.contentWindow, function () {
          resetForNewDocument()
          try {
            injectRedactionMarkStyle(iframe.contentDocument)
            iframe.contentDocument.addEventListener('mouseup', onIframeMouseUp)
          } catch (e) {}
        })
      } catch (e) {}
    }

    // ------------------------------------------------------------------
    // Popover positioning — same approach as the factual summary's
    // redact-popover.js, except the anchor rect comes from inside the
    // iframe and has to be translated into the parent document's
    // coordinate space first (the popover itself lives in the parent
    // page, not inside the iframe, so it can float above the toolbar/tab
    // bar rather than being clipped to the iframe's own viewport).
    // ------------------------------------------------------------------

    function isPopoverOpen () {
      return !!(popover && !popover.hidden)
    }

    var currentAnchorRect = null

    function positionPopoverAt (anchorRect) {
      var popoverRect = popover.getBoundingClientRect()
      var viewportWidth = document.documentElement.clientWidth
      var viewportHeight = document.documentElement.clientHeight
      var margin = 8
      var arrowGap = 12
      var anchorCenterX = (anchorRect.left + anchorRect.right) / 2

      var left = anchorCenterX - popoverRect.width / 2
      if (left < margin) left = margin
      if (left + popoverRect.width > viewportWidth - margin) {
        left = viewportWidth - margin - popoverRect.width
      }

      var arrowMargin = 16
      var arrowLeft = anchorCenterX - left
      if (arrowLeft < arrowMargin) arrowLeft = arrowMargin
      if (arrowLeft > popoverRect.width - arrowMargin) arrowLeft = popoverRect.width - arrowMargin
      popover.style.setProperty('--dcf-arrow-left', Math.round(arrowLeft) + 'px')

      var top
      var roomAbove = anchorRect.top - arrowGap
      var roomBelow = viewportHeight - anchorRect.bottom - arrowGap

      popover.classList.remove('dcf-redact-popover--below')

      if (roomAbove >= popoverRect.height) {
        top = anchorRect.top - popoverRect.height - arrowGap
      } else if (roomBelow >= popoverRect.height) {
        top = anchorRect.bottom + arrowGap
        popover.classList.add('dcf-redact-popover--below')
      } else if (roomAbove >= roomBelow) {
        top = Math.max(margin, anchorRect.top - popoverRect.height - arrowGap)
      } else {
        top = anchorRect.bottom + arrowGap
        popover.classList.add('dcf-redact-popover--below')
        if (top + popoverRect.height > viewportHeight - margin) {
          top = viewportHeight - margin - popoverRect.height
        }
      }

      popover.style.left = Math.round(left + window.scrollX) + 'px'
      popover.style.top = Math.round(top + window.scrollY) + 'px'
    }

    function updateButtonStates () {
      var hasTag = !!(tagSelect && tagSelect.value)
      if (redactButton) redactButton.disabled = !hasTag
      if (findMatchingButton) findMatchingButton.disabled = !hasTag
    }

    function updateNoteVisibility () {
      if (noteGroup) noteGroup.hidden = !(tagSelect && tagSelect.value === 'other')
    }

    function openPopoverAt (anchorRect) {
      currentAnchorRect = anchorRect
      popover.hidden = false
      popover.classList.add('is-open')
      if (tagSelect) tagSelect.value = ''
      updateNoteVisibility()
      updateButtonStates()
      positionPopoverAt(anchorRect)

      try { tagSelect.focus() } catch (e) {}
    }

    function closePopover () {
      if (!isPopoverOpen()) return
      popover.classList.remove('is-open')
      popover.hidden = true
      pendingRange = null
    }

    if (tagSelect) {
      tagSelect.addEventListener('change', function () {
        updateButtonStates()
        updateNoteVisibility()
        if (currentAnchorRect) positionPopoverAt(currentAnchorRect)
      })
    }

    if (cancelLink) {
      cancelLink.addEventListener('click', function (e) {
        e.preventDefault()
        closePopover()
      })
    }

    document.addEventListener('click', function (e) {
      if (!isPopoverOpen()) return
      if (popover.contains(e.target)) return
      closePopover()
    })

    document.addEventListener('keydown', function (e) {
      if (!isPopoverOpen()) return
      if (e.key === 'Escape' || e.key === 'Esc') closePopover()
    })

    // ------------------------------------------------------------------
    // Selection capture inside the iframe
    // ------------------------------------------------------------------

    function onIframeMouseUp () {
      var sel = iframe.contentWindow.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return

      var text = sel.toString()
      if (!text.trim()) return

      var range = sel.getRangeAt(0)
      var rects = range.getClientRects()
      if (!rects.length) return

      // Cloned now, rather than re-reading the live selection when
      // "Redact this text" is clicked later — picking a category in the
      // popover moves focus out of the iframe, and a live Range isn't
      // guaranteed to survive that the same way a cloned one does.
      pendingRange = range.cloneRange()

      var lastRect = rects[rects.length - 1]
      var iframeRect = iframe.getBoundingClientRect()
      var anchorRect = {
        left: lastRect.left + iframeRect.left,
        right: lastRect.right + iframeRect.left,
        top: lastRect.top + iframeRect.top,
        bottom: lastRect.bottom + iframeRect.top
      }

      openPopoverAt(anchorRect)
    }

    // ------------------------------------------------------------------
    // Applying a redaction — an opaque bar per client rect (a selection
    // can span multiple lines), positioned in the iframe's own document
    // coordinates so it scrolls with the page like PDF.js's own text
    // layer does, rather than the parent page's.
    // ------------------------------------------------------------------

    function applyRedaction () {
      if (!pendingRange) return

      var iframeWin = iframe.contentWindow
      var iframeDoc = iframe.contentDocument
      var rects = pendingRange.getClientRects()

      Array.prototype.forEach.call(rects, function (rect) {
        var mark = iframeDoc.createElement('div')
        mark.className = 'dcf-material-redaction-mark'
        mark.style.left = Math.round(rect.left + iframeWin.scrollX) + 'px'
        mark.style.top = Math.round(rect.top + iframeWin.scrollY) + 'px'
        mark.style.width = Math.round(rect.width) + 'px'
        mark.style.height = Math.round(rect.height) + 'px'
        iframeDoc.body.appendChild(mark)
      })

      var sel = iframeWin.getSelection()
      if (sel) sel.removeAllRanges()

      redactionCount += 1
      showFooter()
      closePopover()
    }

    if (redactButton) {
      redactButton.addEventListener('click', function () {
        if (redactButton.disabled) return
        applyRedaction()
      })
    }

    // "Find matching text" is present for visual parity with the factual
    // summary popover, but isn't plumbed in here — this only ever redacts
    // one document/tab at a time, so there's nothing to bulk-match
    // against. Bulk redaction is illustrated in the factual summary
    // version instead.

    // ------------------------------------------------------------------
    // Sticky footer — width/position matched to #material-viewer, not
    // fixed in the markup, since the viewer's own width varies (the
    // toolbar's "View document full width" toggle, responsive layout).
    // ------------------------------------------------------------------

    function positionFooter () {
      var viewerRect = viewer.getBoundingClientRect()
      footer.style.left = Math.round(viewerRect.left) + 'px'
      footer.style.width = Math.round(viewerRect.width) + 'px'
    }

    function updateCountText () {
      if (!countEl) return
      countEl.textContent = redactionCount === 1
        ? 'There is 1 redaction'
        : 'There are ' + redactionCount + ' redactions'
    }

    function showFooter () {
      updateCountText()
      positionFooter()
      footer.hidden = false
    }

    function hideFooter () {
      footer.hidden = true
    }

    window.addEventListener('resize', function () {
      if (!footer.hidden) positionFooter()
    })

    // Illustrative only, per the design — not wired to actually remove
    // anything or persist anything.
    if (removeAllLink) {
      removeAllLink.addEventListener('click', function (e) { e.preventDefault() })
    }

    // ------------------------------------------------------------------
    // Self-initialising — drag-selecting text works unconditionally
    // whenever a document is open, same as the factual summary's redact
    // popover (no "enter redact mode" step). The iframe doesn't exist
    // until a document is first opened, so this watches for it to appear
    // rather than waiting on a button click.
    // ------------------------------------------------------------------

    function bindIframeOnceReady () {
      var found = viewer.querySelector('.dcf-viewer__frame')
      if (!found || found === iframe) return

      iframe = found
      if (iframe.dataset.redactPopoverBound) return
      iframe.dataset.redactPopoverBound = 'true'
      iframe.addEventListener('load', onIframeLoad)
      // The iframe may already have finished loading its current document
      // by the time this observer first sees it.
      onIframeLoad()
    }

    var iframeObserver = new MutationObserver(bindIframeOnceReady)
    iframeObserver.observe(viewer, { childList: true, subtree: true })
    bindIframeOnceReady()
  })
})()
