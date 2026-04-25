# PRD: AI-Powered Transcripts, Summaries & Chapter Markers

## Problem Statement

As a SafeCap user, I record demos and meetings but have no way to quickly understand what's in a recording without watching the entire thing. I need to search through recordings, find specific moments, and get a quick overview of the content — similar to the transcript and summary features in Loom, but fully local and private.

## Solution

Add an AI-powered transcription pipeline that generates timestamped transcripts, AI summaries, and chapter markers for recordings. Everything runs 100% locally with no data leaving the device. The feature is free for all users since it has zero infrastructure cost.

**Architecture: Hybrid approach using Web Speech API + Chrome Built-in AI.**

Full transcription via Chrome AI (Gemini Nano) is not feasible due to the token limits: **1,024 tokens per prompt** and **4,096 tokens session context window**. A 5-minute meeting transcript easily exceeds these limits.

Instead, we use:

1. **Web Speech API** (`SpeechRecognition`) for real-time transcription during recording — unlimited, free, runs in real-time
2. **Chrome Prompt API** (`LanguageModel`) for chapter detection — small input (transcript text) fits in context window
3. **Chrome Summarizer API** (`Summarizer`) for summaries — same, small input

**Phase 1 (this PRD):** New visible recording page that handles recording + live transcription, replaces the offscreen document pattern. Post-recording summary + chapter generation via Chrome AI.

**Future:** Post-recording transcription fallback for recordings that didn't use the transcript page, using `browser-whisper` (WebGPU).

## User Stories

1. As a user, I want to start recording from the popup and have it open a dedicated transcript page, so that I can record with live transcription.
2. As a user, I want to see a live transcript feed while recording, so that I can verify my audio is being captured correctly.
3. As a user, I want to see a transcript with timestamps next to each segment after recording stops, so that I can find specific moments in the recording.
4. As a user, I want to see an AI-generated summary of the recording, so that I can understand the content without watching the full video.
5. As a user, I want to see auto-detected chapter markers with timestamps and titles, so that I can navigate to different sections of the recording.
6. As a user, I want to click on a transcript segment or chapter marker and have the video player jump to that timestamp, so that I can quickly navigate to relevant parts.
7. As a user, I want the transcript to be saved alongside the recording, so that I don't have to regenerate it every time I view the recording.
8. As a user, I want to see an indicator on recording cards that already have a transcript, so that I know which recordings have been processed.
9. As a user, I want to delete a transcript independently of the recording, so that I can regenerate it or free up space.
10. As a user, I want to copy the transcript text to my clipboard, so that I can paste it into notes or documentation.
11. As a user, I want the AI features to work fully offline after the initial model download, so that my data never leaves my machine.
12. As a user, I want to see a clear message if Chrome AI is not available on my device, so that I understand why summary/chapters won't be generated.
13. As a user, I want the transcript panel to be visible alongside the video player in the recordings modal, so that I can watch and read simultaneously.

## Implementation Decisions

### Architecture Overview

The recording and transcription pipeline runs in a **new visible page** (`entrypoints/transcript/main.ts` + `App.vue`). This replaces the offscreen document pattern entirely. The visible page context is required for `SpeechRecognition` (it throws a NotAllowedError in non-visible contexts like offscreen documents).

```
User clicks "Record" in popup → Background opens transcript page → Transcript page calls getDisplayMedia() → SpeechRecognition (live transcript) + MediaRecorder (video to OPFS) → Recording stops → Chrome AI generates summary + chapters → Transcript saved to OPFS
```

**Key architectural change:** All recording logic moves from the offscreen document to the new transcript page. This eliminates:

- Offscreen document creation/destruction in background
- 64MB chunked messaging (STREAM_START, STREAM_CHUNK, STREAM_END)
- Base64 conversion of video data
- MessagePort track transfer complexity

The transcript page writes directly to OPFS using `FileSystemWritableFileStream` — true streaming with no memory accumulation.

**No new message types are needed for recording.** The background script opens the transcript page and sends stop/pause/resume commands via `runtime.sendMessage`. The transcript page handles all recording, transcription, and AI processing locally.

### Generation Flow: Real-Time + Post-Processing

**During recording (real-time):**

1. `SpeechRecognition` runs continuously, producing timestamped segments
2. Segments are stored in memory (array)
3. User sees live transcript feed in the recording page

**After recording stops (post-processing):**

1. In-memory transcript saved to OPFS
2. Chrome AI generates summary from transcript text
3. Chrome AI generates chapter markers from transcript text
4. Success state shown, user redirected to recordings library

**Tab close protection:** A `beforeunload` event listener warns: "Recording is in progress. Are you sure you want to stop?" If the tab is closed despite the warning, the recording in progress is lost (video file may be incomplete). This is acceptable since the user explicitly chose to close.

### AI Backend: Chrome Built-in AI Only (Phase 1)

