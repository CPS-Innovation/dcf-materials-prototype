// app/routes/case--disclosure-assess-as-unused.js
//
// Statement/Exhibit only:
// - GET  /cases/:caseId/disclosure/assess-as-unused
// - POST /cases/:caseId/disclosure/assess-as-unused
//
// Writes CPS assessment onto the *selected material* in session caseMaterials,
// then redirects back to returnUrl (materials viewer) with a success banner.

const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

console.log('✅ case--disclosure-assess-as-unused.js LOADED')

module.exports = router => {

  async function fetchCase(caseId) {
    return prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: { include: { defenceLawyer: true, charges: true } },
        victims: true,
        witnesses: { include: { statements: true, specialMeasures: true } },
        hearings: true,
        location: true,
        tasks: true,
        directions: true,
        documents: true,
        dga: { include: { failureReasons: true } },
        notes: { include: { user: true } },
        activityLogs: { include: { user: true } },
        prosecutors: { include: { user: true } },
        paralegalOfficers: { include: { user: true } }
      }
    })
  }

  // ---------------------------------------------
  // DEBUG route to confirm this file is loaded
  // ---------------------------------------------
  router.get('/__debug/assess-unused', (req, res) => {
    res.send('assess-as-unused route file is mounted')
  })

  // ---------------------------------------------
  // Helpers
  // ---------------------------------------------

  // Always pull from session; if it's an array, use the first entry that has Material[]
  function getCaseMaterialsFromSession(req) {
    const store = _.get(req, 'session.data.caseMaterials', null)

    if (store && Array.isArray(store.Material)) return store

    if (Array.isArray(store)) {
      const found = store.find(s => s && Array.isArray(s.Material))
      return found || {}
    }

    return {}
  }

  function normaliseId(v) {
    return String(v || '').trim()
  }

  function getItemId(m) {
    // Supports your current shape + a few common variants
    return normaliseId(
      (m && (m.ItemId || m.itemId || m.ItemID)) ||
      (m && m.Material && (m.Material.ItemId || m.Material.itemId || m.Material.ItemID)) ||
      (m && m.item) || // sometimes you have "item": "1" for unused rows; harmless fallback
      ''
    )
  }

  function getType(m) {
    return normaliseId(
      (m && (m.Type || m.type)) ||
      (m && m.Material && (m.Material.Type || m.Material.type)) ||
      ''
    )
  }

  function isStatementOrExhibit(m) {
    const t = getType(m).toLowerCase()
    return t === 'statement' || t === 'exhibit'
  }

  function buildDefaultViewerReturnUrl(caseId, itemId) {
    const open = itemId ? `&openItemId=${encodeURIComponent(itemId)}` : ''
    return `/cases/${caseId}/material?tab=view-materials${open}`
  }

  function computeDisagreesWithPolice(policeStatus, cpsStatus) {
    const pol = String(policeStatus || '').toLowerCase().trim()
    const cps = String(cpsStatus || '').toLowerCase().trim()
    if (pol === 'evidence' && cps.startsWith('unused -')) return true
    return false
  }

  function pickRationaleFromBody(body) {
    const assessment = String(body.disclosureAssessment || '').trim()

    if (assessment === 'Disclosable') return (body.disclosableReason || '').trim()
    if (assessment === 'Disclosable by inspection') return (body.disclosableByInspectionReason || '').trim()
    if (assessment === 'Not disclosable') return (body.notDisclosableReason || '').trim()
    if (assessment === 'Clearly not disclosable') return (body.clearlyNotDisclosableReason || '').trim()

    return ''
  }

  // ---------------------------------------------
  // GET
  // ---------------------------------------------
  router.get('/cases/:caseId/disclosure/assess-as-unused', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    // Prisma is "scaffolding" only — but keep it for your header templates
    const prismaCase = await fetchCase(caseId)
    const _case = prismaCase || { id: caseId, reference: `Case ${caseId}`, defendants: [] }

    const itemId = req.query?.itemId ? String(req.query.itemId) : null
    if (!itemId) return res.status(400).send('Missing itemId')

    const caseMaterials = getCaseMaterialsFromSession(req)
    const materials = Array.isArray(caseMaterials.Material) ? caseMaterials.Material : []

    // High-signal debug
    console.log('[assess-as-unused GET] incoming', {
      caseId,
      itemId,
      sessionCaseMaterialsType: Array.isArray(_.get(req, 'session.data.caseMaterials')) ? 'array' : typeof _.get(req, 'session.data.caseMaterials'),
      hasMaterialArray: Array.isArray(caseMaterials.Material),
      materialCount: materials.length,
      first10Ids: materials.slice(0, 10).map(getItemId),
      first10Types: materials.slice(0, 10).map(getType)
    })

    // Robust match: normalise both sides
    const wanted = normaliseId(itemId)
    const item = materials.find(m => normaliseId(getItemId(m)) === wanted)

    if (!item) {
      // One more log that helps immediately
      console.log('[assess-as-unused GET] NOT FOUND', {
        wanted,
        sample: materials.slice(0, 10).map(m => ({ id: getItemId(m), type: getType(m), title: m?.Title }))
      })
      return res.status(404).send('Material not found')
    }

    if (!isStatementOrExhibit(item)) {
      return res.status(400).send('Assess as unused is only available for Statements and Exhibits')
    }

    const returnUrl =
      req.query?.returnUrl
        ? String(req.query.returnUrl)
        : buildDefaultViewerReturnUrl(caseId, itemId)

    return res.render('cases/disclosure/assess-as-unused/index', {
      _case,
      caseMaterials,
      item,
      itemId,
      returnUrl
    })
  })

  // ---------------------------------------------
  // POST
  // ---------------------------------------------
  router.post('/cases/:caseId/disclosure/assess-as-unused', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const itemId = req.body?.itemId ? String(req.body.itemId) : null
    if (!itemId) return res.status(400).send('Missing itemId')

    // Prisma scaffolding only; but keep consistent with other pages
    const prismaCase = await fetchCase(caseId)
    const _case = prismaCase || { id: caseId, reference: `Case ${caseId}`, defendants: [] }

    const caseMaterials = getCaseMaterialsFromSession(req)
    const materials = Array.isArray(caseMaterials.Material) ? caseMaterials.Material : []

    const wanted = normaliseId(itemId)
    const idx = materials.findIndex(m => normaliseId(getItemId(m)) === wanted)
    if (idx === -1) {
      console.log('[assess-as-unused POST] NOT FOUND', {
        caseId,
        wanted,
        materialCount: materials.length,
        first10Ids: materials.slice(0, 10).map(getItemId)
      })
      return res.status(404).send('Material not found')
    }

    const item = materials[idx]
    if (!isStatementOrExhibit(item)) {
      return res.status(400).send('Assess as unused is only available for Statements and Exhibits')
    }

    const assessment = String(req.body.disclosureAssessment || '').trim()
    const cpsStatus = assessment ? `Unused - ${assessment}` : 'Unused - Disclosable'
    const cpsRationale = pickRationaleFromBody(req.body) || null

    const isSensitive = String(req.body.isSensitive || '').trim() // "Yes" | "No"
    const sensitiveReason = (req.body.sensitiveReason || '').trim() || null
    const notSensitiveReason = (req.body.notSensitiveReason || '').trim() || null

    const policeStatus =
      _.get(item, 'policeDisclosure.status', null) ||
      (item.isEvidence ? 'Evidence' : null)

    const disagrees = computeDisagreesWithPolice(policeStatus, cpsStatus)

    // Write CPS disclosure object onto the item
    _.set(item, 'cpsDisclosure.status', cpsStatus)
    _.set(item, 'cpsDisclosure.rationale', cpsRationale)
    _.set(item, 'cpsDisclosure.SensitivityDispute', 'None')

    _.set(item, 'cpsDisclosure.isSensitive', isSensitive || null)
    _.set(item, 'cpsDisclosure.sensitiveReason', sensitiveReason)
    _.set(item, 'cpsDisclosure.notSensitiveReason', notSensitiveReason)

    _.set(item, 'cpsDisclosure.disagreesWithPolice', disagrees)

    // ✅ NEW: add a new row to a dedicated session bucket for "evidence assessed as unused non-sensitive"
    const assessedUnusedPath = 'session.data.disclosureAssessedUnusedRows'
    const existing = _.get(req, assessedUnusedPath, [])

    const policeRationale =
      _.get(item, 'policeDisclosure.rationale', null) ||
      null

    const newRow = {
      // Unique id for highlighting / linking if needed later
      id: `assessed-unused-${itemId}`,

      // Keep both keys as your tables vary across templates
      itemId: itemId,
      ItemId: itemId,

      // If you later want exhibitReference etc, they’re now available on the row
      title: item.Title || item.exhibitReference || item.ItemId || 'Item',
      Title: item.Title || item.exhibitReference || item.ItemId || 'Item',

      description: item.exhibitDescription || item.Description || null,
      Description: item.exhibitDescription || item.Description || null,

      policeAssessment: policeStatus || 'Evidence',
      policeRationale: policeRationale,

      // Evidence won’t have rebuttable in your source model
      rebuttable: null,

      cpsAssessment: cpsStatus,
      cpsRationale: cpsRationale,

      cpsDisagreesWithPolice: disagrees,

      // Optional metadata (handy for filtering/styling later)
      source: 'evidence-assessed-unused',
      createdAt: new Date().toISOString()
    }

    existing.push(newRow)
    _.set(req, assessedUnusedPath, existing)

    // ✅ Banner should show on assess-non-sensitive index (your disclosure route already clears+renders it)
    _.set(req, 'session.data.successBanner', {
      titleText: 'Item assessed as unused non-sensitive',
      text: 'This update has been sent to the police.'
    })

    // ✅ Redirect to assess-non-sensitive (NOT back to viewer)
    return res.redirect(`/cases/${caseId}/disclosure/assess-non-sensitive`)
  })

}
