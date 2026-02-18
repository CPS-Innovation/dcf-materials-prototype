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

  // ----------------------------
  // /counts/added
  // ----------------------------

router.get('/cases/:caseId/indictment/counts/added', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const indictmentBasePath = `session.data.indictments.${caseId}`
  const indictment = _.get(req, indictmentBasePath, { counts: [] })
  const counts = indictment.counts || []

  // last added = last in array (because you push then redirect)
  const addedCount = counts.length ? counts[counts.length - 1] : null

  return res.render('cases/indictment/counts/added/index', {
    _case,
    indictment,
    counts,
    addedCount
  })
})


  router.post('/cases/:caseId/indictment/counts/added', (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''

    return res.redirect(`/cases/${caseId}/indictment/counts/added${qs}`)
  })
}
