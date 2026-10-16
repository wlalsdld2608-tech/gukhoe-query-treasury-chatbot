import type { Department, DepartmentMatch, QueryResult, SplitQuery, TopicLink } from "@/lib/types";

// Design Ref: §4.1 판단 로직 (외부 AI 없이) — a. 정리, b. 맞춤, c. 합산
// 질의 한 건의 글을 업무분장표의 업무명과 비교해 과별 점수를 낸다.
// 순서 정하기·"국고실 아님"·여러 과·판단 어려움 판정은 다음 작업(PLAN 6~9번)에서 이 점수를 받아 처리한다.
// 서버 안에서만 도는 순수 계산이며 외부 호출은 없다.

/** 글에서 "두 글자씩 겹쳐 자른 조각"(예: "국고금" → "국고", "고금")을 뽑는다. 띄어쓰기·기호는 경계로 본다. */
function toGrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const token of text.toLowerCase().split(/[^0-9a-z가-힣]+/)) {
    for (let i = 0; i + 2 <= token.length; i++) {
      grams.add(token.slice(i, i + 2));
    }
  }
  return grams;
}

type DutyEntry = {
  department: Department;
  /** 점수 대상이 되는 업무명 */
  duty: string;
  /** 업무명과 동의어 각각의 글자 조각 모음 */
  variants: Set<string>[];
};

/**
 * 업무분장표로 비교 도구를 만든다. 같은 업무분장표를 여러 질의에 쓰므로 한 번만 만든다.
 * 흔한 글자 조합(여러 업무에 나오는 조각)은 점수를 낮게 매긴다.
 */
export function createMatcher(departments: Department[]) {
  const entries: DutyEntry[] = [];
  for (const department of departments) {
    for (const duty of department.duties) {
      const names = [duty, ...(department.synonyms[duty] ?? [])];
      entries.push({ department, duty, variants: names.map(toGrams) });
    }
  }

  // 조각마다 몇 개의 업무에 나오는지 센다.
  const dutyCount = new Map<string, number>();
  for (const entry of entries) {
    const inThisDuty = new Set<string>();
    for (const variant of entry.variants) for (const gram of variant) inThisDuty.add(gram);
    for (const gram of inThisDuty) dutyCount.set(gram, (dutyCount.get(gram) ?? 0) + 1);
  }

  /** 드문 조각일수록 크고, 여러 업무에 흔한 조각일수록 작은 가중치 */
  function weight(gram: string): number {
    return Math.log(1 + entries.length / (dutyCount.get(gram) ?? 1));
  }

  /**
   * 업무명(또는 동의어) 하나가 질의와 얼마나 맞는지.
   * score = 맞은 가중치 × 업무명을 채운 비율 (순위 계산용)
   * coverage = 업무명의 글자 조각 중 질의에 들어 있는 비율, 0~1 (화면에 보여 주는 일치도용)
   * hits = 질의와 겹친 글자 조각 (화면에서 겹친 단어를 강조하는 데 쓴다)
   */
  function variantScore(
    variant: Set<string>,
    query: Set<string>,
  ): { score: number; coverage: number; hits: string[] } {
    let matched = 0;
    let total = 0;
    const hits: string[] = [];
    for (const gram of variant) {
      const w = weight(gram);
      total += w;
      if (query.has(gram)) {
        matched += w;
        hits.push(gram);
      }
    }
    if (total === 0) return { score: 0, coverage: 0, hits };
    const coverage = matched / total;
    return { score: matched * coverage, coverage, hits };
  }

  /** 질의 한 건의 글을 받아, 점수가 0보다 큰 과를 점수 높은 순으로 돌려준다. */
  return function match(queryText: string): DepartmentMatch[] {
    const query = toGrams(queryText);
    // 과별로: 업무 점수의 합, 그리고 가장 크게 맞은 업무(근거)와 그 업무명의 일치 비율
    const totals = new Map<
      string,
      { entry: DutyEntry; sum: number; bestScore: number; bestDuty: string; bestCoverage: number; bestHits: string[] }
    >();

    for (const entry of entries) {
      // 업무명과 동의어 중 가장 잘 맞는 것을 그 업무의 점수로 쓴다.
      const best = entry.variants
        .map((variant) => variantScore(variant, query))
        .reduce((a, b) => (b.score > a.score ? b : a));
      const dutyScore = best.score;
      if (dutyScore <= 0) continue;

      const name = entry.department.name;
      const current = totals.get(name);
      if (!current) {
        totals.set(name, {
          entry,
          sum: dutyScore,
          bestScore: dutyScore,
          bestDuty: entry.duty,
          bestCoverage: best.coverage,
          bestHits: best.hits,
        });
      } else {
        current.sum += dutyScore;
        if (dutyScore > current.bestScore) {
          current.bestScore = dutyScore;
          current.bestDuty = entry.duty;
          current.bestCoverage = best.coverage;
          current.bestHits = best.hits;
        }
      }
    }

    return [...totals.values()]
      .map(({ entry, sum, bestDuty, bestCoverage, bestHits }) => ({
        department: entry.department.name,
        head: entry.department.head,
        basis: bestDuty,
        score: sum,
        matchRate: Math.round(bestCoverage * 100),
        hitGrams: bestHits,
      }))
      .sort((a, b) => b.score - a.score);
  };
}

