function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
}

export function renderSummaryToHtml(text: string): string {
  if (!text)
    return ''

  const result: string[] = []
  const paragraphLines: string[] = []
  let activeList: 'ul' | 'ol' | null = null

  function closeList() {
    if (activeList) {
      result.push(`</${activeList}>`)
      activeList = null
    }
  }

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return
    }

    result.push(`<p>${renderInlineMarkdown(paragraphLines.join(' '))}</p>`)
    paragraphLines.length = 0
  }

  function openList(type: 'ul' | 'ol') {
    flushParagraph()

    if (activeList === type) {
      return
    }

    closeList()
    result.push(`<${type}>`)
    activeList = type
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      closeList()
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      flushParagraph()
      closeList()

      const level = Math.min(headingMatch[1].length + 2, 6)
      result.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`)
      continue
    }

    const bulletMatch = line.match(/^[*\-]\s+(.*)/)
    if (bulletMatch) {
      openList('ul')
      result.push(`<li>${renderInlineMarkdown(bulletMatch[1])}</li>`)
      continue
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.*)/)
    if (numberedMatch) {
      openList('ol')
      result.push(`<li>${renderInlineMarkdown(numberedMatch[1])}</li>`)
      continue
    }

    closeList()
    paragraphLines.push(line)
  }

  flushParagraph()
  closeList()

  return result.length > 0 ? result.join('\n') : escapeHtml(text)
}
