#!/usr/bin/env node
/**
 * Incremental / focused quality gate — evaluates only the changed surface.
 *
 * What it does:
 *  1. Collects changed source files vs a base ref (default: origin/develop || develop || HEAD~1)
 *  2. Maps them to related Vitest files
 *  3. Runs unit tests for that slice
 *  4. Runs coverage scoped to changed domain/api modules (patch coverage ≥ threshold)
 *  5. Optionally runs Stryker only on changed mutate targets
 *
 * Usage:
 *   node scripts/dev/incremental-quality.mjs
 *   node scripts/dev/incremental-quality.mjs --base origin/main
 *   node scripts/dev/incremental-quality.mjs --mutation
 *   BASE_REF=origin/develop node scripts/dev/incremental-quality.mjs
 */
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const args = process.argv.slice(2);
const wantMutation = args.includes('--mutation');
const baseArgIdx = args.indexOf('--base');
const baseRef =
  (baseArgIdx >= 0 ? args[baseArgIdx + 1] : null)
  || process.env.BASE_REF
  || detectDefaultBase();

const PATCH_COVERAGE_LINES = Number(process.env.PATCH_COVERAGE_LINES ?? 85);
const SOURCE_GLOBS = [/^domain\//, /^api\//, /^lib\//, /^infrastructure\//];

function detectDefaultBase() {
  for (const candidate of ['origin/develop', 'develop', 'origin/main', 'main']) {
    try {
      execSync(`git rev-parse --verify ${candidate}`, { cwd: root, stdio: 'ignore' });
      return candidate;
    } catch {
      // try next
    }
  }
  return 'HEAD~1';
}

function gitDiffNames(ref) {
  try {
    const out = execSync(`git diff --name-only --diff-filter=ACMR ${ref}...HEAD`, {
      cwd: root,
      encoding: 'utf8',
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.warn(`No se pudo diff contra ${ref}:`, err.message);
    return [];
  }
}

function isSourceFile(rel) {
  if (!/\.(js|mjs|cjs|ts)$/.test(rel)) return false;
  if (rel.startsWith('tests/') || rel.includes('.test.')) return false;
  return SOURCE_GLOBS.some((re) => re.test(rel));
}

function relatedTests(changedSources) {
  const tests = new Set();
  const allTests = fs
    .readdirSync(path.join(root, 'tests'))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => `tests/${f}`);

  for (const src of changedSources) {
    const base = path.basename(src, path.extname(src));
    const dirHint = src.split('/')[1] ?? '';

    for (const testFile of allTests) {
      const name = testFile.toLowerCase();
      if (
        name.includes(base.toLowerCase())
        || (dirHint && name.includes(dirHint.toLowerCase()))
      ) {
        tests.add(testFile);
      }
    }

    // Domain-area heuristics
    if (src.includes('retention/') || src.includes('gamification/')) {
      allTests.filter((t) => /retention|gamification|e1rm/i.test(t)).forEach((t) => tests.add(t));
    }
    if (src.includes('rampGenerator') || src.includes('cooldown')) {
      allTests.filter((t) => /unilateral|cooldown|ramp|warmup/i.test(t)).forEach((t) => tests.add(t));
    }
    if (src.includes('loadConvention') || src.includes('loadCalculator') || src.includes('gymInventory')) {
      allTests.filter((t) => /domain|load|calibration|swap/i.test(t)).forEach((t) => tests.add(t));
    }
  }

  // Always include explicit test files that themselves changed
  for (const f of gitDiffNames(baseRef)) {
    if (f.startsWith('tests/') && f.endsWith('.test.js')) tests.add(f);
  }

  return [...tests];
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n→ ${cmd} ${cmdArgs.join(' ')}`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function writeTempVitestCoverageConfig(includeFiles) {
  const tmp = path.join(root, 'vitest.incremental.config.js');
  const includeLiteral = JSON.stringify(includeFiles);
  const content = `import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary'],
      reportsDirectory: './coverage-incremental',
      include: ${includeLiteral},
      thresholds: {
        lines: ${PATCH_COVERAGE_LINES},
        functions: ${Math.max(70, PATCH_COVERAGE_LINES - 10)},
        statements: ${PATCH_COVERAGE_LINES},
        branches: ${Math.max(55, PATCH_COVERAGE_LINES - 25)},
      },
    },
  },
});
`;
  fs.writeFileSync(tmp, content);
  return tmp;
}

function writeTempStrykerConfig(mutateFiles) {
  const tmp = path.join(root, 'stryker.incremental.config.js');
  const content = `/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/incremental.json' },
  coverageAnalysis: 'perTest',
  mutate: ${JSON.stringify(mutateFiles)},
  mutator: {
    excludedMutations: [
      'StringLiteral',
      'TemplateLiteral',
      'ObjectLiteral',
      'ArrayDeclaration',
      'MethodExpression',
      'OptionalChaining',
    ],
  },
  vitest: { configFile: 'vitest.config.js', related: true },
  timeoutMS: 120000,
  concurrency: 2,
  thresholds: { high: 80, low: 60, break: 50 },
  ignoreStatic: true,
};
`;
  fs.writeFileSync(tmp, content);
  return tmp;
}

function main() {
  console.log(`Incremental quality gate`);
  console.log(`  base: ${baseRef}`);
  console.log(`  patch coverage lines ≥ ${PATCH_COVERAGE_LINES}%`);

  const changed = gitDiffNames(baseRef);
  const sources = changed.filter(isSourceFile);

  if (!sources.length) {
    console.log('\nNo hay archivos fuente modificados en el diff. Nada que evaluar.');
    process.exit(0);
  }

  console.log(`\nArchivos fuente tocados (${sources.length}):`);
  sources.forEach((f) => console.log(`  - ${f}`));

  const tests = relatedTests(sources);
  if (!tests.length) {
    console.warn('\nNo se mapearon tests relacionados — corriendo suite completa de tests/.');
    run('npx', ['vitest', 'run']);
  } else {
    console.log(`\nTests relacionados (${tests.length}):`);
    tests.forEach((f) => console.log(`  - ${f}`));
    run('npx', ['vitest', 'run', ...tests]);
  }

  const coverageTargets = sources.filter((f) => f.startsWith('domain/') || f.startsWith('lib/'));
  if (coverageTargets.length) {
    const cfg = writeTempVitestCoverageConfig(coverageTargets);
    try {
      run('npx', [
        'vitest',
        'run',
        '--config',
        cfg,
        '--coverage',
        ...(tests.length ? tests : []),
      ]);
    } finally {
      fs.rmSync(cfg, { force: true });
    }
  } else {
    console.log('\n(Sin domain/lib en el diff — se omite patch coverage)');
  }

  if (wantMutation) {
    const mutate = sources.filter((f) => f.startsWith('domain/'));
    if (!mutate.length) {
      console.log('\n(Sin domain/ en el diff — se omite mutación incremental)');
    } else {
      const cfg = writeTempStrykerConfig(mutate);
      try {
        run('npx', ['stryker', 'run', cfg]);
      } finally {
        fs.rmSync(cfg, { force: true });
      }
    }
  }

  console.log('\nIncremental gate OK');
}

main();
