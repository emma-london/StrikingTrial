// Type-level half of the jest-dom matchers (toBeInTheDocument, toHaveTextContent,
// toBeDisabled, …). The runtime half is imported in `vitest.setup.ts`, but that
// file is compiled under tsconfig.node, so its module augmentation never reaches
// the app program — without this, `npm test` passes while `tsc -b` fails on every
// matcher. Declared here so the augmentation lands in the same program as the
// test files that use it.
import '@testing-library/jest-dom/vitest'
