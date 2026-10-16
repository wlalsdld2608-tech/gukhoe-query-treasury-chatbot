import { describe, expect, it } from "vitest";

import duties from "@/data/duties.json";
import { detectPii } from "@/lib/detect-pii";
import { departmentLabel, resultsToTsv, statusLabel } from "@/lib/format-results";
import { highlightSegments } from "@/lib/highlight";
import { parseDepartments } from "@/lib/load-duties";
import { createAnalyzer } from "@/lib/recommend";
import { parseMemberPrefix, splitQueries } from "@/lib/split-queries";

const analyze = createAnalyzer(parseDepartments(duties));
const run = (text: string) => analyze({ index: 1, text });

describe("1. 동의어: 일상어로 풀어 쓴 질의도 국고실 소관으로 찾는다", () => {
  const cases: [string, string][] = [
    ["정부 금고에 쌓아 둔 돈이 얼마나 되고, 그 돈을 은행에 맡겨 이자를 얼마나 벌었는지 알려 주시오.", "국고총괄과"],
    ["나라가 빚을 내려고 발행하는 채권의 올해 물량이 지난해보다 얼마나 늘었는지 설명하시오.", "국채정책과"],
    ["정부가 주식을 가진 회사들이 올해 배당을 얼마나 냈는지 현황을 제출하시오.", "출자관리과"],
    ["쓰지 않고 놀리는 정부 땅을 민간이 개발하도록 하는 사업이 잘 되고 있는지 보고하시오.", "국유재산개발과"],
    ["관급공사에서 입찰에 참여한 업체가 부당한 행위로 제재를 받은 사례를 설명하시오.", "계약분쟁심사과"],
  ];
  for (const [text, expected] of cases) {
    it(`${expected}: ${text.slice(0, 18)}…`, () => {
      const r = run(text);
      expect(r.status).toBe("recommended");
      expect(r.primary?.department).toBe(expected);
    });
  }

  it("동의어를 늘려도 국고실과 무관한 질의는 국고실 아님으로 남는다", () => {
    for (const text of [
      "학교 급식 단가 인상에 필요한 재원 마련 방안을 제출하시오.",
      "올해 지방교부세 배분 기준과 지자체별 교부 내역을 제출하시오.",
      "최저임금 인상이 소상공인 고용에 미친 영향에 대한 분석 자료를 제출하시오.",
      "항공기 도입 사업의 예산 증액 사유와 방산업체 선정 기준을 설명하시오.",
    ]) {
      expect(run(text).status, text).toBe("no_basis");
    }
  });
});

