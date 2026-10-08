// Additive-only script — assigns a deliberate mix of assigned/unassigned
// PCD-appeal tasks across BOTH tables, so Caseworkers/Charge Managers have
// unassigned rows to reassign and DCPs have assigned rows to start, on
// every fresh deploy. Runs last in the generate-data chain (after
// seed-pcd-appeal-tasks.js/seed-pcd-appeal-backfill.js create the tasks,
// and seed-duty-dcp-team.js creates the team this assigns one row to).
//
// Looks everything up dynamically (by case+name, by email, by team name)
// rather than hardcoding ids — seed.js's case/defendant/charge content is
// random with no fixed RNG seed, but which case gets which task name is
// fixed by seed-pcd-appeal-tasks.js/seed-pcd-appeal-backfill.js, so caseId
// + taskName reliably identifies the right row on any fresh reseed.
//
// Run once: node prisma/seed-pcd-appeal-demo-mix.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const sarah = await prisma.user.findUnique({ where: { email: "sarah.whitlock@cps.gov.uk" } });
  const david = await prisma.user.findUnique({ where: { email: "david.okoye@cps.gov.uk" } });
  const dutyDcp = await prisma.team.findFirst({ where: { name: "Duty DCP" } });

  if (!sarah || !david || !dutyDcp) {
    console.log("Skipping demo mix — seed-dcp-users.js and/or seed-duty-dcp-team.js haven't run yet");
    return;
  }

  const assignments = [
    // Task list (Review PCD appeal) — 4 assigned, 4 left unassigned (cases 14, 10, 12, 15)
    { caseId: 2002, taskName: "Review PCD appeal", assignedToUserId: sarah.id },
    // Added by seed-pcd-appeal-green-spread.js
    { caseId: 9, taskName: "Review PCD appeal", assignedToUserId: sarah.id },
    { caseId: 11, taskName: "Review PCD appeal", assignedToUserId: david.id },
    { caseId: 13, taskName: "Review PCD appeal", assignedToTeamId: dutyDcp.id },
    // Priority charging (Review priority PCD appeal) — 4 assigned, 4 left unassigned (cases 2, 4, 6, 8)
    { caseId: 2001, taskName: "Review priority PCD appeal", assignedToUserId: david.id },
    { caseId: 3, taskName: "Review priority PCD appeal", assignedToUserId: sarah.id },
    { caseId: 5, taskName: "Review priority PCD appeal", assignedToUserId: david.id },
    { caseId: 7, taskName: "Review priority PCD appeal", assignedToTeamId: dutyDcp.id }
  ];

  for (const a of assignments) {
    const task = await prisma.task.findFirst({ where: { caseId: a.caseId, name: a.taskName } });
    if (!task) {
      console.log(`Skipping case ${a.caseId} — no "${a.taskName}" task found`);
      continue;
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        assignedToUserId: a.assignedToUserId || null,
        assignedToTeamId: a.assignedToTeamId || null
      }
    });
    console.log(`Assigned case ${a.caseId} (task ${task.id})`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
