import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// `test.globals` is off (existing *.test.ts files import describe/it/expect
// explicitly rather than relying on injected globals), so React Testing
// Library's own auto-cleanup — which detects the test framework via a global
// `afterEach` — never registers itself. Without this, component trees from
// earlier tests in the same file stay mounted in jsdom's shared document,
// and later `render()` calls in the same file see duplicate elements.
afterEach(cleanup);
