// app/routes/indictment/v2-assign.js
//
// V2 POST overrides for assign/defendants, assign/victims, assign/witnesses.
// Identical session logic to v1 but with "Save and exit" support on all three,
// redirecting back to the indictment task list instead of the next step.
//
// Register this BEFORE assign.js (via case--indictment-v2.js).


const {
  _,
  fetchCase,
  parseCaseId,
  safeReturnTo
} = require('./_shared')

module.exports = router => {

  // ============================================================
  // POST /cases/:caseId/indictment/assign/defendants (V2)
  // ============================================================

  router.post('/cases/:caseId/indictment/assign/defendants', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const countPath = `${draftBasePath}.currentCount`
    const draftCount = _.get(req, countPath, {})

    const rawAssigned = req.body.assignedDefendantIds
    const assignedDefendantIds = Array.isArray(rawAssigned)
      ? rawAssigned
      : (rawAssigned ? [rawAssigned] : [])

    draftCount.assignedDefendantIds = assignedDefendantIds.map(String).filter(Boolean)
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, countPath, draftCount)
    _.set(req, `${draftBasePath}.defaultAssignedDefendantIds`, draftCount.assignedDefendantIds)

    // ---- Step status ----
    const action = (req.body.action || 'continue').toString()
    const stepStatus = _.get(req, `${draftBasePath}.stepStatus`, {})
    stepStatus.defendants = (action === 'exit') ? 'inProgress' : 'completed'
    _.set(req, `${draftBasePath}.stepStatus`, stepStatus)

    if (action === 'exit') return res.redirect(`/cases/${caseId}/indictment`)

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/assign/victims`)
  })


  // ============================================================
  // POST /cases/:caseId/indictment/assign/victims (V2)
  // ============================================================

  router.post('/cases/:caseId/indictment/assign/victims', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const countPath = `${draftBasePath}.currentCount`
    const draftCount = _.get(req, countPath, {})

    const rawAssigned = req.body.assignedVictimIds
    const assignedVictimIds = Array.isArray(rawAssigned)
      ? rawAssigned
      : (rawAssigned ? [rawAssigned] : [])

    draftCount.assignedVictimIds = assignedVictimIds.map(String).filter(Boolean)
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, countPath, draftCount)
    _.set(req, `${draftBasePath}.defaultAssignedVictimIds`, draftCount.assignedVictimIds)

    // ---- Step status ----
    const action = (req.body.action || 'continue').toString()
    const stepStatus = _.get(req, `${draftBasePath}.stepStatus`, {})
    stepStatus.victims = (action === 'exit') ? 'inProgress' : 'completed'
    _.set(req, `${draftBasePath}.stepStatus`, stepStatus)

    if (action === 'exit') return res.redirect(`/cases/${caseId}/indictment`)

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/counts/precedent-charges-or-offence`)
  })


  // ============================================================
  // POST /cases/:caseId/indictment/assign/witnesses (V2)
  // ============================================================

  router.post('/cases/:caseId/indictment/assign/witnesses', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const countPath = `${draftBasePath}.currentCount`
    const draftCount = _.get(req, countPath, {})

    const rawAssigned = req.body.assignedWitnessIds
    const assignedWitnessIds = Array.isArray(rawAssigned)
      ? rawAssigned
      : (rawAssigned ? [rawAssigned] : [])

    draftCount.assignedWitnessIds = assignedWitnessIds.map(String).filter(Boolean)
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, countPath, draftCount)
    _.set(req, `${draftBasePath}.defaultAssignedWitnessIds`, draftCount.assignedWitnessIds)

    const action = (req.body.action || 'continue').toString()
    if (action === 'exit') return res.redirect(`/cases/${caseId}/indictment`)

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/counts/offence-and-particulars`)
  })

}