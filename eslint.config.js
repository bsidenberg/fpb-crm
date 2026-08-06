import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Known debt: ~10 effects sync state on mount/prop-change. Refactor per
      // https://react.dev/learn/you-might-not-need-an-effect, then re-raise to error.
      'react-hooks/set-state-in-effect': 'warn',
      // toast.jsx and LeadsProvider.jsx export hooks alongside components by design.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // Node-run files (CLI scripts, build config)
    files: ['scripts/**/*.js', 'vite.config.js', 'postcss.config.cjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
])
