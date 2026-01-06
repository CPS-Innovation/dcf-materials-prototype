// routes/case--disclosure.js
// routes/case--disclosure.js
const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

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

  ///Helpers
  function getCaseMaterialsForCase(req, _case) {
    const store = _.get(req, 'session.data.caseMaterials', null)

    const match = (obj) => {
      if (!obj) return false
      // match by reference (your JSON uses this)
      if (obj.caseId && _case && obj.caseId === _case.reference) return true
      // optional match by numeric (if you ever store it that way)
      if (obj.caseId && _case && String(obj.caseId) === String(_case.id)) return true
      return false
    }

    // Case 1: single object
    if (store && Array.isArray(store.Material)) {
      return match(store) ? store : {}
    }

    // Case 2: array of case-material objects
    if (Array.isArray(store)) {
      return store.find(match) || {}
    }

    return {}
  }



  router.get('/cases/:caseId/disclosure', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    res.render('cases/disclosure/index', { _case })
  })

  // ✅ Assess non-sensitive
  router.get('/cases/:caseId/disclosure/assess-non-sensitive', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    //// Check everythuing is here
    console.log('caseId', caseId, 'caseMaterials session type:', Array.isArray(_.get(req,'session.data.caseMaterials')) ? 'array' : typeof _.get(req,'session.data.caseMaterials'))
    console.log('caseMaterials.Material length:', (caseMaterials.Material || []).length)

    res.render('cases/disclosure/assess-non-sensitive/index', {
      _case,
      caseMaterials
    })
  })


  // ✅ Item: assess as disclosable (GET) — MINIMAL
  router.get('/cases/:caseId/disclosure/assess-non-sensitive/item-disclosable', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = getCaseMaterialsForCase(req, _case)

    return res.render('cases/disclosure/assess-non-sensitive/item-disclosable', {
      _case,
      caseMaterials
    })
  })





  // ✅ Item: assess as disclosable (POST updates session data)
  router.post('/cases/:caseId/disclosure/assess-non-sensitive/item-disclosable', async (req, res) => {
    
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const itemId = req.body.itemId
    if (!itemId) return res.status(400).send('Missing itemId')

    const policeStatus = req.body.policeStatus
    const cpsStatus = req.body.cpsStatus

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const cm = getCaseMaterialsForCase(req, _case)
    const materials = cm.Material || []

    const idx = materials.findIndex(m => m.ItemId === itemId)
    if (idx === -1) return res.status(404).send('Material not found')

    // Ensure disclosure objects exist
    _.set(cm, `Material[${idx}].policeDisclosure`,
      _.get(cm, `Material[${idx}].policeDisclosure`, {}))
    _.set(cm, `Material[${idx}].cpsDisclosure`,
      _.get(cm, `Material[${idx}].cpsDisclosure`, {}))

    // Apply updates
    if (policeStatus) _.set(cm, `Material[${idx}].policeDisclosure.status`, policeStatus)
    if (cpsStatus) _.set(cm, `Material[${idx}].cpsDisclosure.status`, cpsStatus)

    // Update case-level progress
    const current =
      _.get(cm, 'cpsDisclosureAssessment.hasAssessedNonSensitive', 'Not started yet')

    if (current === 'Not started yet') {
      _.set(cm, 'cpsDisclosureAssessment.hasAssessedNonSensitive', 'In progress')
    }

    const allAssessed = materials.every(m => {
      const s = _.get(m, 'cpsDisclosure.status', 'To be assessed')
      return s && s !== 'To be assessed'
    })

    if (allAssessed) {
      _.set(cm, 'cpsDisclosureAssessment.hasAssessedNonSensitive', 'Completed')
    }

    // 🔐 Persist back to session (object OR array)
    const stored = _.get(req, 'session.data.caseMaterials')

    if (Array.isArray(stored)) {
      const i = stored.findIndex(c => String(c.caseId) === String(caseId))
      if (i > -1) stored[i] = cm
      else stored.push(cm)
      _.set(req, 'session.data.caseMaterials', stored)
    } else {
      _.set(req, 'session.data.caseMaterials', cm)
    }

    _.set(req, 'session.data.successBanner', {
      titleText: 'Disclosure decision saved',
      text: `Assessment updated for ${itemId}.`
    })

    return res.redirect(`/cases/${caseId}/disclosure/assess-non-sensitive`)
  })



  // ✅ Assess sensitive (stub for later)
  router.get('/cases/:caseId/disclosure/assess-sensitive', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const caseMaterials = _.get(req, 'session.data.caseMaterials', null)

    res.render('cases/disclosure/assess-sensitive/index', {
      _case,
      caseMaterials
    })
  })
}
