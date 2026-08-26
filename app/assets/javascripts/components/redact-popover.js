(function () {
  function ready (fn) { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn) } else { fn() } }

  // Shared with redact-select.js — see redact-text-offsets.js.
  var rangeAtOffset = window.DCFRedactText.rangeAtOffset
  var clearSelectionFields = window.DCFRedactText.clearSelectionFields
  var readHighlightTrigger = window.DCFRedactText.readHighlightTrigger
  var captureSelectionFromMouseup = window.DCFRedactText.captureSelectionFromMouseup
  var initShowOriginalToggle = window.DCFRedactText.initShowOriginalToggle
  var clearNoteError = window.DCFRedactText.clearNoteError
  var isVisible = window.DCFRedactText.isVisible
  var createMatchStepper = window.DCFRedactText.createMatchStepper
  var createChangeLinkTracker = window.DCFRedactText.createChangeLinkTracker

  ready(function () {
    var container = document.querySelector('.js-redact-paragraphs')
    var popover = document.getElementById('dcf-redact-popover')
    if (!container || !popover) return

    initShowOriginalToggle(container)

    var changeIdField = document.getElementById('popover-change-id-field')
    var startField = document.getElementById('popover-start-field')
    var endField = document.getElementById('popover-end-field')
    var paragraphField = document.getElementById('popover-paragraph-field')
    var textField = document.getElementById('popover-text-field')
    var returnToField = document.getElementById('popover-return-to-field')
    var tagSelect = document.getElementById('popover-tag-select')
    var redactButton = document.getElementById('popover-redact-button')
    var findMatchingButton = document.getElementById('popover-find-matching-button')
    var continueButton = document.getElementById('popover-continue-button')
    var editActionsGroup = document.getElementById('popover-edit-actions')
    var initialActionsGroup = document.getElementById('popover-initial-actions')
    var matchPanel = document.getElementById('popover-match-panel')
    var matchCountEl = document.getElementById('popover-match-count')
    var viewPreviousButton = document.getElementById('popover-view-previous')
    var viewNextButton = document.getElementById('popover-view-next')
    var redactAllButton = document.getElementById('popover-redact-all-button')
    var noteGroup = document.getElementById('popover-note-group')

    var changeLinkTracker = createChangeLinkTracker({ changeIdField: changeIdField, returnToField: returnToField })

    // ------------------------------------------------------------------
    // Open/close/position — unlike v4's fixed right-docked modal, this
    // popover is placed via top/left next to whatever it's anchored to
    // (a live drag-selection here; an existing highlight once the
    // check.html round trip is wired up). Document-relative coordinates
    // (viewport rect + scroll offset) so it stays put if the page is
    // scrolled after it opens, rather than a fixed on-screen position.
    // ------------------------------------------------------------------

    function isPopoverOpen () {
      return !!(popover && !popover.hidden)
    }

    function positionPopoverAt (anchorRect) {
      // Measuring via getBoundingClientRect works as soon as the popover
      // is un-hidden, even before the browser paints, so there's no
      // visible flash between showing it and moving it into place.
      var popoverRect = popover.getBoundingClientRect()
      var viewportWidth = document.documentElement.clientWidth
      var viewportHeight = document.documentElement.clientHeight
      var margin = 8
      var arrowGap = 12
      var anchorCenterX = (anchorRect.left + anchorRect.right) / 2

      // Centre the popover on the selection, then clamp to the viewport.
      var left = anchorCenterX - popoverRect.width / 2
      if (left < margin) left = margin
      if (left + popoverRect.width > viewportWidth - margin) {
        left = viewportWidth - margin - popoverRect.width
      }

      // The arrow points at the selection's actual centre, which is only
      // the popover's own centre when nothing needed clamping — pin it to
      // the true anchor position (kept a little clear of the rounded
      // edges so it never renders past the box's corners).
      var arrowMargin = 16
      var arrowLeft = anchorCenterX - left
      if (arrowLeft < arrowMargin) arrowLeft = arrowMargin
      if (arrowLeft > popoverRect.width - arrowMargin) arrowLeft = popoverRect.width - arrowMargin
      popover.style.setProperty('--dcf-arrow-left', Math.round(arrowLeft) + 'px')

      // Every value up to this point is viewport-relative (matching
      // anchorRect/popoverRect/viewportHeight, all from getBoundingClientRect
      // or clientHeight) — window.scrollY is only added once, right at the
      // end, to convert to the document-relative coordinates `position:
      // absolute` needs. Mixing the two mid-calculation (as an earlier
      // version of this did, comparing a viewport-relative `top` against
      // `viewportHeight + window.scrollY`) silently produced wildly wrong
      // positions on any page that wasn't scrolled to the very top.
      var top
      var roomAbove = anchorRect.top - arrowGap
      var roomBelow = viewportHeight - anchorRect.bottom - arrowGap

      popover.classList.remove('dcf-redact-popover--below')

      if (roomAbove >= popoverRect.height) {
        top = anchorRect.top - popoverRect.height - arrowGap
      } else if (roomBelow >= popoverRect.height) {
        top = anchorRect.bottom + arrowGap
        popover.classList.add('dcf-redact-popover--below')
      } else if (roomAbove >= roomBelow) {
        // Doesn't fully fit either side — use whichever has more room,
        // clamped to the viewport rather than left to overflow it.
        top = Math.max(margin, anchorRect.top - popoverRect.height - arrowGap)
      } else {
        top = anchorRect.bottom + arrowGap
        popover.classList.add('dcf-redact-popover--below')
        if (top + popoverRect.height > viewportHeight - margin) {
          top = viewportHeight - margin - popoverRect.height
        }
      }

      popover.style.left = Math.round(left + window.scrollX) + 'px'
      popover.style.top = Math.round(top + window.scrollY) + 'px'
    }

    var justOpened = false
    var currentAnchorRect = null

    var matchStepper = createMatchStepper({
      container: container,
      startField: startField,
      endField: endField,
      paragraphField: paragraphField,
      textField: textField,
      matchPanel: matchPanel,
      matchCountEl: matchCountEl,
      redactAllButton: redactAllButton,
      initialActionsGroup: initialActionsGroup,
      findMatchingButton: findMatchingButton,
      viewPreviousButton: viewPreviousButton,
      viewNextButton: viewNextButton,
      // Follow the popover to whichever match is now on screen — without
      // this it stays anchored to wherever it was first opened, which
      // stops tracking (and can end up obscuring) matches further down
      // the document as View previous/next steps through them.
      onMatchShown: function (scrollTarget) {
        currentAnchorRect = scrollTarget.getBoundingClientRect()
        positionPopoverAt(currentAnchorRect)
      }
    })

    function openPopoverAt (anchorRect) {
      currentAnchorRect = anchorRect
      popover.hidden = false
      popover.classList.add('is-open')
      positionPopoverAt(anchorRect)
      updateInitialButtonStates()

      justOpened = true

      var focusEl = popover.querySelector('#popover-tag-select')
      if (focusEl) { try { focusEl.focus() } catch (e) {} }
    }

    function clearPendingSelection () {
      clearSelectionFields({ startField: startField, endField: endField, paragraphField: paragraphField, textField: textField })
    }

    function closePopover () {
      if (!isPopoverOpen()) return
      popover.classList.remove('is-open')
      popover.hidden = true
      clearPendingSelection()
      // Only the match-panel DOM/state, not which action group is showing —
      // closing shouldn't change that (e.g. a Change-link visit arrives in
      // the Remove/Cancel state and must stay there if reopened later, not
      // silently flip back to the initial redact/find-matching state).
      matchStepper.clearMatchState()
    }

    // While Continue/Remove/Cancel are showing (a change/edit-state visit),
    // the popover is modal: the user must pick one of those three rather
    // than dismiss it by clicking away or pressing Escape.
    function isLockedInEditState () {
      return isVisible(editActionsGroup)
    }

    document.addEventListener('click', function (e) {
      if (!isPopoverOpen()) return
      if (isLockedInEditState()) return

      // The same mouseup that opens the popover is immediately followed by
      // a click event on the paragraph text — without this guard, that
      // click would be seen as "outside the popover" and close it the
      // instant it opens.
      if (justOpened) {
        justOpened = false
        return
      }

      if (popover.contains(e.target)) return
      closePopover()
    })

    document.addEventListener('keydown', function (e) {
      if (!isPopoverOpen()) return
      if (isLockedInEditState()) return
      if (e.key === 'Escape' || e.key === 'Esc') closePopover()
    })

    // ------------------------------------------------------------------
    // Select-driven button states — both initial actions start disabled
    // until a redaction category is chosen. "Other" also needs a note —
    // a plain <select> has no built-in conditional-reveal like
    // govukRadios does, so the note field's visibility is handled here
    // instead of natively.
    // ------------------------------------------------------------------

    function updateInitialButtonStates () {
      var hasTag = !!(tagSelect && tagSelect.value)
      if (redactButton) redactButton.disabled = !hasTag
      if (findMatchingButton) findMatchingButton.disabled = !hasTag
    }

    // The redaction type this popover's editing session started with —
    // Continue only becomes active once the dropdown is changed away from
    // this, since picking the same type again isn't a change to apply.
    // Set whenever edit mode (Remove/Cancel/Continue) is entered: on load,
    // if the server rendered straight into it, and when re-clicking the
    // highlight this page was opened for (see the trigger click handler).
    var editingOriginalTag = (isVisible(editActionsGroup) && tagSelect) ? tagSelect.value : ''

    function updateContinueButtonState () {
      if (!continueButton) return
      var hasTag = !!(tagSelect && tagSelect.value)
      continueButton.disabled = !hasTag || tagSelect.value === editingOriginalTag
    }

    function updateNoteVisibility () {
      if (noteGroup) noteGroup.hidden = !(tagSelect && tagSelect.value === 'other')
    }

    if (tagSelect) {
      tagSelect.addEventListener('change', function () {
        updateInitialButtonStates()
        updateContinueButtonState()
        updateNoteVisibility()
        clearNoteError()

        // Showing/hiding the note field changes the popover's height —
        // without this, `top` stays wherever it was calculated for the
        // *previous* height, so the box grows downward over the text
        // instead of staying anchored to it (same fix as Find matching
        // text needed for the same reason).
        if (currentAnchorRect) positionPopoverAt(currentAnchorRect)
      })
    }

    // ------------------------------------------------------------------
    // Drag-selection capture — same paragraph-boundary/overlap rules as
    // v4's redact-select.js, using the shared offset helpers.
    // ------------------------------------------------------------------

    container.addEventListener('mouseup', function () {
      // Clear any leftover step-through highlight/state first, before the
      // overlap check inside captureSelectionFromMouseup runs — a stale
      // temporary <mark> left in the DOM from a previous "Find matching
      // text" session would otherwise itself count as an existing
      // highlight and wrongly reject a new selection that crosses it.
      matchStepper.resetMatchPanel()

      var captured = captureSelectionFromMouseup()
      if (!captured) return

      if (changeIdField) changeIdField.value = ''
      if (startField) startField.value = captured.start
      if (endField) endField.value = captured.end
      if (paragraphField) paragraphField.value = captured.paragraphIndex
      if (textField) textField.value = captured.text
      if (returnToField) returnToField.value = ''
      if (tagSelect) tagSelect.value = ''

      // A fresh selection has nothing to remove yet, and isn't part of a
      // check.html round trip — hide Remove/Cancel even if they were left
      // visible by a server-rendered check.html return still on screen.
      if (editActionsGroup) editActionsGroup.hidden = true

      openPopoverAt(captured.anchorRect)
    })

    // ------------------------------------------------------------------
    // Clicking an already-tagged highlight reopens the popover anchored
    // to it, pre-filled with its current category — same idea as v4's
    // click-to-reopen, minus Remove/Cancel: those are only ever shown
    // when arriving via check.html's "Change" link, not from an on-page
    // click — on-page removal still goes through the table's own Remove
    // action instead. EXCEPT when the highlight clicked is the very one
    // this page was opened for via that Change link — re-clicking that
    // one restores Remove/Cancel rather than switching to the normal
    // on-page re-tag actions, so closing/reopening it doesn't change
    // what the user is able to do with it.
    // ------------------------------------------------------------------

    container.querySelectorAll('.dcf-highlight__trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var data = readHighlightTrigger(trigger, {
          changeIdField: changeIdField,
          startField: startField,
          endField: endField,
          paragraphField: paragraphField,
          textField: textField
        })

        if (tagSelect) tagSelect.value = data.currentTag

        // A programmatic .value assignment doesn't fire a native change
        // event, so the note field's visibility needs updating explicitly
        // here rather than relying on the change listener above.
        updateNoteVisibility()

        if (changeLinkTracker.isChangeLinkRedaction(data.changeId)) {
          matchStepper.clearMatchState()
          if (returnToField) returnToField.value = changeLinkTracker.returnTo
          if (initialActionsGroup) initialActionsGroup.hidden = true
          if (editActionsGroup) editActionsGroup.hidden = false
          editingOriginalTag = data.currentTag
          updateContinueButtonState()
        } else {
          matchStepper.resetMatchPanel()
          if (returnToField) returnToField.value = ''
          if (editActionsGroup) editActionsGroup.hidden = true
        }

        var anchorRect = trigger.getBoundingClientRect()
        openPopoverAt(anchorRect)
      })
    })

    // ------------------------------------------------------------------
    // Server-rendered already open, with no positioning applied yet —
    // either arriving via check.html's "Change" link (an existing tagged
    // highlight, identified by changeId) or reopening after a failed
    // "Other requires a note" submit on a brand new, not-yet-tagged
    // selection (identified by start/end/paragraphIndex instead, since
    // there's no <mark> for it to anchor to). Remove/Cancel's visibility
    // is already correct from the server render, nothing to do there.
    // ------------------------------------------------------------------

    if (popover.classList.contains('is-open')) {
      var initialChangeId = changeIdField ? changeIdField.value : ''
      var firstChangeId = initialChangeId ? initialChangeId.split(',')[0] : ''
      var initialTrigger = firstChangeId
        ? container.querySelector('.dcf-highlight__trigger[data-change-id="' + firstChangeId + '"]')
        : null

      if (initialTrigger) {
        currentAnchorRect = initialTrigger.getBoundingClientRect()
        positionPopoverAt(currentAnchorRect)
      } else if (paragraphField && paragraphField.value !== '') {
        var initialParagraphEl = container.querySelectorAll('.js-tag-paragraph')[parseInt(paragraphField.value, 10)]
        var initialRange = initialParagraphEl
          ? rangeAtOffset(initialParagraphEl, parseInt(startField.value, 10), parseInt(endField.value, 10))
          : null

        if (initialRange) {
          currentAnchorRect = initialRange.getBoundingClientRect()
          positionPopoverAt(currentAnchorRect)
        }
      }

      updateInitialButtonStates()
    }
  })
})()
