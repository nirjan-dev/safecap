# Plan: AI-Powered Transcripts, Summaries & Chapter Markers

> Source PRD: `plans/ai-transcripts-summaries-chapters.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **No background script changes** — all transcript generation runs in the recordings page context (`entrypoints/recordings/App.vue`). Chrome AI APIs (`LanguageModel`, `Summarizer`) require a document context.
- **Chrome Built-in AI only (Phase 1)** — `LanguageModel` (Prompt API) for transcription + chapter detection, `Summarizer` API for summaries. No external dependencies or API keys.
- **No new manifest permissions** — Chrome AI APIs don't require permissions.
- **Storage shape**:
  - Transcript JSON in OPFS at `recordings/<id>.transcript.json` alongside `<id>.webm`
  - `hasTranscript: boolean` flag in `local:recordings` metadata for quick UI rendering
  - Cross-tab sync via `chrome.storage.onChanged` listener
- **Data model**:
  ```typescript
  interface TranscriptSegment { text: string; start: number; end: number }
  interface Chapter { title: string; start: number; end: number }
  interface RecordingTranscript { recordingId: string; generatedAt: number; segments: TranscriptSegment[]; summary: string; chapters: Chapter[] }
  ```
- **Progress model**: 4 stage-based (extracting → transcribing → summarizing → chapters), not percentage-based. Each stage is binary (0 or 1).
- **UI pattern**: Native `<dialog>` modal with responsive side-by-side layout (>1280px: video left ~60%, transcript right ~40%; narrower: stacked vertically).
- **Video-transcript communication**: Vue `provide/inject` to pass video element reference; transcript panel emits seek events.
- **Non-blocking generation**: User can continue browsing while transcript generates. `beforeunload` warning if tab is closed during generation.
- **Structured output fallback chain**: JSON parse → regex `[MM:SS] text` extraction → single-segment fallback.

---

## Phase 1: Storage Foundation + AI Availability + Card UI

**User stories**: 7, 8, 9, 12

### What to build

Establish the data layer and AI availability detection. Add transcript status indicators to recording cards so users can see which recordings have transcripts and which don't. The "Generate" button is wired up but generation itself comes in Phase 2.

### Tasks

- [ ] **1.1** Add `hasTranscript: boolean` field to `RecordingMetadata` type in `src/utils/storage.ts`
- [ ] **1.2** Create `src/utils/transcriptStorage.ts` with OPFS utilities:
  - `saveTranscript(recordingId: string, transcript: RecordingTranscript): Promise<void>`
  - `getTranscript(recordingId: string): Promise<RecordingTranscript | null>`
  - `deleteTranscript(recordingId: string): Promise<void>`
  - `hasTranscriptFile(recordingId: string): Promise<boolean>`
- [ ] **1.3** Update `deleteRecording()` in `src/utils/storage.ts` to also call `deleteTranscript()`
- [ ] **1.4** Create `src/utils/aiTranscriber.ts` with:
  - Type definitions: `TranscriptionProgress`, `TranscriberOptions`, `TranscriberResult`, `TranscriberAvailability`
  - `checkAvailability(): Promise<TranscriberAvailability>` — checks both `LanguageModel.availability()` and `Summarizer.availability()`
  - `generateTranscript()` stub that returns a placeholder (full implementation in Phase 2)
- [ ] **1.5** Modify `entrypoints/recordings/App.vue` card UI:
  - Add transcript icon button alongside existing Play/Download/Delete buttons
  - If `hasTranscript === true`: show `lucide:file-text` icon
  - If `hasTranscript === false`: show `lucide:wand-sparkles` icon
  - If AI unavailable: show disabled icon with tooltip explaining requirements
  - Add `onMounted` availability check, store result in `ref`
- [ ] **1.6** Write unit tests for `transcriptStorage.ts` with mocked OPFS
- [ ] **1.7** Write unit tests for `aiTranscriber.checkAvailability()` with mocked Chrome AI APIs

### Acceptance criteria

- [ ] Recording cards show a transcript icon (`file-text` or `wand-sparkles`) based on `hasTranscript` flag
- [ ] Cards show a disabled state with tooltip when Chrome AI is unavailable
- [ ] Deleting a recording also deletes its transcript file from OPFS
- [ ] `transcriptStorage.ts` read/write/delete operations work correctly with OPFS
- [ ] `checkAvailability()` correctly reports available/downloadable/unavailable states
- [ ] `pnpm typecheck && pnpm lint` pass with no errors

---

## Phase 2: Basic Transcript Generation + Display Panel

**User stories**: 1, 2, 3, 13

### What to build

Wire up the full transcript generation flow: user clicks "Generate" on a card, sees inline progress, and after completion can open a transcript panel in the modal alongside the video player. This is the first end-to-end vertical slice — a user can generate and view a transcript.

### Tasks

- [ ] **2.1** Complete `aiTranscriber.generateTranscript()` implementation:
  - Audio extraction: fetch WebM blob from OPFS, attempt `AudioContext.decodeAudioData()`, fall back to raw blob
  - Silence detection: audio energy check, skip AI if silent
  - Transcription: `LanguageModel.create()` with audio input + JSON Schema constraint for `{ segments: [{ text, start, end }] }`
  - Structured output fallback chain (JSON → regex → single segment)
  - Progress callbacks at each stage
- [ ] **2.2** Wire up "Generate Transcript" button in `entrypoints/recordings/App.vue`:
  - On click: call `aiTranscriber.generateTranscript()` with progress callback
  - Show inline spinner + stage progress text on the card (e.g., "Transcribing... (2/4 stages)")
  - Non-blocking: user can interact with other cards during generation
  - On success: save transcript via `transcriptStorage.saveTranscript()`, update `hasTranscript` flag in metadata, show success toast
  - Icon changes from `wand-sparkles` to `file-text` after completion
- [ ] **2.3** Add `beforeunload` event listener during generation to warn about in-progress work
- [ ] **2.4** Create `components/TranscriptPanel.vue`:
  - Accept `transcript: RecordingTranscript` as prop
  - Tabs: "Transcript" (active by default) | "Summary" (placeholder) | "Chapters" (placeholder)
  - Transcript tab: scrollable list of segments with `[MM:SS]` timestamps
  - Clicking a segment emits `seek-to: number` event
  - Use `inject` to get video element reference from parent
- [ ] **2.5** Modify modal layout in `entrypoints/recordings/App.vue`:
  - When transcript panel is open, expand modal width beyond `max-w-5xl`
  - Side-by-side layout on wide screens: video left ~60%, transcript right ~40%
  - `provide` the video element reference for `TranscriptPanel` to use
  - Handle `seek-to` events by setting `video.currentTime = timestamp`
- [ ] **2.6** Add transcript panel open/close logic:
  - Clicking `file-text` icon opens modal with transcript panel
  - Clicking `wand-sparkles` icon triggers generation (no modal)
  - Close button on transcript panel returns to video-only view
- [ ] **2.7** Write unit tests for `aiTranscriber.generateTranscript()` with mocked Chrome AI APIs:
  - Test progress callback invocation at each stage
  - Test structured output fallback chain
  - Test silence detection skip
- [ ] **2.8** Write component tests for `TranscriptPanel.vue`:
  - Verify segment rendering with timestamps
  - Verify click-on-segment emits correct `seek-to` event

### Acceptance criteria

- [ ] Clicking "Generate Transcript" starts generation with visible inline progress on the card
- [ ] User can interact with other cards while generation is in progress
- [ ] Success toast appears when generation completes
- [ ] Card icon changes from `wand-sparkles` to `file-text` after completion
- [ ] Clicking `file-text` icon opens modal with video + transcript panel side by side
- [ ] Transcript shows timestamped segments in a scrollable list
- [ ] Clicking a timestamp seeks the video player to that position
- [ ] `beforeunload` warning appears if tab is closed during generation
- [ ] `pnpm typecheck && pnpm lint` pass with no errors

---

## Phase 3: Summary + Chapters + Full Panel

**User stories**: 4, 5, 10

### What to build

Complete the transcript panel with all three tabs (Transcript, Summary, Chapters). Add summarization and chapter detection to the AI pipeline. Users can now get a full AI-powered overview of their recordings.

### Tasks

- [ ] **3.1** Extend `aiTranscriber.generateTranscript()` with:
  - Summarization stage: `Summarizer.create({ type: 'key-points', length: 'medium', format: 'markdown' })` fed with full transcript text
  - Chapter detection stage: `LanguageModel.create()` with JSON Schema `{ chapters: [{ title, start, end }] }`
  - Chapter detection prompt: "Analyze this transcript and identify the main topic changes. Return chapter markers with titles and timestamps."
- [ ] **3.2** Update `TranscriptPanel.vue`:
  - Summary tab: render markdown summary text, add "Copy to clipboard" button
  - Chapters tab: list of chapters with `[MM:SS]` timestamps and titles, clicking emits `seek-to`
  - Active tab state management
- [ ] **3.3** Add "Delete Transcript" button at bottom of `TranscriptPanel.vue`:
  - Confirmation dialog: "Delete transcript for '{recording name}'? This cannot be undone."
  - On confirm: call `transcriptStorage.deleteTranscript()`, update `hasTranscript` flag to `false`, close panel
- [ ] **3.4** Write unit tests for:
  - Summarization stage with mocked `Summarizer` API
  - Chapter detection with mocked `LanguageModel` API
  - Structured output fallback for chapters
- [ ] **3.5** Write component tests for `TranscriptPanel.vue`:
  - Summary tab rendering and copy-to-clipboard
  - Chapters tab rendering and click-to-seek

### Acceptance criteria

- [ ] Generated transcripts include a summary and chapter markers alongside segments
- [ ] Summary tab shows markdown-formatted summary with a "Copy" button
- [ ] Chapters tab shows timestamped chapter list, clicking seeks video
- [ ] "Delete Transcript" button works with confirmation dialog
- [ ] Deleting a transcript updates the card icon back to `wand-sparkles`
- [ ] `pnpm typecheck && pnpm lint` pass with no errors

---

## Phase 4: Polish + Cross-tab Sync + AI Enablement + Responsive Layout

**User stories**: 6, 11, 12, 13

### What to build

Handle edge cases, cross-tab synchronization, AI model download flow, and responsive layout improvements. This phase ensures the feature works well in all scenarios.

### Tasks

- [ ] **4.1** AI Enablement Banner in `entrypoints/recordings/App.vue`:
  - If AI model is `downloadable`, show prominent banner at top: "AI features require a one-time 22GB model download." with "Enable AI Features" button
  - Clicking button triggers model download with progress monitoring
  - Banner dismisses after download completes
- [ ] **4.2** Cross-tab sync:
  - Register `chrome.storage.onChanged` listener in `entrypoints/recordings/App.vue`
  - Watch for `hasTranscript` changes on any recording
  - Update local `recordings` ref reactively without page refresh
- [ ] **4.3** Responsive layout:
  - On narrow screens (<1280px): stack video on top, transcript below as collapsible panel
  - Transcript panel has its own internal scroll independent of video
  - Test modal behavior at various viewport widths
- [ ] **4.4** Error handling for all failure modes:
  - AI unavailable: informative message with hardware requirements (Chrome 138+, GPU >4GB VRAM or CPU 16GB+ RAM, 22GB free space)
  - Audio decode failure: error message, suggest trying different recording
  - Silent recording: "No audio detected in this recording."
  - Generation interrupted (tab closed): transcript not saved, user can retry
  - Context window overflow for long recordings: chunking with summary-of-summaries pattern
- [ ] **4.5** E2E test the full flow with Playwright:
  - Click generate button → see progress → see transcript in panel → click segment to seek video
  - Cross-tab sync: generate in one tab, verify icon updates in another
- [ ] **4.6** Run full test suite: `pnpm test && pnpm test:e2e`

### Acceptance criteria

- [ ] AI enablement banner shows when model is downloadable, with download progress
- [ ] Cross-tab sync works: generating a transcript in one tab updates the icon in other open tabs
- [ ] Responsive layout works correctly at wide (>1280px) and narrow (<1280px) viewports
- [ ] All error states show informative messages
- [ ] E2E tests pass for the full transcript generation and viewing flow
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` all pass

