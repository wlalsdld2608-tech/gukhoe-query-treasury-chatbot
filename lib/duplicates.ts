// Design Ref: §3 화면 구성 ③ — 같거나 아주 비슷한 질의를 찾아 알려 준다. (같은 질의를 두 번 처리하는 실수를 줄이기 위한 표시)
// 두 글자씩 겹쳐 자른 조각이 얼마나 겹치는지(자카드 비율)로 비슷한 정도를 잰다. 외부 호출은 없다.

export type SimilarInput = { index: number; number: string; text: string };

/** 이 값(0~1) 이상 겹치면 비슷한 질의로 본다. 완전히 같은 글은 1이다. */
export const SIMILAR_THRESHOLD = 0.7;

function grams(text: string): Set<string> {
  const set = new Set<string>();
  for (const token of text.toLowerCase().split(/[^0-9a-z가-힣]+/)) {
    for (let i = 0; i + 2 <= token.length; i++) set.add(token.slice(i, i + 2));
  }
  return set;
}

/** 두 조각 모음이 얼마나 겹치는지 (0~1). */
export function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const gram of a) if (b.has(gram)) common += 1;
  return common / (a.size + b.size - common);
}

/**
 * 질의마다 비슷한 다른 질의를 찾아 돌려준다. 결과는 질의의 index를 열쇠로 하고, 값은 비슷한 질의들이다.
 * 비슷한 질의가 없는 질의는 결과에 넣지 않는다.
 */
export function findSimilarQueries(
  items: SimilarInput[],
  threshold: number = SIMILAR_THRESHOLD,
): Record<number, SimilarInput[]> {
  const sets = items.map((item) => grams(item.text));
  const result: Record<number, SimilarInput[]> = {};
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlapRatio(sets[i], sets[j]) >= threshold) {
        (result[items[i].index] ??= []).push(items[j]);
        (result[items[j].index] ??= []).push(items[i]);
      }
    }
  }
  return result;
}
