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

function extractNamesFromText (text) {
  if (!text) return []
  const counts = {}
  const words = text.match(/\b[A-Z][a-z]{2,14}\b/g) || []
  words.forEach(w => {
    if (!NOT_NAMES.has(w)) counts[w] = (counts[w] || 0) + 1
  })
  return Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, instances]) => ({ type: 'First name', value, instances }))
}

async function scanForPii (text) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return extractNamesFromText(text)

  try {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content:
          'You are a legal document PII scanner. Find all first names (given names) of real people in the text below. ' +
          'Return ONLY a JSON array with no other text. Each item: { "type": "First name", "value": string, "instances": number }. ' +
          'Count exact occurrences of each first name. Exclude job titles, place names, and common words.\n\nText:\n' +
          text.slice(0, 8000)
      }]
    })
    return JSON.parse(message.content[0].text)
  } catch (e) {
    return extractNamesFromText(text)
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
  // REVIEW
  // GET /cases/:caseId/material/redact/review
  router.get('/cases/:caseId/material/redact/review', async (req, res) => {
    const _case = await prisma.case.findUnique({
      where: { id: parseInt(req.params.caseId, 10) }
    })
    if (!_case) return res.status(404).render('not-found')

    const scan = req.session.data.redactScan || {}
    const pdfViewerUrl = scan.url
      ? '/public/pdfjs/web/viewer.html?file=' + encodeURIComponent(scan.url)
      : ''
    return res.render('v2/cases/material/redact-review', { _case, scan, pdfViewerUrl })
  })


  // ------------------------------------------------------------------
  // CONFIRM
  // POST /cases/:caseId/material/redact/confirm
  router.post('/cases/:caseId/material/redact/confirm', (req, res) => {
    const confirmed = [].concat(req.body.confirmedRedactions || [])
    const scan = req.session.data.redactScan || {}

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

    req.session.data.successBanner = {
      text: `${confirmed.length} redaction${confirmed.length !== 1 ? 's' : ''} confirmed for "${scan.title || 'document'}"`
    }

    res.redirect(`/cases/${req.params.caseId}/material`)
  })
}
