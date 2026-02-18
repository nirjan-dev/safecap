# SafeCap Agent Guidelines

## Build Commands

```bash
# Development
pnpm dev              # Start dev server (Chrome)
pnpm dev:firefox      # Start dev server (Firefox)

# Building
pnpm build            # Production build (Chrome)
pnpm build:firefox    # Production build (Firefox)
pnpm zip              # Create distribution zip (Chrome)
pnpm zip:firefox      # Create distribution zip (Firefox)
```

## Code Quality Commands

```bash
# Type checking
pnpm typecheck        # Run TypeScript checks
pnpm typecheck:watch  # Run TypeScript checks in watch mode

# Linting (auto-runs on pre-commit via lefthook)
pnpm lint             # Check for linting errors
pnpm lint:fix         # Fix linting errors automatically

# Testing
pnpm test             # Run all unit tests once
pnpm test:watch       # Run unit tests in watch mode
pnpm test:coverage    # Run unit tests with coverage report
pnpm test -- <pattern> # Run specific test file (e.g., pnpm test -- HelloWorld)
pnpm test:e2e         # Run E2E tests with Playwright
pnpm test:e2e:ui      # Run E2E tests with UI mode
```

**Always run `pnpm typecheck && pnpm lint` before committing.**

## Package Manager

Use **pnpm** (specified in package.json). Never use npm or yarn.

## Code Style

### ESLint Configuration

Uses `@antfu/eslint-config` with these settings:

- **Indent**: 2 spaces
- **Quotes**: Single quotes
- **Semicolons**: Never (omitted)
- **Vue**: Enabled with TypeScript support
- **Formatters**: CSS, HTML, Markdown with Prettier

### TypeScript

- **Strict mode enabled** via WXT's tsconfig
- Use explicit return types for exported functions
- Prefer `type` over `interface` for object shapes
- Use `const` assertions for literal types

### Vue Components

- Use `<script lang="ts" setup>` composition API
- Props: Use `defineProps()` with TypeScript types when possible
- Events: Use `defineEmits()` with typed payloads
- Use scoped styles: `<style scoped>`

### Naming Conventions

- **Files**: camelCase for ts files, PascalCase for Vue components
- **Components**: PascalCase (e.g., `HelloWorld.vue`)
- **Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE or camelCase
- **Types/Interfaces**: PascalCase with descriptive names

### Imports

- Use path aliases: `@/` or `~/` for root-relative imports
- Group imports: 1) external libs, 2) internal modules, 3) types
- Use explicit imports (no `import * as` unless necessary)

```typescript
import { mount } from '@vue/test-utils'
// Good
import { ref } from 'vue'
import HelloWorld from '@/components/HelloWorld.vue'
```

### Error Handling

- Use try/catch for async operations
- Console logging is allowed (`no-console: off` in config)
- Prefer early returns over nested conditionals

### Browser Extension Globals

These globals are available (defined in eslint.config.ts):

- `browser` - WebExtension API (cross-browser)
- `chrome` - Chrome extension API
- `defineBackground` - WXT background script helper
- `defineContentScript` - WXT content script helper
- `definePopup` - WXT popup helper

## Project Structure

```
├── entrypoints/          # Extension entry points
│   ├── background.ts     # Background/service worker script
│   ├── content.ts        # Content scripts
│   └── popup/            # Popup UI
│       ├── App.vue
│       ├── main.ts
│       └── style.css
├── components/           # Shared Vue components
├── assets/               # Static assets (images, fonts)
├── tests/
│   ├── unit/             # Vitest unit tests (*.spec.ts)
│   ├── e2e/              # Playwright E2E tests
│   └── unit/setup.ts     # Test configuration
├── .wxt/                 # Generated WXT types (auto-generated)
└── .output/              # Build output (auto-generated)
```

## Testing Guidelines

### Unit Tests (Vitest)

- Use `describe` and `it` blocks
- Test files: `*.spec.ts` or `*.test.ts` in `tests/unit/`
- Use `@vue/test-utils` for component testing
- Globals enabled (no need to import `describe`, `it`, `expect`)

```typescript
import { mount } from '@vue/test-utils'
import HelloWorld from '@/components/HelloWorld.vue'

describe('componentName', () => {
  it('should do something', () => {
    const wrapper = mount(HelloWorld, {
      props: { msg: 'test' }
    })
    expect(wrapper.text()).toContain('test')
  })
})
```

### E2E Tests (Playwright)

- Located in `tests/e2e/`
- Extension loads from `.output/chrome-mv3-dev`
- Use `test.describe` for grouping tests

## Styling

- **Tailwind CSS v4** with Daisy UI components
- Use Tailwind utility classes in templates
- Component-specific styles in `<style scoped>`
- Follow existing color schemes and component patterns

## Pre-commit Hooks

Lefthook runs automatically on commit:

1. TypeScript type checking
2. ESLint linting
3. Auto-formatting

## Browser Support

- **Primary**: Chrome/Edge (MV3)
- **Secondary**: Firefox (MV2)
- Avoid browser-specific APIs; use `browser.*` polyfill when possible
