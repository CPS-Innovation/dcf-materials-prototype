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


    // ✅ Bulk: assess as clearly not disclosable (GET)
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable', async (req, res) => {
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

    return res.render('cases/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable', {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl
    })
  })


  // ✅ Bulk: assess as clearly not disclosable (POST)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/clearly-not-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    // ids comes from hidden input
    const idsParam = req.body?.ids ? String(req.body.ids) : ''
    const selectedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    // shared rationale field from bulk template
    const rationale = req.body?.bulkRationale ? String(req.body.bulkRationale).trim() : ''

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    // Apply decision to each selected row
    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'Clearly not disclosable')
      _.set(req, `${rowsPath}[${idx}].cpsRationale`, rationale || null)

      // keep behaviour aligned with single item flows
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, true)
    })

    // Keep progress tags in sync
    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    // Success banner
    _.set(req, 'session.data.successBanner', {
      titleText: `Assessed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as Clearly not disclosable`,
      text: 'This update has been sent to the police.'
    })

    const fallbackReturnUrl = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl) : fallbackReturnUrl
    const separator = returnUrl.includes('?') ? '&' : '?'

    // focus first selected row
    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
  })
  
}
