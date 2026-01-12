// routes/case--disclosure.js

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

  ///Helpers
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



// ✅ Disclosure home
router.get('/cases/:caseId/disclosure', async (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).render('not-found')

  const caseMaterials = getCaseMaterialsForCase(req, _case)
  

  // ✅ keep CPS disclosure assessment status in sync
  syncCpsDisclosureAssessment(req, _case)


  return res.render('cases/disclosure/index', { _case, caseMaterials })
})




  // ✅ Assess non-sensitive
  router.get('/cases/:caseId/disclosure/assess-non-sensitive', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)
    syncCpsDisclosureAssessment(req, _case)

    //// Check everythuing is here
    console.log('caseId', caseId, 'caseMaterials session type:', Array.isArray(_.get(req,'session.data.caseMaterials')) ? 'array' : typeof _.get(req,'session.data.caseMaterials'))
    console.log('caseMaterials.Material length:', (caseMaterials.Material || []).length)

    res.render('cases/disclosure/assess-non-sensitive/index', {
      _case,
      caseMaterials
    })

    // Clear one-time success banner after render
    if (_.get(req, 'session.data.successBanner')) {
      _.unset(req, 'session.data.successBanner')
    }

  })


  ///////////////// ITEM DISCLOSABLE /////////////////////////////////////////////////////////////////////

  ///////////////// ITEM DISCLOSABLE /////////////////////////////////////////////////////////////////////

  // ✅ Item: assess as disclosable (GET) — row-aware
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    // 👇 Pull the row id from the query string (this is the id you already pass in the table link)
    const selectedId = (req.query && req.query.id) ? String(req.query.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    // 👇 Use the same session data that the table uses
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


 
  // ✅ Item: assess as disclosable (POST updates non-sensitive table rows in session)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    // From the form (Step 2)
    const selectedId = (req.body && (req.body.id || req.body.itemId)) ? String(req.body.id || req.body.itemId) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const rationale =
      (req.body && (req.body.disclosureStatusChangeReason || req.body.cpsRationale))
        ? String(req.body.disclosureStatusChangeReason || req.body.cpsRationale).trim()
        : ''

    // Same dataset the table uses
    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')
    

    


    // ✅ Apply the decision
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Disclosable')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)
    // ✅ Explicit disagreement with police
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    

    // ✅ Update overall CPS disclosure assessment status (Not started / In progress / Completed)
    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    // ✅ Success banner (rendered on the table page)
    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as Disclosable',
      text: 'This update has been sent to the police.'
    })

    // Redirect back to table (prefer returnUrl, fall back safely)
    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = (req.body && req.body.returnUrl) ? String(req.body.returnUrl) : fallbackReturnUrl

    // Add a query param we can use for banner + row focus
    const separator = returnUrl.includes('?') ? '&' : '?'
    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })


  ///////////////// ITEM DISCLOSABLE BY INSPECTION /////////////////////////////////////////////////////////////////////

  // ✅ Item: assess as disclosable by inspection (GET) — row-aware
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


  // ✅ Item: assess as disclosable by inspection (POST updates non-sensitive table rows in session)
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

    // ✅ Apply the decision
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Disclosable by inspection')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    // ✅ Explicit disagreement with police
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)


    // ✅ Update overall CPS disclosure assessment status
    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    // ✅ Success banner
    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as Disclosable by inspection',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = (req.body && req.body.returnUrl) ? String(req.body.returnUrl) : fallbackReturnUrl

    const separator = returnUrl.includes('?') ? '&' : '?'
    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })

  ///////////////// ITEM ASSSES AS EVIDENCE /////////////////////////////////////////////////////////////////////

  // ✅ Item: assess as evidence (GET) — row-aware
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

  // ✅ Item: assess as evidence (POST updates non-sensitive table rows in session)
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

    // ✅ Evidence-specific change
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Evidence')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

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



  ///////////////// ITEM NOT DISCLOSABLE /////////////////////////////////////////////////////////////////////

  // ✅ Item: assess as not disclosable (GET) — row-aware
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

  // ✅ Item: assess as not disclosable (POST updates non-sensitive table rows in session)
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

    // ✅ Apply decision
    _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Not disclosable')
    _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

    // ✅ Directional disagreement: Police passes -> CPS not disclosable
    const policeAssessment = _.get(req, `${rowsPath}[${idx}].policeAssessment`, '')
    const disagrees = String(policeAssessment) === 'Passes disclosure test'
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, disagrees)

    // ✅ Update overall completion status
    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    // ✅ Success banner
    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as Not disclosable',
      text: 'This update has been sent to the police.'
    })

    // Redirect back to table
    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = (req.body && req.body.returnUrl) ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })








  ///////////////// ITEM NOT CLEARLY NOT DISCLOSABLE /////////////////////////////////////////////////////////////////////

  // ✅ Item: assess as clearly not disclosable (GET)
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


  // ✅ Item: dispute sensitivity (POST)
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

    // ✅ Store dispute details (does not change cpsAssessment)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, reason || null)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())

    // ✅ Disputing sensitivity counts as disagreement
    _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)

    // (Optional) if you want the overall completion logic to change as a result of disputes,
    // call syncCpsDisclosureAssessment here. If not, leave it out.
    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Sensitivity disputed',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl || fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })



  ///////////////// ASSESS SENSITIVE /////////////////////////////////////////////////////////////////////

  // ✅ Item: dispute sensitivity (GET) — row-aware
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

  // ✅ Item: dispute sensitivity (POST)
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

    // ✅ Store dispute (no change to cpsAssessment)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, reason || null)
    _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())

    // Optional: if a row previously had a disagreement flag from other workflows,
    // leave it alone. (Dispute sensitivity is a separate concept.)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Sensitivity disputed',
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })


  /////////////// Change sensitivity flow ///////////////////////////////////////////////////////////////////

  // ✅ Change sensitivity dispute (GET) — row-aware
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

  // ✅ Change sensitivity dispute (POST)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/change-sensitivity-dispute', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedId = req.body?.id ? String(req.body.id) : null
    if (!selectedId) return res.status(400).send('Missing id')

    const option = req.body?.changeSensitivityDisputeOption
      ? String(req.body.changeSensitivityDisputeOption)
      : null

    const reason = req.body?.sensitivityDisputeReason
      ? String(req.body.sensitivityDisputeReason).trim()
      : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])
    const idx = rows.findIndex(r => String(r.id) === selectedId)
    if (idx === -1) return res.status(404).send('Row not found')

    if (option === 'agree') {
      // ✅ Remove the dispute tag + reason
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, false)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, null)

      _.set(req, 'session.data.successBanner', {
        titleText: 'Sensitivity dispute removed',
        text: 'The dispute has been removed from this item.'
      })
    } else if (option === 'wording') {
      // ✅ Keep the dispute tag, update wording
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputed`, true)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputeReason`, reason || null)
      _.set(req, `${rowsPath}[${idx}].sensitivityDisputedAt`, new Date().toISOString())

      _.set(req, 'session.data.successBanner', {
        titleText: 'Sensitivity dispute updated',
        text: 'The dispute wording has been updated.'
      })
    } else {
      return res.status(400).send('Missing option')
    }

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedId)}`)
  })



}
