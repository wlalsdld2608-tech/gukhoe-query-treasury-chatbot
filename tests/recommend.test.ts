import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import duties from "@/data/duties.json";
import testQueries from "@/data/test-queries.json";
import { parseDepartments } from "@/lib/load-duties";
import { createAnalyzer } from "@/lib/recommend";
import { splitQueries } from "@/lib/split-queries";
import type { QueryResult } from "@/lib/types";

// PLAN 성공 기준을 가상 질의 세트(data/test-queries.json, 28건)로 잰다.
// 표의 ‘기준’ 번호는 PLAN.md의 성공 기준 번호와 같다.

const departments = parseDepartments(duties);
const analyze = createAnalyzer(departments);

type Expected = { status: string; primary: string | null; related: string[] };
type TestQuery = { id: string; type: "single" | "multi" | "no_basis"; query: string; expected: Expected };
const queries = testQueries as TestQuery[];

const startedAt = performance.now();
const results = new Map<string, QueryResult>(
  queries.map((q) => [q.id, analyze({ index: 1, text: q.query })]),
);
const elapsedMs = performance.now() - startedAt;

const ofType = (type: TestQuery["type"]) => queries.filter((q) => q.type === type);
const ratio = (hit: number, total: number) => (total === 0 ? 1 : hit / total);

describe("질의 나누기", () => {
  it("번호 13건을 13건으로 나눈다", () => {
    const text = Array.from({ length: 13 }, (_, i) => `${i + 1}. 질의 ${i + 1}번 내용입니다.`).join("\n");
    expect(splitQueries(text)).toHaveLength(13);
  });
});

describe("기준 1: 1순위 추천이 정답과 같은 비율 (95% 이상)", () => {
  it("한 과에 해당하는 질의는 전부 정답이다", () => {
    const single = ofType("single");
    const hit = single.filter((q) => results.get(q.id)?.primary?.department === q.expected.primary).length;
    expect(ratio(hit, single.length)).toBeGreaterThanOrEqual(0.95);
  });

  it("국고실 소관 질의 전체(한 과 + 여러 과)의 1순위 일치율을 기록한다", () => {
    const inside = [...ofType("single"), ...ofType("multi")];
    const hit = inside.filter((q) => results.get(q.id)?.primary?.department === q.expected.primary).length;
    const rate = ratio(hit, inside.length);
    console.info(`[기준 1] 국고실 소관 ${inside.length}건 중 1순위 일치 ${hit}건 (${(rate * 100).toFixed(1)}%)`);
    // 주관 과의 정답은 "질의에서 먼저 언급한 주제의 과"라는 기준으로 붙였다. (lib/recommend.ts의 pickLead와 같은 기준)
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});

describe("기준 2: 여러 과에 걸친 질의에서 관련 과를 빠뜨리지 않는 비율 (90% 이상)", () => {
  it("정답 과(주관 + 관련)가 모두 후보에 들어 있다", () => {
    const multi = ofType("multi");
    const hit = multi.filter((q) => {
      const names = new Set(results.get(q.id)?.candidates.map((c) => c.department));
      return [q.expected.primary, ...q.expected.related].every((name) => name !== null && names.has(name));
    }).length;
    expect(ratio(hit, multi.length)).toBeGreaterThanOrEqual(0.9);
  });
});

describe("기준 3: 응답 10초 이내", () => {
  it("질의 전체가 10초 안에, 질의 1건은 1초 안에 처리된다", () => {
    console.info(`[기준 3] 질의 ${queries.length}건 처리 ${elapsedMs.toFixed(1)}ms`);
    expect(elapsedMs).toBeLessThan(10_000);
    expect(elapsedMs / queries.length).toBeLessThan(1_000);
  });
});

describe("기준 4: 근거 없는 추천 0건", () => {
  it("국고실 아님 질의는 추천 없이 ‘no_basis’로 나온다", () => {
    for (const q of ofType("no_basis")) {
      const r = results.get(q.id);
      expect(r?.status).toBe("no_basis");
      expect(r?.primary).toBeNull();
      expect(r?.candidates).toHaveLength(0);
    }
  });

  it("모든 추천 후보에는 근거(업무명)가 있고 업무분장표에 실제로 있는 업무다", () => {
    const allDuties = new Set(departments.flatMap((d) => d.duties));
    for (const r of results.values()) {
      for (const candidate of r.candidates) {
        expect(candidate.basis).toBeTruthy();
        expect(allDuties.has(candidate.basis)).toBe(true);
      }
    }
  });

  it("후보는 최대 3개다", () => {
    for (const r of results.values()) expect(r.candidates.length).toBeLessThanOrEqual(3);
  });

  it("업무분장표에 과장이 없는 과는 과장 정보를 지어내지 않는다", () => {
    const noHead = departments.find((d) => d.head === null);
    expect(noHead).toBeDefined();
    const r = analyze({
      index: 1,
      text: "지방자치단체와의 국유재산 협력 현황과 국유재산 관련 기관 협의 실적을 제출하시오.",
    });
    expect(r.primary?.department).toBe(noHead?.name);
    expect(r.primary?.head).toBeNull();
  });
});

describe("기준 5: 질의 내용을 외부로 보내는 코드 0건", () => {
  const forbidden = /fetch\(|axios|openai|XMLHttpRequest|WebSocket|https?:\/\//i;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it("서버 쪽 코드(lib, app/api)에 외부 호출이 없다", () => {
    const files = [...sourceFiles("lib"), ...sourceFiles("app/api")];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(forbidden.test(text), `${file}에 외부 호출로 보이는 코드가 있다`).toBe(false);
    }
  });
});

describe("판정 규칙", () => {
  it("1위와 2위가 비슷하면 주관 과를 정하지 않고 판단 어려움으로 둔다", () => {
    const r = analyze({
      index: 1,
      text: "국유재산 제도 개선 방안을 설명하시오.",
    });
    expect(r.status).toBe("ambiguous");
    expect(r.primary).toBeNull();
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("여러 과에 걸친 질의는 주관 과 1개와 관련 과를 나눈다", () => {
    const r = analyze({
      index: 1,
      text: "국유재산 처분 대금이 국가결산 보고서에 어떻게 기록되는지 설명하시오.",
    });
    expect(r.status).toBe("recommended");
    expect(r.primary).not.toBeNull();
    expect(r.related.length).toBeGreaterThanOrEqual(1);
    expect(r.related.map((c) => c.department)).not.toContain(r.primary?.department);
    expect(r.topics.length).toBe(1 + r.related.length);
  });

  it("같은 질의는 언제나 같은 결과가 나온다", () => {
    const text = "국채 이자 상환 부담이 커지는 상황에서 국고 여유자금 운용 계획을 조정할 방안을 설명하시오.";
    expect(analyze({ index: 1, text })).toEqual(analyze({ index: 1, text }));
  });
});
