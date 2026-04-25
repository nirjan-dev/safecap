<script lang="ts" setup>
import type { RecordingTranscript, TranscriptSegment } from '@/src/utils/transcriptStorage'
import { Icon } from '@iconify/vue'
import { checkAvailability, generateSummaryAndChapters } from '@/src/utils/aiTranscriber'
import { saveTranscript } from '@/src/utils/transcriptStorage'

type RecordingStatus = 'inactive' | 'recording' | 'paused' | 'processing'

const recordingState = ref<RecordingStatus>('inactive')
const duration = ref(0)
const segments = ref<TranscriptSegment[]>([])
const statusText = ref('')
const hasMic = ref(false)
const currentTabInfo = ref<{ title?: string, url?: string } | null>(null)

let mediaRecorder: MediaRecorder | null = null
let speechRecognition: any = null
let writableStream: FileSystemWritableFileStream | null = null
let rootDir: FileSystemDirectoryHandle | null = null
let recordingsDir: FileSystemDirectoryHandle | null = null
let recordingStartTime = 0
let pausedDuration = 0
let currentRecordingId = ''
let durationTimer: number | null = null

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
  // tabSource.connect(ctx.destination)
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

function initSpeechRecognition(_audioTrack: MediaStreamTrack) {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognition) {
    statusText.value = 'Speech recognition not supported in this browser'
    return
  }

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
    if (recordingState.value === 'recording') {
      speechRecognition?.start()
    }
  }
}

async function startRecording() {
  try {
    await getTabInfo()

    const tabStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
      },
      audio: {},
      systemAudio: 'include',
    } as any)

    tabStream.getVideoTracks()[0].onended = () => {
      stopRecording()
    }

    const micStream = await maybeGetMicStream()
    const mixedStream = mixAudio(tabStream, micStream)

    currentRecordingId = generateId()
    recordingStartTime = Date.now()
    pausedDuration = 0

    const dir = await getRecordingsDirectory()
    const fileName = `${currentRecordingId}.webm`
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    writableStream = await fileHandle.createWritable()

    mediaRecorder = new MediaRecorder(mixedStream, {
      mimeType: 'video/webm;codecs=vp9',
    })

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

      recordingState.value = 'processing'
      statusText.value = 'Processing...'

      await saveRecording()
    }

    const audioTrack = mixedStream.getAudioTracks()[0]
    if (audioTrack) {
      initSpeechRecognition(audioTrack)
      speechRecognition?.start(audioTrack)
    }

    mediaRecorder.start(1000)
    recordingState.value = 'recording'
    duration.value = 0
    startDurationTimer()

    await browser.runtime.sendMessage({
      type: 'STATE_UPDATE',
      state: { recordingState: 'recording', recordingId: currentRecordingId },
    })

    await browser.storage.local.set({
      recordingState: 'recording',
      recordingId: currentRecordingId,
    })
  }
  catch (error) {
    console.error('Failed to start recording:', error)
    statusText.value = `Failed to start: ${error}`
  }
}

function startDurationTimer() {
  durationTimer = window.setInterval(() => {
    if (recordingState.value === 'recording') {
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
  if (mediaRecorder && recordingState.value === 'recording') {
    mediaRecorder.pause()
    recordingState.value = 'paused'
    pausedDuration -= Date.now()
    speechRecognition?.stop()
    browser.runtime.sendMessage({
      type: 'STATE_UPDATE',
      state: { recordingState: 'paused', recordingId: currentRecordingId },
    })
    browser.storage.local.set({
      recordingState: 'paused',
      recordingId: currentRecordingId,
    })
  }
}

function resumeRecording() {
  if (mediaRecorder && recordingState.value === 'paused') {
    mediaRecorder.resume()
    recordingState.value = 'recording'
    pausedDuration += Date.now()
    speechRecognition?.start()
    browser.runtime.sendMessage({
      type: 'STATE_UPDATE',
      state: { recordingState: 'recording', recordingId: currentRecordingId },
    })
    browser.storage.local.set({
      recordingState: 'recording',
      recordingId: currentRecordingId,
    })
  }
}

async function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stream.getTracks().forEach(track => track.stop())
    mediaRecorder.stop()
    mediaRecorder = null
    speechRecognition?.stop()
    speechRecognition = null
  }
  recordingState.value = 'inactive'
  duration.value = 0
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

    statusText.value = 'Processing with AI...'

    const transcriptText = segments.value.map(s => s.text).join(' ')
    const { summary, chapters } = await generateSummaryAndChapters(transcriptText, recordingDuration)

    const fullTranscript: RecordingTranscript = {
      recordingId: currentRecordingId,
      generatedAt: Date.now(),
      segments: segments.value,
      summary,
      chapters,
    }

    await saveTranscript(currentRecordingId, fullTranscript)

    const hasAiContent = summary.length > 0 || chapters.length > 0

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
      type: 'SAVE_RECORDING_WITH_TRANSCRIPT',
      recording: metadata,
    })

    const aiStatus = await checkAvailability()
    if (!aiStatus.available) {
      statusText.value = hasAiContent ? 'Recording saved with transcript!' : 'Recording saved!'
    }
    else {
      statusText.value = 'Recording saved with summary and chapters!'
    }

    recordingState.value = 'inactive'

    await browser.runtime.sendMessage({
      type: 'STATE_UPDATE',
      state: { recordingState: 'inactive', recordingId: currentRecordingId },
    })

    await browser.storage.local.set({
      recordingState: 'inactive',
      recordingId: null,
    })
  }
  catch (error) {
    console.error('Failed to save recording:', error)
    statusText.value = `Failed to save: ${error}`
  }
}

