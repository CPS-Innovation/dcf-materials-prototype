// app/assets/javascripts/components/action-plan-modal.js
//
// Open/close for the action-plan side tray (action-plan-modal.njk). Same
// hidden/is-open toggle and remembered-trigger focus return as
// material-viewer.js's notes modal, but standalone — this tray is opened
// from /cases/:caseId/details, a page with no #material-viewer, so it
// can't hook into that script the way the materials-viewer pages do.
(function () {
  var modal = document.getElementById('dcf-action-plan-modal')
  if (!modal) return

  var lastTrigger = null

  function isOpen () {
    return !modal.hidden
  }

  function openModal (triggerEl) {
    lastTrigger = triggerEl || document.activeElement || null

    modal.hidden = false
    modal.classList.add('is-open')

    var closeButton = modal.querySelector('.dcf-action-plan-modal__close')
    if (closeButton) {
      try { closeButton.focus() } catch (e) {}
    }
  }

  function closeModal () {
    if (!isOpen()) return

    modal.classList.remove('is-open')
    modal.hidden = true

    if (lastTrigger && typeof lastTrigger.focus === 'function') {
      try { lastTrigger.focus() } catch (e) {}
    }
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target && e.target.closest('[data-action="open-action-plan"]')
    if (!trigger) return
    e.preventDefault()
    openModal(trigger)
  })

  document.addEventListener('click', function (e) {
    var closeEl = e.target && e.target.closest('[data-action="close-action-plan"]')
    if (!closeEl) return
    e.preventDefault()
    closeModal()
  })

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault()
      closeModal()
    }
  })

  // "Reason for CPS last update" rows (action-plan-card.njk) truncate to
  // "first 3 words… Show more" and expand in place to the full text with
  // "Show less" trailing it — see text-expander.js for why this needed a
  // real toggle rather than <details>. The tray starts hidden, not
  // removed from the DOM, so this can run immediately rather than
  // waiting for the tray to open.
  if (window.jQuery && window.App && window.App.TextExpander) {
    modal.querySelectorAll('.js-action-plan-reason').forEach(function (el) {
      new window.App.TextExpander({
        container: window.jQuery(el),
        maxWords: 3
      })
    })
  }
})()
