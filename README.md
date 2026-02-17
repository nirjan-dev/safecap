# SafeCap

A browser extension for local-first audio/video recording with on-device AI transcription. Record your screen, meetings, and demos without sending your data to the cloud.

## Philosophy

- **Local-first, privacy-first** - All processing happens on device
- **Dead-simple UX** - Minimal friction for users
- **Performance-focused** - Efficient recording without lag
- **Open source** - AGPL/Elastic license with Pro features

## Use Cases

### 1. Demo Recording (Loom Alternative)

Record screen + audio with automatic transcription and summaries for easy sharing.

### 2. Meeting Recording (Granola Alternative)

Record audio from Zoom/Meet/Teams with searchable transcripts.

## Technology Stack

- **Framework**: [WXT](https://wxt.dev/) - Browser extension framework
- **Frontend**: Vue 3 + TypeScript
- **Styling**: Tailwind CSS + Daisy UI
- **Package Manager**: pnpm
- **Testing**: Vitest (unit) + Playwright (e2e)
- **Linting**: ESLint with @antfu/eslint-config
- **Git Hooks**: lefthook

## Development

### Prerequisites

- Node.js (see `.nvmrc` for version)
- pnpm

### Installation

```bash
pnpm install
```

### Development Commands

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Build for Firefox
pnpm build:firefox

# Create distribution zip
pnpm zip
```

### Code Quality

```bash
# Type checking
pnpm typecheck
pnpm typecheck:watch

# Linting
pnpm lint
pnpm lint:fix

# Unit tests
pnpm test
pnpm test:watch
pnpm test:coverage

# E2E tests
pnpm test:e2e
pnpm test:e2e:ui
```

### Pre-commit Hooks

Git hooks are configured via lefthook to automatically run:

- TypeScript type checking
- ESLint linting
- Auto-formatting

## Project Structure

```
├── entrypoints/          # Browser extension entry points
│   ├── background.ts     # Background script
│   ├── content.ts        # Content script
│   └── popup/            # Popup UI
│       ├── App.vue
│       ├── main.ts
│       └── style.css
├── components/           # Shared Vue components
├── assets/              # Static assets
├── tests/
│   ├── unit/            # Vitest unit tests
│   └── e2e/             # Playwright E2E tests
├── .wxt/                # Generated WXT types (auto-generated)
├── .output/             # Build output (auto-generated)
├── eslint.config.ts     # ESLint configuration
├── vitest.config.ts     # Vitest configuration
├── playwright.config.ts # Playwright configuration
└── lefthook.yml         # Git hooks configuration
```

## Browser Support

- Chrome (primary)
- Firefox
- Safari (planned)

## License

AGPL v3

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm typecheck && pnpm lint && pnpm test`
5. Submit a pull request

## VS Code Setup

Recommended extensions:

- Vue.volar (Vue 3 support)
- dbaeumer.vscode-eslint (ESLint integration)

Settings are pre-configured in `.vscode/settings.json` for auto-fix on save.
