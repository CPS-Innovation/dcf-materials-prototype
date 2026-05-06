// app/routes/case--charges-discontinue.js
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

  // GET /cases/:caseId/charges/discontinue/index?chargeId=:chargeId
  router.get('/cases/:caseId/charges/discontinue/index', async (req, res) => {
    const _case = await getCaseWithCharges(req.params.caseId)
    if (!_case) return res.status(404).render('not-found')

    const { charge, defendant } = req.query.chargeId
      ? resolveCharge(_case, req.query.chargeId)
      : { charge: null, defendant: null }

    return res.render('v2/cases/charges/discontinue/index', {
      _case,
      charge,
      defendant
    })
  })

}
