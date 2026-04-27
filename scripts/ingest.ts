import fs from 'fs/promises'
import path from 'path'
// pdf-parse v2: named export PDFParse, accepts { data: Buffer } or { url: string }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse') as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> } }
import OpenAI from 'openai'
import { createServiceClient } from '../lib/supabase'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type ChunkMetadata = {
  source: string
  section?: string
  benefit_categories: string[]
  state?: string
  eligibility_factors: string[]
  last_updated?: Date
}

export async function readDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') {
    const buffer = await fs.readFile(filePath)
    const parser = new PDFParse({ data: buffer })
    const data = await parser.getText()
    return data.text
  }

  if (ext === '.html') {
    const raw = await fs.readFile(filePath, 'utf-8')
    return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  if (ext === '.txt' || ext === '.md') {
    return fs.readFile(filePath, 'utf-8')
  }

  throw new Error(`Unsupported file extension: ${ext}. Supported: .pdf, .html, .txt, .md`)
}

export function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length)
    chunks.push(words.slice(start, end).join(' '))
    if (end === words.length) break
    start = end - overlap
  }

  return chunks
}

export async function embedChunk(chunk: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: chunk,
    })
    return response.data[0].embedding
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`embedChunk failed: ${msg}`)
  }
}

export async function insertChunk(
  chunk: string,
  embedding: number[],
  metadata: ChunkMetadata
): Promise<void> {
  // SERVICE CLIENT: inserting regulation chunk — trusted ingestion script
  const supabase = createServiceClient()

  const { error } = await supabase.from('regulation_chunks').insert({
    content: chunk,
    embedding,
    source: metadata.source,
    section: metadata.section ?? null,
    benefit_categories: metadata.benefit_categories,
    state: metadata.state ?? null,
    eligibility_factors: metadata.eligibility_factors,
    last_updated: metadata.last_updated ?? null,
  })

  if (error) throw new Error(`insertChunk failed: ${error.message}`)

  const preview = chunk.slice(0, 60).replace(/\n/g, ' ')
  console.log(`[insert] ${metadata.source} — "${preview}..."`)
}

export async function ingestDocument(
  filePath: string,
  metadata: ChunkMetadata
): Promise<void> {
  const text = await readDocument(filePath)
  const chunks = chunkText(text)

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Ingesting [${metadata.source}]: chunk ${i + 1} of ${chunks.length}`)
    const embedding = await embedChunk(chunks[i])
    await insertChunk(chunks[i], embedding, metadata)
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function main() {
  const filePath = process.argv[2]
  const source = process.argv[3]
  const section = process.argv[4] || undefined
  const benefit_categories: string[] = process.argv[5] ? JSON.parse(process.argv[5]) : []
  const eligibility_factors: string[] = process.argv[6] ? JSON.parse(process.argv[6]) : []

  if (!filePath || !source) {
    console.error('Usage: npx ts-node scripts/ingest.ts <filePath> <source> [section] [benefit_categories_json] [eligibility_factors_json]')
    process.exit(1)
  }

  try {
    await ingestDocument(filePath, {
      source,
      section,
      benefit_categories,
      eligibility_factors,
    })
    console.log('Done.')
  } catch (err) {
    console.error('Ingestion failed:', err)
    process.exit(1)
  }
}

main()
