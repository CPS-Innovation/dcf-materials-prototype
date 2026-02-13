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

    // /cases/:caseId/indictment (GET)
    router.get('/cases/:caseId/indictment', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const _case = await fetchCase(caseId)
      if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

      const countsCase = getCountsCaseFor(caseId)

      const isCompleted = _.get(req, `session.data.indictmentCompleted.${caseId}`, false)
      const completedIndictment = _.get(req, `session.data.completedIndictments.${caseId}`, null)

      const indictment = _.get(req, `session.data.indictments.${caseId}`, {
        status: isCompleted ? 'Completed' : (countsCase.numberOfCounts || 'Not started'),
        counts: []
      })

      // 👇 ADD IT RIGHT HERE
      console.log('GET indictment', {
        caseId,
        isCompleted,
        hasCompletedIndictment: !!completedIndictment
      })

      const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)
      const caseChargeOptions = buildChargeOptionsFromPrismaCase(_case)

      const successBanner = _.get(req, 'session.data.successBanner', null)
      _.unset(req, 'session.data.successBanner')

      return res.render('cases/indictment/index', {
        _case,
        indictment,
        isCompleted,
        completedIndictment,
        readOnlyUrl: `/cases/${caseId}/indictment/preview/read-only`,
        successBanner,
        countsCase,
        chargeOptions,
        caseChargeOptions,
        chargeLibrary
      })
    })



    // /cases/:caseId/indictment/(POST)
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


    router.post('/cases/:caseId/indictment/complete', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const draftPath = `session.data.indictments.${caseId}`

      // ✅ handles undefined OR null
      const draft = _.get(req, draftPath) || { status: 'In progress', counts: [] }

      draft.status = 'Completed'
      draft.completedAt = new Date().toISOString()

      _.set(req, `session.data.completedIndictments.${caseId}`, draft)
      _.set(req, `session.data.indictmentCompleted.${caseId}`, true)
      _.unset(req, draftPath)

      _.set(req, 'session.data.successBanner', {
        titleText: 'Indictment saved',
        text: 'Indictment marked as completed.'
      })

      return res.redirect(`/cases/${caseId}/indictment`)
    })



    // /cases/:caseId/indictment/preview/read-only (GET)
    router.get('/cases/:caseId/indictment/preview/read-only', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const _case = await fetchCase(caseId)
      if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

      const indictment = _.get(req, `session.data.completedIndictments.${caseId}`, null)
      if (!indictment) return res.redirect(`/cases/${caseId}/indictment`)

      console.log('READ-ONLY HIT', caseId)

      return res.render('cases/indictment/preview/read-only', {
        _case,
        indictment
      })
    })


    // /cases/:caseId/indictment/task-list (GET)
    router.get('/cases/:caseId/indictment/task-list', async (req, res) => {
      const caseId = parseCaseId(req, res)
      if (!caseId) return

      const _case = await fetchCase(caseId)
      if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

      return res.render('cases/indictment/task-list/index', { _case })
    })


}
