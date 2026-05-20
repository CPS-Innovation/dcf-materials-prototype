(() => {
  var viewer = document.getElementById('material-viewer')
  if (!viewer) return

  function injectRedactLink (opsBar) {
    if (opsBar.querySelector('[data-action="redact-document"]')) return
    var actions = opsBar.querySelector('.dcf-ops-actions')
    if (!actions) return

    var sep = document.createElement('span')
    sep.setAttribute('aria-hidden', 'true')
    sep.className = 'govuk-!-margin-horizontal-2'
    sep.innerHTML = '&nbsp; | &nbsp;'

    var link = document.createElement('a')
    link.href = '#'
    link.className = 'govuk-link'
    link.setAttribute('data-action', 'redact-document')
    link.textContent = 'Redact document'

    actions.appendChild(sep)
    actions.appendChild(link)
  }

  var observer = new MutationObserver(function () {
    var opsBar = viewer.querySelector('.dcf-viewer__ops-bar')
    if (opsBar) injectRedactLink(opsBar)
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
