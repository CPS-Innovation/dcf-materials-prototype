//////// routes/case--materials.js
const _ = require('lodash')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const documentTypes = require('../data/document-types')

const path = require('path')
const fs = require('fs').promises

function resetFilters(req) {
  _.set(req, 'session.data.documentListFilters.documentTypes', null)
}

async function listFilesIn(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter(e => e.isFile())
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b))
  } catch (e) {
    console.warn('Could not read files from', dir, e.message)
    return []
  }
}

// Put near the top of case--materials-search.js
function normaliseRecord(m) {
  // If m already has Material / RelatedMaterials / etc, keep them.
  if (m && m.Material) {
    // Ensure myFileUrl is present on Material (copy through if you store it top-level)
    if (!m.Material.myFileUrl && m.myFileUrl) m.Material.myFileUrl = m.myFileUrl;
    return m;
  }

  // If the array holds just the Material fields flat, wrap them.
  return {
    Material: Object.assign({}, m),
    RelatedMaterials: m.RelatedMaterials || {},
    DigitalRepresentation: m.DigitalRepresentation || {},
    PoliceMaterial: m.PoliceMaterial || {},
    CPSMaterial: m.CPSMaterial || {}
  };
}


//////////////////////////////////////////////////////////////////

module.exports = router => {
  router.get("/cases/:caseId/material", async (req, res) => {
    const caseId = parseInt(req.params.caseId)

    let selectedDocumentTypeFilters = _.get(req.session.data.documentListFilters, 'documentTypes', [])

    let selectedFilters = { categories: [] }

    // Document type filter display
    if (selectedDocumentTypeFilters?.length) {
      selectedFilters.categories.push({
        heading: { text: 'Type' },
        items: selectedDocumentTypeFilters.map(function(label) {
          return { text: label, href: `/cases/${caseId}/material/remove-type/${label}` }
        })
      })
    }

    

    // Build Prisma where clause for documents
    let where = { caseId: caseId, AND: [] }

    if (selectedDocumentTypeFilters?.length) {
      where.AND.push({ type: { in: selectedDocumentTypeFilters } })
    }

    if (where.AND.length === 0) {
      delete where.AND
    }

    
  // Fetch case
    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: {
          include: {
            defenceLawyer: true,
            charges: true
          }
        },
        victims: true,
        witnesses: {
          include: {
            statements: true,
            specialMeasures: true
          }
        },
        hearings: true,
        location: true,
        tasks: true,
        directions: true,
        documents: true,
        dga: {
          include: {
            failureReasons: true
          }
        },
        notes: {
          include: {
            user: true            // ✅ Note.user
          }
        },
        activityLogs: {
          include: {
            user: true            // ✅ ActivityLog.user
          }
        },
        prosecutors: {
          include: {
            user: true            // ✅ CaseProsecutor.user
          }
        },
        paralegalOfficers: {
          include: {
            user: true            // ✅ CaseParalegalOfficer.user
          }
        }
      }
    })


    // Fetch documents with filters
    let documents = await prisma.document.findMany({
      where: where
    })

    // Search by document name
    let keywords = _.get(req.session.data.documentSearch, 'keywords')

    if(keywords) {
      keywords = keywords.toLowerCase()
      documents = documents.filter(document => {
        let documentName = document.name.toLowerCase()
        return documentName.indexOf(keywords) > -1
      })
    }

    let documentTypeItems = documentTypes.map(docType => ({
      text: docType,
      value: docType
    }))

    // Files under app/assets/files (served at /public/files/* by the kit)
    const assetsFilesDir = path.join(__dirname, '..', 'assets', 'files')
    const assetFiles = await listFilesIn(assetsFilesDir)

    const assetFileLinks = assetFiles.map(name => ({
      name,
      href: `/public/files/${name}`
    }))


    res.render("cases/material/index", {
      _case,
      documents,
      documentTypeItems,
      selectedFilters,
      assetFiles,        // just names
      assetFileLinks     // [{name, href}]
    })
  })

  //////////////////////////////////////////////////////////////////


  router.get("/cases/:caseId/material/:documentId/show", async (req, res) => {
    const caseId = Number(req.params.caseId)
    const documentId = Number(req.params.documentId)

    // Fetch the case
    const _case = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        unit: true,
        defendants: {
          include: {
            defenceLawyer: true,
            charges: true
          }
        },
        victims: true,
        witnesses: {
          include: {
            statements: true,
            specialMeasures: true
          }
        },
        hearings: true,
        location: true,
        tasks: true,
        directions: true,
        documents: true,
        dga: {
          include: {
            failureReasons: true
          }
        },
        notes: {
          include: {
            user: true            // ✅ Note.user
          }
        },
        activityLogs: {
          include: {
            user: true            // ✅ ActivityLog.user
          }
        },
        prosecutors: {
          include: {
            user: true            // ✅ CaseProsecutor.user
          }
        },
        paralegalOfficers: {
          include: {
            user: true            // ✅ CaseParalegalOfficer.user
          }
        }
      }
    })

    if (!_case) return res.status(404).render("not-found")

    // Fetch the single document for this case
    const document = await prisma.document.findFirst({
      where: { id: documentId, caseId }
    })
    if (!document) return res.status(404).render("not-found")

    // (Optional) if you still need filter UI on the show page,
    // you can compute documentTypeItems/selectedFilters the same way as the list page.
    res.render("cases/material/show", {
      _case,
      document
    })
  })


  router.get('/cases/:caseId/material/remove-type/:type', (req, res) => {
    _.set(req, 'session.data.documentListFilters.documentTypes', _.pull(req.session.data.documentListFilters.documentTypes, req.params.type))
    res.redirect(`/cases/${req.params.caseId}/material`)
  })

  router.get('/cases/:caseId/material/clear-filters', (req, res) => {
    resetFilters(req)
    res.redirect(`/cases/${req.params.caseId}/material`)
  })

  router.get('/cases/:caseId/material/clear-search', (req, res) => {
    _.set(req, 'session.data.documentSearch.keywords', '')
    res.redirect(`/cases/${req.params.caseId}/material`)
  })


   // --- tiny esc helper ---
  const esc = s => (s == null ? '' : String(s))
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  function getCurrentCaseMaterials(req, caseId) {
    const cm = req.session?.data?.caseMaterials;
    if (cm && Array.isArray(cm.Material)) {
      if (caseId && String(cm.caseId) !== String(caseId)) return [];
      return cm.Material;
    }
    if (Array.isArray(cm)) {
      const found = caseId ? cm.find(c => String(c.caseId) === String(caseId)) : cm[0];
      return Array.isArray(found?.Material) ? found.Material : [];
    }
    return [];
  }

  /// builds the search resulst in material viewer  
  function oneSummaryListBlock(m) {
    // Full record for the viewer/meta panel
    const meta = normaliseRecord(m);
    const mat  = meta.Material || {};

    const title  = mat.Title || m.Title || '';
    const type   = mat.Type  || m.Type  || '';
    const status = mat.materialStatus || m.materialStatus || m.Status || '';
    const date   = mat.Date || m.Date || m.date || '';
    const href   = mat.myFileUrl || m.myFileUrl || '';
    const itemId = mat.ItemId || m.ItemId || '';

    const titleHtml = href
      ? `<a href="${esc(href)}"
            class="govuk-link dcf-viewer-link"
            data-file-url="${esc(href)}"
            data-title="${esc(title)}">${esc(title)}</a>`
      : esc(title);

    return `
      <section
        class="dcf-search-hit dcf-material-card dcf-material-card--unstyled"
        data-item-id="${esc(itemId)}"
        ${date ? `data-material-date="${esc(date)}"` : ''}
      >

        <dl class="govuk-summary-list dcf-summary dcf-summary--results govuk-!-margin-bottom-0">
          <h3 class="govuk-heading-s govuk-!-margin-bottom-2">${titleHtml}</h3>

          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Type</dt>
            <dd class="govuk-summary-list__value">${esc(type)}</dd>
          </div>

          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Status</dt>
            <dd class="govuk-summary-list__value">${esc(status)}</dd>
          </div>

          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Date</dt>
            <dd class="govuk-summary-list__value">${esc(date)}</dd>
          </div>
        </dl>

        <!-- RAW JSON (not escaped) so getMaterialJSONFromLink can parse it -->
        <script type="application/json" class="js-material-data">${JSON.stringify(meta)}</script>
      </section>`;
  }





  function fragmentHTML(matches, q) {
    const count = matches.length;
    return `<div class="dcf-search-results" role="region" aria-label="Search results" data-results-count="${count}">
      ${count ? matches.map(oneSummaryListBlock).join('\n') : ''}
    </div>`;
  }


  router.get('/materials/search', (req, res) => {
    const qRaw = (req.query.q || '').trim();
    const caseId = (req.query.caseId || req.session?.data?.currentCaseId || '').toString();
    const wantsFragment = req.query.fragment === '1' || req.get('X-Requested-With') === 'fetch';

    if (!qRaw) {
      const html = `<p class="govuk-hint govuk-!-margin-bottom-0">Enter a title to search materials.</p>`;
      return wantsFragment ? res.send(html) : res.render('materials/search', { q: qRaw, results: [], prebuilt: html });
    }

    const materials = getCurrentCaseMaterials(req, caseId);
    const q = qRaw.toLowerCase();
    const results = materials.filter(m => {
    
    const t = (m.Title || (m.Material && m.Material.Title) || '').toLowerCase();
      return t.includes(q);
    });


    if (wantsFragment) {
      return res.send(fragmentHTML(results, qRaw));
    }

    // Full page render via Nunjucks (styled)
    res.render('cases/materials/search', { q: qRaw, results, prebuilt: fragmentHTML(results, qRaw) });
  });

}