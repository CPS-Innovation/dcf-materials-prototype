//
// For guidance on how to add JavaScript see:
// https://prototype-kit.service.gov.uk/docs/adding-css-javascript-and-images
//

window.GOVUKPrototypeKit.documentReady(() => {
  // Add JavaScript here

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest('[data-action="reset-material-testing-data"]')
    if (!btn) return
    e.preventDefault()

    var prefixes = ['matStatus:', 'matIsNew:', 'matClosed:', 'matVisited:', 'matHasNotes:', 'matNotes:']
    try {
      Object.keys(localStorage).forEach(function (key) {
        var matches = prefixes.some(function (prefix) {
          return key.indexOf(prefix) === 0
        })
        if (matches) localStorage.removeItem(key)
      })
    } catch (err) {}

    window.location.reload()
  })
})
