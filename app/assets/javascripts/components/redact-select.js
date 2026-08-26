(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  // countOccurrences/clearSelectionFields/captureSelectionFromMouseup/
  // readHighlightTrigger/initShowOriginalToggle/clearNoteError/isVisible/
  // createMatchStepper/createChangeLinkTracker live in redact-text-
  // offsets.js (loaded before this script), shared with redact-popover.js.
  var countOccurrences = window.DCFRedactText.countOccurrences
  var clearSelectionFields = window.DCFRedactText.clearSelectionFields
  var readHighlightTrigger = window.DCFRedactText.readHighlightTrigger
  var captureSelectionFromMouseup = window.DCFRedactText.captureSelectionFromMouseup
  var initShowOriginalToggle = window.DCFRedactText.initShowOriginalToggle
  var clearNoteError = window.DCFRedactText.clearNoteError
  var isVisible = window.DCFRedactText.isVisible
  var createMatchStepper = window.DCFRedactText.createMatchStepper
  var createChangeLinkTracker = window.DCFRedactText.createChangeLinkTracker

  ready(function () {
    var container = document.querySelector('.js-redact-paragraphs')
    var modal = document.getElementById('dcf-redact-modal')
    if (!container) return

    var changeIdField = document.getElementById('change-id-field')
    var startField = document.getElementById('selection-start-field')
    var endField = document.getElementById('selection-end-field')
    var paragraphField = document.getElementById('selection-paragraph-field')
    var textField = document.getElementById('selection-text-field')
    var occurrenceCountEl = document.getElementById('dcf-redact-occurrence-count')
    var selectedTextEl = document.getElementById('dcf-redact-selected-text')
    var returnToField = document.getElementById('redact-return-to-field')
    var findMatchingButton = document.getElementById('redact-find-matching-button')
    var initialActionsGroup = document.getElementById('redact-initial-actions')
    var editActionsGroup = document.getElementById('redact-edit-actions')
    var matchPanel = document.getElementById('redact-match-panel')
    var matchCountEl = document.getElementById('redact-match-count')
    var viewPreviousButton = document.getElementById('redact-view-previous')
    var viewNextButton = document.getElementById('redact-view-next')
    var matchRedactAllButton = document.getElementById('redact-match-redact-all-button')

    var changeLinkTracker = createChangeLinkTracker({ changeIdField: changeIdField, returnToField: returnToField })

    var matchStepper = createMatchStepper({
      container: container,
      startField: startField,
      endField: endField,
      paragraphField: paragraphField,
      textField: textField,
      matchPanel: matchPanel,
      matchCountEl: matchCountEl,
      redactAllButton: matchRedactAllButton,
      initialActionsGroup: initialActionsGroup,
      findMatchingButton: findMatchingButton,
      viewPreviousButton: viewPreviousButton,
      viewNextButton: viewNextButton
      // No onMatchShown — this dialog is fixed-docked, nothing to reposition.
    })

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
      matchStepper.clearMatchState()
    }

    // While Continue/Remove/Cancel are showing (a change/edit-state visit),
    // the modal is locked: the user must pick one of those three rather
    // than dismiss it via the overlay/close button or Escape.
    function isLockedInEditState () {
      return isVisible(editActionsGroup)
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
    // Drag-selection capture
    // ------------------------------------------------------------------

    container.addEventListener('mouseup', function () {
      // Clear any leftover step-through highlight/state first, before the
      // overlap check inside captureSelectionFromMouseup runs — a stale
      // temporary <mark> left in the DOM from a previous "Find matching
      // text" session would otherwise itself count as an existing
      // highlight and wrongly reject a new selection that crosses it.
      matchStepper.resetMatchPanel()

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
    // opened for via that Change link — re-clicking that one restores
    // Remove/Cancel/Continue rather than switching to the normal on-page
    // re-tag actions, so closing/reopening it doesn't change what the
    // user is able to do with it.
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

        if (changeLinkTracker.isChangeLinkRedaction(data.changeId)) {
          matchStepper.clearMatchState()
          if (returnToField) returnToField.value = changeLinkTracker.returnTo
          if (initialActionsGroup) initialActionsGroup.hidden = true
          if (editActionsGroup) editActionsGroup.hidden = false
        } else {
          matchStepper.resetMatchPanel()
          if (returnToField) returnToField.value = ''
          if (editActionsGroup) editActionsGroup.hidden = true
        }

        openModal(data.text)
      })
    })
  })
})()
