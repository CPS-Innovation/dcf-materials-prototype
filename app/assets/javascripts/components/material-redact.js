(() => {
  var viewer = document.getElementById('material-viewer')
  if (!viewer) return

  function injectRedactLink (toolbarRight) {
    if (toolbarRight.querySelector('[data-action="redact-document"]')) return
    var docActions = toolbarRight.querySelector('details[data-menu="document"]')
    if (!docActions) return

    var link = document.createElement('a')
    link.href = '#'
    link.className = 'govuk-link govuk-!-margin-right-3'
    link.setAttribute('data-action', 'redact-document')
    link.textContent = 'Redact document'

    toolbarRight.insertBefore(link, docActions)
  }

  var observer = new MutationObserver(function () {
    var toolbarRight = viewer.querySelector('.dcf-viewer__toolbar-right')
    if (toolbarRight) injectRedactLink(toolbarRight)
  })
  observer.observe(viewer, { childList: true, subtree: true })

  viewer.addEventListener('click', function (e) {
    var link = e.target.closest('[data-action="redact-document"]')
    if (!link) return
    e.preventDefault()

    var activeTab = viewer.querySelector('.dcf-doc-tab.is-active')
    if (!activeTab) return

    var url    = activeTab.getAttribute('data-url')     || ''
    var title  = activeTab.getAttribute('data-title')   || 'Document'
    var itemId = activeTab.getAttribute('data-item-id') || ''
    var caseId = window.location.pathname.split('/')[2]

    window.location.href =
      '/cases/' + caseId + '/material/redact/scan' +
      '?url='    + encodeURIComponent(url) +
      '&title='  + encodeURIComponent(title) +
      '&itemId=' + encodeURIComponent(itemId)
  })
})()
