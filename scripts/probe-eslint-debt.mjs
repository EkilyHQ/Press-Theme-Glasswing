#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import globals from 'globals';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const POLICY_PATH = path.join(SCRIPT_DIR, 'code-quality-policy.json');
const MEASURED_RULES = ['no-empty', 'no-unused-vars', 'no-useless-assignment'];

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

function debtConfig() {
  return [
    {
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: globals.browser
      },
      rules: Object.fromEntries(MEASURED_RULES.map((rule) => [rule, 'error']))
    }
  ];
}

async function main() {
  const policy = JSON.parse(await readFile(POLICY_PATH, 'utf8'));
  const expected = policy.eslint?.measuredRules;
  assert.ok(Array.isArray(expected), 'code-quality policy must declare eslint.measuredRules');
  assert.deepEqual(
    expected.map(({ rule }) => rule).sort(),
    [...MEASURED_RULES].sort(),
    'the measured ESLint rule set must stay explicit'
  );

  const linter = new Linter({ configType: 'flat' });
  const counts = new Map(MEASURED_RULES.map((rule) => [rule, { diagnostics: 0, files: new Set() }]));
  const themeRoot = path.join(REPO_ROOT, 'theme');
  for (const relativePath of await listJavaScriptFiles(themeRoot)) {
    const repositoryPath = path.posix.join('theme', relativePath);
    const source = await readFile(path.join(themeRoot, relativePath), 'utf8');
    const messages = linter.verify(source, debtConfig(), {
      filename: repositoryPath
    });
    for (const message of messages) {
      if (!counts.has(message.ruleId)) {
        throw new Error(
          `${repositoryPath}:${message.line}:${message.column}: unexpected rule ${message.ruleId || '(parser)'}`
        );
      }
      const record = counts.get(message.ruleId);
      record.diagnostics += 1;
      record.files.add(repositoryPath);
    }
  }

  for (const record of expected) {
    const observed = counts.get(record.rule);
    assert.equal(
      observed.diagnostics,
      record.observedDiagnostics,
      `${record.rule} observedDiagnostics changed; review the source and policy together`
    );
    assert.equal(
      observed.files.size,
      record.observedAffectedFiles,
      `${record.rule} observedAffectedFiles changed; review the source and policy together`
    );
  }

  process.stdout.write(
    `ESLint debt probe passed: ${expected.map((record) => `${record.rule}=${record.observedDiagnostics}/${record.observedAffectedFiles}`).join(', ')}.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
