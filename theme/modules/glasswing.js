import {
  applySavedTheme,
  mountThemeControls
} from '../../../js/theme.js';

const REGION_NAMES = ['container', 'content', 'main', 'nav', 'search', 'tags', 'toc', 'footer', 'tools'];

function getDocument(context = {}) {
  return context.document || (typeof document !== 'undefined' ? document : null);
}

function getWindow(context = {}) {
  return context.window || (typeof window !== 'undefined' ? window : null);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&(?!#[0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function attr(value) {
  return escapeHtml(value);
}

function text(value, fallback = '') {
  const raw = value == null ? '' : String(value).trim();
  return raw || fallback;
}

function firstConfigText(value, fallback = '') {
  if (typeof value === 'string' || typeof value === 'number') return text(value, fallback);
  if (value && typeof value === 'object') {
    return text(value.default || value.en || value.chs || value['zh-cn'] || Object.values(value).find((item) => typeof item === 'string'), fallback);
  }
  return fallback;
}

function getI18n(params = {}) {
  const ctx = params.ctx || {};
  const i18n = ctx.i18n || {};
  const translate = params.translate || params.t || i18n.t;
  return {
    t: typeof translate === 'function' ? translate : ((key) => String(key || '')),
    withLangParam: typeof params.withLangParam === 'function'
      ? params.withLangParam
      : (typeof i18n.withLangParam === 'function' ? i18n.withLangParam : ((url) => url))
  };
}

function getMain(params = {}) {
  return (params.containers && params.containers.mainElement)
    || params.container
    || (params.ctx && params.ctx.regions && typeof params.ctx.regions.get === 'function' && params.ctx.regions.get('main'))
    || (params.ctx && params.ctx.regions && params.ctx.regions.main)
    || null;
}

function getRegion(context = {}, name) {
  const regions = context.regions || {};
  if (regions && typeof regions.get === 'function') return regions.get(name);
  return regions ? regions[name] : null;
}

function ensureElement(parent, selector, create) {
  const existing = parent.querySelector(selector);
  if (existing) return existing;
  const element = create();
  parent.appendChild(element);
  return element;
}

function setHtml(element, html) {
  if (!element) return false;
  element.innerHTML = String(html || '');
  return true;
}

function formatDate(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(parsed);
  } catch (_) {
    return raw;
  }
}

function getTags(meta = {}) {
  const source = meta.tags != null ? meta.tags : meta.tag;
  const tags = Array.isArray(source) ? source : (source == null ? [] : [source]);
  return tags.map((item) => String(item || '').trim()).filter(Boolean);
}

function getContentRoot(params = {}) {
  try {
    const utilities = params.utilities || (params.ctx && params.ctx.utilities) || {};
    if (typeof utilities.getContentRoot === 'function') return text(utilities.getContentRoot(), 'wwwroot');
  } catch (_) {}
  return 'wwwroot';
}

function getUrlPage(params = {}) {
  try {
    const win = params.window || activeWindow || getWindow(params.ctx);
    const search = win && win.location ? win.location.search : '';
    const parsed = new URLSearchParams(search || '').get('page');
    const page = parseInt(parsed || '1', 10);
    return Number.isNaN(page) ? 1 : Math.max(1, page);
  } catch (_) {
    return 1;
  }
}

