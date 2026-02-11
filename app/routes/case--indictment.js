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

  // Accept both:
  //  - req.body.defendantOrder = { "123": "2" }   (extended: true)
  //  - req.body["defendantOrder[123]"] = "2"     (extended: false)
 function extractBracketMap(body = {}, prefix = '') {
  const map = {}

  // Case 1: already parsed as object (but NOT an array)
  if (body && typeof body[prefix] === 'object' && body[prefix] !== null && !Array.isArray(body[prefix])) {
    for (const [k, v] of Object.entries(body[prefix])) {
      const key = String(k).replace(/^id-/, '')
      map[key] = String(v ?? '')
    }
  }

  // Case 2: bracket keys at top level
  const re = new RegExp(`^${prefix}\\[(.+)\\]$`)
  for (const [k, v] of Object.entries(body || {})) {
    const m = String(k).match(re)
    if (!m) continue
    const key = String(m[1]).replace(/^id-/, '')
    map[key] = String(v ?? '')
  }

  return map
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

// Build a searchable text blob for one option
function buildSearchHaystack(option) {
  const statuteText =
    option.statute
      ? [
          option.statute.act,
          option.statute.section
        ].filter(Boolean).join(' ')
      : ''

  const keywordsText =
    Array.isArray(option.keywords)
      ? option.keywords.join(' ')
      : ''

  return normaliseQuery([
    option.chargeCode,
    option.label,
    option.statementOfOffence,
    statuteText,
    keywordsText
  ].filter(Boolean).join(' '))
}

function searchPrecedentsWithinCase(chargeOptions, keywords) {
  const q = normaliseQuery(keywords)
  if (!q) return []

  const results = []

  for (const option of (chargeOptions || [])) {
    const haystack = buildSearchHaystack(option)

    // Allow prefix matches: "threat" should match "threats", "threatening"
    const words = haystack.split(' ')
    const matches =
      haystack.includes(q) ||
      words.some(w => w.startsWith(q))

    if (!matches) continue

    const statuteName =
      typeof option.statute === 'string'
        ? option.statute
        : (option.statute && (option.statute.act || option.statute.name || option.statute.title)) || ''

    results.push({
      id: option.policeChargeId,
      ippCode: option.chargeCode || '',
      statuteName,
      offence: option.label || option.statementOfOffence || ''
    })
  }

  return results
}

function searchChargeLibrary(chargeLibrary, keywords) {
  const q = normaliseQuery(keywords)
  if (!q) return []

  const results = []

  for (const entry of chargeLibrary) {
    const haystack = buildSearchHaystack(entry)

    const words = haystack.split(' ')
    const matches =
      haystack.includes(q) ||
      words.some(w => w.startsWith(q))

    if (!matches) continue

    results.push({
      id: entry.chargeCode,          // stable ID
      ippCode: entry.chargeCode || '',
      statuteName: entry?.statute?.act || '',
      offence: entry.label || entry.statementOfOffence || ''
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
      return res.redirect(`/cases/${caseId}/indictment/counts/date-and-charges`)
    }

    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-defendants`)
  })

// ============================================================
// /cases/:caseId/indictment/counts/select-and-order-defendants (GET + POST)
// Matches working Witnesses pattern
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

  // Case-level default “story order”
  const defaultDefendantOrderIds = (_.get(req, `${draftBasePath}.defaultDefendantOrderIds`, []) || []).map(String)

  // Count-level override wins
  const hasCountOverride =
    (draftCount?.orderedSelectedDefendantIds?.length > 0) ||
    (draftCount?.defendantOrder && Object.keys(draftCount.defendantOrder).length > 0)

  function applyCaseDefaultOrder(entities = [], defaultIds = []) {
    if (!defaultIds.length) return entities
    const byId = new Map(entities.map(e => [String(e.id), e]))

    const ordered = defaultIds.map(id => byId.get(String(id))).filter(Boolean)
    const remaining = entities.filter(e => !defaultIds.includes(String(e.id)))

    return [...ordered, ...remaining]
  }

  function orderByIdsFirst(entities = [], idsFirst = []) {
    if (!idsFirst.length) return entities
    const byId = new Map(entities.map(e => [String(e.id), e]))

    const first = idsFirst.map(id => byId.get(String(id))).filter(Boolean)
    const firstSet = new Set(idsFirst.map(String))
    const remaining = entities.filter(e => !firstSet.has(String(e.id)))

    return [...first, ...remaining]
  }

  function reorderEntities(entities = [], orderMap = {}) {
    const indexed = entities.map((e, index) => ({ e, index }))

    const moves = indexed
      .map(({ e, index }) => {
        const raw = orderMap[String(e.id)]
        const pos = Number.parseInt(String(raw || ''), 10)
        if (!Number.isFinite(pos) || pos <= 0) return null
        return { id: String(e.id), pos, index }
      })
      .filter(Boolean)
      .sort((a, b) => a.pos - b.pos || a.index - b.index)

    const result = indexed.map(x => x.e)

    for (const move of moves) {
      const fromIndex = result.findIndex(e => String(e.id) === move.id)
      if (fromIndex === -1) continue

      const [item] = result.splice(fromIndex, 1)
      const toIndex = Math.max(0, Math.min(result.length, move.pos - 1))
      result.splice(toIndex, 0, item)
    }

    return result
  }

  const defendants = _case.defendants || []

  const baseDefendants = hasCountOverride
    ? defendants
    : applyCaseDefaultOrder(defendants, defaultDefendantOrderIds)

  const baseWithCanonicalFirst = orderByIdsFirst(
    baseDefendants,
    (draftCount.orderedSelectedDefendantIds || []).map(String)
  )

  const orderedDefendantsForDisplay = reorderEntities(
    baseWithCanonicalFirst,
    draftCount.defendantOrder || {}
  )

  const selectedDefendantIds = (draftCount.selectedDefendantIds || []).map(String)

  const showLeftOffInset =
    (orderedDefendantsForDisplay.length > 0) &&
    (Boolean(draftCount.lastUpdatedAt) || selectedDefendantIds.length > 0)

  const leftOffPreview = orderedDefendantsForDisplay
    .filter(d => !selectedDefendantIds.includes(String(d.id)))
    .map(d => {
      const fullName = `${(d.firstName || '').trim()} ${(d.lastName || '').trim()}`.trim()
      return fullName || `Defendant ${d.id}`
    })

    console.log('DEF GET defendantOrder:', draftCount.defendantOrder)
    console.log('DEF GET ordered ids:', draftCount.orderedSelectedDefendantIds)
    console.log('DEF GET final display ids:', orderedDefendantsForDisplay.map(d => String(d.id)))


  return res.render('cases/indictment/counts/select-and-order-defendants', {
    _case: { ..._case, defendants: orderedDefendantsForDisplay },
    countsCase,
    chargeOptions,
    draftCount,
    showReorderSuccess,
    showLeftOffInset,
    leftOffPreview
  })
})

router.post('/cases/:caseId/indictment/counts/select-and-order-defendants', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const action = (req.body.action || '').toString()

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})

  // Selected defendant IDs (checkboxes) — normalise and remove Prototype Kit sentinel
  const rawSelected = req.body.selectedDefendantIds
  const selectedDefendantIds = (Array.isArray(rawSelected) ? rawSelected : (rawSelected ? [rawSelected] : []))
    .map(String)
    .filter(v => v && v !== '_unchecked')

  // Robust extraction (works with extended:true OR extended:false)
  const rawOrder = extractBracketMap(req.body, 'defendantOrder')


  // ✅ If keys look like 0..n indices (like your logs), remap to real IDs in current display order
  // This makes the feature work even if the template names are wrong.
  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const defendants = _case.defendants || []
  const defendantIds = defendants.map(d => String(d.id))

  const rawOrderKeys = Object.keys(rawOrder).map(String)
  const noneMatchRealIds = rawOrderKeys.length > 0 && rawOrderKeys.every(k => !defendantIds.includes(k))
  const allLookLikeIndices = rawOrderKeys.length > 0 && rawOrderKeys.every(k => /^\d+$/.test(k))

  if (noneMatchRealIds && allLookLikeIndices) {
    const remapped = {}
    for (const [k, v] of Object.entries(rawOrder)) {
      const idx = Number.parseInt(String(k), 10)
      if (!Number.isFinite(idx)) continue
      const id = defendantIds[idx]
      if (!id) continue
      remapped[id] = String(v ?? '')
    }
    rawOrder = remapped
  }

  // Always persist what they entered
  draftCount.selectedDefendantIds = selectedDefendantIds
  draftCount.defendantOrder = rawOrder
  draftCount.lastUpdatedAt = new Date().toISOString()

  function buildOrderedIds(selectedIds = [], orderMap = {}, entities = []) {
    const base = (entities || [])
      .map(e => String(e.id))
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

  // Reorder-only (PRG)
  if (action === 'reorder') {
    const movedIds = Object.entries(rawOrder)
      .filter(([_, v]) => {
        const pos = Number.parseInt(String(v || ''), 10)
        return Number.isFinite(pos) && pos > 0
      })
      .map(([id]) => String(id))

    // auto-check moved
    draftCount.selectedDefendantIds = Array.from(new Set([
      ...(draftCount.selectedDefendantIds || []).map(String).filter(v => v && v !== '_unchecked'),
      ...movedIds
    ]))

    // update canonical order so GET can use it as a stable base
    draftCount.orderedSelectedDefendantIds = buildOrderedIds(
      draftCount.selectedDefendantIds,
      rawOrder,
      defendants
    )

    _.set(req, countPath, draftCount)
    _.set(req, `${draftBasePath}.reorderSuccess`, true)

    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-defendants`)
  }

  // persist for other actions too
  _.set(req, countPath, draftCount)

  if (action === 'skip') {
    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-witnesses`)
  }

  // Save and continue
  draftCount.orderedSelectedDefendantIds = buildOrderedIds(
    draftCount.selectedDefendantIds || [],
    rawOrder,
    defendants
  )
  _.set(req, countPath, draftCount)

  _.set(req, `${draftBasePath}.defaultDefendantOrderIds`, draftCount.orderedSelectedDefendantIds)

  return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-witnesses`)
})




