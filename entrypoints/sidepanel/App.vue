<script lang="ts" setup>
import type { SummaryProgress } from '@/src/utils/aiTranscriber'
import type { RecordingTranscript, TranscriptSegment } from '@/src/utils/transcriptStorage'
import { Icon } from '@iconify/vue'
import { generateRecordingInsights } from '@/src/utils/aiTranscriber'
import { getTranscript, saveTranscript } from '@/src/utils/transcriptStorage'

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
const LOG_PREFIX = '[SafeCap sidepanel]'
const SPEECH_RECOGNITION_RESTART_DELAY_MS = 250
const MAX_SPEECH_RECOGNITION_START_FAILURES = 3
const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

type RecordingMode = 'audio' | 'video' | 'both'
type RecordingState = 'idle' | 'recording' | 'paused' | 'processing'
interface ActiveTabInfo { title?: string, url?: string }

const mode = ref<RecordingMode>('both')
const state = ref<RecordingState>('idle')
const duration = ref(0)
const segments = ref<TranscriptSegment[]>([])
const interimTranscript = ref('')
const statusText = ref('')
const hasMic = ref(false)
const micEnabled = ref(false)
const isRequestingMic = ref(false)
const micPermissionState = ref<PermissionState>('prompt')
const micErrorText = ref('')
const currentTabInfo = ref<ActiveTabInfo | null>(null)
const showPreview = ref(false)
const previewUrl = ref<string | null>(null)
const summaryProgress = ref<SummaryProgress>({ status: 'idle', progress: 0 })
const recordingSummary = ref('')

const micStatusText = computed(() => {
  if (isRequestingMic.value) {
    return 'Requesting microphone permission...'
  }

  if (micEnabled.value) {
    return 'Mic will be included in audio and screen recordings.'
  }

  if (micPermissionState.value === 'granted') {
    return 'Mic permission is granted, but mic is off for new recordings.'
  }

  if (micPermissionState.value === 'denied') {
    return 'Microphone is blocked in Chrome settings.'
  }

  return micErrorText.value || 'Enable mic before screen recording to capture your voice.'
})

let mediaRecorder: MediaRecorder | null = null
let speechRecognition: any = null
let currentAudioTrack: MediaStreamTrack | null = null
let mixedAudioContext: AudioContext | null = null
let writableStream: FileSystemWritableFileStream | null = null
let rootDir: FileSystemDirectoryHandle | null = null
let recordingsDir: FileSystemDirectoryHandle | null = null
let activeSourceStreams: MediaStream[] = []
let recordingStartTime = 0
let recordingStoppedAt = 0
let pausedDuration = 0
let pauseStartedAt = 0
let currentRecordingId = ''
let durationTimer: number | null = null
let currentBlob: Blob | null = null
let recognitionRestartTimer: number | null = null
let recognitionShouldRun = false
let recognitionStartAttempts = 0
let recognitionStartFailures = 0
let recordingChunkCount = 0
let recordedBytes = 0

function generateId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function formatRecordingTimestamp(timestamp: number): string {
  const date = new Date(timestamp || Date.now())
  const pad = (value: number) => value.toString().padStart(2, '0')

  const datePart = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-')

  return `${datePart} ${pad(date.getHours())}-${pad(date.getMinutes())}`
}

function cleanRecordingTitle(title?: string): string {
  return (title || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
}

function isInternalCaptureTitle(title: string): boolean {
  const normalized = title.trim()

  return !normalized
    || /^web-contents-media-stream\b/i.test(normalized)
    || /^[a-f0-9]{16,}$/i.test(normalized)
    || /^screen:\d+(?::\d+)?$/i.test(normalized)
    || /^window:\d+(?::\d+)?$/i.test(normalized)
}

function normalizeTabInfo(tabInfo: ActiveTabInfo | null | undefined): ActiveTabInfo | null {
  const title = cleanRecordingTitle(tabInfo?.title)
  const url = tabInfo?.url

  if (!title && !url) {
    return null
  }

  if (url?.startsWith(browser.runtime.getURL(''))) {
    return null
  }

  return {
    title: title || undefined,
    url,
  }
}

function generateRecordingName(tabTitle?: string): string {
  const title = cleanRecordingTitle(tabTitle) || (mode.value === 'audio' ? 'Audio Recording' : 'Recording')
  return `${title} - ${formatRecordingTimestamp(recordingStartTime)}`
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function logDebug(scope: 'recording' | 'transcription' | 'summary', message: string, data?: unknown) {
  if (data === undefined) {
    console.log(`${LOG_PREFIX} ${scope}: ${message}`)
    return
  }

  console.log(`${LOG_PREFIX} ${scope}: ${message}`, data)
}

function getRecordingElapsedSeconds(): number {
  if (!recordingStartTime) {
    return 0
  }

  const now = recordingStoppedAt || Date.now()
  const activePausedDuration = pauseStartedAt ? now - pauseStartedAt : 0
  return Math.max(0, (now - recordingStartTime - pausedDuration - activePausedDuration) / 1000)
}

function getTrackDebugInfo(track: MediaStreamTrack | null) {
  if (!track) {
    return null
  }

  return {
    id: track.id,
    kind: track.kind,
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
  }
}

function getStreamDebugInfo(stream: MediaStream) {
  return {
    id: stream.id,
    audioTracks: stream.getAudioTracks().map(track => getTrackDebugInfo(track)),
    videoTracks: stream.getVideoTracks().map(track => getTrackDebugInfo(track)),
  }
}

function stopActiveSourceStreams(reason: string) {
  if (!activeSourceStreams.length) {
    return
  }

  logDebug('recording', 'stopping source streams', {
    reason,
    streamCount: activeSourceStreams.length,
  })

  for (const stream of activeSourceStreams) {
    for (const track of stream.getTracks()) {
      if (track.readyState !== 'ended') {
        track.stop()
      }
    }
  }

  activeSourceStreams = []
}

function closeMixedAudioContext(reason: string) {
  if (!mixedAudioContext) {
    return
  }

  const ctx = mixedAudioContext
  mixedAudioContext = null

  if (ctx.state === 'closed') {
    return
  }

  logDebug('recording', 'closing mixed audio context', {
    reason,
    state: ctx.state,
  })

  void ctx.close().catch((error) => {
    console.warn(`${LOG_PREFIX} recording: failed to close mixed audio context`, error)
  })
}

function resetRecordingOutputState() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }

  showPreview.value = false
  segments.value = []
  interimTranscript.value = ''
  recordingSummary.value = ''
  summaryProgress.value = { status: 'idle', progress: 0 }
  currentBlob = null
}

