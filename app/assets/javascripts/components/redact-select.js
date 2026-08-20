(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

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

    // ------------------------------------------------------------------
    // "Show original text" toggle — lets the user quickly re-read the
    // passage with every redaction's tint/border removed, without
    // affecting anything that's actually tagged. Button label text lives
    // in the template (two spans, swapped via `hidden`) rather than here,
    // so it stays editable without touching this file.
    // ------------------------------------------------------------------

    var toggleOriginalButton = document.getElementById('dcf-toggle-original-text')
    var toggleShowLabel = toggleOriginalButton && toggleOriginalButton.querySelector('.js-toggle-original-label-show')
    var toggleHideLabel = toggleOriginalButton && toggleOriginalButton.querySelector('.js-toggle-original-label-hide')

    if (toggleOriginalButton) {
      toggleOriginalButton.addEventListener('click', function () {
        var showingOriginal = container.classList.toggle('dcf-show-original')
        toggleOriginalButton.setAttribute('aria-pressed', String(showingOriginal))
        if (toggleShowLabel) toggleShowLabel.hidden = showingOriginal
        if (toggleHideLabel) toggleHideLabel.hidden = !showingOriginal
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
      if (startField) startField.value = ''
      if (endField) endField.value = ''
      if (paragraphField) paragraphField.value = ''
      if (textField) textField.value = ''

      var selection = window.getSelection()
      if (selection) selection.removeAllRanges()
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

    // ------------------------------------------------------------------
    // A server-rendered "Other requires a note" error (govukErrorSummary +
    // govukErrorMessage) clears itself the moment the user changes their
    // radio choice — it was about the previous submission, not necessarily
    // still relevant once they've started picking again.
    // ------------------------------------------------------------------

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

    document.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'tag') clearNoteError()
    })

    // ------------------------------------------------------------------
    // Drag-selection capture
    // ------------------------------------------------------------------

    container.addEventListener('mouseup', function () {
      var selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return

      var range = selection.getRangeAt(0)
      var text = range.toString()
      if (!text.trim()) return

      var startParagraph = closestParagraph(range.startContainer)
      var endParagraph = closestParagraph(range.endContainer)

      // Reject selections that cross a paragraph boundary.
      if (!startParagraph || startParagraph !== endParagraph) {
        selection.removeAllRanges()
        return
      }

      // Reject selections that overlap an already-tagged span.
      if (overlapsExistingHighlight(startParagraph, range)) {
        selection.removeAllRanges()
        return
      }

      var start = textOffsetOfNode(startParagraph, range.startContainer, range.startOffset)
      var end = textOffsetOfNode(startParagraph, range.endContainer, range.endOffset)

      if (start === -1 || end === -1 || start === end) return

      // Clear changeId — this is always a brand new selection, and a
      // stale id left over from previously editing an existing one (via
      // the click handler below) must not carry over and overwrite it.
      if (changeIdField) changeIdField.value = ''
      if (startField) startField.value = start
      if (endField) endField.value = end
      if (paragraphField) paragraphField.value = startParagraph.dataset.paragraphIndex
      if (textField) textField.value = text

      // A fresh selection has nothing to remove yet, and isn't part of a
      // check.html round trip — hide Remove/Cancel and drop any returnTo
      // carried over from a previous edit-existing-redaction visit.
      if (removeButton) removeButton.hidden = true
      if (cancelLink) cancelLink.hidden = true
      if (returnToField) returnToField.value = ''

      openModal(text)
    })

    // ------------------------------------------------------------------
    // Clicking an already-tagged highlight reopens the modal pre-filled
    // with its current category/note, rather than requiring the user to
    // redo the drag from scratch to change or review it.
    // ------------------------------------------------------------------

    container.querySelectorAll('.dcf-highlight__trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var changeId = trigger.dataset.changeId
        var currentTag = trigger.dataset.currentTag || ''
        var currentNote = trigger.dataset.note || ''
        var text = trigger.textContent

        if (changeIdField) changeIdField.value = changeId
        if (startField) startField.value = ''
        if (endField) endField.value = ''
        if (paragraphField) paragraphField.value = ''
        if (textField) textField.value = text

        var radios = document.querySelectorAll('#outline-tag-form input[name="tag"]')
        radios.forEach(function (radio) {
          radio.checked = (radio.value === currentTag)
          // A programmatic .checked assignment doesn't fire a native
          // change event, so govuk-frontend's own radios module won't
          // know to reveal/hide the "Other" conditional note field
          // unless told to — dispatching one lets it run its usual logic.
          if (radio.checked) radio.dispatchEvent(new Event('change', { bubbles: true }))
        })

        var noteFieldEl = document.getElementById('redact-note')
        if (noteFieldEl) noteFieldEl.value = currentNote

        // Editing an existing redaction directly on the page (as opposed to
        // arriving via check.html) — Remove/Cancel are only ever shown when
        // returning from check.html's "Change" link; on-page removal still
        // goes through the table's own Remove action instead. Explicitly
        // re-hide them here in case they were left visible by a prior
        // server-rendered check.html return that's still on screen.
        if (removeButton) removeButton.hidden = true
        if (cancelLink) cancelLink.hidden = true
        if (returnToField) returnToField.value = ''

        openModal(text)
      })
    })
  })
})()
