(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  function focusChange (changeId, currentTag, currentTagLabel) {
    var field = document.getElementById('change-id-field')
    if (field) field.value = changeId

    var select = document.querySelector('#outline-tag-form select[name="tag"]')
    if (select) {
      select.value = currentTag

      // If this select has been progressively enhanced into an
      // accessible-autocomplete, its visible text input is a separate
      // element that doesn't auto-sync when the underlying select's
      // value is set programmatically — update it directly so the
      // displayed text matches (submission itself already uses the
      // select's value above, so this is a display-only step).
      var autocompleteInput = document.querySelector('#outline-tag-form .autocomplete__input')
      if (autocompleteInput) autocompleteInput.value = currentTagLabel || ''
    } else {
      var radios = document.querySelectorAll('#outline-tag-form input[type="radio"]')
      radios.forEach(function (radio) {
        radio.checked = (radio.value === currentTag)
      })
    }

    var panel = document.getElementById('outline-tag-form')
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  ready(function () {
    document.querySelectorAll('.dcf-highlight__trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        focusChange(trigger.dataset.changeId, trigger.dataset.currentTag || '', trigger.dataset.currentTagLabel || '')
      })
    })
  })
})()