async function getRecordingsDirectory(): Promise<FileSystemDirectoryHandle> {
  if (recordingsDir) {
    return recordingsDir
  }

  rootDir = await navigator.storage.getDirectory()
  recordingsDir = await rootDir.getDirectoryHandle('recordings', { create: true })
  return recordingsDir
}

async function getTabInfo() {
  currentTabInfo.value = null

  try {
    const backgroundTabInfo = normalizeTabInfo(await browser.runtime.sendMessage({
      type: 'GET_ACTIVE_TAB_INFO',
    }))

    if (backgroundTabInfo) {
      currentTabInfo.value = backgroundTabInfo
      logDebug('recording', 'active tab metadata loaded from background', backgroundTabInfo)
      return
    }
  }
  catch (error) {
    logDebug('recording', 'failed to read active tab metadata from background', error)
  }

  try {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })
    const tabInfo = normalizeTabInfo({
      title: tab?.title,
      url: tab?.url,
    })

    if (tabInfo) {
      currentTabInfo.value = tabInfo
      logDebug('recording', 'active tab metadata loaded from sidepanel', tabInfo)
    }
  }
  catch (error) {
    logDebug('recording', 'failed to read active tab metadata', error)
  }
}

function getCaptureTitleFromStream(stream: MediaStream): string {
  const label = stream.getVideoTracks()[0]?.label ?? ''
  if (isInternalCaptureTitle(label)) {
    return ''
  }

  const title = label
    .replace(/^(chrome\s+tab|browser|tab|window|screen)\s*[:|-]\s*/i, '')
    .replace(/^(screen|window)\s*\d*\s*[:|-]?\s*/i, '')

  if (isInternalCaptureTitle(title) || /^[a-z]+:\d/i.test(title.trim())) {
    return ''
  }

  return cleanRecordingTitle(title)
}

function updateTabInfoFromCaptureStream(stream: MediaStream) {
  const title = getCaptureTitleFromStream(stream)
  if (!title) {
    return
  }

  const current = currentTabInfo.value
  const shouldKeepUrl = !current?.title || cleanRecordingTitle(current.title) === title

  currentTabInfo.value = {
    title,
    url: shouldKeepUrl ? current?.url : undefined,
  }
}

function getMicrophoneErrorMessage(error: unknown): string {
  const errorName = error instanceof Error ? error.name : ''

  switch (errorName) {
    case 'NotAllowedError':
      return 'Microphone permission was dismissed or blocked.'
    case 'NotFoundError':
      return 'No microphone was found.'
    case 'NotReadableError':
      return 'Microphone is already in use by another app.'
    case 'OverconstrainedError':
      return 'Microphone constraints could not be satisfied.'
    default:
      return errorName ? `Microphone unavailable: ${errorName}` : 'Microphone unavailable.'
  }
}

async function checkMicPermission(enableWhenGranted = true): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    micPermissionState.value = status.state

    if (status.state === 'granted' && enableWhenGranted) {
      micEnabled.value = true
      micErrorText.value = ''
    }
    else if (status.state !== 'granted') {
      micEnabled.value = false
    }

    status.onchange = () => {
      micPermissionState.value = status.state
      logDebug('recording', 'microphone permission state changed', { state: status.state })

      if (status.state !== 'granted') {
        micEnabled.value = false
        hasMic.value = false
      }
    }

    logDebug('recording', 'microphone permission checked', {
      state: status.state,
      micEnabled: micEnabled.value,
    })
  }
  catch (error) {
    logDebug('recording', 'microphone permission query failed', error)
  }
}

async function requestMicrophoneStream(reason: string): Promise<MediaStream | null> {
  hasMic.value = false

  try {
    logDebug('recording', 'requesting microphone stream', { reason })

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: MIC_AUDIO_CONSTRAINTS,
    })

    hasMic.value = true
    micPermissionState.value = 'granted'
    micErrorText.value = ''

    logDebug('recording', 'microphone stream acquired', getStreamDebugInfo(stream))

    return stream
  }
  catch (error) {
    micEnabled.value = false
    micErrorText.value = getMicrophoneErrorMessage(error)
    await checkMicPermission(false)
    console.log('Mic getUserMedia failed:', error)
    logDebug('recording', 'microphone stream unavailable', {
      reason,
      error,
      permissionState: micPermissionState.value,
    })
    return null
  }
}

