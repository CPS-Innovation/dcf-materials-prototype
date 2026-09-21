// Shared helper for the PCD-appeal seed scripts (seed-pcd-appeal-content.js,
// seed-pcd-appeal-backfill.js). prisma/seed.js generates case/defendant/
// charge content with faker and no fixed RNG seed, so a fresh reseed gives
// every case different random defendants and charges — these scripts can't
// hardcode which defendant/charge belongs to a given case id. This picks
// the lead (first) defendant and their charges dynamically, at seed time,
// mirroring app/helpers/pcdAppeal.js's getLeadDefendant on the display side.
//
// Returns null if the case has no defendants at all (shouldn't happen given
// prisma/seed.js always assigns 1-3 defendants per case, but guarded
// anyway). Falls back to the first defendant who actually has a charge if
// the lead defendant has none, so the appeal still gets a real charge to
// point at wherever possible.
async function getLeadDefendantWithCharges(prisma, caseId) {
  const _case = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      defendants: {
        orderBy: { id: 'asc' },
        include: { charges: { orderBy: { id: 'asc' } } }
      }
    }
  })

  if (!_case || !_case.defendants.length) return null

  const withCharges = _case.defendants.find(d => d.charges.length > 0)
  return withCharges || _case.defendants[0]
}

module.exports = { getLeadDefendantWithCharges }