- Use **Chrome Summarizer API** (`Summarizer`) for generating summaries from the transcript text.
- Use **Chrome Prompt API** (`LanguageModel`) with structured output (JSON Schema) for chapter marker detection.
- If Chrome AI is unavailable (`availability() === 'unavailable'`), still allow recording and live transcription (Web Speech API works without Chrome AI), but skip summary + chapter generation. Show a message explaining that summaries and chapters require Chrome AI.
- Future fallback: `browser-whisper` npm package (WebGPU + WebCodecs Whisper) for post-recording transcription of recordings that didn't use the transcript page.

### Transcription: Web Speech API

- Use `SpeechRecognition` (prefixed as `webkitSpeechRecognition` in Chrome) for real-time transcription.
- **Audio source:** Pass the audio track from `getDisplayMedia()` to `SpeechRecognition.start({ audioTrack })`. This captures both the tab audio (speakers in a meeting) and any audio played through the tab.
- **Visible document required:** `SpeechRecognition` only works in a visible document context. This is why recording runs in a dedicated page, not an offscreen document.
- **Continuous mode:** Set `continuous = true` and `interimResults = true` for real-time streaming transcript.
- **Timestamps:** Use `result.timestamp` (milliseconds from start of recognition) to generate segment timestamps.
- **Language:** Default to `en-US`, allow user to configure language in settings (future).
- **Error handling:** Handle `no-speech`, `audio-capture`, `not-allowed`, and `network` errors gracefully.

### Audio Capture

- The transcript page calls `getDisplayMedia({ video: true, audio: true })` — single permission prompt.
- Video track → `MediaRecorder` → OPFS via `FileSystemWritableFileStream` (true streaming).
- Audio track → `SpeechRecognition.start({ audioTrack })` for live transcription.
- Both share the same `MediaStream` — no cross-context track transfer needed.

### Transcript Data Model

```typescript
interface TranscriptSegment {
  text: string
  start: number // seconds from start
  end: number // seconds from start
}

interface Chapter {
  title: string
  start: number // seconds from start
  end: number // seconds from start
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

**New Transcript/Recording Page (`entrypoints/transcript/`):**

- Minimal UI during recording: red dot indicator, "Recording/Paused" status, duration counter, live transcript feed (scrollable), Stop button.
- Note: "Keep this tab open during recording."
- After recording stops: "Processing..." state while Chrome AI generates summary + chapters.
- "Done" state with link to recordings library, preview of transcript/summary/chapters.
- If Chrome AI unavailable: skip summary/chapters, show message, still save transcript.

**Recordings Library (`entrypoints/recordings/App.vue`):**

- Add a "Transcript" icon button to each recording card (alongside Play, Download, Delete).
- If transcript exists: show `lucide:file-text` icon, clicking opens the transcript panel.
- If no transcript: show `lucide:wand-sparkles` icon, clicking triggers post-recording transcription (future Phase 2).
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

### Chrome AI Integration Details

**Model availability check:**

- On recordings page mount, check `LanguageModel.availability()` and `Summarizer.availability()`.
- If `downloadable`, show the "Enable AI Features" banner. Clicking the button triggers the model download with progress monitoring.
- If `unavailable`, disable summary + chapter generation. Recording and live transcription still work via Web Speech API.

**Summary:**

- Use `Summarizer.create()` with `type: 'key-points'`, `length: 'medium'`, `format: 'markdown'`.
- Feed the full transcript text as input.

**Chapters:**

- Use `LanguageModel.create()` with structured output.
- Prompt: "Analyze this transcript and identify the main topic changes. Return chapter markers with titles and timestamps."
- JSON Schema: `{ chapters: [{ title: string, start: number, end: number }] }`.

### Structured Output Fallback

Chrome AI structured output (JSON Schema via `responseConstraint`) is not guaranteed to produce valid JSON. Add a fallback parsing layer in `aiTranscriber.ts`:

1. **First:** Parse the response as JSON using the schema constraint.
2. **Second (if JSON parsing fails):** Use regex to extract `[MM:SS] text` patterns from the raw text response.
3. **Third (if regex also fails):** Fall back to a single-segment transcript with the full text and `start: 0, end: duration`.
4. Log the failure mode for debugging and quality tracking.

### Modules to Build/Modify

| Module                           | Action     | Description                                                                                                                                                                  |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entrypoints/transcript/`        | **New**    | New recording + transcription page (replaces offscreen document)                                                                                                             |
| `src/utils/transcriptStorage.ts` | **New**    | OPFS storage utilities for transcript JSON files                                                                                                                             |
| `src/utils/aiTranscriber.ts`     | **New**    | Chrome AI interactions: availability check, summarization, chapter detection. Simple interface: `generateSummaryAndChapters(transcriptText): Promise<{ summary, chapters }>` |
| `components/TranscriptPanel.vue` | **New**    | UI component for displaying transcript, summary, and chapters with video seek integration via `provide/inject`                                                               |
| `entrypoints/recordings/App.vue` | **Modify** | Add transcript button to cards, AI enablement banner, integrate transcript panel into modal with responsive layout, `provide` video ref, `chrome.storage.onChanged` listener |
| `entrypoints/background.ts`      | **Modify** | Remove offscreen document logic. Open transcript page instead. Handle stop/pause/resume messages.                                                                            |
| `entrypoints/offscreen/`         | **Delete** | No longer needed — recording moved to transcript page                                                                                                                        |
| `src/utils/storage.ts`           | **Modify** | Add `hasTranscript` field to metadata, update delete to clean up transcripts                                                                                                 |

