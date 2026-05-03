# SafeCap: Enhanced Local AI for Meeting Transcription & Summarization

## Problem Statement

SafeCap currently uses the browser's Web Speech API for real-time transcription during recordings and Chrome's built-in Summarizer API for generating meeting summaries after recordings stop. Both approaches have significant quality issues for longer meeting recordings:

**Transcription Quality Issues:**
- The Web Speech API is designed for voice commands and search queries, not long-form meeting transcription. Accuracy degrades substantially with multiple speakers, overlapping speech, technical jargon, accents, and long pauses.
- The Web Speech API in Chrome sends audio to Google's cloud servers, directly contradicting SafeCap's privacy-first, local-only philosophy.
- There is no punctuation control, speaker labels, or reliable timestamps.
- Real-time transcription during recording adds complexity but provides minimal user value.

**Summarization Quality Issues:**
- Chrome's Summarizer API (Gemini Nano) has a limited context window that silently truncates or degrades quality when fed long transcripts from extended meetings.
- A 30-60 minute meeting transcript (~15,000+ words) exceeds the model's capacity when passed as a single block.
- Users receive incomplete or shallow summaries that miss important decisions, action items, and context from later portions of the meeting.
- The current implementation does not gracefully handle the model's size limitations.

The result is that SafeCap's AI features — which are a core value proposition — produce noticeably subpar results for the primary use case (meeting recordings), leading to user frustration and reduced trust in the product.

## Solution

Implement a two-phase improvement to SafeCap's AI pipeline that dramatically improves both transcription accuracy and summarization completeness while maintaining the extension's strict privacy-first, local-only philosophy:

**Phase 1: Chunked Summarization (Quick Win)**
- Split long transcripts into sentence-boundary-aware chunks (~5,000 characters each) using the native `Intl.Segmenter` browser API.
- Summarize each chunk independently using Chrome's existing Summarizer API, then recursively combine and summarize chunk summaries until a final summary fits within the model's context window.
- Implement a backend-agnostic summarization interface so this same chunking pipeline works with future local LLM backends.

**Phase 2: On-Device Whisper Transcription**
- Replace the Web Speech API entirely with on-device Whisper transcription via `transformers.js`.
- Use the Whisper `base` model (~74MB quantized download) for significantly higher transcription accuracy (95%+ vs 85-90%).
- Transcribe automatically after recording stops (batch mode), removing live transcription overhead.
- Store transcripts locally in OPFS alongside recordings, exactly as today.
- Model downloads only happen on first use, with caching for subsequent transcriptions.

**Future Phase: Extended Summarization Backends**
- Add fallback summarization backends (WebLLM, Transformers.js) that implement the same pluggable interface, for users on non-Chrome browsers or hardware that cannot run Gemini Nano.
- This is a natural extension of the abstraction layer built in Phase 1.

## User Stories

### Core Experience

1. As a user recording a 45-minute team standup, I want the transcript to accurately capture every speaker and technical term, so that I don't have to manually correct the transcript later.

2. As a user recording a client meeting, I want SafeCap to not send my audio to any external server during transcription, so that I can trust the tool with confidential conversations.

3. As a user who just finished recording, I want the transcript and summary to appear automatically without any extra clicks, so that my workflow remains frictionless.

4. As a user reviewing a past recording, I want the summary to cover all major discussion points from the entire meeting — not just the first 10 minutes — so that I can quickly find what I need.

5. As a user with a 2-hour all-hands meeting recording, I want the summary to be generated in a reasonable amount of time (under 5 minutes) without crashing or hanging, so that I don't have to wait indefinitely.

6. As a user on a laptop with 8GB RAM, I want SafeCap to gracefully handle my hardware limitations by either using a lighter model or showing a clear message, so that the app doesn't freeze my browser.

7. As a user who values minimal UI, I don't want to see live transcription during recording, so that the recording interface stays clean and focused on the core controls.

### First-Time / Onboarding

8. As a first-time user, when I record my first meeting and transcription starts, I want to see a clear progress indicator telling me that the AI model is being downloaded, so that I understand why it's taking longer than usual.

9. As a first-time user, after the model downloads, I want to see a confirmation that the model is cached and future recordings will be faster, so that I know the wait was a one-time cost.

10. As a user who accidentally closed the sidepanel while transcription was running, I want transcription to resume or complete when I reopen it, so that I don't lose the transcript.

### Quality & Accuracy

11. As a user reviewing a meeting transcript, I want to see proper punctuation and sentence boundaries, so that the transcript is readable without manual cleanup.

12. As a user whose team has non-native English speakers, I want Whisper's accent-tolerant transcription so that all voices are captured accurately, not just the native speakers.

