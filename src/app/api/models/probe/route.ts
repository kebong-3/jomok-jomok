import { NextResponse } from 'next/server';
import { LlmError, probeModel } from '@/server/llm';
import { errorResponse, userConnection } from '@/server/ai-request';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(req: Request) {
  let modelId: string | undefined;
  const start = Date.now();
  try {
    let body: unknown;
    try { body = await req.json(); } catch { throw new LlmError('BAD_REQUEST', '요청 형식이 맞지 않습니다.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { modelId?: unknown }).modelId !== 'string') throw new LlmError('BAD_REQUEST', '확인할 모델을 선택해 주세요.');
    modelId = (body as { modelId: string }).modelId;
    if (!modelId || modelId.length > 100) throw new LlmError('BAD_REQUEST', '확인할 모델을 선택해 주세요.');
    const result = await probeModel({ modelId, byok: userConnection(req), signal: req.signal });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const { error, status } = errorResponse(e);
    return NextResponse.json({ ok: false, modelId, checkedAt: new Date().toISOString(), latencyMs: Date.now() - start, error }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
