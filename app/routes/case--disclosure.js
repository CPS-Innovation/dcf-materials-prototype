// routes/case--disclosure.js

const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {

  // ---------------------------------------------------------------------------
  // Data access
  // ---------------------------------------------------------------------------
  async function fetchCase(caseId) {
    return prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: { include: { defenceLawyer: true, charges: true } },
        victims: true,
        witnesses: { include: { statements: true, specialMeasures: true } },
        hearings: true,
        location: true,
        tasks: true,
        directions: true,
        documents: true,
        dga: { include: { failureReasons: true } },
        notes: { include: { user: true } },
        activityLogs: { include: { user: true } },
        prosecutors: { include: { user: true } },
        paralegalOfficers: { include: { user: true } }
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function getCaseMaterialsForCase(req, _case) {
    const store = _.get(req, 'session.data.caseMaterials', null)

    const match = (obj) => {
      if (!obj) return false
      // match by reference (your JSON uses this)
      if (obj.caseId && _case && obj.caseId === _case.reference) return true
      // optional match by numeric (if you ever store it that way)
      if (obj.caseId && _case && String(obj.caseId) === String(_case.id)) return true
      return false
    }

    // Case 1: single object
    if (store && Array.isArray(store.Material)) {
      return match(store) ? store : {}
    }

    // Case 2: array of case-material objects
    if (Array.isArray(store)) {
      return store.find(match) || {}
    }

    return {}
  }

    /// Helper to compute non-sensitive assessment progress
    function computeNonSensitiveProgress(rows) {
      const NON_SENSITIVE_STATES = [
        'To be reviewed',
        'Disclosable',
        'Disclosable by inspection',
        'Not disclosable',
        'Clearly not disclosable'
      ]

      const assessableRows = (rows || []).filter(r =>
        r &&
        NON_SENSITIVE_STATES.includes(r.cpsAssessment)
      )

      if (assessableRows.length === 0) {
        return 'Not started yet'
      }

      const touchedRows = assessableRows.filter(r =>
        r.cpsAssessment !== 'To be reviewed'
      )

      if (touchedRows.length === 0) return 'Not started yet'
      if (touchedRows.length < assessableRows.length) return 'In progress'
      return 'Completed'
    }

  // helper for syncing CPS disclosure assessment status
  function syncCpsDisclosureAssessment(req, _case) {

    _.defaults(req.session.data, {
      cpsDisclosureAssessment: {}
    })

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])

    // -------------------------------------------------------------------------
    // 1) NON-SENSITIVE progress (exclude police "No longer relevant" rows)
    //    NOTE: Your previous filter was excluding CPS "No longer relevant".
    //    What you actually want is exclude rows where POLICE said NLR.
    // -------------------------------------------------------------------------
    const assessableRows = rows.filter(r => {
      const police = (r && r.policeAssessment) ? String(r.policeAssessment).toLowerCase().trim() : ''
      return police !== 'no longer relevant'
    })

    let status = 'Not started yet'

    if (assessableRows.length) {
      const assessedCount = assessableRows.filter(r => {
        const s = (r && r.cpsAssessment) ? String(r.cpsAssessment) : ''
        return s && s !== 'To be reviewed'
      }).length

      if (assessedCount === 0) status = 'Not started yet'
      else if (assessedCount < assessableRows.length) status = 'In progress'
      else status = 'Completed'
    }

    // ✅ Store status somewhere stable (session) for UI to read
    _.set(req, 'session.data.cpsDisclosureAssessment.hasAssessedNonSensitive', status)

    // Mirror into caseMaterials in session (if it exists)
    _.set(req, 'session.data.caseMaterials.cpsDisclosureAssessment.hasAssessedNonSensitive', status)

    // -------------------------------------------------------------------------
    // 2) Show "No longer relevant" inset when:
    //    - there is pending NLR work (police NLR + CPS still To be assessed), OR
    //    - CPS has already disagreed on at least one police-NLR item
    //    This supports prototype testing where NLR is "known" / in-flight.
    // -------------------------------------------------------------------------
    const hasPendingNlr = rows.some(r => {
      const police = (r && r.policeAssessment) ? String(r.policeAssessment).toLowerCase().trim() : ''
      if (police !== 'no longer relevant') return false

      const cps = (r && r.cpsAssessment) ? String(r.cpsAssessment) : ''
      return !cps || cps === 'To be reviewed'
    })

    const hasNlrDisagreement = rows.some(r => {
      const police = (r && r.policeAssessment) ? String(r.policeAssessment).toLowerCase().trim() : ''
      if (police !== 'no longer relevant') return false

      return Boolean(
        r && (
          r.cpsDisagreesWithPolice === true ||
          r.disagreesWithPolice === true ||
          r.sensitivityDisputed === true
        )
      )
    })

    _.set(req, 'session.data.showNoLongerRelevantInset', hasPendingNlr || hasNlrDisagreement)
  }


  /**
   * Disagreement rules:
   * - Police assessment = “Passes disclosure test” AND CPS assessment = “Not disclosable” OR “Clearly not disclosable”
   * - Police assessment = “Does not pass disclosure test” AND CPS assessment = “Disclosable” OR “Disclosable by inspection”
   * Otherwise: agree (false)
   */
  function computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment) {
    const pol = (policeAssessment || '').toLowerCase().trim()
    const cps = (cpsAssessment || '').toLowerCase().trim()

    const policePasses = pol === 'passes disclosure test'
    const policeDoesNotPass = pol === 'does not pass disclosure test'

    const cpsNotDisclosable = cps === 'not disclosable' || cps === 'clearly not disclosable'
    const cpsDisclosable = cps === 'disclosable' || cps === 'disclosable by inspection'

    if (policePasses && cpsNotDisclosable) return true
    if (policeDoesNotPass && cpsDisclosable) return true
    return false
  }

  function findRowByIdOrItemId(rows, selectedId) {
    if (!Array.isArray(rows)) return null
    return (
      rows.find(r => String(r.id) === String(selectedId)) ||
      rows.find(r => String(r.ItemId || r.itemId || r.materialId) === String(selectedId))
    )
  }

  function findRowIndexByIdOrItemId(rows, selectedId) {
    if (!Array.isArray(rows)) return -1
    let idx = rows.findIndex(r => String(r.id) === String(selectedId))
    if (idx === -1) {
      idx = rows.findIndex(r => String(r.ItemId || r.itemId || r.materialId) === String(selectedId))
    }
    return idx
  }

  // ---------------------------------------------------------------------------
  // Disclosure home
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    // keep CPS disclosure assessment status in sync
    syncCpsDisclosureAssessment(req, _case)

    return res.render('cases/disclosure/index', { _case, caseMaterials })
  })

  // ---------------------------------------------------------------------------
  // Assess non-sensitive
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)
    syncCpsDisclosureAssessment(req, _case)

    // One-time banner: capture then clear BEFORE render
    const banner = _.get(req, 'session.data.successBanner')
    if (banner) _.unset(req, 'session.data.successBanner')

    return res.render('cases/disclosure/assess-non-sensitive/index', {
      _case,
      caseMaterials,
      successBanner: banner
    })
  })

  // ---------------------------------------------------------------------------
  // ITEM: Disclosable
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = (req.query && req.query.id) ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-disclosable', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query && req.query.returnUrl ? req.query.returnUrl : null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = (req.body && (req.body.id || req.body.itemId)) ? String(req.body.id || req.body.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rationale =
      (req.body && (req.body.disclosureStatusChangeReason || req.body.cpsRationale))
        ? String(req.body.disclosureStatusChangeReason || req.body.cpsRationale).trim()
        : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    const cpsAssessment = 'Disclosable'
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, cpsAssessment)
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment))

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as Disclosable',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = (req.body && req.body.returnUrl) ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // ITEM: Disclosable by inspection
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-disclosable-by-inspection', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = (req.query && req.query.id) ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-disclosable-by-inspection', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query && req.query.returnUrl ? req.query.returnUrl : null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-disclosable-by-inspection', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = (req.body && (req.body.id || req.body.itemId)) ? String(req.body.id || req.body.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rationale =
      (req.body && (req.body.disclosureStatusChangeReason || req.body.cpsRationale))
        ? String(req.body.disclosureStatusChangeReason || req.body.cpsRationale).trim()
        : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    const cpsAssessment = 'Disclosable by inspection'
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, cpsAssessment)
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment))

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as Disclosable by inspection',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = (req.body && req.body.returnUrl) ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // ITEM: Evidence
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-evidence', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-evidence', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-evidence', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rationale = req.body?.disclosureStatusChangeReason
      ? String(req.body.disclosureStatusChangeReason).trim()
      : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    const cpsAssessment = 'Evidence'
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, cpsAssessment)
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    // Evidence does not participate in agree/disagree rules
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as Evidence',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl || fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // NEW: Police "No longer relevant" hub page
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const rows = _.get(req, 'session.data.disclosureNoLongerRelevantRows', [])
    
    console.log('[NLR GET] Session rows:', JSON.stringify(rows.map(r => ({ id: r.id, cpsAssessment: r.cpsAssessment })), null, 2))

    // If no items exist, send them back to disclosure tab
    if (!rows.length) {
      const fallback = `/cases/${caseId}/material?tab=disclosure`
      const returnUrl = req.query?.returnUrl ? String(req.query.returnUrl) : fallback
      return res.redirect(returnUrl)
    }

    // Handle success banner
    const banner = _.get(req, 'session.data.successBanner')
    if (banner) _.unset(req, 'session.data.successBanner')

    return res.render('cases/disclosure/no-longer-relevant/index', {
      _case,
      caseMaterials,
      successBanner: banner,
      returnUrl: req.query?.returnUrl || null
    })
  })

  // ---------------------------------------------------------------------------
  // ITEM: Assess as "No longer relevant" (CPS sets + disagrees)
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/no-longer-relevant/assess-unused-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedKey = req.query?.id || req.query?.itemId
    const selectedId = selectedKey ? String(selectedKey) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = findRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/no-longer-relevant/assess-unused-no-longer-relevant/index', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/no-longer-relevant/assess-unused-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedKey = req.body?.id || req.body?.itemId
    const selectedId = selectedKey ? String(selectedKey) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rationale =
      (req.body?.noLongerRelevantReason ? String(req.body.noLongerRelevantReason).trim() : '') ||
      (req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : '')

    const rowsPath = 'session.data.disclosureNoLongerRelevantRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].noLongerRelevantReason`, rationale || null)

    // Always a disagreement in this flow (CPS is asserting NLR back to police)
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as No longer relevant',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // ITEM: Agree "No longer relevant" (CPS agrees with police)
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/no-longer-relevant/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedKey = req.query?.id || req.query?.itemId
    const selectedId = selectedKey ? String(selectedKey) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNoLongerRelevantRows', [])
    const selectedRow = findRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/no-longer-relevant/agree-no-longer-relevant/index', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/no-longer-relevant/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedKey = req.body?.id || req.body?.itemId
    const selectedId = selectedKey ? String(selectedKey) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rowsPath = 'session.data.disclosureNoLongerRelevantRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    // Agreeing with police: CPS assessment = No longer relevant, and clear disagreement
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)

    // No rationale required (you removed textarea) — leave existing rationale untouched

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Agreed item is no longer relevant',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/no-longer-relevant`

    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // REQUEST ITEM REINSTATEMENT (No longer relevant)
  // - DOES NOT change any status
  // - Creates Action plan entry/entries in session
  // ---------------------------------------------------------------------------

  function parseIdsParam(raw) {
    const idsParam = raw ? String(raw) : ''
    return idsParam.split(',').map(s => s.trim()).filter(Boolean)
  }

  function ensureActionPlan(req) {
    _.defaults(req.session.data, { actionPlan: [] })
    if (!Array.isArray(req.session.data.actionPlan)) {
      req.session.data.actionPlan = []
    }
    return req.session.data.actionPlan
  }

  /**
   * Build an action plan entry snapshot from a disclosure row.
   * Captures the statuses at the time of request.
   */
  function buildReinstatementActionEntry(row, extra = {}) {
    const nowIso = new Date().toISOString()

    return {
      id: `ap-${Date.now()}-${Math.random().toString(16).slice(2)}`, // good enough for prototype
      type: 'request-item-reinstatement',
      createdAt: nowIso,

      // identify the item
      rowId: row?.id || null,
      itemId: row?.ItemId || row?.itemId || row?.materialId || null,
      title: row?.title || null,

      // snapshot what you asked for
      policeAssessmentAtTime: row?.policeAssessment || null,
      cpsAssessmentAtTime: row?.cpsAssessment || null,

      // optional context (nice to have for playback)
      policeRationaleAtTime: row?.policeRationale || null,
      cpsRationaleAtTime: row?.cpsRationale || null,

      // user input
      requestReason: extra.requestReason || null,

      // any future fields can go here
      ...extra
    }
  }

  
  // GET: supports ?id= or ?itemId= (single) OR ?ids= (bulk)
  router.get('/cases/:caseId/disclosure/no-longer-relevant/request-item-reinstatement', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const rows = _.get(req, 'session.data.disclosureNoLongerRelevantRows', [])
    const singleKey = req.query?.id || req.query?.itemId
    const idsFromQuery = parseIdsParam(req.query?.ids)
    const selectedIds = idsFromQuery.length ? idsFromQuery : (singleKey ? [String(singleKey)] : [])

    if (!selectedIds.length) return res.status(400).send('Missing id(s)')

    const selectedRows = selectedIds
      .map(id => findRowByIdOrItemId(rows, id))
      .filter(Boolean)

    if (!selectedRows.length) return res.status(404).send('Row(s) not found')

    // For single-item rendering convenience
    const selectedRow = selectedRows[0]
    const selectedId = String(selectedRow?.id || selectedIds[0])

    return res.render('cases/disclosure/no-longer-relevant/request-item-reinstatement/index', {
      _case,
      caseMaterials,
      selectedId,
      selectedIds,
      selectedRow,
      selectedRows,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/no-longer-relevant/request-item-reinstatement', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    // Accept ids (bulk) or id (single)
    const selectedIds = parseIdsParam(req.body?.ids)
    const singleId = req.body?.id || req.body?.itemId
    const ids = selectedIds.length ? selectedIds : (singleId ? [String(singleId)] : [])

    if (!ids.length) return res.status(400).send('Missing id(s)')

    const requestReason = req.body?.reinstatementReason
      ? String(req.body.reinstatementReason).trim()
      : ''

    const rows = _.get(req, 'session.data.disclosureNoLongerRelevantRows', [])
      .map(id => findRowByIdOrItemId(rows, id))
      .filter(Boolean)

    if (!selectedRows.length) return res.status(404).send('Row(s) not found')

    // ✅ Write Action plan entries (no status changes)
    const actionPlan = ensureActionPlan(req)

    selectedRows.forEach(r => {
      actionPlan.push(buildReinstatementActionEntry(r, {
        requestReason: requestReason || null
      }))
    })

    _.set(req, 'session.data.actionPlan', actionPlan)

    // Success banner (reuses your existing pattern)
    _.set(req, 'session.data.successBanner', {
      titleText: `Requested reinstatement for ${selectedRows.length} item${selectedRows.length === 1 ? '' : 's'}`,
      text: 'This request has been saved for the action plan.'
    })

    // Redirect back to NLR hub by default
    const fallbackReturnUrl = `/cases/${caseId}/disclosure/no-longer-relevant`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedRows[0].id || ids[0])}`)
  })

  // ---------------------------------------------------------------------------
  // ITEM: Assess as no longer relevant (CPS asserts from non-sensitive table)
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = findRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-no-longer-relevant', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rationale = req.body?.noLongerRelevantReason
      ? String(req.body.noLongerRelevantReason).trim()
      : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].noLongerRelevantReason`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as No longer relevant',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // ITEM: Not disclosable
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-not-disclosable', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = (req.body && (req.body.id || req.body.itemId)) ? String(req.body.id || req.body.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rationale =
      (req.body && (req.body.disclosureStatusChangeReason || req.body.cpsRationale))
        ? String(req.body.disclosureStatusChangeReason || req.body.cpsRationale).trim()
        : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    const cpsAssessment = 'Not disclosable'
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, cpsAssessment)
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment))

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as Not disclosable',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = (req.body && req.body.returnUrl) ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // ITEM: Clearly not disclosable
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-clearly-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-clearly-not-disclosable', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-clearly-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = (req.body && (req.body.id || req.body.itemId)) ? String(req.body.id || req.body.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rationale =
      (req.body && (req.body.disclosureStatusChangeReason || req.body.cpsRationale))
        ? String(req.body.disclosureStatusChangeReason || req.body.cpsRationale).trim()
        : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    const cpsAssessment = 'Clearly not disclosable'
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, cpsAssessment)
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment))

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as Clearly not disclosable',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = (req.body && req.body.returnUrl) ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // ITEM: Dispute sensitivity
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-dispute-sensitivity', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-dispute-sensitivity', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-dispute-sensitivity', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const reason = req.body?.disclosureStatusChangeReason
      ? String(req.body.disclosureStatusChangeReason).trim()
      : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, reason || null)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())

    // Disputes treated as disagreement
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Sensitivity disputed',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Change sensitivity dispute
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/change-sensitivity-dispute', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/change-sensitivity-dispute', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/change-sensitivity-dispute', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const option = req.body?.changeSensitivityDisputeOption
      ? String(req.body.changeSensitivityDisputeOption)
      : null

    const reason = req.body?.sensitivityDisputeReason != null
      ? String(req.body.sensitivityDisputeReason).trim()
      : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    if (option === 'agree') {
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, false)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, null)

      const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
      const cpsAssessment = _.get(req, `${rowsPath}[${idx}].cpsAssessment`, '')
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment))

      _.set(req, 'session.data.successBanner', {
        titleText: 'Sensitivity dispute removed',
        text: 'The dispute has been removed from this item.'
      })
    } else if (option === 'wording') {
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)

      const existing = _.get(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, reason || existing)

      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)

      _.set(req, 'session.data.successBanner', {
        titleText: 'Sensitivity dispute updated',
        text: 'The dispute wording has been updated.'
      })
    } else {
      _.set(req, 'session.data.successBanner', {
        titleText: 'Nothing changed',
        text: 'Select an option to update or remove the dispute.'
      })
    }

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Request updated description  (✅ SINGLE COPY — duplicates removed)
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-request-updated-description', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-request-updated-description', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-request-updated-description', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const requestText = req.body?.updatedDescriptionRequest
      ? String(req.body.updatedDescriptionRequest).trim()
      : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    _.set(req, `${rowsPath}[${idx}].updatedDescriptionRequest`, requestText || null)
    _.set(req, `${rowsPath}[${idx}].updatedDescriptionRequestedAt`, new Date().toISOString())

    _.set(req, 'session.data.successBanner', {
      titleText: 'Updated description requested',
      text: 'This request has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Request material (✅ SINGLE COPY — duplicates removed)
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-request-material', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r.id) === selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')

    return res.render('cases/disclosure/assess-non-sensitive/item-request-material', {
      _case,
      caseMaterials,
      selectedId,
      selectedRow,
      returnUrl: req.query?.returnUrl || null
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-request-material', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const reason = req.body?.requestMaterialReason
      ? String(req.body.requestMaterialReason).trim()
      : ''

    const day = req.body?.['materialNeededBy-day'] ? String(req.body['materialNeededBy-day']).trim() : ''
    const month = req.body?.['materialNeededBy-month'] ? String(req.body['materialNeededBy-month']).trim() : ''
    const year = req.body?.['materialNeededBy-year'] ? String(req.body['materialNeededBy-year']).trim() : ''

    let materialNeededBy = null
    if (day && month && year) {
      const dd = day.padStart(2, '0')
      const mm = month.padStart(2, '0')
      materialNeededBy = `${year}-${mm}-${dd}`
    }

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    _.set(req, `${rowsPath}[${idx}].requestMaterialReason`, reason || null)
    _.set(req, `${rowsPath}[${idx}].materialNeededBy`, materialNeededBy)
    _.set(req, `${rowsPath}[${idx}].materialRequestedAt`, new Date().toISOString())

    _.set(req, 'session.data.successBanner', {
      titleText: 'Material requested',
      text: 'This request has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })


  // ---------------------------------------------------------------------------
  // Sign and export disclosure documents
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/sign-and-export-disclosure-documents', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    return res.render('cases/disclosure/assess-non-sensitive/sign-and-export-disclosure-documents', {
      _case,
      caseMaterials,
      returnUrl: req.query?.returnUrl || `/cases/${caseId}/material?tab=disclosure`
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/sign-and-export-disclosure-documents', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    _.set(req, 'session.data.disclosureExported', true)

    _.set(req, 'session.data.successBanner', {
      titleText: '3 disclosure documents have been signed and exported',
      text: 'Disclosure documents can be viewed in the unused non-sensitive and unused sensitive folders in the Review and redact tab.'
    })

    return res.redirect(`/cases/${caseId}/material?tab=disclosure`)
  })



  // ===========================================================================
  // SENSITIVE DISCLOSURE ROUTES
  // Mirror of assess-non-sensitive, using disclosureSensitiveRows
  // ===========================================================================

  function syncCpsSensitiveAssessment(req, _case) {
    _.defaults(req.session.data, { cpsSensitiveAssessment: {} })
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const assessableRows = rows.filter(r => {
      const police = (r && r.policeAssessment) ? String(r.policeAssessment).toLowerCase().trim() : ''
      return police !== 'no longer relevant'
    })
    let status = 'Not started yet'
    if (assessableRows.length) {
      const assessedCount = assessableRows.filter(r => {
        const s = (r && r.cpsAssessment) ? String(r.cpsAssessment) : ''
        return s && s !== 'To be reviewed'
      }).length
      if (assessedCount === 0) status = 'Not started yet'
      else if (assessedCount < assessableRows.length) status = 'In progress'
      else status = 'Completed'
    }
    _.set(req, 'session.data.cpsSensitiveAssessment.hasAssessedSensitive', status)
    _.set(req, 'session.data.caseMaterials.cpsDisclosureAssessment.hasAssessedSensitive', status)
  }

  function findSensitiveRowByIdOrItemId(rows, selectedId) {
    if (!Array.isArray(rows)) return null
    return (
      rows.find(r => String(r.id) === String(selectedId)) ||
      rows.find(r => String(r.ItemId || r.itemId || r.materialId) === String(selectedId))
    )
  }

  function findSensitiveRowIndexByIdOrItemId(rows, selectedId) {
    if (!Array.isArray(rows)) return -1
    let idx = rows.findIndex(r => String(r.id) === String(selectedId))
    if (idx === -1) {
      idx = rows.findIndex(r => String(r.ItemId || r.itemId || r.materialId) === String(selectedId))
    }
    return idx
  }

  // ---------------------------------------------------------------------------
  // Assess sensitive index
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    syncCpsSensitiveAssessment(req, _case)
    const banner = _.get(req, 'session.data.successBanner')
    if (banner) _.unset(req, 'session.data.successBanner')
    return res.render('cases/disclosure/assess-sensitive/index', { _case, caseMaterials, successBanner: banner })
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Disclosable
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/item-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/item-disclosable', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/item-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rationale = (req.body?.disclosureStatusChangeReason || req.body?.cpsRationale || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Disclosable')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(_.get(req, `${rowsPath}[${idx}].policeAssessment`, ''), 'Disclosable'))
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Item assessed as Disclosable', text: 'This update has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Disclosable by inspection
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/item-disclosable-by-inspection', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/item-disclosable-by-inspection', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/item-disclosable-by-inspection', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rationale = (req.body?.disclosureStatusChangeReason || req.body?.cpsRationale || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Disclosable by inspection')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(_.get(req, `${rowsPath}[${idx}].policeAssessment`, ''), 'Disclosable by inspection'))
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Item assessed as Disclosable by inspection', text: 'This update has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Not disclosable
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/item-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/item-not-disclosable', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/item-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rationale = (req.body?.disclosureStatusChangeReason || req.body?.cpsRationale || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Not disclosable')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(_.get(req, `${rowsPath}[${idx}].policeAssessment`, ''), 'Not disclosable'))
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Item assessed as Not disclosable', text: 'This update has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Clearly not disclosable
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/item-clearly-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/item-clearly-not-disclosable', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/item-clearly-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rationale = (req.body?.disclosureStatusChangeReason || req.body?.cpsRationale || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Clearly not disclosable')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(_.get(req, `${rowsPath}[${idx}].policeAssessment`, ''), 'Clearly not disclosable'))
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Item assessed as Clearly not disclosable', text: 'This update has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Evidence
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/item-evidence', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/item-evidence', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/item-evidence', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rationale = (req.body?.disclosureStatusChangeReason || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Evidence')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Item assessed as Evidence', text: 'This update has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Dispute sensitivity
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/item-dispute-sensitivity', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/item-dispute-sensitivity', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/item-dispute-sensitivity', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const reason = (req.body?.disclosureStatusChangeReason || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, reason || null)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Sensitivity disputed', text: 'This update has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Change sensitivity dispute
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/change-sensitivity-dispute', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/change-sensitivity-dispute', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/change-sensitivity-dispute', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const option = req.body?.changeSensitivityDisputeOption ? String(req.body.changeSensitivityDisputeOption) : null
    const reason = (req.body?.sensitivityDisputeReason || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    if (option === 'agree') {
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, false)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, null)
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(_.get(req, `${rowsPath}[${idx}].policeAssessment`, ''), _.get(req, `${rowsPath}[${idx}].cpsAssessment`, '')))
      _.set(req, 'session.data.successBanner', { titleText: 'Sensitivity dispute removed', text: 'The dispute has been removed from this item.' })
    } else if (option === 'wording') {
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, reason || _.get(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, null))
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
      _.set(req, 'session.data.successBanner', { titleText: 'Sensitivity dispute updated', text: 'The dispute wording has been updated.' })
    }
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Request updated description
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/item-request-updated-description', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/item-request-updated-description', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/item-request-updated-description', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const requestText = (req.body?.updatedDescriptionRequest || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].updatedDescriptionRequest`, requestText || null)
    _.set(req, `${rowsPath}[${idx}].updatedDescriptionRequestedAt`, new Date().toISOString())
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Updated description requested', text: 'This request has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive item: Request material
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/item-request-material', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = req.query?.id ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/assess-sensitive/item-request-material', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/item-request-material', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const reason = (req.body?.requestMaterialReason || '').trim()
    const day = (req.body?.['materialNeededBy-day'] || '').trim()
    const month = (req.body?.['materialNeededBy-month'] || '').trim()
    const year = (req.body?.['materialNeededBy-year'] || '').trim()
    const materialNeededBy = (day && month && year) ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : null
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].requestMaterialReason`, reason || null)
    _.set(req, `${rowsPath}[${idx}].materialNeededBy`, materialNeededBy)
    _.set(req, `${rowsPath}[${idx}].materialRequestedAt`, new Date().toISOString())
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Material requested', text: 'This request has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive: Agree no longer relevant (single item)
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/no-longer-relevant/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = (req.query?.id || req.query?.itemId) ? String(req.query.id || req.query.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/no-longer-relevant/agree-no-longer-relevant/index', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/no-longer-relevant/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = (req.body?.id || req.body?.itemId) ? String(req.body.id || req.body.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Agreed item is no longer relevant', text: 'This update has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  // ---------------------------------------------------------------------------
  // Sensitive: Assess as no longer relevant (CPS asserts, single item)
  // ---------------------------------------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-sensitive/no-longer-relevant/assess-unused-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedId = (req.query?.id || req.query?.itemId) ? String(req.query.id || req.query.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRow = findSensitiveRowByIdOrItemId(rows, selectedId)
    if (!selectedRow) return res.status(404).send('Row not found')
    return res.render('cases/disclosure/no-longer-relevant/assess-unused-no-longer-relevant/index', { _case, caseMaterials, selectedId, selectedRow, returnUrl: req.query?.returnUrl || null })
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/no-longer-relevant/assess-unused-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const selectedId = (req.body?.id || req.body?.itemId) ? String(req.body.id || req.body.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')
    const rationale = (req.body?.noLongerRelevantReason || req.body?.bulkRationale || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = findSensitiveRowIndexByIdOrItemId(rows, selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessment(req, _case)
    _.set(req, 'session.data.successBanner', { titleText: 'Item assessed as No longer relevant', text: 'This update has been sent to the police.' })
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    return res.redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}updatedRow=${encodeURIComponent(selectedId)}`)
  })

}