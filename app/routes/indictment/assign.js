// app/routes/indictment/assign.js
const {
  _,
  fetchCase,
  parseCaseId,
  safeReturnTo
} = require('./_shared')

module.exports = router => {

    // ============================================================
    // /cases/:caseId/indictment/assign/defendants (GET + POST)
    // ============================================================

    router.get('/cases/:caseId/indictment/assign/defendants', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const _case = await fetchCase(caseId)
      if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

      const draftBasePath = `session.data.indictmentDrafts.${caseId}`
      const countPath = `${draftBasePath}.currentCount`
      const draftCount = _.get(req, countPath, {})
      const returnTo = safeReturnTo(req.query.returnTo)

      const allDefendants = Array.isArray(_case.defendants) ? _case.defendants : []
      const byId = new Map(allDefendants.map(d => [String(d.id), d]))

      // Count-level selection (if present)
      const orderedSelectedIds =
        (draftCount.orderedSelectedDefendantIds && draftCount.orderedSelectedDefendantIds.length)
          ? draftCount.orderedSelectedDefendantIds
          : (draftCount.selectedDefendantIds || [])

      const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String).filter(Boolean)

      // Case-level default story order (optional)
      const defaultOrderIds =
        (_.get(req, `${draftBasePath}.defaultDefendantOrderIds`, []) || []).map(String)

      function applyCaseDefaultOrder(entities = [], defaultIds = []) {
        if (!defaultIds.length) return entities
        const map = new Map(entities.map(e => [String(e.id), e]))
        const ordered = defaultIds.map(id => map.get(String(id))).filter(Boolean)
        const remaining = entities.filter(e => !defaultIds.includes(String(e.id)))
        return [...ordered, ...remaining]
      }

      // ✅ Display list:
      // - if count has a selection, show that subset
      // - otherwise, show ALL defendants (in case default order if available)
      const defendantsForDisplay = orderedSelectedIdsStr.length
        ? orderedSelectedIdsStr.map(id => byId.get(id)).filter(Boolean)
        : applyCaseDefaultOrder(allDefendants, defaultOrderIds)


      // if (!Array.isArray(draftCount.assignedDefendantIds) || !draftCount.assignedDefendantIds.length) {
      //   draftCount.assignedDefendantIds = defaultAssignedDefendantIds
      //   _.set(req, countPath, draftCount)
      // }

      return res.render('cases/indictment/assign/defendants', {
        _case: { ..._case, defendants: defendantsForDisplay },
        draftCount,
        returnTo
      })
    })



    // ============================================================
    // /cases/:caseId/indictment/assign/defendants (POST)
    // ============================================================

    router.post('/cases/:caseId/indictment/assign/defendants', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const draftBasePath = `session.data.indictmentDrafts.${caseId}`
      const countPath = `${draftBasePath}.currentCount`
      const draftCount = _.get(req, countPath, {})

      // Normalise selected IDs
      const rawAssigned = req.body.assignedDefendantIds
      const assignedDefendantIds = Array.isArray(rawAssigned)
        ? rawAssigned
        : (rawAssigned ? [rawAssigned] : [])

      draftCount.assignedDefendantIds = assignedDefendantIds.map(String).filter(Boolean)
      draftCount.lastUpdatedAt = new Date().toISOString()

      // Persist
      _.set(req, countPath, draftCount)

      // Optional: store as a draft-level default for later use
      // (does not auto-preselect unless you seed it on GET)
      _.set(req, `${draftBasePath}.defaultAssignedDefendantIds`, draftCount.assignedDefendantIds)

      const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
      if (returnTo) return res.redirect(returnTo)

      return res.redirect(`/cases/${caseId}/indictment/assign/victims`)
    })



    // ============================================================
    // /cases/:caseId/indictment/assign/victims (GET + POST)
    // ============================================================

    router.get('/cases/:caseId/indictment/assign/victims', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const _case = await fetchCase(caseId)
      if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

      const draftBasePath = `session.data.indictmentDrafts.${caseId}`
      const countPath = `${draftBasePath}.currentCount`

      const draftCount = _.get(req, countPath, {})
      const returnTo = safeReturnTo(req.query.returnTo)

      const allVictims = Array.isArray(_case.victims) ? _case.victims : []
      const byId = new Map(allVictims.map(v => [String(v.id), v]))

      // Count-level selection (if present)
      const orderedSelectedIds =
        (draftCount.orderedSelectedVictimIds && draftCount.orderedSelectedVictimIds.length)
          ? draftCount.orderedSelectedVictimIds
          : (draftCount.selectedVictimIds || [])

      const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String).filter(Boolean)

      // Case-level default story order (optional)
      const defaultOrderIds =
        (_.get(req, `${draftBasePath}.defaultVictimOrderIds`, []) || []).map(String)

      function applyCaseDefaultOrder(entities = [], defaultIds = []) {
        if (!defaultIds.length) return entities
        const map = new Map(entities.map(e => [String(e.id), e]))
        const ordered = defaultIds.map(id => map.get(String(id))).filter(Boolean)
        const remaining = entities.filter(e => !defaultIds.includes(String(e.id)))
        return [...ordered, ...remaining]
      }

      // ✅ Display list:
      // - if count has a selection, show that subset
      // - otherwise, show ALL victims (in case default order if available)
      const victimsForDisplay = orderedSelectedIdsStr.length
        ? orderedSelectedIdsStr.map(id => byId.get(id)).filter(Boolean)
        : applyCaseDefaultOrder(allVictims, defaultOrderIds)

      // ✅ IMPORTANT: do NOT clear or seed assignedVictimIds here
      // We want no preselection on later counts.

      return res.render('cases/indictment/assign/victims', {
        _case: { ..._case, victims: victimsForDisplay },
        draftCount,
        returnTo
      })
    })



    // ============================================================
    // /cases/:caseId/indictment/assign/victims (POST)
    // ============================================================

    router.post('/cases/:caseId/indictment/assign/victims', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const draftBasePath = `session.data.indictmentDrafts.${caseId}`
      const countPath = `${draftBasePath}.currentCount`
      const draftCount = _.get(req, countPath, {})

      // Normalise selected IDs
      const rawAssigned = req.body.assignedVictimIds
      const assignedVictimIds = Array.isArray(rawAssigned)
        ? rawAssigned
        : (rawAssigned ? [rawAssigned] : [])

      draftCount.assignedVictimIds = assignedVictimIds.map(String).filter(Boolean)
      draftCount.lastUpdatedAt = new Date().toISOString()

      // Persist
      _.set(req, countPath, draftCount)

      // Optional: store as a draft-level default for later use (does not auto-preselect unless you seed it)
      _.set(req, `${draftBasePath}.defaultAssignedVictimIds`, draftCount.assignedVictimIds)

      const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
      if (returnTo) return res.redirect(returnTo)

      return res.redirect(`/cases/${caseId}/indictment/assign/witnesses`)
    })


    // ============================================================
    // /cases/:caseId/indictment/assign/witnesses (GET + POST)
    // ============================================================

    router.get('/cases/:caseId/indictment/assign/witnesses', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const _case = await fetchCase(caseId)
      if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

      const draftBasePath = `session.data.indictmentDrafts.${caseId}`
      const countPath = `${draftBasePath}.currentCount`

      const draftCount = _.get(req, countPath, {})
      const returnTo = safeReturnTo(req.query.returnTo)

      const allWitnesses = Array.isArray(_case.witnesses) ? _case.witnesses : []
      const byId = new Map(allWitnesses.map(w => [String(w.id), w]))

      // Count-level selection (if present)
      const orderedSelectedIds =
        (draftCount.orderedSelectedWitnessIds && draftCount.orderedSelectedWitnessIds.length)
          ? draftCount.orderedSelectedWitnessIds
          : (draftCount.selectedWitnessIds || [])

      const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String).filter(Boolean)

      // Case-level default story order (optional)
      const defaultOrderIds =
        (_.get(req, `${draftBasePath}.defaultWitnessOrderIds`, []) || []).map(String)

      function applyCaseDefaultOrder(entities = [], defaultIds = []) {
        if (!defaultIds.length) return entities
        const map = new Map(entities.map(e => [String(e.id), e]))
        const ordered = defaultIds.map(id => map.get(String(id))).filter(Boolean)
        const remaining = entities.filter(e => !defaultIds.includes(String(e.id)))
        return [...ordered, ...remaining]
      }

      // ✅ Display list:
      // - if count has a selection, show that subset
      // - otherwise, show ALL witnesses (in case default order if available)
      const witnessesForDisplay = orderedSelectedIdsStr.length
        ? orderedSelectedIdsStr.map(id => byId.get(id)).filter(Boolean)
        : applyCaseDefaultOrder(allWitnesses, defaultOrderIds)

      // ✅ IMPORTANT: do NOT clear or seed assignedWitnessIds here
      // We want no preselection on later counts.

      return res.render('cases/indictment/assign/witnesses', {
        _case: { ..._case, witnesses: witnessesForDisplay },
        draftCount,
        returnTo
      })
    })


    // ============================================================
    // /cases/:caseId/indictment/assign/witnesses (POST)
    // ============================================================

    router.post('/cases/:caseId/indictment/assign/witnesses', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const draftBasePath = `session.data.indictmentDrafts.${caseId}`
      const countPath = `${draftBasePath}.currentCount`
      const draftCount = _.get(req, countPath, {})

      // Normalise selected IDs
      const rawAssigned = req.body.assignedWitnessIds
      const assignedWitnessIds = Array.isArray(rawAssigned)
        ? rawAssigned
        : (rawAssigned ? [rawAssigned] : [])

      draftCount.assignedWitnessIds = assignedWitnessIds.map(String).filter(Boolean)
      draftCount.lastUpdatedAt = new Date().toISOString()

      // Persist
      _.set(req, countPath, draftCount)

      // Optional: store as a draft-level default for later use (does not auto-preselect unless you seed it)
      _.set(req, `${draftBasePath}.defaultAssignedWitnessIds`, draftCount.assignedWitnessIds)

      const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
      if (returnTo) return res.redirect(returnTo)

      return res.redirect(`/cases/${caseId}/indictment/counts/precedent-charges-or-offence`)
    })
}
