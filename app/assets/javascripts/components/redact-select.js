(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  // countOccurrences/clearSelectionFields/captureSelectionFromMouseup live
  // in redact-text-offsets.js (loaded before this script), shared with
  // redact-popover.js.
  var countOccurrences = window.DCFRedactText.countOccurrences
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
    var startField = document.getElementById('selection-start-field')
    var endField = document.getElementById('selection-end-field')
    var paragraphField = document.getElementById('selection-paragraph-field')
    var textField = document.getElementById('selection-text-field')
    var occurrenceCountEl = document.getElementById('dcf-redact-occurrence-count')
    var selectedTextEl = document.getElementById('dcf-redact-selected-text')
    var removeButton = document.getElementById('redact-remove-button')
    var cancelLink = document.getElementById('redact-cancel-link')
    var returnToField = document.getElementById('redact-return-to-field')

    var documentText = ''
    var documentTextEl = document.getElementById('dcf-redact-document-text')
    if (documentTextEl) {
      try { documentText = JSON.parse(documentTextEl.textContent) } catch (e) {}
    }

    initShowOriginalToggle(container)

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
    }

    document.addEventListener('click', function (e) {
      var closeEl = e.target && e.target.closest && e.target.closest('[data-action="close-redact-modal"]')
      if (closeEl) {
        e.preventDefault()
        closeModal()
      }
    })

    document.addEventListener('keydown', function (e) {
      if (!isModalOpen()) return
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

      // A fresh selection has nothing to remove yet, and isn't part of a
      // check.html round trip — hide Remove/Cancel and drop any returnTo
      // carried over from a previous edit-existing-redaction visit.
      if (removeButton) removeButton.hidden = true
      if (cancelLink) cancelLink.hidden = true
      if (returnToField) returnToField.value = ''

      openModal(captured.text)
    })

    // ------------------------------------------------------------------
    // Clicking an already-tagged highlight reopens the modal pre-filled
    // with its current category/note, rather than requiring the user to
    // redo the drag from scratch to change or review it.
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

        var radios = document.querySelectorAll('#outline-tag-form input[name="tag"]')
        radios.forEach(function (radio) {
          radio.checked = (radio.value === data.currentTag)
          // A programmatic .checked assignment doesn't fire a native
          // change event, so govuk-frontend's own radios module won't
          // know to reveal/hide the "Other" conditional note field
          // unless told to — dispatching one lets it run its usual logic.
          if (radio.checked) radio.dispatchEvent(new Event('change', { bubbles: true }))
        })

        var noteFieldEl = document.getElementById('redact-note')
        if (noteFieldEl) noteFieldEl.value = data.currentNote

        // Editing an existing redaction directly on the page (as opposed to
        // arriving via check.html) — Remove/Cancel are only ever shown when
        // returning from check.html's "Change" link; on-page removal still
        // goes through the table's own Remove action instead. Explicitly
        // re-hide them here in case they were left visible by a prior
        // server-rendered check.html return that's still on screen.
        if (removeButton) removeButton.hidden = true
        if (cancelLink) cancelLink.hidden = true
        if (returnToField) returnToField.value = ''

        openModal(data.text)
      })
    })
  })
})()
