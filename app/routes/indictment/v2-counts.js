// app/routes/indictment/v2-counts.js
//
// V2 overrides for count-related routes.
// Only routes where the v2 flow differs from v1 live here.
// Register this BEFORE the v1 counts.js (via case--indictment-v2.js).


const {
  _,
  fetchCase,
  parseCaseId,
  safeReturnTo,
  getCountsCaseFor,
  buildChargeOptionsFromCountsCase,
  chargeLibrary
} = require('./_shared')

module.exports = router => {

  // ============================================================
  // GET /cases/:caseId/indictment/counts/date-and-charges (V2)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)
    const allChargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const draftCount = _.get(req, `${draftBasePath}.currentCount`, {})

    let sharedSelectedChargeCodes =
      (_.get(req, `${draftBasePath}.selectedChargeCodes`, []) || []).map(String)

    if (!sharedSelectedChargeCodes.length) {
      sharedSelectedChargeCodes = allChargeOptions.map(c => String(c.chargeCode))
      _.set(req, `${draftBasePath}.selectedChargeCodes`, sharedSelectedChargeCodes)
    }

    if (!draftCount.selectedChargeCodes || !draftCount.selectedChargeCodes.length) {
      draftCount.selectedChargeCodes = sharedSelectedChargeCodes
    }

    const selectedChargeOptions = allChargeOptions.filter(c =>
      sharedSelectedChargeCodes.includes(String(c.chargeCode))
    )

    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/counts/date-and-charges', {
      _case,
      countsCase,
      selectedChargeOptions,
      caseChargeOptions: allChargeOptions,
      chargeLibrary,
      draftCount,
      returnTo
    })
  })


  // ============================================================
  // POST /cases/:caseId/indictment/counts/date-and-charges (V2)
  // ============================================================

  router.post('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const basePath = `${draftBasePath}.currentCount`
    const draftCount = _.get(req, basePath, {})

    const chargeSelection = (req.body.chargeSelection || '').toString()

    const selectedChargeCodes =
      (_.get(req, `${draftBasePath}.selectedChargeCodes`, []) || []).map(String)

    draftCount.selectedChargeCodes = selectedChargeCodes

    if (chargeSelection === 'newCount') {
      draftCount.countBasis = 'newCount'
      draftCount.primaryChargeCode = null
      draftCount.selectedChargeCodes = []
      draftCount.chargeCode = null
      draftCount.chargeLabel = null
      draftCount.statementOfOffenceText = null
    } else {
      draftCount.countBasis = 'existingCharge'

      const primaryChargeCode = String(chargeSelection) || null
      draftCount.primaryChargeCode = primaryChargeCode

      const selected = (chargeLibrary || []).find(o => String(o.chargeCode) === String(primaryChargeCode)) || null

      draftCount.chargeCode = selected ? selected.chargeCode : null
      draftCount.chargeLabel = selected ? (selected.label || null) : null

      if (!draftCount.statementOfOffenceText) {
        draftCount.statementOfOffenceText = selected ? (selected.statementOfOffence || null) : null
      }
    }

    // ---- Date ----
    const dateType = (req.body.dateType || '').toString()
    draftCount.dateType = dateType || null

    if (draftCount.dateType === 'single') {
      draftCount.offenceDate = {
        day: req.body['offence-date-day'] || '',
        month: req.body['offence-date-month'] || '',
        year: req.body['offence-date-year'] || ''
      }
      draftCount.offenceDateFrom = null
      draftCount.offenceDateTo = null
    } else if (draftCount.dateType === 'range') {
      draftCount.offenceDateFrom = {
        day: req.body['offence-date-from-day'] || '',
        month: req.body['offence-date-from-month'] || '',
        year: req.body['offence-date-from-year'] || ''
      }
      draftCount.offenceDateTo = {
        day: req.body['offence-date-to-day'] || '',
        month: req.body['offence-date-to-month'] || '',
        year: req.body['offence-date-to-year'] || ''
      }
      draftCount.offenceDate = null
    }

    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)
    _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

    // ---- Step status ----
    const action = (req.body.action || 'continue').toString()
    const stepStatusPath = `${draftBasePath}.stepStatus`
    const stepStatus = _.get(req, stepStatusPath, {})
    stepStatus.dateAndCharges = (action === 'exit') ? 'inProgress' : 'completed'
    _.set(req, stepStatusPath, stepStatus)

    // ---- Routing ----
    if (action === 'exit') {
      return res.redirect(`/cases/${caseId}/indictment`)
    }

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/assign/defendants`)
  })


// ============================================================
// POST /cases/:caseId/indictment/counts/precedent-charges-or-offence/continue (V2)
// ============================================================

router.post('/cases/:caseId/indictment/counts/precedent-charges-or-offence/continue', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const action = (req.body.action || 'continue').toString()

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`

  // Ensure draftCount exists + stable minimum shape (prevents out-of-sequence crashes)
  let draftCount = _.get(req, countPath)
  if (!draftCount || typeof draftCount !== 'object') draftCount = {}

  _.defaults(draftCount, {
    selectedChargeCodes: [],
    assignedDefendantIds: [],
    assignedVictimIds: [],
    selectedWitnessIds: [],
    orderedSelectedWitnessIds: [],
    statementOfOffenceText: null,
    particularsOfOffenceText: null,
    place: '',
    selectedPrecedentId: null,
    precedentSelection: null,
    lastUpdatedAt: null
  })

  // Save selection
  const selectedPrecedentId = (req.body.selectedPrecedentId || '').toString().trim()
  draftCount.selectedPrecedentId = selectedPrecedentId || null

  // ---- Step status ----
  const stepStatusPath = `${draftBasePath}.stepStatus`
  const stepStatus = _.get(req, stepStatusPath, {}) || {}
  stepStatus.precedent = (action === 'exit') ? 'inProgress' : 'completed'
  _.set(req, stepStatusPath, stepStatus)

  // If a precedent was selected, resolve starter + inject tokens
