// routes/case--disclosure-bulk.js

const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {

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

  /////////////////////////// Helpers //////////////////////////////////////

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

  function computeNonSensitiveProgress(rows) {
    const total = Array.isArray(rows) ? rows.length : 0
    if (total === 0) return 'Not started yet'

    const assessedCount = rows.filter(r => {
      const status = (r && r.cpsAssessment) ? String(r.cpsAssessment) : ''
      return status && status !== 'To be assessed'
    }).length

    if (assessedCount === 0) return 'Not started yet'
    if (assessedCount < total) return 'In progress'
    return 'Completed'
  }

  function syncCpsDisclosureAssessment(req, _case) {
    const cm = getCaseMaterialsForCase(req, _case)
    if (!cm || !cm.cpsDisclosureAssessment) return

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const progress = computeNonSensitiveProgress(rows)

    _.set(cm, 'cpsDisclosureAssessment.hasAssessedNonSensitive', progress)
  }


  // Police assessment = Passes disclosure test AND CPS = Not disclosable or Clearly not disclosable
  // Police assessment = Does not pass disclosure test AND CPS = Disclosable or Disclosable by inspection
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
    return idsParam.split(',').map(s => s.trim()).filter(Boolean)
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
    const separator = returnUrl.includes('?') ? '&' : '?'
    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(focusId)}`)
  }

  /////////////////////////// BULK ROUTES //////////////////////////////////////

  // ✅ Bulk: assess as disclosable (GET)
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const idsParam = req.query?.ids ? String(req.query.ids) : ''
    const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRows = selectedIds
      .map(id => rows.find(r => String(r.id) === String(id)))
      .filter(Boolean)

    if (!selectedRows.length) return res.status(404).send('No rows found')

    // Precompute per-row disagreement for this proposed decision
    selectedRows.forEach(r => {
      r.cpsDisagreesWithPolice = computeCpsDisagreesWithPolice(r.policeAssessment, 'Disclosable')
    })

    const returnUrl = req.query?.returnUrl
      ? String(req.query.returnUrl)
      : `/cases/${caseId}/disclosure/assess-non-sensitive`

    return res.render('cases/disclosure/assess-non-sensitive/bulk/disclosable', {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl
    })
  })

  // ✅ Bulk: assess as disclosable (POST)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const idsParam = req.body?.ids ? String(req.body.ids) : ''
    const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Disclosable')
      _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

      const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
      const disagrees = computeCpsDisagreesWithPolice(policeAssessment, 'Disclosable')
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, disagrees)
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Disclosable`,
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
  })



 // ✅ Bulk: assess as disclosable by inspection (GET)
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/disclosable-by-inspection', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const idsParam = req.query?.ids ? String(req.query.ids) : ''
    const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRows = selectedIds
      .map(id => rows.find(r => String(r.id) === String(id)))
      .filter(Boolean)

    if (!selectedRows.length) return res.status(404).send('No rows found')

    // Precompute per-row disagreement for this proposed decision
    selectedRows.forEach(r => {
      r.cpsDisagreesWithPolice = computeCpsDisagreesWithPolice(r.policeAssessment, 'Disclosable by inspection')
    })

    const returnUrl = req.query?.returnUrl
      ? String(req.query.returnUrl)
      : `/cases/${caseId}/disclosure/assess-non-sensitive`

    return res.render('cases/disclosure/assess-non-sensitive/bulk/disclosable-by-inspection', {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl
    })
  })


  // ✅ Bulk: assess as disclosable by inspection (POST)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/disclosable-by-inspection', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const idsParam = req.body?.ids ? String(req.body.ids) : ''
    const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Disclosable by inspection')
      _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

      const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
      const disagrees = computeCpsDisagreesWithPolice(policeAssessment, 'Disclosable by inspection')
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, disagrees)
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Disclosable by inspection`,
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
  })



  // ✅ Bulk: Clearly not disclosable (GET)
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedIds = parseIdsParam(req.query?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const { selectedRows } = resolveSelectedRows(req, selectedIds)
    if (!selectedRows.length) return res.status(404).send('No rows found')

    return res.render('cases/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable', {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl: getReturnUrl(req, caseId)
    })
  })

  // ✅ Bulk: Clearly not disclosable (POST)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedIds = parseIdsParam(req.body?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Clearly not disclosable')
      _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

      const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
      const disagrees = computeCpsDisagreesWithPolice(policeAssessment, 'Clearly not disclosable')
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, disagrees)
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Clearly not disclosable`,
      text: 'This update has been sent to the police.'
    })

    const returnUrl = postReturnUrl(req, caseId)
    return redirectBack(res, returnUrl, selectedIds[0])
  })


  // ✅ Bulk: Not disclosable (GET)
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedIds = parseIdsParam(req.query?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const { selectedRows } = resolveSelectedRows(req, selectedIds)
    if (!selectedRows.length) return res.status(404).send('No rows found')

    return res.render('cases/disclosure/assess-non-sensitive/bulk/not-disclosable', {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl: getReturnUrl(req, caseId)
    })
  })

