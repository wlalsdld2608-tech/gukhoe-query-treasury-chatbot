// Design Ref: §3 화면 구성 ③ — 질의 글에서 근거 업무명과 겹친 말을 강조해 보여 주기 위한 계산.
// 판단 로직과 같은 규칙(띄어쓰기·기호는 경계, 두 글자씩 겹쳐 자른 조각)으로 겹친 글자를 찾는다.

export type TextSegment = { text: string; hit: boolean };

const WORD_CHAR = /[0-9a-z가-힣]/;

/** 글을 "겹친 부분"과 "나머지"로 나눈다. `grams`는 두 글자 조각 목록이다. */
export function highlightSegments(text: string, grams: string[]): TextSegment[] {
  if (text.length === 0) return [];
  const set = new Set(grams);
  const marked = new Array<boolean>(text.length).fill(false);
  const lower = text.toLowerCase();

  for (let i = 0; i + 2 <= lower.length; i++) {
    const pair = lower.slice(i, i + 2);
    if (WORD_CHAR.test(pair[0]) && WORD_CHAR.test(pair[1]) && set.has(pair)) {
      marked[i] = true;
      marked[i + 1] = true;
    }
  }

  const segments: TextSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.hit === marked[i]) last.text += text[i];
    else segments.push({ text: text[i], hit: marked[i] });
  }
  return segments;
}
