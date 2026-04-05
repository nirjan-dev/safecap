# PRD: AI-Powered Transcripts, Summaries & Chapter Markers

## Problem Statement

As a SafeCap user, I record demos and meetings but have no way to quickly understand what's in a recording without watching the entire thing. I need to search through recordings, find specific moments, and get a quick overview of the content — similar to the transcript and summary features in Loom, but fully local and private.

## Solution

Add an AI-powered transcription pipeline that generates timestamped transcripts, AI summaries, and chapter markers for recordings. Everything runs 100% locally using Chrome's built-in AI APIs (Summarizer API, Prompt API) with no data leaving the device. The feature is free for all users since it has zero infrastructure cost.

**Phase 1 (this PRD):** Post-recording transcript generation via a button in the recordings library, using Chrome Built-in AI.

**Future:** Real-time transcription during recording so the transcript is ready immediately when the recording stops.

## User Stories

1. As a recording library user, I want to see a "Generate Transcript" button on each recording card, so that I can create a transcript for any recording on demand.
2. As a user, I want to see a progress indicator while the transcript is being generated, so that I know the AI is working and how far along it is.
3. As a user, I want to see a transcript with timestamps next to each segment after generation, so that I can find specific moments in the recording.
4. As a user, I want to see an AI-generated summary of the recording, so that I can understand the content without watching the full video.
5. As a user, I want to see auto-detected chapter markers with timestamps and titles, so that I can navigate to different sections of the recording.
6. As a user, I want to click on a transcript segment or chapter marker and have the video player jump to that timestamp, so that I can quickly navigate to relevant parts.
7. As a user, I want the transcript to be saved alongside the recording, so that I don't have to regenerate it every time I view the recording.
8. As a user, I want to see an indicator on recording cards that already have a transcript, so that I know which recordings have been processed.
9. As a user, I want to delete a transcript independently of the recording, so that I can regenerate it or free up space.
10. As a user, I want to copy the transcript text to my clipboard, so that I can paste it into notes or documentation.
11. As a user, I want the AI features to work fully offline after the initial model download, so that my data never leaves my machine.
12. As a user, I want to see a clear message if Chrome AI is not available on my device, so that I understand why the feature isn't working.
13. As a user, I want the transcript panel to be visible alongside the video player in the recordings modal, so that I can watch and read simultaneously.

## Implementation Decisions

### Architecture Overview

The transcription pipeline runs **entirely in the recordings page context** — no background script involvement. Chrome AI APIs (`LanguageModel`, `Summarizer`) require a document context, and the recordings page already has direct access to OPFS and storage utilities. This eliminates unnecessary message passing and simplifies the architecture.

```
WebM recording → Audio extraction → Transcription (Chrome Prompt API audio) → Summary + Chapters (Chrome Summarizer API + Prompt API) → Store in OPFS
```

**No new message types are needed.** The recordings page calls `aiTranscriber.generateTranscript()` directly, shows progress locally, and saves to OPFS directly.

### Generation Flow: Non-Blocking

Transcript generation is **non-blocking**. When a user clicks "Generate Transcript" on a recording card:

1. An inline loading spinner and progress text appear on the card itself (e.g., "Transcribing... (2/4 stages)")
2. The user can continue browsing other recordings or doing anything else on the page
3. A success toast notification appears when generation completes
4. The card icon changes from `lucide:wand-sparkles` to `lucide:file-text`
5. Clicking the transcript icon after completion opens the transcript panel in the modal

**Tab close protection:** If the user tries to close the recordings tab while generation is in progress, a `beforeunload` event listener shows a browser-native warning: "Transcript generation is still in progress. Are you sure you want to leave?"

If the tab is closed despite the warning, generation is lost and the user can retry. This is acceptable for Phase 1.

### AI Backend: Chrome Built-in AI Only (Phase 1)

- Use **Chrome Prompt API** (`LanguageModel`) with audio input for transcription. The Prompt API supports `AudioBuffer`, `ArrayBuffer`, and `Blob` as audio input types.
- Use **Chrome Summarizer API** (`Summarizer`) for generating summaries from the transcript text.
- Use **Chrome Prompt API** with structured output (JSON Schema) for chapter marker detection.
- If Chrome AI is unavailable (`availability() === 'unavailable'`), show a disabled state with an explanation message.
- Future fallback: `browser-whisper` npm package (WebGPU + WebCodecs Whisper) for non-Chrome browsers.

