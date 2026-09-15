const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { getTaskSeverity } = require('./taskState')
const { addTimeLimitDates } = require('./timeLimit')

// Shared by case--task.js (Tasks tab) and case--reviews.js (Reviews tab) —
// both render a task's detail page from the same case/task/hearing data.
async function getTaskDetail(caseId, taskId) {
  const _case = await prisma.case.findUnique({
    where: { id: caseId },
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

  addTimeLimitDates(_case)

  const task = await prisma.task.findUnique({
    where: { id: taskId },
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

  task.severity = getTaskSeverity(task)

  const hearing = _case.hearings && _case.hearings.length > 0 ? _case.hearings[0] : null

  return { _case, task, hearing }
}

module.exports = { getTaskDetail }