describe("2. 겹친 단어 강조", () => {
  it("추천 결과에 겹친 글자 조각이 담긴다", () => {
    const r = run("국고 여유자금의 운용 수익률을 제출하시오.");
    expect(r.primary?.hitGrams.length).toBeGreaterThan(0);
  });

  it("겹친 글자만 강조하고 글은 그대로 이어 붙이면 원문과 같다", () => {
    const text = "국고 여유자금의 운용 수익률을 제출하시오.";
    const segments = highlightSegments(text, ["여유", "유자", "자금", "운용"]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    const hit = segments.filter((s) => s.hit).map((s) => s.text);
    expect(hit).toContain("여유자금");
    expect(hit).toContain("운용");
  });

  it("띄어쓰기를 넘어서는 글자 조합은 강조하지 않는다", () => {
    const segments = highlightSegments("국고 금리", ["고금"]);
    expect(segments.every((s) => !s.hit)).toBe(true);
  });

  it("빈 글이나 조각이 없으면 강조 없이 그대로 돌려준다", () => {
    expect(highlightSegments("", ["국고"])).toEqual([]);
    expect(highlightSegments("가나다", [])).toEqual([{ text: "가나다", hit: false }]);
  });
});

describe("3. 결과 복사 (선택한 질의만, 다섯 칸)", () => {
  const NL = "\n";
  const TAB = "\t";
  const text = [
    "1. [국민의힘 홍길동] 국고 여유자금의 운용 수익률을 제출하시오.",
    "2. [더불어민주당/김철수 의원] 학교 급식 단가 인상에 필요한 재원 마련 방안을 제출하시오.",
    "3. 국유재산 제도 개선 방안을 설명하시오.",
    "4. [무소속 이영희] 국유재산 처분 대금이 국가결산 보고서에 어떻게 기록되는지 설명하시오.",
  ].join(NL);
  const results = splitQueries(text).map(analyze);
  const table = (rows: string) => rows.split(NL).map((row) => row.split(TAB));

  it("제목 줄은 질의번호·소속당·성함·질의내용·소관과 다섯 칸뿐이다", () => {
    const rows = table(resultsToTsv(results));
    expect(rows[0]).toEqual(["질의번호", "국회의원 소속당", "국회의원 성함", "질의내용", "소관과"]);
    for (const row of rows) expect(row).toHaveLength(5);
  });

  it("질의 앞의 [소속당 성함]이 소속당·성함 칸으로 들어가고, 질의내용에서는 빠진다", () => {
    const rows = table(resultsToTsv(results));
    expect(rows[1]).toEqual(["1", "국민의힘", "홍길동", "국고 여유자금의 운용 수익률을 제출하시오.", "국고총괄과"]);
    expect(rows[2].slice(1, 3)).toEqual(["더불어민주당", "김철수"]);
    expect(rows[4].slice(1, 3)).toEqual(["무소속", "이영희"]);
  });

  it("선택한 질의만 복사된다", () => {
    const chosen = results.filter((r) => r.index === 1 || r.index === 4);
    const rows = table(resultsToTsv(chosen));
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((row) => row[0])).toEqual(["1", "4"]);
    expect(resultsToTsv(chosen)).not.toContain("학교 급식");
  });

  it("하나도 고르지 않으면 제목 줄만 나온다", () => {
    expect(resultsToTsv([]).split(NL)).toHaveLength(1);
  });

  it("결과 화면에서 직원이 입력·수정한 의원 정보가 앞머리 값보다 우선한다", () => {
    const rows = table(
      resultsToTsv(results.slice(0, 3), {
        1: { party: "국민의힘", member: "박수정" },
        3: { party: "개혁신당", member: "최민수" },
      }),
    );
    expect(rows[1].slice(1, 3)).toEqual(["국민의힘", "박수정"]);
    expect(rows[2].slice(1, 3)).toEqual(["더불어민주당", "김철수"]); // 수정하지 않은 질의는 앞머리 값
    expect(rows[3].slice(1, 3)).toEqual(["개혁신당", "최민수"]);
  });

  it("의원 정보가 없으면 두 칸이 비어 있어도 칸 수는 같다", () => {
    const rows = table(resultsToTsv([run("국고 여유자금 운용 현황을 제출하시오.")]));
    expect(rows[1]).toEqual(["1", "", "", "국고 여유자금 운용 현황을 제출하시오.", "국고총괄과"]);
  });

  it("소관과 칸: 여러 과는 주관·관련, 판단 어려움은 후보, 국고실 아님은 그대로", () => {
    const labels = Object.fromEntries(results.map((r) => [r.index, departmentLabel(r)]));
    expect(labels[2]).toBe("국고실 아님");
    expect(labels[3]).toMatch(/^판단 어려움 \(후보: .+ \/ .+\)$/);
    expect(labels[4]).toMatch(/\(주관\), .+\(관련\)/);
    expect(results.map(statusLabel)).toEqual(["추천", "국고실 아님", "판단 어려움", "여러 과"]);
  });

  it("탭·줄바꿈·따옴표가 들어 있어도 칸이 깨지지 않는다", () => {
    const tricky = resultsToTsv([
      {
        index: 1,
        number: "1",
        text: `a${TAB}b${NL}c "d"`,
        party: `당${TAB}이름`,
        member: `홍${NL}길동`,
        status: "no_basis",
        candidates: [],
        primary: null,
        related: [],
        topics: [],
      },
    ]).split(NL);
    expect(tricky).toHaveLength(2);
    expect(tricky[1].split(TAB)).toHaveLength(5);
    expect(tricky[1]).not.toContain('"');
  });
});