// If a precedent was selected, resolve starter + inject tokens
if (draftCount.selectedPrecedentId) {
  const chosen = (chargeLibrary || []).find(c =>
    String(c.chargeCode) === String(draftCount.selectedPrecedentId)
  ) || null

  // Match counts.js shape (so check page renders correctly)
  const starter =
    chosen?.templates?.particularsStarter ||
    chosen?.particularsStarter ||
    null

  draftCount.precedentSelection = chosen
  draftCount.particularsStarter = starter

  if (starter) {
    // Use assigned people first (so out-of-sequence still works, but “in-sequence” is correct)
    const assignedDefendantIds = Array.isArray(draftCount.assignedDefendantIds)
      ? draftCount.assignedDefendantIds.map(String)
      : []
    const defendantNames = assignedDefendantIds
      .map(id => (_case.defendants || []).find(d => String(d.id) === id))
      .filter(Boolean)
      .map(d => `${d.firstName || ''} ${d.lastName || ''}`.trim())
      .filter(Boolean)

    const assignedVictimIds = Array.isArray(draftCount.assignedVictimIds)
      ? draftCount.assignedVictimIds.map(String)
      : []
    const victimNames = assignedVictimIds
      .map(id => (_case.victims || []).find(v => String(v.id) === id))
      .filter(Boolean)
      .map(v => `${v.firstName || ''} ${v.lastName || ''}`.trim())
      .filter(Boolean)

    const defendantsText = defendantNames.length
      ? defendantNames.join(' and ').toUpperCase()
      : '[DEFENDANT(S)]'

    const victimsText = victimNames.length
      ? victimNames.join(' and ').toUpperCase()
      : '[VICTIM(S)]'

    const placeText = _case.location?.line1 || '[place]'
    const dateText = '[date]' // keep simple in v2 unless you copy your formatDateForTemplate helper

    // Token injection (same approach as counts.js)
    const inject = (text, tokenMap) => {
      if (!text) return text
      let out = String(text)
      for (const [token, replacement] of Object.entries(tokenMap || {})) {
        if (!token) continue
        const safeToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        out = out.replace(new RegExp(`\\[${safeToken}\\]`, 'g'), String(replacement))
      }
      return out
    }

    draftCount.particularsOfOffenceText = inject(starter, {
      "Defendant(s)": defendantsText,
      "defendant(s)": defendantsText,
      "Defendant": defendantsText,
      "defendant": defendantsText,

      "Victim(s)": victimsText,
      "victim(s)": victimsText,
      "Victim": victimsText,
      "victim": victimsText,

      "date": dateText,
      "Date": dateText,

      "place": placeText,
      "Place": placeText
    })
  }
} else {
  // Clear if nothing selected
  draftCount.precedentSelection = null
  draftCount.particularsStarter = null
}

  draftCount.lastUpdatedAt = new Date().toISOString()
  _.set(req, countPath, draftCount)
  _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

  // ---- Routing ----
  if (action === 'exit') {
    _.set(req, 'session.data.successBanner', {
      titleText: 'Draft saved',
      text: 'You can come back and continue drafting this count later.'
    })
    return res.redirect(`/cases/${caseId}/indictment`)
  }

  const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
  if (returnTo) return res.redirect(returnTo)

  return res.redirect(`/cases/${caseId}/indictment/counts/offence-and-particulars`)
})

  // ============================================================
  // GET /cases/:caseId/indictment/counts/offence-and-particulars (V2)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/offence-and-particulars', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    const allCaseCharges = (_case.defendants || []).flatMap(d =>
      (d.charges || []).map(ch => ({
        defendantId: d.id,
        defendantName: `${d.firstName || ''} ${d.lastName || ''}`.trim(),
        chargeCode: ch.chargeCode,
        description: ch.description,
        particulars: ch.particulars
      }))
    )

    const selectedCodes = Array.isArray(draftCount.selectedChargeCodes) && draftCount.selectedChargeCodes.length
      ? draftCount.selectedChargeCodes.map(String)
      : (draftCount.chargeCode ? [String(draftCount.chargeCode)] : [])

    const selectedCharges = allCaseCharges.filter(ch => selectedCodes.includes(String(ch.chargeCode)))
    const primarySelectedCharge = selectedCharges[0] || null

    const assignedDefendantIds = Array.isArray(draftCount.assignedDefendantIds)
      ? draftCount.assignedDefendantIds.map(String)
      : []

    const assignedDefendants = (_case.defendants || [])
      .filter(d => assignedDefendantIds.includes(String(d.id)))
      .map(d => `${d.firstName || ''} ${d.lastName || ''}`.trim())
      .filter(Boolean)

    const returnTo = safeReturnTo(req.query.returnTo)



    console.log('[offence-and-particulars DEBUG]', JSON.stringify({
      draftCount,
      chargeLibrary: chargeLibrary ? `[${chargeLibrary.length} items]` : 'UNDEFINED',
      assignedDefendants,
      primarySelectedCharge
    }, null, 2))

    return res.render('cases/indictment/counts/offence-and-particulars', {
      _case,
      draftCount,
      assignedDefendants,
      primarySelectedCharge,
      allCaseCharges,
      chargeLibrary,
      precedentSelection: draftCount.precedentSelection || null,
      returnTo
    })
  })


  // ============================================================
  // POST /cases/:caseId/indictment/counts/offence-and-particulars (V2)
  // ============================================================

  router.post('/cases/:caseId/indictment/counts/offence-and-particulars', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const basePath = `${draftBasePath}.currentCount`
    const draftCount = _.get(req, basePath, {})

    draftCount.statementOfOffenceText = (req.body.statementOfOffenceText || '').toString()
    draftCount.particularsOfOffenceText = (req.body.particularsOfOffenceText || '').toString()
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    // ---- Step status ----
    const action = (req.body.action || 'continue').toString()
    const stepStatusPath = `${draftBasePath}.stepStatus`
    const stepStatus = _.get(req, stepStatusPath, {})
    stepStatus.particulars = (action === 'exit') ? 'inProgress' : 'completed'
    _.set(req, stepStatusPath, stepStatus)

    if (action === 'exit') {
      _.set(req, 'session.data.successBanner', {
        titleText: 'Draft saved',
        text: 'You can come back and continue drafting this count later.'
      })
      return res.redirect(`/cases/${caseId}/indictment`)
    }

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/counts/check`)
  })


  // ============================================================
  // GET /cases/:caseId/indictment/counts/check (V2)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/check', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const draftCount = _.get(req, `${draftBasePath}.currentCount`, {})

    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/counts/check', {
      _case,
      draftCount,
      countsCase,
      chargeOptions,
      chargeLibrary,
      precedentSelection: draftCount.precedentSelection || null,
      returnTo
    })
  })

  // ============================================================
  // POST /cases/:caseId/indictment/counts/check (V2)
  // ============================================================

  router.post('/cases/:caseId/indictment/counts/check', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const basePath = `${draftBasePath}.currentCount`
    const draftCount = _.get(req, basePath, {})

    draftCount.confirmedAt = new Date().toISOString()
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)
    _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const indictment = _.get(req, indictmentBasePath, { status: 'In progress', counts: [] })
    indictment.counts = indictment.counts || []

    const hasAnyContent =
      draftCount.primaryChargeCode ||
      draftCount.chargeCode ||
      (draftCount.selectedChargeCodes && draftCount.selectedChargeCodes.length) ||
      draftCount.statementOfOffenceText ||
      draftCount.particularsOfOffenceText ||
      draftCount.selectedPrecedentId

    const editingIndex = Number.parseInt(String(draftCount.editingIndex ?? ''), 10)
    const isEditing = Number.isFinite(editingIndex) && editingIndex >= 0

    const savedCount = {
      createdAt: draftCount.createdAt || new Date().toISOString(),
      countBasis: draftCount.countBasis || null,
      chargeCode: draftCount.chargeCode || null,
      chargeLabel: draftCount.chargeLabel || null,
      primaryChargeCode: draftCount.primaryChargeCode || null,
      dateType: draftCount.dateType || null,
      offenceDate: draftCount.offenceDate || null,
      offenceDateFrom: draftCount.offenceDateFrom || null,
      offenceDateTo: draftCount.offenceDateTo || null,
      assignedDefendantIds: draftCount.assignedDefendantIds || [],
      assignedVictimIds: draftCount.assignedVictimIds || [],
      assignedWitnessIds: draftCount.assignedWitnessIds || [],
      statementOfOffenceText: draftCount.statementOfOffenceText || null,
      particularsOfOffenceText: draftCount.particularsOfOffenceText || null,
      selectedPrecedentId: draftCount.selectedPrecedentId || null,
      precedentSelection: draftCount.precedentSelection || null
    }

    if (hasAnyContent) {
      if (isEditing && indictment.counts[editingIndex]) {
        indictment.counts[editingIndex] = savedCount
        _.set(req, 'session.data.successBanner', {
          titleText: `Count ${editingIndex + 1} updated`,
          text: 'Your changes have been saved.'
        })
      } else {
        indictment.counts.push(savedCount)
        const countNumber = indictment.counts.length
        _.set(req, 'session.data.successBanner', {
          titleText: `Count ${countNumber} added`
        })
      }
    } else {
      _.set(req, 'session.data.successBanner', {
        titleText: 'Count added'
      })
    }

    indictment.lastSavedAt = new Date().toISOString()
    _.set(req, indictmentBasePath, indictment)
    _.unset(req, basePath)

    // Clear step status for the next count
    _.unset(req, `${draftBasePath}.stepStatus`)

    return res.redirect(`/cases/${caseId}/indictment/counts/added`)
  })

  // ============================================================
  // GET /cases/:caseId/indictment/counts/added (V2)
  // Guards against null indictment
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/added', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const indictment = _.get(req, indictmentBasePath, null) || { status: 'In progress', counts: [] }

    const counts = indictment.counts || []
    const addedCount = counts.length ? counts[counts.length - 1] : null



    return res.render('cases/indictment/counts/added/index', {
      _case,
      counts,
      addedCount
    })
  })

  // ============================================================
  // GET /cases/:caseId/indictment/counts/added/reorder (V2)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/added/reorder', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const indictment = _.get(req, indictmentBasePath, { counts: [] }) || { counts: [] }
    const counts = indictment.counts || []

    const showCountReorderSuccess = _.get(req, `session.data.showCountReorderSuccess`, false)
    _.unset(req, `session.data.showCountReorderSuccess`)

    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/counts/added/reorder/index', {
      _case,
      counts,
      indictment,
      showCountReorderSuccess,
      returnTo
    })
  })


  // ============================================================
  // POST /cases/:caseId/indictment/counts/added/reorder (V2)
  // ============================================================

  router.post('/cases/:caseId/indictment/counts/added/reorder', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const indictment = _.get(req, indictmentBasePath, { counts: [] }) || { counts: [] }
    const counts = indictment.counts || []

    const action = (req.body.action || 'continue').toString()

    // ---- Parse the order inputs ----
    // countOrder is posted as e.g. { "id-0": "2", "id-1": "1", "id-2": "3" }
    const rawOrder = req.body.countOrder || {}

    // Build a map of originalIndex -> desired position
    const positionMap = {}
    for (const [key, val] of Object.entries(rawOrder)) {
      const originalIndex = parseInt(key.replace('id-', ''), 10)
      const desiredPosition = parseInt(String(val || ''), 10)
      if (Number.isFinite(originalIndex) && Number.isFinite(desiredPosition) && desiredPosition > 0) {
        positionMap[originalIndex] = desiredPosition
      }
    }

    // ---- Reorder the counts array ----
    // Start with original order, then move any counts that have a new position
    let reordered = [...counts]

    if (Object.keys(positionMap).length > 0) {
      // Assign desired positions, fill gaps with remaining counts in original order
      const result = new Array(counts.length).fill(null)
      const unpositioned = []

      counts.forEach((count, i) => {
        if (positionMap[i] !== undefined) {
          const targetIdx = positionMap[i] - 1 // convert to 0-based
          if (targetIdx >= 0 && targetIdx < counts.length) {
            result[targetIdx] = count
          } else {
            unpositioned.push(count)
          }
        } else {
          unpositioned.push(count)
        }
      })

      // Fill nulls with unpositioned counts in order
      let uIdx = 0
      for (let i = 0; i < result.length; i++) {
        if (result[i] === null) {
          result[i] = unpositioned[uIdx++]
        }
      }

      reordered = result.filter(Boolean)
    }

    indictment.counts = reordered
    indictment.lastSavedAt = new Date().toISOString()
    _.set(req, indictmentBasePath, indictment)

    if (action === 'reorder') {
      // PRG — show success banner and re-render with new order
      _.set(req, `session.data.showCountReorderSuccess`, true)
      return res.redirect(`/cases/${caseId}/indictment/counts/added/reorder`)
    }

    // continue → back to counts added
    return res.redirect(`/cases/${caseId}/indictment/counts/added`)
  })

}