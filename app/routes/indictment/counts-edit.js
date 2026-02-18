// app/routes/indictment/counts-edit.js

const {
  _,
  parseCaseId
} = require('./_shared')

module.exports = router => {

  // ============================================================
  // Edit an existing saved count
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/edit/:countIndex', (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const countIndex = Number.parseInt(req.params.countIndex, 10)
    if (!Number.isFinite(countIndex) || countIndex < 0) {
      return res.status(400).send('Invalid count index')
    }

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const indictment = _.get(req, indictmentBasePath, { counts: [] })

    const counts = indictment.counts || []
    const existing = counts[countIndex]

    if (!existing) {
      return res.status(404).send('Count not found')
    }

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const currentCountPath = `${draftBasePath}.currentCount`

    // Rehydrate currentCount for editing
    _.set(req, currentCountPath, {
      ...existing,
      editingIndex: countIndex,
      lastUpdatedAt: new Date().toISOString()
    })

    return res.redirect(`/cases/${caseId}/indictment/counts/check`)
  })

}
