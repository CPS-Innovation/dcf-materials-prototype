// app/routes/case--disclosure-bulk.js

const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {

  // ===========================================================================
  // Data fetch
  // ===========================================================================

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

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function getCaseMaterialsForCase(req, _case) {
    const store = _.get(req, 'session.data.caseMaterials', null)

    const match = (obj) => {
      if (!obj) return false
      if (obj.caseId && _case && obj.caseId === _case.reference) return true
      if (obj.caseId && _case && String(obj.caseId) === String(_case.id)) return true
      return false
    }

    if (store && Array.isArray(store.Material)) {
      return match(store) ? store : {}
    }

    if (Array.isArray(store)) {
      return store.find(match) || {}
    }

    return {}
  }

  /**
   * Compute progress for NON-SENSITIVE disclosure
   *
   * BUSINESS RULE:
   * - Items marked "No longer relevant" MUST NOT:
   *   - count towards NS progress
   *   - flip NS into "In progress"
   */
  function computeNonSensitiveProgress(rows) {
    const assessableRows = (rows || []).filter(r =>
      r &&
      r.cpsAssessment &&
      r.cpsAssessment !== 'No longer relevant'
    )

    if (assessableRows.length === 0) return 'Not started yet'

    const touchedRows = assessableRows.filter(r => r.cpsAssessment !== 'To be reviewed')

    if (touchedRows.length === 0) return 'Not started yet'
    if (touchedRows.length < assessableRows.length) return 'In progress'
    return 'Completed'
  }

  /**
   * Sync CPS disclosure assessment status onto caseMaterials
   *
   * This is intentionally derived from session rows, NOT routes,
   * because bulk NLR routes live under assess-non-sensitive for
   * historical prototype reasons.
   */
  function syncCpsDisclosureAssessment(req, _case) {
    const cm = getCaseMaterialsForCase(req, _case)
    if (!cm || !cm.cpsDisclosureAssessment) return

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const progress = computeNonSensitiveProgress(rows)

    _.set(cm, 'cpsDisclosureAssessment.hasAssessedNonSensitive', progress)
  }

  function computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment) {
    const pol = (policeAssessment || '').toLowerCase().trim()
    const cps = (cpsAssessment || '').toLowerCase().trim()

    const policePasses = pol === 'passes disclosure test'
    const policeDoesNotPass = pol === 'does not pass disclosure test'

    const cpsNotDisclosable = (cps === 'not disclosable' || cps === 'clearly not disclosable')
    const cpsDisclosable = (cps === 'disclosable' || cps === 'disclosable by inspection')

    if (policePasses && cpsNotDisclosable) return true
    if (policeDoesNotPass && cpsDisclosable) return true
    return false
  }

  function parseIdsParam(raw) {
    const idsParam = raw ? String(raw) : ''
    return idsParam
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }

  function resolveSelectedRows(req, selectedIds) {
    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRows = selectedIds
      .map(id => rows.find(r => String(r.id) === String(id)))
      .filter(Boolean)

    return { rows, selectedRows }
  }

  function getReturnUrl(req, caseId) {
    return req.query?.returnUrl
      ? String(req.query.returnUrl)
      : `/cases/${caseId}/disclosure/assess-non-sensitive`
  }

  function postReturnUrl(req, caseId) {
    return req.body?.returnUrl
      ? String(req.body.returnUrl)
      : `/cases/${caseId}/disclosure/assess-non-sensitive`
  }

  function redirectBack(res, returnUrl, focusId) {
    const sep = returnUrl.includes('?') ? '&' : '?'
    return res.redirect(`${returnUrl}${sep}updatedRow=${encodeURIComponent(focusId)}`)
  }

  function setSuccessBanner(req, titleText, text) {
    _.set(req, 'session.data.successBanner', { titleText, text })
  }

  /**
   * Apply a simple CPS assessment + optional rationale to selected rows.
   * Also recomputes cpsDisagreesWithPolice.
   */
  function applyBulkAssessment(req, selectedIds, opts = {}) {
    const {
      cpsAssessment,
      cpsRationale,
      setDisagreement = true
    } = opts

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, cpsAssessment)

      if (typeof cpsRationale !== 'undefined') {
        _.set(req, `${rowsPath}[${idx}].cpsRationale`, cpsRationale)
      }

      if (setDisagreement) {
        const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
        const disagrees = computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment)
        _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, disagrees)
      }
    })
  }

  // ===========================================================================
  // GET helper to render a bulk screen
  // ===========================================================================

  async function renderBulk(req, res, viewName) {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedIds = parseIdsParam(req.query?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const { selectedRows } = resolveSelectedRows(req, selectedIds)
    if (!selectedRows.length) return res.status(404).send('No rows found')

    return res.render(viewName, {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl: getReturnUrl(req, caseId)
    })
  }

  // ===========================================================================
  // BULK ROUTES (Assess non-sensitive)
  // Folder: views/cases/disclosure/assess-non-sensitive/bulk/*.html
  // ===========================================================================

  // ---------------------------
  // Disclosable
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/disclosable', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/disclosable')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale || req.body?.cpsRationale || ''
    applyBulkAssessment(req, selectedIds, {
      cpsAssessment: 'Disclosable',
      cpsRationale: rationale
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Disclosable`,
      'This update has been saved.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Disclosable by inspection
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/disclosable-by-inspection', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/disclosable-by-inspection')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/disclosable-by-inspection', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale || req.body?.cpsRationale || ''
    applyBulkAssessment(req, selectedIds, {
      cpsAssessment: 'Disclosable by inspection',
      cpsRationale: rationale
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Disclosable by inspection`,
      'This update has been saved.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Clearly not disclosable
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale || req.body?.cpsRationale || ''
    applyBulkAssessment(req, selectedIds, {
      cpsAssessment: 'Clearly not disclosable',
      cpsRationale: rationale
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Clearly not disclosable`,
      'This update has been saved.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Not disclosable
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/not-disclosable', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/not-disclosable')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale || req.body?.cpsRationale || ''
    applyBulkAssessment(req, selectedIds, {
      cpsAssessment: 'Not disclosable',
      cpsRationale: rationale
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Not disclosable`,
      'This update has been saved.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Evidence
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/evidence', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/evidence')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/evidence', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale || req.body?.cpsRationale || ''
    applyBulkAssessment(req, selectedIds, {
      cpsAssessment: 'Evidence',
      cpsRationale: rationale,
      // Evidence doesn't map cleanly to "passes/does not pass" disagreement logic,
      // so keep it false by default.
      setDisagreement: false
    })

    selectedIds.forEach(id => {
      const rowsPath = 'session.data.disclosureNonSensitiveRows'
      const rows = _.get(req, rowsPath, [])
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Evidence`,
      'This update has been saved.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Assess as no longer relevant
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/assess-as-no-longer-relevant', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/assess-as-no-longer-relevant')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/assess-as-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = (req.body?.bulkRationale || '').trim()

    applyBulkAssessment(req, selectedIds, {
      cpsAssessment: 'No longer relevant',
      cpsRationale: rationale,
      setDisagreement: false  // handled manually below
    })

    // CPS asserting NLR is always a disagreement with police
    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    selectedIds.forEach(id => {
      const rows = _.get(req, rowsPath, [])
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
      _.set(req, `${rowsPath}[${idx}].noLongerRelevantReason`, rationale || null)
    })

    // NLR does not count toward NS progress — intentionally skip syncCpsDisclosureAssessment

    setSuccessBanner(
      req,
      `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as No longer relevant`,
      'This update has been sent to the police.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Dispute sensitivity
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/dispute-sensitivity', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/dispute-sensitivity')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/dispute-sensitivity', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = (req.body?.bulkRationale || '').trim()

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    selectedIds.forEach(id => {
      const rows = _.get(req, rowsPath, [])
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, rationale || null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Disputed sensitivity for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`,
      'This update has been sent to the police.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Request updated description
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-updated-description', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/request-updated-description')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-updated-description', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const requestText =
      (req.body?.bulkRationale || req.body?.bulkRequestText || req.body?.requestDetails || '').trim()

    // This action doesn’t change CPS assessment; store request note against rows.
    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].requestUpdatedDescription`, true)
      _.set(req, `${rowsPath}[${idx}].requestUpdatedDescriptionText`, requestText)
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Requested updated descriptions for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`,
      'This update has been saved.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Request material
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-material', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/request-material')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-material', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const requestText =
      (req.body?.bulkRationale || req.body?.bulkRequestText || req.body?.requestDetails || '').trim()

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].requestMaterial`, true)
      _.set(req, `${rowsPath}[${idx}].requestMaterialText`, requestText)
      // Typically "material not provided" is a police-side flag; keep your existing r.isProvided.
      // But you can store that you requested it for UI playback.
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Requested material for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`,
      'This update has been saved.'
    )

    return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
  })

  // ---------------------------
  // Change sensitivity dispute (bulk)
  // ---------------------------
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/change-sensitivity-dispute', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/change-sensitivity-dispute')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/change-sensitivity-dispute', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  const selectedIds = parseIdsParam(req.body?.ids)

  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const option = String(req.body?.changeSensitivityDisputeOption || '').trim()
  const bulkWording = String(req.body?.bulkWording || '').trim()

  const rowsPath = 'session.data.disclosureNonSensitiveRows'
  const rows = _.get(req, rowsPath, [])

  selectedIds.forEach(id => {
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) return

    if (option === 'agree') {
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, false)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, '')
      return
    }

    if (option === 'wording') {
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, bulkWording)
      return
    }

    // If option missing/unknown: leave row unchanged (safe no-op)
  })

  const _case = await fetchCase(caseId)
  if (_case) syncCpsDisclosureAssessment(req, _case)

  // Banner copy that reflects the chosen action
  const titleText =
    option === 'agree'
      ? `Removed sensitivity dispute for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`
      : option === 'wording'
        ? `Updated sensitivity dispute wording for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`
        : `Updated sensitivity dispute for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`

  _.set(req, 'session.data.successBanner', {
    titleText,
    text: 'This update has been saved.'
  })

  return redirectBack(res, postReturnUrl(req, caseId), selectedIds[0])
})

  // ===========================================================================
  // ✅ BULK: REQUEST ITEM REINSTATEMENT
  // Renders: views/cases/disclosure/assess-non-sensitive/bulk/request-item-reinstatement.html
  // POST: saves "reinstatement request" per selected row, then returns to NLR hub
  // ===========================================================================

  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-item-reinstatement', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/request-item-reinstatement')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-item-reinstatement', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)

    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const reason = req.body?.reinstatementReason
      ? String(req.body.reinstatementReason).trim()
      : ''

    const day = req.body?.['reinstatementNeededBy-day'] ? String(req.body['reinstatementNeededBy-day']).trim() : ''
    const month = req.body?.['reinstatementNeededBy-month'] ? String(req.body['reinstatementNeededBy-month']).trim() : ''
    const year = req.body?.['reinstatementNeededBy-year'] ? String(req.body['reinstatementNeededBy-year']).trim() : ''

    let neededBy = null
    if (day && month && year) {
      const dd = day.padStart(2, '0')
      const mm = month.padStart(2, '0')
      neededBy = `${year}-${mm}-${dd}`
    }

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    // Save the request against each selected row (prototype-friendly)
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].reinstatementRequested`, true)
      _.set(req, `${rowsPath}[${idx}].reinstatementReason`, reason || null)
      _.set(req, `${rowsPath}[${idx}].reinstatementNeededBy`, neededBy)
      _.set(req, `${rowsPath}[${idx}].reinstatementRequestedAt`, new Date().toISOString())

      // This is a disagreement in the NLR context (you’re asserting it should be reinstated)
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    })

    // NLR requests should NOT move non-sensitive progress (same as your NLR rule)
    // So we intentionally DO NOT call syncCpsDisclosureAssessment here.

    setSuccessBanner(
      req,
      `Requested reinstatement for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`,
      'This update has been sent to the police.'
    )

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/no-longer-relevant`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl

    return redirectBack(res, returnUrl, selectedIds[0])
  })


  // ===========================================================================
  // ✅ BULK: AGREE NO LONGER RELEVANT
  // (Lives under assess-non-sensitive for legacy reasons)
  // Must redirect back to /disclosure/no-longer-relevant
  // Must NOT influence NS progress
  // ===========================================================================

  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant', (req, res) => {
    return renderBulk(req, res, 'cases/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant')
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
    })

    // IMPORTANT: Do not call syncCpsDisclosureAssessment here if you want
    // NLR to never impact NS progress. (Your helper excludes NLR anyway,
    // so calling it is safe, but leaving it out is even clearer.)
    // const _case = await fetchCase(caseId)
    // if (_case) syncCpsDisclosureAssessment(req, _case)

    setSuccessBanner(
      req,
      `Agreed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as No longer relevant`,
      'This update has been sent to the police.'
    )

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/no-longer-relevant`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl

    return redirectBack(res, returnUrl, selectedIds[0])
  })



  // ===========================================================================
  // SENSITIVE BULK ROUTES
  // Mirror of assess-non-sensitive bulk, using disclosureSensitiveRows
  // ===========================================================================

  function applyBulkSensitiveAssessment(req, selectedIds, opts = {}) {
    const { cpsAssessment, cpsRationale, setDisagreement = true } = opts
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, cpsAssessment)
      if (typeof cpsRationale !== 'undefined') {
        _.set(req, `${rowsPath}[${idx}].cpsRationale`, cpsRationale)
      }
      if (setDisagreement) {
        const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
        _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, computeCpsDisagreesWithPolice(policeAssessment, cpsAssessment))
      }
    })
  }

  function syncCpsSensitiveAssessmentBulk(req, _case) {
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const assessableRows = (rows || []).filter(r => r && r.cpsAssessment && r.cpsAssessment !== 'No longer relevant')
    let progress = 'Not started yet'
    if (assessableRows.length) {
      const touched = assessableRows.filter(r => r.cpsAssessment !== 'To be reviewed').length
      if (touched === 0) progress = 'Not started yet'
      else if (touched < assessableRows.length) progress = 'In progress'
      else progress = 'Completed'
    }
    _.set(req, 'session.data.cpsSensitiveAssessment.hasAssessedSensitive', progress)
    _.set(req, 'session.data.caseMaterials.cpsDisclosureAssessment.hasAssessedSensitive', progress)
  }

  async function renderBulkSensitive(req, res, viewName) {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedIds = parseIdsParam(req.query?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const rows = _.get(req, 'session.data.disclosureSensitiveRows', [])
    const selectedRows = selectedIds.map(id => rows.find(r => String(r.id) === String(id))).filter(Boolean)
    if (!selectedRows.length) return res.status(404).send('No rows found')
    return res.render(viewName, {
      _case, caseMaterials, selectedIds, selectedRows,
      returnUrl: req.query?.returnUrl ? String(req.query.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
    })
  }

  function postSensReturnUrl(req, caseId) {
    return req.body?.returnUrl ? String(req.body.returnUrl) : `/cases/${caseId}/disclosure/assess-sensitive`
  }

  // Standard bulk assessment routes for sensitive
  const sensBulkAssessments = [
    { slug: 'disclosable',              cpsAssessment: 'Disclosable',              label: 'Disclosable' },
    { slug: 'disclosable-by-inspection',cpsAssessment: 'Disclosable by inspection',label: 'Disclosable by inspection' },
    { slug: 'not-disclosable',          cpsAssessment: 'Not disclosable',          label: 'Not disclosable' },
    { slug: 'clearly-not-disclosable',  cpsAssessment: 'Clearly not disclosable',  label: 'Clearly not disclosable' },
  ]

  sensBulkAssessments.forEach(({ slug, cpsAssessment, label }) => {
    router.get(`/cases/:caseId/disclosure/assess-sensitive/bulk/${slug}`, (req, res) => {
      return renderBulkSensitive(req, res, `cases/disclosure/assess-sensitive/bulk/${slug}`)
    })
    router.post(`/cases/:caseId/disclosure/assess-sensitive/bulk/${slug}`, async (req, res) => {
      const caseId = parseInt(req.params.caseId, 10)
      const selectedIds = parseIdsParam(req.body?.ids)
      if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
      if (!selectedIds.length) return res.status(400).send('Missing ids')
      const rationale = req.body?.bulkRationale || req.body?.cpsRationale || ''
      applyBulkSensitiveAssessment(req, selectedIds, { cpsAssessment, cpsRationale: rationale })
      const _case = await fetchCase(caseId)
      if (_case) syncCpsSensitiveAssessmentBulk(req, _case)
      setSuccessBanner(req, `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as ${label}`, 'This update has been saved.')
      return redirectBack(res, postSensReturnUrl(req, caseId), selectedIds[0])
    })
  })

  // Evidence (no disagreement)
  router.get('/cases/:caseId/disclosure/assess-sensitive/bulk/evidence', (req, res) => {
    return renderBulkSensitive(req, res, 'cases/disclosure/assess-sensitive/bulk/evidence')
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/bulk/evidence', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    applyBulkSensitiveAssessment(req, selectedIds, { cpsAssessment: 'Evidence', setDisagreement: false })
    const rowsPath = 'session.data.disclosureSensitiveRows'
    selectedIds.forEach(id => {
      const rows = _.get(req, rowsPath, [])
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx !== -1) _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
    })
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessmentBulk(req, _case)
    setSuccessBanner(req, `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Evidence`, 'This update has been saved.')
    return redirectBack(res, postSensReturnUrl(req, caseId), selectedIds[0])
  })

  // Assess as no longer relevant
  router.get('/cases/:caseId/disclosure/assess-sensitive/bulk/assess-as-no-longer-relevant', (req, res) => {
    return renderBulkSensitive(req, res, 'cases/disclosure/assess-sensitive/bulk/assess-as-no-longer-relevant')
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/bulk/assess-as-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const rationale = (req.body?.bulkRationale || '').trim()
    applyBulkSensitiveAssessment(req, selectedIds, { cpsAssessment: 'No longer relevant', setDisagreement: false })
    const rowsPath = 'session.data.disclosureSensitiveRows'
    selectedIds.forEach(id => {
      const rows = _.get(req, rowsPath, [])
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
      _.set(req, `${rowsPath}[${idx}].noLongerRelevantReason`, rationale || null)
    })
    setSuccessBanner(req, `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as No longer relevant`, 'This update has been sent to the police.')
    return redirectBack(res, postSensReturnUrl(req, caseId), selectedIds[0])
  })

  // Dispute sensitivity
  router.get('/cases/:caseId/disclosure/assess-sensitive/bulk/dispute-sensitivity', (req, res) => {
    return renderBulkSensitive(req, res, 'cases/disclosure/assess-sensitive/bulk/dispute-sensitivity')
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/bulk/dispute-sensitivity', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const rationale = (req.body?.bulkRationale || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    selectedIds.forEach(id => {
      const rows = _.get(req, rowsPath, [])
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, rationale || null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    })
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessmentBulk(req, _case)
    setSuccessBanner(req, `Disputed sensitivity for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`, 'This update has been sent to the police.')
    return redirectBack(res, postSensReturnUrl(req, caseId), selectedIds[0])
  })

  // Change sensitivity dispute
  router.get('/cases/:caseId/disclosure/assess-sensitive/bulk/change-sensitivity-dispute', (req, res) => {
    return renderBulkSensitive(req, res, 'cases/disclosure/assess-sensitive/bulk/change-sensitivity-dispute')
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/bulk/change-sensitivity-dispute', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const option = String(req.body?.changeSensitivityDisputeOption || '').trim()
    const bulkWording = String(req.body?.bulkWording || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      if (option === 'agree') {
        _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, false)
        _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, '')
      } else if (option === 'wording') {
        _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
        _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, bulkWording)
      }
    })
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessmentBulk(req, _case)
    const titleText = option === 'agree'
      ? `Removed sensitivity dispute for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`
      : `Updated sensitivity dispute wording for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`
    setSuccessBanner(req, titleText, 'This update has been saved.')
    return redirectBack(res, postSensReturnUrl(req, caseId), selectedIds[0])
  })

  // Request updated description
  router.get('/cases/:caseId/disclosure/assess-sensitive/bulk/request-updated-description', (req, res) => {
    return renderBulkSensitive(req, res, 'cases/disclosure/assess-sensitive/bulk/request-updated-description')
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/bulk/request-updated-description', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const requestText = (req.body?.bulkRationale || req.body?.bulkRequestText || req.body?.requestDetails || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].requestUpdatedDescription`, true)
      _.set(req, `${rowsPath}[${idx}].requestUpdatedDescriptionText`, requestText)
    })
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessmentBulk(req, _case)
    setSuccessBanner(req, `Requested updated descriptions for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`, 'This update has been saved.')
    return redirectBack(res, postSensReturnUrl(req, caseId), selectedIds[0])
  })

  // Request material
  router.get('/cases/:caseId/disclosure/assess-sensitive/bulk/request-material', (req, res) => {
    return renderBulkSensitive(req, res, 'cases/disclosure/assess-sensitive/bulk/request-material')
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/bulk/request-material', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const requestText = (req.body?.bulkRationale || req.body?.bulkRequestText || req.body?.requestDetails || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].requestMaterial`, true)
      _.set(req, `${rowsPath}[${idx}].requestMaterialText`, requestText)
    })
    const _case = await fetchCase(caseId)
    if (_case) syncCpsSensitiveAssessmentBulk(req, _case)
    setSuccessBanner(req, `Requested material for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`, 'This update has been saved.')
    return redirectBack(res, postSensReturnUrl(req, caseId), selectedIds[0])
  })

  // Agree no longer relevant
  router.get('/cases/:caseId/disclosure/assess-sensitive/bulk/agree-no-longer-relevant', (req, res) => {
    return renderBulkSensitive(req, res, 'cases/disclosure/assess-sensitive/bulk/agree-no-longer-relevant')
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/bulk/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
    })
    setSuccessBanner(req, `Agreed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as No longer relevant`, 'This update has been sent to the police.')
    const fallback = `/cases/${caseId}/disclosure/assess-sensitive`
    return redirectBack(res, req.body?.returnUrl ? String(req.body.returnUrl) : fallback, selectedIds[0])
  })

  // Request item reinstatement
  router.get('/cases/:caseId/disclosure/assess-sensitive/bulk/request-item-reinstatement', (req, res) => {
    return renderBulkSensitive(req, res, 'cases/disclosure/assess-sensitive/bulk/request-item-reinstatement')
  })
  router.post('/cases/:caseId/disclosure/assess-sensitive/bulk/request-item-reinstatement', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const reason = (req.body?.reinstatementReason || '').trim()
    const rowsPath = 'session.data.disclosureSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      _.set(req, `${rowsPath}[${idx}].reinstatementRequested`, true)
      _.set(req, `${rowsPath}[${idx}].reinstatementReason`, reason || null)
      _.set(req, `${rowsPath}[${idx}].reinstatementRequestedAt`, new Date().toISOString())
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    })
    setSuccessBanner(req, `Requested reinstatement for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`, 'This update has been sent to the police.')
    const fallback = `/cases/${caseId}/disclosure/assess-sensitive`
    return redirectBack(res, req.body?.returnUrl ? String(req.body.returnUrl) : fallback, selectedIds[0])
  })

  // ===========================================================================
  // NO LONGER RELEVANT BULK ROUTES
  // For items in disclosureNoLongerRelevantRows
  // ===========================================================================

  async function renderBulkNlr(req, res, viewName) {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')
    const caseMaterials = getCaseMaterialsForCase(req, _case)
    const selectedIds = parseIdsParam(req.query?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const rows = _.get(req, 'session.data.disclosureNoLongerRelevantRows', [])
    const selectedRows = selectedIds.map(id => rows.find(r => String(r.id) === String(id))).filter(Boolean)
    if (!selectedRows.length) return res.status(404).send('No rows found')
    return res.render(viewName, {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl: req.query?.returnUrl ? String(req.query.returnUrl) : `/cases/${caseId}/disclosure/no-longer-relevant`
    })
  }

  router.get('/cases/:caseId/disclosure/no-longer-relevant/bulk/agree-no-longer-relevant', (req, res) => {
    return renderBulkNlr(req, res, 'cases/disclosure/no-longer-relevant/agree-no-longer-relevant/bulk/index')
  })

  router.post('/cases/:caseId/disclosure/no-longer-relevant/bulk/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    
    // Direct reference to session array
    const rows = req.session.data.disclosureNoLongerRelevantRows || []
    
    console.log('[NLR Bulk] BEFORE update:', JSON.stringify(rows.map(r => ({ id: r.id, cpsAssessment: r.cpsAssessment })), null, 2))
    
    // Direct mutation
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      rows[idx].cpsAssessment = 'No longer relevant'
      rows[idx].cpsDisagreesWithPolice = false
    })
    
    console.log('[NLR Bulk] AFTER update:', JSON.stringify(rows.map(r => ({ id: r.id, cpsAssessment: r.cpsAssessment })), null, 2))
    
    setSuccessBanner(req, `Agreed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as No longer relevant`, 'This update has been sent to the police.')
    const fallback = `/cases/${caseId}/disclosure/no-longer-relevant`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallback
    
    // Force session save before redirect
    req.session.save(err => {
      if (err) console.error('Session save error:', err)
      console.log('[NLR Bulk] Session saved, redirecting...')
      return redirectBack(res, returnUrl, selectedIds[0])
    })
  })

  router.get('/cases/:caseId/disclosure/no-longer-relevant/bulk/request-item-reinstatement', (req, res) => {
    return renderBulkNlr(req, res, 'cases/disclosure/assess-non-sensitive/bulk/request-item-reinstatement')
  })

  router.post('/cases/:caseId/disclosure/no-longer-relevant/bulk/request-item-reinstatement', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    const selectedIds = parseIdsParam(req.body?.ids)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')
    if (!selectedIds.length) return res.status(400).send('Missing ids')
    const reason = (req.body?.reinstatementReason || '').trim()
    
    // Direct reference to session array
    const rows = req.session.data.disclosureNoLongerRelevantRows || []
    
    // Direct mutation
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return
      rows[idx].reinstatementRequested = true
      rows[idx].reinstatementReason = reason || null
      rows[idx].reinstatementRequestedAt = new Date().toISOString()
      rows[idx].cpsDisagreesWithPolice = true
    })
    
    setSuccessBanner(req, `Requested reinstatement for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`, 'This update has been sent to the police.')
    const fallback = `/cases/${caseId}/disclosure/no-longer-relevant`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallback
    
    // Force session save before redirect
    req.session.save(err => {
      if (err) console.error('Session save error:', err)
      return redirectBack(res, returnUrl, selectedIds[0])
    })
  })

}