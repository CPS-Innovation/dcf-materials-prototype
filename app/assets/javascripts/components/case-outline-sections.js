(function () {
  function ready(fn){ if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',fn);} else {fn();} }

  function idFromLink(link){
    return (link && (link.getAttribute('href') || '').replace('#','')) || null;
  }

  function initCaseOutline(container){
    var links = Array.prototype.slice.call(container.querySelectorAll('.moj-side-navigation a[href^="#"]'));
    var sections = Array.prototype.slice.call(container.querySelectorAll('.js-case-section'));
    if (!links.length || !sections.length) return;

    function showSection(targetId){
      sections.forEach(function(section){
        if (section.id === targetId) {
          section.removeAttribute('hidden');
        } else {
          section.setAttribute('hidden', '');
        }
      });

      links.forEach(function(link){
        var li = link.closest('.moj-side-navigation__item');
        var isActive = idFromLink(link) === targetId;
        if (li) li.classList.toggle('moj-side-navigation__item--active', isActive);
        if (isActive) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }

    links.forEach(function(link){
      link.addEventListener('click', function(e){
        var targetId = idFromLink(link);
        if (!targetId || !container.querySelector('#' + targetId + '.js-case-section')) return;
        e.preventDefault();
        if (('#' + targetId) !== location.hash) {
          history.pushState(null, '', '#' + targetId);
        }
        showSection(targetId);
      });
    });

    function showFromHash(){
      var hashId = (location.hash || '').slice(1);
      var hashSection = hashId && container.querySelector('#' + hashId + '.js-case-section');
      if (hashSection) showSection(hashId);
    }

    window.addEventListener('popstate', showFromHash);
    window.addEventListener('hashchange', showFromHash);
    showFromHash();
  }

  ready(function(){
    Array.prototype.slice.call(document.querySelectorAll('#case-outline-panels')).forEach(initCaseOutline);
  });
})();