async function enableMicrophone() {
  if (isRequestingMic.value) {
    return
  }

  isRequestingMic.value = true
  micErrorText.value = ''

  try {
    const stream = await requestMicrophoneStream('manual enable')
    if (!stream) {
      statusText.value = micErrorText.value
      return
    }

    stream.getTracks().forEach(track => track.stop())
    micEnabled.value = true
    statusText.value = 'Microphone enabled'
    logDebug('recording', 'microphone enabled for future recordings')
  }
  finally {
    isRequestingMic.value = false
  }
}

function disableMicrophone() {
  micEnabled.value = false
  hasMic.value = false
  statusText.value = 'Microphone disabled'
  logDebug('recording', 'microphone disabled for future recordings')
}

async function toggleMicrophone() {
  if (micEnabled.value) {
    disableMicrophone()
    return
  }

  await enableMicrophone()
}

async function maybeGetMicStream(): Promise<MediaStream | null> {
  if (!micEnabled.value) {
    hasMic.value = false
    logDebug('recording', 'microphone stream skipped because mic is disabled', {
      permissionState: micPermissionState.value,
    })
    return null
  }

  return requestMicrophoneStream('recording')
}

function mixAudio(tabStream: MediaStream, micStream: MediaStream | null): MediaStream {
  const tabAudio = tabStream.getAudioTracks()[0]
  const micTrack = micStream?.getAudioTracks()[0] ?? null

  if (!tabAudio && !micTrack) {
    logDebug('recording', 'no audio tracks available to mix', {
      tabStream: getStreamDebugInfo(tabStream),
      hasMicStream: Boolean(micStream),
    })

    return tabStream
  }

  closeMixedAudioContext('replacing audio mix')

  mixedAudioContext = new AudioContext()
  const ctx = mixedAudioContext
  const dst = ctx.createMediaStreamDestination()

  if (tabAudio) {
    const tabSource = ctx.createMediaStreamSource(new MediaStream([tabAudio]))
    tabSource.connect(dst)
  }

  if (micTrack) {
    ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dst)
  }

  const mixedStream = new MediaStream([
    ...tabStream.getVideoTracks(),
    ...dst.stream.getAudioTracks(),
  ])

  logDebug('recording', 'audio streams mixed', {
    audioContextState: ctx.state,
    tabAudio: getTrackDebugInfo(tabAudio ?? null),
    micAudio: getTrackDebugInfo(micTrack),
    mixedStream: getStreamDebugInfo(mixedStream),
  })

  return mixedStream
}

function getMixedAudioTrack(stream: MediaStream): MediaStreamTrack | null {
  return stream.getAudioTracks()[0] ?? null
}

function clearSpeechRecognitionRestartTimer() {
  if (recognitionRestartTimer === null) {
    return
  }

  clearTimeout(recognitionRestartTimer)
  recognitionRestartTimer = null
}

function getLiveRecognitionAudioTrack(): MediaStreamTrack | undefined {
  if (!currentAudioTrack) {
    return undefined
  }

  if (currentAudioTrack.readyState !== 'live') {
    logDebug('transcription', 'audio track is no longer live', getTrackDebugInfo(currentAudioTrack))
    return undefined
  }

  return currentAudioTrack
}

function scheduleSpeechRecognitionRestart(reason: string) {
  if (!recognitionShouldRun || state.value !== 'recording') {
    logDebug('transcription', 'restart skipped', {
      reason,
      recognitionShouldRun,
      state: state.value,
    })
    return
  }

  if (recognitionRestartTimer !== null) {
    logDebug('transcription', 'restart already scheduled', { reason })
    return
  }

  recognitionRestartTimer = window.setTimeout(() => {
    recognitionRestartTimer = null
    startSpeechRecognition(reason)
  }, SPEECH_RECOGNITION_RESTART_DELAY_MS)

  logDebug('transcription', 'restart scheduled', {
    reason,
    delayMs: SPEECH_RECOGNITION_RESTART_DELAY_MS,
  })
}

function startSpeechRecognition(reason: string) {
  if (!speechRecognition || !recognitionShouldRun) {
    logDebug('transcription', 'start skipped', {
      reason,
      hasRecognition: Boolean(speechRecognition),
      recognitionShouldRun,
    })
    return
  }

  const audioTrack = getLiveRecognitionAudioTrack()
  if (!audioTrack) {
    recognitionShouldRun = false
    statusText.value = 'Transcription stopped: no live audio track'
    logDebug('transcription', 'start aborted because no live audio track is available', { reason })
    return
  }

  try {
    recognitionStartAttempts += 1
    logDebug('transcription', 'starting speech recognition', {
      reason,
      attempt: recognitionStartAttempts,
      audioTrack: getTrackDebugInfo(audioTrack),
    })

    speechRecognition.start(audioTrack)
    recognitionStartFailures = 0
  }
  catch (error) {
    recognitionStartFailures += 1
    console.warn(`${LOG_PREFIX} transcription: failed to start speech recognition`, {
      reason,
      failureCount: recognitionStartFailures,
      error,
    })

    if (recognitionStartFailures <= MAX_SPEECH_RECOGNITION_START_FAILURES) {
      scheduleSpeechRecognitionRestart(`start failed: ${reason}`)
      return
    }

    recognitionShouldRun = false
    statusText.value = 'Transcription stopped: speech recognition failed to restart'
  }
}

