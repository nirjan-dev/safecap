import { describe, expect, it } from 'vitest'
import { renderSummaryToHtml } from '@/src/utils/renderMarkdown'

describe('renderSummaryToHtml', () => {
  it('renders common summary markdown safely', () => {
    const html = renderSummaryToHtml(`# Summary

- **First** point
- Uses \`code\`

1. Numbered item

Do not render <script>alert('x')</script>`)

    expect(html).toContain('<h3>Summary</h3>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<strong>First</strong> point')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<ol>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
