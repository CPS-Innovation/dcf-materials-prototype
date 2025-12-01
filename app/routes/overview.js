const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { getTaskSeverity } = require('../helpers/taskState')
const { addTimeLimitDates } = require('../helpers/timeLimit')

module.exports = router => {

  router.get("/overview", async (req, res) => {
    const currentUser = req.session.data.user
    const userUnitIds = currentUser?.units?.map(uu => uu.unitId) || []

    const unassignedCaseCount = await prisma.case.count({
      where: {
        prosecutors: {
          none: {}
        }
      }
    })

    // Count prosecutors with incomplete profiles (no specialist, preferred, or restricted areas)
    const allProsecutors = await prisma.user.findMany({
      where: {
        role: 'Prosecutor'
      },
      include: {
        specialistAreas: true,
        preferredAreas: true,
        restrictedAreas: true
      }
    })

    const incompleteProfileCount = allProsecutors.filter(prosecutor =>
      prosecutor.specialistAreas.length === 0 &&
      prosecutor.preferredAreas.length === 0 &&
      prosecutor.restrictedAreas.length === 0
    ).length

    const needsDGAReviewCount = await prisma.case.count({
      where: {
        dga: {
          outcome: null
        }
      }
    })

    // Count urgent tasks assigned to current user
    const urgentTaskCount = await prisma.task.count({
      where: {
        AND: [
          { completedDate: null },
          { assignedToUserId: currentUser.id },
          { case: { unitId: { in: userUnitIds } } },
          { isUrgent: true }
        ]
      }
    })

    // Fetch tasks assigned to current user with case and defendant info for time limit calculation
    let tasks = await prisma.task.findMany({
      where: {
        AND: [
          { completedDate: null },
          { assignedToUserId: currentUser.id },
          { case: { unitId: { in: userUnitIds } } }
        ]
      },
      include: {
        case: {
          include: {
            defendants: {
              include: {
                charges: true
              }
            }
          }
        }
      }
    })

    // Calculate severity for each task and group by severity
    const tasksBySeverity = {
      'Critically overdue': [],
      'Overdue': [],
      'Due soon': [],
      'Not due yet': []
    }

    // Count tasks by time limit type
    let ctlTaskCount = 0
    let stlTaskCount = 0
    let paceTaskCount = 0

    tasks.forEach(task => {
      const severity = getTaskSeverity(task)
      if (tasksBySeverity[severity]) {
        tasksBySeverity[severity].push(task)
      }

      // Calculate time limit info for this task's case
      addTimeLimitDates(task.case)

      // Count by time limit type
      if (task.case.custodyTimeLimit) ctlTaskCount++
      if (task.case.statutoryTimeLimit) stlTaskCount++
      if (task.case.paceTimeLimit) paceTaskCount++
    })

    // Fetch directions for cases assigned to current user (as prosecutor or paralegal officer)
    // Only include directions assigned to Prosecution
    const directionWhere = {
      AND: [
        { completedDate: null },
        { assignee: 'Prosecution' },
        {
          case: {
            unitId: { in: userUnitIds }
          }
        }
      ]
    }

    // Filter by current user's role
    if (currentUser.role === 'Prosecutor') {
      directionWhere.AND.push({
        case: {
          prosecutors: {
            some: { userId: currentUser.id }
          }
        }
      })
    } else if (currentUser.role === 'Paralegal officer') {
      directionWhere.AND.push({
        case: {
          paralegalOfficers: {
            some: { userId: currentUser.id }
          }
        }
      })
    }

    let directions = await prisma.direction.findMany({
      where: directionWhere
    })

    // Categorize directions by due date
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    let dueTodayDirectionCount = 0
    let dueTomorrowDirectionCount = 0
    let overdueDirectionCount = 0

    directions.forEach(direction => {
      const dueDate = new Date(direction.dueDate)
      dueDate.setHours(0, 0, 0, 0)

      if (dueDate < today) {
        overdueDirectionCount++
      } else if (dueDate.getTime() === today.getTime()) {
        dueTodayDirectionCount++
      } else if (dueDate.getTime() === tomorrow.getTime()) {
        dueTomorrowDirectionCount++
      }
    })

    // Count cases assigned to current user as prosecutor
    let prosecutorCaseCount = 0
    if (currentUser.role === 'Prosecutor') {
      prosecutorCaseCount = await prisma.case.count({
        where: {
          prosecutors: {
            some: {
              userId: currentUser.id
            }
          }
        }
      })
    }

    // Count cases assigned to current user as paralegal officer
    let paralegalOfficerCaseCount = 0
    if (currentUser.role === 'Paralegal officer') {
      paralegalOfficerCaseCount = await prisma.case.count({
        where: {
          paralegalOfficers: {
            some: {
              userId: currentUser.id
            }
          }
        }
      })
    }

    res.render('overview/index', {
      unassignedCaseCount,
      incompleteProfileCount,
      needsDGAReviewCount,
      urgentTaskCount,
      ctlTaskCount,
      stlTaskCount,
      paceTaskCount,
      criticallyOverdueTaskCount: tasksBySeverity['Critically overdue'].length,
      overdueTaskCount: tasksBySeverity['Overdue'].length,
      dueSoonTaskCount: tasksBySeverity['Due soon'].length,
      notDueYetTaskCount: tasksBySeverity['Not due yet'].length,
      dueTodayDirectionCount,
      dueTomorrowDirectionCount,
      overdueDirectionCount,
      prosecutorCaseCount,
      paralegalOfficerCaseCount
    })
  })

}