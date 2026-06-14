import type { SummaryProgress } from './aiTranscriber'

/**
 * Backend-agnostic summarizer interface.
 * Each implementation knows its own configuration (model, prompt, API params).
 */
export interface SummarizerBackend {
  /** Human-readable name for UI display */
  readonly name: string

  /** Check if this backend is available on the current device/browser */
  isAvailable: () => Promise<boolean>

  /** Summarize a single chunk of text. The caller handles chunking. */
  summarize: (text: string, context?: string) => Promise<string>
}

interface SummarizerOptions {
  sharedContext?: string
  type?: 'key-points' | 'tldr' | 'teaser' | 'headline'
  format?: 'markdown' | 'plain-text'
  length?: 'short' | 'medium' | 'long'
  preference?: 'auto' | 'speed' | 'capability'
}

/**
 * Chrome Built-in AI Summarizer backend.
 * Uses the browser's native Summarizer API (Gemini Nano).
 */
export class ChromeSummarizerBackend implements SummarizerBackend {
  readonly name = 'Chrome AI'

  constructor(private readonly options: SummarizerOptions = {}) {}

  async isAvailable(): Promise<boolean> {
    if (!('Summarizer' in globalThis)) {
      return false
    }

    try {
      const availability = await (globalThis as any).Summarizer.availability()
      return availability !== 'unavailable'
    }
    catch {
      return false
    }
  }

  async summarize(text: string, context?: string): Promise<string> {
    const summarizer = await (globalThis as any).Summarizer.create({
      type: 'key-points',
      format: 'markdown',
      length: 'medium',
      ...this.options,
    })

    try {
      return await summarizer.summarize(text, context ? { context } : undefined)
    }
    finally {
      summarizer.destroy?.()
    }
  }
}

/**
 * Summarize long text using chunking + recursive reduction.
 *
 * @param text - The full text to summarize
 * @param backend - The summarizer backend to use
 * @param onProgress - Optional progress callback
 * @returns The final summary string
 */
export async function summarizeLongText(
  text: string,
  backend: SummarizerBackend,
  onProgress?: (progress: SummaryProgress) => void,
): Promise<string> {
  const { splitTextIntoChunks } = await import('./textSplitter')

  const MAX_CHUNK_SIZE = 5000
  const OVERLAP = 200
  const MAX_RECURSION_DEPTH = 2

  // Fast path: short text, no chunking needed
  if (text.length <= MAX_CHUNK_SIZE) {
    onProgress?.({ status: 'summarizing', progress: 50 })
    const summary = await backend.summarize(text)
    onProgress?.({ status: 'ready', progress: 100 })
    return summary
  }

  // Recursive helper
  async function summarizeAtDepth(
    inputText: string,
    depth: number,
  ): Promise<string> {
    const chunks = splitTextIntoChunks(inputText, MAX_CHUNK_SIZE, OVERLAP)

    if (chunks.length === 1) {
      // Fits in one chunk now, summarize directly
      return backend.summarize(chunks[0].text)
    }

    // Summarize each chunk sequentially
    const summaries: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]

      // Calculate overall progress across all recursive levels
      // Depth 0 gets 0-90%, depth 1 gets 90-100%
      const depthWeight = depth === 0 ? 0.9 : 0.1
      const chunkProgress = (i + 1) / chunks.length
      const overallProgress = Math.round(
        (depth === 0 ? 0 : 90) + chunkProgress * depthWeight * 100,
      )

      onProgress?.({
        status: 'summarizing',
        progress: overallProgress,
        message: `Summarizing chunk ${chunk.index + 1} of ${chunk.total}...`,
      })

      let summary: string | null = null
      let retries = 1

      while (retries >= 0 && summary === null) {
        try {
          summary = await backend.summarize(chunk.text)
        }
        catch (e) {
          console.warn(`Summarization failed for chunk ${chunk.index + 1}/${chunk.total}, retries left: ${retries}`, e)
          retries--
          if (retries >= 0) {
            // Brief delay before retry
            await new Promise(r => setTimeout(r, 500))
          }
        }
      }

      if (summary !== null) {
        summaries.push(summary)
      }
      else {
        console.warn(`Skipping chunk ${chunk.index + 1}/${chunk.total} after retry`)
      }
    }

    const combinedSummary = summaries.join('\n\n')

    // Check if we need another round of summarization
    if (combinedSummary.length > MAX_CHUNK_SIZE && depth < MAX_RECURSION_DEPTH) {
      return summarizeAtDepth(combinedSummary, depth + 1)
    }

    return combinedSummary
  }

  return summarizeAtDepth(text, 0)
}
