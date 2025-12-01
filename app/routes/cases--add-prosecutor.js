const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

function getProsecutorHintText(prosecutor) {
  total = prosecutor._count.caseProsecutors
  let hintParts = []

  if(prosecutor.didInitialReview) {
    hintParts.push(
      `<li>Initial review prosecutor</li>`
    )
  }


  if (prosecutor.specialistAreas.length) {
    hintParts.push(
      `<li>${prosecutor.specialistAreas.map(a => a.name).join(", ")}</li>`
    )
  }

  let caseLoadBreakdown = ''
  if (total === 0) {
    caseLoadBreakdown = "No cases"
  } else {
    if (prosecutor.ctlCases && prosecutor.ctlCases.length > 0) {
      hintParts.push(`<li>${total} case${total > 1 ? "s" : ""}</li>`)
    }

    // Collect only levels that have > 0
    let breakdown = []

    if (prosecutor.ctlCases && prosecutor.ctlCases.length > 0) {
      breakdown.push(`${prosecutor.ctlCases.length} CTL`)
    }

    if (prosecutor.stlCases && prosecutor.stlCases.length > 0) {
      breakdown.push(`${prosecutor.stlCases.length} STL`)
    }

    if (prosecutor.level1Cases && prosecutor.level1Cases.length > 0) {
      breakdown.push(`${prosecutor.level1Cases.length} level one`)
    }
    if (prosecutor.level2Cases && prosecutor.level2Cases.length > 0) {
      breakdown.push(`${prosecutor.level2Cases.length} level two`)
    }
    if (prosecutor.level3Cases && prosecutor.level3Cases.length > 0) {
      breakdown.push(`${prosecutor.level3Cases.length} level three`)
    }
    if (prosecutor.level4Cases && prosecutor.level4Cases.length > 0) {
      breakdown.push(`${prosecutor.level4Cases.length} level four`)
    }
    if (prosecutor.level5Cases && prosecutor.level5Cases.length > 0) {
      breakdown.push(`${prosecutor.level5Cases.length} level five`)
    }

    if (breakdown.length) {
      caseLoadBreakdown += `${breakdown.join(", ")}`
    }

  }

  hintParts.push(`<li>${caseLoadBreakdown}</li>`)

  return `<ul class="govuk-list govuk-list--bullet govuk-hint govuk-!-margin-bottom-0">${hintParts.join("")}</ul>`
}