// ✅ Bulk: assess as not disclosable (GET)
router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/not-disclosable', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).render('not-found')

  const caseMaterials = getCaseMaterialsForCase(req, _case)

  const idsParam = req.query?.ids ? String(req.query.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
  const selectedRows = selectedIds
    .map(id => rows.find(r => String(r.id) === String(id)))
    .filter(Boolean)

  if (!selectedRows.length) return res.status(404).send('No rows found')

  // Precompute per-row disagreement for this proposed decision
  selectedRows.forEach(r => {
    r.cpsDisagreesWithPolice = computeCpsDisagreesWithPolice(r.policeAssessment, 'Not disclosable')
  })

  const returnUrl = req.query?.returnUrl
    ? String(req.query.returnUrl)
    : `/cases/${caseId}/disclosure/assess-non-sensitive`

  return res.render('cases/disclosure/assess-non-sensitive/bulk/not-disclosable', {
    _case,
    caseMaterials,
    selectedIds,
    selectedRows,
    returnUrl
  })
})


// ✅ Bulk: assess as not disclosable (POST)
router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/not-disclosable', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const idsParam = req.body?.ids ? String(req.body.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const rationale = req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : ''

  const rowsPath = 'session.data.disclosureNonSensitiveRows'
  const rows = _.get(req, rowsPath, [])

  selectedIds.forEach(id => {
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) return

    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Not disclosable')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
    const disagrees = computeCpsDisagreesWithPolice(policeAssessment, 'Not disclosable')
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, disagrees)
  })

  const _case = await fetchCase(caseId)
  if (_case) syncCpsDisclosureAssessment(req, _case)

  _.set(req, 'session.data.successBanner', {
    titleText: `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Not disclosable`,
    text: 'This update has been sent to the police.'
  })

  const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
  const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
  const separator = returnUrl.includes('?') ? '&' : '?'

  return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
})


 // ✅ Bulk: assess as evidence (GET)
router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/evidence', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).render('not-found')

  const caseMaterials = getCaseMaterialsForCase(req, _case)

  const idsParam = req.query?.ids ? String(req.query.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
  const selectedRows = selectedIds
    .map(id => rows.find(r => String(r.id) === String(id)))
    .filter(Boolean)

  if (!selectedRows.length) return res.status(404).send('No rows found')

  // Evidence isn't in the disagreement rule set, so don't auto-flag disagreement.
  // Keep this false unless your product policy says otherwise.
  selectedRows.forEach(r => {
    r.cpsDisagreesWithPolice = false
  })

  const returnUrl = req.query?.returnUrl
    ? String(req.query.returnUrl)
    : `/cases/${caseId}/disclosure/assess-non-sensitive`

  return res.render('cases/disclosure/assess-non-sensitive/bulk/evidence', {
    _case,
    caseMaterials,
    selectedIds,
    selectedRows,
    returnUrl
  })
})


// ✅ Bulk: assess as evidence (POST)
router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/evidence', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const idsParam = req.body?.ids ? String(req.body.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const rationale = req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : ''

  const rowsPath = 'session.data.disclosureNonSensitiveRows'
  const rows = _.get(req, rowsPath, [])

  selectedIds.forEach(id => {
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) return

    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Evidence')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    // Evidence isn't part of your agree/disagree rules, so don't mark disagreement.
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
  })

  const _case = await fetchCase(caseId)
  if (_case) syncCpsDisclosureAssessment(req, _case)

  _.set(req, 'session.data.successBanner', {
    titleText: `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Evidence`,
    text: 'This update has been sent to the police.'
  })

  const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
  const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
  const separator = returnUrl.includes('?') ? '&' : '?'

  return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
})


