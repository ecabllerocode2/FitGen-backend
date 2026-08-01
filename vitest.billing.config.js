import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/billing/**/*.test.js'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage-billing',
      include: [
        'domain/billing/athleteAccess.js',
        'domain/billing/statusTransitions.js',
        'domain/billing/eventStore.js',
        'domain/billing/webhookSync.js',
        'domain/billing/mercadoPagoClient.js',
        'domain/billing/assertAccess.js',
        'domain/billing/constants.js',
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 55,
        statements: 75,
      },
    },
  },
});
