// app/routes/case--charges-revoke-proposal.js
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

  function resolveFromSession (_case, req) {
    const chargeId = req.session.data.revokeProposalCharge?.chargeId
    return chargeId
      ? resolveCharge(_case, chargeId)
      : { charge: null, defendant: null }
  }

  // ── index ─────────────────────────────────────────────────────────

  router.get('/cases/:caseId/charges/revoke-proposal/index', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    if (req.query.chargeId) {
      req.session.data.revokeProposalCharge = { chargeId: req.query.chargeId }
    }

    const { charge, defendant } = resolveFromSession(_case, req)

    return res.render('v2/cases/charges/revoke-proposal/index', {
      _case,
      charge,
      defendant
    })
  })

  router.post('/cases/:caseId/charges/revoke-proposal/index', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge } = resolveFromSession(_case, req)

    if (charge) {
      const proposedIds = req.session.data.proposedDiscontinuanceChargeIds || []
      req.session.data.proposedDiscontinuanceChargeIds = proposedIds.filter(id => id !== charge.id)

      req.session.data.successBanner = {
        text: `Proposal revoked for charge ${charge.chargeCode}`
      }
    }

    req.session.save(() => res.redirect(`/cases/${req.params.caseId}/details#defendants`))
  })

}
