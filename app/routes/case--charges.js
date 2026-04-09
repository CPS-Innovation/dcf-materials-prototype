const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {

  // ------------------------------------------------------------------
  // Shared helper — fetches case with defendants + charges.
  // Used by every step in the edit flow.
  async function getCaseWithCharges (caseId) {
    return prisma.case.findUnique({
      where: { id: parseInt(caseId, 10) },
      include: {
        defendants: {
          include: {
            charges: true,
            defenceLawyer: true
          }
        },
        location: true,
        victims: true,
        witnesses: true
      }
    })
  }

  // Resolves the specific charge and its owning defendant from a loaded case.
  function resolveCharge (_case, chargeId) {
    const id       = parseInt(chargeId, 10)
    const charge   = _case.defendants.flatMap(d => d.charges).find(c => c.id === id)
    const defendant = _case.defendants.find(d => d.charges.some(c => c.id === id))
    return { charge, defendant }
  }


  // ------------------------------------------------------------------
  // STEP 1 — DATE
  // GET  /cases/:caseId/charges/:chargeId/edit/date
  // POST /cases/:caseId/charges/:chargeId/edit/date  →  victim
  router.get('/cases/:caseId/charges/:chargeId/edit/date', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    // Seed session with current charge data on first visit
    if (!req.session.data.editCharge) {
      req.session.data.editCharge = {
        offenceDate: charge.offenceDate
      }
    }

    return res.render('v2/cases/charges/edit/date', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/date', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit`
    if (req.body.correctDate === 'Yes') {
      return res.redirect(`${base}/victim`)
    }
    return res.redirect(`${base}/date-type`)
  })


  // ------------------------------------------------------------------
  // STEP 1b — DATE TYPE
  // GET  /cases/:caseId/charges/:chargeId/edit/date-type
  // POST /cases/:caseId/charges/:chargeId/edit/date-type  →  single-date | multiple-date
  router.get('/cases/:caseId/charges/:chargeId/edit/date-type', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')
    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')
    return res.render('v2/cases/charges/edit/date-type', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/date-type', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit`
    req.session.data.editCharge = { ...req.session.data.editCharge, dateType: req.body.dateType }
    if (req.body.dateType === 'singleDate') return res.redirect(`${base}/single-date`)
    return res.redirect(`${base}/multiple-date`)
  })


  // ------------------------------------------------------------------
  // STEP 1c — SINGLE DATE
  // GET  /cases/:caseId/charges/:chargeId/edit/single-date
  // POST /cases/:caseId/charges/:chargeId/edit/single-date  →  victim
  router.get('/cases/:caseId/charges/:chargeId/edit/single-date', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')
    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')
    return res.render('v2/cases/charges/edit/single-date', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/single-date', (req, res) => {
    req.session.data.editCharge = { ...req.session.data.editCharge, offenceDate: req.body.offenceDate }
    return res.redirect(`/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/victim`)
  })


  // ------------------------------------------------------------------
  // STEP 1d — MULTIPLE DATES
  // GET  /cases/:caseId/charges/:chargeId/edit/multiple-date
  // POST /cases/:caseId/charges/:chargeId/edit/multiple-date  →  victim
  router.get('/cases/:caseId/charges/:chargeId/edit/multiple-date', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')
    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')
    return res.render('v2/cases/charges/edit/multiple-date', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/multiple-date', (req, res) => {
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      offenceDateFrom: req.body.offenceDateFrom,
      offenceDateTo:   req.body.offenceDateTo
    }
    return res.redirect(`/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/victim`)
  })


  // ------------------------------------------------------------------
  // STEP 2 — VICTIM
  // GET  /cases/:caseId/charges/:chargeId/edit/victim
  // POST /cases/:caseId/charges/:chargeId/edit/victim  →  summary
  router.get('/cases/:caseId/charges/:chargeId/edit/victim', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    return res.render('v2/cases/charges/edit/victim', { _case, charge, defendant, victims: _case.witnesses })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/victim', (req, res) => {
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      victimId: req.body.victimId
    }
    return res.redirect(
      `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/summary`
    )
  })


  // ------------------------------------------------------------------
  // STEP 3 — SUMMARY (charge particulars)
  // GET  /cases/:caseId/charges/:chargeId/edit/summary
  // POST /cases/:caseId/charges/:chargeId/edit/summary  →  check
  router.get('/cases/:caseId/charges/:chargeId/edit/summary', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    return res.render('v2/cases/charges/edit/summary', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/summary', (req, res) => {
    const base = `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit`
    if (req.body.chargeParticularsCorrect === 'Yes') {
      return res.redirect(`${base}/check`)
    }
    return res.redirect(`${base}/particulars`)
  })


  // ------------------------------------------------------------------
  // STEP 3b — PARTICULARS (edit the text)
  // GET  /cases/:caseId/charges/:chargeId/edit/particulars
  // POST /cases/:caseId/charges/:chargeId/edit/particulars  →  check
  router.get('/cases/:caseId/charges/:chargeId/edit/particulars', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    return res.render('v2/cases/charges/edit/particulars', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/particulars', (req, res) => {
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      particulars: req.body.particulars
    }
    return res.redirect(
      `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/check`
    )
  })


  // ------------------------------------------------------------------
  // STEP 4 — CHECK ANSWERS
  // GET  /cases/:caseId/charges/:chargeId/edit/check
  // POST /cases/:caseId/charges/:chargeId/edit/check  →  saves + back to charges index
  router.get('/cases/:caseId/charges/:chargeId/edit/check', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveCharge(_case, req.params.chargeId)
    if (!charge) return res.status(404).render('not-found')

    const editCharge = req.session.data.editCharge || {}

    return res.render('v2/cases/charges/edit/check', {
      _case,
      charge,
      defendant,
      editCharge,
      witnesses: _case.witnesses
    })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/check', async (req, res) => {
    const chargeId   = parseInt(req.params.chargeId, 10)
    const editCharge = req.session.data.editCharge || {}

    // Persist changes back to the database
    await prisma.charge.update({
      where: { id: chargeId },
      data: {
        offenceDate:  editCharge.offenceDate ? new Date(editCharge.offenceDate) : undefined,
        particulars:  editCharge.particulars  || undefined
        // victimName / victimStatus: add here once fields exist on the Charge model
      }
    })

    // Clear the edit session data
    delete req.session.data.editCharge

    return res.redirect(`/cases/${req.params.caseId}/defendants?success=charge-updated`)
  })

}