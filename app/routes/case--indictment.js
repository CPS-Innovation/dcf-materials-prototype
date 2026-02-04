/// case--indictments.js
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
  // SEARCH HELPERS: precedent charges / statute / offence
  // ============================================================
  // These helpers support the "Search by IPP code, statute name or offence" field
  // on /counts/precedent-charges-and-offence.
  //
  // Design intent:
  // - Search is "read-only" (does not mutate session) and returns results to render under the form.
  // - Results are server-rendered (Nunjucks `{% for %}`) for accessibility and simplicity.
  // - The "Continue" action is separate (POST) and stores the selected result in session.
  // ============================================================

  // Small normaliser so matching is consistent and forgiving
  function normaliseQuery(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  // Convert a charge option into a single searchable string
  function buildSearchHaystack(option) {
    return normaliseQuery([
      option.chargeCode,
      option.label,
      option.statementOfOffence,
      option.statute
    ].filter(Boolean).join(' '))
  }

  // Search within the current case’s charge options + associated library enrichment
  // NOTE: this intentionally does not hit Prisma — it searches the narrative JSON-backed options you already build.
  // Search within the current case’s charge options + associated library enrichment
  // NOTE: this intentionally does not hit Prisma — it searches the narrative JSON-backed options you already build.
  function searchPrecedentsWithinCase(chargeOptions, keywords) {
    const q = normaliseQuery(keywords)
    if (!q) return []

    const results = []

    for (const option of (chargeOptions || [])) {
      const haystack = buildSearchHaystack(option)

      if (haystack.includes(q)) {
        // ------------------------------------------------------------
        // Extract a human-readable statute name
        // ------------------------------------------------------------
        // `option.statute` sometimes arrives as an object (e.g. { name: 'Theft Act 1968', section: '8(1)' }).
        // If we concatenate an object into a string we end up with "[object Object]" in the UI.
        //
        // This normalises statute into a displayable string.
        const statuteName =
          typeof option.statute === 'string'
            ? option.statute
            : (option.statute && (option.statute.name || option.statute.title || option.statute.act)) || ''

        // ------------------------------------------------------------
        // Return structured fields for the "radio + summary list" UI
        // ------------------------------------------------------------
        // The template needs separate values for:
        // - IPP code
        // - Statute name
        // - Offence text
        //
        // These are used to render each result as a summary list row-set.
        results.push({
          // Stable ID we’ll store/submit on "Continue"
          id: option.policeChargeId,

          // Summary list row: IPP code
          ippCode: option.chargeCode || '',

          // Summary list row: Statute name (string)
          statuteName,

          // Summary list row: Offence (prefer label, fallback to statement)
          offence: option.label || option.statementOfOffence || ''
        })
      }
    }

    return results
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

    // ----------------------------
    // SEARCH INPUT (GET)
    // ----------------------------
    // The search form uses method="get" and submits `precedentSearchKeywords`.
    // We do NOT store the keywords in session by default — we simply reflect them back to the template.
    // If you want the value to persist across navigation, you can choose to store it in session.
    const precedentSearchKeywords = (req.query.precedentSearchKeywords || '').toString()

    // Server-rendered results for the `{% for %}` loop beneath the form
    const precedentResults = searchPrecedentsWithinCase(chargeOptions, precedentSearchKeywords)

    return res.render('cases/indictment/counts/precedent-charges-and-offence', {
      _case,
      countsCase,
      chargeOptions,
      draftCount,

      // Pass these into Nunjucks so the form can retain input + show results
      precedentSearchKeywords,
      precedentResults
    })
  })

  router.post('/cases/:caseId/indictment/counts/precedent-charges-and-offence/continue', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    // ----------------------------
    // SELECTION (POST)
    // ----------------------------
    // The results list should use radios with name="selectedPrecedentId".
    // When the user clicks Continue, we store the selected ID against the current draft count.
    const selectedPrecedentId = (req.body.selectedPrecedentId || '').toString()

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    draftCount.selectedPrecedentId = selectedPrecedentId || null
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    // TODO: redirect to your next screen in the journey
    return res.redirect(`/cases/${caseId}/indictment/counts/next-step`)
  })
}