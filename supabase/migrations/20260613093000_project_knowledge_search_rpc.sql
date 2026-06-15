-- Semantic search over a project's knowledge base (pgvector).
--
-- vera-chat calls rpc('project_knowledge_search', { p_project_id, p_embedding,
-- p_match_count, p_threshold }) on every chat turn to retrieve the client's own
-- knowledge as generation context. The function was referenced but never
-- created, so the call 404'd and VERA silently fell back to plain text search,
-- losing semantic recall. This creates it against the existing
-- project_knowledge.embedding vector(1536) column.
--
-- SECURITY INVOKER (default): when an authenticated user calls it, project_knowledge
-- RLS still scopes results to projects they belong to. vera-chat calls it with the
-- service role, which bypasses RLS as intended.

CREATE OR REPLACE FUNCTION public.project_knowledge_search(
  p_project_id uuid,
  p_embedding vector(1536),
  p_match_count integer DEFAULT 5,
  p_threshold double precision DEFAULT 0.5
)
RETURNS TABLE (title text, excerpt text, similarity double precision, source_kind text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    pk.title,
    left(coalesce(nullif(pk.summary, ''), pk.content, ''), 800) AS excerpt,
    (1 - (pk.embedding <=> p_embedding))::double precision AS similarity,
    coalesce(nullif(pk.source_kind, ''), nullif(pk.kind, ''), 'knowledge') AS source_kind
  FROM public.project_knowledge pk
  WHERE pk.project_id = p_project_id
    AND pk.embedding IS NOT NULL
    AND (1 - (pk.embedding <=> p_embedding)) >= p_threshold
  ORDER BY pk.embedding <=> p_embedding ASC
  LIMIT least(greatest(coalesce(p_match_count, 5), 1), 20);
$$;

GRANT EXECUTE ON FUNCTION public.project_knowledge_search(uuid, vector, integer, double precision)
  TO authenticated, service_role;