/** 추천 후보는 질의 한 건마다 최대 3개까지 보여 준다 (PRD Must 1). */
export const MAX_CANDIDATES = 3;

/**
 * 과별 점수 목록에서 순위 후보를 추린다. (Design Ref: §5.2 `candidates`)
 * 점수가 높은 순으로 최대 `limit`개를 고르고, 점수가 같으면 과 이름순으로 정해 결과가 매번 같게 한다.
 * 각 후보에는 근거(업무명)와 과장 정보가 이미 붙어 있다. 과장 정보가 없으면 `head`가 null이다.
 */
export function rankCandidates(matches: DepartmentMatch[], limit: number = MAX_CANDIDATES): DepartmentMatch[] {
  return [...matches]
    .sort((a, b) => b.score - a.score || a.department.localeCompare(b.department, "ko"))
    .slice(0, Math.max(0, limit))
    .map((candidate) => ({ ...candidate, score: Math.round(candidate.score * 100) / 100 }));
}

// ── 판정 (Design Ref: §4.1 d. 판정) ─────────────────────────

/** 최소 기준: 1위 점수가 이보다 낮으면 국고실 업무와 맞는 근거가 없다고 본다. (가상 질의 세트로 측정해 정한 값) */
export const MIN_SCORE = 4.5;

/** 약한 근거: "국고실 아님"이어도 1위 점수가 이 값 이상이면 가장 가까운 과를 힌트로 보여 주고 직원 재확인 대상으로 둔다. */
export const WEAK_SCORE = MIN_SCORE * 0.4;

/** 최소 격차: 1위와 2위 점수 차이가 1위 점수의 이 비율보다 작으면 주관 과를 정하지 않는다. */
export const MIN_GAP_RATIO = 0.15;

/** 관련 과 기준: 1위가 아닌 과가 1위 점수의 이 비율 이상(그리고 최소 기준 이상)이면 함께 다룰 관련 과로 본다. */
export const RELATED_RATIO = 0.4;

/** 이 과만의 근거 말: 비교하는 다른 과의 근거 말과 겹치지 않는 부분. */
function ownGrams(match: DepartmentMatch, other: DepartmentMatch): string[] {
  return match.hitGrams.filter((gram) => !other.hitGrams.includes(gram));
}

/** 질의 글에서 근거 말이 처음 나오는 위치. 근거 말을 못 찾으면 맨 뒤로 본다. */
function firstPosition(text: string, grams: string[]): number {
  const positions = grams.map((gram) => text.indexOf(gram)).filter((position) => position >= 0);
  return positions.length > 0 ? Math.min(...positions) : Number.POSITIVE_INFINITY;
}

/**
 * 두 과가 질의의 같은 말에 기대고 있는지.
 * 한쪽 근거 말이 다른 쪽에 모두 들어 있으면(예: 국유재산정책과 ⊂ 국유재산조정과) 같은 주제이고,
 * 서로 자기만의 근거 말이 있으면(예: 수의계약 제도 / 계약 분쟁) 다른 주제로 본다.
 */
function sharesTopic(a: DepartmentMatch, b: DepartmentMatch): boolean {
  return ownGrams(a, b).length === 0 || ownGrams(b, a).length === 0;
}

/**
 * 주관 과 규칙: 질의가 서로 다른 주제(근거 말이 겹치지 않는 과)에 걸쳐 있으면, 질의에서 **먼저 언급한 주제**의 과를 주관 과로 한다.
 * 의원 질의는 묻고 싶은 핵심을 앞에 쓰고 덧붙이는 내용을 뒤에 쓰는 경우가 많다는 가정이다. 점수 순서만으로는 가르지 못한다.
 * 기준을 넘은 과가 하나이거나 모두 같은 주제를 두고 겨루면 이 규칙을 쓰지 않고 점수로 판단한다.
 */