### Audio Extraction

- **Primary approach (v1):** Pass the raw WebM blob directly to the Chrome Prompt API and see if it transcribes. This is the simplest path.
- **Fallback approach (documented for later):** If the Prompt API cannot handle WebM directly, extract audio using `AudioContext.decodeAudioData()` to produce an `AudioBuffer`, then pass that to the Prompt API.
- If `decodeAudioData()` fails (codec issues), fall back to using the raw WebM blob — the Prompt API accepts `Blob` input.
- The WebM blob is fetched from OPFS using the same lazy-loading pattern as video playback.

### Silence Detection

- Before running the AI pipeline, perform a quick audio energy check on the extracted audio.
- If the entire recording is below a noise threshold, skip AI processing and show: "No audio detected in this recording."
- This step is designed as a pluggable "content analysis" stage so future visual analysis can be added without restructuring the pipeline.

### Structured Output Fallback

Chrome AI structured output (JSON Schema via `responseConstraint`) is not guaranteed to produce valid JSON. Add a fallback parsing layer in `aiTranscriber.ts`:

1. **First:** Parse the response as JSON using the schema constraint.
2. **Second (if JSON parsing fails):** Use regex to extract `[MM:SS] text` patterns from the raw text response.
3. **Third (if regex also fails):** Fall back to a single-segment transcript with the full text and `start: 0, end: duration`.
4. Log the failure mode for debugging and quality tracking.

### Transcript Data Model

```typescript
interface TranscriptSegment {
  text: string
  start: number  // seconds from start
  end: number    // seconds from start
}

interface Chapter {
  title: string
  start: number  // seconds from start
  end: number    // seconds from start
}

interface RecordingTranscript {
  recordingId: string
  generatedAt: number
  segments: TranscriptSegment[]
  summary: string
  chapters: Chapter[]
}
```

### Storage

- Store transcripts in OPFS at `opfs:recordings/<id>.transcript.json` alongside the video file (`<id>.webm`).
- Add a `hasTranscript: boolean` flag to the recording metadata in `local:recordings` for quick UI rendering without checking OPFS.
- **Cross-tab sync:** Register a `chrome.storage.onChanged` listener to watch for `hasTranscript` updates. This ensures that if a transcript is generated in one recordings tab, other open recordings tabs update their UI reactively without requiring a manual refresh.
- Update `deleteRecording()` to also delete the transcript file from OPFS.
- Add new storage utilities: `saveTranscript()`, `getTranscript()`, `deleteTranscript()`.

### UI Changes

**Recordings Library (`entrypoints/recordings/App.vue`):**
- Add a "Transcript" icon button to each recording card (alongside Play, Download, Delete).
- If transcript exists: show `lucide:file-text` icon, clicking opens the transcript panel.
- If no transcript: show `lucide:wand-sparkles` icon, clicking triggers generation.
- During generation: show an inline loading spinner with stage-based progress text on the card (e.g., "Transcribing... (2/4 stages)").
- A success toast notification appears when generation completes.
- **AI Enablement Banner:** If Chrome AI model is in `downloadable` state, show a prominent banner at the top of the recordings page: "AI features require a one-time 22GB model download." with an "Enable AI Features" button. This single toggle downloads all models upfront.
- If AI is `unavailable`, show a disabled state on the transcript button with a tooltip explaining hardware requirements.

**Transcript Panel (new component `components/TranscriptPanel.vue`):**
- Tabs: "Transcript" | "Summary" | "Chapters"
- Transcript tab: scrollable list of segments with timestamps. Clicking a segment seeks the video player to that timestamp.
- Summary tab: markdown-rendered summary text with a "Copy" button.
- Chapters tab: list of chapters with timestamps. Clicking a chapter seeks the video player.
- "Delete Transcript" button at the bottom with a confirmation dialog: "Delete transcript for '{recording name}'? This cannot be undone."

**Modal Layout:**
- The transcript panel opens as a side panel within the existing video player modal.
- **Responsive layout:** On wide screens (>1280px), show side-by-side (video left ~60%, transcript right ~40%). On narrower screens, stack vertically (video top, transcript below as a collapsible panel).
- The modal width increases from `max-w-5xl` to a wider size when the transcript panel is open.
- The transcript panel has its own internal scroll independent of the video.

