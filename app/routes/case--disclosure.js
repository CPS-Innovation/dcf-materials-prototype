const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const documentTypes = require('../data/document-types')

function resetFilters(req) {
  _.set(req, 'session.data.documentListFilters.documentTypes', null)
}

////////////////////////////////////////////////////////////////////

module.exports = router => {
  router.get("/cases/:caseId/disclosure", async (req, res) => {
    const caseId = parseInt(req.params.caseId)

    let selectedDocumentTypeFilters = _.get(req.session.data.documentListFilters, 'documentTypes', [])

    let selectedFilters = { categories: [] }

    // Document type filter display
    if (selectedDocumentTypeFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'Type' },
        items: selectedDocumentTypeFilters.map(function(label) {
          return { text: label, href: `/cases/${caseId}/disclosure/remove-type/${label}` }
        })
      })
    }

    

    // Build Prisma where clause for documents
    let where = { caseId: caseId, AND: [] }

    if (selectedDocumentTypeFilters?.length) {
      where.AND.push({ type: { in: selectedDocumentTypeFilters } })
    }

    if (where.AND.length === 0) {
      delete where.AND
    }

    // Fetch case
    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        user: true,
        witnesses: { include: { statements: true } },
        lawyers: true,
        defendants: true,
        //hearing: true,
        location: true,
        tasks: true,
        dga: true
      }
    })

    // Fetch documents with filters
    let documents = await prisma.document.findMany({
      where: where
    })

    // Search by document name
    let keywords = _.get(req.session.data.documentSearch, 'keywords')

    if(keywords) {
      keywords = keywords.toLowerCase()
      documents = documents.filter(document => {
        let documentName = document.name.toLowerCase()
        return documentName.indexOf(keywords) > -1
      })
    }

    let documentTypeItems = documentTypes.map(docType => ({
      text: docType,
      value: docType
    }))

    res.render("cases/disclosure/index", {
      _case,
      documents,
      documentTypeItems,
      selectedFilters
    })
  })

  

  /////////////////////////////////////////////////////////////////////

  router.get("/cases/:caseId/disclosure/:documentId/show", async (req, res) => {
    const caseId = Number(req.params.caseId)
    const documentId = Number(req.params.documentId)

    // Fetch the case
    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        user: true,
        witnesses: { include: { statements: true } },
        lawyers: true,
        defendants: true,
        //hearing: true,
        location: true,
        tasks: true,
        dga: true
      }
    })
    if (!_case) return res.status(404).render("not-found")

    // Fetch the single document for this case
    const document = await prisma.document.findFirst({
      where: { id: documentId, caseId }
    })
    if (!document) return res.status(404).render("not-found")

    // (Optional) if you still need filter UI on the show page,
    // you can compute documentTypeItems/selectedFilters the same way as the list page.
    res.render("cases/disclosure/show", {
      _case,
      document
    })
  })

  ////////////////////////////////////////////////// --------------------------------------
  // CERTIFICATE: /cases/:caseId/disclosure/certificate
  router.get('/cases/:caseId/disclosure/certificate', async (req, res) => {
    const caseId = Number(req.params.caseId)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        user: true,
        witnesses: { include: { statements: true } },
        lawyers: true,
        defendants: true,
        //hearing: true,
        location: true,
        tasks: true,
        dga: true
      }
    })
    if (!_case) return res.status(404).render('not-found')

    return res.render('cases/disclosure/certificate', {
      _case,
      secondaryNavId: 'disclosure'
    })
  })

  ////////////////////////////////////////////////// --------------------------------------
  // SCHEDULE: /cases/:caseId/disclosure/schedule
  router.get('/cases/:caseId/disclosure/schedule', async (req, res) => {
    const caseId = Number(req.params.caseId)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        user: true,
        witnesses: { include: { statements: true } },
        lawyers: true,
        defendants: true,
       // hearing: true,
        location: true,
        tasks: true,
        dga: true
      }
    })
    if (!_case) return res.status(404).render('not-found')

    return res.render('cases/disclosure/schedule', {
      _case,
      secondaryNavId: 'disclosure'
    })
  })



  router.get('/cases/:caseId/disclosure/remove-type/:type', (req, res) => {
    _.set(req, 'session.data.documentListFilters.documentTypes', _.pull(req.session.data.documentListFilters.documentTypes, req.params.type))
    res.redirect(`/cases/${req.params.caseId}/disclosure`)
  })

  router.get('/cases/:caseId/disclosure/clear-filters', (req, res) => {
    resetFilters(req)
    res.redirect(`/cases/${req.params.caseId}/disclosure`)
  })

  router.get('/cases/:caseId/disclosure/clear-search', (req, res) => {
    _.set(req, 'session.data.documentSearch.keywords', '')
    res.redirect(`/cases/${req.params.caseId}/disclosure`)
  })

}