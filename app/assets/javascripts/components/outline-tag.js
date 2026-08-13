(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  function focusChange (changeId, currentTag) {
    var field = document.getElementById('change-id-field')
    if (field) field.value = changeId

    var radios = document.querySelectorAll('#outline-tag-form input[type="radio"]')
    radios.forEach(function (radio) {
      radio.checked = (radio.value === currentTag)
    })

    var panel = document.getElementById('outline-tag-form')
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  ready(function () {
    document.querySelectorAll('.dcf-highlight__trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        focusChange(trigger.dataset.changeId, trigger.dataset.currentTag || '')
      })
    })
  })
})()