13. As a user recording a meeting where people talk over each other, I want the transcript to still be usable, so that overlapping speech doesn't create total gibberish.

14. As a user reviewing a summary, I want it to include action items and key decisions from the latter half of the meeting, so that the summary is actually useful for follow-ups.

15. As a user reading a summary, I want it formatted in markdown with clear sections, so that it's easy to scan and copy-paste into other tools.

### Privacy & Local-First

16. As a privacy-conscious user, I want SafeCap to never send my meeting audio to Google or any third-party server for transcription, so that I can use it for sensitive internal meetings.

17. As a user who has read SafeCap's privacy manifesto, I want the tool to consistently honor its "zero server" promise in all AI features, so that I don't discover a hidden data leak.

18. As a user in an air-gapped or heavily restricted network, I want transcription to work offline after the initial model download, so that I can use SafeCap without internet access.

### Performance & Reliability

19. As a user recording a quick 5-minute demo, I want the summary to generate instantly without the overhead of chunking, so that short recordings feel fast.

20. As a user with dozens of saved recordings, I want the transcription model to be downloaded once and shared across all recordings, so that I don't pay the download cost repeatedly.

21. As a user whose browser has limited storage, I want SafeCap to tell me if I don't have enough space for the Whisper model before it starts downloading, so that I can free up space or skip transcription.

22. As a user who encountered a transcription error on one chunk of a long meeting, I want the rest of the transcript to still be generated (with the problematic section noted), so that a single glitch doesn't ruin the entire recording.

### Future-Proofing & Extensibility

23. As a developer contributing to SafeCap, I want the summarization pipeline to have a clean, well-defined backend interface, so that I can easily add new local LLM backends without rewriting the orchestration logic.

24. As a user on Firefox (if SafeCap ever supports it), I want a fallback summarization backend that works when Chrome's built-in AI isn't available, so that I'm not locked out of AI features.

25. As a power user, I want the option to bring my own API key for cloud transcription/summarization in the future, so that I can get even higher quality on critical recordings while keeping local processing as the default.

### Error Handling & Feedback

26. As a user whose device doesn't meet the requirements for the Whisper model, I want a clear, friendly message explaining why transcription is unavailable and what my options are, so that I'm not left confused.

27. As a user who just recorded a meeting where nobody spoke (e.g., I forgot to unmute), I want SafeCap to gracefully handle the empty audio and show a "no speech detected" message instead of a cryptic error.

28. As a user with a very long recording, I want to see per-chunk progress during summarization (e.g., "Summarizing chunk 3 of 7"), so that I know the app hasn't frozen and can estimate remaining time.

29. As a user who wants to delete all my data, I want the "nuclear option" to also clear cached AI models, so that I can truly wipe everything.

## Implementation Decisions

### Architecture: Pluggable Summarization Backend

- A backend-agnostic `SummarizerBackend` interface will be defined with three properties: a human-readable `name`, an `isAvailable()` check, and a `summarize(text)` method.
- Each backend implementation (Chrome Summarizer API, future WebLLM, future Transformers.js) encapsulates its own configuration (model params, prompts, API specifics). The orchestrator never leaks backend-specific concepts.
- This interface is intentionally minimal to avoid abstraction leakage and makes swapping backends trivial.

### Backend-Agnostic Chunking Orchestrator

- A `summarizeLongText()` utility will handle all chunking logic, regardless of which backend is used.
- It splits text at sentence boundaries using `Intl.Segmenter` (zero dependencies, native browser API), with a configurable chunk size and overlap.
- Chunks are processed **sequentially** to respect API rate limits and avoid resource contention on client hardware.
- Each chunk gets **one retry** on failure before being skipped, with failures logged but not aborting the entire pipeline.
- **Fast path**: If the transcript fits in a single chunk, it skips chunking entirely and calls the backend directly.
- **Recursive reduction**: If combined chunk summaries still exceed the chunk threshold, the pipeline recursively summarizes the summaries (max depth 2).
- **Progress reporting**: The orchestrator emits granular progress events including the current chunk index, total chunks, and overall percentage.

### Text Splitting Strategy

- `Intl.Segmenter` with `granularity: 'sentence'` is the primary text splitter. It is locale-aware and produces natural sentence boundaries.
- A fallback regex-based splitter (`[.!?]` followed by space/capital letter) is used if `Intl.Segmenter` is unavailable.
- **Chunk size**: 5,000 characters (~1,250 tokens at 4 chars/token), leaving headroom for the model's prompt + output.
- **Overlap**: 200 characters between chunks to preserve context across boundaries. Overlap prefers sentence boundaries to avoid cutting mid-sentence.
- **LangChain.js `RecursiveCharacterTextSplitter`** is noted as a future upgrade path if sentence-level splitting proves insufficient (e.g., for speaker diarization or structured meeting notes).

