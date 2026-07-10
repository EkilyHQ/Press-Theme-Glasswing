import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const eslint = new ESLint({ cwd: REPO_ROOT });
const probePath = path.join(REPO_ROOT, 'scripts', 'fixtures', 'eslint-policy', 'inline-disable-probe.mjs');

const projectConfig = await eslint.calculateConfigForFile(probePath);
assert.equal(
  projectConfig.linterOptions?.noInlineConfig,
  true,
  'the real project config must reject inline directives'
);

const [disabledResult] = await eslint.lintText(
  `
    // eslint-disable-next-line no-undef -- policy probe: this directive must have no effect
    missingInlineDisableTarget();
  `,
  { filePath: probePath }
);
const noUndefinedMessages = disabledResult.messages.filter(({ ruleId }) => ruleId === 'no-undef');
assert.equal(noUndefinedMessages.length, 1, 'the used inline directive must not hide the no-undef diagnostic');
assert.equal(noUndefinedMessages[0].severity, 2, 'no-undef must remain a severity-2 error');
assert.equal(
  disabledResult.suppressedMessages.some(({ ruleId }) => ruleId === 'no-undef'),
  false,
  'no-undef must not enter ESLint suppressedMessages'
);

const [cleanResult] = await eslint.lintText(
  `
    export function add(left, right) {
      return left + right;
    }
  `,
  { filePath: probePath }
);
assert.equal(cleanResult.errorCount, 0, 'the clean project-config sample must have zero errors');
assert.equal(cleanResult.warningCount, 0, 'the clean project-config sample must have zero warnings');
assert.equal(cleanResult.suppressedMessages.length, 0, 'the clean sample must not carry suppressed diagnostics');

process.stdout.write('ESLint inline-policy self-test passed: no-undef remains severity 2 and clean sample is 0/0.\n');