function stopSpeechRecognition(reason: string, clearInstance = false) {
  recognitionShouldRun = false
  clearSpeechRecognitionRestartTimer()

  if (!speechRecognition) {
    currentAudioTrack = null
    logDebug('transcription', 'stop skipped because no recognizer exists', { reason })
    return
  }

  const recognition = speechRecognition

  if (clearInstance) {
    speechRecognition = null
    currentAudioTrack = null
  }

  try {
    logDebug('transcription', 'stopping speech recognition', {
      reason,
      clearInstance,
    })
    recognition.stop()
  }
  catch (error) {
    console.warn(`${LOG_PREFIX} transcription: failed to stop speech recognition`, {
      reason,
      error,
    })
  }
}

function flushInterimTranscript(reason: string) {
  const text = interimTranscript.value.trim()
  if (!text) {
    return
  }

  const endTime = getRecordingElapsedSeconds()
  const previousEnd = segments.value[segments.value.length - 1]?.end ?? 0
  segments.value.push({
    text,
    start: previousEnd,
    end: Math.max(endTime, previousEnd),
  })
  interimTranscript.value = ''

  logDebug('transcription', 'flushed interim transcript', {
    reason,
    textLength: text.length,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    endTime,
    totalSegments: segments.value.length,
  })
}

function initSpeechRecognition(audioTrack: MediaStreamTrack | null) {
  if (!SpeechRecognition) {
    statusText.value = 'Speech recognition not supported'
    logDebug('transcription', 'speech recognition API not supported')
    return
  }

  if (!audioTrack) {
    statusText.value = 'Transcription unavailable: no audio track'
    logDebug('transcription', 'initialization skipped because no audio track was provided')
    return
  }

  stopSpeechRecognition('reinitializing recognizer', true)

  currentAudioTrack = audioTrack
  recognitionShouldRun = true
  recognitionStartAttempts = 0
  recognitionStartFailures = 0
  speechRecognition = new SpeechRecognition()
  speechRecognition.continuous = true
  speechRecognition.interimResults = true
  speechRecognition.lang = 'en-US'

  logDebug('transcription', 'speech recognition initialized', {
    audioTrack: getTrackDebugInfo(audioTrack),
    continuous: speechRecognition.continuous,
    interimResults: speechRecognition.interimResults,
    lang: speechRecognition.lang,
  })

  speechRecognition.onresult = (event: any) => {
    let interimText = ''

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const text = result[0]?.transcript?.trim() ?? ''
      if (!text) {
        continue
      }

      if (result.isFinal) {
        const endTime = getRecordingElapsedSeconds()
        const previousEnd = segments.value[segments.value.length - 1]?.end ?? 0
        segments.value.push({
          text,
          start: previousEnd,
          end: Math.max(endTime, previousEnd),
        })
        interimTranscript.value = ''

        logDebug('transcription', 'final result received', {
          resultIndex: i,
          textLength: text.length,
          wordCount: text.split(/\s+/).filter(Boolean).length,
          start: previousEnd,
          end: endTime,
          totalSegments: segments.value.length,
        })
      }
      else {
        interimText = interimText ? `${interimText} ${text}` : text
      }
    }

    if (interimText) {
      interimTranscript.value = interimText
      console.debug(`${LOG_PREFIX} transcription: interim result`, {
        textLength: interimText.length,
        wordCount: interimText.split(/\s+/).filter(Boolean).length,
      })
    }
  }

  speechRecognition.onerror = (event: any) => {
    console.error(`${LOG_PREFIX} transcription: speech recognition error`, {
      error: event.error,
      message: event.message,
      state: state.value,
      audioTrack: getTrackDebugInfo(currentAudioTrack),
    })

    switch (event.error) {
      case 'no-speech':
        statusText.value = 'No speech detected'
        break
      case 'audio-capture':
        statusText.value = 'No audio capture device'
        recognitionShouldRun = false
        break
      case 'not-allowed':
        statusText.value = 'Microphone permission denied'
        recognitionShouldRun = false
        break
      case 'service-not-allowed':
        statusText.value = 'Speech recognition service not allowed'
        recognitionShouldRun = false
        break
      case 'network':
        statusText.value = 'Network error in speech recognition'
        break
      default:
        statusText.value = `Speech error: ${event.error}`
    }
  }

  speechRecognition.onend = () => {
    logDebug('transcription', 'speech recognition ended', {
      state: state.value,
      recognitionShouldRun,
      audioTrack: getTrackDebugInfo(currentAudioTrack),
    })

    if (recognitionShouldRun && state.value === 'recording') {
      scheduleSpeechRecognitionRestart('recognition ended')
    }
  }

  startSpeechRecognition('initial start')
}

