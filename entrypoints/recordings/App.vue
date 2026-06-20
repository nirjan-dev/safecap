<script lang="ts" setup>
import type { Recording as StorageRecording } from '@/src/utils/storage'
import type { RecordingTranscript } from '@/src/utils/transcriptStorage'
import { Icon } from '@iconify/vue'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import TranscriptPanel from '@/components/TranscriptPanel.vue'
import { checkAvailability, downloadAiModel } from '@/src/utils/aiTranscriber'
import { deleteRecording as deleteRecordingFromStorage, getRecordingWithBlob, recordingsStorage } from '@/src/utils/storage'
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
const searchQuery = ref('')
const currentPage = ref(1)
const deletingRecording = ref<Recording | null>(null)
const deletingRecordingId = ref<string | null>(null)
const playbackSpeed = ref(1)
const currentTime = ref(0)

const pageSize = 12
const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]

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

function normalizeSearchText(value?: string): string {
  return (value || '').toLowerCase().trim()
}

const filteredRecordings = computed(() => {
  const query = normalizeSearchText(searchQuery.value)
  if (!query) {
    return recordings.value
  }

  return recordings.value.filter((recording) => {
    const searchableText = [
      recording.name,
      recording.tabTitle,
      recording.tabUrl,
      new Date(recording.createdAt).toLocaleString(),
    ].map(normalizeSearchText).join(' ')

    return searchableText.includes(query)
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRecordings.value.length / pageSize)))
const pageStart = computed(() => (currentPage.value - 1) * pageSize)
const paginatedRecordings = computed(() => filteredRecordings.value.slice(pageStart.value, pageStart.value + pageSize))
const playerChapters = computed(() => transcript.value?.chapters ?? [])
const activeChapter = computed(() => {
  let current: RecordingTranscript['chapters'][number] | null = null

  for (const chapter of playerChapters.value) {
    if (currentTime.value >= chapter.start) {
      current = chapter
    }
  }

  return current
})

watch(searchQuery, () => {
  currentPage.value = 1
})

watch(totalPages, (pages) => {
  if (currentPage.value > pages) {
    currentPage.value = pages
  }
})

function clearSearch() {
  searchQuery.value = ''
}

function goToPage(page: number) {
  currentPage.value = Math.min(Math.max(page, 1), totalPages.value)
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
    currentTime.value = timestamp
  }
}

function seekBy(seconds: number) {
  if (!videoRef.value) {
    return
  }

  const duration = Number.isFinite(videoRef.value.duration)
    ? videoRef.value.duration
    : selectedRecording.value?.duration ?? 0
  const nextTime = Math.min(Math.max(videoRef.value.currentTime + seconds, 0), duration)
  handleSeekTo(nextTime)
}

function setPlaybackSpeed(speed: number) {
  playbackSpeed.value = speed
  if (videoRef.value) {
    videoRef.value.playbackRate = speed
  }
}

function handleVideoReady() {
  if (!videoRef.value) {
    return
  }

  videoRef.value.playbackRate = playbackSpeed.value
  currentTime.value = videoRef.value.currentTime
}

function handleTimeUpdate() {
  currentTime.value = videoRef.value?.currentTime ?? 0
}

function handleRateChange() {
  playbackSpeed.value = videoRef.value?.playbackRate ?? playbackSpeed.value
}

function handlePlaybackSpeedChange(event: Event) {
  const target = event.target as HTMLSelectElement
  setPlaybackSpeed(Number(target.value))
}

function jumpToChapter(chapter: RecordingTranscript['chapters'][number]) {
  handleSeekTo(chapter.start)
  void videoRef.value?.play()
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
    currentTime.value = 0

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
  videoRef.value?.pause()

  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
    videoUrl.value = null
  }
  selectedRecording.value = null
  showTranscriptPanel.value = false
  transcript.value = null
  currentTime.value = 0
  if (dialogRef.value?.open) {
    dialogRef.value.close()
  }
}

function getSafeDownloadFilename(recording: Recording): string {
  const baseName = recording.name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[^\w .-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '_')

  return `${baseName || recording.id}.webm`
}

