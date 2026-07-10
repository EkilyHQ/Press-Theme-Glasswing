import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanJavaScriptSource,
  scanRepository,
  verifyInventory,
  verifyPolicyTransition
} from './check-html-sink-policy.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const detected = scanJavaScriptSource({
  filePath: 'theme/modules/fixture.js',
  wrapperNames: ['renderHtml'],
  source: `
    export function fixture(node, frame, range, parser, markup) {
      node.innerHTML = markup;
      node['outerHTML'] = markup;
      frame.srcdoc = markup;
      node.insertAdjacentHTML('beforeend', markup);
      node.setHTML(markup);
      node.setHTMLUnsafe(markup);
      node.html(markup);
      range.createContextualFragment(markup);
      document.write(markup);
      document.writeln(markup);
      frame.setAttribute('srcdoc', markup);
      frame.setAttributeNS(null, 'srcdoc', markup);
      parser.parseFromString(markup, 'text/html');
      document.execCommand('insertHTML', false, markup);
      renderHtml(node, markup);
    }
  `
});
assert.deepEqual(
  detected.map(({ kind }) => kind).sort(),
  [
    'DOMParser-text-html-call',
    'createContextualFragment-call',
    'document-write-call',
    'document-write-call',
    'execCommand-insertHTML-call',
    'html-method-call',
    'html-wrapper-call:renderHtml',
    'innerHTML-write',
    'insertAdjacentHTML-call',
    'outerHTML-write',
    'setAttribute-srcdoc-call',
    'setAttributeNS-srcdoc-call',
    'setHTML-call',
    'setHTMLUnsafe-call',
    'srcdoc-write'
  ].sort(),
  'known direct, computed, parser, document, iframe, library, and reviewed-wrapper HTML sinks must be inventoried'
);

const nonSinks = scanJavaScriptSource({
  filePath: 'theme/modules/non-sinks.js',
  source: `
    export function safe(node, parser, markup) {
      const serialized = node.innerHTML;
      node.textContent = '<b>text</b>';
      node.setAttribute('title', '<b>title</b>');
      const xml = parser.parseFromString(markup, 'application/xml');
      const reflected = Reflect.get(node, 'innerHTML');
      Object.assign(node, { textContent: markup });
      return [serialized, xml, reflected];
    }
  `
});
assert.deepEqual(
  nonSinks,
  [],
  'serializer reads and text-only DOM writes must remain outside the HTML-write inventory'
);

const directNativeCalls = scanJavaScriptSource({
  filePath: 'theme/modules/direct-native.js',
  source: `
    export function render(node, range, widget, parser, markup) {
      node.insertAdjacentHTML('beforeend', markup);
      range.createContextualFragment(markup);
      node.setHTML(markup);
      node.setHTMLUnsafe(markup);
      widget.html(markup);
      parser.parseFromString(markup, 'text/html');
    }
  `
});
assert.deepEqual(
  directNativeCalls.map(({ kind }) => kind).sort(),
  [
    'DOMParser-text-html-call',
    'createContextualFragment-call',
    'html-method-call',
    'insertAdjacentHTML-call',
    'setHTML-call',
    'setHTMLUnsafe-call'
  ].sort(),
  'direct native HTML sink calls must retain their existing classifications without indirect-reference duplicates'
);

const indirectNativeReferences = scanJavaScriptSource({
  filePath: 'theme/modules/indirect-native.js',
  source: `
    export const exportedHtml = globalWidget.html;
    export function capture(node, range, parser, consume) {
      const { insertAdjacentHTML: adjacent } = node;
      const contextual = Reflect.get(range, 'createContextualFragment').bind(range);
      node.setHTML.call(node, '<p>call</p>');
      node.setHTMLUnsafe.apply(node, ['<p>apply</p>']);
      consume(parser.parseFromString);
      return [adjacent, contextual, exportedHtml];
    }
  `
});
assert.deepEqual(
  indirectNativeReferences.map(({ kind }) => kind).sort(),
  [
    'html-native-sink-indirect-reference:createContextualFragment',
    'html-native-sink-indirect-reference:html',
    'html-native-sink-indirect-reference:insertAdjacentHTML',
    'html-native-sink-indirect-reference:parseFromString',
    'html-native-sink-indirect-reference:setHTML',
    'html-native-sink-indirect-reference:setHTMLUnsafe'
  ].sort(),
  'alias, bind, call, apply, callback, export, and parser references must fail closed when direct-call semantics are lost'
);

