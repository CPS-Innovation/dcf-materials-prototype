// app/routes/case--charges-propose-discontinuance.js
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {

  async function getCaseWithCharges (caseId) {
    return prisma.case.findUnique({
      where: { id: parseInt(caseId, 10) },
      include: {
        defendants: {
          include: {
            charges: { include: { victim: true } },
            defenceLawyer: true
          }
        },
        location: true,
        victims: { orderBy: { id: 'asc' } },
        witnesses: true
      }
    })
  }

  function resolveCharge (_case, chargeId) {
    const id        = parseInt(chargeId, 10)
    const charge    = _case.defendants.flatMap(d => d.charges).find(c => c.id === id)
    const defendant = _case.defendants.find(d => d.charges.some(c => c.id === id))
    return { charge, defendant }
  }

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

  function formatDateGovuk (dateStr) {
    if (!dateStr) return ''
    const [dd, mm, yyyy] = dateStr.split('/')
    const day = parseInt(dd, 10)
    const month = parseInt(mm, 10) - 1
    if (isNaN(day) || isNaN(month) || month < 0 || month > 11) return dateStr
    return `${day} ${MONTHS[month]} ${yyyy}`
  }

  function resolveFromSession (_case, req) {
    const chargeId = req.session.data.proposeDiscontinuanceCharge?.chargeId
    return chargeId
      ? resolveCharge(_case, chargeId)
      : { charge: null, defendant: null }
  }

  // ── index ─────────────────────────────────────────────────────────

  router.get('/cases/:caseId/charges/propose-discontinuance/index', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.chargeId) {
      req.session.data.proposeDiscontinuanceCharge = { chargeId: req.query.chargeId }
    }

    if (req.query.returnUrl) {
      req.session.data.proposeDiscontinuanceCharge = {
        ...req.session.data.proposeDiscontinuanceCharge,
        returnUrl: req.query.returnUrl
      }
    }

    const { charge, defendant } = resolveFromSession(_case, req)

    return res.render('v2/cases/charges/propose-discontinuance/index', {
      _case,
      charge,
      defendant
    })
  })

  router.post('/cases/:caseId/charges/propose-discontinuance/index', (req, res) => {
    req.session.data.proposeDiscontinuanceCharge = {
      ...req.session.data.proposeDiscontinuanceCharge,
      reasonForDiscontinue: req.body.reasonForDiscontinue,
      policeReplyByDate: req.body.policeReplyByDate
    }

    const returnUrl = req.session.data.proposeDiscontinuanceCharge?.returnUrl
    req.session.save(() => res.redirect(
      returnUrl || `/cases/${req.params.caseId}/charges/propose-discontinuance/check`
    ))
  })

  // ── check ─────────────────────────────────────────────────────────

  router.get('/cases/:caseId/charges/propose-discontinuance/check', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveFromSession(_case, req)
    const reasonForDiscontinue = req.session.data.proposeDiscontinuanceCharge?.reasonForDiscontinue || ''
    const policeReplyByDate = formatDateGovuk(req.session.data.proposeDiscontinuanceCharge?.policeReplyByDate || '')

    return res.render('v2/cases/charges/propose-discontinuance/check', {
      _case,
      charge,
      defendant,
      reasonForDiscontinue,
      policeReplyByDate
    })
  })

  router.post('/cases/:caseId/charges/propose-discontinuance/check', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = resolveFromSession(_case, req)

    if (charge) {
      const proposedIds = req.session.data.proposedDiscontinuanceChargeIds || []
      if (!proposedIds.includes(charge.id)) proposedIds.push(charge.id)
      req.session.data.proposedDiscontinuanceChargeIds = proposedIds
    }

    if (charge && defendant) {
      req.session.data.successBanner = {
        text: `Discontinuance proposed for ${defendant.firstName} ${defendant.lastName} for charge ${charge.chargeCode}`
      }
    }

    req.session.save(() => res.redirect(`/cases/${req.params.caseId}/details#defendants`))
  })

}
