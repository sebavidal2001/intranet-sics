import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Embedding cache (persists across requests in same Node.js process) ───────

const _embeddingCache = new Map<string, { vector: number[]; ts: number }>();
const EMBED_TTL_MS = 10 * 60 * 1000;

export async function getCachedEmbedding(text: string): Promise<number[]> {
  const key = text.trim();
  const cached = _embeddingCache.get(key);
  if (cached && Date.now() - cached.ts < EMBED_TTL_MS) return cached.vector;
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
  const result = await model.embedContent(key);
  const vector = result.embedding.values;
  _embeddingCache.set(key, { vector, ts: Date.now() });
  return vector;
}
