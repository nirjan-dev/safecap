<script lang="ts" setup>
import type { Recording as StorageRecording } from '@/src/utils/storage'
import type { RecordingTranscript } from '@/src/utils/transcriptStorage'
import { Icon } from '@iconify/vue'
import { onMounted, ref, shallowRef } from 'vue'
import TranscriptPanel from '@/components/TranscriptPanel.vue'
import { checkAvailability, downloadAiModel } from '@/src/utils/aiTranscriber'
import { getRecordingWithBlob, recordingsStorage } from '@/src/utils/storage'
import { deleteTranscript as deleteTranscriptFile, getTranscript, hasTranscriptFile } from '@/src/utils/transcriptStorage'

type Recording = Omit<StorageRecording, 'blob'>
type RecordingWithBlob = Recording & { blob: Blob }

const recordings = shallowRef<Recording[]>([])
const selectedRecording = ref<RecordingWithBlob | null>(null)
const videoUrl = ref<string | null>(null)
const videoRef = ref<HTMLVideoElement | null>(null)
const dialogRef = ref<HTMLDialogElement | null>(null)
const loading = ref(true)
const loadingRecordingId = ref<string | null>(null)
const errorMessage = ref<string | null>(null)
const showTranscriptPanel = ref(false)
const transcript = ref<RecordingTranscript | null>(null)
const aiAvailable = ref(false)
const aiDownloadable = ref(false)
const aiDownloading = ref(false)
const aiDownloadProgress = ref(0)
const transcriptLoading = ref(false)

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (bytes === 0)
    return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0)
    return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0)
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return 'Just now'
}

async function loadRecordings() {
  loading.value = true
  const rawRecordings = await recordingsStorage.getValue()

  const loaded = await Promise.all(
    rawRecordings.map(async r => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      duration: r.duration,
      size: r.size,
      tabTitle: r.tabTitle,
      tabUrl: r.tabUrl,
      hasTranscript: r.hasTranscript === true || await hasTranscriptFile(r.id),
    })),
  )

  recordings.value = loaded.sort((a, b) => b.createdAt - a.createdAt)
  loading.value = false
}

async function openTranscriptPanel(recording: Recording) {
  if (transcriptLoading.value)
    return

  transcriptLoading.value = true
  try {
    const transcriptData = await getTranscript(recording.id)
    if (transcriptData) {
      transcript.value = transcriptData
      showTranscriptPanel.value = true
      await playRecording(recording, true)
    }
  }
  catch (err) {
    console.error('Failed to load transcript:', err)
  }
  finally {
    transcriptLoading.value = false
  }
}

function handleSeekTo(timestamp: number) {
  if (videoRef.value) {
    videoRef.value.currentTime = timestamp
  }
}

async function handleDeleteTranscript() {
  if (!selectedRecording.value)
    return

  const recordingId = selectedRecording.value.id

  await deleteTranscriptFile(recordingId)

  const current = await recordingsStorage.getValue()
  const updated = current.map(r =>
    r.id === recordingId ? { ...r, hasTranscript: false } : r,
  )
  await recordingsStorage.setValue(updated)

  transcript.value = null
  showTranscriptPanel.value = false

  await loadRecordings()
}

async function playRecording(recording: Recording, withTranscript = false) {
  if (loadingRecordingId.value && !withTranscript)
    return

  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
  }

  loadingRecordingId.value = recording.id
  errorMessage.value = null
  if (!withTranscript) {
    showTranscriptPanel.value = false
    transcript.value = null
  }

  try {
    const fullRecording = await getRecordingWithBlob(recording.id)

    if (!fullRecording) {
      errorMessage.value = 'Recording not found'
      return
    }

    videoUrl.value = URL.createObjectURL(fullRecording.blob)
    selectedRecording.value = { ...recording, blob: fullRecording.blob }

    if (recording.hasTranscript) {
      const transcriptData = await getTranscript(recording.id)
      if (transcriptData) {
        transcript.value = transcriptData
      }
    }

    setTimeout(() => {
      dialogRef.value?.showModal()
    }, 0)
  }
  catch (err) {
    errorMessage.value = `Failed to load recording: ${err}`
    console.error('Failed to load recording:', err)
  }
  finally {
    loadingRecordingId.value = null
  }
}

function closePlayer() {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
    videoUrl.value = null
  }
  selectedRecording.value = null
  showTranscriptPanel.value = false
  transcript.value = null
  dialogRef.value?.close()
}