module.exports = router => {

  router.get("/cases/:caseId/add-prosecutor", async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: {
        unit: true,
        prosecutors: {
          include: { user: { select: { id: true } } }
        }
      }
    })

    const assignedProsecutors = _.get(req.session.data, 'editProsecutors.prosecutors') || _case.prosecutors.map(cp => `${cp.user.id}`)

    let prosecutors = await prisma.user.findMany({
      where: {
        role: 'Prosecutor'
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        units: {
          include: {
            unit: true
          }
        },
        specialistAreas: true,
        preferredAreas: true,
        restrictedAreas: true,
        _count: {
          select: {
            caseProsecutors: true
          }
        },
        caseProsecutors: {
          include: {
            case: {
              select: {
                id: true,
                complexity: true,
                defendants: {
                  select: {
                    charges: {
                      select: {
                        custodyTimeLimit: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    })

    prosecutors = prosecutors.map((prosecutor, index) => {
      // Hard-code Michael Chen's caseload data
      if (prosecutor.firstName === 'Michael' && prosecutor.lastName === 'Chen') {
        return {
          ...prosecutor,
          _count: { caseProsecutors: 10 },          // Override the real count
          level1Cases: Array(3).fill({}), // 3 level 1 cases
          level2Cases: Array(3).fill({}), // 3 level 2 cases
          level3Cases: Array(2).fill({}), // 2 level 3 cases
          level4Cases: Array(1).fill({}), // 1 level 4 case
          level5Cases: Array(1).fill({}), // 1 level 5 case
          ctlCases: Array(2).fill({}),    // 2 CTL cases
          stlCases: Array(2).fill({}),    // 2 STL cases
          totalCases: 10,
          ctlCaseCount: 2,
          stlCaseCount: 2
        }
      }

      const cases = prosecutor.caseProsecutors?.map(cp => cp.case) || []

      const ctlCases = cases.filter(c => {
        return c.defendants.some(d => d.charges.some(ch => ch.custodyTimeLimit !== null))
      })

      const level1Cases = cases.filter(c => c.complexity === "Level 1")
      const level2Cases = cases.filter(c => c.complexity === "Level 2")
      const level3Cases = cases.filter(c => c.complexity === "Level 3")
      const level4Cases = cases.filter(c => c.complexity === "Level 4")
      const level5Cases = cases.filter(c => c.complexity === "Level 5")

      let newProsecutor = {
        ...prosecutor,
        level1Cases,
        level2Cases,
        level3Cases,
        level4Cases,
        level5Cases,
        ctlCases,
        totalCases: prosecutor._count.caseProsecutors,
        ctlCaseCount: ctlCases.length
      }
      return newProsecutor
    })

    prosecutors.sort((a, b) => a.totalCases - b.totalCases || a.ctlCaseCount - b.ctlCaseCount)

    // Find Michael Chen and make him the recommended prosecutor
    const michaelChenIndex = prosecutors.findIndex(p => p.firstName === 'Michael' && p.lastName === 'Chen')
    if (michaelChenIndex !== -1) {
      prosecutors[michaelChenIndex].didInitialReview = true
      prosecutors[michaelChenIndex].recommended = true
      // Move Michael Chen to the top of the list
      const michaelChen = prosecutors.splice(michaelChenIndex, 1)[0]
      prosecutors.unshift(michaelChen)

      // Limit to 4 prosecutors total: Michael Chen + 3 others with more cases
      // Get the next 3 prosecutors who have more cases than Michael
      const otherProsecutors = prosecutors.slice(1).filter(p => p.totalCases > 10)
      prosecutors = [michaelChen, ...otherProsecutors.slice(0, 3)]
    } else {
      // Fallback to first prosecutor if Michael Chen not found
      prosecutors[0].didInitialReview = true
      prosecutors[0].recommended = true
      // Limit to 5 prosecutors
      prosecutors = prosecutors.slice(0, 5)
    }

    let prosecutorItems = prosecutors.map(prosecutor => {
      let text = `${prosecutor.firstName} ${prosecutor.lastName}`
      if(prosecutor.recommended) {
        text += ` (most suitable)`
      }

      return {
        text: text,
        value: `${prosecutor.id}`,
        hint: {
          html: getProsecutorHintText(prosecutor)
        }
      }
    })

    // Add "Show other prosecutors" as the 5th option
    prosecutorItems.push({
      text: "Show other prosecutors",
      value: "show-more"
    })

    res.render("cases/add-prosecutor/index", {
      _case,
      assignedProsecutors,
      prosecutorItems
    })
  })

  router.post("/cases/:caseId/add-prosecutor", async (req, res) => {
    res.redirect(`/cases/${req.params.caseId}/add-prosecutor/check`)
  })

  router.get("/cases/:caseId/add-prosecutor/check", async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
    })

    // get the prosecutor being assigned
    let prosecutor = await prisma.user.findUnique({
      where: { id: parseInt(req.session.data.assignProsecutor.prosecutor) },
      include: {
        caseProsecutors: {
          include: {
            case: { select: { id: true, complexity: true } }
          }
        },
        _count: { select: { caseProsecutors: true } },
      },
    })

    res.render("cases/add-prosecutor/check", {
      _case,
      prosecutor
    })
  })

  router.post("/cases/:caseId/add-prosecutor/check", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const prosecutorId = parseInt(req.session.data.assignProsecutor.prosecutor)

    // Create CaseProsecutor record
    await prisma.caseProsecutor.create({
      data: {
        caseId: caseId,
        userId: prosecutorId
      }
    })

    const prosecutor = await prisma.user.findUnique({
      where: { id: prosecutorId },
      select: { id: true, firstName: true, lastName: true }
    })


    await prisma.activityLog.create({
      data: {
        userId: req.session.data.user.id,
        model: 'Case',
        recordId: caseId,
        action: 'UPDATE',
        title: 'Prosecutor assigned',
        caseId: caseId,
        meta: { prosecutor }
      }
    })

    delete req.session.data.assignProsecutor

    req.flash('success', 'Prosecutor assigned')
    res.redirect(`/cases/${req.params.caseId}`)
  })

}
