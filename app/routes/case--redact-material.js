const path = require('path')
const fs = require('fs')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Common document words to exclude from name detection
const NOT_NAMES = new Set([
  'The', 'This', 'That', 'These', 'Those', 'There', 'Their', 'They',
  'Date', 'Page', 'Name', 'Address', 'Statement', 'Court', 'Case',
  'Criminal', 'Crown', 'Prosecution', 'Service', 'National', 'Evidence',
  'Police', 'Witness', 'Defendant', 'Complainant', 'Officer', 'Judge',
  'Section', 'Act', 'Rules', 'Procedure', 'Justice', 'Version', 'Copy',
  'Form', 'File', 'Ref', 'Reference', 'Number', 'URN', 'With',
  'When', 'Where', 'What', 'Which', 'While', 'Then', 'From', 'Into',
  'Over', 'After', 'Before', 'About', 'Around', 'Under', 'During',
  'Social', 'Services', 'House', 'Street', 'Road', 'Lane', 'Avenue',
  'January', 'February', 'March', 'April', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Restricted', 'Complete', 'Signature', 'Occupation', 'Mother', 'Father',
  'Also', 'Because', 'However', 'Although', 'Always', 'Often', 'Never',
  'Could', 'Would', 'Should', 'Have', 'Been', 'Were', 'Being', 'Does',
  'Yes', 'Home', 'Telephone', 'Victim', 'Personal', 'Other', 'Further',
  'Having', 'Asked', 'Looking', 'Going', 'Telling', 'Come', 'Back',
  'Time', 'Right', 'Good', 'Only', 'Both', 'Just', 'Very', 'More',
  'Some', 'Such', 'Same', 'Each', 'Many', 'Most', 'Took', 'Said',
  'Know', 'Think', 'Want', 'Told', 'Felt', 'Left', 'Went', 'Came',
  'High', 'Long', 'Next', 'Last', 'First', 'Been', 'Like', 'Even',
  'Well', 'Then', 'Also', 'They', 'When', 'With', 'From',
  'True', 'Best', 'Only', 'Made', 'Used', 'Been', 'Will', 'Your',
  'Signed', 'Insert', 'Over', 'Given', 'Above', 'Below', 'Total',
  'Number', 'Details', 'Full', 'Email', 'Phone', 'Mobile', 'Work'
])

function classifyFallback (value) {
  const t = value.trim()
  if (t.includes('@')) return 'Email address'
  if (/^[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]$/i.test(t)) return 'NI number'
  if (/^\d{3}\s\d{3}\s\d{4}$/.test(t)) return 'NHS number'
  if (/^[A-Z]{2}\d{2}\s?[A-Z]{3}$/i.test(t)) return 'Vehicle registration'
  if (/^(\+44\s?|0)[\d\s\-]{9,12}$/.test(t)) return 'Phone number'
  if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(t)) return 'Date of birth'
  if (/^\d{2}-\d{2}-\d{2}$/.test(t)) return 'Bank details'
  if (/[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}/i.test(t)) return 'Address'
  if (/^\d+\s+[A-Za-z]/.test(t) || /\b(street|road|avenue|lane|drive|close|way|court|place|gardens?|crescent)\b/i.test(t)) return 'Address'
  if (/^[A-Z][A-Za-z]*(\s[A-Z][A-Za-z]*)*$/.test(t)) return 'Full name'
  return 'Fragment'
}

