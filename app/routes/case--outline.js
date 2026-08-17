const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { diffWords } = require('diff')
const redactionTypes = require('../data/redaction-types.js')

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function todayGovukDate () {
  const d = new Date()
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function changeType (change) {
  if (change.removedText && change.addedText) return 'Edit'
  if (change.removedText) return 'Redaction'
  return 'Addition'
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

// Builds the tag-screen URL for a given variant, falling back to the
// default screen if the variant isn't recognised.
function tagPath (caseId, variant) {
  return TAG_VARIANTS.includes(variant)
    ? `/cases/${caseId}/outline/tag/${variant}`
    : `/cases/${caseId}/outline/tag`
}

// Shared by the edit form's POST handlers (default + v2/v3 variants):
// snapshots the current factual summary as "before", the submitted
// textarea as "after", and resets any previous tagging progress.
async function saveOutlineEdit (req, caseId) {
  const _case = await prisma.case.findUnique({ where: { id: caseId } })

  req.session.data.outlineEdit = {
    before: _case.factualSummary || '',
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
function buildChangeContext (parts, changeId) {
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
    before: beforePart ? contextWords(beforePart.value, 6, true) : '',
    after: afterPart ? contextWords(afterPart.value, 6, false) : ''
  }
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

// Shared by the tag screen's GET handlers (default + v2/v3 variants):
// builds the diff/highlight/table data a tag template needs to render.
function buildTagViewData (outlineEdit, caseId, variant) {
  const tags = outlineEdit.tags || {}
  const { changes, parts } = analyseEdit(outlineEdit.before, outlineEdit.after)

  const annotatedParts = parts.map(part => {
    if (part.type === 'unchanged') return part
    const tagged = tags[part.changeId]
    const typeEntry = tagged ? redactionTypes.find(t => t.value === tagged.tag) : null
    return {
      ...part,
      tagged: !!tagged,
      currentTag: tagged ? tagged.tag : '',
      currentTagLabel: typeEntry ? typeEntry.text : ''
    }
  })

  const taggedRows = changes
    .filter(change => tags[change.id])
    .map(change => {
      const typeEntry = redactionTypes.find(t => t.value === tags[change.id].tag)
      return [
        { text: change.removedText || change.addedText },
        { text: changeType(change) },
        { text: typeEntry ? typeEntry.text : tags[change.id].tag },
        { text: tags[change.id].date },
        { html: undoCellHtml(caseId, variant, change.id) }
      ]
    })

  const errorSummary = outlineEdit.tagError
    ? [{ text: 'You must tag every detected change before continuing', href: '#outline-tag-form' }]
    : []
  delete outlineEdit.tagError

  return {
    paragraphs: splitIntoParagraphs(annotatedParts),
    taggedRows,
    redactionTypes,
    totalChanges: changes.length,
    errorSummary
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

// Builds the row data for v4's check screen — the same column shape as
// the taggedRows table used elsewhere (Change/Type/Category/Date), plus
// a combined Change/Remove action cell. Computed live from outlineEdit.tags
// each time (rather than a static snapshot) so Remove immediately drops
// a row without needing to revisit the tag screen first.
function buildCheckViewData (outlineEdit, caseId) {
  const tags = outlineEdit.tags || {}
  const { changes } = analyseEdit(outlineEdit.before, outlineEdit.after)

  const rows = changes
    .filter(change => tags[change.id])
    .map(change => {
      const typeEntry = redactionTypes.find(t => t.value === tags[change.id].tag)
      const changeLink = `<a class="govuk-link" href="/cases/${caseId}/outline/tag/v4">Change</a>`
      const removeForm = undoCellHtml(caseId, 'v4', change.id, 'Remove', `/cases/${caseId}/outline/tag/v4/check`)

      return [
        { text: change.removedText || change.addedText },
        { text: changeType(change) },
        { text: typeEntry ? typeEntry.text : tags[change.id].tag },
        { text: tags[change.id].date },
        { html: `${changeLink} &#124; ${removeForm}` }
      ]
    })

  return { rows, totalChanges: rows.length }
}

// Shared commit step: persists the edited factual summary and writes one
// ActivityLog row per currently-tagged change. Recomputed live from
// outlineEdit.tags rather than a pre-taken snapshot, so it stays correct
// even if changes were removed/re-tagged after "Continue" was first
// pressed (e.g. via v4's check screen). Used by both the existing
// redaction-log commit and v4's check screen commit.
async function commitOutlineEdit (outlineEdit, caseId, userId) {
  const tags = outlineEdit.tags || {}
  const removed = outlineEdit.removed || {}
  const { changes } = analyseEdit(outlineEdit.before, outlineEdit.after)

  const taggedChanges = changes
    .filter(change => !removed[change.id] && tags[change.id])
    .map(change => ({
      removedText: change.removedText,
      addedText: change.addedText,
      tag: tags[change.id].tag
    }))

  await prisma.case.update({
    where: { id: caseId },
    data: { factualSummary: outlineEdit.after }
  })

  for (const change of taggedChanges) {
    const typeEntry = redactionTypes.find(t => t.value === change.tag)

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

    res.render('v2/cases/outline/edit/index', { _case })
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

  router.post('/cases/:caseId/outline/edit/v3', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    await saveOutlineEdit(req, caseId)
    req.session.save(() => res.redirect(`/cases/${caseId}/outline/tag/v3`))
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

    res.render('v2/cases/outline/tag/index', { _case, ...buildTagViewData(outlineEdit, caseId, null) })
  })

  router.get('/cases/:caseId/outline/tag/v2', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    res.render('v2/cases/outline/tag/index-v2', { _case, ...buildTagViewData(outlineEdit, caseId, 'v2') })
  })

  router.get('/cases/:caseId/outline/tag/v3', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    res.render('v2/cases/outline/tag/index-v3', { _case, ...buildTagViewData(outlineEdit, caseId, 'v3') })
  })

  router.get('/cases/:caseId/outline/tag/v4', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    res.render('v2/cases/outline/tag/index-v4', { _case, ...buildTagViewData(outlineEdit, caseId, 'v4') })
  })

  // Registered before the /v4/:changeId wildcard routes below so "check"
  // isn't swallowed as a :changeId param.
  router.get('/cases/:caseId/outline/tag/v4/check', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId }, include: { defendants: true } })

    res.render('v2/cases/outline/tag/check', { _case, ...buildCheckViewData(outlineEdit, caseId) })
  })

  router.post('/cases/:caseId/outline/tag/v4/check', async (req, res) => {
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

    if (changeId && tag) {
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

    if (outlineEdit.tags) {
      delete outlineEdit.tags[req.body.changeId]
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

    const tags = outlineEdit.tags || {}
    const removed = outlineEdit.removed || {}
    const { changes } = analyseEdit(outlineEdit.before, outlineEdit.after)
    const activeChanges = changes.filter(change => !removed[change.id])
    const allTagged = activeChanges.length > 0 && activeChanges.every(change => tags[change.id])

    if (!allTagged) {
      outlineEdit.tagError = true
      return req.session.save(() => res.redirect(tagPath(caseId, req.body.variant)))
    }

    outlineEdit.taggedChanges = activeChanges.map(change => ({
      id: change.id,
      removedText: change.removedText,
      addedText: change.addedText,
      tag: tags[change.id].tag,
      date: tags[change.id].date
    }))

    const nextPath = req.body.variant === 'v4'
      ? `/cases/${caseId}/outline/tag/v4/check`
      : `/cases/${caseId}/outline/redaction-log`

    req.session.save(() => res.redirect(nextPath))
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
      const typeEntry = redactionTypes.find(t => t.value === change.tag)
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
