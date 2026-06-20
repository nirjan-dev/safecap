<script lang="ts" setup>
import type { ComponentPublicInstance } from 'vue'
import type { RecordingTranscript } from '@/src/utils/transcriptStorage'
import { Icon } from '@iconify/vue'
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, ref, watch } from 'vue'
import { renderSummaryToHtml } from '@/src/utils/renderMarkdown'

const props = defineProps<{
  transcript: RecordingTranscript
  videoRef?: HTMLVideoElement
  currentTime?: number
}>()

const emit = defineEmits<{
  (e: 'seekTo', timestamp: number): void
  (e: 'deleteTranscript'): void
}>()

const activeTab = ref<'transcript' | 'summary' | 'chapters'>('transcript')

const deleteConfirmOpen = ref(false)
const transcriptSearchQuery = ref('')
const activeSearchMatchIndex = ref<number | null>(null)
const copyStatus = ref('')
const copyStatusIsError = ref(false)
const scrollContainerRef = ref<HTMLElement | null>(null)
const segmentRefs = ref<HTMLElement[]>([])
const chapterRefs = ref<HTMLElement[]>([])

let copyStatusTimer: number | null = null

const normalizedTranscriptSearch = computed(() => transcriptSearchQuery.value.trim().toLowerCase())
const matchingSegmentIndexes = computed(() => {
  const query = normalizedTranscriptSearch.value
  if (!query) {
    return []
  }

  return props.transcript.segments
    .map((segment, index) => segment.text.toLowerCase().includes(query) ? index : -1)
    .filter(index => index >= 0)
})
const matchingSegmentIndexSet = computed(() => new Set(matchingSegmentIndexes.value))
const activeSearchSegmentIndex = computed(() => {
  if (activeSearchMatchIndex.value === null) {
    return -1
  }

  return matchingSegmentIndexes.value[activeSearchMatchIndex.value] ?? -1
})
const activeSearchMatchPosition = computed(() => activeSearchMatchIndex.value === null ? 0 : activeSearchMatchIndex.value + 1)
const activeSegmentIndex = computed(() => getActiveTimedItemIndex(props.transcript.segments, props.currentTime ?? 0))
const activeChapterIndex = computed(() => getActiveTimedItemIndex(props.transcript.chapters, props.currentTime ?? 0))

onBeforeUpdate(() => {
  segmentRefs.value = []
  chapterRefs.value = []
})

onBeforeUnmount(() => {
  if (copyStatusTimer !== null) {
    window.clearTimeout(copyStatusTimer)
  }
})

watch(transcriptSearchQuery, () => {
  activeSearchMatchIndex.value = null
})

watch(matchingSegmentIndexes, (matches) => {
  if (activeSearchMatchIndex.value !== null && activeSearchMatchIndex.value >= matches.length) {
    activeSearchMatchIndex.value = matches.length > 0 ? 0 : null
  }
})

watch(activeSegmentIndex, () => {
  if (activeTab.value === 'transcript') {
    void scrollActiveItemIntoView()
  }
})

watch(activeChapterIndex, () => {
  if (activeTab.value === 'chapters') {
    void scrollActiveItemIntoView()
  }
})

watch(activeTab, () => {
  void scrollActiveItemIntoView()
})

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function getActiveTimedItemIndex(items: { start: number }[], currentTime: number): number {
  if (!Number.isFinite(currentTime)) {
    return -1
  }

  let activeIndex = -1
  for (let i = 0; i < items.length; i++) {
    if (currentTime >= items[i].start) {
      activeIndex = i
    }
    else {
      break
    }
  }

  return activeIndex
}

function handleSeek(timestamp: number) {
  emit('seekTo', timestamp)
}

function handleSegmentClick(segment: RecordingTranscript['segments'][number], index: number) {
  const searchMatchIndex = matchingSegmentIndexes.value.indexOf(index)
  if (searchMatchIndex >= 0) {
    activeSearchMatchIndex.value = searchMatchIndex
  }

  handleSeek(segment.start)
}

