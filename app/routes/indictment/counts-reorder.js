// app/routes/indictment/counts-reorder.js

const { _, fetchCase, parseCaseId, safeReturnTo } = require('./_shared')

module.exports = router => {

  function getCountsForReorder(req, _case, caseId) {
  // 1) Your intended place (current code)
  const a = _.get(req, `session.data.indictmentDrafts.${caseId}.counts`, [])
  if (Array.isArray(a) && a.length) return a

  // 2) Common fallbacks (adjust if your data model differs)
  const b = _.get(req, `session.data.cases.${caseId}.indictment.counts`, [])
  if (Array.isArray(b) && b.length) return b

  const c = _.get(_case, 'indictmentCounts', null) || _.get(_case, 'counts', null)
  if (Array.isArray(c) && c.length) return c

  return []
}


  // ------------------------------------------------------------
  // GET: Reorder counts (read-only cards + position inputs)
  // ------------------------------------------------------------
  router.get('/cases/:caseId/indictment/counts/added/reorder', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).send(`Case ${caseId} not found in Prisma`)

    const returnTo = safeReturnTo(req.query.returnTo)
    const showCountReorderSuccess = String(req.query.success || '') === '1'

    // Session storage root for this case’s indictment draft
    const indictmentBasePath = `session.data.indictments.${caseId}`
    const countsPath = `${indictmentBasePath}.counts`
    const countOrderPath = `${indictmentBasePath}.countOrder`

    const counts = _.get(req, countsPath, []) || []
    const countOrder = _.get(req, countOrderPath, {}) || {}


    // ✅ Apply saved order map to counts for display (best-effort)
    // countOrder keys look like: { "id-0": "2", "id-1": "1" }
    const orderedCounts = applyOrderMapToArray(counts, countOrder)

    // Re-save the ordered counts so “Counts added” and other pages reflect it consistently
    _.set(req, countsPath, orderedCounts)

    return res.render('cases/indictment/counts/added/reorder/index', {
      _case,
      counts: orderedCounts,
      draftIndictment: { countOrder },
      returnTo,
      showCountReorderSuccess
    })
  })

  // ------------------------------------------------------------
  // POST: Save / reorder / skip
  // ------------------------------------------------------------
  router.post('/cases/:caseId/indictment/counts/added/reorder', async (req, res) => {
    const caseId = parseCaseId(req, res)
    if (!caseId) return

    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo)

    const indictmentBasePath = `session.data.indictments.${caseId}`
    const countsPath = `${indictmentBasePath}.counts`
    const countOrderPath = `${indictmentBasePath}.countOrder`

    const counts = _.get(req, countsPath, []) || []



    // action buttons: (default = save+continue)
    const action = (req.body.action || '').toString()

    if (action === 'skip') {
      // Go back to where they came from, else counts added page
      return res.redirect(returnTo || `/cases/${caseId}/indictment/counts/added`)
    }

    // Read the posted order map: countOrder[id-0], countOrder[id-1]...
    const postedOrder = req.body.countOrder || {}
    const normalisedOrder = normaliseOrderMap(postedOrder)

    // Save the raw/normalised values for next render (so inputs persist)
    _.set(req, countOrderPath, normalisedOrder)

    // Apply it and persist the new array order
    const reorderedCounts = applyOrderMapToArray(counts, normalisedOrder)
    _.set(req, countsPath, reorderedCounts)

    // If they hit “Refresh and reorder”, stay on the page (but show success)
    if (action === 'reorder') {
      const url = `/cases/${caseId}/indictment/counts/added/reorder?success=1`
      return res.redirect(returnTo ? `${url}&returnTo=${encodeURIComponent(returnTo)}` : url)
    }

    // Default: Save and continue -> back to counts added (or returnTo)
    return res.redirect(returnTo || `/cases/${caseId}/indictment/counts/added?success=reordered`)
  })

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------

  function normaliseOrderMap(orderMap) {
    // orderMap example:
    // { "id-0": "2", "id-1": "", "id-2": "1" }
    const out = {}
    if (!orderMap || typeof orderMap !== 'object') return out

    for (const k of Object.keys(orderMap)) {
      const raw = (orderMap[k] ?? '').toString().trim()
      if (!raw) continue
      const n = parseInt(raw, 10)
      if (!Number.isFinite(n)) continue
      out[k] = String(n)
    }
    return out
  }

  function applyOrderMapToArray(items, orderMap) {
    if (!Array.isArray(items) || !items.length) return items || []
    if (!orderMap || typeof orderMap !== 'object') return items

    // Build a list of move instructions: (fromIndex -> desiredPos)
    // Keys are "id-<index>"
    const moves = []
    for (const k of Object.keys(orderMap)) {
      const m = /^id-(\d+)$/.exec(k)
      if (!m) continue
      const fromIndex = parseInt(m[1], 10)
      if (!Number.isFinite(fromIndex)) continue

      const desired = parseInt(orderMap[k], 10)
      if (!Number.isFinite(desired)) continue

      moves.push({ fromIndex, desiredPos: desired })
    }

    if (!moves.length) return items

    // Clamp desired positions to [1..n] and stabilise with tie-breaks
    const n = items.length
    moves.forEach(m => {
      if (m.desiredPos < 1) m.desiredPos = 1
      if (m.desiredPos > n) m.desiredPos = n
    })

    // We’ll compute a “rank” array for stable sort:
    // - If user provided a position: rank = desiredPos
    // - Else: rank = large number + originalIndex
    const ranked = items.map((item, idx) => {
      const key = `id-${idx}`
      const move = moves.find(x => x.fromIndex === idx)
      const desiredPos = move ? move.desiredPos : null

      return {
        item,
        originalIndex: idx,
        rank: desiredPos ? desiredPos : (n + 1000 + idx),
        desiredPos
      }
    })

    ranked.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.originalIndex - b.originalIndex
    })

    // If multiple items share the same desiredPos, the stable tie-break preserves original order.
    // This “compresses” naturally into a final order.
    return ranked.map(r => r.item)
  }
}
