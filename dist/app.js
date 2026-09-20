(async () => {
  const data = window.SIDDUR_DATA;
  const toc = document.querySelector('#toc');
  const grid = document.querySelector('#collectionGrid');
  const home = document.querySelector('#home');
  const reading = document.querySelector('#readingView');
  const manage = document.querySelector('#manageView');
  const sidebar = document.querySelector('#sidebar');
  const scrim = document.querySelector('#scrim');
  const menuButton = document.querySelector('#menuButton');
  const closeButton = document.querySelector('#closeButton');
  const fontButton = document.querySelector('#fontButton');
  const themeButton = document.querySelector('#themeButton');
  const themeIcon = document.querySelector('#themeIcon');
  const backToTop = document.querySelector('#backToTop');

  await window.SIDDUR_MANAGER.ready;
  const allEntries = data.groups.flatMap((group) => group.entries.map((entry) => ({ ...entry, group })));
  document.querySelector('.manage-button').hidden = !window.SIDDUR_MANAGER.canEdit();
  const initialRoute = decodeURIComponent(location.hash.slice(1)) || 'home';
  const routeHistory = initialRoute === 'home' ? ['home'] : ['home', initialRoute];
  let renderedRoute = null;
  let breadcrumbNavigation = false;

  function setTheme(theme, persist = true) {
    const isDark = theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    themeIcon.textContent = isDark ? '☀' : '☾';
    const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    themeButton.setAttribute('aria-label', label);
    themeButton.title = label;
    if (persist) localStorage.setItem('siddur-theme', isDark ? 'dark' : 'light');
  }

  function slugify(value) {
    return value.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function cleanSource(source, entry) {
    let text = entry.content ?? data.files[source] ?? '';
    if (!entry.content && !entry.headings.includes(entry.title)) text = text.replace(/^.*?\n+/, '');
    text = text.trim();
    const stopHeadings = {
      2: ['Amidah Prayer'],
      8: ['First Fruits', 'Counting the Omer', 'Shavuot', 'Yom Teruah', 'Yom Kippur', 'Sukkot'],
    };
    if (source === 8 && entry.headings.length) {
      const ordered = stopHeadings[8];
      const start = ordered.indexOf(entry.headings[0]);
      const startAt = text.indexOf(entry.headings[0]);
      const nextHeading = ordered[start + 1];
      const endAt = nextHeading ? text.indexOf(nextHeading, startAt + entry.headings[0].length) : -1;
      text = text.slice(startAt, endAt > -1 ? endAt : undefined);
    }
    if (source === 2) {
      const endAt = text.lastIndexOf('Amidah Prayer');
      if (endAt > -1) text = text.slice(0, endAt);
    }
    return text.trim();
  }

  function splitSections(entry) {
    if (entry.exactText) return [{ title: entry.title, text: entry.content ?? '' }];
    const text = cleanSource(entry.source, entry);
    if (entry.sections?.length) {
      const positions = entry.sections.map(([title, marker]) => ({ title, index: text.indexOf(marker) })).filter((item) => item.index >= 0).sort((a, b) => a.index - b.index);
      return positions.map((item, index) => ({ title: item.title, text: text.slice(item.index, positions[index + 1]?.index ?? text.length).trim() }));
    }
    const headings = entry.headings.filter((heading) => text.includes(heading));
    if (!headings.length) {
      return [{ title: entry.title, text: text.replace(new RegExp(`^${entry.title}\\s*`), '').trim() }];
    }

    const positions = headings.map((heading) => ({ heading, index: text.indexOf(heading) })).sort((a, b) => a.index - b.index);
    return positions.map((item, index) => {
      const start = item.index + item.heading.length;
      const end = positions[index + 1]?.index ?? text.length;
      return { title: item.heading, text: text.slice(start, end).trim() };
    }).filter((section) => section.text || section.title);
  }

  function classifyParagraph(paragraph) {
    const value = paragraph.trim();
    if (/^(\(|During |In summer|In winter|After |Before |Read )/i.test(value)) return 'instruction';
    if (/^(Barukh|BA-RUCH|ba·rookh|Eloheinu|Yevarechecha|Ya’er|Yisa|ho·du)/i.test(value)) return 'transliteration';
    if (/^(Genesis|Exodus|Deuteronomy|Psalm|Psalms|Proverbs|Matthew|Mat\.|Rev\.|Revelation|Joel|Ezk|Acts|Ephesians|1 Corinthians|1 Thes|2 Timothy)/i.test(value)) return 'scripture';
    return '';
  }

  function renderParagraphs(text) {
    return text.split(/\n\s*\n/).map((paragraph) => {
      const value = paragraph.trim();
      if (!value || value === '⸻') return '';
      return `<p class="${classifyParagraph(value)}" dir="auto">${escapeHtml(value).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  }

  function renderNavigation() {
    toc.innerHTML = data.groups.map((group, index) => `
      <details class="toc-group" ${index === 0 ? 'open' : ''}>
        <summary>${group.title}</summary>
        <ul>${group.entries.map((entry) => {
          const children = entry.showSectionLinks === false ? [] : (entry.sections?.map(([title]) => title) ?? entry.headings.filter((heading) => heading !== entry.title));
          return `<li class="toc-entry"><a href="#${entry.id}" data-entry="${entry.id}">${entry.title}</a>${children.length ? `<ul class="toc-sublist">${children.map((title) => `<li><a href="#${entry.id}/${slugify(title)}">${title}</a></li>`).join('')}</ul>` : ''}</li>`;
        }).join('') || `<li class="toc-empty"><a href="#manage/${group.id}">Add the first prayer</a></li>`}</ul>
      </details>`).join('');

    grid.innerHTML = data.groups.map((group) => `
      <a class="collection-card" href="${group.entries[0] ? `#${group.entries[0].id}` : `#manage/${group.id}`}">
        <span class="hebrew" dir="rtl">${group.hebrew}</span>
        <div><h2>${group.title}</h2><p>${group.description}</p>${group.suggested?.length ? `<span class="placeholder-list">Suggested: ${group.suggested.map(escapeHtml).join(', ')}</span>` : ''}${group.entries.length ? '' : '<span class="empty-card-action">Add a prayer →</span>'}</div>
      </a>`).join('');
  }

  function renderEntry(entry, targetSection = '') {
    const sections = splitSections(entry);
    const groupIndex = entry.group.entries.findIndex((item) => item.id === entry.id);
    const next = entry.group.entries[groupIndex + 1] ?? null;
    home.hidden = true;
    reading.hidden = false;
    reading.innerHTML = `
      <article class="reading-paper">
        <div class="breadcrumbs"><button class="breadcrumb-back" id="breadcrumbBack" type="button"><span aria-hidden="true">←</span><span>Back</span></button><span aria-hidden="true">•</span><span>${entry.group.title}</span></div>
        <header class="prayer-header">
          <div class="hebrew-label" dir="rtl">${entry.group.hebrew}</div>
          <h1>${entry.title}</h1>
          ${entry.isCustom && (entry.purpose || entry.occasion || entry.sourceTradition || entry.language) ? `
            <dl class="prayer-meta">
              ${entry.purpose ? `<div><dt>Purpose</dt><dd>${escapeHtml(entry.purpose)}</dd></div>` : ''}
              ${entry.occasion ? `<div><dt>Occasion</dt><dd>${escapeHtml(entry.occasion)}</dd></div>` : ''}
              ${entry.sourceTradition ? `<div><dt>Source or tradition</dt><dd>${escapeHtml(entry.sourceTradition)}</dd></div>` : ''}
              ${entry.language ? `<div><dt>Language</dt><dd>${escapeHtml(entry.language)}</dd></div>` : ''}
            </dl>` : ''}
          ${entry.isCustom && window.SIDDUR_MANAGER.canEdit() ? `<a class="edit-prayer-link" href="#manage/${entry.id}">Edit this prayer</a>` : ''}
          ${entry.group.entries.length > 1 ? `
            <nav class="page-index" aria-label="Prayers in ${entry.group.title}">
              <span class="page-index-label">Prayers in this section</span>
              <div class="page-index-links">
                ${entry.group.entries.map((page) => page.id === entry.id
                  ? `<span class="page-link current" aria-current="page">${page.title}</span>`
                  : `<a class="page-link" href="#${page.id}">${page.title}</a>`).join('')}
              </div>
            </nav>` : ''}
          ${sections.length > 1 && entry.showSectionLinks !== false ? `<nav class="section-index" aria-label="On this page">${sections.map((section, index) => `<a href="#${entry.id}/${slugify(section.title) || index}">${section.title}</a>`).join('')}</nav>` : ''}
        </header>
        ${sections.map((section, index) => `
          <section class="prayer-section" id="${entry.id}-${slugify(section.title) || index}">
            ${sections.length > 1 ? `<h2>${section.title}</h2>` : ''}
            <div class="prayer-text">${entry.exactText ? `<div class="exact-prayer-text" dir="auto">${escapeHtml(section.text)}</div>` : renderParagraphs(section.text)}</div>
            ${entry.isCustom && entry.notes ? `<aside class="prayer-notes"><strong>Notes</strong><span>${escapeHtml(entry.notes)}</span></aside>` : ''}
          </section>`).join('')}
        <footer class="prayer-actions">
          <a class="return-toc" href="#home"><span aria-hidden="true">←</span><span>Return to Table of Contents</span></a>
          ${next ? `<a class="next-prayer" href="#${next.id}"><span><small>Continue within ${entry.group.title}</small><strong>${next.title}</strong></span><span aria-hidden="true">→</span></a>` : ''}
        </footer>
      </article>`;

    document.querySelector('#breadcrumbBack')?.addEventListener('click', goToPreviousRoute);

    document.querySelectorAll('[data-entry]').forEach((link) => link.classList.toggle('active', link.dataset.entry === entry.id));
    const active = document.querySelector(`[data-entry="${entry.id}"]`);
    active?.closest('details')?.setAttribute('open', '');
    if (targetSection) {
      requestAnimationFrame(() => document.querySelector(`#${entry.id}-${targetSection}`)?.scrollIntoView());
    } else {
      window.scrollTo(0, 0);
    }
    closeMenu();
    updateBackToTop();
  }

  function route() {
    const hash = decodeURIComponent(location.hash.slice(1)) || 'home';
    if (hash !== renderedRoute) {
      if (breadcrumbNavigation) {
        breadcrumbNavigation = false;
      } else if (renderedRoute !== null && routeHistory.at(-1) !== hash) {
        routeHistory.push(hash);
      }
      renderedRoute = hash;
    }
    const [id, targetSection = ''] = hash.split('/');
    if (id === 'manage') {
      home.hidden = true;
      reading.hidden = true;
      manage.hidden = false;
      window.SIDDUR_MANAGER.render(targetSection);
      document.querySelectorAll('[data-entry]').forEach((link) => link.classList.remove('active'));
      window.scrollTo(0, 0);
      closeMenu();
      updateBackToTop();
      return;
    }
    if (id === 'home') {
      home.hidden = false;
      reading.hidden = true;
      manage.hidden = true;
      document.querySelectorAll('[data-entry]').forEach((link) => link.classList.remove('active'));
      window.scrollTo(0, 0);
      closeMenu();
      updateBackToTop();
      return;
    }
    manage.hidden = true;
    const entry = allEntries.find((item) => item.id === id);
    if (entry) renderEntry(entry, targetSection);
  }

  function goToPreviousRoute() {
    if (routeHistory.length > 1) routeHistory.pop();
    const previousRoute = routeHistory.at(-1) || 'home';
    const currentRoute = decodeURIComponent(location.hash.slice(1)) || 'home';
    if (previousRoute === currentRoute) return;
    breadcrumbNavigation = true;
    location.hash = previousRoute;
  }

  function openMenu() {
    sidebar.classList.add('open');
    scrim.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
    closeButton.focus();
  }

  function closeMenu() {
    sidebar.classList.remove('open');
    scrim.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }

  function updateBackToTop() {
    const shouldShow = !reading.hidden && window.scrollY > 560;
    backToTop.classList.toggle('visible', shouldShow);
    backToTop.setAttribute('aria-hidden', String(!shouldShow));
    backToTop.tabIndex = shouldShow ? 0 : -1;
  }

  const sizeClasses = ['', 'reader-large', 'reader-largest'];
  let sizeIndex = Number(localStorage.getItem('siddur-font-size') || 0);
  if (!Number.isInteger(sizeIndex) || sizeIndex < 0 || sizeIndex >= sizeClasses.length) sizeIndex = 0;
  if (sizeClasses[sizeIndex]) document.body.classList.add(sizeClasses[sizeIndex]);
  setTheme(document.documentElement.dataset.theme || 'light', false);
  themeButton.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  fontButton.addEventListener('click', () => {
    document.body.classList.remove(...sizeClasses.filter(Boolean));
    sizeIndex = (sizeIndex + 1) % sizeClasses.length;
    if (sizeClasses[sizeIndex]) document.body.classList.add(sizeClasses[sizeIndex]);
    localStorage.setItem('siddur-font-size', String(sizeIndex));
  });
  menuButton.addEventListener('click', openMenu);
  closeButton.addEventListener('click', closeMenu);
  scrim.addEventListener('click', closeMenu);
  window.addEventListener('scroll', updateBackToTop, { passive: true });
  backToTop.addEventListener('click', () => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  window.addEventListener('hashchange', route);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
  }

  renderNavigation();
  route();
})();
