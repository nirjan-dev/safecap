import type { Chapter, TranscriptSegment } from './transcriptStorage'
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

export interface RecordingInsights {
  summary: string
  chapters: Chapter[]
}

interface ChapterDraft {
  text: string
  start: number
  end: number
  index: number
  total: number
}

const CHAPTER_MAX_TEXT_CHARS = 4500
const CHAPTER_MIN_TEXT_CHARS = 700
const CHAPTER_TARGET_SECONDS = 180
const MAX_GENERATED_CHAPTERS = 12

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

async function ensureSummarizerReady(onProgress?: (progress: SummaryProgress) => void): Promise<boolean> {
  const backend = new ChromeSummarizerBackend()

  onProgress?.({ status: 'checking', progress: 0 })

  const isAvailable = await backend.isAvailable()
  if (!isAvailable) {
    onProgress?.({ status: 'unavailable', progress: 0, error: 'Summarizer is not available on this device' })
    return false
  }

  try {
    const availability = await (globalThis as any).Summarizer.availability()

    if (availability === 'downloadable' || availability === 'downloading') {
      onProgress?.({ status: 'downloading', progress: 0 })

      const summarizer = await (globalThis as any).Summarizer.create({
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

      summarizer.destroy?.()
    }

    return true
  }
  catch (e) {
    console.error('Failed to prepare summarizer:', e)
    onProgress?.({ status: 'unavailable', progress: 0, error: String(e) })
    return false
  }
}

function buildChapterDrafts(segments: TranscriptSegment[]): ChapterDraft[] {
  const cleanSegments = segments
    .map(segment => ({
      ...segment,
      text: segment.text.trim(),
    }))
    .filter(segment => segment.text.length > 0)

  if (cleanSegments.length === 0) {
    return []
  }

  const drafts: ChapterDraft[] = []
  let currentTexts: string[] = []
  let currentStart = cleanSegments[0].start
  let currentEnd = cleanSegments[0].end

  function finalizeDraft() {
    const text = currentTexts.join(' ').replace(/\s+/g, ' ').trim()
    if (!text) {
      return
    }

    drafts.push({
      text,
      start: currentStart,
      end: Math.max(currentEnd, currentStart + 1),
      index: 0,
      total: 0,
    })

    currentTexts = []
  }

  for (const segment of cleanSegments) {
    if (currentTexts.length === 0) {
      currentStart = segment.start
      currentEnd = segment.end
    }

    currentTexts.push(segment.text)
    currentEnd = Math.max(currentEnd, segment.end)

    const currentTextLength = currentTexts.join(' ').length
    const currentDuration = currentEnd - currentStart
    const shouldClose = currentTextLength >= CHAPTER_MAX_TEXT_CHARS
      || (currentDuration >= CHAPTER_TARGET_SECONDS && currentTextLength >= CHAPTER_MIN_TEXT_CHARS)

    if (shouldClose) {
      finalizeDraft()
    }
  }

  finalizeDraft()

  while (drafts.length > MAX_GENERATED_CHAPTERS) {
    let mergeIndex = 0
    let smallestCombinedLength = Number.POSITIVE_INFINITY

    for (let i = 0; i < drafts.length - 1; i++) {
      const combinedLength = drafts[i].text.length + drafts[i + 1].text.length
      if (combinedLength < smallestCombinedLength) {
        smallestCombinedLength = combinedLength
        mergeIndex = i
      }
    }

    drafts.splice(mergeIndex, 2, {
      text: `${drafts[mergeIndex].text} ${drafts[mergeIndex + 1].text}`,
      start: drafts[mergeIndex].start,
      end: drafts[mergeIndex + 1].end,
      index: 0,
      total: 0,
    })
  }

  return drafts.map((draft, index) => ({
    ...draft,
    index,
    total: drafts.length,
  }))
}

function removeChapterTitlePrefix(title: string): string {
  const chapterMatch = title.match(/^chapter(?:\s+\d+)?/i)
  const withoutChapter = chapterMatch
    ? title.slice(chapterMatch[0].length).replace(/^[:.\s-]+/, '')
    : title

  return withoutChapter.replace(/^title[:.\s-]+/i, '')
}

function cleanChapterTitle(title: string, fallback: string): string {
  const firstLine = title
    .split('\n')
    .map(line => line.replace(/^[-*#\d.\s]+/, '').trim())
    .find(Boolean)

  const cleaned = removeChapterTitlePrefix(firstLine || fallback)
    .replace(/^['"]|['"]$/g, '')
    .trim()

  if (cleaned.length <= 80) {
    return cleaned
  }

  return `${cleaned.slice(0, 77).trim()}...`
}

function getFallbackChapterTitle(draft: ChapterDraft): string {
  const firstSentence = draft.text.split(/(?<=[.!?])\s+/)[0]?.trim()
  if (firstSentence) {
    return cleanChapterTitle(firstSentence, `Chapter ${draft.index + 1}`)
  }

  return `Chapter ${draft.index + 1}`
}

async function generateChapters(
  segments: TranscriptSegment[],
  onProgress?: (progress: SummaryProgress) => void,
): Promise<Chapter[]> {
  const drafts = buildChapterDrafts(segments)
  if (drafts.length === 0) {
    return []
  }

  const titleBackend = new ChromeSummarizerBackend({
    type: 'headline',
    format: 'plain-text',
    length: 'short',
    preference: 'speed',
    sharedContext: 'Create concise chapter titles for transcripts from browser screen recordings.',
  })
  const summaryBackend = new ChromeSummarizerBackend({
    type: 'tldr',
    format: 'plain-text',
    length: 'medium',
    preference: 'capability',
    sharedContext: 'Summarize one chapter from a browser screen recording transcript.',
  })

  const chapters: Chapter[] = []

  for (const draft of drafts) {
    onProgress?.({
      status: 'summarizing',
      progress: Math.round(10 + (draft.index / drafts.length) * 55),
      message: `Creating chapter ${draft.index + 1} of ${draft.total}...`,
    })

    const fallbackTitle = getFallbackChapterTitle(draft)
    let summary = ''
    let title = fallbackTitle

    try {
      summary = (await summaryBackend.summarize(
        draft.text,
        'Summarize this recording chapter in 1 to 3 clear sentences.',
      )).trim()
    }
    catch (e) {
      console.warn(`Failed to summarize chapter ${draft.index + 1}/${draft.total}`, e)
    }

    try {
      title = cleanChapterTitle(await titleBackend.summarize(
        summary || draft.text.slice(0, 1200),
        'Return only a short chapter title.',
      ), fallbackTitle)
    }
    catch (e) {
      console.warn(`Failed to title chapter ${draft.index + 1}/${draft.total}`, e)
    }

    chapters.push({
      title,
      start: draft.start,
      end: draft.end,
      summary: summary || undefined,
    })
  }

  return chapters
}

export async function generateRecordingSummary(
  transcriptText: string,
  onProgress?: (progress: SummaryProgress) => void,
): Promise<{ summary: string }> {
  if (!transcriptText.trim()) {
    return { summary: '' }
  }

  const isReady = await ensureSummarizerReady(onProgress)
  if (!isReady) {
    return { summary: '' }
  }

  try {
    onProgress?.({ status: 'summarizing', progress: 10 })

    const backend = new ChromeSummarizerBackend()
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

export async function generateRecordingInsights(
  segments: TranscriptSegment[],
  transcriptText: string,
  onProgress?: (progress: SummaryProgress) => void,
): Promise<RecordingInsights> {
  if (!transcriptText.trim()) {
    return { summary: '', chapters: [] }
  }

  const isReady = await ensureSummarizerReady(onProgress)
  if (!isReady) {
    return { summary: '', chapters: [] }
  }

  try {
    const chapters = await generateChapters(segments, onProgress)
    const summarySource = chapters.length > 0
      ? chapters
          .map((chapter, index) => [
            `Chapter ${index + 1}: ${chapter.title}`,
            chapter.summary,
          ].filter(Boolean).join('\n'))
          .join('\n\n')
      : transcriptText

    onProgress?.({ status: 'summarizing', progress: 70, message: 'Summarizing chapters...' })

    const summaryBackend = new ChromeSummarizerBackend({
      type: 'key-points',
      format: 'markdown',
      length: 'medium',
      preference: 'capability',
      sharedContext: 'Summarize chapter summaries from a SafeCap browser recording.',
    })
    const summary = await summarizeLongText(summarySource, summaryBackend, (p) => {
      onProgress?.({
        ...p,
        progress: Math.min(100, Math.max(70, Math.round(70 + p.progress * 0.3))),
      })
    })

    onProgress?.({ status: 'ready', progress: 100 })
    return { summary, chapters }
  }
  catch (e) {
    console.error('Failed to generate recording insights:', e)
    onProgress?.({ status: 'unavailable', progress: 0, error: String(e) })
    return { summary: '', chapters: [] }
  }
}