async function startRecording() {
  try {
    logDebug('recording', 'start requested', { mode: mode.value })

    stopSpeechRecognition('starting new recording', true)
    stopActiveSourceStreams('starting new recording')
    closeMixedAudioContext('starting new recording')
    resetRecordingOutputState()
    statusText.value = ''
    activeSourceStreams = []
    recordingChunkCount = 0
    recordedBytes = 0

    currentTabInfo.value = null
    await getTabInfo()

    let stream: MediaStream
    let mimeType: string

    if (mode.value === 'both') {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
        },
        audio: {},
        systemAudio: 'include',
      } as any)

      activeSourceStreams.push(displayStream)
      updateTabInfoFromCaptureStream(displayStream)
      logDebug('recording', 'display stream acquired', getStreamDebugInfo(displayStream))

      const displayVideoTrack = displayStream.getVideoTracks()[0]
      if (displayVideoTrack) {
        displayVideoTrack.onended = () => {
          logDebug('recording', 'display video track ended')
          stopRecording()
        }
      }

      const shouldUseMic = micEnabled.value
      const micStream = await maybeGetMicStream()
      if (micStream) {
        activeSourceStreams.push(micStream)
      }
      else if (shouldUseMic) {
        statusText.value = micErrorText.value || 'Mic unavailable. Recording tab audio only.'
      }
      else {
        statusText.value = 'Mic off. Recording tab audio only.'
      }

      stream = micStream ? mixAudio(displayStream, micStream) : displayStream

      if (!micStream && !stream.getAudioTracks().length) {
        logDebug('recording', 'recording stream has no audio track')
      }

      mimeType = 'video/webm;codecs=vp9'
    }
    else if (mode.value === 'video') {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
        },
        audio: {},
        systemAudio: 'include',
      } as any)

      activeSourceStreams.push(stream)
      updateTabInfoFromCaptureStream(stream)
      logDebug('recording', 'display stream acquired', getStreamDebugInfo(stream))

      const displayVideoTrack = stream.getVideoTracks()[0]
      if (displayVideoTrack) {
        displayVideoTrack.onended = () => {
          logDebug('recording', 'display video track ended')
          stopRecording()
        }
      }

      mimeType = 'video/webm;codecs=vp9'
    }
    else {
      const micStream = await requestMicrophoneStream('audio recording')
      if (!micStream) {
        throw new Error(micErrorText.value || 'Microphone unavailable')
      }

      stream = micStream
      activeSourceStreams.push(stream)
      hasMic.value = true
      micEnabled.value = true
      logDebug('recording', 'audio stream acquired', getStreamDebugInfo(stream))

      mimeType = 'audio/webm;codecs=opus'
    }

    currentRecordingId = generateId()
    recordingStartTime = Date.now()
    recordingStoppedAt = 0
    pausedDuration = 0
    pauseStartedAt = 0

    const dir = await getRecordingsDirectory()
    const fileName = `${currentRecordingId}.webm`
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    writableStream = await fileHandle.createWritable()

    mediaRecorder = new MediaRecorder(stream, { mimeType })

    logDebug('recording', 'media recorder created', {
      recordingId: currentRecordingId,
      mimeType,
      recorderMimeType: mediaRecorder.mimeType,
      stream: getStreamDebugInfo(stream),
    })

    mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size > 0 && writableStream) {
        recordingChunkCount += 1
        recordedBytes += e.data.size
        await writableStream.write(e.data)

        if (recordingChunkCount <= 3 || recordingChunkCount % 30 === 0) {
          logDebug('recording', 'chunk written', {
            chunkCount: recordingChunkCount,
            chunkBytes: e.data.size,
            recordedBytes,
          })
        }
      }
    }

    mediaRecorder.onstop = async () => {
      logDebug('recording', 'media recorder stopped', {
        recordingId: currentRecordingId,
        chunkCount: recordingChunkCount,
        recordedBytes,
      })

      if (writableStream) {
        await writableStream.close()
        writableStream = null
      }

      closeMixedAudioContext('media recorder stopped')

      state.value = 'processing'
      statusText.value = 'Processing...'

      await saveRecording()
    }

    mediaRecorder.start(1000)
    state.value = 'recording'
    duration.value = 0
    startDurationTimer()

    logDebug('recording', 'recording started', {
      recordingId: currentRecordingId,
      mode: mode.value,
      mimeType,
    })

    if (mode.value !== 'video') {
      initSpeechRecognition(getMixedAudioTrack(stream))
    }
  }
  catch (error) {
    console.error('Failed to start recording:', error)
    logDebug('recording', 'failed to start recording', error)
    statusText.value = `Failed to start: ${error}`
    stopSpeechRecognition('recording start failed', true)
    stopActiveSourceStreams('recording start failed')
    closeMixedAudioContext('recording start failed')
  }
}

function startDurationTimer() {
  durationTimer = window.setInterval(() => {
    if (state.value === 'recording') {
      duration.value = Math.floor(getRecordingElapsedSeconds())
    }
  }, 1000)
}

function stopDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer)
    durationTimer = null
  }
}

function pauseRecording() {
  if (mediaRecorder && state.value === 'recording') {
    logDebug('recording', 'pause requested', {
      recorderState: mediaRecorder.state,
      elapsedSeconds: getRecordingElapsedSeconds(),
    })

    mediaRecorder.pause()
    state.value = 'paused'
    pauseStartedAt = Date.now()
    stopSpeechRecognition('recording paused')
  }
}

