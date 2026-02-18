module.exports = function (router) {

  // ============================================================
  // Start a new count (reset draft currentCount)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/new', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const draftBasePath = `session.data.indictmentDrafts.${caseId}`

    // Ensure indictment container exists
    const indictment = _.get(req, indictmentBasePath, { counts: [] })
    _.set(req, indictmentBasePath, indictment)

    // Reset ONLY currentCount
    _.set(req, `${draftBasePath}.currentCount`, {
      createdAt: new Date().toISOString()
    })

    // Clear flash flags
    _.unset(req, `${draftBasePath}.reorderWitnessSuccess`)
    _.unset(req, `${draftBasePath}.reorderVictimSuccess`)
    _.unset(req, `${draftBasePath}.reorderDefendantSuccess`)

    return res.redirect(`/cases/${caseId}/indictment/counts/date-and-charges`)
  })

}