// ✅ Bulk: assess as no longer relevant (GET)
router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/assess-as-no-longer-relevant', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).render('not-found')

  const caseMaterials = getCaseMaterialsForCase(req, _case)

  const idsParam = req.query?.ids ? String(req.query.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
  const selectedRows = selectedIds
    .map(id => rows.find(r => String(r.id) === String(id)))
    .filter(Boolean)

  if (!selectedRows.length) return res.status(404).send('No rows found')

  const returnUrl = req.query?.returnUrl
    ? String(req.query.returnUrl)
    : `/cases/${caseId}/disclosure/assess-non-sensitive`

  return res.render('cases/disclosure/assess-non-sensitive/bulk/assess-as-no-longer-relevant', {
    _case,
    caseMaterials,
    selectedIds,
    selectedRows,
    returnUrl
  })
})


  // ✅ Bulk: assess as no longer relevant (POST)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/assess-as-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const idsParam = req.body?.ids ? String(req.body.ids) : ''
    const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rationale = req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
      _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
      _.set(req, `${rowsPath}[${idx}].noLongerRelevantReason`, rationale || null)

      // This is always a disagreement with the police assessment
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as No longer relevant`,
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
  })


  // ✅ Bulk: agree no longer relevant (GET)
router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).render('not-found')

  const caseMaterials = getCaseMaterialsForCase(req, _case)

  const idsParam = req.query?.ids ? String(req.query.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])

  const selectedRows = selectedIds
    .map(id => rows.find(r => String(r.id) === String(id)))
    .filter(Boolean)

  if (!selectedRows.length) return res.status(404).send('No rows found')

  const returnUrl = req.query?.returnUrl
    ? String(req.query.returnUrl)
    : `/cases/${caseId}/disclosure/assess-non-sensitive`

  return res.render('cases/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant', {
    _case,
    caseMaterials,
    selectedIds,
    selectedRows,
    returnUrl
  })
})


// ✅ Bulk: agree no longer relevant (POST)
router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const idsParam = req.body?.ids ? String(req.body.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  // Optional rationale field (use whatever your template names it)
  const rationale =
    (req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : '') ||
    (req.body?.agreeNoLongerRelevantReason ? String(req.body.agreeNoLongerRelevantReason).trim() : '') ||
    ''

  const rowsPath = 'session.data.disclosureNonSensitiveRows'
  const rows = _.get(req, rowsPath, [])

  selectedIds.forEach(id => {
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) return

    // Agreeing with police: CPS assessment becomes No longer relevant and disagreement is cleared
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)

    if (rationale) {
      _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale)
      _.set(req, `${rowsPath}[${idx}].noLongerRelevantReason`, rationale)
    }
  })

  const _case = await fetchCase(caseId)
  if (_case) syncCpsDisclosureAssessment(req, _case)

  _.set(req, 'session.data.successBanner', {
    titleText: `Agreed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as No longer relevant`,
    text: 'This update has been sent to the police.'
  })

  const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
  const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
  const separator = returnUrl.includes('?') ? '&' : '?'

  return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
})


// ✅ Bulk: dispute sensitivity (GET)
router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/dispute-sensitivity', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).render('not-found')

  const caseMaterials = getCaseMaterialsForCase(req, _case)

  // ids comes from query string, e.g. ?ids=1,2,3
  const idsParam = req.query?.ids ? String(req.query.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  // Resolve selected rows from the same session dataset the table uses
  const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
  const selectedRows = selectedIds
    .map(id => rows.find(r => String(r.id) === String(id)))
    .filter(Boolean)

  if (!selectedRows.length) return res.status(404).send('No rows found')

  const returnUrl = req.query?.returnUrl
    ? String(req.query.returnUrl)
    : `/cases/${caseId}/disclosure/assess-non-sensitive`

  return res.render('cases/disclosure/assess-non-sensitive/bulk/dispute-sensitivity', {
    _case,
    caseMaterials,
    selectedIds,
    selectedRows,
    returnUrl
  })
})


// ✅ Bulk: dispute sensitivity (POST)
router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/dispute-sensitivity', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  // ids comes from hidden input
  const idsParam = req.body?.ids ? String(req.body.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const reason = req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : ''

  const rowsPath = 'session.data.disclosureNonSensitiveRows'
  const rows = _.get(req, rowsPath, [])

  selectedIds.forEach(id => {
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) return

    // Mirror your single-item dispute behaviour
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, reason || null)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())

    // In your current single-item route, disputing sensitivity sets this true
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
  })

  const _case = await fetchCase(caseId)
  if (_case) syncCpsDisclosureAssessment(req, _case)

  _.set(req, 'session.data.successBanner', {
    titleText: `Sensitivity disputed for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`,
    text: 'This update has been sent to the police.'
  })

  const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
  const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
  const separator = returnUrl.includes('?') ? '&' : '?'

  return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
})



 // ✅ Bulk: change sensitivity dispute (GET)
router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/change-sensitivity-dispute', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).render('not-found')

  const caseMaterials = getCaseMaterialsForCase(req, _case)

  const idsParam = req.query?.ids ? String(req.query.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
  const selectedRows = selectedIds
    .map(id => rows.find(r => String(r.id) === String(id)))
    .filter(Boolean)

  if (!selectedRows.length) return res.status(404).send('No rows found')

  const returnUrl = req.query?.returnUrl
    ? String(req.query.returnUrl)
    : `/cases/${caseId}/disclosure/assess-non-sensitive`

  return res.render('cases/disclosure/assess-non-sensitive/bulk/change-sensitivity-dispute', {
    _case,
    caseMaterials,
    selectedIds,
    selectedRows,
    returnUrl
  })
})


// ✅ Bulk: change sensitivity dispute (POST)
router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/change-sensitivity-dispute', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const idsParam = req.body?.ids ? String(req.body.ids) : ''
  const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!selectedIds.length) return res.status(400).send('Missing ids')

  const option = req.body?.changeSensitivityDisputeOption
    ? String(req.body.changeSensitivityDisputeOption)
    : null

  const wording = req.body?.bulkWording ? String(req.body.bulkWording).trim() : ''

  const rowsPath = 'session.data.disclosureNonSensitiveRows'
  const rows = _.get(req, rowsPath, [])

  if (option !== 'agree' && option !== 'wording') {
    return res.status(400).send('Missing option')
  }

  selectedIds.forEach(id => {
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) return

    if (option === 'agree') {
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, false)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, null)

      // Optional: if dispute was the ONLY reason for disagreement, this is safe to clear.
      // If you prefer to keep any prior disagreement, delete this line.
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
    }

    if (option === 'wording') {
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, wording || null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())

      // Dispute implies disagreement
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    }
  })

  _.set(req, 'session.data.successBanner', {
    titleText: option === 'agree'
      ? `Sensitivity dispute removed for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`
      : `Sensitivity dispute updated for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`,
    text: option === 'agree'
      ? 'The dispute has been removed from the selected items.'
      : 'The dispute wording has been updated.'
  })

  const _case = await fetchCase(caseId)
  if (_case) syncCpsDisclosureAssessment(req, _case)

  const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
  const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
  const separator = returnUrl.includes('?') ? '&' : '?'

  return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
})



  // ✅ Bulk: Request updated description (GET)
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-updated-description', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedIds = parseIdsParam(req.query?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const { selectedRows } = resolveSelectedRows(req, selectedIds)
    if (!selectedRows.length) return res.status(404).send('No rows found')

    return res.render('cases/disclosure/assess-non-sensitive/bulk/request-updated-description', {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl: getReturnUrl(req, caseId)
    })
  })

  // ✅ Bulk: Request updated description (POST)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-updated-description', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedIds = parseIdsParam(req.body?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const requestText = req.body?.updatedDescriptionRequest
      ? String(req.body.updatedDescriptionRequest).trim()
      : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].updatedDescriptionRequest`, requestText || null)
      _.set(req, `${rowsPath}[${idx}].updatedDescriptionRequestedAt`, new Date().toISOString())
    })

    _.set(req, 'session.data.successBanner', {
      titleText: `Updated description requested for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`,
      text: 'This request has been sent to the police.'
    })

    const returnUrl = postReturnUrl(req, caseId)
    return redirectBack(res, returnUrl, selectedIds[0])
  })


  // ✅ Bulk: Request material (GET)
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-material', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedIds = parseIdsParam(req.query?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const { selectedRows } = resolveSelectedRows(req, selectedIds)
    if (!selectedRows.length) return res.status(404).send('No rows found')

    return res.render('cases/disclosure/assess-non-sensitive/bulk/request-material', {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl: getReturnUrl(req, caseId)
    })
  })

  // ✅ Bulk: Request material (POST)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/request-material', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedIds = parseIdsParam(req.body?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const reason = req.body?.requestMaterialReason
      ? String(req.body.requestMaterialReason).trim()
      : ''

    const day = req.body?.['materialNeededBy-day'] ? String(req.body['materialNeededBy-day']).trim() : ''
    const month = req.body?.['materialNeededBy-month'] ? String(req.body['materialNeededBy-month']).trim() : ''
    const year = req.body?.['materialNeededBy-year'] ? String(req.body['materialNeededBy-year']).trim() : ''

    let materialNeededBy = null
    if (day && month && year) {
      materialNeededBy = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].requestMaterialReason`, reason || null)
      _.set(req, `${rowsPath}[${idx}].materialNeededBy`, materialNeededBy)
      _.set(req, `${rowsPath}[${idx}].materialRequestedAt`, new Date().toISOString())
    })

    _.set(req, 'session.data.successBanner', {
      titleText: `Material requested for ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`,
      text: 'This request has been sent to the police.'
    })

    const returnUrl = postReturnUrl(req, caseId)
    return redirectBack(res, returnUrl, selectedIds[0])
  })

}