describe("의원 정보 앞머리 읽기", () => {
  it("다양한 적는 방식을 같은 결과로 읽는다", () => {
    expect(parseMemberPrefix("[국민의힘 홍길동] 질의")).toEqual({ party: "국민의힘", member: "홍길동", text: "질의" });
    expect(parseMemberPrefix("[국민의힘/홍길동 의원] 질의")).toEqual({
      party: "국민의힘",
      member: "홍길동",
      text: "질의",
    });
    expect(parseMemberPrefix("[홍길동, 조국혁신당] 질의")).toEqual({
      party: "조국혁신당",
      member: "홍길동",
      text: "질의",
    });
  });

  it("한쪽만 적으면 당 이름이면 소속당, 아니면 성함으로 본다", () => {
    expect(parseMemberPrefix("[무소속] 질의")).toEqual({ party: "무소속", member: "", text: "질의" });
    expect(parseMemberPrefix("[홍길동] 질의")).toEqual({ party: "", member: "홍길동", text: "질의" });
  });

  it("앞머리가 없거나 맨 앞이 아니면 건드리지 않는다", () => {
    expect(parseMemberPrefix("질의 [참고] 내용")).toEqual({ party: "", member: "", text: "질의 [참고] 내용" });
    expect(parseMemberPrefix("국고 여유자금")).toEqual({ party: "", member: "", text: "국고 여유자금" });
  });

  it("앞머리만 있고 질의 내용이 없으면 질의로 세지 않는다", () => {
    expect(splitQueries("1. [국민의힘 홍길동]\n2. 국고 여유자금 운용 현황을 제출하시오.")).toHaveLength(1);
  });

  it("번호 없는 줄도 앞머리를 읽고, 질의 번호는 순서대로 센다", () => {
    const parts = splitQueries("[국민의힘 홍길동] 첫 질의\n[더불어민주당 김철수] 둘째 질의");
    expect(parts.map((p) => p.member)).toEqual(["홍길동", "김철수"]);
    expect(parts.map((p) => p.index)).toEqual([1, 2]);
  });
});

describe("4. 일치도", () => {
  it("일치도는 0~100 사이 정수이고, 업무명이 통째로 들어 있으면 100이다", () => {
    const r = run("국고금 관리 제도 운영 현황을 설명하시오.");
    expect(r.primary?.matchRate).toBe(100);
    for (const c of r.candidates) {
      expect(Number.isInteger(c.matchRate)).toBe(true);
      expect(c.matchRate).toBeGreaterThanOrEqual(0);
      expect(c.matchRate).toBeLessThanOrEqual(100);
    }
  });

  it("업무명 일부만 들어 있으면 일치도가 100보다 낮다", () => {
    const r = run("국유재산 처분 대금이 국가결산 보고서에 어떻게 기록되는지 설명하시오.");
    const rates = r.candidates.map((c) => c.matchRate);
    expect(Math.min(...rates)).toBeLessThan(100);
  });
});

describe("5. 개인정보 감지", () => {
  it("전화번호·휴대전화·이메일·주민등록번호 모양을 종류별 개수로 알려 준다", () => {
    const found = detectPii(
      "연락처 010-1234-5678 와 02-123-4567, 메일 a.b@example.com, 주민번호 900101-1234567 이 적혀 있다.",
    );
    const byLabel = Object.fromEntries(found.map((f) => [f.label, f.count]));
    expect(byLabel["휴대전화 번호"]).toBe(1);
    expect(byLabel["전화번호"]).toBe(1);
    expect(byLabel["이메일 주소"]).toBe(1);
    expect(byLabel["주민등록번호"]).toBe(1);
  });

  it("찾은 값 자체는 결과에 담기지 않는다", () => {
    const found = detectPii("010-1234-5678");
    expect(JSON.stringify(found)).not.toContain("1234");
  });

  it("개인정보가 아닌 숫자(금액·비율·연도)는 감지하지 않는다", () => {
    expect(detectPii("2025회계연도 예산 3.5% 증가, 12,345억 원, 2026.10.15 제출")).toEqual([]);
    expect(detectPii("국유재산 처분 대금이 국가결산에 기록되는지 설명하시오.")).toEqual([]);
  });
});
