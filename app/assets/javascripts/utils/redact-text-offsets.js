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

        if (!startSet && start >= offset && start <= nextOffset) {
          range.setStart(node, start - offset)
          startSet = true
        }
        if (!endSet && end >= offset && end <= nextOffset) {
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

  window.DCFRedactText = {
    textOffsetOfNode: textOffsetOfNode,
    rangeAtOffset: rangeAtOffset,
    closestParagraph: closestParagraph,
    overlapsExistingHighlight: overlapsExistingHighlight,
    countOccurrences: countOccurrences,
    clearSelectionFields: clearSelectionFields,
    readHighlightTrigger: readHighlightTrigger,
    captureSelectionFromMouseup: captureSelectionFromMouseup
  }
})()
