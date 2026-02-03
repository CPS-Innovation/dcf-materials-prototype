const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
//// Indictment data
const caseIndictments = require('../data/case-indictments.json')

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
        defendants: {
          include: {
            defenceLawyer: true,
            charges: true
          }
        },
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
    if (!_case) return res.status(404).render('not-found')

    const indictment = _.get(req, `session.data.indictments.${caseId}`, {
      status: 'Not started',
      counts: []
    })

    const successBanner = _.get(req, 'session.data.successBanner', null)
    _.unset(req, 'session.data.successBanner')

    return res.render('cases/indictment/index', {
      _case,
      indictment,
      successBanner,
      caseIndictments
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

    if (action === 'start') {
      indictment.status = 'In progress'
    }

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

    if (action === 'complete') {
      indictment.status = 'Completed'
    }

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

  router.get('/cases/:caseId/indictment/count', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const indictment = _.get(req, `session.data.indictments.${caseId}`, {
      status: 'Not started',
      counts: []
    })

    return res.render('cases/indictment/count', {
      _case,
      indictment
    })
  })

  router.post('/cases/:caseId/indictment/count', async (req, res) => {
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
}