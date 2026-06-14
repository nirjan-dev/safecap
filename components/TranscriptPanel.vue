<script lang="ts" setup>
import type { RecordingTranscript } from '@/src/utils/transcriptStorage'
import { Icon } from '@iconify/vue'
import { ref } from 'vue'

const props = defineProps<{
  transcript: RecordingTranscript
  videoRef?: HTMLVideoElement
}>()

const emit = defineEmits<{
  (e: 'seekTo', timestamp: number): void
  (e: 'deleteTranscript'): void
}>()

const activeTab = ref<'transcript' | 'summary' | 'chapters'>('transcript')

const deleteConfirmOpen = ref(false)

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function handleSeek(timestamp: number) {
  emit('seekTo', timestamp)
}

function copySummary() {
  navigator.clipboard.writeText(props.transcript.summary)
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
    <div class="flex items-center gap-2 border-b border-base-300 pb-2 mb-2">
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

    <div class="flex-1 overflow-y-auto min-h-0">
      <div v-if="activeTab === 'transcript'" class="space-y-2">
        <div
          v-for="(segment, index) in transcript.segments"
          :key="index"
          class="group flex gap-2 p-2 rounded hover:bg-base-300 cursor-pointer"
          @click="handleSeek(segment.start)"
        >
          <span class="text-base-content/40 text-xs whitespace-nowrap font-mono">
            [{{ formatDuration(segment.start) }}]
          </span>
          <span class="text-sm">{{ segment.text }}</span>
        </div>
        <div
          v-if="transcript.segments.length === 0"
          class="text-center text-base-content/50 py-8"
        >
          No transcript segments available
        </div>
      </div>

      <div v-else-if="activeTab === 'summary'" class="space-y-3">
        <div v-if="transcript.summary" class="prose prose-sm max-w-none">
          <p>{{ transcript.summary }}</p>
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
          Copy to clipboard
        </button>
      </div>

      <div v-else-if="activeTab === 'chapters'" class="space-y-2">
        <div
          v-for="(chapter, index) in transcript.chapters"
          :key="index"
          class="p-2 rounded hover:bg-base-300 cursor-pointer"
          @click="handleSeek(chapter.start)"
        >
          <div class="flex items-center gap-2">
            <span class="text-base-content/40 text-xs whitespace-nowrap font-mono">
              [{{ formatDuration(chapter.start) }}]
            </span>
            <span class="text-sm font-medium">{{ chapter.title }}</span>
          </div>
          <p v-if="chapter.summary" class="text-xs text-base-content/60 mt-1 pl-14">
            {{ chapter.summary }}
          </p>
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