function setSegmentRef(el: Element | ComponentPublicInstance | null, index: number) {
  if (el instanceof HTMLElement) {
    segmentRefs.value[index] = el
  }
}

function setChapterRef(el: Element | ComponentPublicInstance | null, index: number) {
  if (el instanceof HTMLElement) {
    chapterRefs.value[index] = el
  }
}

function getActiveElement(): HTMLElement | undefined {
  if (activeTab.value === 'transcript') {
    return segmentRefs.value[activeSegmentIndex.value]
  }

  if (activeTab.value === 'chapters') {
    return chapterRefs.value[activeChapterIndex.value]
  }

  return undefined
}

function scrollItemIntoView(item: HTMLElement | undefined) {
  const container = scrollContainerRef.value
  if (!container || !item) {
    return
  }

  const containerRect = container.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const padding = 16

  if (itemRect.top < containerRect.top + padding) {
    container.scrollBy({ top: itemRect.top - containerRect.top - padding, behavior: 'smooth' })
  }
  else if (itemRect.bottom > containerRect.bottom - padding) {
    container.scrollBy({ top: itemRect.bottom - containerRect.bottom + padding, behavior: 'smooth' })
  }
}

async function scrollActiveItemIntoView() {
  await nextTick()
  scrollItemIntoView(getActiveElement())
}

async function scrollSegmentIntoView(index: number) {
  await nextTick()
  scrollItemIntoView(segmentRefs.value[index])
}

function clearTranscriptSearch() {
  transcriptSearchQuery.value = ''
  activeSearchMatchIndex.value = null
}

function selectSearchMatch(index: number) {
  const matches = matchingSegmentIndexes.value
  if (matches.length === 0) {
    activeSearchMatchIndex.value = null
    return
  }

  const normalizedIndex = (index + matches.length) % matches.length
  activeSearchMatchIndex.value = normalizedIndex

  const segmentIndex = matches[normalizedIndex]
  const segment = props.transcript.segments[segmentIndex]
  if (!segment) {
    return
  }

  handleSeek(segment.start)
  void scrollSegmentIntoView(segmentIndex)
}

function goToCurrentSearchMatch() {
  selectSearchMatch(activeSearchMatchIndex.value ?? 0)
}

function goToPreviousSearchMatch() {
  selectSearchMatch(activeSearchMatchIndex.value === null ? 0 : activeSearchMatchIndex.value - 1)
}

function goToNextSearchMatch() {
  selectSearchMatch(activeSearchMatchIndex.value === null ? 0 : activeSearchMatchIndex.value + 1)
}

function isSearchMatch(index: number): boolean {
  return matchingSegmentIndexSet.value.has(index)
}

function isSelectedSearchMatch(index: number): boolean {
  return activeSearchSegmentIndex.value === index
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderTranscriptText(text: string): string {
  const query = normalizedTranscriptSearch.value
  if (!query) {
    return escapeHtml(text)
  }

  const regex = new RegExp(escapeRegExp(query), 'gi')
  let result = ''
  let lastIndex = 0
  let match = regex.exec(text)

  while (match) {
    result += escapeHtml(text.slice(lastIndex, match.index))
    result += `<mark class="rounded bg-warning/40 px-0.5 text-warning-content">${escapeHtml(match[0])}</mark>`
    lastIndex = match.index + match[0].length
    match = regex.exec(text)
  }

  result += escapeHtml(text.slice(lastIndex))
  return result
}

function formatTranscriptForClipboard(): string {
  return props.transcript.segments
    .map(segment => `[${formatDuration(segment.start)}] ${segment.text}`)
    .join('\n')
}

function showCopyStatus(message: string, isError = false) {
  copyStatus.value = message
  copyStatusIsError.value = isError

  if (copyStatusTimer !== null) {
    window.clearTimeout(copyStatusTimer)
  }

  copyStatusTimer = window.setTimeout(() => {
    copyStatus.value = ''
    copyStatusIsError.value = false
  }, 2000)
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    showCopyStatus(`${label} copied to clipboard`)
  }
  catch (error) {
    console.error(`Failed to copy ${label.toLowerCase()}:`, error)
    showCopyStatus(`Failed to copy ${label.toLowerCase()}`, true)
  }
}

