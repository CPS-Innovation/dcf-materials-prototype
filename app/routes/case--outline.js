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

const TAG_VARIANTS = ['v2', 'v3']

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
    tags: {}
  }
}

// Builds the "Undo" cell's markup for a tagged-change table row: a small
// POST form styled as a link, so undoing is a real state change (not a
// bare GET link) but doesn't need any JS to work.
function undoCellHtml (caseId, variant, changeId) {
  return `<form method="post" action="/cases/${caseId}/outline/tag/undo" class="dcf-undo-form">
    <input type="hidden" name="_csrf" value="">
    <input type="hidden" name="variant" value="${variant || ''}">
    <input type="hidden" name="changeId" value="${changeId}">
    <button type="submit" class="dcf-link-button">Undo</button>
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

  router.get('/cases/:caseId/outline/tag', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId } })

    res.render('v2/cases/outline/tag/index', { _case, ...buildTagViewData(outlineEdit, caseId, null) })
  })

  router.get('/cases/:caseId/outline/tag/v2', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId } })

    res.render('v2/cases/outline/tag/index-v2', { _case, ...buildTagViewData(outlineEdit, caseId, 'v2') })
  })

  router.get('/cases/:caseId/outline/tag/v3', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId } })

    res.render('v2/cases/outline/tag/index-v3', { _case, ...buildTagViewData(outlineEdit, caseId, 'v3') })
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

    req.session.save(() => res.redirect(tagPath(caseId, req.body.variant)))
  })

  router.post('/cases/:caseId/outline/tag', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const tags = outlineEdit.tags || {}
    const { changes } = analyseEdit(outlineEdit.before, outlineEdit.after)
    const allTagged = changes.length > 0 && changes.every(change => tags[change.id])

    if (!allTagged) {
      outlineEdit.tagError = true
      return req.session.save(() => res.redirect(tagPath(caseId, req.body.variant)))
    }

    outlineEdit.taggedChanges = changes.map(change => ({
      id: change.id,
      removedText: change.removedText,
      addedText: change.addedText,
      tag: tags[change.id].tag,
      date: tags[change.id].date
    }))

    req.session.save(() => res.redirect(`/cases/${caseId}/outline/redaction-log`))
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

    await prisma.case.update({
      where: { id: caseId },
      data: { factualSummary: outlineEdit.after }
    })

    for (const change of (outlineEdit.taggedChanges || [])) {
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

    delete req.session.data.outlineEdit

    req.session.save(() => res.redirect(`/cases/${caseId}/details#factual-summary`))
  })
}
