-- pgvector similarity search for regulation_chunks
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int
)
RETURNS TABLE (
  id                  uuid,
  source              text,
  section             text,
  content             text,
  benefit_categories  text[],
  eligibility_factors text[],
  similarity          float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    source,
    section,
    content,
    benefit_categories,
    eligibility_factors,
    1 - (embedding <=> query_embedding) AS similarity
  FROM regulation_chunks
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
