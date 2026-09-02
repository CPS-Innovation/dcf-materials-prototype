// filters.js
// For guidance on how to create filters see:
// https://prototype-kit.service.gov.uk/docs/filters
//

const govukPrototypeKit = require('govuk-prototype-kit')
const addFilter = govukPrototypeKit.views.addFilter
const { diffWords } = require('diff')

function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// A short run of pure punctuation/whitespace — a comma, a stray quote
// mark — that diffWords can mistake for a coincidental match in the
// middle of a genuinely redacted/edited span (see
// isAbsorbedByEarlierRedaction below for why that matters).
const GLUE_PATTERN = /^[\s.,:;'"‘’“”-]{1,5}$/

// diffWords tokenises word-by-word, so one real redaction/edit (removed
// text swapped for something else) can get fragmented into multiple diff
// hunks whenever a short run of punctuation right next to it also happens
// to occur near the replacement text — diffWords treats that as a
// coincidental match rather than part of the redacted span, and splits
// the change either side of it (confirmed against a real committed
// factualSummary/factualSummaryOriginal pair — see git history for the
// worked example). This asks: is `diffed[index]` a removed chunk sitting
// directly after such a glue gap that itself directly follows an added
// chunk? If so, it's the redaction's stranded second half, and the render
// loop below should suppress it exactly like a directly-paired
// removed/added swap — the glue itself keeps rendering normally in
// between (merging its text into the removed chunk instead, an earlier
// version of this fix, silently dropped visible punctuation from output).
function isAbsorbedByEarlierRedaction (diffed, index) {
  var prev = diffed[index - 1]
  var prevPrev = diffed[index - 2]

  return !!(
    prev && !prev.removed && !prev.added && GLUE_PATTERN.test(prev.value) &&
    prevPrev && prevPrev.added
  )
}

function boldRedactionLabels (text) {
  return escapeHtml(text).replace(/\[Redacted [^\]]+\]/g, function (match) {
    return '<span class="dcf-redacted-text">' + match + '</span>'
  })
}

// Renders a case's factual summary the way it should currently read.
// Redaction labels ("[Redacted <type>]") are baked directly into
// factualSummary as literal text at commit time (see
// buildRedactedPlainText in case--outline.js), so they're always found and
// bolded regardless of whether `original` is passed.
// `original` (factualSummaryOriginal) is optional and, by default, not
// passed by outline-panels.njk — edit-type highlighting (added/replaced/
// deleted marks, reconstructed by diffing against it) is an enhancement,
// not MVP, so it's off unless the caller explicitly opts in (currently:
// the summary card's ?showAllVariants=1 exploratory view, to demonstrate
// what the v5 "freezes baseline" edit variant is for). Without it, this
// only bolds redaction labels over the plain current text.
addFilter('redactionEditDisplay', (current, original) => {
  if (!current) return ''

  var bodyHtml
  if (!original) {
    bodyHtml = boldRedactionLabels(current)
  } else {
    var diffed = diffWords(original, current)
    var segments = []

    diffed.forEach(function (part, index) {
      var escaped = escapeHtml(part.value)

      if (part.removed) {
        var next = diffed[index + 1]
        if (next && next.added) return // only the new text shows for a swap/redaction
        if (isAbsorbedByEarlierRedaction(diffed, index)) return // stranded second half of the same swap/redaction, split off by a coincidental glue match — see above

        segments.push(
          '<span class="govuk-visually-hidden">Removed: </span>' +
          '<s class="dcf-highlight dcf-highlight--edit-deleted">' + escaped + '</s>'
        )
        return
      }

      if (!part.added) {
        segments.push(escaped)
        return
      }

      if (/\[Redacted [^\]]+\]/.test(part.value)) {
        segments.push('<span class="dcf-redacted-text">' + escaped + '</span>')
        return
      }

      var isReplaced = index > 0 && diffed[index - 1].removed
      var highlightClass = isReplaced ? 'dcf-highlight--edit-replaced' : 'dcf-highlight--edit-added'
      segments.push('<mark class="dcf-highlight ' + highlightClass + '">' + escaped + '</mark>')
    })

    bodyHtml = segments.join('')
  }

  return bodyHtml
    .split('\n\n')
    .map(function (paragraph) { return '<p class="govuk-body">' + paragraph + '</p>' })
    .join('\n')
})

// Add your filters here
addFilter('priorityTagClass', status => {
  switch(status) {
    case 'High priority':
      return 'govuk-tag--red'
		case 'Medium priority':
      return 'govuk-tag--yellow'
    case 'Low priority':
      return 'govuk-tag--green'
  }
})

addFilter('severityTagClass', severity => {
  switch(severity) {
    case 'Critically overdue':
      return 'govuk-tag--red'
    case 'Overdue':
      return 'govuk-tag--orange'
    case 'Due soon':
      return 'govuk-tag--yellow'
    case 'Not due yet':
      return 'govuk-tag--blue'
    default:
      return ''
  }
})

addFilter('directionStatusTagClass', status => {
  switch(status) {
    case 'Overdue':
      return 'govuk-tag--red'
    case 'Due today':
      return 'govuk-tag--orange'
    default:
      return ''
  }
})

addFilter('capitalize', str => {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
})

addFilter('isoDateString', date => {
  return date.toISOString()
})

addFilter('govukDate', value => {
  if (!value) return ''
  let d
  if (typeof value === 'string' && value.includes('/')) {
    const [datePart] = value.split(' ')
    const [day, month, year] = datePart.split('/').map(Number)
    d = new Date(year, month - 1, day)
  } else {
    d = (value instanceof Date) ? value : new Date(value)
  }
  if (Number.isNaN(d.getTime())) return ''

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(d)
})

addFilter('govukDateTime', value => {
  if (!value) return ''
  const d = (value instanceof Date) ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''

  const datePart = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(d)

  const hours = d.getHours()
  const mins = d.getMinutes()

  // Don’t show time if it’s midnight
  if (hours === 0 && mins === 0) return datePart

  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d)

  return `${datePart} at ${timePart}`
})


addFilter('isoDateString', value => {
  if (!value) return ''
  const d = (value instanceof Date) ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
})


// Replacement for the missing govukDateTime filter
// Outputs e.g. "11 February 2026 at 14:30" or just "11 February 2026" if midnight
addFilter('govukDateTime', value => {
  if (!value) return ''
  const d = (value instanceof Date) ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''

  const datePart = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(d)

  const hours = d.getHours()
  const mins = d.getMinutes()

  // If time is exactly midnight, don't show time
  if (hours === 0 && mins === 0) {
    return datePart
  }

  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d)

  return `${datePart} at ${timePart}`
})


addFilter('formatNumber', number => {
  return Number(number).toLocaleString('en-GB')
})

addFilter('age', dateOfBirth => {
  if (!dateOfBirth) return null
  const dob = (dateOfBirth instanceof Date) ? dateOfBirth : new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const hadBirthdayThisYear =
    (today.getMonth() > dob.getMonth()) ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate())
  if (!hadBirthdayThisYear) age--
  return age
})

addFilter('daysUntil', date => {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const targetDate = new Date(date)
  targetDate.setHours(0, 0, 0, 0)
  const diffTime = targetDate - now
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return 'overdue'
  } else if (diffDays === 0) {
    return 'today'
  } else if (diffDays === 1) {
    return 'tomorrow'
  }
  return `${diffDays} days`
})