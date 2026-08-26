(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  // countOccurrences/clearSelectionFields/captureSelectionFromMouseup/
  // rangeAtOffset live in redact-text-offsets.js (loaded before this
  // script), shared with redact-popover.js.
  var countOccurrences = window.DCFRedactText.countOccurrences
  var rangeAtOffset = window.DCFRedactText.rangeAtOffset
  var clearSelectionFields = window.DCFRedactText.clearSelectionFields
  var readHighlightTrigger = window.DCFRedactText.readHighlightTrigger
  var captureSelectionFromMouseup = window.DCFRedactText.captureSelectionFromMouseup
  var initShowOriginalToggle = window.DCFRedactText.initShowOriginalToggle
  var clearNoteError = window.DCFRedactText.clearNoteError

  ready(function () {
    var container = document.querySelector('.js-redact-paragraphs')
    var modal = document.getElementById('dcf-redact-modal')
    if (!container) return

    var changeIdField = document.getElementById('change-id-field')
    // Captured once, before any click can overwrite changeIdField's value —
    // identifies the specific redaction (if any) this page was rendered for
    // via check.html's "Change" link, so re-clicking THAT highlight later
    // can restore Remove/Cancel/Continue instead of the normal "on-page
    // click" re-tag behaviour every other highlight gets.
    var arrivedViaChangeLinkId = changeIdField ? changeIdField.value : ''
    var startField = document.getElementById('selection-start-field')
    var endField = document.getElementById('selection-end-field')
    var paragraphField = document.getElementById('selection-paragraph-field')
    var textField = document.getElementById('selection-text-field')
    var occurrenceCountEl = document.getElementById('dcf-redact-occurrence-count')
    var selectedTextEl = document.getElementById('dcf-redact-selected-text')
    var returnToField = document.getElementById('redact-return-to-field')
    // Captured alongside arrivedViaChangeLinkId — restored onto returnToField
    // if that same redaction is re-clicked, so Remove still redirects back
    // to check.html afterwards instead of losing the return path.
    var arrivedViaChangeLinkReturnTo = returnToField ? returnToField.value : ''
    var findMatchingButton = document.getElementById('redact-find-matching-button')
    var initialActionsGroup = document.getElementById('redact-initial-actions')
    var editActionsGroup = document.getElementById('redact-edit-actions')
    var matchPanel = document.getElementById('redact-match-panel')
    var matchCountEl = document.getElementById('redact-match-count')
    var viewPreviousButton = document.getElementById('redact-view-previous')
    var viewNextButton = document.getElementById('redact-view-next')
    var matchRedactAllButton = document.getElementById('redact-match-redact-all-button')

    var documentText = ''
    var documentTextEl = document.getElementById('dcf-redact-document-text')
    if (documentTextEl) {
      try { documentText = JSON.parse(documentTextEl.textContent) } catch (e) {}
    }

    initShowOriginalToggle(container)

    function setCheckedTag (value) {
      var radios = document.querySelectorAll('#outline-tag-form input[name="tag"]')
      radios.forEach(function (radio) {
        radio.checked = (radio.value === value)
        // A programmatic .checked assignment doesn't fire a native change
        // event, so govuk-frontend's own radios module won't know to
        // reveal/hide the "Other" conditional note field unless told to —
        // dispatching one lets it run its usual logic.
        if (radio.checked) radio.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }

    // ------------------------------------------------------------------
    // Modal open/close — mirrors material-viewer.js's notes-modal pattern
    // (hidden attribute + is-open class). Closing without submitting
    // discards the pending drag-selection entirely: both the visible
    // browser selection and the hidden fields it populated.
    // ------------------------------------------------------------------

    function isModalOpen () {
      return !!(modal && !modal.hidden)
    }

    function openModal (text) {
      if (!modal) return
      modal.hidden = false
      modal.classList.add('is-open')

      if (occurrenceCountEl) {
        var count = countOccurrences(documentText, text)
        occurrenceCountEl.textContent = 'Appears ' + count + (count === 1 ? ' time' : ' times')
      }

      if (selectedTextEl) selectedTextEl.textContent = text

      var panelEl = modal.querySelector('.dcf-redact-modal__panel')
      if (panelEl) {
        try { panelEl.focus() } catch (e) {}
      }
    }

    function clearPendingSelection () {
      clearSelectionFields({ startField: startField, endField: endField, paragraphField: paragraphField, textField: textField })
    }

    function closeModal () {
      if (!modal || modal.hidden) return
      modal.classList.remove('is-open')
      modal.hidden = true
      clearPendingSelection()
      // Only the match-panel DOM/state, not which action group is showing —
      // closing shouldn't change that (e.g. a Change-link visit arrives in
      // the Remove/Cancel/Continue state and must stay there if reopened
      // later, not silently flip back to the initial redact/find-matching
      // state).
      clearMatchState()
    }

    // While Continue/Remove/Cancel are showing (a change/edit-state visit),
    // the modal is locked: the user must pick one of those three rather
    // than dismiss it via the overlay/close button or Escape.
    function isLockedInEditState () {
      return !!(editActionsGroup && !editActionsGroup.hidden)
    }

    document.addEventListener('click', function (e) {
      var closeEl = e.target && e.target.closest && e.target.closest('[data-action="close-redact-modal"]')
      if (!closeEl) return
      if (isLockedInEditState()) return
      e.preventDefault()
      closeModal()
    })

    document.addEventListener('keydown', function (e) {
      if (!isModalOpen()) return
      if (isLockedInEditState()) return
      if (e.key === 'Escape' || e.key === 'Esc') {
        closeModal()
      }
    })

    document.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'tag') clearNoteError()
    })

    // ------------------------------------------------------------------
    // "Find matching text" step-through — same client-side match engine as
    // the v2 popover (findAllMatches/showMatch/temporary highlight), minus
    // its anchor-repositioning logic: this dialog is fixed-docked, not
    // floating, so there's nothing to reposition — only the matched text
    // itself needs scrolling into view.
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

    function clearMatchState () {
      clearTemporaryHighlight()
      matches = []
      matchIndex = -1
      if (matchPanel) matchPanel.hidden = true
    }

    // Same DOM/state cleanup as clearMatchState, plus switching back to the
    // initial redact/find-matching actions — correct for the two callers
    // that use this (a fresh selection, or reopening an on-page highlight),
    // but NOT for simply closing the modal — see closeModal.
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
        // stepping through matches of the very word the modal was opened
        // to edit, via check.html's "Change" link) — its text is already
        // wrapped in an existing <mark><button>. Anchor to that directly
        // rather than wrapping a second, temporary <mark> inside it.
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

      scrollTarget.scrollIntoView({ block: 'center' })
    }

    if (findMatchingButton) {
      findMatchingButton.addEventListener('click', function () {
        var text = textField ? textField.value : ''
        if (!text) return

        matches = findAllMatches(text)

        if (matchCountEl) {
          matchCountEl.textContent = matches.length + (matches.length === 1 ? ' time' : ' times')
        }
        if (matchRedactAllButton) matchRedactAllButton.textContent = 'Redact all (' + matches.length + ')'

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
    // Drag-selection capture
    // ------------------------------------------------------------------

    container.addEventListener('mouseup', function () {
      // Clear any leftover step-through highlight/state first, before the
      // overlap check inside captureSelectionFromMouseup runs — a stale
      // temporary <mark> left in the DOM from a previous "Find matching
      // text" session would otherwise itself count as an existing
      // highlight and wrongly reject a new selection that crosses it.
      resetMatchPanel()

      var captured = captureSelectionFromMouseup()
      if (!captured) return

      // Clear changeId — this is always a brand new selection, and a
      // stale id left over from previously editing an existing one (via
      // the click handler below) must not carry over and overwrite it.
      if (changeIdField) changeIdField.value = ''
      if (startField) startField.value = captured.start
      if (endField) endField.value = captured.end
      if (paragraphField) paragraphField.value = captured.paragraphIndex
      if (textField) textField.value = captured.text
      if (returnToField) returnToField.value = ''
      setCheckedTag('')

      // A fresh selection has nothing to remove yet, and isn't part of a
      // check.html round trip — hide Remove/Cancel/Continue even if they
      // were left visible by a server-rendered check.html return still on
      // screen.
      if (editActionsGroup) editActionsGroup.hidden = true

      openModal(captured.text)
    })

    // ------------------------------------------------------------------
    // Clicking an already-tagged highlight reopens the modal anchored to
    // it, pre-filled with its current category/note — minus Remove/
    // Cancel/Continue: those are only ever shown when arriving via
    // check.html's "Change" link, not from an on-page click — on-page
    // removal still goes through the table's own Remove action instead.
    // EXCEPT when the highlight clicked is the very one this page was
    // opened for via that Change link (arrivedViaChangeLinkId) — re-
    // clicking that one restores Remove/Cancel/Continue rather than
    // switching to the normal on-page re-tag actions, so closing/
    // reopening it doesn't change what the user is able to do with it.
    // ------------------------------------------------------------------

    container.querySelectorAll('.dcf-highlight__trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var data = readHighlightTrigger(trigger, {
          changeIdField: changeIdField,
          startField: startField,
          endField: endField,
          paragraphField: paragraphField,
          textField: textField
        })

        setCheckedTag(data.currentTag)

        var noteFieldEl = document.getElementById('redact-note')
        if (noteFieldEl) noteFieldEl.value = data.currentNote

        var isChangeLinkRedaction = !!arrivedViaChangeLinkId &&
          arrivedViaChangeLinkId.split(',').indexOf(data.changeId) !== -1

        if (isChangeLinkRedaction) {
          clearMatchState()
          if (returnToField) returnToField.value = arrivedViaChangeLinkReturnTo
          if (initialActionsGroup) initialActionsGroup.hidden = true
          if (editActionsGroup) editActionsGroup.hidden = false
        } else {
          resetMatchPanel()
          if (returnToField) returnToField.value = ''
          if (editActionsGroup) editActionsGroup.hidden = true
        }

        openModal(data.text)
      })
    })
  })
})()
