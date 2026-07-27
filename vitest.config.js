import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'domain/exerciseSelection/swapReplacement.js',
        'domain/exerciseSelection/swapReplacementSupport.js',
        'domain/session/applyMainExerciseSwap.js',
        'domain/athlete/continuityPreferences.js',
        'domain/athlete/exercisePreferences.js',
        'domain/session/rampGenerator.js',
        'domain/periodization/weekVolumePlanner.js',
        'domain/constants.js',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 55,
        statements: 70,
      },
    },
  },
});