### Manifest Changes

- No new permissions needed (Web Speech API and Chrome AI APIs don't require manifest permissions).
- May need to register for the origin trial token if the Prompt API requires it for extensions.

### Error Handling

- **AI unavailable:** Recording and live transcription still work. Show message that summary + chapters require Chrome AI.
- **SpeechRecognition errors:** Handle `no-speech` (silent recording), `audio-capture` (no audio device), `not-allowed` (permission denied), `network` (offline). Show appropriate messages.
- **getDisplayMedia denied:** Show error, recording cannot start.
- **Generation interrupted (tab closed):** Recording and transcript in progress are lost. `beforeunload` warning shown.
- **Structured output parsing failure:** Fall back to regex extraction, then to single-segment fallback.
- **Context window overflow:** For very long recordings, split transcript into chunks and summarize each chunk, then combine summaries (summary-of-summaries pattern).

### Performance Considerations

- Recording runs in a visible page context. The page must stay open during recording.
- Web Speech API runs in real-time with minimal CPU overhead.
- Chrome AI summary + chapter generation runs after recording stops — does not block the recording itself.
- Long recordings (>30 min) may hit Chrome AI context window limits for summary/chapters. Use the summary-of-summaries technique: split transcript into segments, summarize each segment, then summarize the combined summaries.
- Model download (~22GB) happens once and is managed by Chrome. Show download progress to the user.

### Dev Configuration

To get the Chrome AI Prompt API to work during local development, the following flag must be added to `wxt.config.ts`:

```typescript
export default defineConfig({
  webExt: {
    chromiumArgs: [
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
    ],
  },
})
```

## Testing Decisions

### What to Test

- **`aiTranscriber.ts`**: Unit test the module interface with mocked Chrome AI APIs. Test availability checks, error handling, summarization, and chapter detection. Test the structured output parsing for summaries and chapters.
- **`transcriptStorage.ts`**: Unit test OPFS read/write/delete operations with mock OPFS.
- **`TranscriptPanel.vue`**: Component test with mocked transcript data. Verify timestamp click events emit correct seek events. Verify copy-to-clipboard functionality.
- **Recordings page integration**: E2E test the full flow — click transcript icon, see transcript in panel, click segment to seek video.
- **Transcript page**: E2E test recording start → live transcription → recording stop → summary/chapter generation → redirect to library.

### What NOT to Test

- Do not test the actual Chrome AI API calls — these depend on hardware, model availability, and are non-deterministic.
- Do not test the actual Web Speech API — depends on browser support and audio input.
- Do not test the quality of AI output (transcription accuracy, summary quality) — this is model-dependent.

### Prior Art

- Existing unit tests in `tests/unit/` use Vitest with `@vue/test-utils` for component testing.
- E2E tests in `tests/e2e/` use Playwright with the extension loaded from `.output/chrome-mv3-dev`.

## Out of Scope

- **Post-recording transcription** — Phase 1 only supports real-time transcription during recording via the transcript page. Post-recording transcription (for recordings made without the transcript page) is a future Phase 2 feature using `browser-whisper`.
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

| Risk                                                                 | Impact | Mitigation                                                                                                                                              |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome AI not available on user's device                             | Medium | Recording + live transcription still works via Web Speech API. Summary + chapters skipped with clear message. Plan Whisper fallback for v2.             |
| Web Speech API transcription quality is poor                         | Medium | Depends on audio quality and language. Allow users to configure language. Consider Whisper fallback for v2.                                             |
| User closes transcript page during recording                         | High   | `beforeunload` warning. Recording lost if they proceed. Acceptable for Phase 1.                                                                         |
| Long recordings exceed Chrome AI context window for summary/chapters | Medium | Implement chunking with summary-of-summaries pattern (Phase 4).                                                                                         |
| Chrome AI API changes (still evolving)                               | Medium | The `aiTranscriber.ts` abstraction isolates us from API changes.                                                                                        |
| Model download is large (22GB) and slow                              | Low    | Show clear progress indicator. Model is cached after first download.                                                                                    |
| SpeechRecognition not supported in extension context                 | High   | Verified: works in visible extension pages (popup, new tabs). Does NOT work in offscreen documents — which is why we moved recording to a visible page. |

### Future Phases

**Phase 2: Post-Recording Transcription Fallback**

- For recordings that were made without the transcript page (e.g., legacy recordings).
- Integrate `browser-whisper` (WebGPU + WebCodecs) for offline transcription.
- "Generate Transcript" button on recording cards in the library.
- Non-blocking generation with inline progress.

**Phase 3: Cross-browser Support**

- Integrate `browser-whisper` as fallback when Chrome AI is unavailable.
- Detect browser capabilities and choose appropriate backend automatically.

**Phase 4: External AI Integration**

- Allow users to configure Ollama/LM Studio endpoints.
- Support OpenAI-compatible APIs for users who want cloud quality.
- Always default to local-first.
