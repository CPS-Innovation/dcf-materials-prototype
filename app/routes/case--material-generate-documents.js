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
  // TASK LIST
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const s = _.get(req, 'session.data.generateCpsDocuments', {})

    const caseDocCount      = (s.caseDocuments || []).length
    const defendantDocCount = Object.values(s.defendantDocumentsById || {}).reduce((sum, docs) => sum + docs.length, 0)
    const witnessDocCount   = Object.values(s.witnessDocumentsById || {}).reduce((sum, docs) => sum + docs.length, 0)

    return res.render('v2/cases/material/generate-cps-documents/task-list', {
      _case,
      caseDocCount,
      defendantDocCount,
      witnessDocCount
    })
  })

  // -------------------------
  // STEP 1: Case documents
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/case-documents', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    _.set(req, 'session.data.generateCpsDocuments.caseDocsConfirmed', false)

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
    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/case-documents-check`)
  })

  // -------------------------
  // STEP 1 CHECK
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/case-documents-check', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    return res.render('v2/cases/material/generate-cps-documents/case-documents-check', {
      _case,
      caseMaterialsGenerateDocuments: getGenerateDocsData(req),
      selections: _.get(req, 'session.data.generateCpsDocuments', {})
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/case-documents-check', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    _.set(req, 'session.data.generateCpsDocuments.caseDocsConfirmed', true)

    const count = (_.get(req, 'session.data.generateCpsDocuments.caseDocuments') || []).length
    _.set(req, 'session.data.successBanner', {
      text: `${count} case ${count === 1 ? 'document' : 'documents'} added`
    })

    return res.redirect(`/cases/${caseId}/material/generate-cps-documents`)
  })

  // -------------------------
  // STEP 2A: Select a defendant (radios)
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/defendants', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    _.set(req, 'session.data.generateCpsDocuments.defendantsConfirmed', false)

    const docs = getGenerateDocsData(req)
    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})
    const filteredDocs = {
      ...docs,
      defendants: (docs.defendants || []).filter(d => !Object.prototype.hasOwnProperty.call(byDefendant, String(d.id))).slice(0, 3)
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
    const next = `/cases/${caseId}/material/generate-cps-documents/defendant-documents`
    return res.redirect(returnUrl ? `${next}?returnUrl=${encodeURIComponent(returnUrl)}` : next)
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

    // Work out if there are other defendants remaining (not yet completed) — pool is first 3 only
    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})
    const remaining = defendants.slice(0, 3)
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

    if (req.body.returnUrl) return res.redirect(req.body.returnUrl)

    // Work out if there are any remaining defendants not yet completed (pool is first 3 only)
    const remaining = defendants.slice(0, 3)
      .map(d => String(d.id))
      .filter(id => id !== String(selectedId))
      .filter(id => !Object.prototype.hasOwnProperty.call(byDefendant, id))

    const hasMoreDefendants = remaining.length > 0

    // If there are no more defendants, skip the "add another?" decision entirely
    if (!hasMoreDefendants) {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/defendant-documents-check`)
    }

    // Otherwise, honour the radio answer
    const addAnother = (req.body.addAdditionalDefendant || '').toString()

    // If they didn't answer, treat as "no" (keeps flow moving)
    if (addAnother !== 'yes') {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/defendant-documents-check`)
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
  // REMOVE DEFENDANT (DIRECT — no confirmation page)
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/remove-defendant-direct', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    const defendantId = req.query.defendantId
    const docs = getGenerateDocsData(req)
    const defendant = (docs.defendants || []).find(d => String(d.id) === String(defendantId))
    const defName = defendant ? defendant.name : defendantId

    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})
    delete byDefendant[String(defendantId)]
    _.set(req, 'session.data.generateCpsDocuments.defendantDocumentsById', byDefendant)
    _.set(req, 'session.data.generateCpsDocuments.defendantsConfirmed', false)
    _.set(req, 'session.data.successBanner', { text: `${defName} removed` })

    const returnUrl = req.query.returnUrl
    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/defendant-documents-check`)
  })

  // -------------------------
  // REMOVE DEFENDANT
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/remove-defendant', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const defendantId = req.query.defendantId
    const docs = getGenerateDocsData(req)
    const defendant = (docs.defendants || []).find(d => String(d.id) === String(defendantId))
    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})
    const selectedDocIds = byDefendant[String(defendantId)] || []
    const selectedDocs = selectedDocIds.map(id => {
      const doc = (defendant && defendant.documents || []).find(d => String(d.id) === String(id))
      return doc ? doc.label : id
    })

    return res.render('v2/cases/material/generate-cps-documents/remove-defendant', {
      _case,
      defendant,
      selectedDocs,
      defendantId,
      returnUrl: req.query.returnUrl
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/remove-defendant', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    const defendantId = req.body.defendantId
    const returnUrl = req.body.returnUrl
    const byDefendant = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById', {})
    delete byDefendant[String(defendantId)]
    _.set(req, 'session.data.generateCpsDocuments.defendantDocumentsById', byDefendant)
    _.set(req, 'session.data.generateCpsDocuments.defendantsConfirmed', false)

    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/defendant-documents-check`)
  })

  // -------------------------
  // STEP 2B CHECK
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/defendant-documents-check', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    return res.render('v2/cases/material/generate-cps-documents/defendant-documents-check', {
      _case,
      caseMaterialsGenerateDocuments: getGenerateDocsData(req),
      selections: _.get(req, 'session.data.generateCpsDocuments', {})
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/defendant-documents-check', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    _.set(req, 'session.data.generateCpsDocuments.defendantsConfirmed', true)

    const byDef = _.get(req, 'session.data.generateCpsDocuments.defendantDocumentsById') || {}
    const count = Object.values(byDef).reduce((sum, docs) => sum + docs.length, 0)
    _.set(req, 'session.data.successBanner', {
      text: `${count} defendant ${count === 1 ? 'document' : 'documents'} added`
    })

    return res.redirect(`/cases/${caseId}/material/generate-cps-documents`)
  })

  // -------------------------
  // STEP 3A: Select witnesses (checkboxes)
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/witnesses', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    _.set(req, 'session.data.generateCpsDocuments.witnessesConfirmed', false)

    const docs = getGenerateDocsData(req)
    const byWitness = _.get(req, 'session.data.generateCpsDocuments.witnessDocumentsById', {})

    return res.render('v2/cases/material/generate-cps-documents/witnesses', {
      _case,
      caseMaterialsGenerateDocuments: docs,
      selectedWitnessIds: Object.keys(byWitness)
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/witnesses', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    const ids = asArray(req.body.selectedWitnessIds)
    const byWitness = {}
    ids.forEach(id => { byWitness[id] = ['witness_special_measures'] })
    _.set(req, 'session.data.generateCpsDocuments.witnessDocumentsById', byWitness)

    const returnUrl = req.query.returnUrl
    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/witness-documents-check`)
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

    if (req.body.returnUrl) return res.redirect(req.body.returnUrl)

    // Remaining witnesses not yet completed (excluding current)
    const remaining = witnesses
      .map(w => String(w.id))
      .filter(id => id !== String(selectedId))
      .filter(id => !Object.prototype.hasOwnProperty.call(byWitness, id))

    const hasMoreWitnesses = remaining.length > 0

    // If none remaining, skip the "add another?" decision entirely
    if (!hasMoreWitnesses) {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witness-documents-check`)
    }

    const addAnother = (req.body.addAdditionalWitness || '').toString()

    // No/blank → move on
    if (addAnother !== 'yes') {
      return res.redirect(`/cases/${caseId}/material/generate-cps-documents/witness-documents-check`)
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
  // STEP 3B CHECK
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/witness-documents-check', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    return res.render('v2/cases/material/generate-cps-documents/witness-documents-check', {
      _case,
      caseMaterialsGenerateDocuments: getGenerateDocsData(req),
      selections: _.get(req, 'session.data.generateCpsDocuments', {})
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/witness-documents-check', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    _.set(req, 'session.data.generateCpsDocuments.witnessesConfirmed', true)

    const byWit = _.get(req, 'session.data.generateCpsDocuments.witnessDocumentsById') || {}
    const count = Object.values(byWit).reduce((sum, docs) => sum + docs.length, 0)
    _.set(req, 'session.data.successBanner', {
      text: `${count} witness ${count === 1 ? 'document' : 'documents'} added`
    })

    return res.redirect(`/cases/${caseId}/material/generate-cps-documents`)
  })

  // -------------------------
  // REMOVE WITNESS (DIRECT — no confirmation page)
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/remove-witness-direct', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    const witnessId = req.query.witnessId
    const docs = getGenerateDocsData(req)
    const witness = (docs.witnesses || []).find(w => String(w.id) === String(witnessId))
    const witName = witness ? witness.name : witnessId

    const byWitness = _.get(req, 'session.data.generateCpsDocuments.witnessDocumentsById', {})
    delete byWitness[String(witnessId)]
    _.set(req, 'session.data.generateCpsDocuments.witnessDocumentsById', byWitness)
    _.set(req, 'session.data.generateCpsDocuments.witnessesConfirmed', false)
    _.set(req, 'session.data.successBanner', { text: `${witName} removed` })

    const returnUrl = req.query.returnUrl
    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/witness-documents-check`)
  })

  // -------------------------
  // REMOVE WITNESS
  // -------------------------
  router.get('/cases/:caseId/material/generate-cps-documents/remove-witness', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await fetchCase(caseId)
    if (!_case) return res.status(404).render('not-found')

    const witnessId = req.query.witnessId
    const docs = getGenerateDocsData(req)
    const witness = (docs.witnesses || []).find(w => String(w.id) === String(witnessId))
    const byWitness = _.get(req, 'session.data.generateCpsDocuments.witnessDocumentsById', {})
    const selectedDocIds = byWitness[String(witnessId)] || []
    const selectedDocs = selectedDocIds.map(id => {
      const doc = (witness && witness.documents || []).find(d => String(d.id) === String(id))
      return doc ? doc.label : id
    })

    return res.render('v2/cases/material/generate-cps-documents/remove-witness', {
      _case,
      witness,
      selectedDocs,
      witnessId,
      returnUrl: req.query.returnUrl
    })
  })

  router.post('/cases/:caseId/material/generate-cps-documents/remove-witness', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    ensureWizardState(req)
    const witnessId = req.body.witnessId
    const returnUrl = req.body.returnUrl
    const byWitness = _.get(req, 'session.data.generateCpsDocuments.witnessDocumentsById', {})
    delete byWitness[String(witnessId)]
    _.set(req, 'session.data.generateCpsDocuments.witnessDocumentsById', byWitness)
    _.set(req, 'session.data.generateCpsDocuments.witnessesConfirmed', false)

    return res.redirect(returnUrl || `/cases/${caseId}/material/generate-cps-documents/witness-documents-check`)
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

    const selections    = _.get(req, 'session.data.generateCpsDocuments', {})
    const selectedCaseIds = selections.caseDocuments || []
    const defendantById   = selections.defendantDocumentsById || {}
    const witnessById     = selections.witnessDocumentsById || {}

    const docs = getGenerateDocsFixture()
    const now  = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    const updatedCaseDocs = (docs.caseDocuments || []).map(doc =>
      selectedCaseIds.includes(String(doc.id))
        ? { ...doc, lastGenerated: now }
        : { ...doc, lastGenerated: null }
    )

    const updatedDefendants = (docs.defendants || []).map(defendant => {
      const sel = defendantById[String(defendant.id)] || []
      return {
        ...defendant,
        documents: (defendant.documents || []).map(doc =>
          sel.includes(String(doc.id))
            ? { ...doc, lastGenerated: now }
            : { ...doc, lastGenerated: null }
        )
      }
    })

    const updatedWitnesses = (docs.witnesses || []).map(witness => {
      const sel = witnessById[String(witness.id)] || []
      return {
        ...witness,
        documents: (witness.documents || []).map(doc =>
          sel.includes(String(doc.id))
            ? { ...doc, lastGenerated: now }
            : { ...doc, lastGenerated: null }
        )
      }
    })

    _.set(req, 'session.data.caseMaterialsGenerateDocuments', {
      ...docs,
      caseDocuments: updatedCaseDocs,
      defendants:    updatedDefendants,
      witnesses:     updatedWitnesses
    })

    const totalDocCount =
      selectedCaseIds.length +
      Object.values(defendantById).reduce((sum, docs) => sum + docs.length, 0) +
      Object.values(witnessById).reduce((sum, docs) => sum + docs.length, 0)

    _.set(req, 'session.data.successBanner', {
      text: `${totalDocCount} ${totalDocCount === 1 ? 'document' : 'documents'} generated`
    })

    return res.redirect(`/cases/${caseId}/material?tab=view-materials`)
  })
}