// Shared setup for the DOM-based tests.
//
// This runs for every test file, including the `node`-environment logic tests,
// so the DOM-only pieces are loaded conditionally rather than imported at the
// top level — the pure logic suite should not have to pay for React.
import { afterEach } from 'vitest'

if (typeof document !== 'undefined') {
  // jsdom implements no layout, so it ships no scrollIntoView. Dropdown calls it
  // to keep the highlighted option in view while arrowing through the menu;
  // without a stub every keyboard test dies on "not a function" for a line that
  // has nothing to do with what is being tested.
  Element.prototype.scrollIntoView ??= function scrollIntoView() {}

  // Matchers: toHaveTextContent, toHaveAttribute, toBeDisabled, and friends.
  await import('@testing-library/jest-dom/vitest')

  // Unmount between tests. Testing Library only registers this itself when
  // Vitest globals are on, and they are deliberately off here — without it, a
  // second render leaves the first in the document and every getByRole fails
  // with "found multiple elements".
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
}
