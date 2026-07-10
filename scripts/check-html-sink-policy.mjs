#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const POLICY_PATH = path.join(SCRIPT_DIR, 'html-sink-policy.json');
const HTML_ASSIGNMENT_PROPERTIES = new Map([
  ['innerHTML', 'innerHTML-write'],
  ['outerHTML', 'outerHTML-write'],
  ['srcdoc', 'srcdoc-write']
]);
const HTML_CALL_PROPERTIES = new Map([
  ['createContextualFragment', 'createContextualFragment-call'],
  ['html', 'html-method-call'],
  ['insertAdjacentHTML', 'insertAdjacentHTML-call'],
  ['setHTML', 'setHTML-call'],
  ['setHTMLUnsafe', 'setHTMLUnsafe-call']
]);
const NATIVE_CALLABLE_HTML_SINKS = new Set([...HTML_CALL_PROPERTIES.keys(), 'parseFromString']);
const REFLECTED_HTML_PROPERTIES = new Set(HTML_ASSIGNMENT_PROPERTIES.keys());
const ALLOWED_DISPOSITIONS = new Set([
  'controlled-detached-parser',
  'empty-clear',
  'escaped-theme-template',
  'press-renderer-output',
  'static-theme-template',
  'trusted-wrapper-call'
]);

function unwrap(node) {
  let current = node;
  while (current?.type === 'ChainExpression') current = current.expression;
  return current;
}

function staticString(node, resolveIdentifier = null, seen = new Set()) {
  const current = unwrap(node);
  if (current?.type === 'Literal' && typeof current.value === 'string') return current.value;
  if (current?.type === 'TemplateLiteral' && current.expressions.length === 0) {
    return current.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
  }
  if (current?.type === 'Identifier' && resolveIdentifier) {
    const binding = resolveIdentifier(current);
    if (!binding || seen.has(binding)) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(binding);
    return staticString(binding.init, resolveIdentifier, nextSeen);
  }
  return null;
}

function memberPropertyName(node, resolveIdentifier = null) {
  const current = unwrap(node);
  if (current?.type !== 'MemberExpression') return '';
  if (!current.computed && current.property.type === 'Identifier') return current.property.name;
  return current.computed ? staticString(current.property, resolveIdentifier) || '' : '';
}

function isDocumentReference(node) {
  const current = unwrap(node);
  if (!current) return false;
  if (current.type === 'Identifier') return /^(?:doc|document|documentRef)$/u.test(current.name);
  if (current.type !== 'MemberExpression') return false;
  return memberPropertyName(current) === 'document';
}

function objectPropertyName(property, resolveIdentifier) {
  if (!property || (property.type !== 'Property' && property.type !== 'MethodDefinition')) return '';
  if (property.computed) return staticString(property.key, resolveIdentifier) || '';
  if (property.key?.type === 'Identifier') return property.key.name;
  return staticString(property.key, resolveIdentifier) || '';
}

function fingerprint(filePath, kind, source) {
  const normalizedSource = source.replace(/\r\n?/gu, '\n');
  return `sha256:${createHash('sha256').update(`${filePath}\0${kind}\0${normalizedSource}`).digest('hex')}`;
}

function inventoryKey(record) {
  return [record.path, record.kind, record.fingerprint, String(record.occurrence)].join('|');
}

function gitText(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  }).trim();
}

