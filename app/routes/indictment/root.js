// app/routes/indictment/root.js

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const {
  _,
  fetchCase,
  parseCaseId,
  getCountsCaseFor,
  buildChargeOptionsFromCountsCase,
  buildChargeOptionsFromPrismaCase,
  chargeLibrary
} = require('./_shared')

module.exports = router => {
    router.get('/cases/:caseId/indictment', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const _case = await fetchCase(caseId)
      if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

      const countsCase = getCountsCaseFor(caseId)

      const indictment = _.get(req, `session.data.indictments.${caseId}`, {
        status: countsCase.numberOfCounts || 'Not started',
        counts: []
      })

      const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)
      const caseChargeOptions = buildChargeOptionsFromPrismaCase(_case)

      const successBanner = _.get(req, 'session.data.successBanner', null)
      _.unset(req, 'session.data.successBanner')

      return res.render('cases/indictment/index', {
        _case,
        indictment,
        successBanner,
        countsCase,
        chargeOptions,      // narrative/library enriched
        caseChargeOptions,  // prisma charges (deduped)
        chargeLibrary
      })
    })

    router.post('/cases/:caseId/indictment', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const action = (req.body.action || '').toString()
      const basePath = `session.data.indictments.${caseId}`
      const indictment = _.get(req, basePath, { status: 'Not started', counts: [] })

      if (action === 'start') indictment.status = 'In progress'
      if (action === 'complete') indictment.status = 'Completed'

      indictment.lastSavedAt = new Date().toISOString()
      _.set(req, basePath, indictment)

      _.set(req, 'session.data.successBanner', {
        titleText: 'Indictment saved',
        text: 'Your changes have been saved.'
      })

      return res.redirect(`/cases/${caseId}/indictment`)
    })


      // /cases/:caseId/indictment/preview (GET)
      router.get('/cases/:caseId/indictment/preview', async (req, res) => {
        const caseId = parseCaseId(req, res)
        if (!caseId) return

        const _case = await fetchCase(caseId)
        if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

        const indictment = _.get(req, `session.data.indictments.${caseId}`, { status: 'In progress', counts: [] })

        return res.render('cases/indictment/preview/index', {
          _case,
          indictment
        })
      })

      ///cases/:caseId/indictment/save (POST)
      router.post('/cases/:caseId/indictment/complete', async (req, res) => {
        const caseId = Number(req.params.caseId)
        if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')


        return res.redirect(`/cases/${caseId}/indictment`)
      })



}
