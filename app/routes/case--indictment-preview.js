// app/routes/case--indictment-count-added.js
const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()


module.exports = router => {
  // ----------------------------
  // Helpers
  // ----------------------------
  const parseCaseId = (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) {
      res.status(400).send('Invalid case id')
      return null
    }
    return caseId
  }

  const safeReturnTo = (value) => {
    const v = String(value || '')
    if (!v) return ''
    if (!v.startsWith('/')) return ''
    if (!v.startsWith('/cases/')) return ''
    return v
  }

  async function fetchCase(caseId) {
    return prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: { include: { defenceLawyer: true, charges: true } },
        witnesses: { include: { statements: true } },
        victims: true,
        hearings: true,
        location: true
      }
    })
  }

  router.get('/cases/:caseId/indictment/preview', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const indictment = _.get(req, indictmentBasePath, { counts: [] })

    return res.render('cases/indictment/preview/index', {
      _case,
      indictment
    })
  })


 
}