function resolveCommit(ref, label) {
  const commit = gitText(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error(`${label} must resolve to an exact commit SHA`);
  return commit;
}

function resolveComparison() {
  const baseRef = String(process.env.CODE_QUALITY_BASE_REF || '').trim();
  const declaredHead = String(process.env.CODE_QUALITY_HEAD_SHA || '').trim();
  if (declaredHead && !baseRef) throw new Error('CODE_QUALITY_HEAD_SHA requires CODE_QUALITY_BASE_REF');
  if (!baseRef) return null;
  const checkout = resolveCommit('HEAD', 'checkout HEAD');
  const head = declaredHead ? resolveCommit(declaredHead, 'CODE_QUALITY_HEAD_SHA') : checkout;
  if (checkout !== head) {
    throw new Error(`checked out HEAD ${checkout} does not match CODE_QUALITY_HEAD_SHA ${head}`);
  }
  const baseTip = resolveCommit(baseRef, 'CODE_QUALITY_BASE_REF');
  return {
    base: resolveCommit(gitText(['merge-base', baseTip, head]), 'HTML sink merge base'),
    head
  };
}

function loadPolicyAtRef(ref) {
  const repositoryPath = 'scripts/html-sink-policy.json';
  const result = spawnSync('git', ['show', `${ref}:${repositoryPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status === 0) {
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`${ref}:${repositoryPath} is invalid JSON: ${error.message}`, {
        cause: error
      });
    }
  }
  const message = String(result.stderr || result.stdout || '').trim();
  if (/does not exist in|exists on disk, but not in|path .* does not exist/u.test(message)) {
    return null;
  }
  throw new Error(`cannot read ${repositoryPath} at ${ref}: ${message || `git exited ${result.status}`}`);
}

function parseJavaScript({ filePath, source, wrapperNames }) {
  const rawFindings = [];
  const calls = [];
  const wrapperSet = new Set(wrapperNames);
  const collectorRule = {
    create(context) {
      const sourceCode = context.sourceCode;
      const recordedOccurrences = new Set();
      const resolveIdentifier = (identifier) => {
        let scope = sourceCode.getScope(identifier);
        let variable = null;
        while (scope && !variable) {
          variable = scope.set.get(identifier.name) || null;
          scope = scope.upper;
        }
        if (!variable || variable.defs.length !== 1) return null;
        const definition = variable.defs[0];
        if (
          definition.type !== 'Variable' ||
          definition.parent?.kind !== 'const' ||
          definition.node?.id?.type !== 'Identifier' ||
          !definition.node.init
        ) {
          return null;
        }
        if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
        return definition.node;
      };
      const record = (node, kind) => {
        const occurrenceKey = `${node.range[0]}:${node.range[1]}:${kind}`;
        if (recordedOccurrences.has(occurrenceKey)) return;
        recordedOccurrences.add(occurrenceKey);
        rawFindings.push({
          path: filePath,
          kind,
          source: sourceCode.getText(node),
          start: node.range[0],
          line: node.loc.start.line,
          column: node.loc.start.column + 1
        });
      };
      const isDeclarationOrStaticKey = (node, parent) => {
        if (!parent) return true;
        if (
          (parent.type === 'FunctionDeclaration' ||
            parent.type === 'FunctionExpression' ||
            parent.type === 'ClassDeclaration') &&
          parent.id === node
        ) {
          return true;
        }
        if (parent.type === 'VariableDeclarator' && parent.id === node) return true;
        if (
          (parent.type === 'ImportSpecifier' ||
            parent.type === 'ImportDefaultSpecifier' ||
            parent.type === 'ImportNamespaceSpecifier') &&
          parent.local === node
        ) {
          return true;
        }
        if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
          return true;
        }
        if (
          (parent.type === 'Property' || parent.type === 'MethodDefinition') &&
          parent.key === node &&
          !parent.computed &&
          !parent.shorthand
        ) {
          return true;
        }
        return false;
      };
      const isDirectMemberCall = (node) => {
        const ancestors = sourceCode.getAncestors(node);
        let candidate = node;
        let index = ancestors.length - 1;
        while (
          index >= 0 &&
          ancestors[index]?.type === 'ChainExpression' &&
          ancestors[index].expression === candidate
        ) {
          candidate = ancestors[index];
          index -= 1;
        }
        const parent = ancestors[index];
        return parent?.type === 'CallExpression' && unwrap(parent.callee) === node;
      };
      const isGlobalMethod = (callee, objectName, methodName) => {
        const member = unwrap(callee);
        if (member?.type !== 'MemberExpression' || memberPropertyName(member, resolveIdentifier) !== methodName) {
          return false;
        }
        const object = unwrap(member.object);
        if (object?.type === 'Identifier') return object.name === objectName;
        return object?.type === 'MemberExpression' && memberPropertyName(object, resolveIdentifier) === objectName;
      };
      return {
        Identifier(node) {
          if (!wrapperSet.has(node.name)) return;
          const ancestors = sourceCode.getAncestors(node);
          const parent = ancestors.at(-1);
          if (isDeclarationOrStaticKey(node, parent)) return;
          if (parent?.type === 'CallExpression' && unwrap(parent.callee) === node) return;
          record(node, `html-wrapper-indirect-reference:${node.name}`);
        },
        Property(node) {
          const ancestors = sourceCode.getAncestors(node);
          if (ancestors.at(-1)?.type !== 'ObjectPattern') return;
          const property = objectPropertyName(node, resolveIdentifier);
          if (NATIVE_CALLABLE_HTML_SINKS.has(property)) {
            record(node, `html-native-sink-indirect-reference:${property}`);
          }
        },
        MemberExpression(node) {
          const property = memberPropertyName(node, resolveIdentifier);
          if (!NATIVE_CALLABLE_HTML_SINKS.has(property) || isDirectMemberCall(node)) return;
          record(node, `html-native-sink-indirect-reference:${property}`);
        },
        AssignmentExpression(node) {
          const left = unwrap(node.left);
          const property = memberPropertyName(left, resolveIdentifier);
          const kind = HTML_ASSIGNMENT_PROPERTIES.get(property);
          if (kind) record(node, kind);
        },
        CallExpression(node) {
          const callee = unwrap(node.callee);
          if (callee?.type === 'Identifier' && wrapperSet.has(callee.name)) {
            calls.push({ node, name: callee.name, sourceCode });
          }
          if (callee?.type !== 'MemberExpression') return;
          const property = memberPropertyName(callee, resolveIdentifier);
          const directKind = HTML_CALL_PROPERTIES.get(property);
          if (directKind) record(node, directKind);
          if (isGlobalMethod(callee, 'Reflect', 'set')) {
            const reflectedProperty = staticString(node.arguments[1], resolveIdentifier);
            if (REFLECTED_HTML_PROPERTIES.has(reflectedProperty)) {
              record(node, `Reflect.set-${reflectedProperty}`);
            }
          }
          if (isGlobalMethod(callee, 'Reflect', 'get')) {
            const reflectedProperty = staticString(node.arguments[1], resolveIdentifier);
            if (NATIVE_CALLABLE_HTML_SINKS.has(reflectedProperty)) {
              record(node, `html-native-sink-indirect-reference:${reflectedProperty}`);
            }
          }
          if (isGlobalMethod(callee, 'Object', 'assign')) {
            for (const argument of node.arguments.slice(1)) {
              if (argument?.type !== 'ObjectExpression') continue;
              for (const reflectedProperty of argument.properties) {
                const reflectedName = objectPropertyName(reflectedProperty, resolveIdentifier);
                if (REFLECTED_HTML_PROPERTIES.has(reflectedName)) {
                  record(reflectedProperty, `Object.assign-${reflectedName}`);
                }
              }
            }
          }
          if (isGlobalMethod(callee, 'Object', 'defineProperty')) {
            const reflectedProperty = staticString(node.arguments[1], resolveIdentifier);
            if (REFLECTED_HTML_PROPERTIES.has(reflectedProperty)) {
              record(node, `Object.defineProperty-${reflectedProperty}`);
            }
          }
          if ((property === 'write' || property === 'writeln') && isDocumentReference(callee.object)) {
            record(node, 'document-write-call');
          }
          if (
            property === 'setAttribute' &&
            staticString(node.arguments[0], resolveIdentifier)?.toLowerCase() === 'srcdoc'
          ) {
            record(node, 'setAttribute-srcdoc-call');
          }
          if (
            property === 'setAttributeNS' &&
            staticString(node.arguments[1], resolveIdentifier)?.toLowerCase() === 'srcdoc'
          ) {
            record(node, 'setAttributeNS-srcdoc-call');
          }
          if (
            property === 'parseFromString' &&
            staticString(node.arguments[1], resolveIdentifier)?.trim().toLowerCase() === 'text/html'
          ) {
            record(node, 'DOMParser-text-html-call');
          }
          if (
            property === 'execCommand' &&
            staticString(node.arguments[0], resolveIdentifier)?.trim().toLowerCase() === 'inserthtml'
          ) {
            record(node, 'execCommand-insertHTML-call');
          }
        }
      };
    }
  };
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    source,
    [
      {
        files: ['**/*.{js,mjs}'],
        languageOptions: {
          ecmaVersion: 'latest',
          parserOptions: { range: true, loc: true },
          sourceType: 'module'
        },
        plugins: { inventory: { rules: { collect: collectorRule } } },
        rules: { 'inventory/collect': 'error' }
      }
    ],
    { filename: filePath }
  );
  if (messages.length > 0) {
    const details = messages
      .map((message) => `${filePath}:${message.line}:${message.column}: ${message.message}`)
      .join('\n');
    throw new Error(`HTML sink scanner could not parse source:\n${details}`);
  }
  for (const { node, name, sourceCode } of calls) {
    rawFindings.push({
      path: filePath,
      kind: `html-wrapper-call:${name}`,
      source: sourceCode.getText(node),
      start: node.range[0],
      line: node.loc.start.line,
      column: node.loc.start.column + 1
    });
  }
  return rawFindings;
}

export function scanJavaScriptSource({ filePath, source, wrapperNames = [] }) {
  const rawFindings = parseJavaScript({ filePath, source, wrapperNames });
  rawFindings.sort((left, right) => left.start - right.start || left.kind.localeCompare(right.kind));
  const occurrences = new Map();
  return rawFindings.map((finding) => {
    const digest = fingerprint(finding.path, finding.kind, finding.source);
    const identity = `${finding.path}|${finding.kind}|${digest}`;
    const occurrence = (occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, occurrence);
    return {
      path: finding.path,
      kind: finding.kind,
      fingerprint: digest,
      occurrence,
      line: finding.line,
      column: finding.column
    };
  });
}

async function listJavaScriptFiles(root, relativeRoot = '') {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listJavaScriptFiles(absolutePath, relativePath)));
    else if (entry.isFile() && /\.(?:js|mjs)$/u.test(entry.name)) files.push(relativePath);
  }
  return files;
}

export async function scanRepository({ wrappers = [] } = {}) {
  const wrapperNames = wrappers.map(({ name }) => name);
  const themeRoot = path.join(REPO_ROOT, 'theme');
  const inventory = [];
  for (const relativePath of await listJavaScriptFiles(themeRoot)) {
    const repositoryPath = path.posix.join('theme', relativePath);
    const source = await readFile(path.join(themeRoot, relativePath), 'utf8');
    inventory.push(
      ...scanJavaScriptSource({
        filePath: repositoryPath,
        source,
        wrapperNames
      })
    );
  }
  return inventory.sort((left, right) => inventoryKey(left).localeCompare(inventoryKey(right)));
}

function countKinds(records) {
  const counts = {};
  for (const record of records) counts[record.kind] = (counts[record.kind] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function verifyInventory(actual, policy) {
  const errors = [];
  if (policy?.schemaVersion !== 1) errors.push('policy schemaVersion must equal 1');
  if (policy?.decision !== 'reviewed-exact-fingerprint-baseline-with-zero-growth') {
    errors.push('policy decision must retain the reviewed exact-fingerprint baseline');
  }
  if (!Array.isArray(policy?.approved)) errors.push('policy approved must be an array');
  const approved = Array.isArray(policy?.approved) ? policy.approved : [];
  const wrappers = Array.isArray(policy?.wrappers) ? policy.wrappers : [];
  if (!Array.isArray(policy?.wrappers)) errors.push('policy wrappers must be an array');
  const wrapperNames = wrappers.map(({ name }) => name);
  if (new Set(wrapperNames).size !== wrapperNames.length) errors.push('policy wrapper names must be unique');
  for (const wrapper of wrappers) {
    if (typeof wrapper.name !== 'string' || !/^[A-Za-z_$][\w$]*$/u.test(wrapper.name)) {
      errors.push(`policy wrapper name is invalid: ${wrapper.name || '(missing)'}`);
    }
    if (typeof wrapper.rationale !== 'string' || wrapper.rationale.trim().length < 32) {
      errors.push(`policy wrapper rationale must be reviewable: ${wrapper.name || '(missing)'}`);
    }
  }
  const approvedKeys = approved.map(inventoryKey);
  if (new Set(approvedKeys).size !== approvedKeys.length) errors.push('policy approved entries must be unique');
  if (JSON.stringify([...approvedKeys].sort()) !== JSON.stringify(approvedKeys)) {
    errors.push('policy approved entries must be sorted by path, kind, fingerprint, and occurrence');
  }
  for (const record of approved) {
    if (!ALLOWED_DISPOSITIONS.has(record.disposition)) {
      errors.push(`unsupported disposition for ${inventoryKey(record)}: ${record.disposition || '(missing)'}`);
    }
    if (typeof record.rationale !== 'string' || record.rationale.trim().length < 32) {
      errors.push(`rationale must be reviewable for ${inventoryKey(record)}`);
    }
  }
  const actualMap = new Map(actual.map((record) => [inventoryKey(record), record]));
  const approvedMap = new Map(approved.map((record) => [inventoryKey(record), record]));
  for (const [key, record] of actualMap) {
    if (!approvedMap.has(key))
      errors.push(
        `unclassified sink ${record.path}:${record.line}:${record.column} ${record.kind} ${record.fingerprint}`
      );
  }
  for (const key of approvedMap.keys()) {
    if (!actualMap.has(key)) errors.push(`stale or changed approved sink ${key}`);
  }
  const actualCounts = countKinds(actual);
  if (JSON.stringify(policy?.expectedKinds || {}) !== JSON.stringify(actualCounts)) {
    errors.push(
      `expectedKinds mismatch: expected ${JSON.stringify(policy?.expectedKinds || {})}, observed ${JSON.stringify(actualCounts)}`
    );
  }
  return errors;
}

export function verifyPolicyTransition(basePolicy, headPolicy) {
  if (!basePolicy) return [];
  if (!Array.isArray(basePolicy.approved)) return ['merge-base policy approved must be an array'];
  if (!Array.isArray(headPolicy?.approved)) return ['head policy approved must be an array'];
  const baseKeys = new Set(basePolicy.approved.map(inventoryKey));
  const errors = [];
  const baseWrapperNames = new Set(
    Array.isArray(basePolicy.wrappers) ? basePolicy.wrappers.map(({ name }) => name) : []
  );
  const headWrapperNames = new Set(
    Array.isArray(headPolicy.wrappers) ? headPolicy.wrappers.map(({ name }) => name) : []
  );
  for (const name of baseWrapperNames) {
    if (!headWrapperNames.has(name)) errors.push(`HTML sink wrapper removal or rename is forbidden: ${name}`);
  }
  for (const record of headPolicy.approved) {
    const key = inventoryKey(record);
    if (!baseKeys.has(key)) errors.push(`HTML sink baseline growth is forbidden: ${key}`);
  }
  if (headPolicy.approved.length > basePolicy.approved.length) {
    errors.push(`HTML sink approved count grew from ${basePolicy.approved.length} to ${headPolicy.approved.length}`);
  }
  return errors.sort();
}

async function main() {
  const policy = JSON.parse(await readFile(POLICY_PATH, 'utf8'));
  const inventory = await scanRepository({ wrappers: policy.wrappers });
  if (process.argv.includes('--print-inventory')) {
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    return;
  }
  const errors = verifyInventory(inventory, policy);
  const comparison = resolveComparison();
  if (comparison) {
    const basePolicy = loadPolicyAtRef(comparison.base);
    errors.push(...verifyPolicyTransition(basePolicy, policy));
    if (!basePolicy) {
      process.stdout.write(`Bootstrapping HTML sink policy from ${comparison.base}; no merge-base policy exists.\n`);
    }
  }
  if (errors.length > 0) throw new Error(`HTML sink policy failed:\n- ${errors.join('\n- ')}`);
  process.stdout.write(`HTML sink policy passed for ${inventory.length} classified occurrences.\n`);
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
