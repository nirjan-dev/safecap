# SafeCap

**The Private Recording Studio for your Browser.**

SafeCap is a local-first browser extension for recording high-quality demos and meetings. No cloud, no accounts, and no AI training on your data—everything stays on your machine.

## Why SafeCap?

- **Privacy-First**: Your recordings never touch our servers. Zero tracking.
- **No Subscriptions**: Pay once for Pro features, or use the generous Free tier forever.
- **High Performance**: Optimized for 4K recording without dropping frames.
- **Professional Tools**: Built-in annotations, mouse highlights, and smart organization.

## Use Cases

- **Product Demos**: Record your web apps with professional annotations.
- **Meeting Vault**: Save your Google Meet/Zoom/Teams meetings locally for archive.
- **Bug Reports**: Capture technical issues with console logs and system info (planned).

## Project Philosophy

- **Data Ownership**: You own the bytes. We don't even have a "Upload" button by default.
- **Transparency**: Our source code is public for anyone to audit.
- **Simplicity**: One-click to start, one-click to finish. No friction.

## Development

### Prerequisites

- Node.js (see `.nvmrc`)
- pnpm

### Quick Start

```bash
pnpm install
pnpm dev
```

### Architecture

#### Recording Flow

1. **Popup** (`entrypoints/popup/App.vue`) - User clicks "Record Demo"
2. **Background** (`entrypoints/background.ts`) - Creates offscreen document
3. **Offscreen** (`entrypoints/offscreen/main.ts`) - Uses `getDisplayMedia` to capture screen/audio via `MediaRecorder`

#### Message Passing

Chrome's `runtime.sendMessage()` has a **64MB limit** per message. To handle large video recordings:

- `STREAM_START` - Sends metadata (id, name, duration, etc.)
- `STREAM_CHUNK` - Sends video data in base64-encoded chunks
- `STREAM_END` - Signals completion

The offscreen document converts `Uint8Array` to base64 before sending (binary data doesn't serialize properly via `runtime.sendMessage`).

#### Storage

Recordings are stored in two separate storage keys:

- `local:recordings` - Metadata only (id, name, duration, size, timestamps)
- `local:recording_blobs` - Base64-encoded video data mapped by recording ID

This separation allows fast metadata loading (~1KB per recording) while video data loads on-demand.

#### Loading Recordings

The recordings page uses **lazy loading**:

1. Page load fetches only metadata (fast, minimal memory)
2. User clicks "Play" → fetches blob for that specific recording
3. User closes player → blob reference released for garbage collection

This approach supports many large recordings without performance issues.

### Technology Stack

- **Framework**: [WXT](https://wxt.dev/) - Browser extension framework
- **Frontend**: Vue 3 + TypeScript
- **Styling**: Tailwind CSS + Daisy UI
- **Package Manager**: pnpm

## Licensing

SafeCap is licensed under the **Polyform Shield License 1.0.0**.

- You are free to read, modify, and use the code for personal/internal use.
- You may **not** use the code to create a competing product or service.
- See the [LICENSE](LICENSE) file for full details.

Required Notice: Copyright (C) Nirjan Khadka.

## Roadmap

1. **Phase 1**: High-quality audio mixing and core recording stability.
2. **Phase 2**: Real-time annotations and professional visual feedback (Mouse/Keys).
3. **Phase 3**: Local MP4/GIF conversion and smart library organization.
4. **Phase 4**: Pro Licensing and official store release.

---

Built with ❤️ for privacy-conscious developers.