const reflectiveWrites = scanJavaScriptSource({
  filePath: 'theme/modules/reflective-writes.js',
  source: `
    const inner = 'innerHTML';
    const outer = 'outerHTML';
    export function reflect(target, markup, srcdoc) {
      Reflect.set(target, inner, markup);
      Object.assign(target, {
        srcdoc,
        [outer]: markup,
        ['innerHTML']: markup
      });
      Object.defineProperty(target, 'srcdoc', { value: markup });
    }
  `
});
assert.deepEqual(
  reflectiveWrites.map(({ kind }) => kind).sort(),
  [
    'Object.assign-innerHTML',
    'Object.assign-outerHTML',
    'Object.assign-srcdoc',
    'Object.defineProperty-srcdoc',
    'Reflect.set-innerHTML'
  ].sort(),
  'Reflect.set, Object.assign plain/computed properties, and defineProperty must expose reflective HTML writes'
);

const aliasedSinks = scanJavaScriptSource({
  filePath: 'theme/modules/aliased.js',
  source: `
    const property = 'innerHTML';
    const method = 'insertAdjacentHTML';
    const mime = 'text/html';
    export function render(node, parser, markup) {
      node[property] = markup;
      node[method]('beforeend', markup);
      parser.parseFromString(markup, mime);
    }
  `
});
assert.deepEqual(
  aliasedSinks.map(({ kind }) => kind).sort(),
  ['DOMParser-text-html-call', 'innerHTML-write', 'insertAdjacentHTML-call'].sort(),
  'lexically resolved constant property and MIME aliases must not bypass the sink inventory'
);

const shadowedAlias = scanJavaScriptSource({
  filePath: 'theme/modules/shadowed.js',
  source: `
    const property = 'innerHTML';
    export function render(node, property, markup) {
      node[property] = markup;
    }
  `
});
assert.deepEqual(shadowedAlias, [], 'an opaque parameter must shadow an unrelated safe-looking constant binding');

const indirectWrapperReferences = scanJavaScriptSource({
  filePath: 'theme/modules/wrapper-alias.js',
  wrapperNames: ['renderHtml'],
  source: `
    function renderHtml(node, markup) {
      node.innerHTML = markup;
    }
    const alias = renderHtml;
    const bound = renderHtml.bind(null);
    export const callbacks = { renderHtml };
    export function run(node, markup) {
      renderHtml(node, markup);
      return [alias, bound, callbacks, node, markup];
    }
  `
});
assert.equal(
  indirectWrapperReferences.filter(({ kind }) => kind === 'html-wrapper-indirect-reference:renderHtml').length,
  3,
  'aliasing, binding, or exporting a reviewed wrapper must produce fail-closed indirect-reference occurrences'
);
assert.equal(
  indirectWrapperReferences.filter(({ kind }) => kind === 'html-wrapper-call:renderHtml').length,
  1,
  'a direct reviewed wrapper call must remain separately inventoried'
);

const duplicateSource = `
  export function clear(first, second) {
    first.innerHTML = '';
    second.innerHTML = '';
  }
`;
const duplicateFirst = scanJavaScriptSource({
  filePath: 'theme/modules/duplicate.js',
  source: duplicateSource
});
const duplicateSecond = scanJavaScriptSource({
  filePath: 'theme/modules/duplicate.js',
  source: duplicateSource
});
assert.deepEqual(duplicateFirst, duplicateSecond, 'source fingerprints and duplicate ordinals must be deterministic');