function copySummary() {
  void copyToClipboard(props.transcript.summary, 'Summary')
}

function copyTranscript() {
  void copyToClipboard(formatTranscriptForClipboard(), 'Transcript')
}

function openDeleteConfirm() {
  deleteConfirmOpen.value = true
}

function confirmDelete() {
  deleteConfirmOpen.value = false
  emit('deleteTranscript')
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div class="flex flex-wrap items-center gap-2 border-b border-base-300 pb-2 mb-2">
      <button
        class="btn btn-sm"
        :class="activeTab === 'transcript' ? 'btn-primary' : 'btn-ghost'"
        @click="activeTab = 'transcript'"
      >
        <Icon icon="lucide:file-text" class="w-4 h-4" />
        Transcript
      </button>
      <button
        class="btn btn-sm"
        :class="activeTab === 'summary' ? 'btn-primary' : 'btn-ghost'"
        @click="activeTab = 'summary'"
      >
        <Icon icon="lucide:align-left" class="w-4 h-4" />
        Summary
      </button>
      <button
        class="btn btn-sm"
        :class="activeTab === 'chapters' ? 'btn-primary' : 'btn-ghost'"
        @click="activeTab = 'chapters'"
      >
        <Icon icon="lucide:list-ordered" class="w-4 h-4" />
        Chapters
      </button>
      <div class="flex-1" />
      <button
        class="btn btn-sm btn-ghost btn-error"
        title="Delete Transcript"
        @click="openDeleteConfirm"
      >
        <Icon icon="lucide:trash-2" class="w-4 h-4" />
      </button>
    </div>

    <div
      v-if="copyStatus"
      class="alert py-2 mb-2 text-xs"
      :class="copyStatusIsError ? 'alert-error' : 'alert-success'"
    >
      <Icon :icon="copyStatusIsError ? 'lucide:triangle-alert' : 'lucide:check'" class="w-4 h-4" />
      <span>{{ copyStatus }}</span>
    </div>

    <div ref="scrollContainerRef" class="flex-1 overflow-y-auto min-h-0">
      <div v-if="activeTab === 'transcript'" class="space-y-3">
        <div class="space-y-2">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label class="input input-sm input-bordered flex items-center gap-2 flex-1 min-w-0">
              <Icon icon="lucide:search" class="w-4 h-4 text-base-content/50" />
              <input
                v-model="transcriptSearchQuery"
                type="search"
                class="grow"
                placeholder="Search transcript"
                @keydown.enter.prevent="goToCurrentSearchMatch"
              >
              <button
                v-if="transcriptSearchQuery"
                class="btn btn-ghost btn-xs btn-circle"
                title="Clear transcript search"
                @click="clearTranscriptSearch"
              >
                <Icon icon="lucide:x" class="w-3 h-3" />
              </button>
            </label>
            <button
              class="btn btn-sm btn-outline"
              :disabled="transcript.segments.length === 0"
              @click="copyTranscript"
            >
              <Icon icon="lucide:copy" class="w-4 h-4" />
              Copy transcript
            </button>
          </div>

          <div v-if="normalizedTranscriptSearch" class="flex flex-wrap items-center justify-between gap-2 text-xs text-base-content/60">
            <span v-if="matchingSegmentIndexes.length > 0">
              <template v-if="activeSearchMatchIndex !== null">
                {{ activeSearchMatchPosition }} /
              </template>
              {{ matchingSegmentIndexes.length }} match{{ matchingSegmentIndexes.length === 1 ? '' : 'es' }}
            </span>
            <span v-else>No transcript matches</span>
            <div class="join">
              <button
                class="join-item btn btn-xs"
                :disabled="matchingSegmentIndexes.length === 0"
                title="Previous match"
                @click="goToPreviousSearchMatch"
              >
                <Icon icon="lucide:chevron-up" class="w-3 h-3" />
              </button>
              <button
                class="join-item btn btn-xs"
                :disabled="matchingSegmentIndexes.length === 0"
                title="Next match"
                @click="goToNextSearchMatch"
              >
                <Icon icon="lucide:chevron-down" class="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        <div
          v-for="(segment, index) in transcript.segments"
          :key="index"
          :ref="el => setSegmentRef(el, index)"
          class="group flex gap-2 p-2 rounded hover:bg-base-300 cursor-pointer scroll-mt-2 transition-colors"
          :class="[
            index === activeSegmentIndex ? 'bg-primary/15 ring-1 ring-primary/30' : '',
            isSelectedSearchMatch(index) ? 'bg-warning/20 ring-1 ring-warning/60' : isSearchMatch(index) ? 'bg-warning/10' : '',
          ]"
          :aria-current="index === activeSegmentIndex ? 'true' : undefined"
          @click="handleSegmentClick(segment, index)"
        >
          <span
            class="text-xs whitespace-nowrap font-mono"
            :class="index === activeSegmentIndex ? 'text-primary font-semibold' : 'text-base-content/40'"
          >
            [{{ formatDuration(segment.start) }}]
          </span>
          <span class="text-sm leading-relaxed" v-html="renderTranscriptText(segment.text)" />
        </div>
        <div
          v-if="transcript.segments.length === 0"
          class="text-center text-base-content/50 py-8"
        >
          No transcript segments available
        </div>
      </div>

      <div v-else-if="activeTab === 'summary'" class="space-y-3">
        <div v-if="transcript.summary" class="prose prose-sm prose-invert max-w-none">
          <div v-html="renderSummaryToHtml(transcript.summary)" />
        </div>
        <div
          v-else
          class="text-center text-base-content/50 py-8"
        >
          No summary available
        </div>
        <button
          v-if="transcript.summary"
          class="btn btn-sm btn-outline"
          @click="copySummary"
        >
          <Icon icon="lucide:copy" class="w-4 h-4" />
          Copy summary
        </button>
      </div>

      <div v-else-if="activeTab === 'chapters'" class="space-y-2">
        <div
          v-for="(chapter, index) in transcript.chapters"
          :key="index"
          :ref="el => setChapterRef(el, index)"
          class="p-2 rounded hover:bg-base-300 cursor-pointer scroll-mt-2 transition-colors"
          :class="index === activeChapterIndex ? 'bg-primary/15 ring-1 ring-primary/30' : ''"
          :aria-current="index === activeChapterIndex ? 'true' : undefined"
          @click="handleSeek(chapter.start)"
        >
          <div class="flex items-center gap-2">
            <span
              class="text-xs whitespace-nowrap font-mono"
              :class="index === activeChapterIndex ? 'text-primary font-semibold' : 'text-base-content/40'"
            >
              [{{ formatDuration(chapter.start) }}]
            </span>
            <span class="text-sm font-medium" :class="index === activeChapterIndex ? 'text-primary' : ''">{{ chapter.title }}</span>
          </div>
          <div
            v-if="chapter.summary"
            class="prose prose-sm prose-invert max-w-none mt-1 pl-14 opacity-70 [&_*]:text-xs [&_p]:my-1 [&_ul]:my-1"
            v-html="renderSummaryToHtml(chapter.summary)"
          />
        </div>
        <div
          v-if="transcript.chapters.length === 0"
          class="text-center text-base-content/50 py-8"
        >
          No chapters detected
        </div>
      </div>
    </div>

    <dialog :open="deleteConfirmOpen" class="modal" @close="deleteConfirmOpen = false">
      <div class="modal-box">
        <h3 class="font-bold text-lg">
          Delete Transcript?
        </h3>
        <p class="py-4">
          This will permanently delete the transcript, summary, and chapters. The video recording will remain.
        </p>
        <div class="modal-action">
          <button class="btn btn-ghost" @click="deleteConfirmOpen = false">
            Cancel
          </button>
          <button class="btn btn-error" @click="confirmDelete">
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
