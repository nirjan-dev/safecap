# SafeCap Product Requirements Document

## Overview

SafeCap is a browser-first, privacy-focused recording studio. It enables users to record high-quality demos and meetings locally without their data ever touching a server or being used for AI training. SafeCap prioritizes professional output, extreme performance, and data ownership.

## Philosophy

- **Local-First, Data Ownership**: All recordings stay on the user's machine. No cloud storage, no accounts required.
- **Privacy by Design**: No telemetry, no AI training on user data, no external API calls for core functionality.
- **Professional Polish**: Tools that make your demos look better (annotations, high FPS, clear audio).
- **Simple Pricing**: One-time payment for Pro features. No recurring "rent" for your own data.

## Use Cases

### 1. Professional Demo Recording (The "Anti-Loom")

- Record web apps + microphone audio for product demos, tutorials, and bug reports.
- Annotate in real-time (arrows, highlights) to guide the viewer.
- Export as high-quality MP4/WebM for sharing on Slack, GitHub, or Jira.

### 2. Private Meeting Archive (The "Meeting Vault")

- Record web-based meetings (Zoom, Meet, Teams) with both system and microphone audio.
- Organize recordings by tab title or calendar event.
- Maintain a local, searchable library of historical meetings.

## Technical Stack

- **Framework**: WXT (Web Extension Toolkit) with Vue 3
- **Styling**: Tailwind CSS + Daisy UI
- **Language**: TypeScript
- **Processing**: `ffmpeg.wasm` for local MP4/GIF conversion
- **Storage**: Local browser storage for metadata, local filesystem for recordings

## Monetization Strategy (Tiered Model)

### Free Version

- Unlimited high-quality WebM recordings (up to 4K).
- Tab, Window, and Screen recording.
- Microphone + System audio mixing.
- Basic local library.
- Small "Recorded with SafeCap" watermark (optional/tasteful).

### Pro Version ($29 One-Time)

- **Watermark Removal**: Clean, unbranded professional output.
- **On-Screen Annotations**: Drawing tools (Pen, Arrows, Rectangles) during recording.
- **Power Export**: Local conversion to MP4 and GIF (via ffmpeg.wasm).
- **Visual Feedback**: Mouse click ripple effects and keyboard shortcut overlays.
- **Smart Organization**: Automatic naming and folder-based organization.

## Roadmap

### Phase 1: Core Foundation (Current)

- [x] High-quality screen/tab recording.
- [ ] Rock-solid Mic + System audio mixing.
- [ ] Polyform Shield Licensing integration.
- [ ] Security & Privacy manifesto on the landing page.

### Phase 2: Professional Production (The "Pro" Value)

- [ ] **Annotations Engine**: Canvas overlay for real-time drawing.
- [ ] **Mouse & Key Overlays**: Highlighting user actions visually.
- [ ] **Subtle Watermarking**: Implementation for the free tier.

### Phase 3: Workflow & Export

- [ ] **MP4/GIF Conversion**: Integrating `ffmpeg.wasm` for local processing.
- [ ] **Smart Naming**: Auto-naming files based on Tab Title/URL.
- [ ] **The Meeting Vault**: Searchable recording library with tagging.

### Phase 4: Licensing & Distribution

- [ ] **Offline License Verification**: ED25519 signed-token system.
- [ ] **One-Click Export**: Optional hooks for local NAS or Google Drive (user-owned).

## Security & Privacy

- **No Server**: The extension performs zero "phoning home" except for a one-time license activation check.
- **Auditable**: Public source code under the Polyform Shield license.
- **Data Deletion**: Easy "Nuclear Option" to wipe all local data in one click.

---

_Last Updated: February 2026_
_Status: Phase 1 (Core Polish)_