function resumeRecording() {
  if (mediaRecorder && state.value === 'paused') {
    logDebug('recording', 'resume requested', {
      recorderState: mediaRecorder.state,
      elapsedSeconds: getRecordingElapsedSeconds(),
    })

    mediaRecorder.resume()
    state.value = 'recording'
    if (pauseStartedAt) {
      pausedDuration += Date.now() - pauseStartedAt
      pauseStartedAt = 0
    }

    if (speechRecognition && currentAudioTrack) {
      recognitionShouldRun = true
      startSpeechRecognition('recording resumed')
    }
  }
}

function stopRecording() {
  logDebug('recording', 'stop requested', {
    hasRecorder: Boolean(mediaRecorder),
    recorderState: mediaRecorder?.state,
    elapsedSeconds: getRecordingElapsedSeconds(),
    chunkCount: recordingChunkCount,
    recordedBytes,
  })

  if (!recordingStoppedAt) {
    recordingStoppedAt = Date.now()
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    const recorder = mediaRecorder
    mediaRecorder = null

    stopSpeechRecognition('recording stopped', true)

    try {
      recorder.stop()
    }
    catch (error) {
      console.warn(`${LOG_PREFIX} recording: failed to stop media recorder`, error)
    }

    recorder.stream.getTracks().forEach(track => track.stop())
    stopActiveSourceStreams('recording stopped')
  }
  else {
    stopSpeechRecognition('recording stopped without active recorder', true)
    stopActiveSourceStreams('recording stopped without active recorder')
    closeMixedAudioContext('recording stopped without active recorder')
  }

  state.value = 'processing'
  statusText.value = 'Processing...'
  stopDurationTimer()
}

async function saveRecording() {
  const name = generateRecordingName(currentTabInfo.value?.title)
  const recordingDuration = getRecordingElapsedSeconds()

  try {
    flushInterimTranscript('saving recording')

    const dir = await getRecordingsDirectory()
    const fileHandle = await dir.getFileHandle(`${currentRecordingId}.webm`)
    const file = await fileHandle.getFile()
    const size = file.size
    currentBlob = file

    statusText.value = 'Processing...'

    const transcriptSegments = segments.value.map(segment => ({ ...segment }))
    const transcriptText = transcriptSegments.map(s => s.text).join(' ')

    logDebug('recording', 'saving recording metadata', {
      recordingId: currentRecordingId,
      name,
      duration: recordingDuration,
      size,
      transcriptSegments: transcriptSegments.length,
      transcriptCharacters: transcriptText.length,
      tabTitle: currentTabInfo.value?.title,
    })

    const fullTranscript: RecordingTranscript = {
      recordingId: currentRecordingId,
      generatedAt: Date.now(),
      segments: transcriptSegments,
      summary: '',
      chapters: [],
    }

    await saveTranscript(currentRecordingId, fullTranscript)

    logDebug('transcription', 'transcript saved', {
      recordingId: currentRecordingId,
      segmentCount: fullTranscript.segments.length,
      transcriptCharacters: transcriptText.length,
    })

    const hasAiContent = transcriptText.trim().length > 0

    const metadata = {
      id: currentRecordingId,
      name,
      createdAt: recordingStartTime,
      duration: recordingDuration,
      size,
      tabTitle: currentTabInfo.value?.title,
      tabUrl: currentTabInfo.value?.url,
      hasTranscript: hasAiContent,
    }

    await browser.runtime.sendMessage({
      type: 'SAVE_RECORDING',
      recording: metadata,
    })

    logDebug('recording', 'recording metadata sent to background', metadata)

    statusText.value = hasAiContent ? 'Recording saved!' : 'Recording saved!'
    previewUrl.value = URL.createObjectURL(currentBlob)
    showPreview.value = true
    state.value = 'idle'

    if (transcriptText.trim()) {
      logDebug('summary', 'starting background summary generation', {
        recordingId: currentRecordingId,
        transcriptCharacters: transcriptText.length,
      })
      generateSummaryInBackground(transcriptText, currentRecordingId, transcriptSegments)
    }
    else {
      logDebug('summary', 'summary skipped because transcript is empty', {
        recordingId: currentRecordingId,
      })
    }
  }
  catch (error) {
    console.error('Failed to save recording:', error)
    logDebug('recording', 'failed to save recording', error)
    statusText.value = `Failed to save: ${error}`
    state.value = 'idle'
  }
}

