/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // File-change events don't cross the Windows -> Docker volume mount,
    // so the dev server silently serves stale code without polling.
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Vitest's 5s default is too tight for two kinds of test this suite has, and
    // both were flaking rather than failing -- the worst outcome, because a gate
    // that sometimes passes gets re-run rather than believed.
    //
    //   - ConversionCalculator.test.tsx renders the whole thirteen-page
    //     calculator and drives it through React Testing Library; it lands
    //     between four and eight seconds depending on machine load.
    //   - The report release gate generates and parses real multi-page PDFs.
    //
    // Neither is doing anything it should not; they are simply substantial. The
    // ceiling is raised rather than the work reduced, because the alternative is
    // a thinner test.
    testTimeout: 30_000,
  },
})
