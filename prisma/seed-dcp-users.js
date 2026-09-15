// Additive-only script — adds a couple of real Users with
// role: "District Crown Prosecutor" for the Reassign task journey's
// Role search (see reassign-task-redesign-brief.md). Doesn't touch
// existing data, unlike seed.js which regenerates everything from
// scratch (that would blow away case IDs 2001-2008 this prototype
// depends on for the PCD appeal work).
//
// Run once: node prisma/seed-dcp-users.js
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new PrismaClient();

async function main() {
  const dcpUsers = [
    {
      firstName: "Sarah",
      lastName: "Whitlock",
      email: "sarah.whitlock@cps.gov.uk",
      unitId: 11 // South Yorkshire Magistrates Court — case 2002's unit
    },
    {
      firstName: "David",
      lastName: "Okoye",
      email: "david.okoye@cps.gov.uk",
      unitId: 8 // North Yorkshire Crown Court — case 2001's unit
    }
  ]

  for (const dcp of dcpUsers) {
    const existing = await prisma.user.findUnique({ where: { email: dcp.email } })
    if (existing) {
      console.log(`Skipping ${dcp.email} — already exists`)
      continue
    }

    await prisma.user.create({
      data: {
        firstName: dcp.firstName,
        lastName: dcp.lastName,
        email: dcp.email,
        password: bcrypt.hashSync("password123", 10),
        role: "District Crown Prosecutor",
        units: {
          create: { unitId: dcp.unitId }
        }
      }
    })
    console.log(`Created ${dcp.firstName} ${dcp.lastName} (${dcp.email})`)
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
