// app/routes/case--generate-documents.js
const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {

  // -------------------------
  // Helpers
  // -------------------------
  
  function asArray(v) {
    const arr = !v ? [] : (Array.isArray(v) ? v : [v])
    return arr
      .map(x => (x === null || x === undefined) ? '' : String(x).trim())
      .filter(x => x && x !== '_unchecked')
  }

  function getGenerateDocsFixture () {
    const p = path.join(__dirname, '../data/case-materials-generate-documents.json')
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  }

  function getGenerateDocsData (req) {
    // Prefer session data, fall back to fixture JSON
    const fromSession = _.get(req, 'session.data.caseMaterialsGenerateDocuments', null)
    if (fromSession && Object.keys(fromSession).length) return fromSession
    return getGenerateDocsFixture()
  }

  async function fetchCase (caseId) {
    return prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: true,
        witnesses: true
      }
    })
  }

  function ensureWizardState (req) {
    req.session.data.generateCpsDocuments = req.session.data.generateCpsDocuments || {}
  }

  // -------------------------
  // STEP 1: Case documents
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/case-documents', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    return res.render('v2/cases/material/generate-cps-documents/case-documents', {
      _case,
      caseMaterialsGenerateDocuments: getGenerateDocsData(req)
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/case-documents', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    _.set(req, 'session.data.generateCpsDocuments.caseDocuments', asArray(req.body.selectedDocuments))

    const returnUrl = req.query.returnUrl
    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/defendant-documents`)
  })

  // -------------------------
  // STEP 2A: Select a defendant (radios)
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/defendants', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const docs = getGenerateDocsData(req)
    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})
    const filteredDocs = {
      ...docs,
      defendants: (docs.defendants || []).filter(d => !Object.prototype.hasOwnProperty.call(byDefendant, String(d.id)))
    }

    return res.render('v2/cases/material/generate-cps-documents/defendants', {
      _case,
      caseMaterialsGenerateDocuments: filteredDocs
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/defendants', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    _.set(req, 'session.data.generateCpsDocuments.selectedDefendantId', req.body.selectedDefendantId || null)

    const returnUrl = req.query.returnUrl
    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/defendant-documents`)
  })


  // -------------------------
  // STEP 2 (ALT): All defendants on one page, each with their own doc table
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/defendants-alternative', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    return res.render('v2/cases/material/generate-cps-documents/defendants-alternative', {
      _case,
      caseMaterialsGenerateDocuments: getGenerateDocsData(req)
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/defendants-alternative', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)

    // req.body.defendants is keyed by defendant id, e.g. { "3": { documents: ["charge-information", ...] } }
    const submitted = req.body.defendants || {}
    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})

    Object.entries(submitted).forEach(([defendantId, value]) => {
      byDefendant[String(defendantId)] = asArray(value.documents)
    })

    _.set(req, 'session.data.generateCpsDocuments.defendantDocumentsById', byDefendant)

    const returnUrl = req.query.returnUrl
    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/witnesses`)
  })


  // -------------------------
  // STEP 2B: Select documents for the chosen defendant (single list)
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/defendant-documents', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const docs = getGenerateDocsData(req)
    const defendants = (docs && docs.defendants) ? docs.defendants : []

    if (req.query.defendantId) {
      _.set(req, 'session.data.generateCpsDocuments.selectedDefendantId', req.query.defendantId)
    }

    const selectedId = _.get(req, 'session.data.generateCpsDocuments.selectedDefendantId', null)

    // If they landed here without choosing, bounce them back to the radios step
    if (!selectedId) {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/defendants`)
    }

    const selectedDefendant = defendants.find(d => String(d.id) === String(selectedId))

    // Defensive: selectedId not found in data
    if (!selectedDefendant) {
      _.unset(req, 'session.data.generateCpsDocuments.selectedDefendantId')
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/defendants`)
    }

    // Work out if there are other defendants remaining (not yet completed)
    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})
    const remaining = defendants
      .map(d => String(d.id))
      .filter(id => id !== String(selectedId))
      .filter(id => !Object.prototype.hasOwnProperty.call(byDefendant, id))

    const hasMoreDefendants = remaining.length > 0

    return res.render('v2/cases/material/generate-cps-documents/defendants-documents', {
      _case,
      selectedDefendant,
      hasMoreDefendants
    })
  })


  router.post('/cases/:caseId/material/generate-cps-documents/defendant-documents', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)

    const docs = getGenerateDocsData(req)
    const defendants = (docs && docs.defendants) ? docs.defendants : []

    const selectedId = _.get(req, 'session.data.generateCpsDocuments.selectedDefendantId', null)
    if (!selectedId) {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/defendants`)
    }

    // Save selections for THIS defendant (store per-defendant so looping works)
    const selectedDocs = asArray(req.body.selectedDefendantDocuments)
    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})
    byDefendant[String(selectedId)] = selectedDocs
    _.set(req, 'session.data.generateCpsDocuments.defendantDocumentsById', byDefendant)

    // Work out if there are any remaining defendants not yet completed (excluding current)
    const remaining = defendants
      .map(d => String(d.id))
      .filter(id => id !== String(selectedId))
      .filter(id => !Object.prototype.hasOwnProperty.call(byDefendant, id))

    const hasMoreDefendants = remaining.length > 0

    // If there are no more defendants, skip the "add another?" decision entirely
    if (!hasMoreDefendants) {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witnesses`)
    }

    // Otherwise, honour the radio answer
    const addAnother = (req.body.addAdditionalDefendant || '').toString()

    // If they didn't answer, treat as "no" (keeps flow moving)
    if (addAnother !== 'yes') {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witnesses`)
    }

    // They said YES — if exactly one remaining, auto-select it and go straight to docs page
    if (remaining.length === 1) {
      _.set(req, 'session.data.generateCpsDocuments.selectedDefendantId', remaining[0])
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/defendant-documents`)
    }

    // More than one remaining — send them back to the radios chooser
    return res.redirect(`/cases/${caseId}/material/generate-cps-documents/defendants`)
  })


  // -------------------------
  // STEP 3A: Select a witness (radios)
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/witnesses', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const docs = getGenerateDocsData(req)
    const witnesses = (docs && docs.witnesses) ? docs.witnesses : []

    const byWitness = _.get(req, 'session.data.generateCpsDocuments.witnessDocumentsById', {})
    const remaining = witnesses
      .map(w => String(w.id))
      .filter(id => !Object.prototype.hasOwnProperty.call(byWitness, id))

    const hasMoreWitnesses = remaining.length > 1
    // ^ "more than one" makes sense on the chooser page; if only one remains you could just auto-redirect, but we’ll keep it simple.

    const filteredDocs = {
      ...docs,
      witnesses: (docs.witnesses || []).filter(w => !Object.prototype.hasOwnProperty.call(byWitness, String(w.id)))
    }

    return res.render('v2/cases/material/generate-cps-documents/witnesses', {
      _case,
      caseMaterialsGenerateDocuments: filteredDocs,
      hasMoreWitnesses
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/witnesses', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    _.set(req, 'session.data.generateCpsDocuments.selectedWitnessId', req.body.selectedWitnessId || null)

    const returnUrl = req.query.returnUrl
    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/witness-documents`)
  })


  // -------------------------
  // STEP 3B: Select documents for chosen witness
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/witness-documents', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const docs = getGenerateDocsData(req)
    const witnesses = (docs && docs.witnesses) ? docs.witnesses : []

    if (req.query.witnessId) {
      _.set(req, 'session.data.generateCpsDocuments.selectedWitnessId', req.query.witnessId)
    }

    const selectedId = _.get(req, 'session.data.generateCpsDocuments.selectedWitnessId', null)

    // If they landed here without choosing, bounce them back to the radios step
    if (!selectedId) {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witnesses`)
    }

    const selectedWitness = witnesses.find(w => String(w.id) === String(selectedId))

    // Defensive: selectedId not found in data
    if (!selectedWitness) {
      _.unset(req, 'session.data.generateCpsDocuments.selectedWitnessId')
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witnesses`)
    }

    const byWitness = _.get(req, 'session.data.generateCpsDocuments.witnessDocumentsById', {})

    const remaining = witnesses
      .map(w => String(w.id))
      .filter(id => id !== String(selectedId))
      .filter(id => !Object.prototype.hasOwnProperty.call(byWitness, id))

    const hasMoreWitnesses = remaining.length > 0

    return res.render('v2/cases/material/generate-cps-documents/witnesses-documents', {
      _case,
      selectedWitness,
      hasMoreWitnesses
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/witness-documents', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)

    const docs = getGenerateDocsData(req)
    const witnesses = (docs && docs.witnesses) ? docs.witnesses : []

    const selectedId = _.get(req, 'session.data.generateCpsDocuments.selectedWitnessId', null)
    if (!selectedId) {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witnesses`)
    }

    // Save selections for THIS witness (store per-witness so looping works)
    const selectedDocs = asArray(req.body.selectedWitnessDocuments)
    const byWitness = _.get(req, 'session.data.generateCpsDocuments.witnessDocumentsById', {})
    byWitness[String(selectedId)] = selectedDocs
    _.set(req, 'session.data.generateCpsDocuments.witnessDocumentsById', byWitness)

    // Remaining witnesses not yet completed (excluding current)
    const remaining = witnesses
      .map(w => String(w.id))
      .filter(id => id !== String(selectedId))
      .filter(id => !Object.prototype.hasOwnProperty.call(byWitness, id))

    const hasMoreWitnesses = remaining.length > 0

    // If none remaining, skip the "add another?" decision entirely
    if (!hasMoreWitnesses) {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/check`)
    }

    const addAnother = (req.body.addAdditionalWitness || '').toString()

    // No/blank → move on
    if (addAnother !== 'yes') {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/check`)
    }

    // Yes → auto-select if only one left
    if (remaining.length === 1) {
      _.set(req, 'session.data.generateCpsDocuments.selectedWitnessId', remaining[0])
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witness-documents`)
    }

    // More than one remaining → back to radios
    return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witnesses`)
  })

  // -------------------------
  // STEP 4: Check
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/check', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    res.render('v2/cases/material/generate-cps-documents/check', {
      _case,
      caseMaterialsGenerateDocuments: getGenerateDocsData(req),
      selections: _.get(req, 'session.data.generateCpsDocuments', {})
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/check', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    // Baseline behaviour: show success + return to materials
    _.set(req, 'session.data.successBanner', {
      titleText: 'Documents queued',
      text: 'Your selected documents will be generated.'
    })

    return res.redirect(`/cases/${caseId}/material?tab=view-materials`)
  })
}