const policy = JSON.parse(await readFile(path.join(SCRIPT_DIR, 'html-sink-policy.json'), 'utf8'));
const inventory = await scanRepository({ wrappers: policy.wrappers });
assert.deepEqual(verifyInventory(inventory, policy), [], 'the checked-in exact sink inventory must match theme source');

const changedInventory = structuredClone(inventory);
changedInventory[0].fingerprint = `sha256:${'0'.repeat(64)}`;
assert.ok(
  verifyInventory(changedInventory, policy).some((error) => /unclassified sink/u.test(error)),
  'a changed sink fingerprint must fail closed as unclassified'
);

const addedInventory = structuredClone(inventory);
addedInventory.push({
  path: 'theme/modules/new.js',
  kind: 'innerHTML-write',
  fingerprint: `sha256:${'1'.repeat(64)}`,
  occurrence: 1,
  line: 1,
  column: 1
});
assert.ok(
  verifyInventory(addedInventory, policy).some((error) => /unclassified sink/u.test(error)),
  'a new sink must fail closed as unclassified'
);

assert.deepEqual(
  verifyPolicyTransition(null, policy),
  [],
  'the first policy may bootstrap when the merge base has none'
);
const shrunkenPolicy = structuredClone(policy);
shrunkenPolicy.approved = shrunkenPolicy.approved.slice(1);
assert.deepEqual(
  verifyPolicyTransition(policy, shrunkenPolicy),
  [],
  'an established sink baseline may shrink after a sink is removed'
);
const expandedPolicy = structuredClone(policy);
expandedPolicy.approved.push({
  path: 'theme/modules/new.js',
  kind: 'innerHTML-write',
  fingerprint: `sha256:${'2'.repeat(64)}`,
  occurrence: 1,
  disposition: 'escaped-theme-template',
  rationale: 'A newly reviewed template must still be blocked by the permanent merge-base no-growth boundary.'
});
assert.ok(
  verifyPolicyTransition(policy, expandedPolicy).some((error) => /baseline growth is forbidden/u.test(error)),
  'updating the head policy must not authorize a new sink relative to the merge base'
);
const replacedFingerprintPolicy = structuredClone(policy);
replacedFingerprintPolicy.approved[0].fingerprint = `sha256:${'3'.repeat(64)}`;
assert.ok(
  verifyPolicyTransition(policy, replacedFingerprintPolicy).some((error) =>
    /baseline growth is forbidden/u.test(error)
  ),
  'replacing an approved fingerprint must be treated as sink growth even when the count is unchanged'
);
const duplicateGrowthPolicy = structuredClone(policy);
duplicateGrowthPolicy.approved.push({
  ...duplicateGrowthPolicy.approved[0],
  occurrence: 2
});
assert.ok(
  verifyPolicyTransition(policy, duplicateGrowthPolicy).some((error) => /approved count grew/u.test(error)),
  'duplicating an existing sink occurrence must fail the merge-base count boundary'
);
const removedWrapperPolicy = structuredClone(policy);
removedWrapperPolicy.wrappers = [];
assert.ok(
  verifyPolicyTransition(policy, removedWrapperPolicy).some((error) =>
    /wrapper removal or rename is forbidden/u.test(error)
  ),
  'an established wrapper name must not be removed from the head policy'
);
const renamedWrapperPolicy = structuredClone(policy);
renamedWrapperPolicy.wrappers[0].name = 'setMarkup';
assert.ok(
  verifyPolicyTransition(policy, renamedWrapperPolicy).some((error) =>
    /wrapper removal or rename is forbidden/u.test(error)
  ),
  'renaming an established wrapper must fail the merge-base transition'
);

process.stdout.write(`HTML sink policy self-test passed for ${inventory.length} repository occurrences.\n`);