/// ============================================================
// /cases/:caseId/indictment/counts/select-and-order-witnesses (GET + POST)
// Matches Defendants behaviour (robust bracket parsing + DOM reordering)
// ============================================================

router.get('/cases/:caseId/indictment/counts/select-and-order-witnesses', async (req, res) => {
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
  const successKey = `${draftBasePath}.reorderWitnessSuccess`
  const showWitnessReorderSuccess = _.get(req, successKey, false)
  _.unset(req, successKey)

  // Case-level default “story order” for witnesses
  const defaultWitnessOrderIds =
    (_.get(req, `${draftBasePath}.defaultWitnessOrderIds`, []) || []).map(String)

  // True if the user has started ordering within THIS count (count-level override wins)
  const hasCountOverride =
    (draftCount?.orderedSelectedWitnessIds?.length > 0) ||
    (draftCount?.witnessOrder && Object.keys(draftCount.witnessOrder).length > 0)

  function applyCaseDefaultOrder(entities = [], defaultIds = []) {
    if (!defaultIds.length) return entities
    const byId = new Map(entities.map(e => [String(e.id), e]))

    const ordered = defaultIds.map(id => byId.get(String(id))).filter(Boolean)
    const remaining = entities.filter(e => !defaultIds.includes(String(e.id)))

    return [...ordered, ...remaining]
  }

  // Pull these ids to the front (in that exact order), then append remaining
  function orderByIdsFirst(entities = [], idsFirst = []) {
    if (!idsFirst.length) return entities
    const byId = new Map(entities.map(e => [String(e.id), e]))

    const first = idsFirst.map(id => byId.get(String(id))).filter(Boolean)
    const firstSet = new Set(idsFirst.map(String))
    const remaining = entities.filter(e => !firstSet.has(String(e.id)))

    return [...first, ...remaining]
  }

  // Reorder for display using the current count’s "Move to position" inputs (stable)
  function reorderEntities(entities = [], orderMap = {}) {
    const indexed = entities.map((e, index) => ({ e, index }))

    const moves = indexed
      .map(({ e, index }) => {
        const raw = orderMap[String(e.id)]
        const pos = Number.parseInt(String(raw || ''), 10)
        if (!Number.isFinite(pos) || pos <= 0) return null
        return { id: String(e.id), pos, index }
      })
      .filter(Boolean)
      .sort((a, b) => a.pos - b.pos || a.index - b.index)

    const result = indexed.map(x => x.e)

    for (const move of moves) {
      const fromIndex = result.findIndex(e => String(e.id) === move.id)
      if (fromIndex === -1) continue

      const [item] = result.splice(fromIndex, 1)
      const toIndex = Math.max(0, Math.min(result.length, move.pos - 1))
      result.splice(toIndex, 0, item)
    }

    return result
  }

  const witnesses = _case.witnesses || []

  // Base ordering:
  // - If count has overrides: start from current case order
  // - Else: start from case-level default story order
  const baseWitnesses = hasCountOverride
    ? witnesses
    : applyCaseDefaultOrder(witnesses, defaultWitnessOrderIds)

  // Anchor the display list on the canonical story order (if present),
  // then apply position moves on top.
  const baseWithCanonicalFirst = orderByIdsFirst(
    baseWitnesses,
    (draftCount.orderedSelectedWitnessIds || []).map(String)
  )

  const orderedWitnessesForDisplay = reorderEntities(
    baseWithCanonicalFirst,
    draftCount.witnessOrder || {}
  )

  // Left-off inset (unchecked only)
  const selectedWitnessIds = (draftCount.selectedWitnessIds || []).map(String)

  const showLeftOffInset =
    (orderedWitnessesForDisplay.length > 0) &&
    (Boolean(draftCount.lastUpdatedAt) || selectedWitnessIds.length > 0)

  const leftOffPreview = orderedWitnessesForDisplay
    .filter(w => !selectedWitnessIds.includes(String(w.id)))
    .map(w => {
      const fullName = `${(w.firstName || '').trim()} ${(w.lastName || '').trim()}`.trim()
      return fullName || `Witness ${w.id}`
    })

  return res.render('cases/indictment/counts/select-and-order-witnesses', {
    _case: { ..._case, witnesses: orderedWitnessesForDisplay },
    countsCase,
    chargeOptions,
    draftCount,
    showWitnessReorderSuccess,
    showLeftOffInset,
    leftOffPreview
  })
})

