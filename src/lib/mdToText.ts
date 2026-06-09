// Convert Vera's Markdown output into clean, paste-ready PLAIN TEXT that keeps
// bold (as Unicode bold, so it survives in LinkedIn / email / docs that don't
// render Markdown) and removes all Markdown syntax (#, **, *, ---, [](), `).

// Map A-Z / a-z / 0-9 to their mathematical-bold Unicode codepoints.
function boldChar(ch: string): string {
  const c = ch.codePointAt(0)
  if (c === undefined) return ch
  if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + (c - 65))   // A-Z
  if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + (c - 97))  // a-z
  if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ce + (c - 48))   // 0-9
  return ch
}
function toBold(s: string): string {
  return Array.from(s).map(boldChar).join('')
}

// Resolve inline Markdown on a single line.
function inlineFmt(s: string): string {
  // links: [text](url) -> "text (url)"; bare [text] -> "text"
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `${t} (${u})`)
  s = s.replace(/\[([^\]]+)\]/g, '$1')
  // inline code: `x` -> x
  s = s.replace(/`([^`]+)`/g, '$1')
  // bold: **x** / __x__ -> Unicode bold
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => toBold(t))
  s = s.replace(/__([^_]+)__/g, (_m, t) => toBold(t))
  // italic: *x* / _x_ -> strip the markers (bold only, per spec)
  s = s.replace(/(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, '$1')
  s = s.replace(/(?<![A-Za-z0-9_])_([^_]+)_(?![A-Za-z0-9_])/g, '$1')
  return s
}

export function markdownToText(md: string): string {
  const lines = md.split('\n').map(line => {
    // horizontal rule (---, ***, ___) -> blank line
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return ''
    // heading (#, ##, ...) -> bold text, no hashes
    const h = line.match(/^\s*#{1,6}\s+(.*)$/)
    if (h) return toBold(inlineFmt(h[1].trim()))
    // unordered bullet (-, *, +) -> "• "
    const b = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (b) return `${b[1]}• ${inlineFmt(b[2])}`
    // blockquote marker -> strip
    const q = line.match(/^\s*>\s?(.*)$/)
    if (q) return inlineFmt(q[1])
    return inlineFmt(line)
  })
  // collapse 3+ blank lines to a single blank line, trim ends
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
