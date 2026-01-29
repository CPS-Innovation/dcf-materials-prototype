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

    // Persist onto case materials so your Disclosure task list shows the right tag text
    _.set(cm, 'cpsDisclosureAssessment.hasAssessedNonSensitive', progress)
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

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const nlrRows = rows.filter(r => String(r?.policeAssessment || '').toLowerCase() === 'no longer relevant')

    // If no items are NLR, send them back where they came from (keeps prototype tidy)
    if (!nlrRows.length) {
      const fallback = `/cases/${caseId}/material?tab=disclosure`
      const returnUrl = req.query?.returnUrl ? String(req.query.returnUrl) : fallback
      return res.redirect(returnUrl)
    }

    return res.render('cases/disclosure/no-longer-relevant/index', {
      _case,
      caseMaterials,
      nlrRows,
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

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
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

    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
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

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
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

}
