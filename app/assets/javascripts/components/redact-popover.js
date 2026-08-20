(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  // Shared with redact-select.js — see redact-text-offsets.js.
  var textOffsetOfNode = window.DCFRedactText.textOffsetOfNode
  var rangeAtOffset = window.DCFRedactText.rangeAtOffset
  var closestParagraph = window.DCFRedactText.closestParagraph
  var overlapsExistingHighlight = window.DCFRedactText.overlapsExistingHighlight

  ready(function () {
    var container = document.querySelector('.js-redact-paragraphs')
    var popover = document.getElementById('dcf-redact-popover')
    if (!container || !popover) return

    var changeIdField = document.getElementById('popover-change-id-field')
    var startField = document.getElementById('popover-start-field')
    var endField = document.getElementById('popover-end-field')
    var paragraphField = document.getElementById('popover-paragraph-field')
    var textField = document.getElementById('popover-text-field')
    var returnToField = document.getElementById('popover-return-to-field')
    var tagSelect = document.getElementById('popover-tag-select')
    var redactButton = document.getElementById('popover-redact-button')
    var findMatchingButton = document.getElementById('popover-find-matching-button')
    var editActionsGroup = document.getElementById('popover-edit-actions')
    var initialActionsGroup = document.getElementById('popover-initial-actions')
    var matchPanel = document.getElementById('popover-match-panel')
    var matchCountEl = document.getElementById('popover-match-count')
    var viewPreviousButton = document.getElementById('popover-view-previous')
    var viewNextButton = document.getElementById('popover-view-next')
    var redactAllButton = document.getElementById('popover-redact-all-button')

    // ------------------------------------------------------------------
    // Open/close/position — unlike v4's fixed right-docked modal, this
    // popover is placed via top/left next to whatever it's anchored to
    // (a live drag-selection here; an existing highlight once the
    // check.html round trip is wired up). Document-relative coordinates
    // (viewport rect + scroll offset) so it stays put if the page is
    // scrolled after it opens, rather than a fixed on-screen position.
    // ------------------------------------------------------------------

    function isPopoverOpen () {
      return !!(popover && !popover.hidden)
    }

    function positionPopoverAt (anchorRect) {
      // Measuring via getBoundingClientRect works as soon as the popover
      // is un-hidden, even before the browser paints, so there's no
      // visible flash between showing it and moving it into place.
      var popoverRect = popover.getBoundingClientRect()
      var viewportWidth = document.documentElement.clientWidth
      var viewportHeight = document.documentElement.clientHeight
      var margin = 8
      var arrowGap = 12
      var anchorCenterX = (anchorRect.left + anchorRect.right) / 2

      // Centre the popover on the selection, then clamp to the viewport.
      var left = anchorCenterX - popoverRect.width / 2
      if (left < margin) left = margin
      if (left + popoverRect.width > viewportWidth - margin) {
        left = viewportWidth - margin - popoverRect.width
      }

      // The arrow points at the selection's actual centre, which is only
      // the popover's own centre when nothing needed clamping — pin it to
      // the true anchor position (kept a little clear of the rounded
      // edges so it never renders past the box's corners).
      var arrowMargin = 16
      var arrowLeft = anchorCenterX - left
      if (arrowLeft < arrowMargin) arrowLeft = arrowMargin
      if (arrowLeft > popoverRect.width - arrowMargin) arrowLeft = popoverRect.width - arrowMargin
      popover.style.setProperty('--dcf-arrow-left', Math.round(arrowLeft) + 'px')

      var top
      popover.classList.remove('dcf-redact-popover--below')
      if (anchorRect.top - popoverRect.height - arrowGap > 0) {
        top = anchorRect.top - popoverRect.height - arrowGap
      } else {
        top = anchorRect.bottom + arrowGap
        popover.classList.add('dcf-redact-popover--below')
      }

      // Clamp vertically too, in case the anchor is off the bottom of a
      // short viewport (rare, but avoids the popover being pushed off).
      if (top + popoverRect.height > viewportHeight + window.scrollY - margin) {
        top = viewportHeight + window.scrollY - margin - popoverRect.height
      }

      popover.style.left = Math.round(left + window.scrollX) + 'px'
      popover.style.top = Math.round(top + window.scrollY) + 'px'
    }

    var justOpened = false
    var currentAnchorRect = null

    function openPopoverAt (anchorRect) {
      currentAnchorRect = anchorRect
      popover.hidden = false
      popover.classList.add('is-open')
      positionPopoverAt(anchorRect)
      updateInitialButtonStates()

      justOpened = true

      var focusEl = popover.querySelector('#popover-tag-select')
      if (focusEl) { try { focusEl.focus() } catch (e) {} }
    }

    function clearPendingSelection () {
      if (startField) startField.value = ''
      if (endField) endField.value = ''
      if (paragraphField) paragraphField.value = ''
      if (textField) textField.value = ''

      var selection = window.getSelection()
      if (selection) selection.removeAllRanges()
    }

    function closePopover () {
      if (!isPopoverOpen()) return
      popover.classList.remove('is-open')
      popover.hidden = true
      clearPendingSelection()
      resetMatchPanel()
    }

    document.addEventListener('click', function (e) {
      if (!isPopoverOpen()) return

      // The same mouseup that opens the popover is immediately followed by
      // a click event on the paragraph text — without this guard, that
      // click would be seen as "outside the popover" and close it the
      // instant it opens.
      if (justOpened) {
        justOpened = false
        return
      }

      if (popover.contains(e.target)) return
      closePopover()
    })

    document.addEventListener('keydown', function (e) {
      if (!isPopoverOpen()) return
      if (e.key === 'Escape' || e.key === 'Esc') closePopover()
    })

    // ------------------------------------------------------------------
    // Select-driven button states — both initial actions start disabled
    // until a redaction category is chosen.
    // ------------------------------------------------------------------

    function updateInitialButtonStates () {
      var hasTag = !!(tagSelect && tagSelect.value)
      if (redactButton) redactButton.disabled = !hasTag
      if (findMatchingButton) findMatchingButton.disabled = !hasTag
    }

    if (tagSelect) {
      tagSelect.addEventListener('change', updateInitialButtonStates)
    }

    // ------------------------------------------------------------------
    // "Find matching text" step-through — finds every occurrence of the
    // selected text across the whole document (client-side, mirroring the
    // server's own paragraph-by-paragraph search in the "Redact all" bulk
    // loop), then lets the user step through them with View previous/next
    // before deciding. The final tagging is authoritative server-side —
    // this is purely for the step-through display; the server's own
    // "Redact all" already skips anything that overlaps an existing tag.
    // ------------------------------------------------------------------

    var matches = []
    var matchIndex = -1
    var temporaryHighlight = null

    function clearTemporaryHighlight () {
      if (!temporaryHighlight) return
      var parent = temporaryHighlight.parentNode
      if (parent) {
        while (temporaryHighlight.firstChild) {
          parent.insertBefore(temporaryHighlight.firstChild, temporaryHighlight)
        }
        parent.removeChild(temporaryHighlight)
        parent.normalize()
      }
      temporaryHighlight = null
    }

    function resetMatchPanel () {
      clearTemporaryHighlight()
      matches = []
      matchIndex = -1
      if (matchPanel) matchPanel.hidden = true
      if (initialActionsGroup) initialActionsGroup.hidden = false
    }

    function findAllMatches (text) {
      var results = []
      var paragraphEls = container.querySelectorAll('.js-tag-paragraph')

      paragraphEls.forEach(function (paragraphEl, index) {
        var paragraphText = paragraphEl.textContent
        var searchFrom = 0
        var occStart = paragraphText.indexOf(text, searchFrom)

        while (occStart !== -1) {
          results.push({ paragraphIndex: index, start: occStart, end: occStart + text.length })
          searchFrom = occStart + text.length
          occStart = paragraphText.indexOf(text, searchFrom)
        }
      })

      return results
    }

    // Moves the currently-viewed match's coordinates into the form's
    // hidden fields, so "Redact this" (inside the match panel) acts on
    // whichever occurrence is on screen, not the original drag-selection.
    function showMatch (index) {
      clearTemporaryHighlight()
      if (!matches.length) return

      matchIndex = ((index % matches.length) + matches.length) % matches.length
      var match = matches[matchIndex]
      var paragraphEl = container.querySelectorAll('.js-tag-paragraph')[match.paragraphIndex]
      if (!paragraphEl) return

      if (startField) startField.value = match.start
      if (endField) endField.value = match.end
      if (paragraphField) paragraphField.value = match.paragraphIndex

      var range = rangeAtOffset(paragraphEl, match.start, match.end)
      var scrollTarget = paragraphEl

      if (range) {
        temporaryHighlight = document.createElement('mark')
        temporaryHighlight.className = 'dcf-highlight dcf-highlight--match'
        try {
          range.surroundContents(temporaryHighlight)
          scrollTarget = temporaryHighlight
        } catch (e) {
          // surroundContents throws if the range's boundaries don't cleanly
          // wrap in one element (e.g. straddling existing markup) — fall
          // back to scrolling the paragraph into view without the visual
          // highlight rather than breaking the step-through entirely.
          temporaryHighlight = null
        }
      }

      // Instant (not smooth) scroll, so the browser has actually finished
      // moving the page by the time getBoundingClientRect runs below —
      // with a smooth/animated scroll the rect would still reflect the
      // pre-scroll position, throwing the popover's next placement off.
      scrollTarget.scrollIntoView({ block: 'center' })

      // Follow the popover to whichever match is now on screen — without
      // this it stays anchored to wherever it was first opened, which
      // stops tracking (and can end up obscuring) matches further down
      // the document as View previous/next steps through them.
      currentAnchorRect = scrollTarget.getBoundingClientRect()
      positionPopoverAt(currentAnchorRect)
    }

    if (findMatchingButton) {
      findMatchingButton.addEventListener('click', function () {
        var text = textField ? textField.value : ''
        if (!text) return

        matches = findAllMatches(text)

        if (matchCountEl) {
          matchCountEl.textContent = matches.length + (matches.length === 1 ? ' time' : ' times')
        }
        if (redactAllButton) redactAllButton.textContent = 'Redact all (' + matches.length + ')'

        if (initialActionsGroup) initialActionsGroup.hidden = true
        if (matchPanel) matchPanel.hidden = false

        showMatch(0)
      })
    }

    if (viewPreviousButton) {
      viewPreviousButton.addEventListener('click', function () { showMatch(matchIndex - 1) })
    }

    if (viewNextButton) {
      viewNextButton.addEventListener('click', function () { showMatch(matchIndex + 1) })
    }

    // ------------------------------------------------------------------
    // Drag-selection capture — same paragraph-boundary/overlap rules as
    // v4's redact-select.js, using the shared offset helpers.
    // ------------------------------------------------------------------

    container.addEventListener('mouseup', function () {
      // Clear any leftover step-through highlight/state first, before the
      // overlap check below runs — a stale temporary <mark> left in the
      // DOM from a previous "Find matching text" session would otherwise
      // itself count as an existing highlight and wrongly reject a new
      // selection that happens to cross it.
      resetMatchPanel()

      var selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return

      var range = selection.getRangeAt(0)
      var text = range.toString()
      if (!text.trim()) return

      var startParagraph = closestParagraph(range.startContainer)
      var endParagraph = closestParagraph(range.endContainer)

      if (!startParagraph || startParagraph !== endParagraph) {
        selection.removeAllRanges()
        return
      }

      if (overlapsExistingHighlight(startParagraph, range)) {
        selection.removeAllRanges()
        return
      }

      var start = textOffsetOfNode(startParagraph, range.startContainer, range.startOffset)
      var end = textOffsetOfNode(startParagraph, range.endContainer, range.endOffset)

      if (start === -1 || end === -1 || start === end) return

      var anchorRect = range.getClientRects()
      anchorRect = anchorRect.length ? anchorRect[anchorRect.length - 1] : range.getBoundingClientRect()

      if (changeIdField) changeIdField.value = ''
      if (startField) startField.value = start
      if (endField) endField.value = end
      if (paragraphField) paragraphField.value = startParagraph.dataset.paragraphIndex
      if (textField) textField.value = text
      if (returnToField) returnToField.value = ''
      if (tagSelect) tagSelect.value = ''

      // A fresh selection has nothing to remove yet, and isn't part of a
      // check.html round trip — hide Remove/Cancel even if they were left
      // visible by a server-rendered check.html return still on screen.
      if (editActionsGroup) editActionsGroup.hidden = true

      openPopoverAt(anchorRect)
    })

    // ------------------------------------------------------------------
    // Clicking an already-tagged highlight reopens the popover anchored
    // to it, pre-filled with its current category — same idea as v4's
    // click-to-reopen, minus Remove/Cancel: those are only ever shown
    // when arriving via check.html's "Change" link (below), not from an
    // on-page click — on-page removal still goes through the table's own
    // Remove action instead.
    // ------------------------------------------------------------------

    container.querySelectorAll('.dcf-highlight__trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var changeId = trigger.dataset.changeId
        var currentTag = trigger.dataset.currentTag || ''
        var text = trigger.textContent

        resetMatchPanel()

        if (changeIdField) changeIdField.value = changeId
        if (startField) startField.value = ''
        if (endField) endField.value = ''
        if (paragraphField) paragraphField.value = ''
        if (textField) textField.value = text
        if (returnToField) returnToField.value = ''
        if (tagSelect) tagSelect.value = currentTag

        if (editActionsGroup) editActionsGroup.hidden = true

        var anchorRect = trigger.getBoundingClientRect()
        openPopoverAt(anchorRect)
      })
    })

    // ------------------------------------------------------------------
    // Arriving via check.html's "Change" link: the popover is already
    // server-rendered open (modalState set), but with no positioning —
    // anchor it to the existing highlight it's editing, same as a live
    // click above. Remove/Cancel's visibility is already correct from the
    // server render (modalState.changeId truthy), nothing to do there.
    // ------------------------------------------------------------------

    if (popover.classList.contains('is-open')) {
      var initialChangeId = changeIdField ? changeIdField.value : ''
      var firstChangeId = initialChangeId ? initialChangeId.split(',')[0] : ''
      var initialTrigger = firstChangeId
        ? container.querySelector('.dcf-highlight__trigger[data-change-id="' + firstChangeId + '"]')
        : null

      if (initialTrigger) {
        currentAnchorRect = initialTrigger.getBoundingClientRect()
        positionPopoverAt(currentAnchorRect)
      }

      updateInitialButtonStates()
    }
  })
})()
