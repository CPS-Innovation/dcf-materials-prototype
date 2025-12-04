// app/routes/tasks.js (for example)

const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { getTaskSeverity } = require('../helpers/taskState')
const { addTimeLimitDates } = require('../helpers/timeLimit')

module.exports = router => {
  router.get('/tasks', async (req, res, next) => {
    try {
      const user = req.session.data?.user

      if (!user) {
        // not signed in – bounce back to sign-in
        return res.redirect('/account/sign-in')
      }

      const userUnitIds = (user.units || []).map(u => u.unitId)

      const tasks = await prisma.task.findMany({
        where: {
          completedDate: null,
          OR: [
            { assignedToUserId: user.id },
            { assignedToTeamId: { in: userUnitIds } }
          ]
        },
        orderBy: [
          { reminderDate: 'asc' },
          { dueDate: 'asc' }
        ],
        include: {
          case: {
            include: {
              defendants: {
                include: {
                  charges: true,
                  defenceLawyer: true
                }
              },
              unit: true,
              hearings: {
                orderBy: { startDate: 'asc' }
              }
            }
          },
          assignedToUser: true,
          assignedToTeam: {
            include: { unit: true }
          },
          notes: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      })

      // Add time-limit + severity info per task
      tasks.forEach(task => {
        if (task.case) {
          addTimeLimitDates(task.case)
        }
        task.severity = getTaskSeverity(task)
      })

      const totalTasks = tasks.length

      res.render('tasks/index', {
        tasks,
        totalTasks
      })
    } catch (err) {
      next(err)
    }
  })
}
