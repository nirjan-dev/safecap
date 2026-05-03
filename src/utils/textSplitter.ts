/**
 * Split text into chunks at sentence boundaries using Intl.Segmenter.
 * Each chunk is at most maxChars, with overlapChars of overlap between chunks.
 * Uses native browser API — zero dependencies.
 */

export interface TextChunk {
  text: string
  index: number
  total: number
}

export function splitTextIntoChunks(
  text: string,
  maxChars: number,
  overlapChars: number,
): TextChunk[] {
  const sentences = getSentences(text)
  if (sentences.length === 0) {
    return []
  }

  // Fast path: entire text fits in one chunk
  if (text.length <= maxChars) {
    return [{ text, index: 0, total: 1 }]
  }

  const chunkTexts: string[] = []
  let currentChunk = ''

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]

    // If adding this sentence exceeds maxChars, finalize current chunk
    if (currentChunk.length > 0 && currentChunk.length + sentence.length > maxChars) {
      chunkTexts.push(currentChunk.trim())

      // Start new chunk with overlap from previous chunk
      const overlap = getOverlap(currentChunk, overlapChars)
      currentChunk = `${overlap}${sentence}`
    }
    else {
      currentChunk += sentence
    }
  }

  // Push final chunk if it has content
  if (currentChunk.trim().length > 0) {
    chunkTexts.push(currentChunk.trim())
  }

  return chunkTexts.map((text, index) => ({
    text,
    index,
    total: chunkTexts.length,
  }))
}

function getSentences(text: string): string[] {
  // Use Intl.Segmenter for locale-aware sentence segmentation (native browser API)
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const segmenter = new (Intl as any).Segmenter('en', { granularity: 'sentence' })
      const segments = Array.from(segmenter.segment(text))
      return segments.map((s: any) => s.segment)
    }
    catch {
      // Fallback to regex if Segmenter fails
    }
  }

  // Fallback: naive sentence splitting on period/!/? followed by space or end
  return text
    .replace(/([.!?])(\s+)(?=[A-Z])/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function getOverlap(text: string, overlapChars: number): string {
  if (text.length <= overlapChars) {
    return `${text} `
  }

  // Find a sentence boundary within the overlap region to avoid cutting mid-sentence
  const overlapRegion = text.slice(-overlapChars)
  const lastSentenceEnd = Math.max(
    overlapRegion.lastIndexOf('. '),
    overlapRegion.lastIndexOf('! '),
    overlapRegion.lastIndexOf('? '),
  )

  if (lastSentenceEnd > 0) {
    const startIdx = text.length - overlapChars + lastSentenceEnd + 2
    return `${text.slice(startIdx)} `
  }

  // No clean boundary found, just truncate
  return `${text.slice(-overlapChars)} `
}
