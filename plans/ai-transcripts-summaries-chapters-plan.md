# Plan: AI-Powered Transcripts, Summaries & Chapter Markers

> Source PRD: `plans/ai-transcripts-summaries-chapters.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **New visible recording page** (`entrypoints/transcript/`) replaces the offscreen document entirely. `SpeechRecognition` requires a visible document context (throws NotAllowedError in offscreen documents).
- **Recording moved to visible page** — the transcript page calls `getDisplayMedia()`, runs `MediaRecorder` for video, and `SpeechRecognition` for transcription. Both share the same `MediaStream`.
- **Web Speech API for transcription** — real-time, unlimited, free. Captures tab audio via `SpeechRecognition.start({ audioTrack })` using the audio track from `getDisplayMedia()`.
- **Chrome Built-in AI for summaries + chapters only** — `Summarizer` API for summaries, `LanguageModel` (Prompt API) for chapter detection. Input is transcript text (small, fits in context window).
- **Chrome AI token limits confirmed**: Gemini Nano has 1,024 tokens per prompt, 4,096 tokens session context. Full transcription via Chrome AI is not feasible.
- **No more offscreen document** — `entrypoints/offscreen/` is deleted. No more 64MB chunked messaging. No more base64 conversion.
- **Direct OPFS writing** — the transcript page writes `MediaRecorder` blobs directly to OPFS via `FileSystemWritableFileStream` (true streaming).
- **Background script** — opens transcript page, sends stop/pause/resume commands via `runtime.sendMessage`. No recording logic.
- **Storage shape**:
  - Transcript JSON in OPFS at `recordings/<id>.transcript.json` alongside `<id>.webm`
  - `hasTranscript: boolean` flag in `local:recordings` metadata for quick UI rendering
  - Cross-tab sync via `chrome.storage.onChanged` listener
- **Data model**:
  ```typescript
  interface TranscriptSegment { text: string, start: number, end: number }
  interface Chapter { title: string, start: number, end: number }
  interface RecordingTranscript { recordingId: string, generatedAt: number, segments: TranscriptSegment[], summary: string, chapters: Chapter[] }
  ```
- **Transcript storage during recording**: In-memory array of segments, saved to OPFS when recording stops.
- **UI pattern**: Native `<dialog>` modal with responsive side-by-side layout (>1280px: video left ~60%, transcript right ~40%; narrower: stacked vertically).
- **Video-transcript communication**: Vue `provide/inject` to pass video element reference; transcript panel emits seek events.
- **Structured output fallback chain**: JSON parse → regex `[MM:SS] text` extraction → single-segment fallback.
- **Dev config**: `wxt.config.ts` needs `--disable-features=DisableLoadExtensionCommandLineSwitch` for Prompt API to work in local dev.

---

## Phase 1: New Transcript Page + Recording Migration

**User stories**: Core recording flow, live transcription

### What to build

Create the new visible recording/transcript page (`entrypoints/transcript/`) and migrate all recording logic from the offscreen document to this page. Add Web Speech API integration for live transcription during recording. This is the foundational phase — without it, nothing else works.

### Tasks

- [ ] **1.1** Create `entrypoints/transcript/` structure:
  - `main.ts` — Vue app entry point
  - `App.vue` — main recording + transcription UI
  - `index.html` — page template (WXT auto-generates this)
- [ ] **1.2** Implement recording logic in `App.vue`:
  - `getDisplayMedia({ video: true, audio: true })` — single permission prompt
  - `MediaRecorder` with video track → direct OPFS write via `FileSystemWritableFileStream`
  - Audio track passed to `SpeechRecognition.start({ audioTrack })`
  - `beforeunload` listener: "Recording is in progress. Are you sure you want to stop?"
- [ ] **1.3** Implement Web Speech API integration:
  - `webkitSpeechRecognition` with `continuous = true`, `interimResults = true`
  - Store segments in memory: `{ text, start, end }`
  - Live transcript feed UI (scrollable, timestamped)
  - Error handling: `no-speech`, `audio-capture`, `not-allowed`, `network`
- [ ] **1.4** Implement recording lifecycle:
  - Start/pause/resume/stop states
  - Duration counter
  - Red dot indicator + status text
  - Stop button
- [ ] **1.5** Update `entrypoints/background.ts`:
  - Remove offscreen document creation/destruction logic
  - Open transcript page via `chrome.tabs.create()` or `chrome.windows.create()`
  - Handle `runtime.sendMessage` for stop/pause/resume commands
  - Remove chunked messaging logic (STREAM_START, STREAM_CHUNK, STREAM_END)
- [ ] **1.6** Delete `entrypoints/offscreen/` directory entirely
- [ ] **1.7** Update popup (`entrypoints/popup/App.vue`):
  - Change "Record Demo" button to open transcript page instead of triggering offscreen recording
  - Show recording state (recording/paused) if transcript page is open
  - Add "Stop Recording" button that sends message to transcript page
- [ ] **1.8** Add chromiumArgs to `wxt.config.ts`:
  ```typescript
  webExt: {
    chromiumArgs: [
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
    ],
  }
  ```
- [ ] **1.9** Write E2E tests for recording flow:
  - Open transcript page → grant permissions → start recording → stop recording → verify file saved to OPFS

### Acceptance criteria

- [ ] Clicking "Record Demo" in popup opens the transcript page in a new tab
- [ ] Single `getDisplayMedia` permission prompt for both video and audio
- [ ] Recording starts, live transcript feed shows real-time text with timestamps
- [ ] Video is saved directly to OPFS (no chunked messaging)
- [ ] `beforeunload` warning appears if user tries to close tab during recording
- [ ] Popup shows recording state and has a "Stop Recording" button
- [ ] `entrypoints/offscreen/` directory is deleted
- [ ] `pnpm typecheck && pnpm lint` pass with no errors

---

## Phase 2: Post-Recording AI Processing + Storage

**User stories**: 7, summary + chapters generation

### What to build

After recording stops, generate summary and chapter markers using Chrome AI. Save the complete transcript (segments + summary + chapters) to OPFS. Update recording metadata with `hasTranscript` flag.

### Tasks

- [ ] **2.1** Create `src/utils/transcriptStorage.ts` with OPFS utilities:
  - `saveTranscript(recordingId: string, transcript: RecordingTranscript): Promise<void>`
  - `getTranscript(recordingId: string): Promise<RecordingTranscript | null>`
  - `deleteTranscript(recordingId: string): Promise<void>`
  - `hasTranscriptFile(recordingId: string): Promise<boolean>`
- [ ] **2.2** Create `src/utils/aiTranscriber.ts` with:
  - `checkAvailability(): Promise<{ available: boolean; reason?: string }>` — checks `LanguageModel.availability()` and `Summarizer.availability()`
  - `generateSummaryAndChapters(transcriptText: string, duration: number): Promise<{ summary: string; chapters: Chapter[] }>`
  - Structured output fallback chain for chapter detection (JSON → regex → empty chapters)
  - Context window overflow handling: chunk long transcripts, summary-of-summaries pattern
- [ ] **2.3** Wire up post-recording processing in transcript page `App.vue`:
  - After recording stops: show "Processing..." state
  - Call `aiTranscriber.generateSummaryAndChapters()` with full transcript text
  - On success: save to OPFS via `transcriptStorage.saveTranscript()`, update `hasTranscript` flag in metadata
  - Show "Done" state with link to recordings library
  - If Chrome AI unavailable: skip summary/chapters, save transcript only, show message
- [ ] **2.4** Add `hasTranscript: boolean` field to `RecordingMetadata` type in `src/utils/storage.ts`
- [ ] **2.5** Update `deleteRecording()` in `src/utils/storage.ts` to also call `deleteTranscript()`
- [ ] **2.6** Write unit tests for `transcriptStorage.ts` with mocked OPFS
- [ ] **2.7** Write unit tests for `aiTranscriber.ts`:
  - Test summarization with mocked `Summarizer` API
  - Test chapter detection with mocked `LanguageModel` API
  - Test structured output fallback chain
  - Test context window overflow chunking

### Acceptance criteria

- [ ] After recording stops, summary and chapters are generated via Chrome AI
- [ ] "Processing..." state shown during AI generation
- [ ] Complete transcript (segments + summary + chapters) saved to OPFS
- [ ] `hasTranscript` flag set to `true` in recording metadata
- [ ] If Chrome AI unavailable, recording still works and transcript is saved (without summary/chapters)
- [ ] Deleting a recording also deletes its transcript file from OPFS
- [ ] `pnpm typecheck && pnpm lint` pass with no errors

---

## Phase 3: Transcript Panel + Recordings Library Integration

**User stories**: 1, 3, 4, 5, 6, 10, 13

### What to build

Add transcript viewing to the recordings library. Users can open a transcript panel alongside the video player, view segments/summary/chapters, and click timestamps to seek the video.

### Tasks

- [ ] **3.1** Create `components/TranscriptPanel.vue`:
  - Accept `transcript: RecordingTranscript` as prop
  - Tabs: "Transcript" (active by default) | "Summary" | "Chapters"
  - Transcript tab: scrollable list of segments with `[MM:SS]` timestamps
  - Summary tab: markdown-rendered summary text, "Copy to clipboard" button
  - Chapters tab: list of chapters with `[MM:SS]` timestamps and titles
  - Clicking a segment or chapter emits `seek-to: number` event
  - Use `inject` to get video element reference from parent
  - "Delete Transcript" button with confirmation dialog
- [ ] **3.2** Modify `entrypoints/recordings/App.vue` card UI:
  - Add transcript icon button alongside existing Play/Download/Delete buttons
  - If `hasTranscript === true`: show `lucide:file-text` icon, clicking opens transcript panel
  - If `hasTranscript === false`: show `lucide:wand-sparkles` icon (disabled or triggers future post-recording transcription)
  - Add `onMounted` availability check for Chrome AI, store result in `ref`
- [ ] **3.3** Modify modal layout in `entrypoints/recordings/App.vue`:
  - When transcript panel is open, expand modal width beyond `max-w-5xl`
  - Side-by-side layout on wide screens: video left ~60%, transcript right ~40%
  - `provide` the video element reference for `TranscriptPanel` to use
  - Handle `seek-to` events by setting `video.currentTime = timestamp`
- [ ] **3.4** Register `chrome.storage.onChanged` listener for cross-tab sync:
  - Watch for `hasTranscript` changes on any recording
  - Update local `recordings` ref reactively without page refresh
- [ ] **3.5** Write component tests for `TranscriptPanel.vue`:
  - Verify segment rendering with timestamps
  - Verify click-on-segment emits correct `seek-to` event
  - Verify summary tab with copy-to-clipboard
  - Verify chapters tab with click-to-seek
- [ ] **3.6** Write E2E tests for transcript viewing flow:
  - Open recording with transcript → see transcript panel → click segment → video seeks

### Acceptance criteria

- [ ] Recording cards show a transcript icon (`file-text` or `wand-sparkles`) based on `hasTranscript` flag
- [ ] Clicking `file-text` icon opens modal with video + transcript panel side by side
- [ ] Transcript shows timestamped segments in a scrollable list
- [ ] Summary tab shows markdown-formatted summary with a "Copy" button
- [ ] Chapters tab shows timestamped chapter list, clicking seeks video
- [ ] "Delete Transcript" button works with confirmation dialog
- [ ] Cross-tab sync works: generating a transcript in one tab updates the icon in other open tabs
- [ ] `pnpm typecheck && pnpm lint` pass with no errors

---

## Phase 4: Polish + AI Enablement + Responsive Layout

**User stories**: 11, 12, 13

### What to build

Handle edge cases, AI model download flow, and responsive layout improvements. This phase ensures the feature works well in all scenarios.

### Tasks

- [ ] **4.1** AI Enablement Banner in `entrypoints/recordings/App.vue`:
  - If AI model is `downloadable`, show prominent banner at top: "AI features require a one-time 22GB model download." with "Enable AI Features" button
  - Clicking button triggers model download with progress monitoring
  - Banner dismisses after download completes
- [ ] **4.2** Responsive layout:
  - On narrow screens (<1280px): stack video on top, transcript below as collapsible panel
  - Transcript panel has its own internal scroll independent of video
  - Test modal behavior at various viewport widths
- [ ] **4.3** Error handling for all failure modes:
  - AI unavailable: recording works, summary/chapters skipped with clear message
  - SpeechRecognition errors: `no-speech`, `audio-capture`, `not-allowed`, `network` — show appropriate messages
  - `getDisplayMedia` denied: show error, recording cannot start
  - Context window overflow for long recordings: chunking with summary-of-summaries pattern
- [ ] **4.4** Run full test suite: `pnpm test && pnpm test:e2e`

### Acceptance criteria

- [ ] AI enablement banner shows when model is downloadable, with download progress
- [ ] Responsive layout works correctly at wide (>1280px) and narrow (<1280px) viewports
- [ ] All error states show informative messages
- [ ] Recording works even when Chrome AI is unavailable (transcript saved, summary/chapters skipped)
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass

---

## Testing Strategy

### What to test

| Module                 | Test type                   | What to verify                                                                                               |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `transcriptStorage.ts` | Unit (Vitest)               | OPFS read/write/delete with mocked OPFS                                                                      |
| `aiTranscriber.ts`     | Unit (Vitest)               | Availability checks, summarization, chapter detection, structured output fallback, context overflow chunking |
| `TranscriptPanel.vue`  | Component (@vue/test-utils) | Segment rendering, timestamp click → seek event, copy-to-clipboard, tab switching                            |
| Recording flow         | E2E (Playwright)            | Open transcript page → grant permissions → record → stop → verify OPFS file                                  |
| Full flow              | E2E (Playwright)            | Record → generate → view transcript in library → seek                                                        |

### What NOT to test

- Actual Chrome AI API calls (hardware-dependent, non-deterministic)
- Actual Web Speech API (browser-dependent, requires audio input)
- AI output quality (transcription accuracy, summary quality)

### Prior art

- Existing unit tests in `tests/unit/` use Vitest with `@vue/test-utils`
- E2E tests in `tests/e2e/` use Playwright with extension from `.output/chrome-mv3-dev`

## Risks and Mitigations

| Risk                                                                 | Impact | Mitigation                                                                                                                                              |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome AI not available on user's device                             | Medium | Recording + live transcription still works. Summary + chapters skipped with clear message. Plan Whisper fallback for v2.                                |
| Web Speech API transcription quality is poor                         | Medium | Depends on audio quality and language. Allow language config. Consider Whisper fallback for v2.                                                         |
| User closes transcript page during recording                         | High   | `beforeunload` warning. Recording lost if they proceed. Acceptable for Phase 1.                                                                         |
| Long recordings exceed Chrome AI context window for summary/chapters | Medium | Implement chunking with summary-of-summaries pattern (Phase 4).                                                                                         |
| Chrome AI API changes (still evolving)                               | Medium | The `aiTranscriber.ts` abstraction isolates us from API changes.                                                                                        |
| Model download is large (22GB) and slow                              | Low    | Show clear progress indicator. Model is cached after first download.                                                                                    |
| SpeechRecognition not supported in extension context                 | High   | Verified: works in visible extension pages (popup, new tabs). Does NOT work in offscreen documents — which is why we moved recording to a visible page. |