async function downloadRecording(recording: Recording) {
  const fullRecording = await getRecordingWithBlob(recording.id)
  if (!fullRecording) {
    errorMessage.value = 'Recording not found'
    return
  }
  const url = URL.createObjectURL(fullRecording.blob)
  const filename = getSafeDownloadFilename(recording)

  await browser.downloads.download({
    url,
    filename,
    saveAs: true,
  })

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function requestDeleteRecording(recording: Recording) {
  deletingRecording.value = recording
}

function cancelDeleteRecording() {
  if (deletingRecordingId.value) {
    return
  }

  deletingRecording.value = null
}

async function confirmDeleteRecording() {
  const recording = deletingRecording.value
  if (!recording || deletingRecordingId.value) {
    return
  }

  deletingRecordingId.value = recording.id
  errorMessage.value = null

  try {
    await deleteRecordingFromStorage(recording.id)
    await loadRecordings()

    if (selectedRecording.value?.id === recording.id) {
      closePlayer()
    }
  }
  catch (err) {
    errorMessage.value = `Failed to delete recording: ${err}`
    console.error('Failed to delete recording:', err)
  }
  finally {
    deletingRecordingId.value = null
    deletingRecording.value = null
  }
}

function handleDeleteDialogClose() {
  if (!deletingRecordingId.value) {
    deletingRecording.value = null
  }
}

function handleStorageChange(changes: any, area: string) {
  if (area === 'local' && changes.recordings) {
    loadRecordings()
  }
}

onBeforeUnmount(() => {
  browser.storage.onChanged.removeListener(handleStorageChange)

  if (selectedRecording.value) {
    closePlayer()
  }
})

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

  browser.storage.onChanged.addListener(handleStorageChange)
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
          Saved Recordings
        </h1>
        <div v-if="loading" class="badge badge-lg badge-neutral">
          <span class="loading loading-spinner loading-xs mr-1" />
          Loading...
        </div>
        <div v-else class="badge badge-lg badge-neutral">
          {{ recordings.length }} recording{{ recordings.length !== 1 ? 's' : '' }}
        </div>
      </div>

      <div v-if="errorMessage" class="alert alert-error mb-4">
        <Icon icon="lucide:triangle-alert" class="w-5 h-5" />
        <span>{{ errorMessage }}</span>
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

      <div v-else>
        <div class="card bg-base-100 shadow-sm mb-4">
          <div class="card-body p-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <label class="input input-bordered flex items-center gap-2 md:max-w-md">
                <Icon icon="lucide:search" class="w-4 h-4 text-base-content/50" />
                <input
                  v-model="searchQuery"
                  type="search"
                  class="grow"
                  placeholder="Search recordings, tabs, or URLs"
                >
                <button
                  v-if="searchQuery"
                  class="btn btn-ghost btn-xs btn-circle"
                  title="Clear search"
                  @click="clearSearch"
                >
                  <Icon icon="lucide:x" class="w-3 h-3" />
                </button>
              </label>
              <div class="text-sm text-base-content/60">
                Showing {{ filteredRecordings.length === 0 ? 0 : pageStart + 1 }}-{{ Math.min(pageStart + paginatedRecordings.length, filteredRecordings.length) }} of {{ filteredRecordings.length }}
              </div>
            </div>
          </div>
        </div>

        <div v-if="filteredRecordings.length === 0" class="text-center py-16 bg-base-100 rounded-box">
          <Icon icon="lucide:search-x" class="w-12 h-12 mx-auto text-base-content/30" />
          <p class="text-lg text-base-content/70 mt-4">
            No matching recordings
          </p>
          <p class="text-sm text-base-content/50 mt-2">
            Try a different tab name, URL, or date.
          </p>
          <button class="btn btn-sm btn-ghost mt-4" @click="clearSearch">
            Clear search
          </button>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-screen">
          <div
            v-for="recording in paginatedRecordings"
            :key="recording.id"
            class="card h-fit bg-base-100 shadow-sm hover:shadow-md transition-shadow"
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
                  <a
                    v-if="recording.tabUrl"
                    :href="recording.tabUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="mt-2 flex items-center gap-1 text-xs text-primary/80 hover:text-primary min-w-0"
                    :title="recording.tabUrl"
                  >
                    <Icon icon="lucide:external-link" class="w-3 h-3 flex-shrink-0" />
                    <span class="truncate">{{ recording.tabUrl }}</span>
                  </a>
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
                      :disabled="deletingRecordingId === recording.id"
                      @click="requestDeleteRecording(recording)"
                    >
                      <span v-if="deletingRecordingId === recording.id" class="loading loading-spinner loading-xs" />
                      <Icon v-else icon="lucide:trash-2" class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 mt-6">
          <button class="btn btn-sm" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">
            <Icon icon="lucide:chevron-left" class="w-4 h-4" />
            Previous
          </button>
          <div class="join">
            <button
              v-for="page in totalPages"
              :key="page"
              class="join-item btn btn-sm"
              :class="currentPage === page ? 'btn-primary' : 'btn-ghost'"
              @click="goToPage(page)"
            >
              {{ page }}
            </button>
          </div>
          <button class="btn btn-sm" :disabled="currentPage === totalPages" @click="goToPage(currentPage + 1)">
            Next
            <Icon icon="lucide:chevron-right" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <dialog ref="dialogRef" class="modal" @close="closePlayer">
      <div
        v-if="selectedRecording && videoUrl"
        class="modal-box w-11/12 flex flex-col max-h-[92dvh] overflow-hidden p-4 sm:p-6"
        :class="showTranscriptPanel ? 'max-w-7xl' : 'max-w-5xl'"
      >
        <div class="flex justify-between items-center pb-3 border-b border-base-300 flex-shrink-0">
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
        <div class="flex-1 min-h-0 overflow-y-auto mt-3 pr-1" :class="showTranscriptPanel ? 'flex flex-col lg:flex-row gap-4' : ''">
          <div :class="showTranscriptPanel ? 'w-full lg:flex-1 lg:min-w-0 flex flex-col min-h-0' : 'w-full flex flex-col min-h-0'">
            <video
              ref="videoRef"
              :src="videoUrl"
              controls
              class="w-full max-h-[44dvh] sm:max-h-[54dvh] lg:max-h-[60dvh] rounded-lg object-contain bg-black flex-shrink min-h-0"
              autoplay
              @loadedmetadata="handleVideoReady"
              @timeupdate="handleTimeUpdate"
              @ratechange="handleRateChange"
            />

            <div class="mt-3 rounded-box bg-base-300 p-3 space-y-3 flex-shrink-0">
              <div class="flex flex-wrap items-center gap-2">
                <button class="btn btn-sm" @click="seekBy(-10)">
                  <Icon icon="lucide:rotate-ccw" class="w-4 h-4" />
                  10s
                </button>
                <button class="btn btn-sm" @click="seekBy(30)">
                  30s
                  <Icon icon="lucide:rotate-cw" class="w-4 h-4" />
                </button>
                <div class="divider divider-horizontal mx-1" />
                <label class="flex items-center gap-2 text-sm text-base-content/70">
                  <Icon icon="lucide:gauge" class="w-4 h-4" />
                  Speed
                  <select class="select select-sm select-bordered" :value="playbackSpeed" @change="handlePlaybackSpeedChange">
                    <option v-for="speed in playbackSpeeds" :key="speed" :value="speed">
                      {{ speed }}x
                    </option>
                  </select>
                </label>
                <div v-if="activeChapter" class="badge badge-primary badge-outline ml-auto max-w-full truncate">
                  <Icon icon="lucide:list-ordered" class="w-3 h-3" />
                  {{ activeChapter.title }}
                </div>
              </div>

              <div v-if="playerChapters.length > 0" class="flex flex-wrap gap-2">
                <button
                  v-for="chapter in playerChapters"
                  :key="`${chapter.start}-${chapter.title}`"
                  class="btn btn-xs"
                  :class="activeChapter?.start === chapter.start ? 'btn-primary' : 'btn-ghost'"
                  :title="chapter.summary || chapter.title"
                  @click="jumpToChapter(chapter)"
                >
                  <span class="font-mono opacity-70">{{ formatDuration(chapter.start) }}</span>
                  <span class="max-w-40 truncate">{{ chapter.title }}</span>
                </button>
              </div>
              <div v-else-if="transcript" class="text-xs text-base-content/50">
                Chapters will appear here after AI processing finishes.
              </div>
            </div>
          </div>
          <div
            v-if="showTranscriptPanel && transcript"
            class="w-full lg:w-80 lg:flex-shrink-0 bg-base-300 rounded-lg p-3 overflow-hidden flex flex-col max-h-[50vh] lg:max-h-[70vh]"
          >
            <TranscriptPanel
              :transcript="transcript"
              :video-ref="videoRef ?? undefined"
              :current-time="currentTime"
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

    <dialog :open="deletingRecording !== null" class="modal" @close="handleDeleteDialogClose">
      <div class="modal-box">
        <h3 class="font-bold text-lg">
          Delete Recording?
        </h3>
        <p class="py-4">
          This will permanently delete the recording file, transcript, summary, and chapters for
          <span class="font-medium">{{ deletingRecording?.name }}</span>.
        </p>
        <div class="modal-action">
          <button class="btn btn-ghost" :disabled="deletingRecordingId !== null" @click="cancelDeleteRecording">
            Cancel
          </button>
          <button class="btn btn-error" :disabled="deletingRecordingId !== null" @click="confirmDeleteRecording">
            <span v-if="deletingRecordingId" class="loading loading-spinner loading-xs" />
            Delete
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
