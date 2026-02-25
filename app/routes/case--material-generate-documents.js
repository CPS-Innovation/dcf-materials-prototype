// app/routes/case--generate-documents.js
const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

module.exports = router => {
  // Helper: load the JSON (swap this out later when it’s real data)
  function getGenerateDocsData () {
    const p = path.join(__dirname, '../data/case-materials-generate-documents.json')
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  }

  // STEP 1: Case documents
  router.get('/cases/:caseId/material/generate-cps-documents/case-documents', async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: true
      }
    })

    if (!_case) return res.status(404).render('not-found')

    const caseMaterialsGenerateDocuments =
      _.get(req, 'session.data.caseMaterialsGenerateDocuments', {})

    return res.render('v2/cases/material/generate-cps-documents/case-documents', {
      _case,
      caseMaterialsGenerateDocuments
    })
  })

  // STEP 1 POST (continue)
  router.post('/v2/cases/:caseId/material/generate-cps-documents/case-documents', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    // selectedDocuments will be string or array depending on count
    const selected = req.body.selectedDocuments || []

    // normalise to array
    const selectedDocs = Array.isArray(selected) ? selected : [selected]

    req.session.data.generateCpsDocuments = req.session.data.generateCpsDocuments || {}
    req.session.data.generateCpsDocuments.caseDocuments = selectedDocs

    // Next wizard step (stub)
    return res.redirect(`/v2/cases/${caseId}/material/generate-cps-documents/confirm`)
  })
}