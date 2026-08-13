const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { diffWords } = require('diff')
const redactionTypes = require('../data/redaction-types.js')

function buildChanges (before, after) {
  const parts = diffWords(before || '', after || '')
  const changes = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (part.removed) {
      const next = parts[i + 1]
      if (next && next.added) {
        changes.push({ removedText: part.value, addedText: next.value })
        i++
      } else {
        changes.push({ removedText: part.value, addedText: '' })
      }
    } else if (part.added) {
      changes.push({ removedText: '', addedText: part.value })
    }
  }

  return changes.map((change, id) => ({ id, ...change }))
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

    const _case = await prisma.case.findUnique({
      where: { id: caseId }
    })

    req.session.data.outlineEdit = {
      before: _case.factualSummary || '',
      after: req.body.moreDetail || '',
      copyToCip: req.body.changedName || null
    }

    req.session.save(() => res.redirect(`/cases/${caseId}/outline/tag`))
  })

  router.get('/cases/:caseId/outline/tag', async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const _case = await prisma.case.findUnique({ where: { id: caseId } })
    const changes = buildChanges(outlineEdit.before, outlineEdit.after)

    res.render('v2/cases/outline/tag/index', { _case, changes, redactionTypes })
  })

  router.post('/cases/:caseId/outline/tag', (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const outlineEdit = req.session.data.outlineEdit

    if (!outlineEdit) {
      return res.redirect(`/cases/${caseId}/outline/edit`)
    }

    const changes = buildChanges(outlineEdit.before, outlineEdit.after)

    req.session.data.outlineEdit.taggedChanges = changes.map(change => ({
      ...change,
      tag: req.body[`tag-${change.id}`] || null
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
