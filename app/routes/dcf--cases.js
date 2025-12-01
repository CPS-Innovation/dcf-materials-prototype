const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const Pagination = require('../helpers/pagination')
const types = require('../data/types')
const complexities = require('../data/complexities')
const dgaStatuses = ['Needs review', 'Does not need review']

function resetFilters(req) {
  _.set(req, 'session.data.caseListFilters.dga', null)
  _.set(req, 'session.data.caseListFilters.isCTL', null)
  _.set(req, 'session.data.caseListFilters.unit', null)
  _.set(req, 'session.data.caseListFilters.complexities', null)
  _.set(req, 'session.data.caseListFilters.types', null)
  _.set(req, 'session.data.caseListFilters.lawyers', null)
}

module.exports = router => {

  router.get('/cases/shortcut/unassigned', (req, res) => {
    resetFilters(req)
    res.redirect('/cases/?caseListFilters[lawyers][]=Unassigned')
  })

  router.get('/cases/shortcut/dga', (req, res) => {
    resetFilters(req)
    res.redirect('/cases/?caseListFilters[dga][]=Needs review')
  })

  router.get("/cases", async (req, res) => {
    let selectedDgaFilters = _.get(req.session.data.caseListFilters, 'dga', [])
    let selectedCtlFilters = _.get(req.session.data.caseListFilters, 'isCTL', [])
    let selectedUnitFilters = _.get(req.session.data.caseListFilters, 'unit', [])
    let selectedComplexityFilters = _.get(req.session.data.caseListFilters, 'complexities', [])
    let selectedTypeFilters = _.get(req.session.data.caseListFilters, 'types', [])
    let selectedLawyerFilters = _.get(req.session.data.caseListFilters, 'lawyers', [])

    let selectedFilters = { categories: [] }

    // Priority filter display
    if (selectedDgaFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'DGA' },
        items: selectedDgaFilters.map(function(label) {
          return { text: label, href: '/cases/remove-dga/' + label }
        })
      })
    }

    // CTL filter display
    if (selectedCtlFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'CTL' },
        items: selectedCtlFilters.map(function(label) {
          return { text: label, href: '/cases/remove-ctl/' + label }
        })
      })
    }


    if (selectedUnitFilters?.length) {
      const unitIds = selectedUnitFilters.map(Number)

      let fetchedUnits = await prisma.unit.findMany({
        where: { id: { in: unitIds } }
      })

      let items = selectedUnitFilters.map(function (selectedUnit) {
        let unit = fetchedUnits.find(u => u.id === Number(selectedUnit))
        return { text: unit ? unit.name : selectedUnit, href: '/cases/remove-unit/' + selectedUnit }
      })

      selectedFilters.categories.push({ heading: { text: 'Unit' }, items })
    }


    // Type filter display
    if (selectedComplexityFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'Complexity' },
        items: selectedComplexityFilters.map(function(label) {
          return { text: label, href: '/cases/remove-complexity/' + label }
        })
      })
    }

    // Type filter display
    if (selectedTypeFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'Type' },
        items: selectedTypeFilters.map(function(label) {
          return { text: label, href: '/cases/remove-type/' + label }
        })
      })
    }

    let lawyerIds


    // Lawyer filter display
    if (selectedLawyerFilters?.length) {

      lawyerIds = selectedLawyerFilters.filter(function(l) { return l !== "Unassigned" }).map(Number)

      let fetchedLawyers = []
      if (lawyerIds.length) {
        fetchedLawyers = await prisma.lawyer.findMany({
          where: { id: { in: lawyerIds } },
          select: { id: true, firstName: true, lastName: true }
        })
      }

      let items = selectedLawyerFilters.map(function(selectedLawyer) {
        if (selectedLawyer === "Unassigned") return { text: "Unassigned", href: '/cases/remove-lawyer/' + selectedLawyer }

        let lawyer = fetchedLawyers.find(function(lawyer) { return lawyer.id === Number(selectedLawyer) })
        return { text: lawyer ? lawyer.firstName + " " + lawyer.lastName : selectedLawyer, href: '/cases/remove-lawyer/' + selectedLawyer }
      })

      selectedFilters.categories.push({ heading: { text: 'Prosecutor' }, items: items })
    }

    // Build Prisma where clause
    let where = { AND: [] }

    if (selectedDgaFilters?.length) {
      const reviewFilters = []

      if (selectedDgaFilters.includes('Needs review')) {
        reviewFilters.push({ dga: { outcome: null } })
      }

      if (selectedDgaFilters.includes('Does not need review')) {
        reviewFilters.push({ dga: { is: null } })
      }

      if (reviewFilters.length) {
        where.AND.push({ OR: reviewFilters })
      }
    }
  

    if (selectedCtlFilters?.length) {
      const ctlFilters = []

      if (selectedCtlFilters.includes('CTL')) {
        ctlFilters.push({ isCTL: true })
      }

      if (selectedCtlFilters.includes('Not CTL')) {
        ctlFilters.push({ isCTL: false })
      }

      if (ctlFilters.length) {
        where.AND.push({ OR: ctlFilters })
      }
    }

    if (selectedUnitFilters?.length) {
      const unitIds = selectedUnitFilters.map(Number) // convert to Int
      where.AND.push({ unitId: { in: unitIds } })
    }

    if (selectedComplexityFilters?.length) {
      where.AND.push({ complexity: { in: selectedComplexityFilters } })
    }
    if (selectedTypeFilters?.length) {
      where.AND.push({ type: { in: selectedTypeFilters } })
    }

    if(selectedLawyerFilters?.length) {
      let lawyerFilters = []

      if (selectedLawyerFilters?.includes("Unassigned")) {
        lawyerFilters.push({ lawyers: { none: {} } })
      }

      if (lawyerIds?.length) {
        lawyerFilters.push({ lawyers: { some: { id: { in: lawyerIds } } } })
      }

      if (lawyerFilters.length) {
        where.AND.push({ OR: lawyerFilters })
      }

    }
    
    if (where.AND.length === 0) {
      where = {}
    }

    let cases = await prisma.case.findMany({
      where: where,
      include: { 
        unit: true, 
        user: true, 
        lawyers: true, 
        defendants: true, 
        //hearing: true, 
        location: true, 
        tasks: true, 
        dga: true }
        //,
      //orderBy: {
        //isCTL: 'desc', // true values first
      //}
    })

    let keywords = _.get(req.session.data.caseSearch, 'keywords')

    if(keywords) {
      keywords = keywords.toLowerCase()
      cases = cases.filter(_case => {
        let reference = _case.reference.toLowerCase()
        let defendantName = (_case.defendants[0].firstName + ' ' + _case.defendants[0].lastName).toLowerCase()
        return reference.indexOf(keywords) > -1 || defendantName.indexOf(keywords) > -1
      })
    }

    let dgaItems = dgaStatuses.map(dgaStatus => ({ 
      text: dgaStatus, 
      value: dgaStatus
    }))

    let ctlItems = ['CTL', 'Not CTL'].map(ctl => ({ 
      text: ctl, 
      value: ctl
    }))

    let complexityItems = complexities.map(complexity => ({ 
      text: complexity, 
      value: complexity
    }))

    let typeItems = types.map(type => ({ 
      text: type, 
      value: type
    }))
    
    let units = await prisma.unit.findMany()

    let unitItems = units.map(unit => ({
      text: `${unit.name}`,
      value: `${unit.id}`
    }))


    let lawyers = await prisma.lawyer.findMany()

    let lawyerItems = [
      { text: 'Unassigned', value: 'Unassigned' },
      ...lawyers.map(lawyer => ({
        text: `${lawyer.firstName} ${lawyer.lastName}`,
        value: `${lawyer.id}`
      }))
    ]

    let totalCases = cases.length
    let pageSize = 25
    let pagination = new Pagination(cases, req.query.page, pageSize)
    cases = pagination.getData()

    res.render('cases/index', {
      totalCases, 
      cases,
      dgaItems,
      ctlItems,
      unitItems,
      complexityItems, 
      typeItems, 
      lawyerItems,
      selectedFilters,
      pagination
    })
  })

  router.get('/cases/remove-dga/:dga', (req, res) => {
    const currentFilters = _.get(req, 'session.data.caseListFilters.dga', [])
    _.set(req, 'session.data.caseListFilters.dga', _.pull(currentFilters, req.params.dga))
    res.redirect('/cases')
  })

  router.get('/cases/remove-ctl/:ctl', (req, res) => {
    const currentFilters = _.get(req, 'session.data.caseListFilters.isCTL', [])
    _.set(req, 'session.data.caseListFilters.isCTL', _.pull(currentFilters, req.params.ctl))
    res.redirect('/cases')
  })

  router.get('/cases/remove-unit/:unit', (req, res) => {
    const currentFilters = _.get(req, 'session.data.caseListFilters.unit', [])
    _.set(req, 'session.data.caseListFilters.unit', _.pull(currentFilters, req.params.unit))
    res.redirect('/cases')
  })

  router.get('/cases/remove-complexity/:complexity', (req, res) => {
    const currentFilters = _.get(req, 'session.data.caseListFilters.complexities', [])
    _.set(req, 'session.data.caseListFilters.complexities', _.pull(currentFilters, req.params.complexity))
    res.redirect('/cases')
  })

  router.get('/cases/remove-type/:type', (req, res) => {
    const currentFilters = _.get(req, 'session.data.caseListFilters.types', [])
    _.set(req, 'session.data.caseListFilters.types', _.pull(currentFilters, req.params.type))
    res.redirect('/cases')
  })

  router.get('/cases/remove-lawyer/:lawyer', (req, res) => {
    const currentFilters = _.get(req, 'session.data.caseListFilters.lawyers', [])
    _.set(req, 'session.data.caseListFilters.lawyers', _.pull(currentFilters, req.params.lawyer))
    res.redirect('/cases')
  })

  router.get('/cases/clear-filters', (req, res) => {
    resetFilters(req)
    res.redirect('/cases')
  })

  router.get('/cases/clear-search', (req, res) => {
    _.set(req, 'session.data.caseSearch.keywords', '')
    res.redirect('/cases')
  })

}