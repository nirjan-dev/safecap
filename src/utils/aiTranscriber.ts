import { ChromeSummarizerBackend, summarizeLongText } from './summarizerBackend'

export type SummaryStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'summarizing' | 'unavailable'

export interface SummaryProgress {
  status: SummaryStatus
  progress: number
  error?: string
  message?: string
}

export interface AvailabilityResult {
  available: boolean
  downloadable?: boolean
  reason?: string
}

function isSummarizerSupported(): boolean {
  return 'Summarizer' in globalThis
}

export async function checkAvailability(): Promise<AvailabilityResult> {
  if (!isSummarizerSupported()) {
    return { available: false, reason: 'Summarizer API not supported in this browser' }
  }

  try {
    const availability = await Summarizer.availability()

    switch (availability) {
      case 'available':
        return { available: true, downloadable: false }
      case 'downloadable':
        return { available: false, downloadable: true }
      case 'downloading':
        return { available: false, downloadable: true }
      case 'unavailable':
        return { available: false, reason: 'Summarizer is not available on this device' }
      default:
        return { available: false, reason: 'Unknown availability status' }
    }
  }
  catch (e) {
    return { available: false, reason: String(e) }
  }
}

export async function downloadAiModel(): Promise<boolean> {
  if (!isSummarizerSupported()) {
    return false
  }

  try {
    await Summarizer.create({
      type: 'key-points',
      format: 'markdown',
      length: 'medium',
    })
    return true
  }
  catch {
    return false
  }
}

export async function generateRecordingSummary(
  transcriptText: string,
  onProgress?: (progress: SummaryProgress) => void,
): Promise<{ summary: string }> {
  if (!transcriptText.trim()) {
    return { summary: '' }
  }

  const backend = new ChromeSummarizerBackend()

  onProgress?.({ status: 'checking', progress: 0 })

  const isAvailable = await backend.isAvailable()
  if (!isAvailable) {
    onProgress?.({ status: 'unavailable', progress: 0, error: 'Summarizer is not available on this device' })
    return { summary: '' }
  }

  try {
    // Check if model needs downloading
    const availability = await (globalThis as any).Summarizer.availability()

    if (availability === 'downloadable' || availability === 'downloading') {
      onProgress?.({ status: 'downloading', progress: 0 })

      // Create a temporary summarizer just to trigger the download with progress
      await (globalThis as any).Summarizer.create({
        type: 'key-points',
        format: 'markdown',
        length: 'medium',
        monitor(m: any) {
          m.addEventListener('downloadprogress', (e: Event) => {
            const progressEvent = e as unknown as { loaded: number }
            const progress = Math.round(progressEvent.loaded * 100)
            onProgress?.({ status: 'downloading', progress })
          })
        },
      })
    }

    onProgress?.({ status: 'summarizing', progress: 10 })

    const summary = await summarizeLongText(transcriptText, backend, (p) => {
      onProgress?.(p)
    })

    onProgress?.({ status: 'ready', progress: 100 })
    return { summary }
  }
  catch (e) {
    console.error('Failed to generate summary:', e)
    onProgress?.({ status: 'unavailable', progress: 0, error: String(e) })
    return { summary: '' }
  }
}