**Video-Transcript Communication:**
- Use Vue `provide/inject` to pass the video element reference from `App.vue` to `TranscriptPanel.vue`.
- The transcript panel emits seek events (e.g., `seek-to: number`) which the parent handles by setting `video.currentTime = timestamp`.

### Progress Tracking

- Progress is **stage-based**, not percentage-based. Chrome AI APIs return a single `Promise<string>` with no streaming progress.
- Four stages with equal weight (25% each): `extracting` → `transcribing` → `summarizing` → `chapters`.
- Within each stage, progress is binary (0 or 1). The UI shows "Stage 2 of 4: Transcribing..." rather than a percentage bar.

### Chrome AI Integration Details

**Model availability check:**
- On recordings page mount, check `LanguageModel.availability()` and `Summarizer.availability()`.
- If `downloadable`, show the "Enable AI Features" banner. Clicking the button triggers the model download with progress monitoring.
- If `unavailable`, disable AI features and show a message explaining requirements (Chrome 138+, GPU >4GB VRAM or CPU 16GB+ RAM, 22GB free space).

**Transcription prompt:**
- Use `LanguageModel.create()` with `expectedInputs: [{ type: 'audio' }]` and `expectedOutputs: [{ type: 'text' }]`.
- Prompt: "Transcribe this audio recording. For each segment, provide the text and the timestamp in seconds from the start. Format each segment as: [MM:SS] text"
- Use `responseConstraint` with JSON Schema to get structured output: `{ segments: [{ text: string, start: number, end: number }] }`.

**Summary:**
- Use `Summarizer.create()` with `type: 'key-points'`, `length: 'medium'`, `format: 'markdown'`.
- Feed the full transcript text as input.

**Chapters:**
- Use `LanguageModel.create()` with structured output.
- Prompt: "Analyze this transcript and identify the main topic changes. Return chapter markers with titles and timestamps."
- JSON Schema: `{ chapters: [{ title: string, start: number, end: number }] }`.

### Modules to Build/Modify

| Module | Action | Description |
|---|---|---|
| `src/utils/transcriptStorage.ts` | **New** | OPFS storage utilities for transcript JSON files |
| `src/utils/aiTranscriber.ts` | **New** | Deep module encapsulating all Chrome AI interactions: availability check, audio extraction, silence detection, transcription, summarization, chapter detection. Simple interface: `generateTranscript(webmBlob): Promise<RecordingTranscript>` with progress callbacks. |
| `components/TranscriptPanel.vue` | **New** | UI component for displaying transcript, summary, and chapters with video seek integration via `provide/inject` |
| `entrypoints/recordings/App.vue` | **Modify** | Add transcript button to cards, AI enablement banner, non-blocking generation flow, integrate transcript panel into modal with responsive layout, `provide` video ref, `chrome.storage.onChanged` listener |
| `src/utils/storage.ts` | **Modify** | Add `hasTranscript` field to metadata, update delete to clean up transcripts |

**Note: `entrypoints/background.ts` does NOT need modification.** All transcript generation runs directly in the recordings page context.

### Deep Module: `aiTranscriber.ts`

This is the key deep module. It encapsulates all Chrome AI complexity behind a clean interface:

```typescript
interface TranscriptionProgress {
  stage: 'extracting' | 'transcribing' | 'summarizing' | 'chapters'
  progress: number  // 0-1 (binary for stage-based tracking)
}

interface TranscriberOptions {
  onProgress?: (progress: TranscriptionProgress) => void
  signal?: AbortSignal
}

interface TranscriberResult {
  segments: TranscriptSegment[]
  summary: string
  chapters: Chapter[]
}

interface TranscriberAvailability {
  available: boolean
  reason?: string  // e.g., 'Chrome AI not available on this device'
}

export async function checkAvailability(): Promise<TranscriberAvailability>
export async function generateTranscript(webmBlob: Blob, options?: TranscriberOptions): Promise<TranscriberResult>
```

This module is testable in isolation (mock Chrome AI APIs) and its interface is stable regardless of whether the underlying implementation uses Prompt API, Summarizer API, or a future Whisper fallback.

### Manifest Changes

