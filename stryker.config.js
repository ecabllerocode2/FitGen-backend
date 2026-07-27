/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  coverageAnalysis: 'perTest',
  mutate: [
    'domain/exerciseSelection/swapReplacement.js',
    'domain/session/applyMainExerciseSwap.js',
    'domain/athlete/continuityPreferences.js',
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
    configFile: 'vitest.config.js',
    related: true,
  },
  timeoutMS: 120000,
  concurrency: 2,
  thresholds: {
    high: 80,
    low: 60,
    break: 55,
  },
  ignoreStatic: true,
};
