// Renders Vera's assistant messages as formatted markdown (headings, bold,
// lists, GFM tables, links, code) instead of raw text. Styled with the app's
// design tokens so it reads as a document, not a monospace blob.
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CSSProperties, ReactNode } from 'react'
import { color, space, type as t, radius } from '../design'

// If the model wrapped the WHOLE response in a ```markdown … ``` (or ``` … ```)
// fence, unwrap it so it renders as formatted markdown rather than one giant
// code block. Only unwraps when the entire message is a single fence.
function unwrapWholeFence(src: string): string {
  const s = src.trim()
  const m = s.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/)
  return m && !m[1].includes('```') ? m[1] : src
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const heading = (size: number): CSSProperties => ({
  fontFamily: t.family.sans, fontWeight: t.weight.semibold, lineHeight: 1.25,
  color: color.ink, margin: `${space[4]} 0 ${space[2]}`, fontSize: size,
})

const components: Components = {
  h1: ({ children }) => <h1 style={heading(20)}>{children}</h1>,
  h2: ({ children }) => <h2 style={heading(17)}>{children}</h2>,
  h3: ({ children }) => <h3 style={heading(15)}>{children}</h3>,
  h4: ({ children }) => <h4 style={heading(14)}>{children}</h4>,
  p: ({ children }) => <p style={{ margin: `0 0 ${space[3]}` }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: `0 0 ${space[3]}`, paddingLeft: 22 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: `0 0 ${space[3]}`, paddingLeft: 22 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: t.weight.semibold }}>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: color.accent, textDecoration: 'underline' }}>{children}</a>,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${color.line}`, margin: `${space[4]} 0` }} />,
  blockquote: ({ children }) => <blockquote style={{ margin: `0 0 ${space[3]}`, padding: `2px 0 2px ${space[4]}`, borderLeft: `3px solid ${color.line2}`, color: color.ink2 }}>{children}</blockquote>,
  code: ({ children }) => <code style={{ fontFamily: MONO, fontSize: '0.88em', background: color.paper2, padding: '1px 5px', borderRadius: radius.sm }}>{children}</code>,
  pre: ({ children }) => <pre style={{ margin: `0 0 ${space[3]}`, padding: space[3], background: color.paper2, border: `1px solid ${color.line}`, borderRadius: radius.md, overflowX: 'auto', fontSize: t.size.cap, lineHeight: 1.5 }}>{children}</pre>,
  table: ({ children }) => <div style={{ overflowX: 'auto', margin: `0 0 ${space[3]}` }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: t.size.cap }}>{children}</table></div>,
  th: ({ children }) => <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: `2px solid ${color.line}`, fontWeight: t.weight.semibold, background: color.paper2, whiteSpace: 'nowrap' }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: '6px 10px', borderBottom: `1px solid ${color.line}`, verticalAlign: 'top' }}>{children}</td>,
}

export default function Markdown({ content }: { content: string }): ReactNode {
  return (
    <div style={{ fontSize: t.size.lg, lineHeight: 1.6, color: color.ink }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {unwrapWholeFence(content)}
      </ReactMarkdown>
    </div>
  )
}