function extractPiiFromText (text) {
  if (!text) return []
  const findings = []
  let m

  // First names — capitalised words appearing 2+ times
  const counts = {}
  const words = text.match(/\b[A-Z][a-z]{2,14}\b/g) || []
  words.forEach(w => {
    if (!NOT_NAMES.has(w)) counts[w] = (counts[w] || 0) + 1
  })
  Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([value, instances]) => findings.push({ type: 'Full name', value, instances }))

  // Email addresses
  const emailRe = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g
  const emails = {}
  while ((m = emailRe.exec(text)) !== null) {
    emails[m[0].toLowerCase()] = (emails[m[0].toLowerCase()] || 0) + 1
  }
  Object.entries(emails).forEach(([value, instances]) => findings.push({ type: 'Email address', value, instances }))

  // Phone numbers — UK landline and mobile formats
  const phoneRe = /(\+44\s?|0)(\d[\s\-]?){9,10}\d/g
  const phones = {}
  while ((m = phoneRe.exec(text)) !== null) {
    const val = m[0].replace(/\s+/g, ' ').trim()
    phones[val] = (phones[val] || 0) + 1
  }
  Object.entries(phones).forEach(([value, instances]) => findings.push({ type: 'Phone number', value, instances }))

  // NI numbers — AB 12 34 56 C format
  const niRe = /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi
  const niNums = {}
  while ((m = niRe.exec(text)) !== null) {
    const val = m[0].toUpperCase().replace(/\s+/g, ' ').trim()
    niNums[val] = (niNums[val] || 0) + 1
  }
  Object.entries(niNums).forEach(([value, instances]) => findings.push({ type: 'NI number', value, instances }))

  // NHS numbers — xxx xxx xxxx (10 digits)
  const nhsRe = /\b\d{3}\s\d{3}\s\d{4}\b/g
  const nhsNums = {}
  while ((m = nhsRe.exec(text)) !== null) {
    nhsNums[m[0]] = (nhsNums[m[0]] || 0) + 1
  }
  Object.entries(nhsNums).forEach(([value, instances]) => findings.push({ type: 'NHS number', value, instances }))

  // Vehicle registrations — UK post-2001 format (AB12 ABC)
  const vehicleRe = /\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/g
  const vehicles = {}
  while ((m = vehicleRe.exec(text)) !== null) {
    const val = m[0].toUpperCase()
    vehicles[val] = (vehicles[val] || 0) + 1
  }
  Object.entries(vehicles).forEach(([value, instances]) => findings.push({ type: 'Vehicle registration', value, instances }))

  // Dates of birth — dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
  const dobRe = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g
  const dobs = {}
  while ((m = dobRe.exec(text)) !== null) {
    dobs[m[0]] = (dobs[m[0]] || 0) + 1
  }
  Object.entries(dobs).forEach(([value, instances]) => findings.push({ type: 'Date of birth', value, instances }))

  // Bank details — sort codes (12-34-56)
  const sortRe = /\b\d{2}-\d{2}-\d{2}\b/g
  const sortCodes = {}
  while ((m = sortRe.exec(text)) !== null) {
    sortCodes[m[0]] = (sortCodes[m[0]] || 0) + 1
  }
  Object.entries(sortCodes).forEach(([value, instances]) => findings.push({ type: 'Bank details', value, instances }))

  // Postcodes — as a proxy for addresses
  const postcodeRe = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/gi
  const postcodes = {}
  while ((m = postcodeRe.exec(text)) !== null) {
    const val = m[0].toUpperCase()
    postcodes[val] = (postcodes[val] || 0) + 1
  }
  Object.entries(postcodes).forEach(([value, instances]) => findings.push({ type: 'Address', value, instances }))

  return findings
}

async function scanForPii (text) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return extractPiiFromText(text)

  try {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content:
          'You are a legal document redaction scanner. Find all sensitive personal information in the text below.\n' +
          'Return ONLY a JSON array with no other text. Each item: { "type": string, "value": string, "instances": number }\n\n' +
          'Use exactly these type labels:\n' +
          '- "Full name": any individual\'s name, whether first name only, surname only, or both together\n' +
          '- "Email address": any email address\n' +
          '- "Address": street addresses, full or partial\n' +
          '- "Phone number": any telephone number\n' +
          '- "Date of birth": dates of birth\n' +
          '- "Vehicle registration": vehicle registration numbers\n' +
          '- "NI number": National Insurance numbers\n' +
          '- "NHS number": NHS numbers\n' +
          '- "Bank details": sort codes or bank account numbers\n' +
          '- "Occupation": job titles or professions tied to an individual\n' +
          '- "Location": towns, cities, named venues or landmarks\n' +
          '- "Relationship to others": descriptions of relationships between people\n' +
          '- "Previous convictions": references to prior offences or convictions\n\n' +
          'Rules:\n' +
          '- Count exact occurrences of each value (case-insensitive)\n' +
          '- Do not duplicate values across types\n' +
          '- Omit generic words and organisation names unless directly identifying\n\n' +
          'Text:\n' +
          text.slice(0, 8000)
      }]
    })
    return JSON.parse(message.content[0].text)
  } catch (e) {
    return extractPiiFromText(text)
  }
}

