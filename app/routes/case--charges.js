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
        location: true
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
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      offenceDate: req.body.offenceDate
    }
    return res.redirect(
      `/cases/${req.params.caseId}/charges/${req.params.chargeId}/edit/victim`
    )
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

    return res.render('v2/cases/charges/edit/victim', { _case, charge, defendant })
  })

  router.post('/cases/:caseId/charges/:chargeId/edit/victim', (req, res) => {
    req.session.data.editCharge = {
      ...req.session.data.editCharge,
      victimName:   req.body.victimName,
      victimStatus: req.body.victimStatus
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
      editCharge
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