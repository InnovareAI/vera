import { useState, useEffect } from 'react'
import { airtableFetch, airtableCreate } from '../lib/airtable'

interface Template {
  id: string
  fields: {
    Name?: string
    Platform?: string
    Hook?: string
    Structure?: string
    Example?: string
    Tags?: string
    'Created Time'?: string
  }
}

const PLATFORM_COLORS: Record<string, string> = {
  LinkedIn: 'bg-blue-100 text-blue-700',
  Twitter: 'bg-sky-100 text-sky-700',
  'Twitter/X': 'bg-sky-100 text-sky-700',
  Instagram: 'bg-pink-100 text-pink-700',
  Quora: 'bg-red-100 text-red-700',
  Facebook: 'bg-indigo-100 text-indigo-700',
  Universal: 'bg-violet-100 text-violet-700',
}

const STARTER_TEMPLATES = [
  {
    Name: 'LinkedIn Insight Post',
    Platform: 'LinkedIn',
    Hook: 'Counterintuitive insight or stat that challenges conventional wisdom',
    Structure: '1. Bold opening statement\n2. Context / why this matters\n3. 3 key points (short paragraphs)\n4. Takeaway\n5. CTA question',
    Example: 'Most B2B teams are measuring the wrong thing.\n\nThey track activity (calls made, emails sent) instead of outcomes...',
    Tags: 'thought-leadership,insight,b2b',
  },
  {
    Name: 'Quora Authoritative Answer',
    Platform: 'Quora',
    Hook: 'Direct answer to the question in the first sentence',
    Structure: '1. Direct answer (1 sentence)\n2. Explanation with context\n3. Real-world example or data\n4. Nuance / caveats\n5. Summary',
    Example: 'Yes, AI can replace SDRs — but only the ones who are doing it wrong.\n\nHere\'s the nuance most people miss...',
    Tags: 'quora,answer,authority',
  },
  {
    Name: 'LinkedIn Story Post',
    Platform: 'LinkedIn',
    Hook: 'Personal story or observation that leads to a business lesson',
    Structure: '1. Scene-setting hook\n2. The conflict or challenge\n3. What happened\n4. The lesson\n5. Apply this to your work',
    Example: 'I watched a VP of Sales fire their entire SDR team last quarter.\n\nHe replaced them with one system...',
    Tags: 'story,narrative,linkedin',
  },
]

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedDone, setSeedDone] = useState(false)

  useEffect(() => {
    loadTemplates()
  }, [])

  async function loadTemplates() {
    setLoading(true)
    try {
      const data = await airtableFetch('ContentBriefs', { pageSize: 100 })
      setTemplates(data.records || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function seedTemplates() {
    setSeeding(true)
    try {
      for (const t of STARTER_TEMPLATES) {
        await airtableCreate('ContentBriefs', t)
      }
      setSeedDone(true)
      await loadTemplates()
    } catch (e) {
      console.error(e)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="flex gap-6 h-full">
      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
            <p className="text-sm text-gray-500 mt-1">Content briefs and post frameworks for the AI agents</p>
          </div>
          {templates.length === 0 && !loading && (
            <button
              onClick={seedTemplates}
              disabled={seeding || seedDone}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {seeding ? 'Seeding...' : seedDone ? 'Done!' : '✨ Seed Starter Templates'}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
            Loading templates...
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <span className="text-4xl mb-3">📝</span>
            <p className="text-sm mb-1">No templates yet</p>
            <p className="text-xs mb-4">Add content briefs to guide the AI agents</p>
            <button
              onClick={seedTemplates}
              disabled={seeding}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              {seeding ? 'Seeding...' : '✨ Seed Starter Templates'}
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map(template => (
              <div
                key={template.id}
                onClick={() => setSelectedTemplate(template)}
                className={`bg-white rounded-2xl border-2 p-5 cursor-pointer transition-all hover:border-gray-300 ${
                  selectedTemplate?.id === template.id ? 'border-violet-400' : 'border-transparent'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  {template.fields.Platform && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      PLATFORM_COLORS[template.fields.Platform] || 'bg-gray-100 text-gray-600'
                    }`}>
                      {template.fields.Platform}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-gray-900 mb-1 text-sm">
                  {template.fields.Name || 'Untitled Template'}
                </h3>
                {template.fields.Hook && (
                  <p className="text-xs text-gray-500 line-clamp-2">{template.fields.Hook}</p>
                )}
                {template.fields.Tags && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {template.fields.Tags.split(',').map(tag => (
                      <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                        #{tag.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail */}
      <div className="w-80 flex-shrink-0">
        {selectedTemplate ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sticky top-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Template Detail</h2>
              <button onClick={() => setSelectedTemplate(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>

            {selectedTemplate.fields.Platform && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                PLATFORM_COLORS[selectedTemplate.fields.Platform] || 'bg-gray-100 text-gray-600'
              }`}>
                {selectedTemplate.fields.Platform}
              </span>
            )}

            <h3 className="font-semibold text-gray-900 mt-2 mb-3 text-sm">
              {selectedTemplate.fields.Name}
            </h3>

            {selectedTemplate.fields.Hook && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Hook</p>
                <p className="text-xs text-gray-700 bg-violet-50 rounded-lg p-2">{selectedTemplate.fields.Hook}</p>
              </div>
            )}

            {selectedTemplate.fields.Structure && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Structure</p>
                <pre className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap font-sans">
                  {selectedTemplate.fields.Structure}
                </pre>
              </div>
            )}

            {selectedTemplate.fields.Example && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Example</p>
                <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2 italic line-clamp-4">
                  {selectedTemplate.fields.Example}
                </p>
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
