import type { Chapter } from './transcriptStorage'

interface AvailabilityResult {
  available: boolean
  downloadable?: boolean
  reason?: string
}

interface SummaryAndChapters {
  summary: string
  chapters: Chapter[]
}

export async function checkAvailability(): Promise<AvailabilityResult> {
  try {
    if (typeof (window as any).ai !== 'undefined') {
      const summarizerCapability = await (window as any).ai.summarizer.canCreate()
      if (summarizerCapability === 'readily') {
        return { available: true, downloadable: false }
      }
      return {
        available: false,
        downloadable: summarizerCapability === 'downloadable',
        reason: summarizerCapability === 'downloadable'
          ? 'AI model needs to be downloaded (22GB)'
          : 'AI not available on this device',
      }
    }
    return { available: false, reason: 'AI API not available' }
  }
  catch (e) {
    return { available: false, reason: String(e) }
  }
}

export async function downloadAiModel(): Promise<boolean> {
  try {
    const _summarizer = await (window as any).ai.summarizer.create()
    return true
  }
  catch {
    return false
  }
}

export async function generateSummaryAndChapters(
  transcriptText: string,
  duration: number,
): Promise<SummaryAndChapters> {
  const availability = await checkAvailability()

  if (!availability.available) {
    return { summary: '', chapters: [] }
  }

  const summary = await generateSummary(transcriptText)
  const chapters = await detectChapters(transcriptText, duration)

  return { summary, chapters }
}

async function generateSummary(transcriptText: string): Promise<string> {
  try {
    const summarizer = await (window as any).ai.summarizer.create({
      type: 'key-points',
      format: 'markdown',
      length: 'medium',
    })

    const summary = await summarizer.summarize(transcriptText)
    return summary
  }
  catch (e) {
    console.error('Failed to generate summary:', e)
    return ''
  }
}

async function detectChapters(transcriptText: string, _duration: number): Promise<Chapter[]> {
  try {
    const session = await (window as any).ai.languageModel.create()

    const prompt = `You are a video chapter generator. Given the following transcript, identify the main topics/sections and their approximate start times. Return ONLY a JSON array of chapters in this exact format:
[
  {"title": "Introduction", "start": 0},
  {"title": "Main Topic 1", "start": 120},
  {"title": "Main Topic 2", "start": 300}
]
Do not include any other text. Use reasonable timestamps based on the transcript length.

Transcript:
${transcriptText.slice(0, 4000)}`

    const response = await session.prompt(prompt)
    await session.destroy()

    const chapters = parseChapterResponse(response)
    return chapters
  }
  catch (e) {
    console.error('Failed to detect chapters:', e)
    return []
  }
}

function parseChapterResponse(response: string): Chapter[] {
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ title: string, start: number }>
      return parsed.map(p => ({ title: p.title, start: p.start, end: p.start + 60 }))
    }
  }
  catch {
  }

  const regexChapters: Chapter[] = []
  const regex = /\[(\d{1,2}):(\d{2})\]\s*([^[\n]+)/g
  let match = regex.exec(response)
  while (match !== null) {
    const minutes = Number.parseInt(match[1], 10)
    const seconds = Number.parseInt(match[2], 10)
    const start = minutes * 60 + seconds
    const title = match[3].trim()

    if (title && start > 0) {
      regexChapters.push({ title, start, end: start + 60 })
    }
    match = regex.exec(response)
  }

  return regexChapters
}
