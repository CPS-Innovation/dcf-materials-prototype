// Additive-only script — adds a real Task row for each of the two PCD
// appeal mock cases (app/data/pcd-appeal-cases.js, cases 2001/2002), so
// pages that need a real taskId (e.g. cases/tasks/show.html) have
// something to query against. Doesn't touch existing data — see the note
// in pcd-appeal-cases.js about the appeal content itself staying mocked
// until there's a real Prisma model for it.
//
// Run once: node prisma/seed-pcd-appeal-tasks.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const tasks = [
    {
      name: "PCD Appeal (Red)",
      caseId: 2001,
      reminderDate: new Date("2026-09-09T22:00:00.000Z"),
      dueDate: new Date("2026-09-10T22:00:00.000Z"), // PACE clock expiry — pcd-appeal-cases.js caseId 2001
      escalationDate: new Date("2026-09-11T22:00:00.000Z"),
      isUrgent: true,
      urgentNote: "PACE clock overdue — appeal requires immediate review.",
      assignedToUserId: 559 // David Okoye — seeded DCP user (seed-dcp-users.js)
    },
    {
      name: "PCD Appeal (Green)",
      caseId: 2002,
      reminderDate: new Date("2026-11-15T23:59:59.999Z"),
      dueDate: new Date("2026-11-20T23:59:59.999Z"), // Statutory time limit — pcd-appeal-cases.js caseId 2002
      escalationDate: new Date("2026-11-23T23:59:59.999Z"),
      isUrgent: false,
      urgentNote: null,
      assignedToUserId: 558 // Sarah Whitlock — seeded DCP user (seed-dcp-users.js)
    }
  ]

  for (const task of tasks) {
    const existing = await prisma.task.findFirst({ where: { caseId: task.caseId, name: task.name } })
    if (existing) {
      console.log(`Skipping ${task.name} (case ${task.caseId}) — already exists`)
      continue
    }

    const created = await prisma.task.create({ data: task })
    console.log(`Created "${created.name}" (case ${created.caseId}) — task id ${created.id}`)
  }
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