async function generateSummaryInBackground(
  transcriptText: string,
  recordingId: string,
  transcriptSegments: TranscriptSegment[],
) {
  summaryProgress.value = { status: 'checking', progress: 0 }

  logDebug('summary', 'checking summarizer availability', {
    recordingId,
    transcriptCharacters: transcriptText.length,
  })

  try {
    if (!('Summarizer' in globalThis)) {
      summaryProgress.value = { status: 'unavailable', progress: 0, error: 'Summarizer API not available' }
      logDebug('summary', 'summarizer API not available', { recordingId })

      return
    }

    const availability = await (globalThis as any).Summarizer.availability()
    logDebug('summary', 'summarizer availability result', {
      recordingId,
      availability,
    })

    if (availability === 'unavailable') {
      summaryProgress.value = { status: 'unavailable', progress: 0, error: 'Summarizer not available on this device' }
      logDebug('summary', 'summarizer unavailable on this device', { recordingId })

      return
    }

    const { summary, chapters } = await generateRecordingInsights(transcriptSegments, transcriptText, (p) => {
      summaryProgress.value = p
      logDebug('summary', 'summary progress update', {
        recordingId,
        status: p.status,
        progress: p.progress,
        message: p.message,
        error: p.error,
      })

      if (p.status === 'downloading') {
        statusText.value = `Downloading AI model... ${p.progress}%`
      }
      else if (p.status === 'summarizing') {
        statusText.value = p.message || 'Generating summary...'
      }
      else if (p.status === 'unavailable') {
        statusText.value = 'AI Summary unavailable'
      }
      else if (p.status === 'ready') {
        statusText.value = 'Recording saved with summary!'
      }
    })

    recordingSummary.value = summary
    logDebug('summary', 'summary generated', {
      recordingId,
      summaryCharacters: summary.length,
      chapterCount: chapters.length,
    })

    const existingTranscript = await getTranscript(recordingId)
    if (existingTranscript) {
      existingTranscript.summary = summary
      existingTranscript.chapters = chapters
      await saveTranscript(recordingId, existingTranscript)
      logDebug('summary', 'summary and chapters saved to transcript', {
        recordingId,
        chapterCount: chapters.length,
      })
    }
    else {
      logDebug('summary', 'summary was generated but transcript file was missing', { recordingId })
    }
  }
  catch (e) {
    console.error('Failed to generate summary:', e)
    logDebug('summary', 'failed to generate summary', {
      recordingId,
      error: e,
    })
    summaryProgress.value = { status: 'unavailable', progress: 0, error: String(e) }
  }
}

function clearRecording() {
  logDebug('recording', 'clearing current recording preview/state', {
    recordingId: currentRecordingId,
  })

  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
  showPreview.value = false
  segments.value = []
  interimTranscript.value = ''
  duration.value = 0
  statusText.value = ''
  currentBlob = null
  currentRecordingId = ''
  recordingStartTime = 0
  recordingStoppedAt = 0
  pausedDuration = 0
  pauseStartedAt = 0
  recordingSummary.value = ''
  summaryProgress.value = { status: 'idle', progress: 0 }
}

function openRecordings() {
  browser.tabs.create({ url: browser.runtime.getURL('/recordings.html' as any) })
}

onMounted(() => {
  getTabInfo()
  checkMicPermission()
})

onUnmounted(() => {
  logDebug('recording', 'sidepanel unmounted; cleaning up active resources')
  stopDurationTimer()
  stopSpeechRecognition('sidepanel unmounted', true)
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
    mediaRecorder.stream.getTracks().forEach(track => track.stop())
  }
  stopActiveSourceStreams('sidepanel unmounted')
  closeMixedAudioContext('sidepanel unmounted')
  if (writableStream) {
    void writableStream.close()
  }
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
})
</script>

