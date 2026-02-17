# SafeCap Product Requirements Document

## Overview

SafeCap is a browser extension that enables users to record audio/video locally and transcribe/summarize recordings using on-device AI models. The extension prioritizes privacy, performance, and simplicity.

## Philosophy

- **Local First**: All processing happens on-device. No data leaves the user's machine.
- **Privacy & Security**: User recordings and transcripts never touch external servers
- **Performance**: Minimal impact on system resources and the active web application
- **Dead-Simple UX**: Intuitive interface requiring minimal setup

## Use Cases

### 1. Demo Recording (Loom Alternative)
- Record screen + audio for product demos, tutorials, bug reports
- Export with transcripts, timestamps, and summaries
- Share via exported files or cloud storage (future)

### 2. Meeting Recording (Granola Alternative)
- Record audio/video from Zoom, Meet, Teams, etc.
- Generate transcripts and summaries for later review
- Manual activation required

## Technical Stack

- **Framework**: WXT (Web Extension Toolkit) with Vue 3
- **Styling**: Tailwind CSS + Daisy UI
- **Language**: TypeScript
- **Testing**: Vitest (unit), Playwright (e2e)
- **AI/ML**: Transformers.js / ONNX Runtime for local models

## Phase 1: Core Recording (MVP)

### Goals
- Cross-browser screen/audio recording
- Local file storage
- Minimal performance impact
- Simple, intuitive UX

### Recording Sources

| Use Case | Video Source | Audio Source |
|----------|-------------|--------------|
| Demo Recording | Screen, Window, or Tab | Microphone + System Audio |
| Meeting Recording | None (audio-only) or Camera | Microphone + System Audio |

### Recording Options
- Screen/Tab/Window selection via native picker
- Audio source toggle (microphone on/off, system audio on/off)
- Quality settings (resolution, frame rate)

### User Interface

#### Toolbar Popup
```
┌─────────────────────┐
│  SafeCap            │
├─────────────────────┤
│ [Record Demo]       │
│ [Record Meeting]    │
│ [My Recordings]     │
│ [Settings]          │
└─────────────────────┘
```

#### Recording Controls (Floating Widget)
```
┌─────────────────────┐
│ ⏸  ⏹  ⏺  [00:05:23] │
└─────────────────────┘
```

### Storage Strategy
- **Primary**: Local filesystem via File System Access API
- **Fallback**: Download to default downloads folder
- **Format**: WebM/MP4 for video, WebM/MP3 for audio

### Browser Support Priority
1. Chrome (primary development target)
2. Safari
3. Firefox

### Performance Requirements
- Recording must not drop frames on target hardware
- Memory usage < 500MB during recording
- CPU usage < 15% on modern hardware

## Phase 2: AI Features

### Transcription

#### Model Strategy
- **Default**: Auto-download lightweight Whisper model (tiny or base)
- **Size**: < 100MB initial download
- **Alternative**: Connect to local Ollama/Whisper instance for power users

#### User Onboarding Flow
1. Extension installed
2. First-time setup wizard
3. Auto-download recommended model
4. Transparent progress indication
5. Test recording to validate setup

#### Transcription Features
- Real-time or post-recording transcription
- Speaker diarization (future)
- Timestamp alignment
- Multiple language support

### Summarization

#### Model Strategy
- Small LLM (< 3B parameters) running locally
- Alternatively, connect to local Ollama instance

#### Summary Types
- Executive summary (2-3 sentences)
- Key points (bullet list)
- Action items
- Full transcript with searchable text

### Output Format

```json
{
  "recording": {
    "filename": "demo_2024-01-15.webm",
    "duration": 300,
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "transcript": [
    {
      "start": 0,
      "end": 5.2,
      "text": "Hello everyone, welcome to this demo"
    }
  ],
  "summary": {
    "executive": "Overview of new feature X",
    "keyPoints": ["Point 1", "Point 2"],
    "actionItems": ["Action 1", "Action 2"]
  }
}
```

## Phase 3: Sharing & Cloud Integration

### Export Options (Phase 1)
- Download video/audio file
- Download transcript (TXT, SRT, VTT)
- Download summary (PDF, Markdown)

### Cloud Storage Integration (Phase 3)
- Google Drive upload
- YouTube upload (unlisted/private)
- Shareable link generation
- Local-first: always keep original on device

## UX Requirements

### Onboarding
1. One-click installation
2. Automatic model download (with progress)
3. Test recording to verify setup
4. Optional: advanced settings for power users

### Recording Flow
1. Click extension icon
2. Choose recording mode (Demo/Meeting)
3. Select sources (screen, audio)
4. Record with floating controls
5. Stop recording
6. Preview and save/export

### Settings
- Default recording mode
- Default quality settings
- Model selection/management
- Keyboard shortcuts (future)
- Auto-delete recordings after N days

## Security & Privacy

### Data Handling
- All recordings stored locally
- No telemetry or analytics without consent
- Optional anonymized usage stats
- Clear data deletion controls

### Permissions
- `activeTab`: For screen capture
- `downloads`: For saving recordings
- `storage`: For settings and metadata
- `offscreen`: For background processing

## Monetization Strategy

### Licensing
- Open source core under a license that prevents commercial copying
- Pro features via license key:
  - Advanced AI models
  - Cloud storage integration
  - Priority support
  - Custom branding

## Success Metrics

### Phase 1
- Recording works across major browsers
- < 5 second time-to-first-recording
- Zero crashes during recording
- Export works reliably

### Phase 2
- Transcription accuracy > 90%
- Model download < 2 minutes on average connection
- Summary generation < 30 seconds for 10-min recording

### Phase 3
- Cloud upload success rate > 95%
- Share link generation works
- User retention improves

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Browser API limitations | High | Thorough testing across browsers, graceful degradation |
| Model performance issues | High | Offer multiple model sizes, local server option |
| Large model downloads | Medium | Progressive download, clear progress indication |
| Storage limitations | Medium | Filesystem API, compression options |
| User confusion about local-only | Low | Clear messaging, transparent UX |

## Development Roadmap

### Sprint 1-2: Recording Core
- Setup WXT + Vue project
- Basic recording UI
- Screen capture implementation
- Audio capture implementation
- Local file storage

### Sprint 3-4: UX Polish
- Floating controls
- Settings page
- Error handling
- Cross-browser testing

### Sprint 5-6: AI Integration
- Transformers.js integration
- Whisper model download
- Transcription pipeline
- Basic UI for transcripts

### Sprint 7-8: Summarization
- Summarization model integration
- Summary generation
- Export functionality
- Performance optimization

### Sprint 9+: Cloud & Sharing
- Export enhancements
- Google Drive integration
- YouTube integration
- Share link generation

## Open Questions

- Specific license choice (AGPL? Elastic?)
- Exact model specifications for default download
- Cloud storage provider prioritization
- Analytics and telemetry strategy

---

*Last Updated: 2024*
*Status: Draft - Phase 1 Planning*
