// Export a Vera result to a downloadable file.
//   • Markdown — the raw text, no images (links to any images stay as URLs).
//   • PDF — the rendered document with generated images embedded inline.
// The PDF stack (html2pdf + marked) is lazy-loaded so it never weighs down the
// main bundle — it only loads the first time someone exports.

function filename(ext: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return `vera-${stamp}.${ext}`
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

const PDF_CSS = `
  .vera-pdf { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.55; width: 720px; background: #fff; }
  .vera-pdf h1 { font-size: 21px; font-weight: 700; margin: 16px 0 8px; line-height: 1.25; }
  .vera-pdf h2 { font-size: 16px; font-weight: 700; margin: 16px 0 6px; line-height: 1.3; }
  .vera-pdf h3 { font-size: 14px; font-weight: 600; margin: 13px 0 5px; }
  .vera-pdf p { margin: 0 0 9px; }
  .vera-pdf ul, .vera-pdf ol { margin: 0 0 9px; padding-left: 22px; }
  .vera-pdf li { margin: 2px 0; }
  .vera-pdf strong { font-weight: 700; }
  .vera-pdf a { color: #2563eb; text-decoration: underline; }
  .vera-pdf hr { border: none; border-top: 1px solid #e5e7eb; margin: 14px 0; }
  .vera-pdf table { border-collapse: collapse; width: 100%; margin: 9px 0; font-size: 11px; }
  .vera-pdf th, .vera-pdf td { border: 1px solid #dcdce0; padding: 5px 9px; text-align: left; vertical-align: top; }
  .vera-pdf th { background: #f3f4f6; font-weight: 600; }
  .vera-pdf code { font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; }
  .vera-pdf pre { background: #f6f7f8; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; overflow: hidden; white-space: pre-wrap; }
  .vera-pdf .vera-pdf-images { margin-top: 12px; }
  .vera-pdf .vera-pdf-images img { display: block; max-width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; margin: 10px 0; }
  .vera-pdf .vera-pdf-videos { margin-top: 12px; }
  .vera-pdf .vera-pdf-vidlink { font-size: 11px; color: #2563eb; word-break: break-all; margin: 3px 0; }
`

// Strip the draft-context tail the composer appends to user turns, so an export
// never leaks the internal "[The draft currently open …]" block.
function clean(md: string): string {
  return md.split('\n---\n[The draft currently open')[0].trim()
}

export async function downloadPdf(content: string, images: string[] = [], videos: string[] = []): Promise<void> {
  const [markedMod, html2pdfMod] = await Promise.all([import('marked'), import('html2pdf.js')])
  const marked = (markedMod as { marked: { parse: (s: string) => string | Promise<string> } }).marked
  const html2pdf = (html2pdfMod as unknown as { default: () => { set: (o: Record<string, unknown>) => { from: (e: HTMLElement) => { save: () => Promise<void> } } } }).default

  const bodyHtml = await marked.parse(clean(content))
  const imgHtml = images.length
    ? `<div class="vera-pdf-images">${images.map(u => `<img crossorigin="anonymous" src="${u}" />`).join('')}</div>`
    : ''
  // Videos can't live in a static PDF — include the shareable link instead, as
  // the full URL text (the rasterized PDF can't carry a clickable link).
  const vidHtml = videos.length
    ? `<div class="vera-pdf-videos"><p style="font-weight:600;margin-bottom:4px">${videos.length > 1 ? 'Videos' : 'Video'} (open to view):</p>${videos.map(u => `<p class="vera-pdf-vidlink">▶ ${u}</p>`).join('')}</div>`
    : ''

  const el = document.createElement('div')
  el.className = 'vera-pdf'
  el.innerHTML = `<style>${PDF_CSS}</style>${bodyHtml}${imgHtml}${vidHtml}`
  el.style.position = 'fixed'
  el.style.left = '-10000px'
  el.style.top = '0'
  document.body.appendChild(el)

  // Wait for images to load (CORS-clean, so html2canvas can rasterize them).
  await Promise.all(Array.from(el.querySelectorAll('img')).map(img =>
    img.complete ? Promise.resolve() : new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res() })
  ))

  try {
    await html2pdf().set({
      margin: [38, 34, 44, 34],
      filename: filename('pdf'),
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { useCORS: true, scale: 2, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    }).from(el).save()
  } finally {
    el.remove()
  }
}