---

## Testing Strategy

### What to test

| Module | Test type | What to verify |
|---|---|---|
| `transcriptStorage.ts` | Unit (Vitest) | OPFS read/write/delete with mocked OPFS |
| `aiTranscriber.ts` | Unit (Vitest) | Availability checks, progress callbacks, structured output fallback, silence detection |
| `TranscriptPanel.vue` | Component (@vue/test-utils) | Segment rendering, timestamp click → seek event, copy-to-clipboard, tab switching |
| Full flow | E2E (Playwright) | Generate → progress → view → seek |

### What NOT to test

- Actual Chrome AI API calls (hardware-dependent, non-deterministic)
- AI output quality (transcription accuracy, summary quality)

### Prior art

- Existing unit tests in `tests/unit/` use Vitest with `@vue/test-utils`
- E2E tests in `tests/e2e/` use Playwright with extension from `.output/chrome-mv3-dev`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Chrome AI not available on user's device | High | Clear messaging, graceful disabled state. Plan Whisper fallback for v2. |
| Transcription quality is poor for technical content | Medium | Allow users to retry. Consider prompt engineering improvements. |
| Long recordings exceed context window | Medium | Implement chunking with summary-of-summaries pattern (Phase 4). |
| Chrome AI API changes (still evolving) | Medium | The `aiTranscriber.ts` abstraction isolates us from API changes. |
| Model download is large (22GB) and slow | Low | Show clear progress indicator. Model is cached after first download. |
