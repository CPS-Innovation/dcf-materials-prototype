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
// tagged redactions bold, edited-in wording italic — computed fresh from
// just two always-current fields (factualSummary, factualSummaryOriginal)
// rather than a separately stored HTML snapshot, so there's nothing that
// can go stale when a redaction and an edit happen in either order. Diffs
// the pristine original against the current text: anything "removed"
// (deleted, or replaced by a redaction label) is omitted, since it's not
// part of the current version; anything "added" is a redaction label
// (self-describing — matches "[Redacted <type>]" — bolded) or otherwise a
// genuine edit (italicised).
addFilter('redactionEditDisplay', (current, original) => {
  if (!current) return ''

  var bodyHtml
  if (!original) {
    bodyHtml = escapeHtml(current)
  } else {
    bodyHtml = diffWords(original, current)
      .filter(function (part) { return !part.removed })
      .map(function (part) {
        var escaped = escapeHtml(part.value)
        if (!part.added) return escaped
        return /\[Redacted [^\]]+\]/.test(part.value)
          ? '<span class="dcf-redacted-text">' + escaped + '</span>'
          : '<em class="dcf-edited-text">' + escaped + '</em>'
      })
      .join('')
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