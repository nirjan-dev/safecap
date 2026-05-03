# Plan: Enhanced Local AI for Meeting Transcription & Summarization

> Source PRD: `PRD-Enhanced-AI.md`

## Architectural Decisions

Durable decisions that apply across all phases:

- **Storage Schema**: Recordings stored at `opfs:recordings/<id>.webm`, transcripts at `opfs:transcripts/<id>.transcript.json`, metadata in `chrome.storage.local`. This schema is already in place and will not change.
- **Transcript Format**: `{ recordingId, generatedAt, segments[], summary, chapters[] }` — existing format, compatible with both old (Web Speech API) and new (Whisper) transcripts.
- **Backend Interfaces**: `SummarizerBackend` (already implemented) and `TranscriptionBackend` (to be added) are the abstraction layer. Implementations encapsulate their own model configs. The orchestration logic never leaks backend-specific concepts.
- **Execution Context**: Transcription runs in the sidepanel Vue app (simplest path). Migration to an offscreen document is a future performance optimization, not a requirement.
- **Chunking Parameters**: 5,000-character chunks, 200-character overlap, `Intl.Segmenter` for sentence splitting. These are tuned for Chrome's Summarizer API context window and will apply to all summarization backends.
- **Model Choice**: Whisper `base` via `transformers.js` (~74MB quantized). This is the target quality/size tradeoff for the initial transcription backend.

---

## Phase 1: Whisper Transcription — Manual Trigger

**User stories**: 1, 2, 8, 9, 11, 12, 16, 17, 20, 26, 27

### What to Build

A complete end-to-end path where a user can record a meeting, stop, click a "Transcribe with AI" button in the preview panel, and see a Whisper-generated transcript.

This phase proves the transcription backend works without touching the recording flow or automatic pipeline. The live Web Speech API remains in place during recording; the preview panel gets a new manual action.

### Acceptance Criteria

- [ ] `transformers.js` dependency is added and builds successfully.
- [ ] `TranscriptionBackend` interface is defined (mirrors the `SummarizerBackend` pattern).
- [ ] `WhisperTranscriber` implements `TranscriptionBackend` using `transformers.js` `AutomaticSpeechRecognitionPipeline` with the `openai/whisper-base` model.
- [ ] Model downloads on first use with a progress indicator in the preview panel.
- [ ] Model is cached via the browser Cache API for subsequent uses.
- [ ] A "Transcribe with AI" button appears in the preview panel after recording stops.
- [ ] Clicking the button reads the `.webm` audio from OPFS, transcribes it, and displays the transcript with timestamps in the preview panel.
- [ ] Transcript is saved to OPFS at `transcripts/<id>.transcript.json`.
- [ ] If transcription fails (model unavailable, no speech, etc.), a friendly error message is shown and the recording remains intact.
- [ ] If the user's device has insufficient storage for the model, a clear message is shown before download begins.

---

## Phase 2: Automatic Transcription + Summarization Pipeline

**User stories**: 3, 7, 10, 13, 14, 15, 19, 21, 28

### What to Build

Remove the live Web Speech API from the recording flow entirely. After the user clicks "Stop Recording", the app automatically runs the full post-processing pipeline: save → transcribe (Whisper) → summarize (chunked) → display.

The recording flow is simplified (no live transcript UI). The preview panel shows the full transcript and summary after processing completes.

### Acceptance Criteria

- [ ] Live Web Speech API transcription is removed from the sidepanel recording flow.
- [ ] The "Live Transcript" UI panel is removed from the recording view.
- [ ] After clicking "Stop Recording", the app automatically triggers Whisper transcription (reusing the backend from Phase 1).
- [ ] After transcription completes, the app automatically triggers chunked summarization (reusing the existing pipeline).
- [ ] A unified progress UI shows the current stage: "Saving..." → "Transcribing..." (with model download progress if first use) → "Summarizing chunk X of Y..." → "Done".
- [ ] The preview panel displays the video/audio player, the full transcript (with timestamps), and the summary.
- [ ] For short transcripts that fit in a single chunk, summarization uses the fast path (no chunking overhead).
- [ ] The first-time model download UX clearly explains this is a one-time cost and future recordings will be faster.
- [ ] If the sidepanel is closed during processing, the state is preserved and resumes when reopened (the recording and metadata are already saved; transcription/summarization can be re-triggered).
- [ ] `batchTranscriber.ts` (the old Web Speech API batch transcriber) is deprecated or removed.

---

## Phase 3: Recordings Library Transcript Viewer

**User stories**: 4, 5, 6, 10, 29

### What to Build

Add transcript viewing and management capabilities to the recordings library page. Users can view transcripts for any recording, see which recordings have transcripts, and re-transcribe old recordings if needed.

### Acceptance Criteria

- [ ] The recordings library page displays a list of all recordings with an indicator showing which ones have transcripts.
- [ ] Clicking a recording in the library opens a detail view showing the video/audio, transcript, and summary.
- [ ] Old recordings (created before this feature) that have Web Speech API transcripts display those transcripts without migration.
- [ ] Old recordings without transcripts show a "Transcribe now" button that runs Whisper on the saved audio.
- [ ] Transcripts can be viewed in a scrollable, timestamped format.
- [ ] The "nuclear option" (delete all data) also clears cached AI models (Whisper model cache).
- [ ] The recordings library handles recordings that failed transcription gracefully (shows a warning, allows retry).

---

## Phase 4: Tests, Error Handling, and Documentation

**User stories**: 18, 22, 23, 25, 26, 27, 29

### What to Build

Comprehensive unit tests for the new modules, error handling polish, and developer documentation updates.

### Acceptance Criteria

- [ ] Unit tests for `textSplitter.ts` (already written in Phase 0, but should be verified and expanded): sentence splitting, chunk size limits, overlap behavior, fast path, fallback regex path.
- [ ] Unit tests for `summarizerBackend.ts` (already written in Phase 0, verify): fast path, multi-chunk, recursive depth, retry on failure, skip on double failure, progress callback accuracy.
- [ ] Unit tests for the new `TranscriptionBackend` interface using a `MockTranscriptionBackend`.
- [ ] Unit tests for `WhisperTranscriber` with mocked `transformers.js` pipeline (no real model downloads in CI).
- [ ] Error handling: empty/no-speech audio detection shows "No speech detected" instead of a blank transcript or cryptic error.
- [ ] Error handling: model download failure shows a retry button and an option to skip transcription.
- [ ] Error handling: transcription failure on one chunk (for future multi-chunk audio processing) does not abort the entire pipeline.
- [ ] `AGENTS.md` is updated with the new architecture: transcription backend, post-recording pipeline, model caching, and how to mock backends in tests.
- [ ] E2E tests (Playwright) verify the happy path: start recording → stop → see processing → see transcript + summary. Use mocked backends to avoid real model downloads.
- [ ] All code passes `pnpm typecheck` and `pnpm lint`.
- [ ] All tests pass (`pnpm test`).

---

## Completed Work (Phase 0)

**Chunked Summarization** — already implemented before this plan was created:

- `textSplitter.ts` — Sentence-aware text chunking using `Intl.Segmenter`
- `summarizerBackend.ts` — Pluggable `SummarizerBackend` interface + chunked orchestrator
- Refactored `aiTranscriber.ts` — Uses chunked pipeline instead of single-shot
- Updated sidepanel UI — Shows chunk-level progress messages