### Transcription: Replace Web Speech API with Whisper

- **Library**: `@huggingface/transformers` with the `AutomaticSpeechRecognitionPipeline`.
- **Model**: `openai/whisper-base` quantized to `q4` or `q8` (target ~74MB download).
- **Timing**: Batch-only after recording stops. Real-time transcription is removed entirely from the recording flow.
- **Automation**: Transcription starts automatically after the recording is saved to OPFS. No manual user action required.
- **Execution context**: Runs in the sidepanel Vue app (simplest path). If UI freezing becomes a problem in practice, it will be migrated to a dedicated offscreen document.
- **Model lifecycle**: Downloaded on first use, cached via the browser's Cache API or OPFS. Subsequent recordings reuse the cached model.
- **Audio input**: Reads the `.webm` audio file directly from OPFS where the `MediaRecorder` saved it. No re-encoding needed if the audio codec is compatible.

### Transcription Backend Interface

- A `TranscriptionBackend` interface will mirror the `SummarizerBackend` pattern: `isAvailable()`, `transcribe(audioBlob)`, `name`.
- The initial implementation wraps `transformers.js`. Future implementations could support `whisper.cpp` WASM or cloud BYOK APIs.

### Removal of Real-Time Transcription

- The `SpeechRecognition` live transcription code in the sidepanel recording flow will be removed.
- The `segments` live transcript array and `initSpeechRecognition()` function are removed.
- The UI no longer shows a "Live Transcript" panel during recording.
- This simplifies the recording flow, reduces memory pressure, removes a cloud data leak, and eliminates a feature users found low-value.

### Post-Recording Processing Pipeline

After the user clicks "Stop Recording", the flow becomes:
1. Save recording to OPFS (existing behavior).
2. Save metadata to `chrome.storage.local` (existing behavior).
3. **NEW**: Extract audio from the `.webm` file.
4. **NEW**: Check if Whisper model is cached. If not, download with progress UI.
5. **NEW**: Transcribe the full audio using Whisper.
6. **NEW**: Save transcript to OPFS as JSON alongside the recording.
7. **NEW**: Trigger summarization (existing chunked pipeline) on the transcript.
8. **NEW**: Save summary back to the transcript JSON.
9. Show preview + transcript + summary to user.

### OPFS Storage Schema

- Recordings: `opfs:recordings/<id>.webm` (existing)
- Transcripts: `opfs:transcripts/<id>.transcript.json` (existing, updated with Whisper output)
- Transcript format remains the same: `{ recordingId, generatedAt, segments[], summary, chapters[] }`
- Whisper segments include proper `start`/`end` timestamps and full text.

### Progress UI

- During transcription: "Downloading AI model... 45%" (first use only) → "Transcribing meeting... 30%"
- During summarization: "Summarizing chunk 3 of 7..." with a progress bar.
- The existing `SummaryProgress` type is extended with an optional `message` field for chunk-level detail.

### Error Handling & Resilience

- Model download failure: Show friendly message, allow retry, offer to skip transcription.
- Transcription failure: Save recording without transcript, show warning, allow manual retry from recordings library.
- Summarization chunk failure: Retry once, then skip the chunk, log to console, continue with remaining chunks.
- Empty/no-speech audio: Detect and show "No speech detected" instead of a blank transcript.

### Chrome Extension Considerations

- The `offscreen` permission is already declared in `wxt.config.ts` for potential future migration.
- Transformers.js requires DOM APIs (for Web Workers and WASM loading), which are available in the sidepanel and offscreen documents but not in service workers.
- The sidepanel is a persistent DOM context, making it suitable for long-running ML tasks.

## Testing Decisions

### What Makes a Good Test

- **Test external behavior, not implementation details.** We care that `summarizeLongText()` produces a coherent summary for a given long text, not how many chunks it internally creates.
- **Test the abstraction interfaces.** Mock `SummarizerBackend` implementations to verify the orchestrator correctly chunks, retries, and recurses without depending on real ML models.
- **Test edge cases in text splitting.** Empty strings, single-sentence texts, text with no punctuation, very long sentences.
- **Do not test actual model inference.** Downloading and running Whisper or Gemini Nano in CI is slow, flaky, and non-deterministic. Use mocked backends for unit tests.

### Modules to Test

1. **`textSplitter.ts`** (high priority)
   - Unit tests for `splitTextIntoChunks()`.
   - Verify sentence boundary splitting, chunk size limits, overlap behavior, fast path.
   - Mock `Intl.Segmenter` to test fallback regex path.

