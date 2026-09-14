const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Reviews tab — currently just a stub (see _shared/_includes/case/reviews/main-tabs.njk).
// POST for now because the only way in today is the "Review case" action
// on cases/pcd-appeal/decision.html; a GET can be added when the dcf
// case navigation's "Reviews" link needs to land here directly.
module.exports = router => {

  router.post('/cases/:caseId/reviews', async (req, res) => {
    const caseId = parseInt(req.params.caseId)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: { defendants: true }
    })
    if (!_case) return res.status(404).render('not-found')

    res.render('cases/reviews/index', { _case })
  })

}
