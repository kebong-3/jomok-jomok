import { NextResponse } from 'next/server';
import { LlmError, runRole } from '@/server/llm';
import { errorResponse, roleRequest, userConnection } from '@/server/ai-request';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(req: Request) {
  try {
    let body: unknown;
    try { body = await req.json(); } catch { throw new LlmError('BAD_REQUEST', '요청 형식이 맞지 않습니다.'); }
    const input = roleRequest(body);
    const byok = userConnection(req);
    if (req.headers.get('accept')?.includes('application/x-ndjson')) {
      const disconnected = new AbortController();
      const signal = AbortSignal.any([req.signal, disconnected.signal]);
      const encoder = new TextEncoder();
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let ended = false;
      const startedAt = Date.now();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: unknown) => {
            if (ended) return;
            try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
            catch { ended = true; disconnected.abort(); }
          };
          send({ type: 'progress', progress: { phase: 'preparing' } });
          // A heartbeat confirms that this server request is alive. It does not
          // claim that the provider has produced any text or finished a stage.
          heartbeat = setInterval(() => send({ type: 'heartbeat', elapsedMs: Date.now() - startedAt }), 10_000);
          void (async () => {
            try {
              const result = await runRole({ ...input, byok, signal, onProgress: progress => send({ type: 'progress', progress }) });
              send({ type: 'result', result });
            } catch (error) { send({ type: 'error', error: errorResponse(error).error }); }
            finally {
              if (heartbeat) clearInterval(heartbeat);
              if (!ended) { ended = true; controller.close(); }
            }
          })();
        },
        cancel() { ended = true; if (heartbeat) clearInterval(heartbeat); disconnected.abort(); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
    }
    const result = await runRole({ ...input, byok, signal: req.signal });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const { error, status } = errorResponse(e);
    return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
