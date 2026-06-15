function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderSummaryToHtml(text: string): string {
  if (!text)
    return ''

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const items: string[] = []

  for (const line of lines) {
    const bulletMatch = line.match(/^[*\-]\s+(.*)/)
    if (bulletMatch) {
      items.push(`<li>${escapeHtml(bulletMatch[1])}</li>`)
    }
    else {
      items.push(`<p>${escapeHtml(line)}</p>`)
    }
  }

  if (items.length === 0)
    return escapeHtml(text)

  const result: string[] = []
  let inList = false
  for (const item of items) {
    if (item.startsWith('<li')) {
      if (!inList) {
        result.push('<ul>')
        inList = true
      }
      result.push(item)
    }
    else {
      if (inList) {
        result.push('</ul>')
        inList = false
      }
      result.push(item)
    }
  }
  if (inList)
    result.push('</ul>')

  return result.join('\n')
}
