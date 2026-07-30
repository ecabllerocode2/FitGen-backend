# FitGen quality gates

## Backend (`FitGen-backend-1`)

### Full suite
```bash
npm test                 # unit + simulation
npm run test:coverage    # scoped coverage (threshold lines ≥70%)
npm run qa:gate          # procedural QA for swap/exclusions/unilateral/Upper Fuerza
npm run test:mutation    # Stryker on swap/continuity modules (break ≥55%)
npm run metrics          # aggregates reports/metrics/quality-metrics.json
npm run quality          # full pipeline
```

### Incremental / PR-focused (diff only)
```bash
npm run test:incremental              # related tests + patch coverage ≥85% on changed domain/lib
npm run test:incremental:mutation     # same + Stryker mutate only changed domain files
BASE_REF=origin/main npm run test:incremental
```

Workflow: `.github/workflows/incremental-quality.yml` (PR → develop/main).

Reports:
- `coverage/` / `coverage-incremental/`
- `reports/qa/quality-gate.json`
- `reports/mutation/`
- `reports/metrics/quality-metrics.json`

## Frontend (`FitGen`)

```bash
npm test
npm run test:coverage    # coverage report
npm run lint:changed     # eslint only on src files in git diff
npm run quality
```
