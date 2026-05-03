<script lang="ts" setup>
import type { SummaryProgress } from '@/src/utils/aiTranscriber'
import type { RecordingTranscript, TranscriptSegment } from '@/src/utils/transcriptStorage'
import { Icon } from '@iconify/vue'
import { generateRecordingSummary } from '@/src/utils/aiTranscriber'
import { getTranscript, saveTranscript } from '@/src/utils/transcriptStorage'

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

type RecordingMode = 'audio' | 'video' | 'both'
type RecordingState = 'idle' | 'recording' | 'paused' | 'processing'

const mode = ref<RecordingMode>('both')
const state = ref<RecordingState>('idle')
const duration = ref(0)
const segments = ref<TranscriptSegment[]>([])
const statusText = ref('')
const hasMic = ref(false)
const currentTabInfo = ref<{ title?: string, url?: string } | null>(null)
const showPreview = ref(false)
const previewUrl = ref<string | null>(null)
const summaryProgress = ref<SummaryProgress>({ status: 'idle', progress: 0 })
const recordingSummary = ref('')

let mediaRecorder: MediaRecorder | null = null
let speechRecognition: any = null
let currentAudioTrack: MediaStreamTrack | null = null
let writableStream: FileSystemWritableFileStream | null = null
let rootDir: FileSystemDirectoryHandle | null = null
let recordingsDir: FileSystemDirectoryHandle | null = null
let recordingStartTime = 0
let pausedDuration = 0
let currentRecordingId = ''
let durationTimer: number | null = null
let currentBlob: Blob | null = null

function generateId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function generateRecordingName(tabTitle?: string): string {
  if (tabTitle) {
    return tabTitle
  }
  return `Recording ${new Date(recordingStartTime).toLocaleString()}`
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
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
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.title && tab?.url) {
    currentTabInfo.value = { title: tab.title, url: tab.url }
  }
}

async function maybeGetMicStream(): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    hasMic.value = true
    return stream
  }
  catch (e) {
    console.log('Mic getUserMedia failed:', e)
    return null
  }
}

function mixAudio(tabStream: MediaStream, micStream: MediaStream | null): MediaStream {
  const tabAudio = tabStream.getAudioTracks()[0]
  if (!micStream || !tabAudio) {
    return tabStream
  }

  const ctx = new AudioContext()
  const dst = ctx.createMediaStreamDestination()

  const tabSource = ctx.createMediaStreamSource(new MediaStream([tabAudio]))
  tabSource.connect(dst)

  const micTrack = micStream.getAudioTracks()[0]
  if (micTrack) {
    ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dst)
  }

  return new MediaStream([
    ...tabStream.getVideoTracks(),
    ...dst.stream.getAudioTracks(),
  ])
}

function getMixedAudioTrack(stream: MediaStream): MediaStreamTrack | null {
  return stream.getAudioTracks()[0] ?? null
}

function initSpeechRecognition(audioTrack: MediaStreamTrack | null) {
  if (!SpeechRecognition) {
    statusText.value = 'Speech recognition not supported'
    return
  }

  currentAudioTrack = audioTrack
  speechRecognition = new SpeechRecognition()
  speechRecognition.continuous = true
  speechRecognition.interimResults = true

  speechRecognition.onresult = (event: any) => {
    const result = event.results[event.results.length - 1]
    const text = result[0].transcript.trim()

    if (result.isFinal) {
      const endTime = (Date.now() - recordingStartTime - pausedDuration) / 1000
      const existingSegment = segments.value[segments.value.length - 1]

      if (existingSegment && existingSegment.end === 0) {
        existingSegment.text += ` ${text}`
        existingSegment.end = endTime
      }
      else {
        segments.value.push({
          text,
          start: existingSegment ? existingSegment.end : 0,
          end: endTime,
        })
      }
    }
  }

  speechRecognition.onerror = (event: any) => {
    console.error('Speech recognition error:', event.error)
    switch (event.error) {
      case 'no-speech':
        statusText.value = 'No speech detected'
        break
      case 'audio-capture':
        statusText.value = 'No audio capture device'
        break
      case 'not-allowed':
        statusText.value = 'Microphone permission denied'
        break
      case 'network':
        statusText.value = 'Network error in speech recognition'
        break
      default:
        statusText.value = `Speech error: ${event.error}`
    }
  }

  speechRecognition.onend = () => {
    if (state.value === 'recording') {
      speechRecognition?.start(currentAudioTrack ?? undefined)
    }
  }

  speechRecognition.start(audioTrack ?? undefined)
}

