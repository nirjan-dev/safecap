import antfu from '@antfu/eslint-config'

export default antfu(
  {
    vue: true,
    typescript: true,
    formatters: {
      css: true,
      html: true,
      markdown: 'prettier',
    },
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: false,
    },
    ignores: [
      '.output',
      '.wxt',
      'node_modules',
      'dist',
      '*.d.ts',
      '*.md',
      'plans/**',
    ],
  },
  {
    name: 'safecap/browser-extension',
    languageOptions: {
      globals: {
        browser: 'readonly',
        chrome: 'readonly',
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
        definePopup: 'readonly',
        createShadowRootUi: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
