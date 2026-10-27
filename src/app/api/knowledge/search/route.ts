import { KNOWLEDGE_MANIFEST, type KnowledgeMode } from '@/lib/knowledge';
import { KnowledgeError, searchKnowledge } from '@/server/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Knowledge-Version': KNOWLEDGE_MANIFEST.version };
  try {
    const params = new URL(request.url).searchParams;
    const documents = params.get('documentIds') ?? params.get('documents');
    const result = searchKnowledge(params.get('q') ?? '', {
      documentIds: documents === null ? undefined : documents.split(',').map(v => v.trim()).filter(Boolean),
      kind: params.get('kind') ?? undefined,
      mode: (params.get('mode') ?? undefined) as KnowledgeMode | undefined,
      limit: params.has('limit') ? Number(params.get('limit')) : undefined,
    });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof KnowledgeError) {
      return Response.json({ error: error.message, code: error.code }, {
        status: error.code === 'BAD_QUERY' ? 400 : 503, headers,
      });
    }
    return Response.json({ error: '참고자료 검색을 완료하지 못했습니다. 잠시 후 다시 검색해 주세요.', code: 'CORPUS_UNAVAILABLE' }, { status: 503, headers });
  }
}
