// app/routes/indictment/counts.js
const {
  _,
  fetchCase,
  parseCaseId,
  safeReturnTo,
  extractBracketMap,
  getCountsCaseFor,
  buildChargeOptionsFromPrismaCase,
  buildChargeOptionsFromCountsCase,
  chargeLibrary,
  searchPrecedentsWithinCase,
  searchChargeLibrary
} = require('./_shared')

module.exports = router => {


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

      const draftBasePath = `session.data.indictmentDrafts.${caseId}`
      const basePath = `${draftBasePath}.currentCount`

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
        // Clear shared pool if explicitly choosing newCount
        _.set(req, `${draftBasePath}.selectedChargeCodes`, [])

        draftCount.selectedChargeCodes = []
        draftCount.primaryChargeCode = null
        draftCount.chargeCode = null
        draftCount.chargeLabel = null
      } else {

        // 🔥 SAVE SHARED CHARGE POOL AT INDICTMENT LEVEL
        _.set(req, `${draftBasePath}.selectedChargeCodes`, selectedChargeCodes)

        draftCount.selectedChargeCodes = selectedChargeCodes
        draftCount.primaryChargeCode = selectedChargeCodes[0] || null

        const primary = caseChargeOptions.find(o =>
          String(o.chargeCode) === String(draftCount.primaryChargeCode)
        ) || null

        if (primary) {
          draftCount.chargeCode = primary.chargeCode
          draftCount.chargeLabel = primary.description
        } else {
          draftCount.chargeCode = null
          draftCount.chargeLabel = null
        }
      }


      // ------------------------------------------------------------
      // Auto-seed assignments when there's nothing to reorder (0/1)
      // This ensures assign pages have data even if we skip reorder screens.
      // ------------------------------------------------------------
      const defendants = Array.isArray(_case.defendants) ? _case.defendants : []
      const victims = Array.isArray(_case.victims) ? _case.victims : []
      const witnesses = Array.isArray(_case.witnesses) ? _case.witnesses : []

      if (defendants.length === 0) {
        draftCount.assignedDefendantIds = []
        draftCount.selectedDefendantIds = []
        draftCount.orderedSelectedDefendantIds = []
      } else if (defendants.length === 1) {
        const id = String(defendants[0].id)
        draftCount.assignedDefendantIds = [id]
        draftCount.selectedDefendantIds = [id]
        draftCount.orderedSelectedDefendantIds = [id]
      }

      if (victims.length === 0) {
        draftCount.assignedVictimIds = []
        draftCount.selectedVictimIds = []
        draftCount.orderedSelectedVictimIds = []
      } else if (victims.length === 1) {
        const id = String(victims[0].id)
        draftCount.assignedVictimIds = [id]
        draftCount.selectedVictimIds = [id]
        draftCount.orderedSelectedVictimIds = [id]
      }

      if (witnesses.length === 0) {
        draftCount.assignedWitnessIds = []
        draftCount.selectedWitnessIds = []
        draftCount.orderedSelectedWitnessIds = []
      } else if (witnesses.length === 1) {
        const id = String(witnesses[0].id)
        draftCount.assignedWitnessIds = [id]
        draftCount.selectedWitnessIds = [id]
        draftCount.orderedSelectedWitnessIds = [id]
      }

      draftCount.lastUpdatedAt = new Date().toISOString()
      _.set(req, basePath, draftCount)

      _.set(req, `session.data.indictments.${caseId}.status`, 'In progress')

      // Flow control: go to the first ordering step that actually needs ordering.
      // If none need ordering, go straight to date-and-charges.
      const defendantCount = defendants.length
      const victimCount = victims.length
      const witnessCount = witnesses.length

      if (defendantCount >= 2) {
        return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-defendants`)
      }

      if (victimCount >= 2) {
        return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-victims`)
      }

      if (witnessCount >= 2) {
        return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-witnesses`)
      }

      return res.redirect(`/cases/${caseId}/indictment/counts/date-and-charges`)
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

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})

  // One-time success banner (flash behaviour)
  const successKey = `${draftBasePath}.reorderSuccess`
  const showDefendantReorderSuccess = _.get(req, successKey, false)
  _.unset(req, successKey)

  // Case-level default “story order” for defendants
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

  // ✅ NEW: apply a stable ID order list (orderedSelectedDefendantIds) as the base
  function applyIdOrder(entities = [], idOrder = []) {
    if (!idOrder || !idOrder.length) return entities
    const order = idOrder.map(String)
    const byId = new Map(entities.map(e => [String(e.id), e]))

    const ordered = order.map(id => byId.get(id)).filter(Boolean)
    const remaining = entities.filter(e => !order.includes(String(e.id)))

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

  const defendants = _case.defendants || []

  // 1) Start from either raw defendants or case default order
  let baseDefendants = hasCountOverride
    ? defendants
    : applyCaseDefaultOrder(defendants, defaultDefendantOrderIds)

  // 2) ✅ Apply stored canonical order first (so refreshes are stable)
  baseDefendants = applyIdOrder(
    baseDefendants,
    (draftCount.orderedSelectedDefendantIds || []).map(String)
  )

  // 3) Then apply current "move to position" map (defendantOrder)
  const orderedDefendantsForDisplay = reorderEntities(
    baseDefendants,
    draftCount.defendantOrder || {}
  )

  // Left-off inset (unchecked only)
  const selectedDefendantIds = (draftCount.selectedDefendantIds || []).map(String)

  const leftOffPreview = orderedDefendantsForDisplay
    .filter(d => !selectedDefendantIds.includes(String(d.id)))
    .map(d => `${d.firstName || ''} ${d.lastName || ''}`.trim())
    .filter(Boolean)

  const showLeftOffInset =
    (orderedDefendantsForDisplay.length > 0) &&
    (Boolean(draftCount.lastUpdatedAt) || selectedDefendantIds.length > 0) &&
    (leftOffPreview.length > 0)

  return res.render('cases/indictment/counts/select-and-order-defendants', {
    _case: { ..._case, defendants: orderedDefendantsForDisplay },
    countsCase,
    draftCount,
    showDefendantReorderSuccess, // ✅ matches template
    showLeftOffInset,
    leftOffPreview
  })
})

router.post('/cases/:caseId/indictment/counts/select-and-order-defendants', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})

  const action = (req.body.action || 'continue').toString()

  // Normalise selected IDs
  const rawSelected = req.body.selectedDefendantIds
  const selectedDefendantIds = Array.isArray(rawSelected)
    ? rawSelected
    : (rawSelected ? [rawSelected] : [])

  // Robust extraction (works with extended:true OR extended:false)
  let rawOrder = extractBracketMap(req.body, 'defendantOrder')

  // ✅ If keys look like 0..n indices, remap to real IDs in current PRISMA order
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

  // Continue: compute & store orderedSelectedDefendantIds and go next
  draftCount.orderedSelectedDefendantIds = buildOrderedIds(
    selectedDefendantIds,
    rawOrder,
    defendants
  )

  _.set(req, countPath, draftCount)

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

  // ✅ NEW: apply stable orderedSelectedVictimIds first (so refreshes are stable)
  function applyIdOrder(entities = [], idOrder = []) {
    if (!idOrder || !idOrder.length) return entities
    const order = idOrder.map(String)
    const byId = new Map(entities.map(e => [String(e.id), e]))

    const ordered = order.map(id => byId.get(id)).filter(Boolean)
    const remaining = entities.filter(e => !order.includes(String(e.id)))

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

  // 1) Base list (case default order unless count override exists)
  let baseVictims = hasCountOverride
    ? victims
    : applyCaseDefaultOrder(victims, defaultVictimOrderIds)

  // 2) ✅ Apply stored canonical order first
  baseVictims = applyIdOrder(
    baseVictims,
    (draftCount.orderedSelectedVictimIds || []).map(String)
  )

  // 3) Apply "move to position" map
  const orderedVictimsForDisplay = reorderEntities(
    baseVictims,
    draftCount.victimOrder || {}
  )

  // Left-off inset (unchecked only)
  const selectedVictimIds = (draftCount.selectedVictimIds || []).map(String)

  const leftOffPreview = orderedVictimsForDisplay
    .filter(v => !selectedVictimIds.includes(String(v.id)))
    .map(v => `${v.firstName || ''} ${v.lastName || ''}`.trim())
    .filter(Boolean)

  const showLeftOffInset =
    (orderedVictimsForDisplay.length > 0) &&
    (Boolean(draftCount.lastUpdatedAt) || selectedVictimIds.length > 0) &&
    (leftOffPreview.length > 0)

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

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})

  const action = (req.body.action || 'continue').toString()

  // Normalise selected IDs
  const rawSelected = req.body.selectedVictimIds
  const selectedVictimIds = Array.isArray(rawSelected)
    ? rawSelected
    : (rawSelected ? [rawSelected] : [])

  // Robust extraction
  let rawOrder = extractBracketMap(req.body, 'victimOrder')

  const victims = _case.victims || []
  const victimIds = victims.map(v => String(v.id))

  // Optional: if keys come through as indices (0..n), remap to real IDs
  const rawOrderKeys = Object.keys(rawOrder).map(String)
  const noneMatchRealIds = rawOrderKeys.length > 0 && rawOrderKeys.every(k => !victimIds.includes(k))
  const allLookLikeIndices = rawOrderKeys.length > 0 && rawOrderKeys.every(k => /^\d+$/.test(k))

  if (noneMatchRealIds && allLookLikeIndices) {
    const remapped = {}
    for (const [k, v] of Object.entries(rawOrder)) {
      const idx = Number.parseInt(String(k), 10)
      if (!Number.isFinite(idx)) continue
      const id = victimIds[idx]
      if (!id) continue
      remapped[id] = String(v ?? '')
    }
    rawOrder = remapped
  }

  // Always persist what they entered
  draftCount.selectedVictimIds = selectedVictimIds
  draftCount.victimOrder = rawOrder
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

    draftCount.selectedVictimIds = Array.from(new Set([
      ...(draftCount.selectedVictimIds || []).map(String).filter(v => v && v !== '_unchecked'),
      ...movedIds
    ]))

    draftCount.orderedSelectedVictimIds = buildOrderedIds(
      draftCount.selectedVictimIds,
      rawOrder,
      victims
    )

    _.set(req, countPath, draftCount)
    _.set(req, `${draftBasePath}.reorderVictimSuccess`, true)

    return res.redirect(`/cases/${caseId}/indictment/counts/select-and-order-victims`)
  }

  // Continue
  draftCount.orderedSelectedVictimIds = buildOrderedIds(
    selectedVictimIds,
    rawOrder,
    victims
  )

  _.set(req, countPath, draftCount)

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

  // If count hasn't started ordering, apply the case-level default witness order
  const baseWitnesses = hasCountOverride
    ? witnesses
    : applyCaseDefaultOrder(witnesses, defaultWitnessOrderIds)

  // If we have orderedSelectedWitnessIds for THIS count, bring them to the front in that order
  const withSelectedFirst =
    (draftCount?.orderedSelectedWitnessIds?.length > 0)
      ? orderByIdsFirst(baseWitnesses, draftCount.orderedSelectedWitnessIds)
      : baseWitnesses

  // Apply any move positions on top of that
  const orderedWitnessesForDisplay = reorderEntities(
    withSelectedFirst,
    draftCount.witnessOrder || {}
  )

  // Left-off inset (unchecked only)
  const selectedWitnessIds = (draftCount.selectedWitnessIds || []).map(String)

  const leftOffPreview = orderedWitnessesForDisplay
    .filter(w => !selectedWitnessIds.includes(String(w.id)))
    .map(w => `${w.firstName || ''} ${w.lastName || ''}`.trim())
    .filter(Boolean)

  const showLeftOffInset =
    (orderedWitnessesForDisplay.length > 0) &&
    (Boolean(draftCount.lastUpdatedAt) || selectedWitnessIds.length > 0) &&
    (leftOffPreview.length > 0)

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
  console.log('[POST witnesses] caseId=', caseId, 'body keys=', Object.keys(req.body || {}))
  if (!caseId) return

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const countPath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, countPath, {})

  const action = (req.body.action || 'continue').toString()

  // Normalise selected IDs
  const rawSelected = req.body.selectedWitnessIds
  const selectedWitnessIds = Array.isArray(rawSelected)
    ? rawSelected
    : (rawSelected ? [rawSelected] : [])

  // Robust extraction (works with extended:true OR extended:false)
  let rawOrder = extractBracketMap(req.body, 'witnessOrder')

  // Optional: if keys come through as indices (0..n), remap to real IDs
  const witnesses = _case.witnesses || []
  const witnessIds = witnesses.map(w => String(w.id))

  const rawOrderKeys = Object.keys(rawOrder).map(String)
  const noneMatchRealIds = rawOrderKeys.length > 0 && rawOrderKeys.every(k => !witnessIds.includes(k))
  const allLookLikeIndices = rawOrderKeys.length > 0 && rawOrderKeys.every(k => /^\d+$/.test(k))

  if (noneMatchRealIds && allLookLikeIndices) {
    const remapped = {}
    for (const [k, v] of Object.entries(rawOrder)) {
      const idx = Number.parseInt(String(k), 10)
      if (!Number.isFinite(idx)) continue
      const id = witnessIds[idx]
      if (!id) continue
      remapped[id] = String(v ?? '')
    }
    rawOrder = remapped
  }

  // Always persist what they entered
  draftCount.selectedWitnessIds = selectedWitnessIds
  draftCount.witnessOrder = rawOrder
  draftCount.lastUpdatedAt = new Date().toISOString()

  // Build ordered IDs for this count based on selected + move map
  async function buildOrderedIdsForCount(selectedIds = [], orderMap = {}) {
    const base = (witnesses || [])
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

  function pickNextAfterWitnesses() {
    return 'date-and-charges'
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
      ...(draftCount.selectedWitnessIds || []).map(String).filter(v => v && v !== '_unchecked'),
      ...movedIds
    ]))

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
    const next = pickNextAfterWitnesses()
    return res.redirect(`/cases/${caseId}/indictment/counts/${next}`)
  }

  // Save and continue: compute canonical ordered selection + update case default
  draftCount.orderedSelectedWitnessIds = await buildOrderedIdsForCount(
    draftCount.selectedWitnessIds || [],
    rawOrder
  )
  _.set(req, countPath, draftCount)

  _.set(req, `${draftBasePath}.defaultWitnessOrderIds`, draftCount.orderedSelectedWitnessIds)

  const next = pickNextAfterWitnesses()
  return res.redirect(`/cases/${caseId}/indictment/counts/${next}`)
})


///// ============================================================
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

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  // 🔥 Read shared charge pool instead of relying on currentCount
  const sharedSelectedChargeCodes =
    (_.get(req, `${draftBasePath}.selectedChargeCodes`, []) || []).map(String)

  // If this is a fresh count (no selection yet), seed it
  if (!draftCount.selectedChargeCodes || !draftCount.selectedChargeCodes.length) {
    draftCount.selectedChargeCodes = sharedSelectedChargeCodes
  }


  // ✅ Only the charges selected earlier
  const selectedChargeCodes = sharedSelectedChargeCodes
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


//////============================================================
// POST handler for date-and-charges: updates the shared selectedChargeCodes and the count-level currentCount based on the user's charge selection and date input. Then redirects to the next step.
////============================================================

router.post('/cases/:caseId/indictment/counts/date-and-charges', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const caseChargeOptions = buildChargeOptionsFromPrismaCase(_case)

  const draftBasePath = `session.data.indictmentDrafts.${caseId}`
  const basePath = `${draftBasePath}.currentCount`
  const draftCount = _.get(req, basePath, {})

  // ============================================================
  // Charges: ONE radios group (chargeSelection)
  // - value is either a chargeCode OR "newCount"
  // - selectedChargeCodes live at draft level (from /counts/charges)
  // ============================================================

  const chargeSelection = (req.body.chargeSelection || '').toString()

  // Session truth: what they checked earlier (do NOT rely on POSTing these again)
  const selectedChargeCodes =
    (_.get(req, `${draftBasePath}.selectedChargeCodes`, []) || []).map(String)

  // Keep currentCount in sync too (useful for older code paths)
  draftCount.selectedChargeCodes = selectedChargeCodes

  if (chargeSelection === 'newCount') {
    draftCount.countBasis = 'newCount'
    draftCount.primaryChargeCode = null

    // Clear charge linkage
    draftCount.selectedChargeCodes = []

    // Selected charge fields (used later by offence-and-particulars)
    draftCount.chargeCode = null
    draftCount.chargeLabel = null

    // ✅ This is the only statement field we actually use across the journey
    draftCount.statementOfOffenceText = null

  } else {
    // They picked an existing charge (chargeSelection = chargeCode)
    draftCount.countBasis = 'existingCharge'

    // Ensure it’s one of the earlier selected codes; if not, fall back safely
    const primaryChargeCode = selectedChargeCodes.includes(String(chargeSelection))
      ? String(chargeSelection)
      : (selectedChargeCodes[0] || null)

    draftCount.primaryChargeCode = primaryChargeCode

    // Resolve full charge details from the case options
    const selected = caseChargeOptions.find(o => String(o.chargeCode) === String(primaryChargeCode)) || null

    // Selected charge fields (used by the Statement of Offence card + sidebar)
    draftCount.chargeCode = selected ? selected.chargeCode : null
    draftCount.chargeLabel = selected ? (selected.description || selected.label || null) : null

    // ✅ Seed statementOfOffenceText ONLY if the user hasn't already typed one
    if (!draftCount.statementOfOffenceText) {
      if (draftCount.chargeCode && draftCount.chargeLabel) {
        draftCount.statementOfOffenceText = `${draftCount.chargeCode}: ${draftCount.chargeLabel}`
      } else {
        draftCount.statementOfOffenceText = draftCount.chargeLabel || null
      }
    }
  }

  // ============================================================
  // Date: single vs range (SOURCE OF TRUTH)
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


///// ============================================================
// POST handler for precedent selection
// - Saves selected precedent and resolved particulars starter to session
// - Redirects to the next step (assigning defendants)
// ============================================================

router.post('/cases/:caseId/indictment/counts/precedent-charges-or-offence/continue', async (req, res) => {
  const caseId = parseCaseId(req, res)
  if (!caseId) return

  const _case = await fetchCase(caseId)
  if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

  const basePath = `session.data.indictmentDrafts.${caseId}.currentCount`
  const draftCount = _.get(req, basePath, {})

  // ------------------------------------------------------------
  // DEBUG: confirm what the form is actually posting
  // ------------------------------------------------------------
  console.log('[precedent POST] selectedPrecedentId=', req.body.selectedPrecedentId)

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

  // ------------------------------------------------------------
  // 1) Get the selected precedent id from the form
  // ------------------------------------------------------------
  const selectedPrecedentId = (req.body.selectedPrecedentId || '').toString().trim()

  // Persist selection (even if blank)
  draftCount.selectedPrecedentId = selectedPrecedentId || null

  // ------------------------------------------------------------
  // 2) Resolve starter template from library
  // ------------------------------------------------------------
  const chosen = selectedPrecedentId
    ? (chargeLibrary || []).find(c => String(c.chargeCode) === String(selectedPrecedentId))
    : null

  const starter =
    chosen?.templates?.particularsStarter ||
    chosen?.particularsStarter ||
    null

  draftCount.precedentSelection = chosen || null
  draftCount.particularsStarter = starter || null

  // ------------------------------------------------------------
  // DEBUG: confirm what we ended up saving to session
  // ------------------------------------------------------------
  console.log(
    '[precedent POST] saved selectedPrecedentId=',
    draftCount.selectedPrecedentId,
    'has precedentSelection=',
    Boolean(draftCount.precedentSelection)
  )

  // ------------------------------------------------------------
  // 3) Token injection helper
  // ------------------------------------------------------------
  function injectTokens(text, tokenMap) {
    if (!text) return text
    let out = String(text)

    for (const [token, replacement] of Object.entries(tokenMap || {})) {
      if (!token) continue
      const safeToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp(`\\[${safeToken}\\]`, 'g'), String(replacement))
    }

    return out
  }

  if (starter) {
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

      // ✅ Conditionally add to indictment if there’s any content (prevents blank counts from spamming the indictment)if (hasAnyContent)
      indictment.counts = indictment.counts || []

      const editingIndex = Number.parseInt(String(draftCount.editingIndex ?? ''), 10)
      const isEditing = Number.isFinite(editingIndex) && editingIndex >= 0

      const savedCount = {
        createdAt: draftCount.createdAt || new Date().toISOString(),

        countBasis: draftCount.countBasis || null,
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
      }

      if (isEditing && indictment.counts[editingIndex]) {
        indictment.counts[editingIndex] = savedCount

        // ✅ Updated banner
        _.set(req, 'session.data.successBanner', {
          titleText: `Count ${editingIndex + 1} updated`,
          text: 'Your changes have been saved.'
        })

      } else {
        indictment.counts.push(savedCount)

        // ✅ Added banner
        _.set(req, 'session.data.successBanner', {
          titleText: 'Count saved',
          text: 'Your draft count has been added to the indictment.'
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

  // ------------------------------------------------------------
  // Counts home / "added" page
  // GET + POST
  // ------------------------------------------------------------

  // Shows the counts home page (where newly created counts live)
  router.get('/cases/:caseId/indictment/counts/added', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const indictment = _.get(req, indictmentBasePath, { status: 'In progress', counts: [] })

    const counts = indictment.counts || []
    const addedCount = counts.length ? counts[counts.length - 1] : null



    // ✅ IMPORTANT: render the template you uploaded
    // Your file is "cases/indictment/counts/added/index.html"
    return res.render('cases/indictment/counts/added/index', {
      _case,
      counts,
      addedCount
    })
  })

  /**
   * Optional POST handler.
   * You don’t strictly need this if your page only uses links,
   * but having it means you can switch to buttons/forms later
   * (e.g. “Add another count”, “Preview indictment”, “Reorder counts”).
   */
  router.post('/cases/:caseId/indictment/counts/added', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    // If you add a form later, post an "action" value.
    const action = (req.body.action || '').toString()

    if (action === 'preview') {
      return res.redirect(`/cases/${caseId}/indictment/preview`)
    }

    if (action === 'reorder') {
      return res.redirect(`/cases/${caseId}/indictment/counts/reorder`)
    }

    if (action === 'addAnother') {
      return res.redirect(`/cases/${caseId}/indictment/counts/date-and-charges`)
    }

    // Default: just go to the counts home again
    return res.redirect(`/cases/${caseId}/indictment/counts/added`)
  })

}