function getConfiguredPageSize(params = {}, fallback = 8) {
  const config = params.siteConfig || {};
  const raw = config.pageSize != null ? config.pageSize : (config.postsPerPage != null ? config.postsPerPage : params.pageSize);
  const parsed = parseInt(raw || fallback, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

function getPostsPageState(params = {}) {
  const allEntries = Array.isArray(params.entries) ? params.entries : [];
  const suppliedEntries = Array.isArray(params.pageEntries) ? params.pageEntries : allEntries;
  const pageFromParams = parseInt(params.page || '1', 10);
  const pageFromUrl = getUrlPage(params);
  const page = Math.max(1, Number.isNaN(pageFromParams) ? pageFromUrl : Math.max(pageFromParams, pageFromUrl));
  const fallbackSize = suppliedEntries.length || allEntries.length || 8;
  const pageSize = getConfiguredPageSize(params, fallbackSize);
  const computedTotalPages = allEntries.length ? Math.max(1, Math.ceil(allEntries.length / pageSize)) : Math.max(1, parseInt(params.totalPages || '1', 10));
  const totalPages = Math.max(computedTotalPages, parseInt(params.totalPages || '1', 10) || 1);
  const shouldSlice = allEntries.length && (page !== pageFromParams || pageSize !== Number(params.pageSize) || allEntries.length > suppliedEntries.length);
  const pageEntries = shouldSlice ? allEntries.slice((page - 1) * pageSize, page * pageSize) : suppliedEntries;
  return {
    ...params,
    page,
    pageEntries,
    pageSize,
    totalPages
  };
}

function resolveMedia(meta = {}, params = {}) {
  let source = text(meta.cover || meta.thumb || meta.image);
  if (!source) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('/') || source.startsWith('#')) return source;
  if (!source.includes('/')) {
    const location = text(meta.location);
    const idx = location.lastIndexOf('/');
    const base = idx >= 0 ? location.slice(0, idx + 1) : '';
    source = `${base}${source}`.replace(/\/{2,}/g, '/');
  }
  const root = getContentRoot(params).replace(/^\/+|\/+$/g, '');
  if (root && !source.startsWith(`${root}/`)) return `${root}/${source}`.replace(/\/{2,}/g, '/');
  return source;
}

function getFirstBodyImageSource(markdownHtml = '', params = {}) {
  const markup = String(markdownHtml || '');
  if (!markup.includes('<img')) return '';
  const documentRef = params.document || getDocument(params.ctx || {});
  if (documentRef && typeof documentRef.createElement === 'function') {
    try {
      const template = documentRef.createElement('template');
      template.innerHTML = markup;
      const image = template.content && template.content.querySelector('img[src]');
      if (image) return text(image.getAttribute('src'));
    } catch (_) {}
  }
  const match = markup.match(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return match ? text(match[1] || match[2] || match[3]) : '';
}

function normalizeMediaSource(source, params = {}) {
  const raw = text(source);
  if (!raw) return '';
  const documentRef = params.document || getDocument(params.ctx || {});
  const windowRef = params.window || getWindow(params.ctx || {});
  const base = (documentRef && documentRef.baseURI)
    || (windowRef && windowRef.location && windowRef.location.href)
    || 'http://press.local/';
  try {
    const url = new URL(raw, base);
    url.hash = '';
    return url.href;
  } catch (_) {
    return raw
      .replace(/#.*$/, '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/{2,}/g, '/');
  }
}

function isSameMediaSource(left, right, params = {}) {
  const normalizedLeft = normalizeMediaSource(left, params);
  const normalizedRight = normalizeMediaSource(right, params);
  return !!normalizedLeft && !!normalizedRight && normalizedLeft === normalizedRight;
}

function postHref(params = {}, meta = {}) {
  const { withLangParam } = getI18n(params);
  const location = text(meta.location);
  return location ? withLangParam(`?id=${encodeURIComponent(location)}`) : '#';
}

function renderMeta(meta = {}) {
  const date = formatDate(meta.date);
  const tags = getTags(meta);
  const labels = [];
  if (date) labels.push(`<span>${escapeHtml(date)}</span>`);
  tags.slice(0, 2).forEach((tag) => labels.push(`<span>${escapeHtml(tag)}</span>`));
  if (meta.protected) labels.push('<span>Protected</span>');
  if (meta.draft) labels.push('<span>Draft</span>');
  return labels.length ? `<div class="glasswing-card__meta">${labels.join('')}</div>` : '';
}

function renderCover(meta = {}, title = '', className = 'glasswing-card__media', params = {}) {
  const source = resolveMedia(meta, params);
  if (!source) return '';
  return `<div class="${attr(className)}"><img src="${attr(source)}" alt="${attr(title)}" loading="lazy" decoding="async"></div>`;
}

function renderHero(entry, params = {}) {
  if (!entry) return '';
  const [title, meta = {}] = entry;
  const href = postHref(params, meta);
  const excerpt = text(meta.excerpt);
  const media = renderCover(meta, title, 'glasswing-hero__media', params);
  return `<article class="glasswing-hero">
    <a class="glasswing-hero__link" href="${attr(href)}">
      <div class="glasswing-hero__copy">
        ${renderMeta(meta)}
        <h1>${escapeHtml(title)}</h1>
        ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ''}
        <span class="glasswing-action">Read feature</span>
      </div>
      ${media || '<div class="glasswing-hero__media glasswing-hero__media--empty" aria-hidden="true"></div>'}
    </a>
  </article>`;
}

function renderSecondary(entry, params = {}) {
  if (!entry) return '';
  const [title, meta = {}] = entry;
  const href = postHref(params, meta);
  const excerpt = text(meta.excerpt);
  return `<article class="glasswing-secondary-card">
    <a href="${attr(href)}">
      <div>
        ${renderMeta(meta)}
        <h2>${escapeHtml(title)}</h2>
        ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ''}
      </div>
      <span class="glasswing-action">Read story</span>
    </a>
  </article>`;
}

function renderRow(entry, params = {}) {
  if (!entry) return '';
  const [title, meta = {}] = entry;
  const href = postHref(params, meta);
  const excerpt = text(meta.excerpt);
  return `<article class="glasswing-row">
    <a href="${attr(href)}">
      <div class="glasswing-row__body">
        ${renderMeta(meta)}
        <h2>${escapeHtml(title)}</h2>
        ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ''}
      </div>
      <span class="glasswing-row__arrow" aria-hidden="true">-></span>
    </a>
  </article>`;
}

function renderPagination(params = {}, baseTab = 'posts') {
  const page = Math.max(1, Number(params.page || 1));
  const totalPages = Math.max(1, Number(params.totalPages || 1));
  if (totalPages <= 1) return '';
  const { withLangParam, t } = getI18n(params);
  const makeHref = (target) => {
    const query = baseTab === 'search'
      ? `?tab=search&q=${encodeURIComponent(params.query || '')}&tag=${encodeURIComponent(params.tagFilter || '')}&page=${target}`
      : `?tab=posts&page=${target}`;
    return withLangParam(query);
  };
  const prev = page > 1
    ? `<a href="${attr(makeHref(page - 1))}">${escapeHtml(t('ui.prev') || 'Previous')}</a>`
    : '<span aria-disabled="true">Previous</span>';
  const next = page < totalPages
    ? `<a href="${attr(makeHref(page + 1))}">${escapeHtml(t('ui.next') || 'Next')}</a>`
    : '<span aria-disabled="true">Next</span>';
  return `<nav class="glasswing-pagination" aria-label="Pagination">${prev}<span>${page} / ${totalPages}</span>${next}</nav>`;
}

function renderPlainList(params = {}, options = {}) {
  const entries = Array.isArray(params.pageEntries)
    ? params.pageEntries
    : (Array.isArray(params.entries) ? params.entries : []);
  const heading = text(options.heading, 'Articles');
  const intro = text(options.intro);
  const rows = entries.map((entry) => renderRow(entry, params)).join('');
  return `<section class="glasswing-list-page index">
    <header class="glasswing-list-page__header">
      <p>${escapeHtml(options.kicker || 'Index')}</p>
      <h1>${escapeHtml(heading)}</h1>
      ${intro ? `<span>${escapeHtml(intro)}</span>` : ''}
    </header>
    <div class="glasswing-list">${rows || '<p class="glasswing-empty">No posts yet.</p>'}</div>
    ${renderPagination(params, options.baseTab || 'posts')}
  </section>`;
}

function renderHome(params = {}) {
  const state = getPostsPageState(params);
  const entries = Array.isArray(state.pageEntries) ? state.pageEntries : [];
  if (Number(state.page || 1) > 1) {
    return renderPlainList(state, {
      heading: 'All articles',
      kicker: 'Archive',
      baseTab: 'posts'
    });
  }
  const hero = entries[0];
  const secondary = entries.slice(1, 4);
  const rest = entries.slice(4);
  return `<section class="glasswing-front index">
    ${renderHero(hero, state)}
    ${secondary.length ? `<section class="glasswing-secondary" aria-label="Latest stories">${secondary.map((entry) => renderSecondary(entry, state)).join('')}</section>` : ''}
    ${rest.length ? `<section class="glasswing-after"><h2>More articles</h2><div class="glasswing-list">${rest.map((entry) => renderRow(entry, state)).join('')}</div></section>` : ''}
    ${renderPagination(state, 'posts')}
  </section>`;
}

function renderPost(params = {}) {
  const main = getMain(params);
  if (!main) return undefined;
  const meta = params.postMetadata || {};
  const title = text(meta.title || params.fallbackTitle, 'Untitled');
  const coverSource = resolveMedia(meta, params);
  const firstBodyImageSource = getFirstBodyImageSource(params.markdownHtml, params);
  const cover = coverSource && !isSameMediaSource(coverSource, firstBodyImageSource, params)
    ? renderCover(meta, title, 'glasswing-article__cover', params)
    : '';
  setHtml(main, `<article class="glasswing-article">
    <header class="glasswing-article__header">
      ${renderMeta(meta)}
      <h1>${escapeHtml(title)}</h1>
      ${text(meta.excerpt) ? `<p>${escapeHtml(meta.excerpt)}</p>` : ''}
      ${cover}
    </header>
    <div class="glasswing-article__body">${params.markdownHtml || ''}</div>
    <footer class="glasswing-article__nav" data-post-nav></footer>
  </article>`);
  try {
    const utilities = params.utilities || {};
    if (typeof utilities.renderPostTOC === 'function') {
      utilities.renderPostTOC({
        tocElement: params.containers && params.containers.tocElement,
        tocHtml: params.tocHtml,
        articleTitle: '',
        contentRoot: main
      });
    }
    if (typeof utilities.renderPostNav === 'function') {
      utilities.renderPostNav(main.querySelector('[data-post-nav]'), params.postsIndex || {}, meta.location);
    }
    if (typeof utilities.hydratePostImages === 'function') utilities.hydratePostImages(main);
    if (typeof utilities.hydratePostVideos === 'function') utilities.hydratePostVideos(main);
    if (typeof utilities.applyLazyLoadingIn === 'function') utilities.applyLazyLoadingIn(main);
    if (typeof utilities.applyLangHints === 'function') utilities.applyLangHints(main);
  } catch (_) {}
  return { decorated: true, title };
}

function renderPosts(params = {}) {
  const main = getMain(params);
  if (!main) return undefined;
  setHtml(main, renderHome(params));
  return { decorated: true };
}

function renderSearch(params = {}) {
  const main = getMain(params);
  if (!main) return undefined;
  const query = text(params.query || params.tagFilter);
  const heading = query ? `Search: ${query}` : 'Search';
  setHtml(main, renderPlainList(params, {
    heading,
    kicker: 'Search',
    intro: params.total != null ? `${params.total} results` : '',
    baseTab: 'search'
  }));
  return { decorated: true, title: heading };
}

function renderTab(params = {}) {
  const main = getMain(params);
  if (!main) return undefined;
  const title = text((params.tab && params.tab.title) || params.title);
  setHtml(main, `<article class="glasswing-article glasswing-article--tab">
    ${title ? `<header class="glasswing-article__header"><h1>${escapeHtml(title)}</h1></header>` : ''}
    <div class="glasswing-article__body">${params.markdownHtml || ''}</div>
  </article>`);
  return { decorated: true, title };
}

function renderError(params = {}) {
  const main = getMain(params);
  if (!main) return undefined;
  const actions = Array.isArray(params.actions) ? params.actions : [];
  setHtml(main, `<section class="glasswing-notice">
    <h1>${escapeHtml(params.title || 'Page not found')}</h1>
    ${params.message ? `<p>${escapeHtml(params.message)}</p>` : ''}
    ${actions.length ? `<div>${actions.map((action) => `<a class="glasswing-action" href="${attr(action.href || '#')}">${escapeHtml(action.label || 'Open')}</a>`).join('')}</div>` : ''}
  </section>`);
  return { decorated: true };
}

function renderLoading(params = {}) {
  const main = getMain(params);
  if (!main) return undefined;
  setHtml(main, '<section class="glasswing-notice"><p>Loading...</p></section>');
  return { decorated: true };
}

function clearRegion(region) {
  if (!region) return false;
  region.innerHTML = '';
  return true;
}

function renderTabs(params = {}) {
  const nav = params.navElement || getRegion({ regions: params.regions || activeRegions }, 'nav');
  if (!nav) return false;
  const { t, withLangParam } = getI18n(params);
  const tabs = params.tabsBySlug || {};
  const active = String(params.activeSlug || '');
  const links = [];
  if (typeof params.postsEnabled !== 'function' || params.postsEnabled()) {
    links.push({ slug: 'posts', label: t('ui.allPosts') || 'Articles', href: withLangParam('?tab=posts') });
  }
  Object.entries(tabs).forEach(([slug, info]) => {
    if (!slug) return;
    links.push({
      slug,
      label: text(info && info.title, slug),
      href: withLangParam(`?tab=${encodeURIComponent(slug)}`)
    });
  });
  nav.innerHTML = links.map((link) => `<a class="${link.slug === active ? 'is-active' : ''}" href="${attr(link.href)}">${escapeHtml(link.label)}</a>`).join('');
  return true;
}

function renderFooterLinks(config = activeSiteConfig, params = {}) {
  const linksRegion = activeShell && activeShell.querySelector('[data-glasswing-site-links]');
  if (!linksRegion) return false;
  const { t, withLangParam } = getI18n(params);
  const profileLinks = Array.isArray(config && config.profileLinks) ? config.profileLinks : [];
  const links = [
    { label: t('ui.allPosts') || 'All Posts', href: withLangParam('?tab=posts') },
    ...profileLinks
      .map((item) => ({
        label: text(item && item.label),
        href: text(item && item.href)
      }))
      .filter((item) => item.label && item.href)
  ];
  linksRegion.innerHTML = `<h2>Site</h2>${links.map((item) => `<a href="${attr(item.href)}">${escapeHtml(item.label)}</a>`).join('')}`;
  return true;
}

function renderSiteIdentity(params = {}) {
  const brand = activeShell && activeShell.querySelector('[data-glasswing-brand]');
  const config = params.config || params.siteConfig || {};
  activeSiteConfig = config;
  const title = firstConfigText(config.siteTitle, 'Press');
  if (brand) brand.textContent = title;
  const footerBrand = activeShell && activeShell.querySelector('[data-glasswing-footer-brand]');
  if (footerBrand) footerBrand.textContent = title;
  renderFooterLinks(config, params);
  return !!brand || !!footerBrand;
}

function ensureFooterStructure(footer) {
  if (!footer) return null;
  const doc = footer.ownerDocument || getDocument();
  if (!doc) return null;
  let inner = footer.querySelector('.glasswing-footer__inner');
  if (!inner) {
    footer.textContent = '';
    inner = doc.createElement('div');
    inner.className = 'glasswing-footer__inner';
    inner.innerHTML = `<div class="glasswing-footer__brand">
      <a href="?tab=posts" data-glasswing-footer-brand>Press</a>
      <span data-glasswing-footer-tagline>Glasswing for Press</span>
    </div>
    <nav class="glasswing-footer__links" aria-label="Site links" data-glasswing-site-links></nav>
    <div class="glasswing-footer__toc is-empty" data-glasswing-footer-toc>
      <h2 data-glasswing-footer-toc-title>Table of contents</h2>
    </div>
    <div class="glasswing-footer__tools" data-theme-region="tools" id="toolsPanel"></div>
    <div class="glasswing-footer__meta">
      <button type="button" data-glasswing-top>Top</button>
      <span data-glasswing-year></span>
    </div>`;
    footer.appendChild(inner);
  }
  const tocWrap = footer.querySelector('[data-glasswing-footer-toc]');
  if (tocWrap && !tocWrap.querySelector('[data-glasswing-footer-toc-title]')) {
    const heading = doc.createElement('h2');
    heading.setAttribute('data-glasswing-footer-toc-title', '');
    heading.textContent = 'Table of contents';
    tocWrap.insertBefore(heading, tocWrap.firstChild || null);
  }
  const tools = footer.querySelector('[data-theme-region="tools"]');
  if (tools) {
    tools.setAttribute('data-theme-region', 'tools');
    tools.id = 'toolsPanel';
    activeRegions.tools = tools;
  }
  return {
    inner,
    tools,
    toc: footer.querySelector('[data-glasswing-footer-toc]'),
    brand: footer.querySelector('[data-glasswing-footer-brand]'),
    year: footer.querySelector('[data-glasswing-year]'),
    top: footer.querySelector('[data-glasswing-top]')
  };
}

function setFooterTocEmpty(empty = true) {
  const wrap = activeShell && activeShell.querySelector('[data-glasswing-footer-toc]');
  if (!wrap) return;
  wrap.classList.toggle('is-empty', !!empty);
  const inner = wrap.closest('.glasswing-footer__inner');
  if (inner) inner.classList.toggle('has-toc', !empty);
}

function setupThemeControls(params = {}) {
  const footer = getRegion({ regions: activeRegions }, 'footer');
  const structure = ensureFooterStructure(footer);
  const tools = structure && structure.tools;
  if (!tools) return false;
  try {
    const mount = params.mountThemeControls || mountThemeControls;
    if (typeof mount === 'function') mount({ host: tools, variant: 'glasswing' });
  } catch (_) {}
  try {
    const applyTheme = params.applySavedTheme || applySavedTheme;
    if (typeof applyTheme === 'function') applyTheme();
  } catch (_) {}
  return true;
}

function resetThemeControls(params = {}) {
  const footer = getRegion({ regions: activeRegions }, 'footer');
  const structure = ensureFooterStructure(footer);
  if (!structure || !structure.tools) return false;
  structure.tools.innerHTML = '';
  return setupThemeControls(params);
}

function setupFooter(params = {}) {
  const footer = getRegion({ regions: activeRegions }, 'footer');
  if (!footer) return false;
  const structure = ensureFooterStructure(footer);
  const year = new Date().getFullYear();
  if (structure && structure.year) structure.year.textContent = String(year);
  renderSiteIdentity({ config: activeSiteConfig, ...params });
  if (structure && structure.tools && !structure.tools.querySelector('press-theme-controls')) {
    setupThemeControls(params);
  }
  const button = structure && structure.top;
  const win = params.window || activeWindow;
  if (button && win && button.dataset.glasswingBound !== '1') {
    button.dataset.glasswingBound = '1';
    button.addEventListener('click', () => {
      try { win.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { try { win.scrollTo(0, 0); } catch (__) {} }
    });
  }
  return true;
}

function resolveViewContainers() {
  return {
    mainElement: activeRegions.main,
    tocElement: activeRegions.toc,
    sidebarElement: activeRegions.tags,
    contentElement: activeRegions.content,
    containerElement: activeRegions.container
  };
}

function getViewContainer(params = {}) {
  const role = String(params.role || 'main');
  if (role === 'sidebar') return activeRegions.tags;
  return activeRegions[role] || activeRegions.main || null;
}

let activeRegions = {};
let activeShell = null;
let activeWindow = null;
let activeSiteConfig = {};

export function mount(context = {}) {
  const doc = getDocument(context);
  activeWindow = getWindow(context);
  if (!doc || !doc.body) return context;

  const shell = ensureElement(doc.body, '[data-theme-root="glasswing"]', () => {
    const element = doc.createElement('div');
    element.setAttribute('data-theme-root', 'glasswing');
    doc.body.insertBefore(element, doc.body.firstChild);
    return element;
  });
  shell.className = 'glasswing-shell';
  shell.setAttribute('data-theme-region', 'container');
  activeShell = shell;

  const header = ensureElement(shell, '.glasswing-header', () => {
    const element = doc.createElement('header');
    element.className = 'glasswing-header';
    return element;
  });

  const brand = ensureElement(header, '[data-glasswing-brand]', () => {
    const element = doc.createElement('a');
    element.href = '?tab=posts';
    element.className = 'glasswing-brand';
    element.setAttribute('data-glasswing-brand', '');
    element.textContent = 'Press';
    return element;
  });
  brand.href = '?tab=posts';

  const nav = ensureElement(header, '[data-theme-region="nav"]', () => {
    const element = doc.createElement('nav');
    element.className = 'glasswing-nav';
    element.setAttribute('aria-label', 'Primary navigation');
    return element;
  });
  nav.setAttribute('data-theme-region', 'nav');

  const search = ensureElement(header, '[data-theme-region="search"]', () => {
    const element = doc.createElement('press-search');
    element.className = 'glasswing-search';
    return element;
  });
  search.setAttribute('data-theme-region', 'search');

  const main = ensureElement(shell, '[data-theme-region="main"]', () => {
    const element = doc.createElement('main');
    element.className = 'glasswing-main';
    element.setAttribute('role', 'main');
    element.setAttribute('tabindex', '-1');
    return element;
  });
  main.setAttribute('data-theme-region', 'main');

  const tags = ensureElement(shell, '[data-theme-region="tags"]', () => {
    const element = doc.createElement('aside');
    element.className = 'glasswing-tags';
    element.setAttribute('aria-label', 'Tags');
    return element;
  });
  tags.setAttribute('data-theme-region', 'tags');

  const footer = ensureElement(shell, '[data-theme-region="footer"]', () => {
    const element = doc.createElement('footer');
    element.className = 'glasswing-footer';
    element.setAttribute('role', 'contentinfo');
    return element;
  });
  footer.setAttribute('data-theme-region', 'footer');
  const footerStructure = ensureFooterStructure(footer);
  const tocHost = (footerStructure && footerStructure.toc) || footer;
  let toc = tocHost.querySelector('[data-theme-region="toc"]') || shell.querySelector('[data-theme-region="toc"]');
  if (!toc) {
    toc = doc.createElement('press-toc');
  }
  toc.className = 'glasswing-toc';
  toc.setAttribute('data-theme-region', 'toc');
  toc.setAttribute('show-top', 'false');
  toc.setAttribute('toc-title', '');
  if (toc.parentElement !== tocHost) tocHost.appendChild(toc);
  setFooterTocEmpty(!toc.innerHTML.trim());

  activeRegions = {
    container: shell,
    content: main,
    footer,
    main,
    nav,
    search,
    tags,
    toc,
    tools: footerStructure && footerStructure.tools
  };

  if (context.regions && typeof context.regions.registerMany === 'function') {
    context.regions.registerMany(activeRegions);
    activeRegions = context.regions;
  } else {
    context.regions = activeRegions;
  }

  return { views, components, effects, regions: activeRegions };
}

export const views = {
  post: renderPost,
  posts: renderPosts,
  search: renderSearch,
  tab: renderTab,
  error: renderError,
  loading: renderLoading
};

export const components = {};

export const effects = {
  getViewContainer,
  resolveViewContainers,
  renderSiteIdentity,
  renderTabs,
  renderFooterNav: () => true,
  renderSiteLinks: (params = {}) => {
    activeSiteConfig = params.config || params.siteConfig || activeSiteConfig || {};
    return renderFooterLinks(activeSiteConfig, params);
  },
  setupThemeControls,
  resetThemeControls,
  renderTagSidebar: (params = {}) => clearRegion((params.containers && params.containers.sidebarElement) || activeRegions.tags),
  resetTOC: (params = {}) => {
    const cleared = clearRegion((params.containers && params.containers.tocElement) || activeRegions.toc);
    setFooterTocEmpty(true);
    return cleared;
  },
  renderPostTOC: (params = {}) => {
    const toc = params.tocElement || activeRegions.toc;
    if (!toc) return false;
    const hasToc = !!String(params.tocHtml || '').trim();
    setFooterTocEmpty(!hasToc);
    toc.setAttribute('show-top', 'false');
    toc.setAttribute('toc-title', '');
    params = { ...params, articleTitle: '' };
    if (typeof toc.renderToc === 'function') {
      toc.renderToc(params);
      return true;
    }
    toc.innerHTML = params.tocHtml || '';
    return true;
  },
  renderPostView: renderPost,
  renderIndexView: renderPosts,
  renderSearchResults: renderSearch,
  renderStaticTabView: renderTab,
  renderErrorState: renderError,
  renderPostLoadingState: renderLoading,
  renderStaticTabLoadingState: renderLoading,
  enhanceIndexLayout: () => true,
  afterIndexRender: () => true,
  afterSearchRender: () => true,
  setupFooter
};

export function createThemeApi() {
  return { views, components, effects };
}

export default {
  mount,
  views,
  components,
  effects
};
