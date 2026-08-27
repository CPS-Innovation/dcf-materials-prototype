(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  // Arrives via the edit check screen's per-row "Change" — that row's
  // original text was just reinstated into the textarea's value server-
  // side, so this only has to find and select it, not reconstruct it.
  ready(function () {
    var textarea = document.getElementById('factual-summary')
    var focusTextEl = document.getElementById('dcf-edit-focus-text')
    if (!textarea || !focusTextEl) return

    var focusText = ''
    try { focusText = JSON.parse(focusTextEl.textContent) } catch (e) {}
    if (!focusText) return

    var value = textarea.value
    var index = value.indexOf(focusText)
    if (index === -1) return

    textarea.focus()
    textarea.setSelectionRange(index, index + focusText.length)

    // Textareas have no native "scroll to selection" API — approximate by
    // scrolling proportionally to which line the selection starts on, so
    // it lands in view rather than the user having to hunt for it in a
    // long passage.
    var lineNumber = value.slice(0, index).split('\n').length
    var totalLines = value.split('\n').length
    var lineHeight = textarea.scrollHeight / totalLines
    textarea.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight)
  })
})()
