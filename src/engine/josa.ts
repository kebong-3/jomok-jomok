// 조사 처리 — 끝 글자 받침으로 을/를, 이/가, 은/는, 와/과, 으로/로를 고른다(결정론)

const DIGIT_READ: Record<string, string> = {
  '0': '영', '1': '일', '2': '이', '3': '삼', '4': '사', '5': '오', '6': '육', '7': '칠', '8': '팔', '9': '구',
};
// 영문 끝 글자를 읽는 소리 기준(받침 있음: L, M, N, R)
const EN_FINAL: Record<string, 'none' | 'rieul' | 'other'> = {
  l: 'rieul', r: 'rieul', m: 'other', n: 'other',
};

type Final = 'none' | 'rieul' | 'other';

export function finalOf(word: string): Final {
  const s = word.replace(/[\s"'”“’‘」』)\]>.,·ㆍ%]+$/u, '');
  if (!s) return 'none';
  let ch = s[s.length - 1];
  if (/\d/.test(ch)) {
    // 10, 100, 1000 등은 "십·백·천"으로 읽음
    const tail = s.match(/(\d+)$/)![1];
    if (/0000$/.test(tail)) ch = '만';
    else if (/000$/.test(tail)) ch = '천';
    else if (/00$/.test(tail)) ch = '백';
    else if (/0$/.test(tail) && tail.length > 1) ch = '십';
    else ch = DIGIT_READ[ch];
  } else if (/[a-z]/i.test(ch)) {
    return EN_FINAL[ch.toLowerCase()] ?? 'none';
  }
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return 'none';
  const jong = code % 28;
  if (jong === 0) return 'none';
  if (jong === 8) return 'rieul';
  return 'other';
}

export const eulReul = (w: string) => (finalOf(w) === 'none' ? '를' : '을');
export const iGa = (w: string) => (finalOf(w) === 'none' ? '가' : '이');
export const eunNeun = (w: string) => (finalOf(w) === 'none' ? '는' : '은');
export const waGwa = (w: string) => (finalOf(w) === 'none' ? '와' : '과');
/** 받침 없음·ㄹ 받침 → 로, 그 밖 받침 → 으로 */
export const euro = (w: string) => (finalOf(w) === 'other' ? '으로' : '로');