async function downloadRecording(recording: Recording) {
  const fullRecording = await getRecordingWithBlob(recording.id)
  if (!fullRecording) {
    errorMessage.value = 'Recording not found'
    return
  }
  const url = URL.createObjectURL(fullRecording.blob)
  const filename = `${recording.name.replace(/[^a-z0-9]/gi, '_')}.webm`

  await browser.downloads.download({
    url,
    filename,
    saveAs: true,
  })

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function deleteRecording(id: string) {
  const current = await recordingsStorage.getValue()
  await recordingsStorage.setValue(current.filter(r => r.id !== id))
  await loadRecordings()

  if (selectedRecording.value?.id === id) {
    closePlayer()
  }
}

async function handleDownloadAiModel() {
  aiDownloading.value = true
  aiDownloadProgress.value = 0

  try {
    const interval = setInterval(() => {
      if (aiDownloadProgress.value < 90) {
        aiDownloadProgress.value += 10
      }
    }, 500)

    const success = await downloadAiModel()

    clearInterval(interval)
    aiDownloadProgress.value = 100

    if (success) {
      aiAvailable.value = true
      aiDownloadable.value = false
    }
  }
  catch (err) {
    console.error('Failed to download AI model:', err)
  }
  finally {
    aiDownloading.value = false
    aiDownloadProgress.value = 0
  }
}

onMounted(async () => {
  await loadRecordings()

  const availability = await checkAvailability()
  aiAvailable.value = availability.available
  aiDownloadable.value = availability.downloadable ?? false

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.recordings) {
      loadRecordings()
    }
  })
})
</script>