async function startRecording() {
  try {
    await getTabInfo()

    let stream: MediaStream
    let mimeType: string

    if (mode.value === 'both') {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
        },
        audio: {},
        systemAudio: 'include',
      } as any)

      stream.getVideoTracks()[0].onended = () => {
        stopRecording()
      }

      const micStream = await maybeGetMicStream()
      if (micStream) {
        stream = mixAudio(stream, micStream)
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

      stream.getVideoTracks()[0].onended = () => {
        stopRecording()
      }

      mimeType = 'video/webm;codecs=vp9'
    }
    else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      mimeType = 'audio/webm;codecs=opus'
    }

    currentRecordingId = generateId()
    recordingStartTime = Date.now()
    pausedDuration = 0

    const dir = await getRecordingsDirectory()
    const fileName = `${currentRecordingId}.webm`
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    writableStream = await fileHandle.createWritable()

    mediaRecorder = new MediaRecorder(stream, { mimeType })

    mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size > 0 && writableStream) {
        await writableStream.write(e.data)
      }
    }

    mediaRecorder.onstop = async () => {
      if (writableStream) {
        await writableStream.close()
        writableStream = null
      }

      state.value = 'processing'
      statusText.value = 'Processing...'

      await saveRecording()
    }

    if (mode.value !== 'video') {
      initSpeechRecognition(getMixedAudioTrack(stream))
    }

    mediaRecorder.start(1000)
    state.value = 'recording'
    duration.value = 0
    startDurationTimer()
  }
  catch (error) {
    console.error('Failed to start recording:', error)
    statusText.value = `Failed to start: ${error}`
  }
}

function startDurationTimer() {
  durationTimer = window.setInterval(() => {
    if (state.value === 'recording') {
      duration.value = Math.floor((Date.now() - recordingStartTime - pausedDuration) / 1000)
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
    mediaRecorder.pause()
    state.value = 'paused'
    pausedDuration -= Date.now()
    speechRecognition?.stop()
  }
}

function resumeRecording() {
  if (mediaRecorder && state.value === 'paused') {
    mediaRecorder.resume()
    state.value = 'recording'
    pausedDuration += Date.now()
    speechRecognition?.start(currentAudioTrack ?? undefined)
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stream.getTracks().forEach(track => track.stop())
    mediaRecorder.stop()
    mediaRecorder = null
    speechRecognition?.stop()
    speechRecognition = null
    currentAudioTrack = null
  }
  state.value = 'processing'
  statusText.value = 'Processing...'
  stopDurationTimer()
}

async function saveRecording() {
  const name = generateRecordingName(currentTabInfo.value?.title)
  const recordingDuration = (Date.now() - recordingStartTime - pausedDuration) / 1000

  try {
    const dir = await getRecordingsDirectory()
    const fileHandle = await dir.getFileHandle(`${currentRecordingId}.webm`)
    const file = await fileHandle.getFile()
    const size = file.size
    currentBlob = file

    statusText.value = 'Processing...'

    const transcriptText = segments.value.map(s => s.text).join(' ')

    const fullTranscript: RecordingTranscript = {
      recordingId: currentRecordingId,
      generatedAt: Date.now(),
      segments: segments.value,
      summary: '',
      chapters: [],
    }

    await saveTranscript(currentRecordingId, fullTranscript)

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

    statusText.value = hasAiContent ? 'Recording saved!' : 'Recording saved!'
    previewUrl.value = URL.createObjectURL(currentBlob)
    showPreview.value = true
    state.value = 'idle'

    if (transcriptText.trim()) {
      generateSummaryInBackground(transcriptText, currentRecordingId)
    }
  }
  catch (error) {
    console.error('Failed to save recording:', error)
    statusText.value = `Failed to save: ${error}`
    state.value = 'idle'
  }
}

async function generateSummaryInBackground(transcriptText: string, recordingId: string) {
  summaryProgress.value = { status: 'checking', progress: 0 }

  try {
    if (!('Summarizer' in globalThis)) {
      summaryProgress.value = { status: 'unavailable', progress: 0, error: 'Summarizer API not available' }

      return
    }

    const availability = await (globalThis as any).Summarizer.availability()
    if (availability === 'unavailable') {
      summaryProgress.value = { status: 'unavailable', progress: 0, error: 'Summarizer not available on this device' }

      return
    }

    const { summary } = await generateRecordingSummary(transcriptText, (p) => {
      summaryProgress.value = p
      if (p.status === 'downloading') {
        statusText.value = `Downloading AI model... ${p.progress}%`
      }
      else if (p.status === 'summarizing') {
        statusText.value = 'Generating summary...'
      }
      else if (p.status === 'unavailable') {
        statusText.value = 'AI Summary unavailable'
      }
      else if (p.status === 'ready') {
        statusText.value = 'Recording saved with summary!'
      }
    })

    recordingSummary.value = summary

    const existingTranscript = await getTranscript(recordingId)
    if (existingTranscript) {
      existingTranscript.summary = summary
      await saveTranscript(recordingId, existingTranscript)
    }
  }
  catch (e) {
    console.error('Failed to generate summary:', e)
    summaryProgress.value = { status: 'unavailable', progress: 0, error: String(e) }
  }
}

function clearRecording() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
  showPreview.value = false
  segments.value = []
  duration.value = 0
  statusText.value = ''
  currentBlob = null
  currentRecordingId = ''
  recordingSummary.value = ''
  summaryProgress.value = { status: 'idle', progress: 0 }
}

function openRecordings() {
  browser.tabs.create({ url: browser.runtime.getURL('/recordings.html' as any) })
}

onMounted(() => {
  getTabInfo()
})

onUnmounted(() => {
  stopDurationTimer()
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
    mediaRecorder.stream.getTracks().forEach(track => track.stop())
  }
  if (writableStream) {
    writableStream.close()
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

      <div v-if="mode !== 'video' && segments.length > 0" class="w-full max-w-md">
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
