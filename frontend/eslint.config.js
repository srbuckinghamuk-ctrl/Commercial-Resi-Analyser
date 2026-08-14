import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Restores the codebase's existing `_name` convention for a destructured
      // property discarded only to drop it from a rest spread (e.g.
      // `const { inputs_version: _v2Version, ...rest } = v2`, used across the
      // v2/v3 migration helpers) — `no-unused-vars` was flagging that pattern
      // even though the underscore prefix already signals "intentionally
      // unused" and `ignoreRestSiblings` is the rule's own option for exactly
      // this destructure-then-spread shape.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
])
