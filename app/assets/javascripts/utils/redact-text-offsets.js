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

  window.DCFRedactText = {
    textOffsetOfNode: textOffsetOfNode,
    rangeAtOffset: rangeAtOffset,
    closestParagraph: closestParagraph,
    overlapsExistingHighlight: overlapsExistingHighlight,
    countOccurrences: countOccurrences
  }
})()
