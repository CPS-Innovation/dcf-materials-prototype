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

      // Story order ids from the order step
      const orderedSelectedIds =
        (draftCount.orderedSelectedDefendantIds && draftCount.orderedSelectedDefendantIds.length)
          ? draftCount.orderedSelectedDefendantIds
          : (draftCount.selectedDefendantIds || [])

      const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String)

      // ✅ Never pre-check on assign (clear any old session state)
      draftCount.assignedDefendantIds = []
      _.set(req, countPath, draftCount)

      // ✅ Only show defendants that were selected earlier, in that exact order
      const allDefendants = _case.defendants || []
      const byId = new Map(allDefendants.map(d => [String(d.id), d]))

      const orderedDefendantsForDisplay = orderedSelectedIdsStr
        .map(id => byId.get(id))
        .filter(Boolean)

      return res.render('cases/indictment/assign/defendants', {
        _case: { ..._case, defendants: orderedDefendantsForDisplay },
        draftCount,
        returnTo
      })
    })


    //////// POST /////////////////////////////////////////////////////////////////

    router.post('/cases/:caseId/indictment/assign/defendants', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
      const draftCount = _.get(req, basePath, {})

      const rawSelected = req.body.assignedDefendantIds
      const assignedDefendantIds = Array.isArray(rawSelected)
        ? rawSelected
        : (rawSelected ? [rawSelected] : [])

      // ✅ Normalise to strings so template membership checks work reliably
      draftCount.assignedDefendantIds = assignedDefendantIds.map(String)

      draftCount.lastUpdatedAt = new Date().toISOString()
      _.set(req, basePath, draftCount)

      // ✅ Prefer body.returnTo (hidden input), fall back to query
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

      // 1) Story order ids from the order step
      const orderedSelectedIds =
        (draftCount.orderedSelectedVictimIds && draftCount.orderedSelectedVictimIds.length)
          ? draftCount.orderedSelectedVictimIds
          : (draftCount.selectedVictimIds || [])

      const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String)

      // ✅ 2) Never pre-check on assign (clear any old session state)
      draftCount.assignedVictimIds = []
      _.set(req, countPath, draftCount)

      // ✅ 3) Only show victims selected earlier, in that exact order
      const allVictims = _case.victims || []
      const byId = new Map(allVictims.map(v => [String(v.id), v]))

      const orderedVictimsForDisplay = orderedSelectedIdsStr
        .map(id => byId.get(id))
        .filter(Boolean)

      return res.render('cases/indictment/assign/victims', {
        _case: { ..._case, victims: orderedVictimsForDisplay },
        draftCount,
        returnTo
      })
    })


    ////////// POST /////////////////////////////////////////////////////////////////

    router.post('/cases/:caseId/indictment/assign/victims', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
      const draftCount = _.get(req, basePath, {})

      const rawSelected = req.body.assignedVictimIds
      const assignedVictimIds = Array.isArray(rawSelected)
        ? rawSelected
        : (rawSelected ? [rawSelected] : [])

      // ✅ Normalise to strings so `v.id in assignedVictimIds` works reliably
      draftCount.assignedVictimIds = assignedVictimIds.map(String)

      draftCount.lastUpdatedAt = new Date().toISOString()
      _.set(req, basePath, draftCount)

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

      // 1) Story order ids from the order step
      const orderedSelectedIds =
        (draftCount.orderedSelectedWitnessIds && draftCount.orderedSelectedWitnessIds.length)
          ? draftCount.orderedSelectedWitnessIds
          : (draftCount.selectedWitnessIds || [])

      const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String)

      // ✅ 2) Never pre-check on assign (clear any old session state)
      draftCount.assignedWitnessIds = []
      _.set(req, countPath, draftCount)

      // ✅ 3) Only show witnesses selected earlier, in that exact order
      const allWitnesses = _case.witnesses || []
      const byId = new Map(allWitnesses.map(w => [String(w.id), w]))

      const orderedWitnessesForDisplay = orderedSelectedIdsStr
        .map(id => byId.get(id))
        .filter(Boolean)

      return res.render('cases/indictment/assign/witnesses', {
        _case: { ..._case, witnesses: orderedWitnessesForDisplay },
        draftCount,
        returnTo
      })
    })


    router.post('/cases/:caseId/indictment/assign/witnesses', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
      const draftCount = _.get(req, basePath, {})

      const rawSelected = req.body.assignedWitnessIds
      const assignedWitnessIds = Array.isArray(rawSelected)
        ? rawSelected
        : (rawSelected ? [rawSelected] : [])

      // ✅ Normalise to strings
      draftCount.assignedWitnessIds = assignedWitnessIds.map(String)

      draftCount.lastUpdatedAt = new Date().toISOString()
      _.set(req, basePath, draftCount)

      const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
      if (returnTo) return res.redirect(returnTo)

      return res.redirect(`/cases/${caseId}/indictment/counts/precedent-charges-or-offence`)
    })
}
