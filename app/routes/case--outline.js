const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { diffWords } = require('diff')
const redactionTypes = require('../data/redaction-types.js')
// v2-only: non-redaction reasons a change might be tagged (e.g. a typo fix
// rather than a PII redaction). Kept separate from redactionTypes so v1/v3/v4
// don't see them as selectable options, but folded into ALL_TAGS below so
// anywhere that resolves a tag value to its display text (the check screen,
// the activity log, the click-to-focus sync) still works regardless of
// which list a given tag came from.
const editReasonTags = require('../data/edit-reason-tags.js')
const ALL_TAGS = redactionTypes.concat(editReasonTags)
const EDIT_REASON_TAG_VALUES = editReasonTags.map(t => t.value)
const documentTypes = require('../data/redaction-document-types.js')
const DEFAULT_DOCUMENT_TYPE = 'mg-5'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function todayGovukDate () {
  const d = new Date()
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

// Case-sensitive, non-overlapping count of `needle` within `haystack` —
// server-side mirror of redact-select.js's countOccurrences, used to show
// an accurate occurrence count when the redact modal reopens after a
// failed "Other requires a note" submit (the client-side count only runs
// on a live drag-selection, not a server-rendered reload).
function countOccurrences (haystack, needle) {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

// Diffs before/after and returns:
// - changes: one entry per detected change, paired removed+added text, with an id
// - parts: the same diff, flattened, annotated with changeId, in original reading order
//          (used to render the running text with inline highlights)
function analyseEdit (before, after) {
  const diffed = diffWords(before || '', after || '')
  const changes = []
  const parts = []

  for (let i = 0; i < diffed.length; i++) {
    const part = diffed[i]

    if (part.removed) {
      const next = diffed[i + 1]
      const id = changes.length

      if (next && next.added) {
        changes.push({ id, removedText: part.value, addedText: next.value })
        parts.push({ type: 'removed', changeId: id, value: part.value })
        parts.push({ type: 'added', changeId: id, value: next.value })
        i++
      } else {
        changes.push({ id, removedText: part.value, addedText: '' })
        parts.push({ type: 'removed', changeId: id, value: part.value })
      }
    } else if (part.added) {
      const id = changes.length
      changes.push({ id, removedText: '', addedText: part.value })
      parts.push({ type: 'added', changeId: id, value: part.value })
    } else {
      parts.push({ type: 'unchanged', value: part.value })
    }
  }

  return { changes, parts }
}

// v4's drag-select flow has no diff to derive changes from (before and
// after are always identical — nothing is ever edited, only annotated).
// This builds the same { changes, parts } shape analyseEdit produces, but
// from a stored list of selections against the original text instead —
// so every downstream consumer (buildTagViewData, buildCheckViewData,
// commitOutlineEdit) can treat a drag-selected span exactly like a
// detected diff change, with no special-casing needed anywhere else.
// selections: [{ id, paragraphIndex, start, end }] — start/end are
// character offsets into that paragraph's own text (not the whole
// document), matching what redact-select.js can actually compute
// client-side (it only ever walks one <p> at a time). Paragraph breaks
// are re-inserted as '\n\n' within the 'unchanged' stream, so
// splitIntoParagraphs (which already splits on '\n\n') needs no changes
// to handle either source.
function buildSelectionParts (text, selections) {
  const rawParagraphs = (text || '').split('\n\n')
  const changes = []
  const parts = []

  rawParagraphs.forEach((paragraphText, paragraphIndex) => {
    const paragraphSelections = selections
      .filter(s => s.paragraphIndex === paragraphIndex)
      .sort((a, b) => a.start - b.start)

    let cursor = 0

    paragraphSelections.forEach(selection => {
      if (selection.start > cursor) {
        parts.push({ type: 'unchanged', value: paragraphText.slice(cursor, selection.start) })
      }

      const removedText = paragraphText.slice(selection.start, selection.end)
      changes.push({ id: selection.id, removedText, addedText: '' })
      parts.push({ type: 'removed', changeId: selection.id, value: removedText })

      cursor = selection.end
    })

    if (cursor < paragraphText.length) {
      parts.push({ type: 'unchanged', value: paragraphText.slice(cursor) })
    }

    if (paragraphIndex < rawParagraphs.length - 1) {
      parts.push({ type: 'unchanged', value: '\n\n' })
    }
  })

  return { changes, parts }
}

// Picks the right { changes, parts } source depending on how this
// outlineEdit was started — v4's drag-select sessions (mode: 'select')
// use buildSelectionParts; everything else (v1/v2/v3's edit-then-diff
// flow) uses the existing word-diff.
function getChangesAndParts (outlineEdit) {
  return outlineEdit.mode === 'select'
    ? buildSelectionParts(outlineEdit.before, outlineEdit.selections || [])
    : analyseEdit(outlineEdit.before, outlineEdit.after)
}

// Groups the flat parts list into paragraphs, splitting on blank-line breaks
// while keeping each segment's type/changeId intact.
function splitIntoParagraphs (parts) {
  const paragraphs = [[]]

  parts.forEach(part => {
    const segments = part.value.split('\n\n')
    segments.forEach((segment, i) => {
      if (i > 0) paragraphs.push([])
      if (segment.length) {
        paragraphs[paragraphs.length - 1].push({ ...part, value: segment })
      }
    })
  })

  return paragraphs.filter(paragraph => paragraph.length)
}

const TAG_VARIANTS = ['v2', 'v3', 'v4']
const CHECK_VARIANTS = [null, 'v2', 'v3', 'v4']

// Builds the tag-screen URL for a given variant, falling back to the
// default screen if the variant isn't recognised.
function tagPath (caseId, variant) {
  return TAG_VARIANTS.includes(variant)
    ? `/cases/${caseId}/outline/tag/${variant}`
    : `/cases/${caseId}/outline/tag`
}

// Builds the check-screen URL for a given variant, mirroring tagPath.
function checkPath (caseId, variant) {
  return TAG_VARIANTS.includes(variant)
    ? `/cases/${caseId}/outline/tag/${variant}/check`
    : `/cases/${caseId}/outline/tag/check`
}

// Shared by the edit form's POST handlers (default + v2/v3 variants):
// snapshots the current factual summary as "before", the submitted
// textarea as "after", and resets any previous tagging progress.
async function saveOutlineEdit (req, caseId) {
  const _case = await prisma.case.findUnique({ where: { id: caseId } })

  req.session.data.outlineEdit = {
    before: resolveEditBaselineText(req, _case),
    after: req.body.factualSummary || '',
    copyToCip: req.body.changedName || null,
    tags: {},
    removed: {}
  }
}

// Takes the last/first n words of a string, used to build a short context
// snippet either side of a change without needing the full paragraph.
function contextWords (text, n, fromEnd) {
  if (!text) return ''
  const words = text.trim().split(/\s+/).filter(Boolean)
  const slice = fromEnd ? words.slice(-n) : words.slice(0, n)
  return slice.join(' ')
}

// Finds the nearest unchanged text immediately before/after a change's
// parts, trimmed to a few words either side (used by v4's summary list
// and standalone tag page, which don't show the full running paragraph).
function buildChangeContext (parts, changeId, wordCount = 6) {
  const changeIndexes = parts.reduce((acc, part, i) => {
    if (part.changeId === changeId) acc.push(i)
    return acc
  }, [])

  if (!changeIndexes.length) return { before: '', after: '' }

  const firstIndex = changeIndexes[0]
  const lastIndex = changeIndexes[changeIndexes.length - 1]

  let beforePart = null
  for (let i = firstIndex - 1; i >= 0; i--) {
    if (parts[i].type === 'unchanged') { beforePart = parts[i]; break }
  }

  let afterPart = null
  for (let i = lastIndex + 1; i < parts.length; i++) {
    if (parts[i].type === 'unchanged') { afterPart = parts[i]; break }
  }

  return {
    before: beforePart ? contextWords(beforePart.value, wordCount, true) : '',
    after: afterPart ? contextWords(afterPart.value, wordCount, false) : ''
  }
}

// Wraps `changedText` in the same .dcf-highlight--removed/--added tint
// used on the tag screens' inline highlights, with the surrounding context
// words either side left plain — reusing that existing visual language so
// "what changed" is scannable at a glance in the summary table too.
// Escapes everything by hand since this builds real HTML server-side
// (rendered with `| safe` in the template) rather than relying on
// Nunjucks' auto-escaping — factualSummary is user-editable free text.
function highlightSnippet (contextBefore, changedText, contextAfter, highlightClass) {
  const segments = []
  if (contextBefore) segments.push(escapeHtml(contextBefore))
  segments.push('<mark class="dcf-highlight ' + highlightClass + '">' + escapeHtml(changedText) + '</mark>')
  if (contextAfter) segments.push(escapeHtml(contextAfter))
  return segments.join(' ')
}

// Builds one row-group per change for the edit check ("CYA") screen's
// summary table, in document order. The key label itself now names the
// edit (Added/Deleted/Original/Replacement text), so there's no separate
// Edit type row. primaryText is always present — the removed text for a
// Deleted or Replaced change, the added text for a pure Added change — with
// buildChangeContext's surrounding words either side so it reads in
// context. replacementText only exists for Replaced (the added text half
// of the swap); Added/Deleted are single-row since there's only one side
// to show. Paragraph number reuses the same paragraphNumberByChangeId
// approach as buildTagViewData's sidebar cards — true rendered line
// numbers aren't computable server-side (they depend on viewport
// width/font size), so paragraph number is the nearest reliable
// "where is this" a request can answer.
function buildEditCheckRows (outlineEdit) {
  const { changes, parts } = getChangesAndParts(outlineEdit)
  const paragraphs = splitIntoParagraphs(parts)

  const paragraphNumberByChangeId = {}
  paragraphs.forEach((paragraph, index) => {
    paragraph.forEach(part => {
      if (part.changeId !== undefined && !(part.changeId in paragraphNumberByChangeId)) {
        paragraphNumberByChangeId[part.changeId] = index + 1
      }
    })
  })

  return changes.map(change => {
    const context = buildChangeContext(parts, change.id, 5)
    const isReplace = Boolean(change.removedText) && Boolean(change.addedText)

    const type = isReplace
      ? 'Replaced'
      : change.removedText
        ? 'Deleted'
        : 'Added'

    // Both halves of a Replace share the same class — they're one change,
    // not a delete-then-add, so the CYA screen ties them together with one
    // colour rather than splitting them into Deleted's/Added's.
    const highlightClass = isReplace
      ? 'dcf-highlight--edit-replaced'
      : change.removedText
        ? 'dcf-highlight--edit-deleted'
        : 'dcf-highlight--edit-added'

    const primaryText = change.removedText
      ? highlightSnippet(context.before, change.removedText, context.after, highlightClass)
      : highlightSnippet(context.before, change.addedText, context.after, highlightClass)

    const replacementText = isReplace
      ? highlightSnippet(context.before, change.addedText, context.after, highlightClass)
      : ''

    return {
      changeId: change.id,
      type: type,
      primaryText: primaryText,
      replacementText: replacementText,
      // Raw (no context words, no highlight markup) — used to build the
      // "Change" link's focus target once this change is reverted, since
      // reverting restores exactly this plain text at that spot.
      removedText: change.removedText,
      paragraphNumber: paragraphNumberByChangeId[change.id] || null
    }
  })
}

// Reconstructs outlineEdit.after with one specific change reverted back to
// its original (before) text, leaving every other change untouched — used
// by the edit check screen's per-row "Change" action, which reinstates
// that one change's original wording (rather than un-writing the user's
// previous edit for them) so they can re-edit it fresh.
function revertChange (outlineEdit, changeId) {
  const { parts } = getChangesAndParts(outlineEdit)
  return parts
    .filter(part => {
      if (part.type === 'unchanged') return true
      if (String(part.changeId) === String(changeId)) return part.type === 'removed'
      return part.type !== 'removed'
    })
    .map(part => part.value)
    .join('')
}

// Builds the "Undo" cell's markup for a tagged-change table row: a small
// POST form styled as a link, so undoing is a real state change (not a
// bare GET link) but doesn't need any JS to work. Optional `label`
// overrides the button text (e.g. "Remove" on the check screen) and
// `returnTo` overrides where it redirects back to (defaults to the
// variant's tag screen via tagPath).
function undoCellHtml (caseId, variant, changeId, label, returnTo) {
  return `<form method="post" action="/cases/${caseId}/outline/tag/undo" class="dcf-undo-form">
    <input type="hidden" name="_csrf" value="">
    <input type="hidden" name="variant" value="${variant || ''}">
    <input type="hidden" name="changeId" value="${changeId}">
    ${returnTo ? `<input type="hidden" name="returnTo" value="${returnTo}">` : ''}
    <button type="submit" class="dcf-link-button">${label || 'Undo'}</button>
  </form>`
}

// Shared by all 4 tag-screen GET handlers: builds the diff/highlight data
// a tag template needs to render. editIds/editReturnTo are v4-only — set
// when arriving via check.html's "Change" link, telling the modal to open
// already showing that redaction rather than requiring a fresh drag.
function buildTagViewData (outlineEdit, editIds, editReturnTo) {
  const tags = outlineEdit.tags || {}
  const { changes, parts } = getChangesAndParts(outlineEdit)

  const annotatedParts = parts.map(part => {
    if (part.type === 'unchanged') return part
    const tagged = tags[part.changeId]
    const typeEntry = tagged ? ALL_TAGS.find(t => t.value === tagged.tag) : null
    // Edit-reason tags (Fixed typo / Added new text) describe non-redaction
    // edits, so the new wording isn't something to hide — only the old
    // (removed) side blacks out; the added side stays visible as normal.
    const isEditReason = !!tagged && EDIT_REASON_TAG_VALUES.includes(tagged.tag)
    return {
      ...part,
      tagged: !!tagged,
      redacted: !!tagged && !(part.type === 'added' && isEditReason),
      currentTag: tagged ? tagged.tag : '',
      currentTagLabel: typeEntry ? typeEntry.text : '',
      currentNote: tagged ? (tagged.note || '') : ''
    }
  })

  const paragraphs = splitIntoParagraphs(annotatedParts)

  // Maps each changeId to the (1-indexed) paragraph it first appears in —
  // used by v2's sidebar cards to disambiguate repeated words, since actual
  // rendered line numbers aren't something the backend can compute (they
  // depend on viewport width/font size).
  const paragraphNumberByChangeId = {}
  paragraphs.forEach((paragraph, index) => {
    paragraph.forEach(part => {
      if (part.changeId !== undefined && !(part.changeId in paragraphNumberByChangeId)) {
        paragraphNumberByChangeId[part.changeId] = index + 1
      }
    })
  })

  const taggedCards = changes
    .filter(change => tags[change.id])
    .map(change => {
      const tag = tags[change.id].tag
      const typeEntry = ALL_TAGS.find(t => t.value === tag)

      return {
        id: change.id,
        text: change.removedText || change.addedText,
        previousText: change.removedText,
        currentText: change.addedText,
        isEditReason: EDIT_REASON_TAG_VALUES.includes(tag),
        tagLabel: typeEntry ? typeEntry.text : tag,
        paragraphNumber: paragraphNumberByChangeId[change.id],
        date: tags[change.id].date
      }
    })

  // v4's redaction table: groups taggedCards by (text, category) so that
  // e.g. 9 instances of the same word tagged the same way via "Redact all"
  // show as a single row with an instance count, rather than 9 identical
  // rows. Different text or a different category stays a separate group.
  const groupedRedactions = []
  const groupIndexByKey = {}

  taggedCards.forEach(card => {
    const key = card.text + ' ' + card.tagLabel

    if (groupIndexByKey[key] === undefined) {
      groupIndexByKey[key] = groupedRedactions.length
      groupedRedactions.push({
        text: card.text,
        tagLabel: card.tagLabel,
        date: card.date,
        instanceCount: 1,
        changeIds: [card.id]
      })
    } else {
      const group = groupedRedactions[groupIndexByKey[key]]
      group.instanceCount++
      group.changeIds.push(card.id)
    }
  })

  // v4's modal can be server-rendered already open, pre-filled, from two
  // different triggers — both produce the same modalState shape:
  //   1. A failed "Other requires a note" submission — a flash-message-style
  //      flag (same pattern the old tagError/tagSuccess fields used), read
  //      once and cleared so it only shows immediately after the failed
  //      submit, not on every subsequent load.
  //   2. An explicit request to edit an existing redaction (or grouped
  //      batch) — arriving via check.html's "Change" link, or clicking a
  //      tagged highlight (client-side, doesn't need this — see
  //      redact-select.js). editIds carries every id in the group so
  //      "Redact"/"Redact all"/"Remove" can all act on the whole group.
  const noteErrorFlag = outlineEdit.noteError || null
  delete outlineEdit.noteError

  let modalState = null

  if (noteErrorFlag) {
    modalState = {
      changeId: noteErrorFlag.changeId,
      start: noteErrorFlag.start || '',
      end: noteErrorFlag.end || '',
      paragraphIndex: noteErrorFlag.paragraphIndex || '',
      text: noteErrorFlag.text,
      tag: noteErrorFlag.tag,
      note: '',
      returnTo: noteErrorFlag.returnTo || '',
      hasError: true,
      occurrenceCount: countOccurrences(outlineEdit.before || '', noteErrorFlag.text)
    }
  } else if (editIds && editIds.length) {
    const change = changes.find(c => String(c.id) === editIds[0])
    const tagData = tags[editIds[0]]

    if (change && tagData) {
      const text = change.removedText || change.addedText
      modalState = {
        changeId: editIds.join(','),
        text,
        tag: tagData.tag,
        note: tagData.note || '',
        returnTo: editReturnTo || '',
        hasError: false,
        occurrenceCount: countOccurrences(outlineEdit.before || '', text)
      }
    }
  }

  const errorSummary = (modalState && modalState.hasError)
    ? [{ text: 'Enter a note', href: '#redact-note' }]
    : []

  return {
    paragraphs,
    redactionTypes,
    editReasonTags,
    totalChanges: changes.length,
    taggedCards,
    // v4's redact modal needs the whole document's plain text client-side,
    // to count exact-match occurrences of a drag-selection the instant it's
    // made (no server round-trip before the modal opens).
    documentText: outlineEdit.before,
    modalState,
    errorSummary,
    groupedRedactions
  }
}

// Same idea as undoCellHtml, but for v4's "Remove" action (permanently
// dismisses a change rather than clearing its tag).
function removeCellHtml (caseId, variant, changeId) {
  return `<form method="post" action="/cases/${caseId}/outline/tag/remove" class="dcf-undo-form">
    <input type="hidden" name="_csrf" value="">
    <input type="hidden" name="variant" value="${variant || ''}">
    <input type="hidden" name="changeId" value="${changeId}">
    <button type="submit" class="dcf-link-button">Remove</button>
  </form>`
}

// Builds the data for v4's summary-list screen: one row per non-removed
// change, with a little surrounding context and an Undo/Remove action
// form (the snippet/status text itself stays as plain data so the
// template can render it through Nunjucks' auto-escaping, rather than
// building HTML containing user-edited text here in JS).
function buildSummaryListViewData (outlineEdit, caseId) {
  const tags = outlineEdit.tags || {}
  const removed = outlineEdit.removed || {}
  const { changes, parts } = analyseEdit(outlineEdit.before, outlineEdit.after)

  const activeChanges = changes.filter(change => !removed[change.id])

  const rows = activeChanges.map(change => {
    const context = buildChangeContext(parts, change.id)
    const tagged = tags[change.id]
    const typeEntry = tagged ? redactionTypes.find(t => t.value === tagged.tag) : null

    return {
      id: change.id,
      contextBefore: context.before,
      removedText: change.removedText,
      addedText: change.addedText,
      contextAfter: context.after,
      tagged: !!tagged,
      currentTagLabel: typeEntry ? typeEntry.text : '',
      actionHtml: tagged
        ? undoCellHtml(caseId, 'v4', change.id)
        : removeCellHtml(caseId, 'v4', change.id)
    }
  })

  const successMessage = outlineEdit.tagSuccess || null
  delete outlineEdit.tagSuccess

  const errorSummary = outlineEdit.tagError
    ? [{ text: 'You must tag every detected change before continuing' }]
    : []
  delete outlineEdit.tagError

  return {
    rows,
    totalChanges: activeChanges.length,
    successMessage,
    errorSummary
  }
}

// Builds the data for v4's standalone one-change-per-page tag screen.
function buildStandaloneChangeViewData (outlineEdit, changeId) {
  const { changes, parts } = analyseEdit(outlineEdit.before, outlineEdit.after)
  const change = changes.find(c => c.id === parseInt(changeId, 10))

  if (!change) return null

  const context = buildChangeContext(parts, change.id)
  const tags = outlineEdit.tags || {}
  const tagged = tags[change.id]

  return {
    change,
    contextBefore: context.before,
    contextAfter: context.after,
    radioItems: redactionTypes.map(type => ({
      ...type,
      checked: tagged ? tagged.tag === type.value : false
    }))
  }
}

// Builds the per-change data for v4's check screen — one entry per tagged
// change, rendered by the template as a 3-row Text/Redaction type/Date
// summary-list block (with the "Change" action on the Text row only).
// Left as plain data (not pre-built HTML) so the template can render the
// user-edited text through Nunjucks' auto-escaping. Computed live from
// outlineEdit.tags each time (rather than a static snapshot). "Change"
// clears the tag before returning to the tag screen, so the highlight
// shows un-redacted (context visible) and the user re-decides — either a
// real category or "Do not redact" (which drops the change here, same as
// the old Remove action).
function buildCheckViewData (outlineEdit, caseId, variant) {
  const tags = outlineEdit.tags || {}
  const { changes } = getChangesAndParts(outlineEdit)

  const taggedChanges = changes
    .filter(change => tags[change.id])
    .map(change => {
      const typeEntry = ALL_TAGS.find(t => t.value === tags[change.id].tag)

      return {
        id: change.id,
        text: change.removedText || change.addedText,
        category: typeEntry ? typeEntry.text : tags[change.id].tag,
        note: tags[change.id].note || '',
        date: tags[change.id].date
      }
    })

  // Same grouping as v4's redaction table: same text tagged the same way
  // (e.g. a "Redact all" batch) collapses into one summary block with an
  // instance count, instead of one block per individual instance. "Change"
  // on a group clears every id in it (via /outline/tag/undo's existing
  // comma-separated-id support), same as the table's "Remove" does.
  const groupedChanges = []
  const groupIndexByKey = {}

  taggedChanges.forEach(change => {
    const key = change.text + ' ' + change.category

    if (groupIndexByKey[key] === undefined) {
      groupIndexByKey[key] = groupedChanges.length
      groupedChanges.push({
        text: change.text,
        category: change.category,
        note: change.note,
        date: change.date,
        instanceCount: 1,
        ids: [change.id]
      })
    } else {
      const group = groupedChanges[groupIndexByKey[key]]
      group.instanceCount++
      group.ids.push(change.id)
    }
  })

  const documentTypeValue = outlineEdit.documentType || DEFAULT_DOCUMENT_TYPE
  const documentTypeEntry = documentTypes.find(t => t.value === documentTypeValue)
  const checkFormAction = checkPath(caseId, variant)

  return {
    changes: groupedChanges,
    variant,
    backHref: tagPath(caseId, variant),
    checkFormAction,
    documentType: documentTypeEntry ? documentTypeEntry.text : documentTypeValue,
    documentTypeChangeHref: `/cases/${caseId}/outline/tag/document-type?returnTo=${encodeURIComponent(checkFormAction)}`
  }
}

function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Plain-text rendering of the factual summary with every currently-tagged
// span replaced by a "[Redacted <type>]" label — baked directly into
// Case.factualSummary at commit time (both for a fresh redaction commit
// and for prefilling the edit textarea against an in-progress, uncommitted
// one), so factualSummary is always "the latest version" regardless of
// how many times it's been redacted and/or edited, in either order. The
// details page derives its styled (bold label / italic edit) rendering
// straight from factualSummary + factualSummaryOriginal at display time
// (see the redactionEditDisplay filter) rather than from a separately
// stored HTML snapshot — nothing here needs to stay in sync with that.
function buildRedactedPlainText (outlineEdit) {
  const tags = outlineEdit.tags || {}
  const { parts } = getChangesAndParts(outlineEdit)
  const paragraphs = splitIntoParagraphs(parts)

  return paragraphs.map(paragraph => {
    return paragraph.map(part => {
      const tagged = part.type !== 'unchanged' && tags[part.changeId]
      if (tagged) {
        const typeEntry = ALL_TAGS.find(t => t.value === tagged.tag)
        const label = (typeEntry ? typeEntry.text : tagged.tag).toLowerCase()
        return '[Redacted ' + label + ']'
      }
      return part.value
    }).join('')
  }).join('\n\n')
}

// Resolves the text a fresh edit-diff session should treat as its
// baseline — the same state used to prefill the edit textarea (an
// in-progress, uncommitted redaction's current tags, else the plain saved
// wording, which — now that a redaction commit bakes its labels directly
// into factualSummary — already reflects any previously committed
// redaction too) — rather than always the true unredacted original. Used
// both for that prefill and, in saveOutlineEdit, as the diff's "before";
// keeping the two in sync is what stops a redaction (baked into the
// textarea as literal "[Redacted <type>]" text) from itself being picked
// up as an edit change on the check screen, since it then reads
// identically on both sides of the diff.
function resolveEditBaselineText (req, _case) {
  const outlineEdit = req.session.data.outlineEdit
  if (outlineEdit && outlineEdit.mode === 'select' && Object.keys(outlineEdit.tags || {}).length) {
    return buildRedactedPlainText(outlineEdit)
  }
  return _case.factualSummary || ''
}

// Shared commit step: persists the edited factual summary and writes one
// ActivityLog row per currently-tagged change. Recomputed live from
// outlineEdit.tags rather than a pre-taken snapshot, so it stays correct
// even if changes were removed/re-tagged after "Continue" was first
// pressed (e.g. via the check screen). Used by all 4 variants' check
// screen commits.
// Freezes Case.factualSummaryOriginal the first time factualSummary is
// ever about to change — via an edit-confirm or a redaction commit,
// whichever happens first — and never again after that. Returns the
// value to write this time (the case's *current* factualSummary, if
// nothing has frozen it yet), or undefined if it's already frozen, so
// callers can spread it into a Prisma update without touching the field
// at all once it's set.
async function captureOriginalIfUnset (caseId) {
  const existing = await prisma.case.findUnique({
    where: { id: caseId },
    select: { factualSummary: true, factualSummaryOriginal: true }
  })
  return existing.factualSummaryOriginal ? undefined : existing.factualSummary
}

async function commitOutlineEdit (outlineEdit, caseId, userId) {
  const tags = outlineEdit.tags || {}
  const removed = outlineEdit.removed || {}
  const { changes } = getChangesAndParts(outlineEdit)

  const taggedChanges = changes
    .filter(change => !removed[change.id] && tags[change.id])
    .map(change => ({
      removedText: change.removedText,
      addedText: change.addedText,
      tag: tags[change.id].tag
    }))

  const originalToSet = await captureOriginalIfUnset(caseId)

  await prisma.case.update({
    where: { id: caseId },
    data: {
      // Bakes any tagged spans' "[Redacted <type>]" labels directly into
      // factualSummary (not just a separate HTML snapshot) — same
      // plain-text form the edit textarea already prefills with, via
      // resolveEditBaselineText — so factualSummary is unconditionally
      // "the latest version" including this redaction, no matter what
      // happens to it afterward.
      factualSummary: buildRedactedPlainText(outlineEdit),
      factualSummaryRedactedAt: new Date(),
      ...(originalToSet !== undefined && { factualSummaryOriginal: originalToSet })
    }
  })

  for (const change of taggedChanges) {
    const typeEntry = ALL_TAGS.find(t => t.value === change.tag)

    await prisma.activityLog.create({
      data: {
        userId,
        caseId,
        model: 'Case',
        recordId: caseId,
        action: 'UPDATE',
        title: 'Factual summary edited',
        meta: {
          removed: change.removedText,
          added: change.addedText,
          tag: typeEntry ? typeEntry.text : 'Untagged'
        }
      }
    })
  }
}

module.exports = router => {
  router.get('/cases/:caseId/outline/edit', async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: { defendants: true }
    })

    // Prefill with whichever redacted/edited state is most current, so
    // switching from Redact to Edit never drops back to the untouched
    // original. A pending, not-yet-confirmed edit draft (e.g. the user hit
    // "Change" on the check screen) takes priority, since it's mid-flow;
    // otherwise resolveEditBaselineText covers an in-progress (not yet
    // committed) redaction's current tags, a previously committed
    // redaction, or plain saved wording — the same baseline saveOutlineEdit
    // diffs against, so what's shown here always matches what "before"
    // means once the form is submitted.
    const outlineEdit = req.session.data.outlineEdit
    const draftText = (outlineEdit && outlineEdit.mode !== 'select' && typeof outlineEdit.after === 'string')
      ? outlineEdit.after
      : resolveEditBaselineText(req, _case)

    // ?focus= arrives from the check screen's per-row "Change" — the exact
    // text just reinstated at that spot, so the textarea can select/scroll
    // to it client-side rather than landing the user in a wall of text.
    const focusText = req.query.focus || ''

    // ?variant=v5 arrives from the summary card's "Edit and send to
    // police" link — same textarea, but its form posts to /outline/edit/v5
    // (commits immediately, no check/CYA step) rather than /outline/edit/v3
    // (review-then-confirm). Defaults to v3, the normal flow.
    const variant = req.query.variant === 'v5' ? 'v5' : 'v3'

    res.render('v2/cases/outline/edit/index', { _case, draftText, focusText, variant })
  })

  router.post('/cases/:caseId/outline/edit', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    await saveOutlineEdit(req, caseId)
    req.session.save(() => res.redirect(`/cases/${caseId}/outline/tag`))
  })

  router.post('/cases/:caseId/outline/edit/v2', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    await saveOutlineEdit(req, caseId)
    req.session.save(() => res.redirect(`/cases/${caseId}/outline/tag/v2`))
  })

  // v3's edit-confirm flow: save the draft to session, then review it on a
  // dedicated check ("CYA") screen before anything is persisted — edit and
  // redact are independent flows now, so this deliberately does NOT go to
  // /outline/tag/v3 (that's a separate, standalone entry point — see its
  // own GET route below).
  router.post('/cases/:caseId/outline/edit/v3', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    await saveOutlineEdit(req, caseId)
    req.session.save(() => res.redirect(`/cases/${caseId}/outline/edit/v3/check`))
  })

  // Check-your-answers for the edit — the only place a wording edit
  // actually gets persisted. Accept writes factualSummary (and freezes
  // factualSummaryOriginal on the very first change to the case, whether
  // via this or a redaction commit); Undo discards the draft; Change
  // returns to the textarea with the draft preserved (see the GET
  // /outline/edit handler above).
  router.get('/cases/:caseId/outline/edit/v3/check', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    res.render('v2/cases/outline/edit/check', { _case, editRows: buildEditCheckRows(outlineEdit) })
  })

  router.post('/cases/:caseId/outline/edit/v3/check', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit
    const action = req.body.action

    // Per-row "Change" — reinstates just this one change's original text
    // (leaving every other change untouched) and sends the user back to
    // the textarea to re-edit it fresh, rather than deleting the session
    // and starting over. Returns early: unlike accept/undo below, this
    // keeps the draft in session and never reaches the case details page.
    if (outlineEdit && action === 'change' && req.body.changeId) {
      const changeId = req.body.changeId
      const { changes } = getChangesAndParts(outlineEdit)
      const change = changes.find(c => String(c.id) === String(changeId))

      outlineEdit.after = revertChange(outlineEdit, changeId)
      req.session.data.outlineEdit = outlineEdit

      const focusText = change ? change.removedText : ''
      const query = focusText ? `?focus=${encodeURIComponent(focusText)}` : ''

      return req.session.save(() => res.redirect(`/cases/${caseId}/outline/edit${query}`))
    }

    let returnTo = `/cases/${caseId}/details#factual-summary`

    if (outlineEdit && action === 'accept') {
      const originalToSet = await captureOriginalIfUnset(caseId)

      await prisma.case.update({
        where: { id: caseId },
        data: {
          factualSummary: outlineEdit.after,
          factualSummaryEditedAt: new Date(),
          ...(originalToSet !== undefined && { factualSummaryOriginal: originalToSet })
        }
      })

      req.session.data.successBanner = { text: 'Summary of circumstances updated' }
      returnTo = `/cases/${caseId}/details#case-outline`
    }

    // Undo, or Accept having just persisted — either way the pending draft
    // is done with.
    delete req.session.data.outlineEdit

    req.session.save(() => res.redirect(returnTo))
  })

  // v5's edit flow: same textarea as v3 (see the GET /outline/edit
  // handler's variant switch), but an "emergency" fast-track — skips the
  // check/CYA step entirely and commits straight away, for when there's
  // no time to wait on the normal police-verification turnaround. Same
  // commit semantics as v3's "Confirm edits" (freezes
  // factualSummaryOriginal on the very first change, stamps
  // factualSummaryEditedAt) — just with no session/diff step first, since
  // there's nothing to review. Redirects to a standalone confirmation page
  // rather than back to the case, since that page's "sent to police"
  // messaging is this flow's actual terminus.
  router.post('/cases/:caseId/outline/edit/v5', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const originalToSet = await captureOriginalIfUnset(caseId)

    await prisma.case.update({
      where: { id: caseId },
      data: {
        factualSummary: req.body.factualSummary || '',
        factualSummaryEditedAt: new Date(),
        ...(originalToSet !== undefined && { factualSummaryOriginal: originalToSet })
      }
    })

    delete req.session.data.outlineEdit

    req.session.save(() => res.redirect(`/cases/${caseId}/outline/edit/success`))
  })

  router.get('/cases/:caseId/outline/edit/success', async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: { defendants: true }
    })
    res.render('v2/cases/outline/edit/success', { _case })
  })

  router.post('/cases/:caseId/outline/edit/v4', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    await saveOutlineEdit(req, caseId)
    req.session.save(() => res.redirect(`/cases/${caseId}/outline/tag/v4`))
  })

  router.get('/cases/:caseId/outline/tag', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    res.render('v2/cases/outline/tag/index', { _case, ...buildTagViewData(outlineEdit) })
  })

  // v2's popover redesign, like v4, skips the edit textarea entirely and
  // lazily starts a fresh selection-mode session against the current
  // factualSummary if one isn't already in progress. Also reads
  // ?changeId=/&returnTo= for check.html's "Change" link, same as v4.
  router.get('/cases/:caseId/outline/tag/v2', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    let outlineEdit = req.session.data.outlineEdit

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    if (!outlineEdit || outlineEdit.mode !== 'select') {
      outlineEdit = {
        mode: 'select',
        before: _case.factualSummary || '',
        after: _case.factualSummary || '',
        selections: [],
        tags: {}
      }
      req.session.data.outlineEdit = outlineEdit
    }

    const editIds = req.query.changeId
      ? String(req.query.changeId).split(',').filter(Boolean)
      : null
    const editReturnTo = req.query.returnTo || ''

    res.render('v2/cases/outline/tag/index-v2', { _case, ...buildTagViewData(outlineEdit, editIds, editReturnTo) })
  })

  // Redact and edit are independent flows now — like v2/v4, this lazily
  // starts a fresh selection-mode session against the current
  // factualSummary if one isn't already in progress, rather than forcing
  // a redirect through /outline/edit first. Also resets when a leftover
  // edit-diff session (mode !== 'select') is sitting in the session from
  // an edit that was started but never confirmed — nothing in the app
  // links here expecting that diff-mode markup, so leaving it in place
  // just leaks stray added/removed spans into what should be a plain
  // selection view, corrupting the drag-select offset math. Still reads
  // ?changeId=/&returnTo= for check.html's "Change" link, same as v2/v4.
  router.get('/cases/:caseId/outline/tag/v3', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    let outlineEdit = req.session.data.outlineEdit

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    if (!outlineEdit || outlineEdit.mode !== 'select') {
      outlineEdit = {
        mode: 'select',
        before: _case.factualSummary || '',
        after: _case.factualSummary || '',
        selections: [],
        tags: {}
      }
      req.session.data.outlineEdit = outlineEdit
    }

    const editIds = req.query.changeId
      ? String(req.query.changeId).split(',').filter(Boolean)
      : null
    const editReturnTo = req.query.returnTo || ''

    res.render('v2/cases/outline/tag/index-v3', { _case, ...buildTagViewData(outlineEdit, editIds, editReturnTo) })
  })

  // v4 skips the edit textarea entirely — "Redact" on the case details page
  // links straight here. Same as v2/v3: lazily starts a fresh
  // selection-mode session against the current factualSummary if one isn't
  // already in progress, rather than redirecting to /outline/edit. Only
  // v1's plain /outline/tag still requires an edit session first.
  router.get('/cases/:caseId/outline/tag/v4', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    let outlineEdit = req.session.data.outlineEdit

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    if (!outlineEdit || outlineEdit.mode !== 'select') {
      outlineEdit = {
        mode: 'select',
        before: _case.factualSummary || '',
        after: _case.factualSummary || '',
        selections: [],
        tags: {}
      }
      req.session.data.outlineEdit = outlineEdit
    }

    // ?changeId=<id[,id...]> arrives via check.html's "Change" link (a
    // plain, non-destructive GET — nothing is deleted just by landing
    // here) — tells the modal to open already showing that redaction.
    const editIds = req.query.changeId
      ? String(req.query.changeId).split(',').filter(Boolean)
      : null
    const editReturnTo = req.query.returnTo || ''

    res.render('v2/cases/outline/tag/index-v4', { _case, ...buildTagViewData(outlineEdit, editIds, editReturnTo) })
  })

  // Check screen: shared across all 4 variants. Registered before the
  // /v4/:changeId wildcard route below so "check" isn't swallowed as a
  // :changeId param.
  CHECK_VARIANTS.forEach(variant => {
    const pattern = variant
      ? `/cases/:caseId/outline/tag/${variant}/check`
      : '/cases/:caseId/outline/tag/check'

    router.get(pattern, async (req, res) => {
      const caseId = parseInt(req.params.caseId)
      const outlineEdit = req.session.data.outlineEdit

      if (!outlineEdit) {
        return res.redirect(`/cases/${caseId}/outline/edit`)
      }

      const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

      res.render('v2/cases/outline/tag/check', { _case, ...buildCheckViewData(outlineEdit, caseId, variant) })
    })

    router.post(pattern, async (req, res) => {
      const caseId = parseInt(req.params.caseId)
      const outlineEdit = req.session.data.outlineEdit
      const userId = req.session.data.user.id

      if (!outlineEdit) {
        return res.redirect(`/cases/${caseId}/outline/edit`)
      }

      await commitOutlineEdit(outlineEdit, caseId, userId)

      delete req.session.data.outlineEdit

      // Same req.session.data.successBanner flash convention already used
      // throughout the app (case--disclosure.js, case--charges.js, etc.) —
      // read once and cleared by the details page's GET handler via
      // success-banner-safe.njk, already included on that page.
      req.session.data.successBanner = {
        text: 'Factual summary redacted and sent to redaction log.'
      }

      // #case-outline matches the Outline tab's id in main-tabs.njk —
      // govuk-tabs reads location.hash on load to select the active tab.
      req.session.save(() => res.redirect(`/cases/${caseId}/details#case-outline`))
    })
  })

  // Prototype-testing only: undoes both a committed redaction and an
  // edit-confirm in one go, so the same case can be run through either (or
  // both) journeys again — neither has a production equivalent, since the
  // real process only ever does each once per case; this exists purely so
  // testers can reset and repeat freely, jumping between the two flows
  // without needing to know which one they last left the case in. Restores
  // factualSummary from the frozen factualSummaryOriginal (if set) and
  // clears it, clears factualSummaryRedacted, and deletes the "Factual
  // summary edited" activity log entries a redaction commit writes. Linked
  // from the footer, shown whenever a case is in view.
  router.post('/cases/:caseId/outline/reset-redact-and-edit', async (req, res) => {
    const caseId = parseInt(req.params.caseId)

    const existing = await prisma.case.findUnique({
      where: { id: caseId },
      select: { factualSummaryOriginal: true }
    })

    await prisma.case.update({
      where: { id: caseId },
      data: {
        ...(existing.factualSummaryOriginal && { factualSummary: existing.factualSummaryOriginal }),
        factualSummaryOriginal: null,
        factualSummaryRedacted: null,
        factualSummaryEditedAt: null,
        factualSummaryRedactedAt: null
      }
    })

    await prisma.activityLog.deleteMany({
      where: { caseId, model: 'Case', title: 'Factual summary edited' }
    })

    delete req.session.data.outlineEdit

    req.session.save(() => res.redirect(req.body.returnTo || `/cases/${caseId}/details#case-outline`))
  })

  // "Document type" mandatory field: reachable via its "Change" link on the
  // check screen (shared by all 4 variants) — returnTo carries the way back
  // to whichever check page linked here, same pattern as v4's redact modal.
  router.get('/cases/:caseId/outline/tag/document-type', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })
    const returnTo = req.query.returnTo || ''

    res.render('v2/cases/outline/tag/document-type', {
      _case,
      documentTypes,
      selectedDocumentType: outlineEdit.documentType || DEFAULT_DOCUMENT_TYPE,
      returnTo
    })
  })

  router.post('/cases/:caseId/outline/tag/document-type', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    if (req.body.documentType) {
      outlineEdit.documentType = req.body.documentType
    }

    const returnTo = req.body.returnTo || checkPath(caseId)
    req.session.save(() => res.redirect(returnTo))
  })

  // v4's and v2's drag-select tagging forms both post here — for both a
  // brand new selection (changeId empty, start/end/paragraphIndex present)
  // and re-tagging an already-selected span (changeId present, from
  // clicking an existing highlight). A single <form> can only have one
  // action, so this branches server-side rather than splitting across two
  // routes. Registered before the /v4/:changeId wildcard route below for
  // the same reason /v4/check is — otherwise "select" gets swallowed as a
  // :changeId param. Same handler serves /v2/select, /v3/select and
  // /v4/select (looped, like CHECK_VARIANTS.forEach elsewhere) since the
  // logic itself has never been variant-specific — only the redirect
  // targets need to know which variant they're for.
  ;['v2', 'v3', 'v4'].forEach(variant => {
    router.post(`/cases/:caseId/outline/tag/${variant}/select`, (req, res) => {
      const caseId = parseInt(req.params.caseId)
      const outlineEdit = req.session.data.outlineEdit

      if (!outlineEdit) {
        return res.redirect(`/cases/${caseId}/outline/edit`)
      }

      const tag = req.body.tag
      const changeId = req.body.changeId
      const note = (req.body.note || '').trim()
      const scope = req.body.scope
      const returnTo = req.body.returnTo || ''

      // "Other" requires a note — enforced client-side too, but this is the
      // real check. Nothing is created; the pending selection's data is
      // preserved so the redirected page can reopen the modal already
      // showing it, with the error summary/message, rather than losing it.
      if (tag && tag === 'other' && !note) {
        outlineEdit.noteError = {
          changeId: changeId || '',
          start: req.body.start || '',
          end: req.body.end || '',
          paragraphIndex: req.body.paragraphIndex || '',
          text: req.body.text || '',
          tag,
          scope: scope || 'single',
          returnTo
        }
        return req.session.save(() => res.redirect(tagPath(caseId, variant)))
      }

      if (tag) {
        outlineEdit.tags = outlineEdit.tags || {}
        outlineEdit.selections = outlineEdit.selections || []

        const tagData = { tag, date: todayGovukDate() }
        if (tag === 'other') tagData.note = note

        if (changeId) {
          // A single id, or a comma-separated group — re-tagging an
          // existing "Redact all" batch's category updates all of them.
          changeId.split(',').filter(Boolean).forEach(id => {
            outlineEdit.tags[id] = tagData
          })
        } else {
          const start = parseInt(req.body.start, 10)
          const end = parseInt(req.body.end, 10)
          const paragraphIndex = parseInt(req.body.paragraphIndex, 10)
          const text = req.body.text || ''

          if (!isNaN(start) && !isNaN(end) && !isNaN(paragraphIndex) && end > start) {
            if (scope === 'all' && text) {
              // Tag every occurrence of `text` across the whole document
              // with the same category/note, skipping any that overlaps a
              // selection that's already tagged.
              const rawParagraphs = (outlineEdit.before || '').split('\n\n')

              rawParagraphs.forEach((paragraphText, pIndex) => {
                const existingInParagraph = outlineEdit.selections.filter(s => s.paragraphIndex === pIndex)

                let searchFrom = 0
                let occStart = paragraphText.indexOf(text, searchFrom)

                while (occStart !== -1) {
                  const occEnd = occStart + text.length
                  const overlaps = existingInParagraph.some(s => occStart < s.end && occEnd > s.start)

                  if (!overlaps) {
                    const existingIds = outlineEdit.selections.map(s => s.id)
                    const id = existingIds.length ? Math.max(...existingIds) + 1 : 0
                    const newSelection = { id, paragraphIndex: pIndex, start: occStart, end: occEnd }

                    outlineEdit.selections.push(newSelection)
                    existingInParagraph.push(newSelection)
                    outlineEdit.tags[id] = tagData
                  }

                  searchFrom = occEnd
                  occStart = paragraphText.indexOf(text, searchFrom)
                }
              })
            } else {
              const existingIds = outlineEdit.selections.map(s => s.id)
              const id = existingIds.length ? Math.max(...existingIds) + 1 : 0

              outlineEdit.selections.push({ id, paragraphIndex, start, end })
              outlineEdit.tags[id] = tagData
            }
          }
        }
      }

      req.session.save(() => res.redirect(returnTo || tagPath(caseId, variant)))
    })
  })

  router.get('/cases/:caseId/outline/tag/v4/:changeId', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const viewData = buildStandaloneChangeViewData(outlineEdit, req.params.changeId)

    if (!viewData) {
      return res.redirect(`/cases/${caseId}/outline/tag/v4`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId } })

    res.render('v2/cases/outline/tag/index-v4-change', { _case, changeId: req.params.changeId, ...viewData })
  })

  router.post('/cases/:caseId/outline/tag/v4/:changeId', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit
    const changeId = req.params.changeId
    const tag = req.body.tag

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    if (tag) {
      outlineEdit.tags = outlineEdit.tags || {}
      outlineEdit.tags[changeId] = { tag, date: todayGovukDate() }

      const typeEntry = redactionTypes.find(t => t.value === tag)
      const { changes } = analyseEdit(outlineEdit.before, outlineEdit.after)
      const change = changes.find(c => c.id === parseInt(changeId, 10))

      outlineEdit.tagSuccess = {
        snippet: change ? (change.removedText || change.addedText) : '',
        tag: typeEntry ? typeEntry.text : tag
      }
    }

    req.session.save(() => res.redirect(`/cases/${caseId}/outline/tag/v4`))
  })

  router.post('/cases/:caseId/outline/tag/remove', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    outlineEdit.removed = outlineEdit.removed || {}
    outlineEdit.removed[req.body.changeId] = true

    req.session.save(() => res.redirect(tagPath(caseId, req.body.variant)))
  })

  router.post('/cases/:caseId/outline/tag/apply', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const changeId = req.body.changeId
    const tag = req.body.tag

    if (changeId && tag === 'do-not-redact') {
      if (outlineEdit.tags) delete outlineEdit.tags[changeId]
    } else if (changeId && tag) {
      outlineEdit.tags = outlineEdit.tags || {}
      outlineEdit.tags[changeId] = { tag, date: todayGovukDate() }
    }

    req.session.save(() => res.redirect(tagPath(caseId, req.body.variant)))
  })

  router.post('/cases/:caseId/outline/tag/undo', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    // Normally a single id; v4's grouped redaction rows (same text tagged
    // the same way, e.g. via "Redact all") pass a comma-separated list so
    // one "Remove" clears the whole group in one submit.
    const changeIds = String(req.body.changeId || '').split(',').filter(Boolean)

    if (outlineEdit.tags) {
      changeIds.forEach(id => delete outlineEdit.tags[id])
    }

    // v4's drag-select model: a selection only exists because it's tagged
    // (unlike the diff model, where an untagged change is still a real
    // detected difference worth keeping around) — so undoing removes it
    // entirely, not just its tag.
    if (outlineEdit.mode === 'select' && outlineEdit.selections) {
      const numericIds = changeIds.map(id => parseInt(id, 10))
      outlineEdit.selections = outlineEdit.selections.filter(s => !numericIds.includes(s.id))
    }

    const redirectPath = req.body.returnTo || tagPath(caseId, req.body.variant)
    req.session.save(() => res.redirect(redirectPath))
  })

  router.post('/cases/:caseId/outline/tag', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    // The check screen recomputes its rows and the commit live from
    // outlineEdit.tags each time, so changes can be left untagged/removed
    // here without blocking progress — no "everything must be tagged"
    // gate needed for any variant.
    res.redirect(checkPath(caseId, req.body.variant))
  })

  router.get('/cases/:caseId/outline/redaction-log', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit || !outlineEdit.taggedChanges) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId } })

    const groups = {}
    outlineEdit.taggedChanges.forEach(change => {
      const typeEntry = ALL_TAGS.find(t => t.value === change.tag)
      const key = typeEntry ? typeEntry.value : 'untagged'
      const label = typeEntry ? typeEntry.text : 'Untagged'

      if (!groups[key]) {
        groups[key] = { label, changes: [] }
      }
      groups[key].changes.push(change)
    })

    res.render('v2/cases/outline/redaction-log/index', {
      _case,
      groupedChanges: Object.values(groups),
      totalChanges: outlineEdit.taggedChanges.length
    })
  })

  router.post('/cases/:caseId/outline/redaction-log', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit
    const userId = req.session.data.user.id

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    await commitOutlineEdit(outlineEdit, caseId, userId)

    delete req.session.data.outlineEdit

    req.session.save(() => res.redirect(`/cases/${caseId}/details#factual-summary`))
  })
}
