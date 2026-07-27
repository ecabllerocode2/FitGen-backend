/**
 * Quality metrics aggregator for FitGen backend.
 * Reads coverage + mutation + QA gate reports when present.
 *
 * Usage: node scripts/dev/quality-metrics.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function readJson(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function countTests() {
  try {
    const out = execSync('npx vitest run --reporter=json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
    const jsonStart = out.indexOf('{');
    if (jsonStart < 0) return null;
    const report = JSON.parse(out.slice(jsonStart));
    return {
      total: report.numTotalTests ?? null,
      passed: report.numPassedTests ?? null,
      failed: report.numFailedTests ?? null,
      files: report.numTotalTestSuites ?? null,
    };
  } catch (err) {
    const out = err.stdout?.toString?.() ?? '';
    const jsonStart = out.indexOf('{');
    if (jsonStart >= 0) {
      try {
        const report = JSON.parse(out.slice(jsonStart));
        return {
          total: report.numTotalTests ?? null,
          passed: report.numPassedTests ?? null,
          failed: report.numFailedTests ?? null,
          files: report.numTotalTestSuites ?? null,
        };
      } catch {
        return { error: 'vitest json parse failed' };
      }
    }
    return { error: err.message };
  }
}

function domainLoc() {
  const domainRoot = path.join(root, 'domain');
  let files = 0;
  let lines = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        files += 1;
        lines += fs.readFileSync(full, 'utf8').split('\n').length;
      }
    }
  };
  walk(domainRoot);
  return { files, lines };
}

const coverage = readJson('coverage/coverage-summary.json');
const mutation = readJson('reports/mutation/mutation.json');
const qa = readJson('reports/qa/quality-gate.json');
const tests = countTests();
const loc = domainLoc();

const coverageTotals = coverage?.total ?? null;
const mutationScore =
  mutation?.files != null
    ? (() => {
        let killed = 0;
        let survived = 0;
        let noCoverage = 0;
        for (const file of Object.values(mutation.files)) {
          for (const mut of file.mutants ?? []) {
            if (mut.status === 'Killed' || mut.status === 'Timeout') killed += 1;
            else if (mut.status === 'Survived') survived += 1;
            else if (mut.status === 'NoCoverage') noCoverage += 1;
            // Ignored / RuntimeError / CompileError excluded from Stryker score denominator
          }
        }
        const denom = killed + survived + noCoverage;
        return denom ? Math.round((killed / denom) * 1000) / 10 : null;
      })()
    : mutation?.mutationScore ?? null;

const metrics = {
  generatedAt: new Date().toISOString(),
  tests,
  coverage: coverageTotals
    ? {
        lines: coverageTotals.lines?.pct ?? null,
        statements: coverageTotals.statements?.pct ?? null,
        functions: coverageTotals.functions?.pct ?? null,
        branches: coverageTotals.branches?.pct ?? null,
      }
    : null,
  mutationScore,
  qaGate: qa
    ? { passed: qa.passed, failed: qa.failed, total: qa.total }
    : null,
  domain: loc,
  gates: {
    unitTestsPass: tests?.failed === 0,
    coverageLinesMin70: (coverageTotals?.lines?.pct ?? 0) >= 70,
    mutationMin55: mutationScore == null ? null : mutationScore >= 55,
    qaGatePass: qa ? qa.failed === 0 : null,
  },
};

const outDir = path.join(root, 'reports', 'metrics');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'quality-metrics.json'), JSON.stringify(metrics, null, 2));

console.log('FitGen quality metrics');
console.log('──────────────────────');
console.log(`Unit tests: ${tests?.passed ?? '?'}/${tests?.total ?? '?'} passed (failed=${tests?.failed ?? '?'})`);
if (metrics.coverage) {
  console.log(
    `Coverage (scoped): lines ${metrics.coverage.lines}% · branches ${metrics.coverage.branches}% · funcs ${metrics.coverage.functions}%`,
  );
} else {
  console.log('Coverage: (run npm run test:coverage first)');
}
console.log(`Mutation score: ${mutationScore ?? '(run npm run test:mutation first)'}`);
console.log(`QA gate: ${qa ? `${qa.passed}/${qa.total}` : '(run npm run qa:gate first)'}`);
console.log(`Domain LOC: ${loc.files} files / ${loc.lines} lines`);
console.log(`Report: reports/metrics/quality-metrics.json`);

const hardFail =
  (tests && tests.failed > 0) ||
  (qa && qa.failed > 0) ||
  (coverageTotals && (coverageTotals.lines?.pct ?? 0) < 70) ||
  (mutationScore != null && mutationScore < 55);

if (hardFail) process.exit(1);