<template>
  <div class="flex flex-col h-screen p-4 bg-base-200">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold">
        SafeCap
      </h1>
      <div v-if="state === 'recording' || state === 'paused'" class="flex items-center gap-2">
        <span class="w-2 h-2 bg-error rounded-full animate-pulse" />
        <span class="badge badge-error badge-sm">
          {{ state === 'paused' ? 'Paused' : 'Recording' }}
        </span>
      </div>
    </div>

    <div v-if="state === 'idle' && !showPreview" class="flex flex-col items-center justify-center flex-1 gap-6">
      <div class="text-center">
        <p class="text-base-content/70 mb-4">
          Choose recording mode and click start
        </p>
      </div>

      <div class="join">
        <button
          class="join-item btn btn-sm"
          :class="mode === 'audio' ? 'btn-primary' : 'btn-ghost'"
          @click="mode = 'audio'"
        >
          <Icon icon="lucide:mic" class="w-4 h-4" />
          Audio
        </button>
        <button
          class="join-item btn btn-sm"
          :class="mode === 'video' ? 'btn-primary' : 'btn-ghost'"
          @click="mode = 'video'"
        >
          <Icon icon="lucide:monitor" class="w-4 h-4" />
          Video
        </button>
        <button
          class="join-item btn btn-sm"
          :class="mode === 'both' ? 'btn-primary' : 'btn-ghost'"
          @click="mode = 'both'"
        >
          <Icon icon="lucide:video" class="w-4 h-4" />
          Both
        </button>
      </div>

      <div v-if="mode !== 'video'" class="w-full max-w-xs text-center space-y-2">
        <button
          class="btn btn-outline btn-wide"
          :class="{
            'btn-success': micEnabled,
            'btn-error': !micEnabled && micPermissionState === 'denied',
          }"
          :disabled="isRequestingMic"
          @click="toggleMicrophone"
        >
          <span v-if="isRequestingMic" class="loading loading-spinner loading-sm" />
          <Icon v-else :icon="micEnabled ? 'lucide:mic' : 'lucide:mic-off'" class="w-4 h-4" />
          {{ isRequestingMic ? 'Requesting Mic...' : micEnabled ? 'Mic On' : 'Enable Mic' }}
        </button>
        <p class="text-xs text-base-content/60 leading-relaxed">
          {{ micStatusText }}
        </p>
      </div>

      <button
        class="btn btn-primary btn-wide"
        @click="startRecording"
      >
        <Icon icon="lucide:circle" class="w-5 h-5" />
        Start Recording
      </button>

      <button
        class="btn btn-ghost btn-sm"
        @click="openRecordings"
      >
        <Icon icon="lucide:folder-open" class="w-4 h-4" />
        View All Recordings
      </button>
    </div>

    <div v-else-if="state === 'processing'" class="flex flex-col items-center justify-center flex-1 gap-4">
      <span class="loading loading-spinner loading-lg" />
      <p class="text-sm text-base-content/70">
        {{ statusText || 'Processing recording...' }}
      </p>
    </div>

    <div v-else-if="state === 'recording' || state === 'paused'" class="flex flex-col items-center justify-center flex-1 gap-6">
      <div class="text-center">
        <p class="text-4xl font-mono">
          {{ formatDuration(duration) }}
        </p>
        <p class="text-base-content/50 mt-1">
          {{ mode === 'audio' ? 'Audio Recording' : mode === 'video' ? 'Video Recording' : 'Screen + Mic' }}
        </p>
      </div>

      <div class="flex gap-2">
        <button
          v-if="state === 'recording'"
          class="btn btn-warning btn-sm"
          @click="pauseRecording"
        >
          <Icon icon="lucide:pause" class="w-4 h-4" />
          Pause
        </button>
        <button
          v-else
          class="btn btn-success btn-sm"
          @click="resumeRecording"
        >
          <Icon icon="lucide:play" class="w-4 h-4" />
          Resume
        </button>
        <button
          class="btn btn-error btn-sm"
          @click="stopRecording"
        >
          <Icon icon="lucide:square" class="w-4 h-4" />
          Stop
        </button>
      </div>

      <div v-if="statusText" class="text-sm text-base-content/60">
        {{ statusText }}
      </div>

      <div v-if="mode !== 'video' && (segments.length > 0 || interimTranscript)" class="w-full max-w-md">
        <div class="divider my-2">
          Live Transcript
        </div>
        <div class="bg-base-300 rounded-lg p-3 max-h-40 overflow-y-auto text-sm">
          <div class="space-y-1">
            <div
              v-for="(segment, index) in segments"
              :key="index"
            >
              <span class="text-base-content/40">[{{ formatDuration(segment.start) }}]</span>
              <span class="ml-2">{{ segment.text }}</span>
            </div>
            <div v-if="interimTranscript" class="text-base-content/60 italic">
              <span class="text-base-content/40">[live]</span>
              <span class="ml-2">{{ interimTranscript }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="showPreview" class="flex flex-col flex-1 gap-4">
      <div class="flex-1 bg-base-300 rounded-lg overflow-hidden">
        <video
          v-if="previewUrl && mode !== 'audio'"
          controls
          :src="previewUrl"
          class="w-full h-full object-contain"
        />
        <audio
          v-else-if="previewUrl"
          controls
          :src="previewUrl"
          class="w-full"
        />
      </div>

      <div v-if="statusText" class="text-center text-sm">
        {{ statusText }}
      </div>

      <div class="flex gap-2 justify-center">
        <button
          class="btn btn-sm btn-ghost"
          @click="clearRecording"
        >
          <Icon icon="lucide:trash-2" class="w-4 h-4" />
          Clear
        </button>
        <button
          class="btn btn-sm btn-primary"
          @click="startRecording"
        >
          <Icon icon="lucide:circle" class="w-4 h-4" />
          New Recording
        </button>
      </div>

      <div v-if="recordingSummary || summaryProgress.status !== 'idle'" class="w-full">
        <div class="divider my-2">
          Summary
        </div>

        <div v-if="summaryProgress.status === 'downloading'" class="bg-base-300 rounded-lg p-4">
          <div class="flex items-center gap-3">
            <span class="loading loading-spinner loading-sm" />
            <span class="text-sm">Downloading AI model... {{ summaryProgress.progress }}%</span>
          </div>
          <progress
            class="progress progress-primary mt-2"
            :value="summaryProgress.progress"
            max="100"
          />
        </div>

        <div v-else-if="summaryProgress.status === 'checking' || summaryProgress.status === 'summarizing'" class="bg-base-300 rounded-lg p-4">
          <div class="flex items-center gap-3">
            <span class="loading loading-spinner loading-sm" />
            <span class="text-sm">
              {{ summaryProgress.status === 'checking' ? 'Checking AI...' : (summaryProgress.message || 'Generating summary...') }}
            </span>
          </div>
          <progress
            v-if="summaryProgress.status === 'summarizing' && summaryProgress.progress > 0"
            class="progress progress-primary mt-2"
            :value="summaryProgress.progress"
            max="100"
          />
        </div>

        <div v-else-if="summaryProgress.status === 'unavailable'" class="bg-base-300 rounded-lg p-4">
          <p class="text-sm text-warning">
            AI Summary unavailable on this device
          </p>
        </div>

        <div v-else-if="recordingSummary" class="bg-base-300 rounded-lg p-4">
          <div class="prose prose-sm max-w-none">
            {{ recordingSummary }}
          </div>
        </div>
      </div>

      <div v-if="segments.length > 0" class="w-full">
        <div class="divider my-2">
          Transcript
        </div>
        <div class="bg-base-300 rounded-lg p-3 max-h-48 overflow-y-auto text-sm">
          <div class="space-y-1">
            <div
              v-for="(segment, index) in segments"
              :key="index"
            >
              <span class="text-base-content/40">[{{ formatDuration(segment.start) }}]</span>
              <span class="ml-2">{{ segment.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
