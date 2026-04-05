<script lang="ts" setup>
const status = ref<'idle' | 'requesting' | 'success' | 'error'>('idle')
const errorMessage = ref('')

async function enableMicrophone() {
  status.value = 'requesting'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop())
    status.value = 'success'
  }
  catch (e: any) {
    status.value = 'error'
    errorMessage.value = e?.name || 'Unknown error'
  }
}
</script>

<template>
  <div class="min-h-screen bg-base-300 p-8">
    <div class="max-w-md mx-auto">
      <h1 class="text-2xl font-bold mb-4">
        Enable Microphone
      </h1>

      <p class="mb-6 text-base-content/70">
        Click the button below to grant microphone permission.
        This is required to include your voice in recordings.
      </p>

      <button
        class="btn btn-primary"
        :disabled="status === 'requesting' || status === 'success'"
        @click="enableMicrophone"
      >
        <span v-if="status === 'requesting'" class="loading loading-spinner" />
        <span v-else>Enable Microphone</span>
      </button>

      <div v-if="status === 'success'" class="mt-4 alert alert-success">
        <span>Microphone enabled! You can close this tab.</span>
      </div>

      <div v-if="status === 'error'" class="mt-4 alert alert-error">
        <div>
          <span>Microphone blocked: {{ errorMessage }}</span>
          <p class="text-sm mt-2">
            Check Chrome and OS microphone settings.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