router.post('/cases/:caseId/indictment/counts/select-and-order-witnesses', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const action = (req.body.action || '').toString()

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})

  // Selected witness IDs (checkboxes) — normalise to strings
  const rawSelected = req.body.selectedWitnessIds
  const selectedWitnessIds = Array.isArray(rawSelected)
    ? rawSelected.map(String)
    : (rawSelected ? [String(rawSelected)] : [])

  // ✅ Robust extraction (works with extended:true OR extended:false)
  const rawOrder = extractBracketMap(req.body, 'witnessOrder')

  // Always persist what they entered
  draftCount.selectedWitnessIds = selectedWitnessIds
  draftCount.witnessOrder = rawOrder
  draftCount.lastUpdatedAt = new Date().toISOString()

  // Helper: compute canonical ordered selected IDs for this count (stable)
  async function buildOrderedIdsForCount(selectedIds = [], orderMap = {}) {
    const _case = await fetchCase(caseId)
    if (!_case) return []

    const base = (_case.witnesses || [])
      .map(w => String(w.id))
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

  // Reorder-only: auto-check moved, compute canonical order NOW, flash success, redirect back
  if (action === 'reorder') {
    const movedIds = Object.entries(rawOrder)
      .filter(([_, v]) => {
        const pos = Number.parseInt(String(v || ''), 10)
        return Number.isFinite(pos) && pos > 0
      })
      .map(([id]) => String(id))

    draftCount.selectedWitnessIds = Array.from(new Set([
      ...draftCount.selectedWitnessIds,
      ...movedIds
    ]))

    // ✅ compute canonical order immediately so the next GET reflects it
    draftCount.orderedSelectedWitnessIds = await buildOrderedIdsForCount(
      draftCount.selectedWitnessIds,
      rawOrder
    )

    _.set(req, countPath, draftCount)
    _.set(req, `${draftBasePath}.reorderWitnessSuccess`, true)

    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-witnesses`)
  }

  // Persist draftCount for other actions too
  _.set(req, countPath, draftCount)

  // Skip
  if (action === 'skip') {
    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-victims`)
  }

  // Save and continue: compute canonical ordered selection + update case default
  draftCount.orderedSelectedWitnessIds = await buildOrderedIdsForCount(
    draftCount.selectedWitnessIds || [],
    rawOrder
  )
  _.set(req, countPath, draftCount)

  _.set(req, `${draftBasePath}.defaultWitnessOrderIds`, draftCount.orderedSelectedWitnessIds)

  return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-victims`)
})



// ============================================================
// /cases/:caseId/indictment/counts/select-and-order-victims (GET + POST)
// Same pattern as Defendants/Witnesses
// ============================================================

router.get('/cases/:caseId/indictment/counts/select-and-order-victims', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const countsCase = getCountsCaseFor(caseId)

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})

  // One-time success banner (flash behaviour)
  const successKey = `${draftBasePath}.reorderVictimSuccess`
  const showVictimReorderSuccess = _.get(req, successKey, false)
  _.unset(req, successKey)

  // Case-level default “story order” for victims
  const defaultVictimOrderIds = (_.get(req, `${draftBasePath}.defaultVictimOrderIds`, []) || []).map(String)

  // Count-level override wins
  const hasCountOverride =
    (draftCount?.orderedSelectedVictimIds?.length > 0) ||
    (draftCount?.victimOrder && Object.keys(draftCount.victimOrder).length > 0)

  function applyCaseDefaultOrder(entities = [], defaultIds = []) {
    if (!defaultIds.length) return entities
    const byId = new Map(entities.map(e => [String(e.id), e]))

    const ordered = defaultIds.map(id => byId.get(String(id))).filter(Boolean)
    const remaining = entities.filter(e => !defaultIds.includes(String(e.id)))

    return [...ordered, ...remaining]
  }

  function reorderEntities(entities = [], orderMap = {}) {
    const indexed = entities.map((e, index) => ({ e, index }))

    const moves = indexed
      .map(({ e, index }) => {
        const raw = orderMap[String(e.id)]
        const pos = Number.parseInt(String(raw || ''), 10)
        if (!Number.isFinite(pos) || pos <= 0) return null
        return { id: String(e.id), pos, index }
      })
      .filter(Boolean)
      .sort((a, b) => a.pos - b.pos || a.index - b.index)

    const result = indexed.map(x => x.e)

    for (const move of moves) {
      const fromIndex = result.findIndex(e => String(e.id) === move.id)
      if (fromIndex === -1) continue

      const [item] = result.splice(fromIndex, 1)
      const toIndex = Math.max(0, Math.min(result.length, move.pos - 1))
      result.splice(toIndex, 0, item)
    }

    return result
  }

  const victims = _case.victims || []

  const baseVictims = hasCountOverride
    ? victims
    : applyCaseDefaultOrder(victims, defaultVictimOrderIds)

  const orderedVictimsForDisplay = reorderEntities(
    baseVictims,
    draftCount.victimOrder || {}
  )

  // Left-off inset (unchecked only)
  const selectedVictimIds = (draftCount.selectedVictimIds || []).map(String)

  const showLeftOffInset =
    (orderedVictimsForDisplay.length > 0) &&
    (Boolean(draftCount.lastUpdatedAt) || selectedVictimIds.length > 0)

  const leftOffPreview = orderedVictimsForDisplay
    .filter(v => !selectedVictimIds.includes(String(v.id)))
    .map(v => {
      const fullName = `${(v.firstName || '').trim()} ${(v.lastName || '').trim()}`.trim()
      return fullName || `Victim ${v.id}`
    })

  return res.render('cases/indictment/counts/select-and-order-victims', {
    _case: { ..._case, victims: orderedVictimsForDisplay },
    countsCase,
    draftCount,

    showVictimReorderSuccess,
    showLeftOffInset,
    leftOffPreview
  })
})

router.post('/cases/:caseId/indictment/counts/select-and-order-victims', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const action = (req.body.action || '').toString()

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})

  // Selected victim IDs — normalise to strings
  const rawSelected = req.body.selectedVictimIds
  const selectedVictimIds = Array.isArray(rawSelected)
    ? rawSelected.map(String)
    : (rawSelected ? [String(rawSelected)] : [])

  // ✅ Robust extraction (prevents numeric keys becoming 0,1,2…)
  const rawOrder = extractBracketMap(req.body, 'victimOrder')

  // Always persist what they entered
  draftCount.selectedVictimIds = selectedVictimIds
  draftCount.victimOrder = rawOrder
  draftCount.lastUpdatedAt = new Date().toISOString()
  _.set(req, countPath, draftCount)

  if (action === 'reorder') {
    const movedIds = Object.entries(rawOrder)
      .filter(([_, v]) => {
        const pos = Number.parseInt(String(v || ''), 10)
        return Number.isFinite(pos) && pos > 0
      })
      .map(([id]) => String(id))

    draftCount.selectedVictimIds = Array.from(new Set([
      ...(draftCount.selectedVictimIds || []).map(String),
      ...movedIds
    ]))

    _.set(req, countPath, draftCount)
    _.set(req, `${draftBasePath}.reorderVictimSuccess`, true)

    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-victims`)
  }

  // Skip: move on
  if (action === 'skip') {
    return res.redirect(`/cases/${caseId}/indictment/counts/date-and-charges`)
  }

  // Save and continue: compute canonical ordered selection for this count + update case default
  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  function buildOrderedIds(selectedIds = [], orderMap = {}, entities = []) {
    const base = (entities || [])
      .map(e => String(e.id))
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

  const orderedSelectedVictimIds = buildOrderedIds(
    draftCount.selectedVictimIds || [],
    rawOrder,
    _case.victims || []
  )

  draftCount.orderedSelectedVictimIds = orderedSelectedVictimIds
  _.set(req, countPath, draftCount)

  // Case-level default “story order” for future counts
  _.set(req, `${draftBasePath}.defaultVictimOrderIds`, orderedSelectedVictimIds)

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

  // ✅ Only the charges selected earlier
  const selectedChargeCodes = (draftCount.selectedChargeCodes || []).map(String)
  const selectedChargeOptions = caseChargeOptions.filter(c =>
    selectedChargeCodes.includes(String(c.chargeCode))
  )

  const returnTo = safeReturnTo(req.query.returnTo)

  return res.render('cases/indictment/counts/date-and-charges', {
    _case,
    countsCase,

    // ✅ Use this in the template instead of caseChargeOptions
    selectedChargeOptions,

    caseChargeOptions, // keep if you still need it elsewhere, otherwise remove
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

  // ============================================================
  // Charges: ONE radios group (chargeSelection)
  // - value is either a chargeCode OR "newCount"
  // - selectedChargeCodes already live in session from /counts/charges
  // ============================================================

  const chargeSelection = (req.body.chargeSelection || '').toString()

  // Session truth: what they checked earlier (do NOT rely on POSTing these again)
  const selectedChargeCodes = (draftCount.selectedChargeCodes || []).map(String)

  if (chargeSelection === 'newCount') {
    draftCount.countBasis = 'newCount'
    draftCount.primaryChargeCode = null
    draftCount.selectedChargeCodes = [] // clear charge linkage

    // Selected charge fields (used later by offence-and-particulars)
    draftCount.chargeCode = null
    draftCount.chargeLabel = null
    draftCount.statementOfOffence = null
  } else {
    // They picked an existing charge (chargeSelection = chargeCode)
    draftCount.countBasis = 'existingCharge'

    // Ensure it’s one of the earlier selected codes; if not, fall back safely
    const primaryChargeCode = selectedChargeCodes.includes(String(chargeSelection))
      ? String(chargeSelection)
      : (selectedChargeCodes[0] || null)

    draftCount.primaryChargeCode = primaryChargeCode
    draftCount.selectedChargeCodes = selectedChargeCodes

    // Resolve full charge details from the case options
    const selected = caseChargeOptions.find(o => String(o.chargeCode) === String(primaryChargeCode)) || null

    // Selected charge fields (used by the Statement of Offence card + textarea)
    draftCount.chargeCode = selected ? selected.chargeCode : null
    draftCount.chargeLabel = selected ? selected.description : null

    // IMPORTANT: ensure buildChargeOptionsFromPrismaCase includes statementOfOffence.
    // If it does not, this will be null and your summary card will be weak.
    draftCount.statementOfOffence = selected ? (selected.statementOfOffence || null) : null

    // Optional: if user had typed a custom statement earlier, keep it.
    // If you want date-and-charges to always reset it, remove this.
    // if (!draftCount.statementOfOffenceText) draftCount.statementOfOffenceText = draftCount.statementOfOffence
  }

  // ============================================================
  // Date: single vs range (SOURCE OF TRUTH)
  // Use ONE naming scheme in your form: offence-date-*
  // ============================================================

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

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})
  const returnTo = safeReturnTo(req.query.returnTo)

  // Story order ids from the order step
  const orderedSelectedIds =
    (draftCount.orderedSelectedDefendantIds && draftCount.orderedSelectedDefendantIds.length)
      ? draftCount.orderedSelectedDefendantIds
      : (draftCount.selectedDefendantIds || [])

  const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String)

  // ✅ Never pre-check on assign (clear any old session state)
  draftCount.assignedDefendantIds = []
  _.set(req, countPath, draftCount)

  // ✅ Only show defendants that were selected earlier, in that exact order
  const allDefendants = _case.defendants || []
  const byId = new Map(allDefendants.map(d => [String(d.id), d]))

  const orderedDefendantsForDisplay = orderedSelectedIdsStr
    .map(id => byId.get(id))
    .filter(Boolean)

  return res.render('cases/indictment/assign/defendants', {
    _case: { ..._case, defendants: orderedDefendantsForDisplay },
    draftCount,
    returnTo
  })
})


  //////// POST /////////////////////////////////////////////////////////////////

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

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`

  const draftCount = _.get(req, countPath, {})
  const returnTo = safeReturnTo(req.query.returnTo)

  // 1) Story order ids from the order step
  const orderedSelectedIds =
    (draftCount.orderedSelectedVictimIds && draftCount.orderedSelectedVictimIds.length)
      ? draftCount.orderedSelectedVictimIds
      : (draftCount.selectedVictimIds || [])

  const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String)

  // ✅ 2) Never pre-check on assign (clear any old session state)
  draftCount.assignedVictimIds = []
  _.set(req, countPath, draftCount)

  // ✅ 3) Only show victims selected earlier, in that exact order
  const allVictims = _case.victims || []
  const byId = new Map(allVictims.map(v => [String(v.id), v]))

  const orderedVictimsForDisplay = orderedSelectedIdsStr
    .map(id => byId.get(id))
    .filter(Boolean)

  return res.render('cases/indictment/assign/victims', {
    _case: { ..._case, victims: orderedVictimsForDisplay },
    draftCount,
    returnTo
  })
})


  ////////// POST /////////////////////////////////////////////////////////////////

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

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`

  const draftCount = _.get(req, countPath, {})
  const returnTo = safeReturnTo(req.query.returnTo)

  // 1) Story order ids from the order step
  const orderedSelectedIds =
    (draftCount.orderedSelectedWitnessIds && draftCount.orderedSelectedWitnessIds.length)
      ? draftCount.orderedSelectedWitnessIds
      : (draftCount.selectedWitnessIds || [])

  const orderedSelectedIdsStr = (orderedSelectedIds || []).map(String)

  // ✅ 2) Never pre-check on assign (clear any old session state)
  draftCount.assignedWitnessIds = []
  _.set(req, countPath, draftCount)

  // ✅ 3) Only show witnesses selected earlier, in that exact order
  const allWitnesses = _case.witnesses || []
  const byId = new Map(allWitnesses.map(w => [String(w.id), w]))

  const orderedWitnessesForDisplay = orderedSelectedIdsStr
    .map(id => byId.get(id))
    .filter(Boolean)

  return res.render('cases/indictment/assign/witnesses', {
    _case: { ..._case, witnesses: orderedWitnessesForDisplay },
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

    return res.redirect(`/cases/${caseId}/indictment/counts/precedent-charges-or-offence`)
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

    // 👇 THIS LINE IS THE FIX
    const precedentResults =
      searchChargeLibrary(chargeLibrary, precedentSearchKeywords)

    const returnTo = safeReturnTo(req.query.returnTo)

    return res.render('cases/indictment/counts/precedent-charges-or-offence', {
      _case,
      countsCase,
      draftCount,
      precedentSearchKeywords,
      precedentResults,
      returnTo
    })
  })




