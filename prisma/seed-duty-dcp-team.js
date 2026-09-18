// Additive-only script — adds a real "Duty DCP" Team so the reassign-to-team
// flow (app/routes/task--reassign.js) has a concrete target matching the
// "OD can assign to DCP or Duty DCP" step in the new CW/OD/CM -> DCP flow
// (DCP structured data new.pdf). Attached to unit 5 (Wessex CCU, case
// 2001's unit) so it shows up by default in the team search for that case;
// selecting "All units" surfaces it for any other case's reassign flow too.
//
// Run once: node prisma/seed-duty-dcp-team.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.team.findFirst({ where: { name: "Duty DCP" } });
  if (existing) {
    console.log(`Skipping "Duty DCP" — already exists (team id ${existing.id})`);
    return;
  }

  const team = await prisma.team.create({
    data: { name: "Duty DCP", unitId: 5, isStandard: true }
  });
  console.log(`Created "Duty DCP" team — id ${team.id}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