module.exports = router => {

  // ------------------------------------------------------------------
  // SCAN
  // GET /cases/:caseId/material/redact/scan
  router.get('/cases/:caseId/material/redact/scan', async (req, res) => {
    const { url, title, itemId } = req.query
    let text = ''

    if (url) {
      try {
        const pdfParse = require('pdf-parse')
        const relativePath = url.replace(/^\/public\//, '')
        const diskPath = path.join(__dirname, '..', 'assets', relativePath)
        const buffer = fs.readFileSync(diskPath)
        const parsed = await pdfParse(buffer)
        text = parsed.text || ''
      } catch (e) {
        // fall through — extractNamesFromText handles empty string
      }
    }

    const findings = await scanForPii(text)
    req.session.data.redactScan = { url, title, itemId, findings }
    res.redirect(`/cases/${req.params.caseId}/material/redact/review`)
  })


  // ------------------------------------------------------------------
  // CLASSIFY
  // POST /cases/:caseId/material/redact/classify
  router.post('/cases/:caseId/material/redact/classify', async (req, res) => {
    const value = (req.body.value || '').trim()
    if (!value) return res.json({ type: 'Fragment' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return res.json({ type: classifyFallback(value) })

    try {
      const Anthropic = require('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey })
      const message = await client.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 64,
        messages: [{
          role: 'user',
          content:
            'Classify this text from a legal document as exactly one of: "Full name", "Email address", "Address", "Phone number", "Date of birth", "Vehicle registration", "NI number", "NHS number", "Bank details", "Occupation", "Location", "Relationship to others", "Previous convictions", "Fragment".\n' +
            'Return ONLY a JSON object, e.g. {"type":"Full name"}. No other text.\n' +
            'Full name = any individual\'s name (first name only, surname only, or both). Location = town, city, or named place. Occupation = job title or profession. Relationship to others = how people are connected. Previous convictions = prior offences. Fragment = unrecognisable or partial text.\n\n' +
            'Text: ' + JSON.stringify(value)
        }]
      })
      const parsed = JSON.parse(message.content[0].text)
      return res.json({ type: parsed.type || 'Fragment' })
    } catch (e) {
      return res.json({ type: classifyFallback(value) })
    }
  })

  // ------------------------------------------------------------------
  // REVIEW
  // GET /cases/:caseId/material/redact/review
  router.get('/cases/:caseId/material/redact/review', async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId, 10) }
    })
    if (!_case) return res.status(404).render('not-found')

    const scan       = req.session.data.redactScan  || {}
    const redactCheck = req.session.data.redactCheck || null
    const pdfViewerUrl = scan.url
      ? '/public/pdfjs/web/viewer.html?file=' + encodeURIComponent(scan.url)
      : ''
    return res.render('v2/cases/material/redact/index', { _case, scan, pdfViewerUrl, redactCheck })
  })


  // ------------------------------------------------------------------
  // CHECK
  // POST /cases/:caseId/material/redact/check
  router.post('/cases/:caseId/material/redact/check', (req, res) => {
    const confirmed      = [].concat(req.body.confirmedRedactions || []).filter(v => v !== '_unchecked')
    const instanceCount  = req.body.instanceCount  || {}
    const acceptedCount  = req.body.acceptedCount  || {}
    const rejectedCount  = req.body.rejectedCount  || {}
    const mode           = req.body.mode || 'assisted'
    const areaRedactions = req.body.areaRedactions || []

    req.session.data.redactCheck = { confirmed, instanceCount, acceptedCount, rejectedCount, mode, areaRedactions }
    res.redirect(`/cases/${req.params.caseId}/material/redact/preview`)
  })

  // GET /cases/:caseId/material/redact/check
  router.get('/cases/:caseId/material/redact/check', async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId, 10) }
    })
    if (!_case) return res.status(404).render('not-found')

    const scan = req.session.data.redactScan || {}
    const check = req.session.data.redactCheck || { confirmed: [], instanceCount: {}, mode: 'assisted' }
    return res.render('v2/cases/material/redact/check', { _case, scan, check })
  })


  // ------------------------------------------------------------------
  // PREVIEW
  // GET /cases/:caseId/material/redact/preview
  router.get('/cases/:caseId/material/redact/preview', async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId, 10) }
    })
    if (!_case) return res.status(404).render('not-found')

    const scan  = req.session.data.redactScan  || {}
    const check = req.session.data.redactCheck || { confirmed: [], instanceCount: {}, mode: 'assisted' }
    const pdfViewerUrl = scan.url
      ? '/public/pdfjs/web/viewer.html?file=' + encodeURIComponent(scan.url)
      : ''
    return res.render('v2/cases/material/redact/preview', { _case, scan, check, pdfViewerUrl })
  })

  // ------------------------------------------------------------------
  // CONFIRM
  // POST /cases/:caseId/material/redact/confirm
  router.post('/cases/:caseId/material/redact/confirm', (req, res) => {
    const scan  = req.session.data.redactScan  || {}
    const check = req.session.data.redactCheck || { confirmed: [] }
    const confirmed = check.confirmed

    const materials = req.session.data.caseMaterials || {}
    if (scan.itemId && Array.isArray(materials.Material)) {
      materials.Material = materials.Material.map(m =>
        String(m.ItemId) === String(scan.itemId)
          ? { ...m, RedactionStatus: 'Redacted', RedactedCount: confirmed.length }
          : m
      )
      req.session.data.caseMaterials = materials
    }

    delete req.session.data.redactScan
    delete req.session.data.redactCheck

    req.session.data.successBanner = {
      text: `${confirmed.length} redaction${confirmed.length !== 1 ? 's' : ''} confirmed for "${scan.title || 'document'}"`
    }

    res.redirect(`/cases/${req.params.caseId}/material`)
  })
}