2. **`summarizerBackend.ts`** (high priority)
   - Unit tests for `summarizeLongText()`.
   - Mock `SummarizerBackend` that returns predictable strings.
   - Test: single chunk (fast path), multi-chunk, recursive depth, retry on failure, skip on double failure, progress callback accuracy.

3. **Mock `SummarizerBackend` implementations** (medium priority)
   - A `FailingBackend` that always throws, used to test error resilience.
   - A `SlowBackend` that resolves after a delay, used to test progress reporting.

4. **Mock `TranscriptionBackend` implementations** (medium priority, for Phase 2)
   - A `MockWhisperBackend` that returns hardcoded transcript segments.
   - Test the orchestration: model download → transcribe → save flow.

5. **Integration tests for the sidepanel recording flow** (low priority, after Phase 2)
   - Use Playwright E2E to verify: start recording → stop → see "Processing..." → see transcript + summary.
   - Mock the ML backends in E2E to avoid real model downloads.

### Prior Art in the Codebase

- The project already uses Vitest for unit tests (`tests/unit/**/*.spec.ts`) with `@vue/test-utils` for component testing.
- The `lefthook` pre-commit hook runs `pnpm test` automatically.
- Existing tests follow the pattern: `describe` blocks + `it('should...')` assertions.

## Out of Scope

- **Speaker diarization** (identifying who said what). Whisper models do not natively provide speaker labels, and adding it requires a separate model (e.g., pyannote) which is not available in browser-friendly form. Noted as a future enhancement.
- **Real-time transcription** during recording. The decision was made to remove this entirely. If user feedback strongly demands it, streaming Whisper transcription can be explored later.
- **Cloud-based transcription or summarization** (BYOK). This is acknowledged as a potential future Pro-tier feature but is explicitly out of scope for this PRD to maintain the local-only default.
- **Non-English transcription models**. The initial implementation targets English (`en-US`). Multilingual Whisper models exist and can be swapped in later, but the initial integration focuses on the primary use case.
- **Model quantization experimentation**. The `base` model at `q4` or `q8` is the starting point. Fine-tuning quantization strategies for specific hardware is out of scope.
- **WebLLM / Transformers.js summarization backends.** These are Phase 3 and depend on the success of Phase 1 + 2. The architecture is designed for them, but implementation is deferred.
- **Offscreen document execution for ML.** The initial implementation runs in the sidepanel. Migration to an offscreen document is a performance optimization, not a functional requirement.
- **GPU acceleration detection and tuning.** The implementation will use WebGPU if available (handled by `transformers.js` automatically) but will not include custom GPU profiling or fallback logic beyond what the library provides.
- **Transcript editing UI.** Users cannot edit transcripts after generation in this version. Read-only display only.

## Further Notes

### Privacy Impact

Removing the Web Speech API is not just a quality improvement — it closes a privacy gap. The `webkitSpeechRecognition` API in Chrome sends audio to `speech.googleapis.com` by default. Switching to on-device Whisper makes the transcription pipeline fully consistent with SafeCap's "zero server" philosophy.

### Model Download UX

The first Whisper model download (~74MB) may take 30-120 seconds depending on the user's connection. The UI must clearly communicate:
- That this is a one-time download
- The download progress
- That future recordings will use the cached model
- An option to cancel (which skips transcription for this recording)

### Performance Expectations

- **Whisper `base` transcription**: ~2-4 minutes for a 30-minute recording on a modern laptop.
- **Chunked summarization**: ~1-3 minutes for a 30-minute transcript (depends on chunk count).
- **Total post-processing time**: ~3-7 minutes for a typical meeting.
- These are acceptable for a batch workflow where the user is not waiting actively.

### Migration Path for Existing Users

- Existing recordings with Web Speech API transcripts will remain as-is.
- New recordings will use Whisper transcription.
- The transcript storage format (`RecordingTranscript`) remains unchanged, so old and new transcripts are compatible.
- The recordings library page will display both old (Web Speech) and new (Whisper) transcripts without migration.

### Chrome Built-in AI Status

Chrome's Summarizer API (Gemini Nano) requires Chrome 138+, 22GB free disk, and 16GB RAM or 4GB VRAM. It is currently only available in stable Chrome for extensions. The chunked summarization implementation gracefully handles its unavailability by falling back to returning an empty summary (existing behavior). The pluggable backend design allows adding a local LLM fallback in the future.

### Developer Onboarding

New developers should know that:
1. Running the app for the first time will trigger a Whisper model download.
2. The download is cached in the browser's Cache API, so only the first run is slow.
3. To avoid downloads in tests, mock the `TranscriptionBackend` interface.
4. The `transformers.js` library uses Web Workers internally. Do not be alarmed by worker threads in the DevTools Performance panel.