onMounted(() => {
  getTabInfo()

  browser.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'STOP_RECORDING':
        stopRecording()
        break
      case 'PAUSE_RECORDING':
        pauseRecording()
        break
      case 'RESUME_RECORDING':
        resumeRecording()
        break
    }
  })

  window.addEventListener('beforeunload', (e) => {
    if (recordingState.value !== 'inactive') {
      e.preventDefault()
      e.returnValue = ''
    }
  })
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
})
</script>

<template>
  <div class="min-h-screen bg-base-200 p-8">
    <div class="max-w-4xl mx-auto">
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body">
          <div class="flex items-center justify-between mb-6">
            <h1 class="text-2xl font-bold">
              Recording
            </h1>
            <div v-if="recordingState !== 'inactive'" class="flex items-center gap-2">
              <span class="w-3 h-3 bg-error rounded-full animate-pulse" />
              <span class="badge badge-error">Recording</span>
            </div>
          </div>

          <div v-if="recordingState === 'inactive'" class="flex flex-col items-center gap-6 py-8">
            <div class="text-center">
              <p class="text-base-content/70 mb-4">
                Click the button below to start recording with live transcription.
              </p>
            </div>
            <button
              class="btn btn-primary btn-lg"
              @click="startRecording"
            >
              <Icon icon="lucide:video" class="w-5 h-5" />
              Start Recording
            </button>
          </div>

          <div v-else-if="recordingState === 'processing'" class="flex flex-col items-center gap-6 py-8">
            <div class="text-center">
              <span class="loading loading-spinner loading-lg" />
              <p class="mt-4 text-base-content/70">
                {{ statusText || 'Processing recording...' }}
              </p>
            </div>
          </div>

          <div v-else class="space-y-6">
            <div class="flex items-center justify-center gap-4">
              <div class="text-center">
                <p class="text-4xl font-mono">
                  {{ formatDuration(duration) }}
                </p>
                <p class="text-base-content/50 mt-1">
                  Duration
                </p>
              </div>
            </div>

            <div class="flex justify-center gap-3">
              <button
                v-if="recordingState === 'recording'"
                class="btn btn-warning"
                @click="pauseRecording"
              >
                <Icon icon="lucide:pause" class="w-5 h-5" />
                Pause
              </button>
              <button
                v-else-if="recordingState === 'paused'"
                class="btn btn-success"
                @click="resumeRecording"
              >
                <Icon icon="lucide:play" class="w-5 h-5" />
                Resume
              </button>
              <button
                class="btn btn-error"
                @click="stopRecording"
              >
                <Icon icon="lucide:square" class="w-5 h-5" />
                Stop
              </button>
            </div>

            <div v-if="statusText" class="text-center text-sm text-base-content/60">
              {{ statusText }}
            </div>

            <div class="divider">
              Live Transcript
            </div>

            <div class="bg-base-300 rounded-lg p-4 max-h-64 overflow-y-auto">
              <div v-if="segments.length === 0" class="text-center text-base-content/50 py-4">
                No speech detected yet...
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="(segment, index) in segments"
                  :key="index"
                  class="text-sm"
                >
                  <span class="text-base-content/40">[{{ formatDuration(segment.start) }}]</span>
                  <span class="ml-2">{{ segment.text }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
