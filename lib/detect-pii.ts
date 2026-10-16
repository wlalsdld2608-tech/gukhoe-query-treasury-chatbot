// Design Ref: §7 개인정보 — 입력칸에서 개인정보로 보이는 글을 미리 알려 준다.
// 알려 주기만 하고 막지는 않는다. 찾아낸 값 자체는 어디에도 보여 주거나 저장하지 않고, 종류와 개수만 돌려준다.

export type PiiFinding = { label: string; count: number };

const PATTERNS: { label: string; pattern: RegExp }[] = [
  // 주민등록번호 모양: 앞 6자리-뒤 7자리
  { label: "주민등록번호", pattern: /\b\d{6}\s?-\s?[1-8]\d{6}\b/g },
  // 휴대전화: 010-1234-5678 등
  { label: "휴대전화 번호", pattern: /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g },
  // 일반 전화: 02-123-4567, 044-123-4567 등
  { label: "전화번호", pattern: /\b0(?:2|[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g },
  { label: "이메일 주소", pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
];

/** 글에서 개인정보로 보이는 것을 종류별 개수로 알려 준다. 없으면 빈 목록이다. */
export function detectPii(text: string): PiiFinding[] {
  const findings: PiiFinding[] = [];
  for (const { label, pattern } of PATTERNS) {
    const count = (text.match(pattern) ?? []).length;
    if (count > 0) findings.push({ label, count });
  }
  return findings;
}
