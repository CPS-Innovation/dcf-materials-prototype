const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Seed indictment list (array)
const caseIndictments = require('../data/case-indictments.json')

// fast lookup: { "12": {..seed..}, "13": {..seed..} }
const seedByCaseId = Object.fromEntries(caseIndictments.map(c => [String(c.id), c]))

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

  async function fetchCase(caseId) {
    return prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: { include: { defenceLawyer: true, charges: true } },
        victims: true,
        hearings: true,
        location: true
      }
    })
  }

  // ============================================================
  // /cases/:caseId/indictment (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('error/404')

    const seedCase = seedByCaseId[String(_case.id)] || null

    // Prefer session status, fall back to seed, then default
    const indictment = _.get(req, `session.data.indictments.${caseId}`, {
      status: seedCase?.numberOfCounts || 'Not started',
      counts: []
    })

    const successBanner = _.get(req, 'session.data.successBanner', null)
    _.unset(req, 'session.data.successBanner')

    return res.render('cases/indictment/index', {
      _case,
      seedCase,
      indictment,
      successBanner
    })
  })

  router.post('/cases/:caseId/indictment', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const action = (req.body.action || '').toString()
    const basePath = `session.data.indictments.${caseId}`

    const indictment = _.get(req, basePath, {
      status: 'Not started',
      counts: []
    })

    if (action === 'start') indictment.status = 'In progress'

    if (action === 'save') {
      indictment.status = req.body.status || indictment.status || 'In progress'
      if (req.body.countsJson) {
        try {
          const parsed = JSON.parse(req.body.countsJson)
          if (Array.isArray(parsed)) indictment.counts = parsed
        } catch {
          // ignore bad JSON in prototype
        }
      }
    }

    if (action === 'complete') indictment.status = 'Completed'

    indictment.lastSavedAt = new Date().toISOString()
    _.set(req, basePath, indictment)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Indictment saved',
      text: 'Your changes have been saved.'
    })

    return res.redirect(`/cases/${caseId}/indictment`)
  })

  // ============================================================
  // /cases/:caseId/indictment/show (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/show', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('error/404')

    const seedCase = caseIndictments.find(c => Number(c.id) === Number(caseId))
    if (!seedCase) return res.status(404).render('error/404')

    const indictment = _.get(req, `session.data.indictments.${caseId}`, {
      status: 'Not started',
      counts: []
    })

    const successBanner = _.get(req, 'session.data.successBanner', null)
    _.unset(req, 'session.data.successBanner')

    return res.render('cases/indictment/show', {
      _case,
      seedCase,
      indictment,
      successBanner
    })
  })

  router.post('/cases/:caseId/indictment/show', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const action = (req.body.action || '').toString()
    const basePath = `session.data.indictments.${caseId}`

    const indictment = _.get(req, basePath, {})

    if (action === 'mark-ready') {
      indictment.readyForService = true
      indictment.readyAt = new Date().toISOString()
    }

    if (action === 'reopen') {
      indictment.readyForService = false
      indictment.status = 'In progress'
    }

    _.set(req, basePath, indictment)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Indictment updated',
      text: 'The indictment status has been updated.'
    })

    return res.redirect(`/cases/${caseId}/indictment/show`)
  })


  // ============================================================
  // /cases/:caseId/indictment/counts/date-and-charges
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('error/404')

    // Pull draft count data from session (or initialise)
    const draftCount = _.get(
      req,
      `session.data.indictmentDrafts.${caseId}.currentCount`,
      {}
    )

    return res.render('cases/indictment/counts/date-and-charges', {
      _case,
      draftCount
    })
  })


  router.post('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    // Ensure draft structure exists
    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`

    const draftCount = _.get(req, basePath, {})

    // Expected form fields (adjust names if needed):
    // req.body.offenceDate
    // req.body.chargeCode
    // req.body.chargeDescription

    draftCount.offenceDate = req.body.offenceDate
    draftCount.chargeCode = req.body.chargeCode
    draftCount.chargeDescription = req.body.chargeDescription

    draftCount.lastUpdatedAt = new Date().toISOString()

    _.set(req, basePath, draftCount)

    // Mark indictment as "In progress" once a count is drafted
    _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

    return res.redirect(
      `/cases/${caseId}/indictment/counts/particulars`
    )
  })
}