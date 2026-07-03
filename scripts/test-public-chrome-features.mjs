import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = readFileSync(resolve(root, 'theme/modules/glasswing.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'theme/theme.json'), 'utf8'));
const releaseExample = JSON.parse(readFileSync(resolve(root, 'theme-release.example.json'), 'utf8'));
function resolvePressRoot() {
  const candidates = [];
  if (process.env.PRESS_ROOT) candidates.push(resolve(root, process.env.PRESS_ROOT));
  candidates.push(resolve(root, '.press'));
  candidates.push(resolve(root, '..', 'Press'));
  const found = candidates.find((candidate) => existsSync(resolve(candidate, 'assets/js/site-features.js')));
  return found || candidates[0];
}
const pressRoot = resolvePressRoot();

assert.equal(manifest.contractVersion, 3);
assert.equal(manifest.engines.press, '>=3.4.127 <4.0.0');
assert.equal(releaseExample.contractVersion, 3);
assert.equal(releaseExample.engines.press, '>=3.4.127 <4.0.0');
assert.ok(manifest.components.includes('press-theme-controls'), 'manifest should declare shared theme controls usage');
assert.doesNotMatch(source, /href\s*=\s*["']\?tab=posts["']/);
assert.doesNotMatch(source, /element\.href\s*=\s*["']\?tab=posts["']/);
assert.doesNotMatch(source, /brand\.href\s*=\s*["']\?tab=posts["']/);
assert.match(source, /siteFeatureContextEnabled/);
assert.match(source, /sanitizeUrl/);
assert.match(source, /function getRouter[\s\S]*ctx\.router/);
assert.match(source, /function getI18n[\s\S]*getRouter\(params\)[\s\S]*router\.withLangParam/);
assert.match(source, /function updateHomeLinks[\s\S]*routerFunction\(params, 'getHomeSlug'\)/);
assert.match(source, /function updateHomeLinks[\s\S]*getHomeSlug[\s\S]*data-glasswing-brand/);
assert.match(source, /function updateSearchChrome/);

[
  'visitorThemeControls',
  'footerNav',
  'profileLinks',
  'search',
  'tags',
  'toc',
  'postMeta'
].forEach((key) => {
  assert.match(source, new RegExp(`featureEnabled\\([\\s\\S]*['"]${key}['"]`), `${key} should be gated`);
});

assert.doesNotMatch(source, /renderFooterNav:\s*\(\)\s*=>\s*true/);
assert.match(
  source,
  /utilities\.renderPostTOC\(\{[\s\S]*features: params\.features[\s\S]*\}\);/,
  'post TOC utility calls should forward the feature context'
);
assert.match(
  source,
  /if \(!featureEnabled\(params, 'tags'\) \|\| !featureEnabled\(params, 'search'\)\) \{/,
  'tag sidebar should hide when either tags or search is disabled'
);
assert.match(
  source,
  /function renderMeta\(meta = \{\}, params = \{\}\)[\s\S]*featureEnabled\(params, 'tags'\) && featureEnabled\(params, 'search'\) \? getTags\(meta\) : \[\]/,
  'card metadata should hide tags when tags or search are disabled'
);

class TestClassList {
  constructor(element) {
    this.element = element;
  }

  _set(values) {
    this.element.className = Array.from(values).join(' ');
  }

  _values() {
    return new Set(String(this.element.className || '').split(/\s+/).filter(Boolean));
  }

  add(...classes) {
    const values = this._values();
    classes.forEach((cls) => { if (cls) values.add(String(cls)); });
    this._set(values);
  }

  remove(...classes) {
    const values = this._values();
    classes.forEach((cls) => values.delete(String(cls)));
    this._set(values);
  }

  toggle(cls, force) {
    const values = this._values();
    const name = String(cls || '');
    const shouldAdd = force == null ? !values.has(name) : !!force;
    if (shouldAdd) values.add(name);
    else values.delete(name);
    this._set(values);
    return shouldAdd;
  }

  contains(cls) {
    return this._values().has(String(cls || ''));
  }
}

function dataKey(name) {
  return String(name || '').slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function matchesSelector(element, selector) {
  const raw = String(selector || '').trim();
  if (!raw) return false;
  if (raw.includes(',')) return raw.split(',').some((part) => matchesSelector(element, part));
  if (raw.startsWith('.')) return String(element.className || '').split(/\s+/).includes(raw.slice(1));
  if (raw.startsWith('#')) return element.id === raw.slice(1);
  const attrMatch = raw.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attrMatch) {
    const [, name, expected] = attrMatch;
    const actual = element.getAttribute(name);
    return expected == null ? actual != null : actual === expected;
  }
  return element.tagName.toLowerCase() === raw.toLowerCase();
}

function findFirst(rootElement, selector) {
  for (const child of rootElement.children) {
    if (matchesSelector(child, selector)) return child;
    const nested = findFirst(child, selector);
    if (nested) return nested;
  }
  return null;
}

function findAll(rootElement, selector, out = []) {
  for (const child of rootElement.children) {
    if (matchesSelector(child, selector)) out.push(child);
    findAll(child, selector, out);
  }
  return out;
}

class TestElement {
  constructor(tagName = 'div', ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.className = '';
    this.id = '';
    this.hidden = false;
    this.textContent = '';
    this.style = {};
    this.classList = new TestClassList(this);
    this._innerHTML = '';
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.children = [];
    if (this._innerHTML.includes('data-glasswing-footer-brand')) {
      materializeFooterTemplate(this);
    }
  }

  appendChild(child) {
    if (!child) return child;
    child.parentElement = this;
    child.ownerDocument = child.ownerDocument || this.ownerDocument;
    this.children.push(child);
    return child;
  }

  insertBefore(child, ref) {
    const index = this.children.indexOf(ref);
    if (index < 0) return this.appendChild(child);
    child.parentElement = this;
    child.ownerDocument = child.ownerDocument || this.ownerDocument;
    this.children.splice(index, 0, child);
    return child;
  }

  setAttribute(name, value = '') {
    const key = String(name);
    const str = String(value);
    this.attributes.set(key, str);
    if (key === 'id') this.id = str;
    if (key === 'class') this.className = str;
    if (key === 'hidden') this.hidden = true;
    if (key.startsWith('data-')) this.dataset[dataKey(key)] = str;
  }

  getAttribute(name) {
    const key = String(name);
    if (this.attributes.has(key)) return this.attributes.get(key);
    if (key === 'id' && this.id) return this.id;
    if (key === 'class' && this.className) return this.className;
    return null;
  }

  removeAttribute(name) {
    const key = String(name);
    this.attributes.delete(key);
    if (key === 'hidden') this.hidden = false;
  }

  querySelector(selector) {
    return findFirst(this, selector);
  }

  querySelectorAll(selector) {
    return findAll(this, selector);
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  addEventListener() {}
  removeEventListener() {}
}

class TestDocument {
  constructor() {
    this.body = new TestElement('body', this);
    this.documentElement = new TestElement('html', this);
    this.defaultView = {
      location: { href: 'https://example.test/', origin: 'https://example.test', pathname: '/' },
      matchMedia: () => ({ matches: false }),
      scrollTo() {},
      addEventListener() {},
      removeEventListener() {}
    };
  }

  createElement(tagName) {
    return new TestElement(tagName, this);
  }

  querySelector(selector) {
    if (matchesSelector(this.body, selector)) return this.body;
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    const out = [];
    if (matchesSelector(this.body, selector)) out.push(this.body);
    return this.body.querySelectorAll(selector).reduce((items, item) => {
      items.push(item);
      return items;
    }, out);
  }
}

function materializeFooterTemplate(parent) {
  const doc = parent.ownerDocument;
  const create = (tag, attrs = {}, text = '') => {
    const element = new TestElement(tag, doc);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') element.className = value;
      else if (key === 'id') element.id = value;
      else element.setAttribute(key, value);
    });
    element.textContent = text;
    return element;
  };
  const brand = create('div', { className: 'glasswing-footer__brand' });
  brand.appendChild(create('a', { 'data-glasswing-footer-brand': '' }, 'Press'));
  brand.appendChild(create('span', { 'data-glasswing-footer-tagline': '' }, 'Glasswing for Press'));
  parent.appendChild(brand);
  parent.appendChild(create('nav', { className: 'glasswing-footer__links', 'data-glasswing-site-links': '' }));
  const toc = create('div', { className: 'glasswing-footer__toc is-empty', 'data-glasswing-footer-toc': '' });
  toc.appendChild(create('h2', { 'data-glasswing-footer-toc-title': '' }, 'Table of contents'));
  parent.appendChild(toc);
  parent.appendChild(create('div', { className: 'glasswing-footer__tools', 'data-theme-region': 'tools', id: 'toolsPanel' }));
  const meta = create('div', { className: 'glasswing-footer__meta' });
  meta.appendChild(create('button', { 'data-glasswing-top': '' }, 'Top'));
  meta.appendChild(create('span', { 'data-glasswing-year': '' }));
  parent.appendChild(meta);
}

function disabledFooterFeatures() {
  return {
    isEnabled(key) {
      return !['visitorThemeControls', 'footerNav', 'profileLinks', 'allPosts'].includes(String(key || ''));
    }
  };
}

async function importGlasswingModule() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'glasswing-feature-test-'));
  const tempModuleDir = resolve(tempRoot, 'assets/themes/glasswing/modules');
  mkdirSync(tempModuleDir, { recursive: true });
  mkdirSync(resolve(tempRoot, 'assets'), { recursive: true });
  symlinkSync(resolve(pressRoot, 'assets/js'), resolve(tempRoot, 'assets/js'), 'dir');
  writeFileSync(resolve(tempModuleDir, 'glasswing.js'), source);
  return import(`${pathToFileURL(resolve(tempModuleDir, 'glasswing.js')).href}?feature-test=${Date.now()}-${Math.random()}`);
}

const doc = new TestDocument();
globalThis.document = doc;
globalThis.window = doc.defaultView;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const glasswing = await importGlasswingModule();
const features = disabledFooterFeatures();
const api = glasswing.mount({
  document: doc,
  window: doc.defaultView,
  features,
  i18n: {
    t: (key) => key,
    withLangParam: (href) => href
  }
});
const params = {
  config: {
    siteTitle: 'Product',
    profileLinks: [{ label: 'GitHub', href: 'https://github.com/example/product' }]
  },
  features,
  withLangParam: (href) => href,
  getHomeSlug: () => 'about',
  getHomeLabel: () => 'About',
  postsEnabled: () => false,
  mountThemeControls: () => {
    throw new Error('visitor theme controls should stay disabled');
  }
};

api.effects.renderSiteIdentity(params);
api.effects.setupFooter(params);

const brand = doc.querySelector('[data-glasswing-brand]');
const footerBrand = doc.querySelector('[data-glasswing-footer-brand]');
assert.equal(brand.getAttribute('href'), '?tab=about', 'site brand should use the runtime home helper');
assert.equal(footerBrand.getAttribute('href'), '?tab=about', 'footer brand should use the runtime home helper');

api.effects.renderSiteIdentity({
  config: { siteTitle: 'Product refreshed' },
  features,
  withLangParam: (href) => href
});

assert.equal(brand.getAttribute('href'), '?tab=about', 'identity refresh without home helpers should preserve brand home href');
assert.equal(footerBrand.getAttribute('href'), '?tab=about', 'identity refresh without home helpers should preserve footer home href');

const links = doc.querySelector('[data-glasswing-site-links]');
assert.equal(links.hidden, true, 'late footer setup should keep footer links hidden');
assert.equal(links.innerHTML, '', 'late footer setup should not restore footer links');
assert.doesNotMatch(links.innerHTML, /GitHub|\?tab=posts/, 'late footer setup should not restore profile or posts links');

const tools = doc.querySelector('[data-theme-region="tools"]');
assert.equal(tools.hidden, true, 'late footer setup should keep visitor theme controls hidden');
assert.equal(tools.innerHTML, '', 'late footer setup should not mount visitor theme controls');

const enabledDoc = new TestDocument();
const enabledFeatures = { isEnabled: () => true };
const enabledApi = glasswing.mount({
  document: enabledDoc,
  window: enabledDoc.defaultView,
  features: enabledFeatures,
  i18n: {
    t: (key) => key,
    withLangParam: (href) => href
  }
});
const enabledParams = {
  config: {
    siteTitle: 'Product',
    profileLinks: [
      { label: 'Unsafe', href: 'javascript:alert(1)' },
      { label: 'Mail', href: 'mailto:hello@example.test' }
    ]
  },
  features: enabledFeatures,
  withLangParam: (href) => href,
  getHomeSlug: () => 'about',
  getHomeLabel: () => 'About',
  postsEnabled: () => false
};
enabledApi.effects.renderSiteIdentity(enabledParams);
enabledApi.effects.setupFooter(enabledParams);
const enabledLinks = enabledDoc.querySelector('[data-glasswing-site-links]');
assert.match(enabledLinks.innerHTML, /href="#"/, 'Glasswing should replace unsafe profile link URL schemes');
assert.match(enabledLinks.innerHTML, /href="mailto:hello@example.test"/, 'Glasswing should preserve safe profile link URL schemes');
assert.doesNotMatch(enabledLinks.innerHTML, /javascript:/i, 'Glasswing should not render javascript profile URLs');

console.log('ok - Glasswing public chrome feature gates');
