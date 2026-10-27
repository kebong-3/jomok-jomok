import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { KNOWLEDGE_DOCUMENTS, KNOWLEDGE_MANIFEST, type KnowledgeChunk, type KnowledgeCitation, type KnowledgeRecord } from '@/lib/knowledge';
import citationIndex from '@/data/knowledge/citation-index.json';
import { sha256, type Project } from '@/lib/project';
import { parseProjectBackup, restoreProjectBackup, serializeProjectBackup } from '@/lib/project-transfer';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const compressed = readFileSync('data/knowledge/corpus.json.gz');
const corpus = JSON.parse(gunzipSync(compressed).toString('utf8')) as { version: string; chunks: KnowledgeChunk[] };

function citation(chunkId = 'KB-local-ordinance-2026-p0366-c01'): KnowledgeCitation {
  const chunk = corpus.chunks.find(c => c.id === chunkId);
  if (!chunk) throw new Error(`정본 발췌 없음: ${chunkId}`);
  const doc = KNOWLEDGE_DOCUMENTS.find(d => d.id === chunk.documentId)!;
  return { ...chunk, title: doc.title, edition: doc.edition, sourceUrl: doc.sourceUrl, downloadPath: doc.downloadPath, coverageDate: doc.coverageDate };
}
async function fixture(): Promise<Project> {
  const raw = '제1조(목적) 이 규칙은 기관 업무의 처리 기준을 정한다.\n제2조(위원) 위원의 임기는 3년으로 한다.';
  const knowledge: KnowledgeRecord = {
    role: 'amend_plan', query: '적용례와 경과조치', retrievedAt: '2026-10-24T12:00:00.000Z',
    version: KNOWLEDGE_MANIFEST.version, method: 'hybrid-lexical', status: 'retrieved',
    citations: [citation(), citation('KB-opinion-request-p0001-c01')], note: '입안 참고자료이며 현행 법령 근거와 구별합니다.',
  };
  return {
    id: 'knowledge-roundtrip', createdAt: 1_790_000_000_000, updatedAt: 1_790_000_100_000,
    mode: 'amend', title: '검증 기관 업무 규칙', kind: 'rule', profileId: 'hanbit-city',
    source: { type: 'paste', raw, hash: await sha256(raw) }, intent: '위원 임기 경과조치를 검토한다.',
    spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], knowledge: [knowledge], log: [],
  };
}

// Simulate a file editor who can recompute the outer checksum. The trusted
// citation index must still reject a changed excerpt or page.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
async function resign(project: Project): Promise<string> {
  return JSON.stringify({ format: 'jomokjomok.project', version: 1, exportedAt: 1_790_000_200_000, integrity: { algorithm: 'SHA-256', projectHash: await sha256(canonical(project)) }, project });
}

describe('참고자료 원본·발췌·백업의 정본 대조', () => {
  it('원본 6종의 바이트·SHA-256과 PDF 1,997쪽 manifest를 대조한다', () => {
    expect(KNOWLEDGE_DOCUMENTS).toHaveLength(6);
    expect(KNOWLEDGE_MANIFEST.totalPdfPages).toBe(1997);
    expect(KNOWLEDGE_DOCUMENTS.reduce((sum, doc) => sum + (doc.format === 'pdf' ? (doc.pages ?? 0) : 0), 0)).toBe(1997);
    for (const doc of KNOWLEDGE_DOCUMENTS) {
      const original = readFileSync(`public/references/${doc.fileName}`);
      expect(original.byteLength, doc.id).toBe(doc.bytes);
      expect(digest(original), doc.id).toBe(doc.sha256);
    }
  });

  it('corpus 전체와 모든 발췌의 텍스트·페이지 지문이 정본 색인과 일치한다', () => {
    expect(digest(compressed)).toBe(KNOWLEDGE_MANIFEST.corpusSha256);
    expect(corpus.version).toBe(KNOWLEDGE_MANIFEST.version);
    expect(corpus.chunks).toHaveLength(KNOWLEDGE_MANIFEST.chunkCount);
    expect(new Set(corpus.chunks.map(c => c.id)).size).toBe(corpus.chunks.length);
    expect(Object.keys(citationIndex)).toHaveLength(corpus.chunks.length);
    for (const c of corpus.chunks) {
      expect(digest(c.text), c.id).toBe(c.contentHash);
      expect(digest(JSON.stringify([c.id, c.documentId, c.pdfPage, c.printedPage, c.section, c.sectionType, c.text])), c.id).toBe((citationIndex as Record<string, string>)[c.id]);
    }
  });

  it('PDF와 HWPX 참고 기록을 그대로 보관·읽기·새 작업 복원하며 법령 근거와 합치지 않는다', async () => {
    const original = await fixture();
    const prepared = await parseProjectBackup(await serializeProjectBackup(original));
    expect(prepared.project.knowledge).toEqual(original.knowledge);
    expect(prepared.project.evidence).toEqual([]);
    expect(prepared.project.knowledge?.[0].citations[1].pdfPage).toBeNull();
    const persist = vi.fn(async () => true);
    const restored = await restoreProjectBackup(prepared, {}, persist);
    expect(restored.id).not.toBe(original.id);
    expect(restored.knowledge).toEqual(original.knowledge);
    expect(restored.evidence).toEqual([]);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it.each(['text', 'pdfPage', 'printedPage', 'section', 'sectionType', 'id'] as const)('외부 파일 지문을 다시 계산해도 정본 %s 변조를 거부한다', async field => {
    const project = await fixture();
    const c = project.knowledge![0].citations[0];
    if (field === 'text') { c.text += '\n허구의 면제 규정을 덧붙인다.'; c.contentHash = await sha256(c.text); }
    if (field === 'pdfPage') c.pdfPage = c.pdfPage! + 1;
    if (field === 'printedPage') c.printedPage = '999쪽';
    if (field === 'section') c.section = '위조한 절 제목';
    if (field === 'sectionType') c.sectionType = c.sectionType === 'body' ? 'contents' : 'body';
    if (field === 'id') c.id = 'KB-local-ordinance-2026-p0366-c99';
    const tampered = await resign(project);
    await expect(parseProjectBackup(tampered)).rejects.toThrow('정본 색인');
    await expect(serializeProjectBackup(project)).rejects.toThrow('정본 색인');
  });

  it.each(['sourceUrl', 'downloadPath', 'documentId', 'title', 'edition', 'coverageDate'] as const)('발췌 해시가 같아도 출처 메타데이터 %s 변조를 거부한다', async field => {
    const project = await fixture();
    const c = project.knowledge![0].citations[0];
    if (field === 'sourceUrl') c.sourceUrl = 'https://untrusted.invalid/forged';
    if (field === 'downloadPath') c.downloadPath = '/references/forged.pdf';
    if (field === 'documentId') c.documentId = 'legislation-2026';
    if (field === 'title') c.title = '위조한 자료 제목';
    if (field === 'edition') c.edition = '2099년판';
    if (field === 'coverageDate') c.coverageDate = '2099-12-31';
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('형식이나 허용 범위');
  });

  it('보관파일을 읽은 뒤 발췌 내용을 바꾼 경우 저장 전에 거부한다', async () => {
    const prepared = await parseProjectBackup(await serializeProjectBackup(await fixture()));
    prepared.project.knowledge![0].citations[0].text += '미리보기 이후 조작';
    const persist = vi.fn(async () => true);
    await expect(restoreProjectBackup(prepared, {}, persist)).rejects.toThrow('미리보기 이후');
    expect(persist).not.toHaveBeenCalled();
  });
});
