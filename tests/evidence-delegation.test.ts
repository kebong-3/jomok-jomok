import { afterEach, describe, expect, it, vi } from 'vitest';
import { gatherEvidence } from '@/lib/evidence';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const answer = (title: string, articles: { label: string; title: string; text: string }[]) => new Response(JSON.stringify({ doc: { id: 'test', title, kind: 'law', url: 'https://www.law.go.kr', effectiveAt: '2026-01-01', articles }, meta: { via: 'live', fetchedAt: '2026-10-23T00:00:00Z' } }), { headers: { 'Content-Type': 'application/json' } });

describe('명시한 위임 조항 우선 수집', () => {
  it('괄호 없는 법령명과 띄어 쓴 조 번호를 정확히 수집한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(answer('지방자치법', [{ label: '제 28 조', title: '조례', text: '법령의 범위에서 그 사무에 관하여 조례를 제정할 수 있다.' }]))));
    const r = await gatherEvidence('', '주민 지원 제도를 만든다.', ['지방자치법 제28조']);
    expect(r.evidence).toHaveLength(1); expect(r.evidence[0].label).toContain('28'); expect(r.notes).toEqual([]);
  });
  it('의도의 키워드가 많은 다른 조항보다 명시한 위임 조항을 포함한다', async () => {
    const related = Array.from({ length: 5 }, (_, i) => ({ label: `제${i + 1}조`, title: '위원회 지원 대상 절차 운영 예산', text: '위원회 지원 대상 절차 운영 예산' }));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(answer('검증법', [...related, { label: '제28조의2', title: '위임', text: '구체적인 사항은 조례로 정한다.' }]))));
    const r = await gatherEvidence('', '위원회 지원 대상 절차 운영 예산', ['검증법 제28조의2']);
    expect(r.evidence).toHaveLength(3); expect(r.evidence.some(item => item.label.includes('제28조의2'))).toBe(true);
  });
  it('자동 발견 법령이 많아도 사용자가 명시한 법령을 조회 범위에 포함한다', async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => { const title = new URL(url, 'https://app.test').searchParams.get('title')!; return Promise.resolve(answer(title, [{ label: '제1조', title: '목적', text: '지원 목적을 정한다.' }])); });
    vi.stubGlobal('fetch', fetcher);
    const r = await gatherEvidence('「가법」 제1조 「나법」 제1조 「다법」 제1조', '지원 목적', ['우선법 제1조']);
    expect(new URL(fetcher.mock.calls[0][0], 'https://app.test').searchParams.get('title')).toBe('우선법');
    expect(r.evidence.some(item => item.label.includes('우선법'))).toBe(true);
    expect(r.notes.join(' ')).toContain('처음 3개'); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
