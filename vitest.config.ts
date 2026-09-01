import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts. The unit suite covers pure logic
// (src/logic), so it needs neither the React plugin nor VitePWA — loading them
// would only slow every run down and pull a service-worker build into a test
// process that has no use for one. If a component/DOM layer is added later it
// can opt into `environment: 'jsdom'` per-file with a `// @vitest-environment`
// comment, without changing this default.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Stubs jsdom is missing (scrollIntoView); no-ops under the node environment.
    setupFiles: ['./vitest.setup.ts'],
    // Explicit imports from 'vitest' rather than globals, so test files
    // type-check under the app's existing `tsc -b` with no extra types config.
    globals: false,
  },
})
