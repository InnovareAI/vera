// Markdown export of a Vera result — the raw text, no images (image URLs stay
// as links), plus any video links. PDF export lives in ./exportPdf (lazy-loaded
// because @react-pdf/renderer is heavy).

function filename(ext: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return `vera-${stamp}.${ext}`
}

// Strip the draft-context tail the composer appends to user turns, so an export
// never leaks the internal "[The draft currently open …]" block.
export function clean(md: string): string {
  return md.split('\n---\n[The draft currently open')[0].trim()
}

export function downloadMarkdown(content: string, videos: string[] = []): void {
  let md = clean(content)
  if (videos.length) {
    md += '\n\n' + videos.map((u, i) => `**Video${videos.length > 1 ? ` ${i + 1}` : ''}:** [Watch ▶](${u})`).join('\n')
  }
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename('md')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
