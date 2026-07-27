# FitGen quality gates

## Backend (`FitGen-backend-1`)

```bash
npm test                 # unit + simulation (168 tests)
npm run test:coverage    # scoped coverage (threshold lines ≥70%)
npm run qa:gate          # procedural QA for swap/exclusions/unilateral/Upper Fuerza
npm run test:mutation    # Stryker on swap/continuity modules (break ≥55%)
npm run metrics          # aggregates reports/metrics/quality-metrics.json
npm run quality          # full pipeline
```

Reports:
- `coverage/`
- `reports/qa/quality-gate.json`
- `reports/mutation/`
- `reports/metrics/quality-metrics.json`

## Frontend (`FitGen`)

```bash
npm test
npm run test:coverage    # mesocyclePhaseCopy 100%
npm run lint:changed     # eslint on files touched by this workstream
npm run quality
```
