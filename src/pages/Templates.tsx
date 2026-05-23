import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { ContentBrief } from '../lib/supabase'

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'bg-blue-100 text-blue-700',
  twitter: 'bg-sky-100 text-sky-700',
  instagram: 'bg-pink-100 text-pink-700',
  quora: 'bg-red-100 text-red-700',
  facebook: 'bg-indigo-100 text-indigo-700',
  universal: 'bg-gray-100 text-gray-900',
}

const STARTER_BRIEFS = [
  { platform: 'linkedin', content_type: 'thought_leadership', objective: 'Establish authority with a counterintuitive insight or data point that challenges conventional wisdom', title: 'LinkedIn Insight Post', angle: 'Bold opening → context → 3 key points → takeaway → CTA question', key_messages: ['Challenge the status quo', 'Back with data or real experience', 'Short paragraphs, no fluff'] },
  { platform: 'quora', content_type: 'authority_answer', objective: 'Provide a direct, authoritative answer that demonstrates deep expertise and drives profile traffic', title: 'Quora Authoritative Answer', angle: 'Direct answer first → explanation → real-world example → nuance → summary', key_messages: ['Answer in sentence 1', 'Use specific numbers and examples', 'Acknowledge nuance'] },
  { platform: 'linkedin', content_type: 'story', objective: 'Tell a story that leads to a business lesson, building personal brand and engagement', title: 'LinkedIn Story Post', angle: 'Scene-setting hook → conflict → what happened → lesson → apply this', key_messages: ['Specific scene, not vague', 'Real tension in the middle', 'Practical takeaway at the end'] },
  { platform: 'linkedin', content_type: 'list', objective: 'Share a structured list of insights, tips, or frameworks that drive saves and shares', title: 'LinkedIn List Post', angle: 'Provocative opener → numbered list with short explanations → closing thought', key_messages: ['5–7 items max', 'Each item is actionable', 'Hook must earn the list'] },
]

export default function Templates() {
  const [briefs, setBriefs] = useState<ContentBrief[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ContentBrief | null>(null)
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    supabase.from('content_briefs').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setBriefs(data || []); setLoading(false) })
  }, [])

  async function seedTemplates() {
    setSeeding(true)
    const { data } = await supabase.from('content_briefs').insert(STARTER_BRIEFS).select()
    if (data) setBriefs(prev => [...data, ...prev])
    setSeeding(false)
  }

  return (
    <div className="flex gap-6 h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
            <p className="text-sm text-gray-500 mt-1">Content briefs and frameworks for the KAI agents</p>
          </div>
          {briefs.length === 0 && !loading && (
            <button onClick={seedTemplates} disabled={seeding}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors">
              {seeding ? 'Seeding…' : '✨ Seed Starter Templates'}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading templates…</div>
        ) : briefs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <span className="text-4xl mb-3">📝</span>
            <p className="text-sm mb-4">No templates yet</p>
            <button onClick={seedTemplates} disabled={seeding}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
              {seeding ? 'Seeding…' : '✨ Seed Starter Templates'}
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-4">
            {briefs.map(brief => (
              <div key={brief.id} onClick={() => setSelected(brief)}
                className={`bg-white rounded-2xl border-2 p-5 cursor-pointer transition-all hover:border-gray-300 ${selected?.id === brief.id ? 'border-gray-400' : 'border-transparent'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[brief.platform?.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                    {brief.platform}
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                    {brief.content_type?.replace(/_/g, ' ')}
                  </span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">{brief.title || 'Untitled Brief'}</h3>
                <p className="text-xs text-gray-500 line-clamp-2">{brief.objective}</p>
                {brief.key_messages && brief.key_messages.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {brief.key_messages.slice(0, 2).map((msg, i) => (
                      <span key={i} className="text-xs bg-gray-50 text-gray-700 px-2 py-0.5 rounded-full line-clamp-1 max-w-[120px]">
                        {msg}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="w-80 flex-shrink-0">
        {selected ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Brief Detail</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <div className="flex gap-2 mb-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_COLORS[selected.platform?.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                {selected.platform}
              </span>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                {selected.content_type?.replace(/_/g, ' ')}
              </span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">{selected.title}</h3>
            <div className="mb-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Objective</p>
              <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2">{selected.objective}</p>
            </div>
            {selected.angle && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Angle</p>
                <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2">{selected.angle}</p>
              </div>
            )}
            {selected.key_messages && selected.key_messages.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Key Messages</p>
                <ul className="space-y-1">
                  {selected.key_messages.map((msg, i) => (
                    <li key={i} className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2">· {msg}</li>
                  ))}
                </ul>
              </div>
            )}
            {selected.cta && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">CTA</p>
                <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2">{selected.cta}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center justify-center text-center h-48">
            <span className="text-3xl mb-2">📋</span>
            <p className="text-xs text-gray-400">Select a template to view structure</p>
          </div>
        )}
      </div>
    </div>
  )
}