- No new permissions needed (Chrome AI APIs don't require manifest permissions).
- May need to register for the origin trial token if the Prompt API requires it for extensions.

### Error Handling

- **AI unavailable:** Show informative message with hardware requirements.
- **Audio decode failure:** Show error, suggest trying a different recording.
- **Silent recording:** Skip AI processing, show "No audio detected in this recording."
- **Generation interrupted (tab closed):** Transcript is not saved if generation is incomplete. User can retry. `beforeunload` warning shown if tab is closed during generation.
- **Structured output parsing failure:** Fall back to regex extraction, then to single-segment fallback.
- **Context window overflow:** For very long recordings, split transcript into chunks and summarize each chunk, then combine summaries (summary-of-summaries pattern).

### Performance Considerations

- Transcription runs in the recordings page context (not background script) since Chrome AI APIs require a document context.
- Long recordings (>30 min) may hit context window limits. Use the summary-of-summaries technique: transcribe in segments, summarize each segment, then summarize the combined summaries.
- Model download (~22GB) happens once and is managed by Chrome. Show download progress to the user.
- Non-blocking generation means the UI remains responsive during processing.

## Testing Decisions

### What to Test

- **`aiTranscriber.ts`**: Unit test the module interface with mocked Chrome AI APIs. Test availability checks, error handling, and progress callback invocation. Test the structured output parsing for transcripts and chapters.
- **`transcriptStorage.ts`**: Unit test OPFS read/write/delete operations with mock OPFS.
- **`TranscriptPanel.vue`**: Component test with mocked transcript data. Verify timestamp click events emit correct seek events. Verify copy-to-clipboard functionality.
- **Recordings page integration**: E2E test the full flow — click generate button, see progress, see transcript in panel, click segment to seek video.

### What NOT to Test

- Do not test the actual Chrome AI API calls — these depend on hardware, model availability, and are non-deterministic.
- Do not test the quality of AI output (transcription accuracy, summary quality) — this is model-dependent.

### Prior Art

- Existing unit tests in `tests/unit/` use Vitest with `@vue/test-utils` for component testing.
- E2E tests in `tests/e2e/` use Playwright with the extension loaded from `.output/chrome-mv3-dev`.

## Out of Scope

- **Real-time transcription during recording** — This is a future enhancement. Phase 1 is post-recording only.
- **Non-Chrome browser support** (Firefox, Safari) — Will be addressed in a future phase using `browser-whisper` as a fallback.
- **Ollama / LM Studio integration** — Power-user feature for later. Phase 1 is Chrome AI only.
- **Speaker diarization** (identifying different speakers) — Not in v1.
- **Export transcript as separate file** (SRT, VTT, TXT) — Future enhancement.
- **Search within transcript** — Future enhancement.
- **Editing/correcting transcript segments** — Future enhancement.
- **Pro/Free tier gating** — This feature is free for all users.

## Further Notes

### Why Chrome Built-in AI for v1?

- **Zero bundle size impact** — The model is managed by Chrome, not bundled with the extension.
- **Zero infrastructure cost** — Runs entirely on-device, no API keys, no servers.
- **Aligns with privacy philosophy** — No data ever leaves the user's machine.
- **Good enough for validation** — Lets us validate the UX and user demand before investing in heavier solutions like Whisper.

### Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Chrome AI not available on user's device | High | Clear messaging, graceful disabled state. Plan Whisper fallback for v2. |
| Transcription quality is poor for technical content | Medium | Allow users to retry. Consider prompt engineering improvements. |
| Long recordings exceed context window | Medium | Implement chunking with summary-of-summaries pattern. |
| Chrome AI API changes (still evolving) | Medium | The `aiTranscriber.ts` abstraction isolates us from API changes. |
| Model download is large (22GB) and slow | Low | Show clear progress indicator. Model is cached after first download. |

### Future Phases

**Phase 2: Real-time Transcription**
- Capture audio chunks during recording in the offscreen document.
- Send audio chunks to background via message passing.
- Transcribe incrementally using Chrome Prompt API.
- Store transcript progressively in OPFS.
- User sees transcript ready immediately when recording stops.

**Phase 3: Cross-browser Support**
- Integrate `browser-whisper` as fallback when Chrome AI is unavailable.
- Detect browser capabilities and choose appropriate backend automatically.

**Phase 4: External AI Integration**
- Allow users to configure Ollama/LM Studio endpoints.
- Support OpenAI-compatible APIs for users who want cloud quality.
- Always default to local-first.
