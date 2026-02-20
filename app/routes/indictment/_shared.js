// app/routes/indictment/_shared.js
const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// JSON sources (controlled narrative)
const countsData = require('../../data/case-indictments.json')
const chargeLibrary = require('../../data/charge-library.json')

// Lookups
const countsByCaseId = Object.fromEntries(countsData.map(c => [String(c.id), c]))
const libraryByCode = Object.fromEntries(chargeLibrary.map(c => [String(c.chargeCode), c]))

// ----------------------------
// Helpers
// ----------------------------
const parseCaseId = (req, res) => {
  const caseId = parseInt(req.params.caseId, 10)
  if (Number.isNaN(caseId)) {
    res.status(400).send('Invalid case id')
    return null
  }
  return caseId
}

// Accept both:
//  - req.body.defendantOrder = { "123": "2" }   (extended: true)
//  - req.body["defendantOrder[123]"] = "2"     (extended: false)
function extractBracketMap(body = {}, prefix = '') {
  const map = {}

  // Case 1: already parsed as object (but NOT an array)
  if (body && typeof body[prefix] === 'object' && body[prefix] !== null && !Array.isArray(body[prefix])) {
    for (const [k, v] of Object.entries(body[prefix])) {
      const key = String(k).replace(/^id-/, '')
      map[key] = String(v ?? '')
    }
  }

  // Case 2: bracket keys at top level
  const re = new RegExp(`^${prefix}\\[(.+)\\]$`)
  for (const [k, v] of Object.entries(body || {})) {
    const m = String(k).match(re)
    if (!m) continue
    const key = String(m[1]).replace(/^id-/, '')
    map[key] = String(v ?? '')
  }

  return map
}

// Only allow internal safe return paths
const safeReturnTo = (value) => {
  const v = String(value || '')
  if (!v) return ''
  if (!v.startsWith('/')) return ''
  // extra safety: keep it within this app's case routes
  if (!v.startsWith('/cases/')) return ''
  return v.startsWith('/') ? v : ''
}

async function fetchCase(caseId) {
  return prisma.case.findUnique({
    where: { id: caseId },
    include: {
      unit: true,
      defendants: { include: { defenceLawyer: true, charges: true } },
      witnesses: { include: { statements: true } },
      victims: true,
      hearings: true,
      location: true
    }
  })
}

// Always return a narrative case, even if caseId isn't 1–5
function getCountsCaseFor(caseId) {
  const direct = countsByCaseId[String(caseId)]
  if (direct) return direct
  const idx = Math.abs(Number(caseId)) % countsData.length
  return countsData[idx]
}

// Build charge options from Prisma (deduped by chargeCode + description)
function buildChargeOptionsFromPrismaCase(_case) {
  const seen = new Set()
  const options = []

  for (const d of (_case.defendants || [])) {
    for (const ch of (d.charges || [])) {
      const key = `${ch.chargeCode}||${ch.description}`
      if (seen.has(key)) continue
      seen.add(key)

      options.push({
        chargeCode: ch.chargeCode,
        description: ch.description
      })
    }
  }

  options.sort((a, b) => (a.chargeCode || '').localeCompare(b.chargeCode || ''))
  return options
}

// Build charge options from narrative JSON (NO dedupe)
// Enrich from chargeLibrary via chargeCode.
function buildChargeOptionsFromCountsCase(countsCase) {
  const options = []

  for (const pc of (countsCase.policeCharges || [])) {
    const lib = pc.chargeCode ? libraryByCode[String(pc.chargeCode)] : null

    options.push({
      policeChargeId: pc.policeChargeId,
      chargeCode: pc.chargeCode || null,
      label: pc.label || '',
      policeParticulars: pc.policeParticulars || '',
      policeCharge: lib?.policeCharge || null,       // ← add this line
      statementOfOffence: lib?.statementOfOffence || null,
      statute: lib?.statute || null,
      precedents: lib?.precedents || [],
      particularsStarter: lib?.templates?.particularsStarter || null
    })
  }

  return options
}

// ============================================================
// SEARCH HELPERS (precedent)
// ============================================================

function normaliseQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

// Build a searchable text blob for one option
function buildSearchHaystack(option) {
  const statuteText =
    option.statute
      ? [
          option.statute.act,
          option.statute.section
        ].filter(Boolean).join(' ')
      : ''

  return [
    option.chargeCode,
    option.ippCode,
    option.label,
    option.offence,
    option.statementOfOffence,
    statuteText
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

// Search within case (narrative/prisma enriched)
function searchPrecedentsWithinCase(chargeOptions, keywords) {
  const q = normaliseQuery(keywords)
  if (!q) return []

  const results = []

  for (const option of (chargeOptions || [])) {
    const haystack = buildSearchHaystack(option)

    // Allow prefix matches: "threat" should match "threats", "threatening"
    const words = haystack.split(' ')
    const matches =
      haystack.includes(q) ||
      words.some(w => w.startsWith(q))

    if (!matches) continue

    const statuteName =
      typeof option.statute === 'string'
        ? option.statute
        : (option.statute && (option.statute.act || option.statute.name || option.statute.title)) || ''

    results.push({
      id: option.policeChargeId,
      ippCode: option.chargeCode || '',
      statuteName,
      offence: option.label || option.statementOfOffence || ''
    })
  }

  return results
}

// Search across library JSON
function searchChargeLibrary(chargeLibrary, keywords) {
  const q = normaliseQuery(keywords)
  if (!q) return []

  const results = []

  for (const entry of chargeLibrary) {
    const haystack = buildSearchHaystack(entry)

    const words = haystack.split(' ')
    const matches =
      haystack.includes(q) ||
      words.some(w => w.startsWith(q))

    if (!matches) continue

    results.push({
      id: entry.chargeCode,          // stable ID
      ippCode: entry.chargeCode || '',
      statuteName: entry?.statute?.act || '',
      offence: entry.label || entry.statementOfOffence || ''
    })
  }

  return results
}

module.exports = {
  _,
  prisma,
  countsData,
  chargeLibrary,
  countsByCaseId,
  libraryByCode,
  parseCaseId,
  extractBracketMap,
  safeReturnTo,
  fetchCase,
  getCountsCaseFor,
  buildChargeOptionsFromPrismaCase,
  buildChargeOptionsFromCountsCase,
  normaliseQuery,
  buildSearchHaystack,
  searchPrecedentsWithinCase,
  searchChargeLibrary
}
