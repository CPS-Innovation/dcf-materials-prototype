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

// Renders a case's factual summary the way it should currently read —
// tagged redactions bold and bracketed, edited-in wording styled by edit
// type (colour + italic; deleted text also struck through, no bold) —
// computed fresh from just two always-current fields (factualSummary,
// factualSummaryOriginal) rather than a separately stored HTML snapshot,
// so there's nothing that can go stale when a redaction and an edit
// happen in either order. Diffs the pristine original against the current
// text:
// - any "removed" text that was directly replaced by something else
//   (new wording, or a redaction's "[Redacted <type>]" label) is never
//   shown — only the new text is, so a redaction's original stays hidden
//   and a wording swap doesn't clutter the summary with its old half.
// - a "removed" chunk with nothing replacing it — a genuine deletion — IS
//   shown, struck through via <s> with a visually-hidden "Removed: " cue
//   ahead of it — Scenario 3 from
//   https://www.webaxe.org/strikethrough-html-accessibility/, the only one
//   of the article's four tested approaches every screen reader passed
//   (plain <s>/<del> alone, or <s> with a CSS ::before/::after label, were
//   each inconsistent or confusing on at least one).
// - "added" text is a redaction label (self-describing — matches
//   "[Redacted <type>]" — bolded), otherwise Replaced (added text that
//   directly followed a removed chunk — i.e. a swap, not a fresh
//   insertion) or Added.
// Replaced/Added/Deleted use the same CSS classes as the edit CYA check
// screen's highlightSnippet, and the same classes the "Key" row on the
// factual summary card demonstrates (see outline-panels.njk), so all
// three stay visually consistent and self-explanatory.
addFilter('redactionEditDisplay', (current, original) => {
  if (!current) return ''

  var bodyHtml
  if (!original) {
    bodyHtml = escapeHtml(current)
  } else {
    var diffed = diffWords(original, current)
    var segments = []

    diffed.forEach(function (part, index) {
      var escaped = escapeHtml(part.value)

      if (part.removed) {
        var next = diffed[index + 1]
        if (next && next.added) return // only the new text shows for a swap/redaction

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