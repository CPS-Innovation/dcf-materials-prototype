const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { getTaskSeverity } = require('../helpers/taskState')
const { addTimeLimitDates } = require('../helpers/timeLimit')

module.exports = router => {
  router.get("/cases/:caseId/tasks/:taskId", async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: {
        unit: true,
        prosecutors: {
          include: {
            user: true
          }
        },
        paralegalOfficers: {
          include: {
            user: true
          }
        },
        defendants: {
          include: {
            charges: true,
            defenceLawyer: true
          }
        },
        hearings: {
          orderBy: {
            startDate: 'asc'
          },
          take: 1
        },
        location: true,
        tasks: true,
        dga: true
      },
    })

    // Add time limit information to the case
    addTimeLimitDates(_case)

    const task = await prisma.task.findUnique({
      where: { id: parseInt(req.params.taskId) },
      include: {
        case: {
          include: {
            defendants: {
              include: {
                charges: true,
                defenceLawyer: true
              }
            },
            unit: true
          }
        },
        assignedToUser: true,
        assignedToTeam: {
          include: {
            unit: true
          }
        },
        notes: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    })

    // Add severity information to the task
    task.severity = getTaskSeverity(task)

    // Get the next hearing (already fetched in _case.hearings)
    const hearing = _case.hearings && _case.hearings.length > 0 ? _case.hearings[0] : null

    res.render("cases/tasks/show", { _case, task, hearing })
  })

  router.get("/cases/:caseId/tasks/:taskId/complete", async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId) },
      include: {
        defendants: true
      }
    })

    const task = await prisma.task.findUnique({
      where: { id: parseInt(req.params.taskId) }
    })

    res.render("cases/tasks/complete/index", { _case, task })
  })

  router.post("/cases/:caseId/tasks/:taskId/complete", async (req, res) => {
    const taskId = parseInt(req.params.taskId)
    const caseId = parseInt(req.params.caseId)

    const task = await prisma.task.update({
      where: { id: taskId },
      data: { completedDate: new Date() },
      include: {
        assignedToUser: true,
        assignedToTeam: {
          include: {
            unit: true
          }
        }
      }
    })

    // Create activity log entry
    await prisma.activityLog.create({
      data: {
        userId: req.session.data.user.id,
        model: 'Task',
        recordId: task.id,
        action: 'UPDATE',
        title: 'Task completed',
        caseId: caseId,
        meta: {
          task: {
            id: task.id,
            name: task.name,
            reminderType: task.reminderType
          },
          assignedToUser: task.assignedToUser ? {
            id: task.assignedToUser.id,
            firstName: task.assignedToUser.firstName,
            lastName: task.assignedToUser.lastName
          } : null,
          assignedToTeam: task.assignedToTeam ? {
            id: task.assignedToTeam.id,
            name: task.assignedToTeam.name,
            unit: {
              name: task.assignedToTeam.unit.name
            }
          } : null
        }
      }
    })

    req.flash('success', 'Task completed')
    res.redirect(`/cases/${caseId}/tasks`)
  })

  // Mark as urgent routes
  router.get("/cases/:caseId/tasks/:taskId/mark-as-urgent", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        defendants: true
      }
    })

    const task = await prisma.task.findUnique({
      where: { id: taskId }
    })

    res.render("cases/tasks/mark-as-urgent/index", { _case, task })
  })

  router.post("/cases/:caseId/tasks/:taskId/mark-as-urgent", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)
    const { urgentNote } = req.body

    // Validate
    const errors = []
    if (!urgentNote || urgentNote.trim() === '') {
      errors.push({
        text: 'Enter a note',
        href: '#urgentNote'
      })
    }

    if (errors.length > 0) {
      const _case = await prisma.case.findUnique({
        where: { id: caseId },
        include: {
          defendants: true
        }
      })

      const task = await prisma.task.findUnique({
        where: { id: taskId }
      })

      return res.render("cases/tasks/mark-as-urgent/index", {
        _case,
        task,
        errors,
        errorList: errors,
        urgentNote
      })
    }

    // Store in session
    if (!req.session.data.markAsUrgent) {
      req.session.data.markAsUrgent = {}
    }
    req.session.data.markAsUrgent[taskId] = { urgentNote }

    res.redirect(`/cases/${caseId}/tasks/${taskId}/mark-as-urgent/check`)
  })

  router.get("/cases/:caseId/tasks/:taskId/mark-as-urgent/check", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        defendants: true
      }
    })

    const task = await prisma.task.findUnique({
      where: { id: taskId }
    })

    const urgentNote = req.session.data.markAsUrgent?.[taskId]?.urgentNote || ''

    res.render("cases/tasks/mark-as-urgent/check", { _case, task, urgentNote })
  })

  router.post("/cases/:caseId/tasks/:taskId/mark-as-urgent/check", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)
    const userId = req.session.data.user.id

    const urgentNote = req.session.data.markAsUrgent?.[taskId]?.urgentNote

    // Update task
    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        isUrgent: true,
        urgentNote
      },
      include: {
        assignedToUser: true,
        assignedToTeam: {
          include: {
            unit: true
          }
        }
      }
    })

    // Create activity log entry
    await prisma.activityLog.create({
      data: {
        userId,
        model: 'Task',
        recordId: task.id,
        action: 'UPDATE',
        title: 'Task marked as urgent',
        caseId,
        meta: {
          task: {
            id: task.id,
            name: task.name,
            reminderType: task.reminderType
          },
          urgentNote,
          assignedToUser: task.assignedToUser ? {
            id: task.assignedToUser.id,
            firstName: task.assignedToUser.firstName,
            lastName: task.assignedToUser.lastName
          } : null,
          assignedToTeam: task.assignedToTeam ? {
            id: task.assignedToTeam.id,
            name: task.assignedToTeam.name,
            unit: {
              name: task.assignedToTeam.unit.name
            }
          } : null
        }
      }
    })

    // Clear session data
    if (req.session.data.markAsUrgent) {
      delete req.session.data.markAsUrgent[taskId]
    }

    req.flash('success', 'Task marked as urgent')
    res.redirect(`/cases/${caseId}/tasks/${taskId}`)
  })

  // Mark as not urgent routes
  router.get("/cases/:caseId/tasks/:taskId/mark-as-not-urgent", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)

    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        defendants: true
      }
    })

    const task = await prisma.task.findUnique({
      where: { id: taskId }
    })

    res.render("cases/tasks/mark-as-not-urgent/index", { _case, task })
  })

  router.post("/cases/:caseId/tasks/:taskId/mark-as-not-urgent", async (req, res) => {
    const caseId = parseInt(req.params.caseId)
    const taskId = parseInt(req.params.taskId)
    const userId = req.session.data.user.id

    // Update task
    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        isUrgent: false,
        urgentNote: null
      },
      include: {
        assignedToUser: true,
        assignedToTeam: {
          include: {
            unit: true
          }
        }
      }
    })

    // Create activity log entry
    await prisma.activityLog.create({
      data: {
        userId,
        model: 'Task',
        recordId: task.id,
        action: 'UPDATE',
        title: 'Task marked as not urgent',
        caseId,
        meta: {
          task: {
            id: task.id,
            name: task.name,
            reminderType: task.reminderType
          },
          assignedToUser: task.assignedToUser ? {
            id: task.assignedToUser.id,
            firstName: task.assignedToUser.firstName,
            lastName: task.assignedToUser.lastName
          } : null,
          assignedToTeam: task.assignedToTeam ? {
            id: task.assignedToTeam.id,
            name: task.assignedToTeam.name,
            unit: {
              name: task.assignedToTeam.unit.name
            }
          } : null
        }
      }
    })

    req.flash('success', 'Task marked as not urgent')
    res.redirect(`/cases/${caseId}/tasks/${taskId}`)
  })

}