router.post('/cases/:caseId/indictment/counts/precedent-charges-or-offence/continue', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
  const draftCount = _.get(req, basePath, {})

  // ------------------------------------------------------------
  // Helpers (local to this route)
  // ------------------------------------------------------------
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"]
    const v = n % 100
    return n + (s[(v - 20) % 10] || s[v] || s[0])
  }

  function formatNarrativeDateSingle(offenceDate) {
    const day = parseInt(offenceDate?.day, 10)
    const month = parseInt(offenceDate?.month, 10)
    const year = offenceDate?.year || ''

    const months = ["", "January","February","March","April","May","June","July","August","September","October","November","December"]

    if (!day || !month || !year) return "[date]"
    return `${ordinal(day)} day of ${months[month] || "[month]"} ${year}`
  }

  // Keep range working (falls back to numeric "dd/mm/yyyy to dd/mm/yyyy")
  function formatDateForTemplate(draftCount) {
    if (draftCount?.dateType === 'single') {
      return formatNarrativeDateSingle(draftCount.offenceDate)
    }

    if (draftCount?.dateType === 'range' && draftCount.offenceDateFrom && draftCount.offenceDateTo) {
      const f = draftCount.offenceDateFrom
      const t = draftCount.offenceDateTo
      const fromText = `${f.day || 'xx'}/${f.month || 'xx'}/${f.year || 'xx'}`
      const toText = `${t.day || 'xx'}/${t.month || 'xx'}/${t.year || 'xx'}`
      return `${fromText} to ${toText}`
    }

    return "[date]"
  }

  // Token replacement using the agreed tokens:
  // [Defendant(s)] on [date] at [place] [victim(s)]
  function injectTokens(template, map) {
    let out = String(template || '')
    for (const [token, value] of Object.entries(map)) {
      out = out.split(`[${token}]`).join(value || `[${token}]`)
    }
    return out
  }

  // ------------------------------------------------------------
  // Read selection from POST (library chargeCode)
  // (Keep backward compatibility with the old name too)
  // ------------------------------------------------------------
  const selectedCode = (req.body.selectedParticularsChargeCode || req.body.selectedPrecedentId || '')
    .toString()
    .trim()

  // Persist selection id (for checked radio + audit)
  draftCount.selectedParticularsChargeCode = selectedCode || null

  if (selectedCode) {
    // Resolve from charge library by chargeCode (e.g. "PO01", "F02")
    const picked = (chargeLibrary || []).find(c => String(c.chargeCode) === String(selectedCode)) || null

    // ----------------------------
    // Persist summary-friendly selection for CYA
    // (This is what /counts/check expects)
    // ----------------------------
    if (picked) {
      draftCount.precedentSelection = {
        ippCode: picked.chargeCode || '',
        statuteName: picked.statute?.act || '',
        offence: picked.label || picked.statementOfOffence || ''
      }
    } else {
      draftCount.precedentSelection = null
    }

    // ----------------------------
    // Store template source (useful for debug/audit)
    // ----------------------------
    const starter = picked?.templates?.particularsStarter || ''
    draftCount.particularsStarter = starter

    // ----------------------------
    // Build injected values from already-assigned actors + case location + date
    // ----------------------------
    const assignedDefendantIds = Array.isArray(draftCount.assignedDefendantIds)
      ? draftCount.assignedDefendantIds.map(String)
      : []
    const defendantNames = assignedDefendantIds
      .map(id => (_case.defendants || []).find(d => String(d.id) === id))
      .filter(Boolean)
      .map(d => `${d.firstName || ''} ${d.lastName || ''}`.trim())
      .filter(Boolean)

    const assignedVictimIds = Array.isArray(draftCount.assignedVictimIds)
      ? draftCount.assignedVictimIds.map(String)
      : []
    const victimNames = assignedVictimIds
      .map(id => (_case.victims || []).find(v => String(v.id) === id))
      .filter(Boolean)
      .map(v => `${v.firstName || ''} ${v.lastName || ''}`.trim())
      .filter(Boolean)

    // ALL CAPS requirement
    const defendantsText = defendantNames.length
      ? defendantNames.join(' and ').toUpperCase()
      : '[DEFENDANT(S)]'

    const victimsText = victimNames.length
      ? victimNames.join(' and ').toUpperCase()
      : '[VICTIM(S)]'

    const placeText = _case.location?.line1 || '[place]'
    const dateText = formatDateForTemplate(draftCount)

    // ----------------------------
    // OVERWRITE particulars (your requirement: usually changes)
    // ----------------------------
      draftCount.particularsOfOffenceText = injectTokens(starter, {

        // DEFENDANT tokens (all common variants)
        "Defendant(s)": defendantsText,
        "defendant(s)": defendantsText,
        "Defendant": defendantsText,
        "defendant": defendantsText,

        // VICTIM tokens (all common variants)
        "Victim(s)": victimsText,
        "victim(s)": victimsText,
        "Victim": victimsText,
        "victim": victimsText,

        // DATE tokens
        "date": dateText,
        "Date": dateText,

        // PLACE tokens
        "place": placeText,
        "Place": placeText,

        // MONTH fallback (only used if template literally contains [month])
        "month": (() => {
          const m = parseInt(draftCount?.offenceDate?.month, 10)
          const months = ["", "January","February","March","April","May","June","July","August","September","October","November","December"]
          return months[m] ? months[m].toUpperCase() : "MONTH"
        })()
      })

  } else {
    // Nothing selected: clear precedent + template
    draftCount.precedentSelection = null
    draftCount.particularsStarter = null
    // (Do NOT clear particularsOfOffenceText here; leaving it preserves any typed content)
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

    return res.redirect(`/cases/${caseId}/indictment/counts/added`)

  })
}
