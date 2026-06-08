// Selectable-text PDF export. Renders a Vera result's Markdown into real PDF
// primitives via @react-pdf/renderer — so the text is selectable/searchable,
// generated images embed inline, tables render, and links (incl. video links)
// are genuinely clickable. The whole module is lazy-loaded by the caller, so
// react-pdf never weighs down the main bundle.
import { Document, Page, Text, View, Image, Link, StyleSheet, pdf } from '@react-pdf/renderer'
import { marked, type Token, type Tokens } from 'marked'
import type { ReactNode } from 'react'

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 48, fontSize: 11, lineHeight: 1.5, fontFamily: 'Helvetica', color: '#1a1a1a' },
  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 8 },
  h2: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  h3: { fontSize: 12.5, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 5 },
  p: { marginBottom: 8 },
  li: { flexDirection: 'row', marginBottom: 3, paddingLeft: 6 },
  liBullet: { width: 16 },
  liBody: { flex: 1 },
  hr: { borderBottomWidth: 1, borderBottomColor: '#e5e7eb', marginVertical: 10 },
  link: { color: '#2563eb', textDecoration: 'underline' },
  bold: { fontFamily: 'Helvetica-Bold' },
  italic: { fontFamily: 'Helvetica-Oblique' },
  mono: { fontFamily: 'Courier' },
  table: { marginBottom: 10, borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#dcdce0' },
  tr: { flexDirection: 'row' },
  th: { flex: 1, padding: 5, fontSize: 9.5, fontFamily: 'Helvetica-Bold', backgroundColor: '#f3f4f6', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#dcdce0' },
  td: { flex: 1, padding: 5, fontSize: 9.5, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#dcdce0' },
  codeBlock: { backgroundColor: '#f6f7f8', padding: 8, marginBottom: 8, borderRadius: 4 },
  img: { marginVertical: 8, borderRadius: 6 },
  vidLabel: { fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 3 },
})

function inline(tokens?: Token[]): ReactNode[] {
  if (!tokens) return []
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'strong': return <Text key={i} style={s.bold}>{inline((t as Tokens.Strong).tokens)}</Text>
      case 'em': return <Text key={i} style={s.italic}>{inline((t as Tokens.Em).tokens)}</Text>
      case 'del': return <Text key={i}>{inline((t as Tokens.Del).tokens)}</Text>
      case 'codespan': return <Text key={i} style={s.mono}>{(t as Tokens.Codespan).text}</Text>
      case 'link': { const l = t as Tokens.Link; return <Link key={i} src={l.href} style={s.link}>{inline(l.tokens)}</Link> }
      case 'br': return '\n'
      default: return (t as Tokens.Text).text ?? (t as { raw?: string }).raw ?? ''
    }
  })
}

// Pull the inline tokens out of a list item's wrapper block(s).
function itemInline(it: Tokens.ListItem): Token[] {
  return (it.tokens ?? []).flatMap(x => {
    const nested = (x as { tokens?: Token[] }).tokens
    return Array.isArray(nested) ? nested : [x]
  })
}

function block(tok: Token, key: number): ReactNode {
  switch (tok.type) {
    case 'heading': {
      const h = tok as Tokens.Heading
      return <Text key={key} style={h.depth === 1 ? s.h1 : h.depth === 2 ? s.h2 : s.h3}>{inline(h.tokens)}</Text>
    }
    case 'paragraph': return <Text key={key} style={s.p}>{inline((tok as Tokens.Paragraph).tokens)}</Text>
    case 'list': {
      const l = tok as Tokens.List
      const start = Number(l.start) || 1
      return <View key={key} style={{ marginBottom: 8 }}>
        {l.items.map((it, i) => (
          <View key={i} style={s.li} wrap={false}>
            <Text style={s.liBullet}>{l.ordered ? `${start + i}.` : '•'}</Text>
            <Text style={s.liBody}>{inline(itemInline(it))}</Text>
          </View>
        ))}
      </View>
    }
    case 'table': {
      const t = tok as Tokens.Table
      return <View key={key} style={s.table}>
        <View style={s.tr}>{t.header.map((c, i) => <Text key={i} style={s.th}>{inline(c.tokens)}</Text>)}</View>
        {t.rows.map((row, r) => <View key={r} style={s.tr} wrap={false}>{row.map((c, i) => <Text key={i} style={s.td}>{inline(c.tokens)}</Text>)}</View>)}
      </View>
    }
    case 'hr': return <View key={key} style={s.hr} />
    case 'blockquote': return <View key={key} style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#d0d0d5', marginBottom: 8 }}>{(tok as Tokens.Blockquote).tokens.map((t, i) => block(t, i))}</View>
    case 'code': return <View key={key} style={s.codeBlock}><Text style={s.mono}>{(tok as Tokens.Code).text}</Text></View>
    case 'space': return null
    default: { const txt = (tok as { text?: string }).text; return txt ? <Text key={key} style={s.p}>{txt}</Text> : null }
  }
}

function clean(md: string): string { return md.split('\n---\n[The draft currently open')[0].trim() }

export async function downloadPdf(content: string, images: string[] = [], videos: string[] = []): Promise<void> {
  const tokens = marked.lexer(clean(content))
  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        {tokens.map((t, i) => block(t, i))}
        {images.map((u, i) => <Image key={`img-${i}`} src={u} style={s.img} />)}
        {videos.length > 0 && <Text style={s.vidLabel}>{videos.length > 1 ? 'Videos' : 'Video'} (click to open):</Text>}
        {videos.map((u, i) => <Text key={`vid-${i}`} style={{ marginBottom: 3 }}>{'▶ '}<Link src={u} style={s.link}>{u}</Link></Text>)}
      </Page>
    </Document>
  )
  const blob = await pdf(doc).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  a.href = url
  a.download = `vera-${stamp}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
