const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// JSON sources (controlled narrative)
const countsData = require('../data/case-indictments.json')
const chargeLibrary = require('../data/charge-library.json')

// Lookups
const countsByCaseId = Object.fromEntries(countsData.map(c => [String(c.id), c]))
const libraryByCode = Object.fromEntries(chargeLibrary.map(c => [String(c.chargeCode), c]))

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

  // Always return a narrative case, even if caseId isn't 1–5
  function getCountsCaseFor(caseId) {
    const direct = countsByCaseId[String(caseId)]
    if (direct) return direct
    const idx = Math.abs(Number(caseId)) % countsData.length
    return countsData[idx]
  }

  // Build charge options (NO dedupe — keep multiple robbery entries if they exist)
  // Enrich from chargeLibrary via chargeCode.
  function buildChargeOptionsFromCountsCase(countsCase) {
    const options = []

    for (const pc of (countsCase.policeCharges || [])) {
      const lib = pc.chargeCode ? libraryByCode[String(pc.chargeCode)] : null

      options.push({
        policeChargeId: pc.policeChargeId, // stable per case
        chargeCode: pc.chargeCode || null,
        label: pc.label || '',
        policeParticulars: pc.policeParticulars || '',
        statementOfOffence: lib?.statementOfOffence || null,
        statute: lib?.statute || null,
        precedents: lib?.precedents || [],
        particularsStarter: lib?.templates?.particularsStarter || null
      })
    }

    return options
  }

  // ============================================================
  // /cases/:caseId/indictment (GET + POST)
  // ============================================================

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

    const successBanner = _.get(req, 'session.data.successBanner', null)
    _.unset(req, 'session.data.successBanner')

    return res.render('cases/indictment/index', {
      _case,
      indictment,
      successBanner,
      countsCase,
      chargeOptions,
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

  // ============================================================
  // /cases/:caseId/indictment/show (GET)
  // ============================================================

  router.get('/cases/:caseId/indictment/show', async (req, res) => {
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

    const successBanner = _.get(req, 'session.data.successBanner', null)
    _.unset(req, 'session.data.successBanner')

    return res.render('cases/indictment/show', {
      _case,
      countsCase,
      indictment,
      chargeOptions,
      successBanner,
      chargeLibrary
    })
  })

  // ============================================================
  // /cases/:caseId/indictment/counts/date-and-charges (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})

    return res.render('cases/indictment/counts/date-and-charges', {
      _case,
      countsCase,
      chargeOptions,
      draftCount
    })
  })

  router.post('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    // Radios return the selected policeChargeId
    draftCount.policeChargeId = req.body.policeChargeId || null

    const selected = chargeOptions.find(o => o.policeChargeId === draftCount.policeChargeId) || null
    if (selected) {
      draftCount.chargeCode = selected.chargeCode
      draftCount.chargeLabel = selected.label
      draftCount.policeParticulars = selected.policeParticulars
      draftCount.statementOfOffence = selected.statementOfOffence
    }

    draftCount.offenceDateFrom = {
      day: req.body['date-of-offence-from-day'] || '',
      month: req.body['date-of-offence-from-month'] || '',
      year: req.body['date-of-offence-from-year'] || ''
    }

    draftCount.offenceDateTo = {
      day: req.body['date-of-offence-to-day'] || '',
      month: req.body['date-of-offence-to-month'] || '',
      year: req.body['date-of-offence-to-year'] || ''
    }

    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    // Once a charge has been selected and saved, mark indictment as in progress
    _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

    return res.redirect(`/cases/${caseId}/indictment/counts/precedent-charges-and-offence`)
  })


  // ============================================================
  // /cases/:caseId/indictment/counts/precedent-charges-and-offence (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/precedent-charges-and-offence', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})

    return res.render('cases/indictment/counts/precedent-charges-and-offence', {
      _case,
      countsCase,
      chargeOptions,
      draftCount
    })
  })
}