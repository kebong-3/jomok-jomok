import { NextResponse } from 'next/server';
import { diag } from '@/server/law';
import { availableModels } from '@/server/llm';
import { searchKnowledge } from '@/server/knowledge';
import { KNOWLEDGE_MANIFEST, KNOWLEDGE_DOCUMENTS } from '@/lib/knowledge';
import { version } from '../../../../package.json';
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export async function GET() {
  let referenceReady = false;
  try { referenceReady = searchKnowledge('시행일', { limit: 1 }).hits.length > 0; } catch { /* Separate index health from official-law connectivity. */ }
  const law = await diag();
  return NextResponse.json({
    app: 'jomokjomok',
    version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    region: process.env.VERCEL_REGION ?? 'local',
    law,
    models: availableModels(),
    knowledge: { ok: referenceReady, version: KNOWLEDGE_MANIFEST.version, documents: KNOWLEDGE_DOCUMENTS.length, pages: KNOWLEDGE_MANIFEST.totalPdfPages, chunks: KNOWLEDGE_MANIFEST.chunkCount, method: 'hybrid-lexical' },
  });
}
