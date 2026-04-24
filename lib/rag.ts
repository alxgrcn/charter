import OpenAI from 'openai'
import { createServiceClient } from './supabase'
import { redact } from './redact'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type RagChunk = {
  content: string
  source: string
  section: string | null
  similarity: number
}

export async function retrieveChunks(
  query: string,
  filters: { benefit_categories?: string[]; state?: string | null },
  topK = 3
): Promise<RagChunk[]> {
  try {
    const embRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })
    const embedding = embRes.data[0].embedding

    // SERVICE CLIENT: RAG retrieval for benefit analysis
    const supabase = createServiceClient()
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: topK,
    })

    if (error) {
      console.error('[rag] match_documents error:', redact({ message: error.message }))
      return []
    }

    return ((data ?? []) as Array<{
      content: string
      source: string
      section: string | null
      similarity: number
    }>).map((row) => ({
      content: row.content,
      source: row.source,
      section: row.section,
      similarity: row.similarity,
    }))
  } catch (err) {
    console.error('[rag] retrieveChunks error:', redact(err instanceof Error ? { message: err.message } : err))
    return []
  }
}
