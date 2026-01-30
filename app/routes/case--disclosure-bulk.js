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

  /////////////////////////// HELPERS //////////////////////////////////////

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
   * IMPORTANT BUSINESS RULE:
   * - Items marked "No longer relevant" MUST NOT:
   *   - count towards NS progress
   *   - flip NS into "In progress"
   *
   * This allows NLR work to happen independently of NS assessment.
   */
  function computeNonSensitiveProgress(rows) {
    const assessableRows = (rows || []).filter(r =>
      r &&
      r.cpsAssessment &&
      r.cpsAssessment !== 'No longer relevant'
    )

    if (assessableRows.length === 0) {
      return 'Not started yet'
    }

    const touchedRows = assessableRows.filter(r =>
      r.cpsAssessment !== 'To be assessed'
    )

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
  // (unchanged routes above omitted for brevity)

  // ===========================================================================
  // ✅ BULK: AGREE NO LONGER RELEVANT
  //
  // NOTE:
  // These routes LIVE under assess-non-sensitive for legacy reasons,
  // but MUST behave like NLR routes:
  //   - redirect back to /disclosure/no-longer-relevant
  //   - NOT influence NS progress
  // ===========================================================================

  router.get('/cases/:caseId/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    const selectedIds = parseIdsParam(req.query?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const { selectedRows } = resolveSelectedRows(req, selectedIds)
    if (!selectedRows.length) return res.status(404).send('No rows found')

    return res.render('cases/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant', {
      _case,
      caseMaterials,
      selectedIds,
      selectedRows,
      returnUrl: req.query?.returnUrl
    })
  })

  router.post('/cases/:caseId/disclosure/assess-non-sensitive/bulk/agree-no-longer-relevant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const selectedIds = parseIdsParam(req.body?.ids)
    if (!selectedIds.length) return res.status(400).send('Missing ids')

    const rowsPath = 'session.data.disclosureNonSensitiveRows'
    const rows = _.get(req, rowsPath, [])

    selectedIds.forEach(id => {
      const idx = rows.findIndex(r => String(r.id) === String(id))
      if (idx === -1) return

      // Agreeing with police = CPS assessment matches NLR
      _.set(req, `${rowsPath}[${idx}].cpsAssessment`, 'No longer relevant')
      _.set(req, `${rowsPath}[${idx}].cpsDisagreesWithPolice`, false)
    })

    const _case = await fetchCase(caseId)
    if (_case) syncCpsDisclosureAssessment(req, _case)

    _.set(req, 'session.data.successBanner', {
      titleText: `Agreed ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} as No longer relevant`,
      text: 'This update has been sent to the police.'
    })

    // 🔴 CRITICAL FIX:
    // NLR bulk actions MUST return to the NLR hub,
    // NOT assess-non-sensitive
    const fallbackReturnUrl = `/cases/${caseId}/disclosure/no-longer-relevant`
    const returnUrl = req.body?.returnUrl
      ? String(req.body.returnUrl)
      : fallbackReturnUrl

    const separator = returnUrl.includes('?') ? '&' : '?'
    return res.redirect(`${returnUrl}${separator}updatedRow=${encodeURIComponent(selectedIds[0])}`)
  })

}