function pickLead(text: string, top: DepartmentMatch, contenders: DepartmentMatch[]): DepartmentMatch {
  let lead = top;
  for (const other of contenders) {
    if (other === lead || sharesTopic(lead, other)) continue;
    // 서로 상대와 겹치지 않는 자기만의 근거 말이 질의에서 먼저 나오는 쪽이 앞선다. (같은 말을 같이 쓴 부분은 비교하지 않는다.)
    const leadPosition = firstPosition(text, ownGrams(lead, other));
    const otherPosition = firstPosition(text, ownGrams(other, lead));
    if (otherPosition < leadPosition) lead = other;
  }
  return lead;
}

/** 질의 한 건을 주제 토막(조각)으로 나눈다. 문장 끝, 쉼표, "그리고" 같은 이음말에서 자른다. 소수점·천 단위 쉼표는 자르지 않는다. */
function splitClauses(text: string): string[] {
  return text
    .split(/[?!]\s*|\.(?!\d)\s*|[,，;；](?!\d)\s*|\s(?:그리고|또한|아울러)\s/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/**
 * 업무분장표로 질의 한 건씩 판정하는 도구를 만든다.
 * 판정은 위에서부터 차례로 적용하고 먼저 해당하는 것에서 멈춘다.
 *  1. 국고실 아님(근거 없음): 1위 점수가 최소 기준보다 낮다.
 *  2. 판단 어려움: 1위와 2위가 최소 격차보다 가깝다. (주관 과를 정하지 않고 후보만 보여 준다.)
 *  3. 여러 과: 1위 외에 관련 과 기준을 넘는 과가 있다. (1위가 주관 과, 나머지가 관련 과)
 *  4. 추천: 위 셋에 해당하지 않는다.
 */
export function createAnalyzer(departments: Department[]) {
  const match = createMatcher(departments);

  /** 주제 토막 중 해당 과와 가장 잘 맞는 것을 찾아 연결한다. 맞는 토막이 없으면 질의 전체를 쓴다. */
  function linkTopic(text: string, clauses: string[], department: string): TopicLink {
    let best: { piece: string; score: number } | null = null;
    for (const piece of clauses) {
      const hit = match(piece).find((m) => m.department === department);
      if (hit && (!best || hit.score > best.score)) best = { piece, score: hit.score };
    }
    return { piece: best && best.score >= MIN_SCORE ? best.piece : text, department };
  }

  return function analyze(item: SplitQuery): QueryResult {
    const base = {
      index: item.index,
      number: item.number ?? String(item.index),
      text: item.text,
      party: item.party ?? "",
      member: item.member ?? "",
    };
    const ranked = rankCandidates(match(item.text));
    const top = ranked[0];

    // 1. 국고실 아님 (근거 없음)
    if (!top || top.score < MIN_SCORE) {
      const nearest = top && top.score >= WEAK_SCORE ? top : null;
      return { ...base, status: "no_basis", candidates: [], primary: null, related: [], topics: [], nearest };
    }

    const candidates = ranked.filter((c) => c.score >= MIN_SCORE);
    const second = candidates[1];

    // 2. 판단 어려움: 1위와 2위가 같은 주제를 두고 비슷하게 겨룰 때만이다.
    //    서로 다른 주제에 걸쳐 있으면 아래 3번에서 먼저 언급한 주제의 과를 주관 과로 정한다.
    if (second && (top.score - second.score) / top.score < MIN_GAP_RATIO && sharesTopic(top, second)) {
      return { ...base, status: "ambiguous", candidates, primary: null, related: [], topics: [] };
    }

    // 3. 여러 과 / 4. 추천
    const contenders = candidates.filter((c) => c === top || c.score >= top.score * RELATED_RATIO);
    const lead = pickLead(item.text, top, contenders);
    const related = contenders.filter((c) => c !== lead);
    const clauses = related.length > 0 ? splitClauses(item.text) : [];
    const topics =
      related.length > 0
        ? [lead, ...related].map((c) => linkTopic(item.text, clauses, c.department))
        : [];
    return { ...base, status: "recommended", candidates, primary: lead, related, topics };
  };
}
