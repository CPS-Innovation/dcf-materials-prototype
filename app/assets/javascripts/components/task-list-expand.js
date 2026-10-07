// app/assets/javascripts/components/task-list-expand.js

// Toggles the per-row "More"/"Less" detail panel on the PCD task list table.
// Built as a plain sibling <tr> (not a MOJ component) so it can hold the
// full-width shaded detail panel the design calls for. Known limitation:
// MOJ's sortable-table module re-sorts every <tr> in the tbody independently,
// so a detail row can end up separated from its task row if the table is
// re-sorted while that row is expanded. Acceptable for now while we get the
// layout right; revisit if/when sorting + expand need to work together.
;(function () {
  function toggleDetailRow(button) {
    var row = document.getElementById(button.getAttribute('aria-controls'))
    if (!row) return

    var expanded = button.getAttribute('aria-expanded') === 'true'
    button.setAttribute('aria-expanded', String(!expanded))
    row.hidden = expanded

    var label = button.querySelector('.js-task-more-toggle-label')
    if (label) {
      label.textContent = expanded ? 'Show' : 'Hide'
    }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('.js-task-more-toggle')
    if (!button) return
    event.preventDefault()
    toggleDetailRow(button)
  })
})()
