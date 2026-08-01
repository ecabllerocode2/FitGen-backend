/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/billing/index.html' },
  jsonReporter: { fileName: 'reports/mutation/billing/mutation.json' },
  coverageAnalysis: 'perTest',
  mutate: [
    'domain/billing/athleteAccess.js',
    'domain/billing/statusTransitions.js',
    'domain/billing/eventStore.js',
    'domain/billing/webhookSync.js',
    'domain/billing/assertAccess.js',
  ],
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
  vitest: {
    configFile: 'vitest.billing.config.js',
    related: true,
  },
  timeoutMS: 120000,
  concurrency: 2,
  thresholds: {
    high: 80,
    low: 65,
    break: 60,
  },
  ignoreStatic: true,
};
