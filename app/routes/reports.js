const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const Pagination = require('../helpers/pagination')

const reportStatuses = ['Not started', 'In progress', 'Completed']

function resetFilters(req) {
  _.set(req, 'session.data.reportListFilters.status', null)
  _.set(req, 'session.data.reportListFilters.unit', null)
}

module.exports = router => {

  router.get("/reports", async (req, res) => {
    const currentUser = req.session.data.user

    // Get user's unit IDs for filtering
    const userUnitIds = currentUser?.units?.map(uu => uu.unitId) || []

    let selectedStatusFilters = _.get(req.session.data.reportListFilters, 'status', [])
    let selectedUnitFilters = _.get(req.session.data.reportListFilters, 'unit', [])

    // Check if this is the first visit (no filters have been set at all)
    const isFirstVisit = req.session.data.reportListFilters === undefined || 
                         (selectedStatusFilters === undefined && selectedUnitFilters === undefined)
    
    
    // Ensure selectedStatusFilters is an array (even if empty after clearing)
    if (!selectedStatusFilters) {
      selectedStatusFilters = []
    }

    let selectedFilters = { categories: [] }

    // Status filter display
    if (selectedStatusFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'Status' },
        items: selectedStatusFilters.map(function(label) {
          return { text: label, href: '/reports/remove-status/' + label }
        })
      })
    }

    // Unit filter display
    if (selectedUnitFilters?.length) {
      const unitIds = selectedUnitFilters.map(Number)

      let fetchedUnits = await prisma.unit.findMany({
        where: { id: { in: unitIds } }
      })

      let items = selectedUnitFilters.map(function (selectedUnit) {
        let unit = fetchedUnits.find(u => u.id === Number(selectedUnit))
        return { text: unit ? unit.name : selectedUnit, href: '/reports/remove-unit/' + selectedUnit }
      })

      selectedFilters.categories.push({ heading: { text: 'Unit' }, items })
    }

    // Build Prisma where clause
    let where = { 
      AND: [
        // Only include cases with DGA that have no outcome (non-compliant)
        { dga: { outcome: null } }
      ] 
    }

    // MANDATORY: Restrict to cases in user's units only
    if (selectedUnitFilters?.length) {
      const unitIds = selectedUnitFilters.map(Number)
      where.AND.push({ unitId: { in: unitIds } })
    } else if (userUnitIds.length) {
      where.AND.push({ unitId: { in: userUnitIds } })
    }

    // Status filter - this filters based on reportStatus field
    // Only apply if there are selected statuses
    if (selectedStatusFilters?.length > 0) {
      const statusConditions = selectedStatusFilters.map(status => {
        if (status === 'Not started') {
          return { reportStatus: null }
        }
        return { reportStatus: status }
      })
      
      where.AND.push({ OR: statusConditions })
    }

    let reports = await prisma.case.findMany({
      where: where,
      include: {
        unit: true,
        defendants: {
          include: {
            charges: true
          }
        },
        dga: {
          include: {
            failureReasons: true
          }
        }
      }
    })

    // Handle search by URN (reference number)
    let keywords = _.get(req.session.data.reportSearch, 'keywords')

    if(keywords) {
      keywords = keywords.toLowerCase()
      reports = reports.filter(report => {
        let reference = report.reference.toLowerCase()
        return reference.indexOf(keywords) > -1
      })
    }

    // Sort reports by status: In progress, Not started, Completed
    reports.sort((a, b) => {
      const statusOrder = {
        'In progress': 1,
        null: 2,  // Not started (reportStatus is null)
        'Completed': 3
      }
      
      const statusA = statusOrder[a.reportStatus] || 2
      const statusB = statusOrder[b.reportStatus] || 2
      
      return statusA - statusB
    })

    // Prepare filter items
    let statusItems = reportStatuses.map(status => ({ 
      text: status, 
      value: status
    }))

    // Fetch only user's units for the filter
    let units = await prisma.unit.findMany({
      where: { id: { in: userUnitIds } }
    })

    let unitItems = units.map(unit => ({
      text: `${unit.name}`,
      value: `${unit.id}`
    }))

    let totalReports = reports.length
    let pageSize = 25
    let pagination = new Pagination(reports, req.query.page, pageSize)
    reports = pagination.getData()

    res.render('reports/index', {
      totalReports,
      reports,
      statusItems,
      unitItems,
      selectedFilters,
      pagination
    })
  })

  router.get('/reports/remove-status/:status', (req, res) => {
    const currentFilters = _.get(req, 'session.data.reportListFilters.status', [])
    _.set(req, 'session.data.reportListFilters.status', _.pull(currentFilters, req.params.status))
    res.redirect('/reports')
  })

  router.get('/reports/remove-unit/:unit', (req, res) => {
    const currentFilters = _.get(req, 'session.data.reportListFilters.unit', [])
    _.set(req, 'session.data.reportListFilters.unit', _.pull(currentFilters, req.params.unit))
    res.redirect('/reports')
  })

  router.get('/reports/clear-filters', (req, res) => {
    resetFilters(req)
    res.redirect('/reports')
  })

  router.get('/reports/clear-search', (req, res) => {
    _.set(req, 'session.data.reportSearch.keywords', '')
    res.redirect('/reports')
  })

  router.get('/reports/export', async (req, res) => {
    const ExcelJS = require('exceljs')
    const currentUser = req.session.data.user

    // Get user's unit IDs for filtering
    const userUnitIds = currentUser?.units?.map(uu => uu.unitId) || []

    let selectedStatusFilters = _.get(req.session.data.reportListFilters, 'status', [])
    let selectedUnitFilters = _.get(req.session.data.reportListFilters, 'unit', [])

    // Build Prisma where clause (same as main reports page)
    let where = { 
      AND: [
        { dga: { outcome: null } }
      ] 
    }

    // Restrict to cases in user's units only
    if (selectedUnitFilters?.length) {
      const unitIds = selectedUnitFilters.map(Number)
      where.AND.push({ unitId: { in: unitIds } })
    } else if (userUnitIds.length) {
      where.AND.push({ unitId: { in: userUnitIds } })
    }

    // Status filter
    if (selectedStatusFilters?.length > 0) {
      const statusConditions = selectedStatusFilters.map(status => {
        if (status === 'Not started') {
          return { reportStatus: null }
        }
        return { reportStatus: status }
      })
      
      where.AND.push({ OR: statusConditions })
    }

    let cases = await prisma.case.findMany({
      where: where,
      include: {
        unit: true,
        dga: {
          include: {
            failureReasons: true
          }
        }
      }
    })

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('DGA Outcomes Report')

    // Define columns based on your image
    worksheet.columns = [
      { header: 'URN', key: 'urn', width: 15 },
      { header: 'Casework Type', key: 'caseworkType', width: 20 },
      { header: 'Unit', key: 'unit', width: 20 },
      { header: 'Police Unit Name', key: 'policeUnitName', width: 20 },
      { header: 'Police unit', key: 'policeUnit', width: 15 },
      { header: 'Reviewing group', key: 'reviewingGroup', width: 20 },
      { header: 'Review Type All', key: 'reviewTypeAll', width: 20 },
      { header: 'Review', key: 'review', width: 15 },
      { header: 'Prosecutor\'s Declaration', key: 'prosecutorDeclaration', width: 25 },
      { header: 'Rape', key: 'rape', width: 10 },
      { header: 'Domestic violence', key: 'domesticViolence', width: 20 },
      { header: 'Hate Crime Flag', key: 'hateCrimeFlag', width: 20 },
      { header: 'Failure types', key: 'failureTypes', width: 30 },
      { header: 'Non-compliant DGA outcome', key: 'outcome', width: 30 },
      { header: 'Contact methods', key: 'contactMethods', width: 20 },
      { header: 'Comments', key: 'comments', width: 30 }
    ]

    // Style the header row
    worksheet.getRow(1).font = { bold: true }
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    }

    // Add data rows - one row per failure reason
    cases.forEach(caseItem => {
      if (caseItem.dga && caseItem.dga.failureReasons && caseItem.dga.failureReasons.length > 0) {
        caseItem.dga.failureReasons.forEach(failureReason => {
          // Determine outcome text
          let outcomeText = failureReason.outcome || 'In progress'
          
          worksheet.addRow({
            urn: caseItem.reference,
            caseworkType: caseItem.type || '',
            unit: caseItem.unit.name,
            policeUnitName: '', // Add if you have this data
            policeUnit: '', // Add if you have this data
            reviewingGroup: '', // Add if you have this data
            reviewTypeAll: '', // Add if you have this data
            review: '', // Add if you have this data
            prosecutorDeclaration: '', // Add if you have this data
            rape: '', // Add if you have this data
            domesticViolence: '', // Add if you have this data
            hateCrimeFlag: '', // Add if you have this data
            failureTypes: failureReason.reason,
            outcome: outcomeText,
            contactMethods: failureReason.methods || '',
            comments: failureReason.details || ''
          })
        })
      }
    })

    // Set response headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename=dga-outcomes-report.xlsx')

    // Write to response
    await workbook.xlsx.write(res)
    res.end()
  })

}