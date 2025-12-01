(function () {
  function ready(fn){ if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',fn);} else {fn();} }

  function forceShow(panel){
    if (!panel) return;
    panel.removeAttribute('hidden');
    panel.classList.remove('govuk-tabs__panel--hidden');
    panel.style.display = '';
  }

  function restoreIfEmpty(panel){
    if (!panel) return;
    if (panel.innerHTML.trim() === '' && panel.dataset.dcfCache) {
      panel.innerHTML = panel.dataset.dcfCache;
    }
  }

  function idFromLink(link){
    return (link && (link.getAttribute('href') || '').replace('#','')) || null;
  }

  function activateLink(link, storageKey){
    if (!link) return;
    // Let govuk-frontend handle selection/show/hide
    link.click();
    var targetId = idFromLink(link);
    if (!targetId) return;
    requestAnimationFrame(function(){
      var panel = document.getElementById(targetId);
      forceShow(panel);
      restoreIfEmpty(panel);
      if (storageKey) sessionStorage.setItem(storageKey, targetId);
    });
  }

  function initTabs(){
    var tabsets = Array.prototype.slice.call(document.querySelectorAll('.govuk-tabs'));
    if (!tabsets.length) return;

    tabsets.forEach(function(tabset, idx){
      var storageKey = 'dcf-tabs-' + (tabset.id || idx);

      // Cache original HTML for each panel once
      Array.prototype.slice.call(tabset.querySelectorAll('.govuk-tabs__panel')).forEach(function(p){
        if (!p.dataset.dcfCache) p.dataset.dcfCache = p.innerHTML;
      });

      // Decide which tab should be active on first load:
      // 1) URL hash, 2) sessionStorage, 3) first tab
      var hashId = (location.hash || '').slice(1);
      var hashLink = hashId && tabset.querySelector('.govuk-tabs__tab[href="#' + hashId + '"]');
      var savedId  = sessionStorage.getItem(storageKey);
      var savedLink = savedId && tabset.querySelector('.govuk-tabs__tab[href="#' + savedId + '"]');
      var firstLink = tabset.querySelector('.govuk-tabs__tab');

      // Run AFTER govuk-frontend enhancement toggles attributes/hidden
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          var alreadySelected = tabset.querySelector('.govuk-tabs__tab[aria-selected="true"]');
          var linkToActivate = hashLink || savedLink || (!alreadySelected && firstLink) || null;

          if (linkToActivate) {
            activateLink(linkToActivate, storageKey);
          } else if (alreadySelected) {
            // Safety: ensure currently selected panel is visible & restored
            var activeId = idFromLink(alreadySelected);
            var activePanel = activeId && document.getElementById(activeId);
            forceShow(activePanel);
            restoreIfEmpty(activePanel);
          }
        });
      });

      // Persist and restore on user-activated tab changes
      function onActivate(link){
        var targetId = idFromLink(link);
        if (!targetId) return;
        requestAnimationFrame(function(){
          var panel = document.getElementById(targetId);
          forceShow(panel);
          restoreIfEmpty(panel);
          sessionStorage.setItem(storageKey, targetId);
        });
      }

      tabset.addEventListener('click', function(e){
        var link = e.target.closest('.govuk-tabs__tab');
        if (link) onActivate(link);
      });

      tabset.addEventListener('keydown', function(e){
        var link = e.target.closest('.govuk-tabs__tab');
        if (!link) return;
        if (e.key === 'Enter' || e.key === ' ') onActivate(link);
      });
    });
  }

  ready(initTabs);
})();
