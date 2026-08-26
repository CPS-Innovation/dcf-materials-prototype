// Shared low-level helpers for converting a drag-selection (or an existing
// highlight) into paragraph-relative character offsets, and back. Used by
// both redact-select.js (v4's side-modal flow) and redact-popover.js (v2's
// popover flow) so the offset math only lives in one place.
(function () {
  // Walks all text nodes under `root` in document order, summing lengths,
  // until it reaches `targetNode`, then adds `targetOffset`. Converts a
  // Range boundary (which points at a specific text node, possibly nested
  // inside <mark>/<button> wrappers from earlier tags) into a single
  // character offset relative to the paragraph's flattened plain text.
  function textOffsetOfNode (root, targetNode, targetOffset) {
    var offset = 0
    var found = false

    function walk (node) {
      if (found) return
      if (node.nodeType === Node.TEXT_NODE) {
        if (node === targetNode) {
          offset += targetOffset
          found = true
          return
        }
        offset += node.textContent.length
      } else {
        for (var i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i])
          if (found) return
        }
      }
    }

    walk(root)
    return found ? offset : -1
  }

  // The reverse of textOffsetOfNode: given a paragraph element and a
  // paragraph-relative [start, end) range, walks its text nodes to build a
  // DOM Range spanning that text — needed to scroll to/highlight a specific
  // occurrence rather than just measure one.
  function rangeAtOffset (root, start, end) {
    var range = document.createRange()
    var offset = 0
    var startSet = false
    var endSet = false

    function walk (node) {
      if (endSet) return
      if (node.nodeType === Node.TEXT_NODE) {
        var nextOffset = offset + node.textContent.length

        // Strict bounds, not inclusive on both ends — when `start`/`end`
        // land exactly on a boundary between two text nodes (which always
        // happens for an already-tagged word, since its <mark><button>
        // contains precisely that word and nothing else), inclusive `<=`/
        // `>=` on both sides let the *preceding* node claim the boundary
        // first, resolving into plain paragraph text instead of the
        // tagged span itself. Requiring `start < nextOffset` and
        // `end > offset` makes the *following* node claim a start-boundary
        // and the *preceding* node claim an end-boundary, which is the
        // combination that actually lands inside the intended node.
        if (!startSet && start >= offset && (start < nextOffset || nextOffset === offset)) {
          range.setStart(node, start - offset)
          startSet = true
        }
        if (!endSet && end > offset && end <= nextOffset) {
          range.setEnd(node, end - offset)
          endSet = true
        }

        offset = nextOffset
      } else {
        for (var i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i])
          if (endSet) return
        }
      }
    }

    walk(root)
    return (startSet && endSet) ? range : null
  }

  function closestParagraph (node) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
    return el ? el.closest('.js-tag-paragraph') : null
  }

  function overlapsExistingHighlight (paragraph, range) {
    var marks = paragraph.querySelectorAll('.dcf-highlight')
    for (var i = 0; i < marks.length; i++) {
      if (range.intersectsNode(marks[i])) return true
    }
    return false
  }

  // Case-sensitive, non-overlapping count of `needle` within `haystack`.
  function countOccurrences (haystack, needle) {
    if (!needle) return 0
    var count = 0
    var index = haystack.indexOf(needle)
    while (index !== -1) {
      count++
      index = haystack.indexOf(needle, index + needle.length)
    }
    return count
  }

  // Blanks out a pending selection's hidden fields and clears the browser's
  // live text selection — shared by both callers' "close without
  // submitting" handlers (closeModal/closePopover). `fields` is
  // {startField, endField, paragraphField, textField} — each caller's own
  // closure-scoped references to its own hidden inputs.
  function clearSelectionFields (fields) {
    if (fields.startField) fields.startField.value = ''
    if (fields.endField) fields.endField.value = ''
    if (fields.paragraphField) fields.paragraphField.value = ''
    if (fields.textField) fields.textField.value = ''

    var selection = window.getSelection()
    if (selection) selection.removeAllRanges()
  }

  // A server-rendered "Other requires a note" error (govukErrorSummary +
  // govukErrorMessage) clears itself the moment the user changes their
  // category choice — it was about the previous submission, not
  // necessarily still relevant once they've started picking again. Shared
  // by v4's radios and v2's select, both of which render the same
  // #redact-note/#redact-note-error ids and .govuk-error-summary markup.
  function clearNoteError () {
    var errorSummary = document.querySelector('.govuk-error-summary')
    if (errorSummary) errorSummary.remove()

    var noteField = document.getElementById('redact-note')
    if (!noteField) return

    var errorMessage = document.getElementById('redact-note-error')
    if (errorMessage) errorMessage.remove()

    var formGroup = noteField.closest('.govuk-form-group')
    if (formGroup) formGroup.classList.remove('govuk-form-group--error')
    noteField.classList.remove('govuk-textarea--error')

    if (noteField.hasAttribute('aria-describedby')) {
      var describedBy = noteField.getAttribute('aria-describedby')
        .split(' ')
        .filter(function (id) { return id !== 'redact-note-error' })
        .join(' ')
      if (describedBy) {
        noteField.setAttribute('aria-describedby', describedBy)
      } else {
        noteField.removeAttribute('aria-describedby')
      }
    }
  }

  // "Show original text" toggle — lets the user quickly re-read the
  // passage with every redaction's tint/border removed, without affecting
  // anything that's actually tagged. Shared by both v4's modal page and
  // v2's popover page, which each render the same toggle-original-text.njk
  // markup. Button label text lives in the template (two spans, swapped
  // via `hidden`) rather than here, so it stays editable without touching
  // this file. No-ops if the toggle button isn't present on the page.
  function initShowOriginalToggle (container) {
    var toggleButton = document.getElementById('dcf-toggle-original-text')
    if (!toggleButton) return

    var showLabel = toggleButton.querySelector('.js-toggle-original-label-show')
    var hideLabel = toggleButton.querySelector('.js-toggle-original-label-hide')

    toggleButton.addEventListener('click', function () {
      var showingOriginal = container.classList.toggle('dcf-show-original')
      toggleButton.setAttribute('aria-pressed', String(showingOriginal))
      if (showLabel) showLabel.hidden = showingOriginal
      if (hideLabel) hideLabel.hidden = !showingOriginal
    })
  }

  // Reads an already-tagged highlight's dataset (set by the server from
  // the change it represents) and blanks the position-only fields, since
  // re-tagging via changeId doesn't need start/end/paragraphIndex — only
  // a fresh drag-selection does. Shared prefix of both callers'
  // click-to-reopen handlers, which diverge after this point (radios vs.
  // select, note field vs. none). `fields` is {changeIdField, startField,
  // endField, paragraphField, textField}.
  function readHighlightTrigger (trigger, fields) {
    var changeId = trigger.dataset.changeId
    var currentTag = trigger.dataset.currentTag || ''
    var currentNote = trigger.dataset.note || ''
    var text = trigger.textContent

    if (fields.changeIdField) fields.changeIdField.value = changeId
    if (fields.startField) fields.startField.value = ''
    if (fields.endField) fields.endField.value = ''
    if (fields.paragraphField) fields.paragraphField.value = ''
    if (fields.textField) fields.textField.value = text

    return { changeId: changeId, currentTag: currentTag, currentNote: currentNote, text: text }
  }

  // Reads the browser's current selection on mouseup and validates/converts
  // it into paragraph-relative offsets — shared by redact-select.js (v4's
  // side modal) and redact-popover.js (v2's popover), which otherwise both
  // need the exact same reject-if-crosses-a-paragraph and
  // reject-if-overlaps-an-existing-highlight rules. Returns null for any
  // selection that should be ignored (collapsed, empty, invalid); the
  // browser's live selection is cleared as a side effect in that case, same
  // as both callers already did individually. On success, also clears the
  // selection (both callers do this immediately after capturing it) and
  // returns the last client rect, for positioning whatever UI opens next.
  function captureSelectionFromMouseup () {
    var selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

    var range = selection.getRangeAt(0)
    var text = range.toString()
    if (!text.trim()) return null

    var startParagraph = closestParagraph(range.startContainer)
    var endParagraph = closestParagraph(range.endContainer)

    if (!startParagraph || startParagraph !== endParagraph) {
      selection.removeAllRanges()
      return null
    }

    if (overlapsExistingHighlight(startParagraph, range)) {
      selection.removeAllRanges()
      return null
    }

    var start = textOffsetOfNode(startParagraph, range.startContainer, range.startOffset)
    var end = textOffsetOfNode(startParagraph, range.endContainer, range.endOffset)

    if (start === -1 || end === -1 || start === end) return null

    var rects = range.getClientRects()
    var anchorRect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect()

    return {
      start: start,
      end: end,
      paragraphIndex: startParagraph.dataset.paragraphIndex,
      text: text,
      paragraphEl: startParagraph,
      anchorRect: anchorRect
    }
  }

  // True if `el` is currently shown (exists and its `hidden` property isn't
  // set) — trivial, but both callers repeat the same check for whichever
  // action group they're currently locked into, so it's worth one name.
  function isVisible (el) {
    return !!(el && !el.hidden)
  }

  // Owns the "Find matching text" step-through: the matches array, the
  // current index, the temporary <mark> highlighting whichever occurrence
  // is on screen, and the button wiring (Find matching text/View previous/
  // View next) — identical in redact-popover.js and redact-select.js except
  // for one thing, which is why this takes an `onMatchShown` callback rather
  // than being fully self-contained: the popover has to reposition itself
  // relative to whichever match is now on screen (it floats, anchored to a
  // selection); the v4 modal is fixed-docked and doesn't. `config` is
  // {container, startField, endField, paragraphField, textField, matchPanel,
  // matchCountEl, redactAllButton, initialActionsGroup, findMatchingButton,
  // viewPreviousButton, viewNextButton, onMatchShown?}.
  function createMatchStepper (config) {
    var container = config.container
    var startField = config.startField
    var endField = config.endField
    var paragraphField = config.paragraphField
    var textField = config.textField
    var matchPanel = config.matchPanel
    var matchCountEl = config.matchCountEl
    var redactAllButton = config.redactAllButton
    var initialActionsGroup = config.initialActionsGroup
    var onMatchShown = config.onMatchShown

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

    function clearMatchState () {
      clearTemporaryHighlight()
      matches = []
      matchIndex = -1
      if (matchPanel) matchPanel.hidden = true
    }

    // Same DOM/state cleanup as clearMatchState, plus switching back to the
    // initial redact/find-matching actions — correct for the two callers
    // that use this (a fresh selection, or reopening an on-page highlight),
    // but NOT for simply closing the popover/modal — that just needs
    // clearMatchState, so it doesn't fight a Change-link visit's Remove/
    // Cancel/Continue state (see closePopover/closeModal).
    function resetMatchPanel () {
      clearMatchState()
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
        // This occurrence might already be a tagged redaction itself (e.g.
        // stepping through matches of the very word the popover/modal was
        // opened to edit, via check.html's "Change" link) — its text is
        // already wrapped in an existing <mark><button>. Anchor to that
        // directly rather than wrapping a second, temporary <mark> inside
        // it: nesting one highlight inside another is both unnecessary and
        // unreliable — surroundContents on a range nested inside a <button>
        // doesn't behave consistently across cases.
        var existingHighlightEl = range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.parentElement.closest('.dcf-highlight')
          : null

        if (existingHighlightEl) {
          scrollTarget = existingHighlightEl
        } else {
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
      }

      // Instant (not smooth) scroll, so the browser has actually finished
      // moving the page by the time getBoundingClientRect runs in
      // onMatchShown — with a smooth/animated scroll the rect would still
      // reflect the pre-scroll position, throwing the popover's next
      // placement off.
      scrollTarget.scrollIntoView({ block: 'center' })

      if (onMatchShown) onMatchShown(scrollTarget)
    }

    if (config.findMatchingButton) {
      config.findMatchingButton.addEventListener('click', function () {
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

    if (config.viewPreviousButton) {
      config.viewPreviousButton.addEventListener('click', function () { showMatch(matchIndex - 1) })
    }

    if (config.viewNextButton) {
      config.viewNextButton.addEventListener('click', function () { showMatch(matchIndex + 1) })
    }

    return {
      clearMatchState: clearMatchState,
      resetMatchPanel: resetMatchPanel,
      findAllMatches: findAllMatches,
      showMatch: showMatch
    }
  }

  // Identifies whether a given changeId is the specific redaction this page
  // was rendered for via check.html's "Change" link (captured once, before
  // any on-page click can overwrite the hidden changeId field) — both
  // callers use this to decide whether re-clicking that highlight should
  // restore Remove/Cancel/Continue rather than the normal on-page re-tag
  // actions. `config` is {changeIdField, returnToField}.
  function createChangeLinkTracker (config) {
    var arrivedViaChangeLinkId = config.changeIdField ? config.changeIdField.value : ''
    var arrivedViaChangeLinkReturnTo = config.returnToField ? config.returnToField.value : ''

    function isChangeLinkRedaction (changeId) {
      return !!arrivedViaChangeLinkId && arrivedViaChangeLinkId.split(',').indexOf(changeId) !== -1
    }

    return {
      isChangeLinkRedaction: isChangeLinkRedaction,
      returnTo: arrivedViaChangeLinkReturnTo
    }
  }

  window.DCFRedactText = {
    textOffsetOfNode: textOffsetOfNode,
    rangeAtOffset: rangeAtOffset,
    closestParagraph: closestParagraph,
    overlapsExistingHighlight: overlapsExistingHighlight,
    countOccurrences: countOccurrences,
    clearSelectionFields: clearSelectionFields,
    readHighlightTrigger: readHighlightTrigger,
    captureSelectionFromMouseup: captureSelectionFromMouseup,
    initShowOriginalToggle: initShowOriginalToggle,
    clearNoteError: clearNoteError,
    isVisible: isVisible,
    createMatchStepper: createMatchStepper,
    createChangeLinkTracker: createChangeLinkTracker
  }
})()