<template>
  <div class="min-h-screen bg-base-200 p-6">
    <div class="max-w-5xl mx-auto">
      <div v-if="aiDownloadable" class="alert mb-4 bg-gradient-to-r from-primary/20 to-secondary/20 border border-primary/30">
        <Icon icon="lucide:sparkles" class="w-5 h-5 text-primary" />
        <div class="flex-1">
          <span class="font-medium">AI features require a one-time 22GB model download.</span>
        </div>
        <button
          class="btn btn-primary btn-sm"
          :disabled="aiDownloading"
          @click="handleDownloadAiModel"
        >
          <span v-if="aiDownloading" class="loading loading-spinner loading-xs" />
          {{ aiDownloading ? `Downloading ${aiDownloadProgress}%...` : 'Enable AI Features' }}
        </button>
      </div>

      <div v-else-if="aiAvailable" class="alert mb-4 bg-success/20 border border-success/30">
        <Icon icon="lucide:sparkles" class="w-5 h-5 text-success" />
        <span>AI features are enabled on this device.</span>
      </div>

      <div class="flex items-center justify-between mb-8">
        <h1 class="text-3xl font-bold">
          My Recordings
        </h1>
        <div v-if="loading" class="badge badge-lg badge-neutral">
          <span class="loading loading-spinner loading-xs mr-1" />
          Loading...
        </div>
        <div v-else class="badge badge-lg badge-neutral">
          {{ recordings.length }} recording{{ recordings.length !== 1 ? 's' : '' }}
        </div>
      </div>

      <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div v-for="i in 4" :key="i" class="card bg-base-100 shadow-sm">
          <div class="card-body p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="skeleton h-5 w-3/4 mb-2" />
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                  <div class="skeleton h-4 w-16" />
                  <div class="skeleton h-4 w-16" />
                  <div class="skeleton h-4 w-20" />
                </div>
                <div class="skeleton h-3 w-1/2 mt-2" />
              </div>
              <div class="flex flex-col gap-2">
                <div class="skeleton h-8 w-16" />
                <div class="flex gap-1">
                  <div class="skeleton h-8 w-8" />
                  <div class="skeleton h-8 w-8" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="recordings.length === 0" class="text-center py-20">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-base-300 mb-4">
          <Icon icon="lucide:video" class="w-10 h-10 text-base-content/40" />
        </div>
        <p class="text-lg text-base-content/70">
          No recordings yet
        </p>
        <p class="text-sm text-base-content/50 mt-2 max-w-sm mx-auto">
          Click "Record Demo" in the extension popup to create your first recording.
        </p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          v-for="recording in recordings"
          :key="recording.id"
          class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow"
        >
          <div class="card-body p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <h2 class="card-title text-base truncate" :title="recording.name">
                  {{ recording.name }}
                </h2>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm text-base-content/60">
                  <span class="flex items-center gap-1">
                    <Icon icon="lucide:clock" class="w-4 h-4" />
                    {{ formatDuration(recording.duration) }}
                  </span>
                  <span class="flex items-center gap-1">
                    <Icon icon="lucide:hard-drive" class="w-4 h-4" />
                    {{ formatFileSize(recording.size) }}
                  </span>
                  <span class="flex items-center gap-1">
                    <Icon icon="lucide:history" class="w-4 h-4" />
                    {{ formatRelativeTime(recording.createdAt) }}
                  </span>
                </div>
                <div v-if="recording.tabUrl" class="mt-2 text-xs text-base-content/40 truncate max-w-full" :title="recording.tabUrl">
                  {{ recording.tabUrl }}
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <button
                  class="btn btn-primary btn-sm"
                  :disabled="loadingRecordingId !== null"
                  @click="playRecording(recording)"
                >
                  <span v-if="loadingRecordingId === recording.id" class="loading loading-spinner loading-xs" />
                  <Icon v-else icon="lucide:play" class="w-4 h-4" />
                  <span v-if="loadingRecordingId === recording.id">Loading...</span>
                  <span v-else>Play</span>
                </button>
                <div class="flex gap-1">
                  <button
                    class="btn btn-secondary btn-sm flex-1"
                    title="Download"
                    @click="downloadRecording(recording)"
                  >
                    <Icon icon="lucide:download" class="w-4 h-4" />
                  </button>
                  <button
                    class="btn btn-ghost btn-sm flex-1"
                    :class="recording.hasTranscript ? 'text-primary' : 'text-base-content/30'"
                    :title="recording.hasTranscript ? 'View Transcript' : 'No Transcript'"
                    :disabled="!recording.hasTranscript"
                    @click="openTranscriptPanel(recording)"
                  >
                    <Icon :icon="recording.hasTranscript ? 'lucide:file-text' : 'lucide:wand-sparkles'" class="w-4 h-4" />
                  </button>
                  <button
                    class="btn btn-error btn-sm flex-1 btn-outline"
                    title="Delete"
                    @click="deleteRecording(recording.id)"
                  >
                    <Icon icon="lucide:trash-2" class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <dialog ref="dialogRef" class="modal" @close="closePlayer">
      <div
        v-if="selectedRecording && videoUrl"
        class="modal-box w-11/12 flex flex-col max-h-[90vh]"
        :class="showTranscriptPanel ? 'max-w-7xl' : 'max-w-5xl'"
      >
        <div class="flex justify-between items-center pb-3 border-b border-base-300">
          <div class="min-w-0 pr-4">
            <h2 class="text-lg font-semibold truncate">
              {{ selectedRecording.name }}
            </h2>
            <p class="text-sm text-base-content/60">
              {{ formatDuration(selectedRecording.duration) }} • {{ formatFileSize(selectedRecording.size) }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="transcript && !showTranscriptPanel"
              class="btn btn-sm btn-ghost"
              @click="showTranscriptPanel = true"
            >
              <Icon icon="lucide:file-text" class="w-4 h-4" />
              Show Transcript
            </button>
            <form method="dialog">
              <button class="btn btn-sm btn-circle btn-ghost flex-shrink-0">
                <Icon icon="lucide:x" class="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>
        <div class="flex-1 overflow-hidden mt-3" :class="showTranscriptPanel ? 'flex flex-col lg:flex-row gap-4' : ''">
          <div :class="showTranscriptPanel ? 'w-full lg:flex-1 lg:min-w-0' : 'w-full'">
            <video
              ref="videoRef"
              :src="videoUrl"
              controls
              class="w-full h-full max-h-[70vh] rounded-lg object-contain bg-black"
              autoplay
            />
          </div>
          <div
            v-if="showTranscriptPanel && transcript"
            class="w-full lg:w-80 lg:flex-shrink-0 bg-base-300 rounded-lg p-3 overflow-hidden flex flex-col max-h-[50vh] lg:max-h-[70vh]"
          >
            <TranscriptPanel
              :transcript="transcript"
              :video-ref="videoRef ?? undefined"
              @seek-to="handleSeekTo"
              @delete-transcript="handleDeleteTranscript"
            />
          </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
