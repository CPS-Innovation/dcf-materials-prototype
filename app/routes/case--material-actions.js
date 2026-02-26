// app/routes/case--material-actions.js
//
// Purpose:
// A tiny “action resolver” layer that lets Material Viewer actions (ItemId-based)
// reuse the existing Disclosure assessment flows (row-id-based) without duplicating routes/templates.
//
// Usage (in server.js or wherever you mount routes):
//   require('./routes/case--material-actions')(router)
//
// Assumptions:
// - Your existing flows live under:
//     /cases/:caseId/disclosure/assess-non-sensitive/<item-* routes>
// - Your session rows live at:
//     req.session.data.disclosureNonSensitiveRows
// - Each row has r.id and some form of ItemId (r.ItemId or r.itemId or r.materialId)

const _ = require('lodash')

module.exports = router => {
  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------

  function findDisclosureRowIdByItemId(req, itemId) {
    if (!itemId) return null
    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const wanted = String(itemId).toLowerCase()

    const hit = rows.find(r => {
      const candidate = String(r?.ItemId || r?.itemId || r?.materialId || '').toLowerCase()
      return candidate && candidate === wanted
    })

    return hit ? String(hit.id) : null
  }

  function buildDefaultViewerReturnUrl(caseId, itemId) {
    const open = itemId ? `&openItemId=${encodeURIComponent(itemId)}` : ''
    return `/cases/${caseId}/material?tab=view-materials${open}`
  }

  // Map “material viewer” action ids -> existing disclosure item routes
  const MATERIAL_ACTION_TO_ROUTE = {
    'assess-disclosable': 'item-disclosable',
    'assess-disclosable-inspect': 'item-disclosable-by-inspection',
    'assess-not-disclosable': 'item-not-disclosable',
    'assess-clearly-not': 'item-clearly-not-disclosable',
    'assess-evidence': 'item-evidence',
    'request-updated-description': 'item-request-updated-description',
    'request-material': 'item-request-material',

    // Special-cased because it depends on sensitivityDisputed
    'dispute-sensitivity': '__SPECIAL__',

    // Optional / future (you can wire this later)
    'assess-unused': '__NOT_IMPLEMENTED__'
  }

  // ---------------------------------------------------------
  // Routes
  // ---------------------------------------------------------

  /**
   * Shared entrypoint: Material Viewer actions -> existing disclosure flows
   *
   * GET /cases/:caseId/disclosure/actions/:action
   *
   * Query params supported:
   * - itemId=MAT-02007   (preferred for viewer)
   * - id=123             (row id, optional if you want)
   * - returnUrl=/cases/... (optional; if not provided we default:
   *     - viewer return url if itemId present
   *     - disclosure table if not)
   *
   * Behaviour:
   * - Resolves ItemId -> disclosure row id
   * - Determines correct target route (e.g. dispute vs change dispute)
   * - Redirects to existing row-aware item-* route with id + returnUrl
   */
  router.get('/cases/:caseId/disclosure/actions/:action', (req, res) => {
    const caseId = parseInt(req.params.caseId, 10)
    if (Number.isNaN(caseId)) return res.status(400).send('Invalid case id')

    const action = String(req.params.action || '').trim()
    if (!action) return res.status(400).send('Missing action')

    // Seed a row into disclosureNoLongerRelevantRows from caseMaterials and redirect
    // to the given NLR sub-route. Returns the seeded row's id.
    function seedNlrRowAndRedirect(req, res, { caseId, itemId, targetPath, returnUrl }) {
      const caseMaterials = _.get(req, 'session.data.caseMaterials', {})
      const materials = Array.isArray(caseMaterials.Material) ? caseMaterials.Material : []
      const wanted = String(itemId).toLowerCase()
      const item = materials.find(m => {
        const id = String(m?.ItemId || m?.itemId || m?.ItemID || '').toLowerCase()
        return id && id === wanted
      })

      if (item) {
        const nlrRowsPath = 'session.data.disclosureNoLongerRelevantRows'
        const nlrRows = _.get(req, nlrRowsPath, [])

        const alreadyExists = nlrRows.some(r =>
          String(r?.ItemId || r?.itemId || '').toLowerCase() === wanted
        )

        if (!alreadyExists) {
          const maxId = nlrRows.reduce((acc, r) => {
            const n = parseInt(r?.id, 10)
            return Number.isFinite(n) ? Math.max(acc, n) : acc
          }, 0)
          const nextId = String(maxId + 1).padStart(2, '0')

          nlrRows.push({
            id: nextId,
            ItemId: itemId,
            title: item.Title || itemId,
            description: item.Description || item.exhibitDescription || null,
            policeAssessment: _.get(item, 'policeDisclosure.status', null) || (item.isEvidence ? 'Evidence' : 'No longer relevant'),
            policeRationale: _.get(item, 'policeDisclosure.rationale', null),
            cpsAssessment: 'To be reviewed'
          })

          _.set(req, nlrRowsPath, nlrRows)
        }
      }

      const seededRow = _.get(req, 'session.data.disclosureNoLongerRelevantRows', [])
        .find(r => String(r?.ItemId || r?.itemId || '').toLowerCase() === wanted)
      const rowId = seededRow?.id || itemId

      return res.redirect(
        `/cases/${caseId}/disclosure/no-longer-relevant/${targetPath}` +
        `?id=${encodeURIComponent(rowId)}` +
        `&returnUrl=${encodeURIComponent(returnUrl)}`
      )
    }

    if (action === 'assess-unused') {
      const itemId = req.query?.itemId ? String(req.query.itemId) : null
      if (!itemId) return res.status(400).send('Missing itemId')

      const returnUrl =
        req.query?.returnUrl
          ? String(req.query.returnUrl)
          : buildDefaultViewerReturnUrl(caseId, itemId)

      return seedNlrRowAndRedirect(req, res, {
        caseId,
        itemId,
        targetPath: 'assess-as-unused',
        returnUrl
      })
    }

    if (action === 'assess-no-longer-relevant') {
      const itemId = req.query?.itemId ? String(req.query.itemId) : null
      if (!itemId) return res.status(400).send('Missing itemId')

      const returnUrl =
        req.query?.returnUrl
          ? String(req.query.returnUrl)
          : buildDefaultViewerReturnUrl(caseId, itemId)

      return seedNlrRowAndRedirect(req, res, {
        caseId,
        itemId,
        targetPath: 'agree-no-longer-relevant',
        returnUrl
      })
    }


    const itemId = req.query?.itemId ? String(req.query.itemId) : null
    const idFromQuery = req.query?.id ? String(req.query.id) : null

    let selectedId = idFromQuery
    if (!selectedId && itemId) {
      selectedId = findDisclosureRowIdByItemId(req, itemId)
    }
    if (!selectedId) return res.status(400).send('Missing id or itemId')

    // Pull the row so we can branch on sensitivityDisputed
    const rows = _.get(req, 'session.data.disclosureNonSensitiveRows', [])
    const selectedRow = rows.find(r => String(r?.id) === String(selectedId))
    if (!selectedRow) return res.status(404).send('Row not found')

    // Determine returnUrl
    const fallbackTableReturn = `/cases/${caseId}/disclosure/assess-non-sensitive`
    const defaultViewerReturn = buildDefaultViewerReturnUrl(caseId, itemId)

    const returnUrl =
      req.query?.returnUrl
        ? String(req.query.returnUrl)
        : (itemId ? defaultViewerReturn : fallbackTableReturn)

    // Determine target leaf route
    const mapped = MATERIAL_ACTION_TO_ROUTE[action]
    if (!mapped) return res.status(400).send('Unknown action')

    // if (mapped === '__NOT_IMPLEMENTED__') {
    //   return res.status(501).send('Action not implemented')
    // }

    let targetLeaf = mapped

    // Special-case: if already disputed, go to “change dispute” instead of “dispute”
    if (mapped === '__SPECIAL__') {
      targetLeaf = selectedRow?.sensitivityDisputed
        ? 'change-sensitivity-dispute'
        : 'item-dispute-sensitivity'
    }

    // Redirect into your existing flow
    const target =
      `/cases/${caseId}/disclosure/assess-non-sensitive/${targetLeaf}` +
      `?id=${encodeURIComponent(selectedId)}` +
      `&returnUrl=${encodeURIComponent(returnUrl)}` +
      (itemId ? `&openItemId=${encodeURIComponent(itemId)}` : '')

    return res.redirect(target)
  })
}