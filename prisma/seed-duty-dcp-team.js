// Additive-only script — adds a real "Duty DCP" Team so the reassign-to-team
// flow (app/routes/task--reassign.js) has a concrete target matching the
// "OD can assign to DCP or Duty DCP" step in the new CW/OD/CM -> DCP flow
// (DCP structured data new.pdf). Attached to Wessex CCU (case 2001's unit)
// so it shows up by default in the team search for that case; selecting
// "All units" surfaces it for any other case's reassign flow too.
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

  // Looked up by name rather than a hardcoded unit id — seed.js's unit
  // list is a fixed array so the id is deterministic in practice, but this
  // is self-verifying regardless.
  const wessexCcu = await prisma.unit.findFirst({ where: { name: "Wessex CCU" } });
  if (!wessexCcu) {
    console.log('Skipping "Duty DCP" — no "Wessex CCU" unit found to attach it to');
    return;
  }

  const team = await prisma.team.create({
    data: { name: "Duty DCP", unitId: wessexCcu.id, isStandard: true }
  });
  console.log(`Created "Duty DCP" team — id ${team.id} (unit ${wessexCcu.id})`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
