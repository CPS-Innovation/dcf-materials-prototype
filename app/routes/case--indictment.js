// app/routes/case--indictments.js
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

  // Only allow internal safe return paths
  const safeReturnTo = (value) => {
    const v = String(value || '')
    if (!v) return ''
    if (!v.startsWith('/')) return ''
    // extra safety: keep it within this app's case routes
    if (!v.startsWith('/cases/')) return ''
    return v.startsWith('/') ? v : ''
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

  // Always return a narrative case, even if caseId isn't 1–5
  function getCountsCaseFor(caseId) {
    const direct = countsByCaseId[String(caseId)]
    if (direct) return direct
    const idx = Math.abs(Number(caseId)) % countsData.length
    return countsData[idx]
  }

  // Build charge options from Prisma (deduped by chargeCode + description)
  function buildChargeOptionsFromPrismaCase(_case) {
    const seen = new Set()
    const options = []

    for (const d of (_case.defendants || [])) {
      for (const ch of (d.charges || [])) {
        const key = `${ch.chargeCode}||${ch.description}`
        if (seen.has(key)) continue
        seen.add(key)

        options.push({
          chargeCode: ch.chargeCode,
          description: ch.description
        })
      }
    }

    options.sort((a, b) => (a.chargeCode || '').localeCompare(b.chargeCode || ''))
    return options
  }

  // Build charge options from narrative JSON (NO dedupe)
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
  // SEARCH HELPERS (precedent)
  // ============================================================

  function normaliseQuery(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  function buildSearchHaystack(option) {
    return normaliseQuery([
      option.chargeCode,
      option.label,
      option.statementOfOffence,
      // statute might be object
      (typeof option.statute === 'string'
        ? option.statute
        : (option.statute && (option.statute.name || option.statute.title || option.statute.act)) || ''
      )
    ].filter(Boolean).join(' '))
  }

  function searchPrecedentsWithinCase(chargeOptions, keywords) {
    const q = normaliseQuery(keywords)
    if (!q) return []

    const results = []

    for (const option of (chargeOptions || [])) {
      const haystack = buildSearchHaystack(option)
      if (!haystack.includes(q)) continue

      const statuteName =
        typeof option.statute === 'string'
          ? option.statute
          : (option.statute && (option.statute.name || option.statute.title || option.statute.act)) || ''

      results.push({
        id: option.policeChargeId,
        ippCode: option.chargeCode || '',
        statuteName,
        offence: option.label || option.statementOfOffence || ''
      })
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
  // /cases/:caseId/indictment/counts/charges (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)
    const caseChargeOptions = buildChargeOptionsFromPrismaCase(_case)

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})

    return res.render('cases/indictment/counts/charges', {
      _case,
      countsCase,
      caseChargeOptions,
      draftCount
    })
  })

  router.post('/cases/:caseId/indictment/counts/charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    // No default selection in the UI, so allow null here
    const countBasis = (req.body.countBasis || '').toString() || null
    draftCount.countBasis = countBasis

    const caseChargeOptions = buildChargeOptionsFromPrismaCase(_case)

    // Normalise checkbox values into an array of strings
    const rawSelected = req.body.selectedChargeCodes
    const selectedChargeCodes = Array.isArray(rawSelected)
      ? rawSelected
      : (rawSelected ? [rawSelected] : [])

    if (countBasis === 'newCount') {
      draftCount.selectedChargeCodes = []
      draftCount.primaryChargeCode = null
      draftCount.chargeCode = null
      draftCount.chargeLabel = null
    } else {
      draftCount.selectedChargeCodes = selectedChargeCodes
      draftCount.primaryChargeCode = selectedChargeCodes[0] || null

      const primary = caseChargeOptions.find(o => String(o.chargeCode) === String(draftCount.primaryChargeCode)) || null
      if (primary) {
        draftCount.chargeCode = primary.chargeCode
        draftCount.chargeLabel = primary.description
      } else {
        draftCount.chargeCode = null
        draftCount.chargeLabel = null
      }
    }

    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

    // Flow control: if fewer than 2 defendants, skip ordering step
    const defendantCount = Array.isArray(_case.defendants) ? _case.defendants.length : 0
    if (defendantCount < 2) {
      return res.redirect(`/cases/${caseId}/indictment/counts/precedent-charges-or-offence`)
    }

    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-defendants`)
  })

  // ============================================================
  // /cases/:caseId/indictment/counts/select-and-order-defendants (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/select-and-order-defendants', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const countPath = `${draftBasePath}.currentCount`

    const draftCount = _.get(req, countPath, {})

    // One-time success banner (flash behaviour)
    const successKey = `${draftBasePath}.reorderSuccess`
    const showReorderSuccess = _.get(req, successKey, false)
    _.unset(req, successKey)

    // Case-level default “story order” (used when this count has no override yet)
    const defaultDefendantOrderIds = _.get(req, `${draftBasePath}.defaultDefendantOrderIds`, [])

    // True if the user has started ordering within THIS count (count-level override wins)
    const hasCountOverride =
      (draftCount?.orderedSelectedDefendantIds?.length > 0) ||
      (draftCount?.defendantOrder && Object.keys(draftCount.defendantOrder).length > 0)

    // Apply case-level default order to the display list (append any “not in default” to the end)
    function applyCaseDefaultOrder(defendants = [], defaultIds = []) {
      if (!defaultIds.length) return defendants
      const byId = new Map(defendants.map(d => [d.id, d]))

      const ordered = defaultIds.map(id => byId.get(id)).filter(Boolean)
      const remaining = defendants.filter(d => !defaultIds.includes(d.id))

      return [...ordered, ...remaining]
    }

    // Reorder for display using the current count’s "Move to position" inputs (stable)
    function reorderDefendants(defendants = [], defendantOrder = {}) {
      const indexed = defendants.map((d, index) => ({ d, index }))

      const moves = indexed
        .map(({ d, index }) => {
          const raw = defendantOrder[d.id]
          const pos = Number.parseInt(String(raw || ''), 10)
          if (!Number.isFinite(pos) || pos <= 0) return null
          return { id: d.id, pos, index }
        })
        .filter(Boolean)
        .sort((a, b) => a.pos - b.pos || a.index - b.index)

      const result = indexed.map(x => x.d)

      for (const move of moves) {
        const fromIndex = result.findIndex(d => d.id === move.id)
        if (fromIndex === -1) continue

        const [defendant] = result.splice(fromIndex, 1)
        const toIndex = Math.max(0, Math.min(result.length, move.pos - 1))
        result.splice(toIndex, 0, defendant)
      }

      return result
    }

    // Base ordering:
    // - If count has overrides: start from current case order (then apply reorder inputs)
    // - Else: start from case-level default story order
    const baseDefendants = hasCountOverride
      ? _case.defendants
      : applyCaseDefaultOrder(_case.defendants, defaultDefendantOrderIds)

    const orderedDefendantsForDisplay = reorderDefendants(
      baseDefendants,
      draftCount.defendantOrder || {}
    )

    return res.render('cases/indictment/counts/select-and-order-defendants', {
      _case: {
        ..._case,
        defendants: orderedDefendantsForDisplay
      },
      countsCase,
      chargeOptions,
      draftCount,
      showReorderSuccess
    })
  })




  router.post('/cases/:caseId/indictment/counts/select-and-order-defendants', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const action = (req.body.action || '').toString()

    const draftBasePath = `session.data.indictmentDrafts.${caseId}`
    const countPath = `${draftBasePath}.currentCount`

    const draftCount = _.get(req, countPath, {})

    // Normalise checkbox selection into an array of IDs
    const rawSelected = req.body.selectedDefendantIds
    const selectedDefendantIds = Array.isArray(rawSelected)
      ? rawSelected
      : (rawSelected ? [rawSelected] : [])

    // Map of { [defendantId]: "position" }
    const rawOrder = req.body.defendantOrder || {}

    // Always persist what they entered
    draftCount.selectedDefendantIds = selectedDefendantIds
    draftCount.defendantOrder = rawOrder
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, countPath, draftCount)

    // Helper: compute canonical ordered selected IDs for this count (stable)
    async function buildOrderedIds(selectedIds = [], orderMap = {}, defendants = []) {
      const base = (defendants || [])
        .map(d => d.id)
        .filter(id => selectedIds.includes(id))

      const moves = base
        .map((id, idx) => {
          const pos = Number.parseInt(String(orderMap?.[id] || ''), 10)
          return Number.isFinite(pos) && pos > 0 ? { id, pos, idx } : null
        })
        .filter(Boolean)
        .sort((a, b) => a.pos - b.pos || a.idx - b.idx)

      const result = [...base]

      for (const m of moves) {
        const from = result.indexOf(m.id)
        if (from === -1) continue

        const [item] = result.splice(from, 1)
        const to = Math.max(0, Math.min(result.length, m.pos - 1))
        result.splice(to, 0, item)
      }

      return result
    }

    // Reorder-only: flash success + return to same page (PRG)
    if (action === 'reorder') {
      _.set(req, `${draftBasePath}.reorderSuccess`, true)
      return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-defendants`)
    }

    // Skip: do not compute canonical ordering; just continue
    if (action === 'skip') {
      return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-witnesses`)
    }

    // Save and continue:
    // - compute canonical ordered selection for this count
    // - update case-level default story order from this count (for future counts)
    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const orderedSelectedDefendantIds = await buildOrderedIds(
      selectedDefendantIds,
      rawOrder,
      _case.defendants
    )

    draftCount.orderedSelectedDefendantIds = orderedSelectedDefendantIds
    _.set(req, countPath, draftCount)

    // Case-level default: reuse this ordering for new counts (story order)
    _.set(req, `${draftBasePath}.defaultDefendantOrderIds`, orderedSelectedDefendantIds)

    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-witnesses`)
  })



  // ============================================================
  // /cases/:caseId/indictment/counts/select-and-order-witnesses (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/select-and-order-witnesses', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)
    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})

    return res.render('cases/indictment/counts/select-and-order-witnesses', {
      _case,
      countsCase,
      chargeOptions,
      draftCount
    })
  })

  router.post('/cases/:caseId/indictment/counts/select-and-order-witnesses', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    const rawSelected = req.body.selectedWitnessIds
    const selectedWitnessIds = Array.isArray(rawSelected)
      ? rawSelected
      : (rawSelected ? [rawSelected] : [])

    const rawOrder = req.body.witnessOrder || {}

    draftCount.selectedWitnessIds = selectedWitnessIds
    draftCount.witnessOrder = rawOrder
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-victims`)
  })

  // ============================================================
  // /cases/:caseId/indictment/counts/select-and-order-victims (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/select-and-order-victims', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)
    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})

    return res.render('cases/indictment/counts/select-and-order-victims', {
      _case,
      countsCase,
      draftCount
    })
  })

  router.post('/cases/:caseId/indictment/counts/select-and-order-victims', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    const rawSelected = req.body.selectedVictimIds
    const selectedVictimIds = Array.isArray(rawSelected)
      ? rawSelected
      : (rawSelected ? [rawSelected] : [])

    const rawOrder = req.body.victimOrder || {}

    draftCount.selectedVictimIds = selectedVictimIds
    draftCount.victimOrder = rawOrder
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    return res.redirect(`/cases/${caseId}/indictment/counts/date-and-charges`)
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
    const caseChargeOptions = buildChargeOptionsFromPrismaCase(_case)

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})

    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/counts/date-and-charges', {
      _case,
      countsCase,
      caseChargeOptions,
      draftCount,
      returnTo
    })
  })

  router.post('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const caseChargeOptions = buildChargeOptionsFromPrismaCase(_case)

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    // Charges: basis + selected codes
    const countBasis = (req.body.countBasis || '').toString()
    draftCount.countBasis = countBasis || null

    const rawSelected = req.body.selectedChargeCodes
    const selectedChargeCodes = Array.isArray(rawSelected)
      ? rawSelected
      : (rawSelected ? [rawSelected] : [])

    if (draftCount.countBasis === 'existingCharge') {
      draftCount.selectedChargeCodes = selectedChargeCodes

      const primaryChargeCode = selectedChargeCodes[0] || null
      draftCount.chargeCode = primaryChargeCode

      const selected = caseChargeOptions.find(o => String(o.chargeCode) === String(primaryChargeCode)) || null
      draftCount.chargeLabel = selected ? selected.description : null
    } else if (draftCount.countBasis === 'newCount') {
      draftCount.selectedChargeCodes = []
      draftCount.chargeCode = null
      draftCount.chargeLabel = null
    } else {
      draftCount.selectedChargeCodes = selectedChargeCodes
    }

    // Date: single vs range
    const dateType = (req.body.dateType || '').toString()
    draftCount.dateType = dateType || null

    if (draftCount.dateType === 'single') {
      draftCount.offenceDate = {
        day: req.body['offence-date-day'] || '',
        month: req.body['offence-date-month'] || '',
        year: req.body['offence-date-year'] || ''
      }
      draftCount.offenceDateFrom = null
      draftCount.offenceDateTo = null
    } else if (draftCount.dateType === 'range') {
      draftCount.offenceDateFrom = {
        day: req.body['offence-date-from-day'] || '',
        month: req.body['offence-date-from-month'] || '',
        year: req.body['offence-date-from-year'] || ''
      }
      draftCount.offenceDateTo = {
        day: req.body['offence-date-to-day'] || '',
        month: req.body['offence-date-to-month'] || '',
        year: req.body['offence-date-to-year'] || ''
      }
      draftCount.offenceDate = null
    }

    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)
    _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

    // returnTo support (prefer body hidden field)
    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/assign/defendants`)
  })

  // ============================================================
  // /cases/:caseId/indictment/assign/defendants (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/assign/defendants', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})
    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/assign/defendants', {
      _case,
      draftCount,
      returnTo
    })
  })

  router.post('/cases/:caseId/indictment/assign/defendants', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    const rawSelected = req.body.assignedDefendantIds
    const assignedDefendantIds = Array.isArray(rawSelected)
      ? rawSelected
      : (rawSelected ? [rawSelected] : [])

    // ✅ Normalise to strings so template membership checks work reliably
    draftCount.assignedDefendantIds = assignedDefendantIds.map(String)

    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    // ✅ Prefer body.returnTo (hidden input), fall back to query
    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/assign/victims`)
  })


  // ============================================================
  // /cases/:caseId/indictment/assign/victims (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/assign/victims', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})
    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/assign/victims', {
      _case,
      draftCount,
      returnTo
    })
  })

  router.post('/cases/:caseId/indictment/assign/victims', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    const rawSelected = req.body.assignedVictimIds
    const assignedVictimIds = Array.isArray(rawSelected)
      ? rawSelected
      : (rawSelected ? [rawSelected] : [])

    // ✅ Normalise to strings so `v.id in assignedVictimIds` works reliably
    draftCount.assignedVictimIds = assignedVictimIds.map(String)

    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/assign/witnesses`)
  })


  // ============================================================
  // /cases/:caseId/indictment/assign/witnesses (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/assign/witnesses', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})
    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/assign/witnesses', {
      _case,
      draftCount,
      returnTo
    })
  })

  router.post('/cases/:caseId/indictment/assign/witnesses', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    const rawSelected = req.body.assignedWitnessIds
    const assignedWitnessIds = Array.isArray(rawSelected)
      ? rawSelected
      : (rawSelected ? [rawSelected] : [])

    // ✅ Normalise to strings
    draftCount.assignedWitnessIds = assignedWitnessIds.map(String)

    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/counts/offence-and-particulars`)
  })


  // ============================================================
  // /cases/:caseId/indictment/counts/precedent-charges-or-offence (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/precedent-charges-or-offence', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    const precedentSearchKeywords = (req.query.precedentSearchKeywords || '').toString()
    const precedentResults = searchPrecedentsWithinCase(chargeOptions, precedentSearchKeywords)

    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/counts/precedent-charges-or-offence', {
      _case,
      countsCase,
      draftCount,
      precedentSearchKeywords,
      precedentResults,
      returnTo // ✅ makes both GET + POST keep it
    })
  })



router.post('/cases/:caseId/indictment/counts/precedent-charges-or-offence/continue', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const countsCase = getCountsCaseFor(caseId)
  const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)

  const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
  const draftCount = _.get(req, basePath, {})

  const selectedPrecedentId = (req.body.selectedPrecedentId || '').toString()
  draftCount.selectedPrecedentId = selectedPrecedentId || null

  // ✅ Resolve details from chargeOptions (not from search)
  if (selectedPrecedentId) {
    const picked = chargeOptions.find(o => String(o.policeChargeId) === String(selectedPrecedentId)) || null

    const statuteName =
      typeof picked?.statute === 'string'
        ? picked.statute
        : (picked?.statute && (picked.statute.name || picked.statute.title || picked.statute.act)) || ''

    draftCount.precedentSelection = picked ? {
      id: String(picked.policeChargeId),
      ippCode: picked.chargeCode || '',
      statuteName: statuteName || '',
      offence: picked.label || picked.statementOfOffence || ''
    } : null
  } else {
    draftCount.precedentSelection = null
  }

  draftCount.lastUpdatedAt = new Date().toISOString()
  _.set(req, basePath, draftCount)

  const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
  if (returnTo) return res.redirect(returnTo)

  return res.redirect(`/cases/${caseId}/indictment/counts/offence-and-particulars`)
})


  // ============================================================
  // /cases/:caseId/indictment/counts/offence-and-particulars (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/offence-and-particulars', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    // Flatten all charges on case (for details list)
    const allCaseCharges = (_case.defendants || []).flatMap(d =>
      (d.charges || []).map(ch => ({
        defendantId: d.id,
        defendantName: `${d.firstName || ''} ${d.lastName || ''}`.trim(),
        chargeCode: ch.chargeCode,
        description: ch.description,
        particulars: ch.particulars
      }))
    )

    const selectedCodes = Array.isArray(draftCount.selectedChargeCodes) && draftCount.selectedChargeCodes.length
      ? draftCount.selectedChargeCodes.map(String)
      : (draftCount.chargeCode ? [String(draftCount.chargeCode)] : [])

    const selectedCharges = allCaseCharges.filter(ch => selectedCodes.includes(String(ch.chargeCode)))
    const primarySelectedCharge = selectedCharges[0] || null

    const assignedDefendantIds = Array.isArray(draftCount.assignedDefendantIds)
      ? draftCount.assignedDefendantIds.map(String)
      : []

    const assignedDefendants = (_case.defendants || [])
      .filter(d => assignedDefendantIds.includes(String(d.id)))
      .map(d => `${d.firstName || ''} ${d.lastName || ''}`.trim())
      .filter(Boolean)

    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/counts/offence-and-particulars', {
      _case,
      draftCount,

      assignedDefendants,
      primarySelectedCharge,
      allCaseCharges,

      precedentSelection: draftCount.precedentSelection || null,
      returnTo
    })
  })

  router.post('/cases/:caseId/indictment/counts/offence-and-particulars', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    draftCount.statementOfOffenceText = (req.body.statementOfOffenceText || '').toString()
    draftCount.particularsOfOffenceText = (req.body.particularsOfOffenceText || '').toString()

    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    const action = (req.body.action || 'continue').toString()

    if (action === 'saveForLater') {
      _.set(req, 'session.data.successBanner', {
        titleText: 'Draft saved',
        text: 'You can come back and continue drafting this count later.'
      })
      return res.redirect(`/cases/${caseId}/indictment`)
    }

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)
    if (returnTo) return res.redirect(returnTo)

    return res.redirect(`/cases/${caseId}/indictment/counts/check`)
  })

  // ============================================================
  // /cases/:caseId/indictment/counts/check (GET + POST)
  // ============================================================

  router.get('/cases/:caseId/indictment/counts/check', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const draftCount = _.get(req, `session.data.indictmentDrafts.${caseId}.currentCount`, {})

    // Needed so check.html can resolve precedent selection against narrative charge options
    const countsCase = getCountsCaseFor(caseId)
    const chargeOptions = buildChargeOptionsFromCountsCase(countsCase)

    return res.render('cases/indictment/counts/check', {
      _case,
      draftCount,
      countsCase,
      chargeOptions
    })
  })

  router.post('/cases/:caseId/indictment/counts/check', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
    const draftCount = _.get(req, basePath, {})

    draftCount.confirmedAt = new Date().toISOString()
    draftCount.lastUpdatedAt = new Date().toISOString()
    _.set(req, basePath, draftCount)

    _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const indictment = _.get(req, indictmentBasePath, { status: 'In progress', counts: [] })

    const hasAnyContent =
      (draftCount.chargeCode || (draftCount.selectedChargeCodes && draftCount.selectedChargeCodes.length)) ||
      draftCount.statementOfOffenceText ||
      draftCount.particularsOfOffenceText ||
      draftCount.selectedPrecedentId

    if (hasAnyContent) {
      indictment.counts = indictment.counts || []
      indictment.counts.push({
        id: `count-${Date.now()}`,
        createdAt: new Date().toISOString(),

        countBasis: draftCount.countBasis || null,
        selectedChargeCodes: draftCount.selectedChargeCodes || [],
        chargeCode: draftCount.chargeCode || null,
        chargeLabel: draftCount.chargeLabel || null,

        dateType: draftCount.dateType || null,
        offenceDate: draftCount.offenceDate || null,
        offenceDateFrom: draftCount.offenceDateFrom || null,
        offenceDateTo: draftCount.offenceDateTo || null,

        assignedDefendantIds: draftCount.assignedDefendantIds || [],
        assignedVictimIds: draftCount.assignedVictimIds || [],
        assignedWitnessIds: draftCount.assignedWitnessIds || [],

        statementOfOffenceText: draftCount.statementOfOffenceText || null,
        particularsOfOffenceText: draftCount.particularsOfOffenceText || null,

        selectedPrecedentId: draftCount.selectedPrecedentId || null,
        precedentSelection: draftCount.precedentSelection || null
      })
    }

    indictment.lastSavedAt = new Date().toISOString()
    _.set(req, indictmentBasePath, indictment)

    // Clear the current draft count
    _.unset(req, basePath)

    _.set(req, 'session.data.successBanner', {
      titleText: 'Count saved',
      text: 'Your draft count has been added to the indictment.'
    })

    return res.redirect(`/cases/${caseId}/indictment`)
  })
}
