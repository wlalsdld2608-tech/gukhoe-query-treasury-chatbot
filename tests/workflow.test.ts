import { describe, expect, it } from "vitest";

import duties from "@/data/duties.json";
import { findSimilarQueries } from "@/lib/duplicates";
import { entryFromQuick, entryFromResult, entryLabel, QUICK_CUSTOM, quickValue, finalDepartment, NOT_TREASURY, type ConfirmedEntry, resultsToTsv, type MemberInfo } from "@/lib/format-results";
import { parseDepartments } from "@/lib/load-duties";
import { normalizePastedTable } from "@/lib/paste-table";
import { createAnalyzer } from "@/lib/recommend";
import {
  groupByDepartment,
  groupByMember,
  isChanged,
  isInside,
  matchesTab,
  needsReview,
  NO_MEMBER,
  tabCounts,
  TABS,
  UNDECIDED,
  type ViewState,
} from "@/lib/result-views";
import { clearWork, loadWork, parseSavedWork, saveWork, SAVED_WORK_KEY, type SavedWork } from "@/lib/saved-work";
import { splitQueries } from "@/lib/split-queries";

const departments = parseDepartments(duties);
const analyze = createAnalyzer(departments);
const one = (name: string): ConfirmedEntry => ({ main: [name], related: [], other: "" });
const departmentNames = departments.map((d) => d.name);
const NL = "\n";
const TAB = "\t";

describe("A. 의원실 원본 질의 번호", () => {
  it("입력한 번호가 그대로 질의 번호가 된다 (순서가 달라도, 건너뛰어도)", () => {
    const parts = splitQueries(["7. 국고 여유자금 운용 현황", "12. 국채 발행 계획 수립", "3. 국가결산 보고서 작성"].join(NL));
    expect(parts.map((p) => p.number)).toEqual(["7", "12", "3"]);
    expect(parts.map((p) => p.index)).toEqual([1, 2, 3]); // 화면 안의 순서 번호는 따로 센다
  });

  it("여러 번호 표시(1) (2) ③ 4.)를 숫자로 읽는다", () => {
    const parts = splitQueries(["1) 가나다라", "(2) 마바사아", "③ 자차카타", "4.파하갸냐"].join(NL));
    expect(parts.map((p) => p.number)).toEqual(["1", "2", "3", "4"]);
  });

  it("번호 앞의 안내문은 번호가 비어 있어 다른 질의 번호와 겹치지 않는다", () => {
    const parts = splitQueries(["질의 모음입니다", "1. 국고 여유자금 운용 현황", "2. 국채 발행 계획 수립"].join(NL));
    expect(parts.map((p) => p.number)).toEqual(["", "1", "2"]);
  });

  it("번호 없는 입력은 나뉜 순서를 번호로 쓴다", () => {
    const parts = splitQueries(["국고 여유자금 운용 현황", "", "국채 발행 계획 수립"].join(NL));
    expect(parts.map((p) => p.number)).toEqual(["1", "2"]);
  });

  it("번호 앞머리와 의원 정보를 함께 쓴 질의도 원본 번호를 지킨다", () => {
    const parts = splitQueries("15. [국민의힘 홍길동] 국고 여유자금 운용 현황");
    expect(parts[0]).toMatchObject({ number: "15", party: "국민의힘", member: "홍길동" });
  });

  it("분석 결과에도 원본 번호가 담기고, 번호가 없으면 순서 번호가 담긴다", () => {
    const withNumber = analyze(splitQueries("9. 국고 여유자금 운용 현황을 제출하시오.")[0]);
    expect(withNumber.number).toBe("9");
    expect(analyze({ index: 4, text: "국고 여유자금 운용 현황을 제출하시오." }).number).toBe("4");
  });

  it("복사 표의 질의번호 칸은 원본 번호다", () => {
    const results = splitQueries("5. 국고 여유자금 운용 현황을 제출하시오.\n9. 국채 발행 계획 수립 근거를 설명하시오.").map(analyze);
    const rows = resultsToTsv(results)
      .split(NL)
      .map((row) => row.split(TAB));
    expect(rows.slice(1).map((row) => row[0])).toEqual(["5", "9"]);
  });
});

describe("B. 소관과 직원 확정", () => {
  const result = analyze({ index: 1, text: "국고 여유자금 운용 현황을 제출하시오." });
  const outside = analyze({ index: 2, text: "학교 급식 단가 인상 방안을 제출하시오." });
  const ambiguous = analyze({ index: 3, text: "국유재산 제도 개선 방안을 설명하시오." });

  it("확정하지 않으면 추천 결과가, 확정하면 직원이 고른 과가 소관과로 나온다", () => {
    expect(finalDepartment(result, {})).toBe("국고총괄과");
    expect(finalDepartment(result, { 1: one("국채정책과") })).toBe("국채정책과");
    expect(finalDepartment(result, { 1: { main: [], related: [], other: "   " } })).toBe("국고총괄과");
  });

  it("국고실 아님·판단 어려움 질의도 직원이 과를 정해 확정할 수 있다", () => {
    expect(finalDepartment(outside, {})).toBe("국고실 아님");
    expect(finalDepartment(outside, { 2: one("국고총괄과") })).toBe("국고총괄과");
    expect(finalDepartment(ambiguous, {})).toMatch(/^판단 어려움/);
    expect(finalDepartment(ambiguous, { 3: one("계약정책과") })).toBe("계약정책과");
  });

  it("복사 표의 소관과 칸에 확정한 값이 들어간다", () => {
    const rows = resultsToTsv([result, outside, ambiguous], {}, { 1: one("국채정책과"), 3: one("계약분쟁심사과") })
      .split(NL)
      .map((row) => row.split(TAB));
    expect(rows.slice(1).map((row) => row[4])).toEqual(["국채정책과", "국고실 아님", "계약분쟁심사과"]);
  });

  it("추천과 같은 값으로 확정하면 '바꾼 질의'로 세지 않는다", () => {
    expect(isChanged(result, { 1: one("국고총괄과") })).toBe(false);
    expect(isChanged(result, { 1: one("국채정책과") })).toBe(true);
    expect(isChanged(result, {})).toBe(false);
  });
});

describe("B-2. 소관과 여러 개·관련과·직접 입력", () => {
  const result = analyze({ index: 1, text: "국고 여유자금 운용 현황을 제출하시오." });
  const outside = analyze({ index: 2, text: "학교 급식 단가 인상 방안을 제출하시오." });

  it("소관과를 여러 개 확정하면 쉼표로 이어 나온다", () => {
    const entry = { main: ["국고총괄과", "국채정책과"], related: [], other: "" };
    expect(entryLabel(entry)).toBe("국고총괄과, 국채정책과");
  });

  it("관련과를 함께 고르면 소관과에 (주관), 관련과에 (관련)이 붙는다", () => {
    const entry = { main: ["국고총괄과"], related: ["국채정책과", "출자관리과"], other: "" };
    expect(entryLabel(entry)).toBe("국고총괄과(주관), 국채정책과(관련), 출자관리과(관련)");
    expect(finalDepartment(result, { 1: entry })).toBe(entryLabel(entry));
  });

  it("다른 기관 이첩을 직접 적으면 소관과 칸에 같이 들어간다", () => {
    const entry = { main: ["국고총괄과"], related: [], other: " 한국은행 이첩 " };
    expect(entryLabel(entry)).toBe("국고총괄과, 한국은행 이첩");
    const only = { main: [], related: [], other: "금융위원회 이첩" };
    expect(finalDepartment(outside, { 2: only })).toBe("금융위원회 이첩");
    const rows = resultsToTsv([result], {}, { 1: entry }).split(NL).map((row) => row.split(TAB));
    expect(rows[1][4]).toBe("국고총괄과, 한국은행 이첩");
  });

  it("추천 결과로 시작값을 채울 수 있다", () => {
    expect(entryFromResult(result)).toEqual({ main: ["국고총괄과"], related: [], other: "" });
    expect(entryFromResult(outside)).toEqual({ main: [NOT_TREASURY], related: [], other: "" });
    expect(isChanged(result, { 1: entryFromResult(result) })).toBe(false);
  });

  it("국고실 과가 하나라도 있으면 국고실, 이첩만 적었거나 국고실 아님이면 국고실 아님으로 본다", () => {
    expect(isInside(outside, { 2: { main: [], related: ["국채정책과"], other: "" } })).toBe(true);
    expect(isInside(outside, { 2: { main: [], related: [], other: "한국은행 이첩" } })).toBe(false);
    expect(isInside(result, { 1: one(NOT_TREASURY) })).toBe(false);
  });

  it("옛 저장 형식(과 이름 글자)도 불러온다", () => {
    const old = { version: 1, savedAt: "x", query: "q", members: {}, confirmed: { 1: "국채정책과" }, selected: [] };
    expect(parseSavedWork(old)?.confirmed[1]).toEqual(one("국채정책과"));
    const bad = { ...old, confirmed: { 1: { main: [1], related: [], other: "" } } };
    expect(parseSavedWork(bad)).toBeNull();
  });
});

describe("C. 보기 탭", () => {
  const texts = [
    "[국민의힘 홍길동] 국고 여유자금 운용 현황을 제출하시오.", // 1 국고총괄과
    "[국민의힘 홍길동] 학교 급식 단가 인상 방안을 제출하시오.", // 2 국고실 아님
    "[더불어민주당 김철수] 국유재산 제도 개선 방안을 설명하시오.", // 3 판단 어려움
    "[더불어민주당 김철수] 정부 출자 관련 사항을 제출하시오.", // 4 일치도 낮음
    "국채 발행 계획 수립 근거를 설명하시오.", // 5 의원 정보 없음, 국채정책과
  ];
  const results = splitQueries(texts.map((t, i) => `${i + 1}. ${t}`).join(NL)).map(analyze);
  const members: Record<number, MemberInfo> = Object.fromEntries(
    results.map((r) => [r.index, { party: r.party, member: r.member }]),
  );
  const base = (over: Partial<ViewState> = {}): ViewState => ({
    confirmed: {},
    members,
    selected: new Set(results.map((r) => r.index)),
    ...over,
  });
  const pick = (tab: Parameters<typeof matchesTab>[0], state = base()) =>
    results.filter((r) => matchesTab(tab, r, state)).map((r) => r.index);

  it("전체 / 국고실만 / 판단 어려움만 / 국고실 아님", () => {
    expect(pick("all")).toEqual([1, 2, 3, 4, 5]);
    expect(pick("inside")).toEqual([1, 3, 4, 5]);
    expect(pick("ambiguous")).toEqual([3]);
    expect(pick("outside")).toEqual([2]);
  });

  it("확인 필요: 확정하지 않은 판단 어려움과 일치도 낮은 추천", () => {
    expect(pick("review")).toEqual([3, 4]);
    expect(pick("review", base({ confirmed: { 3: one("계약정책과") } }))).toEqual([4]); // 확정하면 빠진다
    expect(needsReview(results[3], {})).toBe(true);
  });

  it("직원이 확정하면 국고실만/국고실 아님 탭이 확정한 값을 따른다", () => {
    const state = base({ confirmed: { 2: one("국고총괄과"), 1: one(NOT_TREASURY) } });
    expect(isInside(results[0], state.confirmed)).toBe(false);
    expect(pick("inside", state)).toEqual([2, 3, 4, 5]);
    expect(pick("outside", state)).toEqual([1]);
  });

  it("직원이 바꾼 질의 / 선택한 질의", () => {
    expect(pick("changed")).toEqual([]);
    expect(pick("changed", base({ confirmed: { 1: one("국채정책과"), 5: one("국채정책과") } }))).toEqual([1]);
    expect(pick("selected", base({ selected: new Set([2, 4]) }))).toEqual([2, 4]);
  });

  it("탭마다 건수를 센다", () => {
    const counts = tabCounts(results, base({ selected: new Set([1]) }));
    expect(counts.all).toBe(5);
    expect(counts.inside).toBe(4);
    expect(counts.ambiguous).toBe(1);
    expect(counts.outside).toBe(1);
    expect(counts.review).toBe(2);
    expect(counts.selected).toBe(1);
    expect(TABS.map((t) => t.id)).toHaveLength(9);
  });

  it("과별로 묶기: 업무분장표 순서의 과, 판단 어려움, 국고실 아님 순", () => {
    const groups = groupByDepartment(results, {}, departmentNames);
    expect(groups.map((g) => g.key)).toEqual(["국고총괄과", "국채정책과", "출자관리과", UNDECIDED, NOT_TREASURY]);
    expect(groups.find((g) => g.key === "국고총괄과")?.items.map((r) => r.index)).toEqual([1]);
    expect(groups.reduce((sum, g) => sum + g.items.length, 0)).toBe(results.length);
  });

  it("과별로 묶을 때 확정한 값이 우선한다", () => {
    const groups = groupByDepartment(results, { 3: one("계약정책과"), 2: one("국고총괄과") }, departmentNames);
    expect(groups.find((g) => g.key === "국고총괄과")?.items.map((r) => r.index)).toEqual([1, 2]);
    expect(groups.some((g) => g.key === UNDECIDED)).toBe(false);
    expect(groups.some((g) => g.key === NOT_TREASURY)).toBe(false);
  });

  it("의원별로 묶기: 처음 나온 순서, 의원 정보 없음은 맨 뒤", () => {
    const groups = groupByMember(results, members);
    expect(groups.map((g) => g.key)).toEqual(["홍길동 (국민의힘)", "김철수 (더불어민주당)", NO_MEMBER]);
    expect(groups[0].items.map((r) => r.index)).toEqual([1, 2]);
    expect(groups[2].items.map((r) => r.index)).toEqual([5]);
  });

  it("직원이 고친 의원 정보로 묶인다", () => {
    const edited = { ...members, 5: { party: "진보당", member: "정하늘" } };
    const groups = groupByMember(results, edited);
    expect(groups.map((g) => g.key)).toContain("정하늘 (진보당)");
    expect(groups.map((g) => g.key)).not.toContain(NO_MEMBER);
  });
});

describe("D. 비슷한 질의", () => {
  const items = [
    { index: 1, number: "1", text: "국고 여유자금 운용 수익률과 한시적 자금 조달 계획을 제출하시오." },
    { index: 2, number: "2", text: "학교 급식 단가 인상 방안을 제출하시오." },
    { index: 3, number: "3", text: "국고 여유자금 운용 수익률과 한시적 자금 조달 계획을 제출하시오." }, // 1번과 같음
    { index: 4, number: "4", text: "국고 여유자금 운용 수익률과 한시적 자금 조달 계획을 보고하시오." }, // 1번과 비슷함
  ];

  it("같은 질의와 아주 비슷한 질의를 서로 알려 준다", () => {
    const similar = findSimilarQueries(items);
    expect((similar[1] ?? []).map((s) => s.index).sort()).toEqual([3, 4]);
    expect((similar[3] ?? []).map((s) => s.index).sort()).toEqual([1, 4]);
    expect((similar[4] ?? []).map((s) => s.index).sort()).toEqual([1, 3]);
  });

  it("다른 질의는 비슷하다고 하지 않는다", () => {
    const similar = findSimilarQueries(items);
    expect(similar[2]).toBeUndefined();
  });

  it("질의가 하나이거나 비어 있어도 오류 없이 빈 결과다", () => {
    expect(findSimilarQueries([])).toEqual({});
    expect(findSimilarQueries([items[0]])).toEqual({});
    expect(findSimilarQueries([{ index: 1, number: "1", text: "" }, { index: 2, number: "2", text: "" }])).toEqual({});
  });
});

describe("E. 엑셀에서 복사한 표 붙여넣기", () => {
  const table = [
    ["질의번호", "소속당", "국회의원 성함", "질의내용"].join(TAB),
    ["3", "국민의힘", "홍길동", "국고 여유자금 운용 현황을 제출하시오."].join(TAB),
    ["8", "더불어민주당", "김철수", "국채 발행 계획 수립 근거를 설명하시오."].join(TAB),
    ["11", "무소속", "최지우 의원", "수의계약 제도 운영 현황을 보고하시오."].join(TAB),
  ].join(NL);

  it("제목 줄을 건너뛰고 '번호. [소속당 성함] 질의' 모양으로 바꾼다", () => {
    expect(normalizePastedTable(table).split(NL)).toEqual([
      "3. [국민의힘 홍길동] 국고 여유자금 운용 현황을 제출하시오.",
      "8. [더불어민주당 김철수] 국채 발행 계획 수립 근거를 설명하시오.",
      "11. [무소속 최지우] 수의계약 제도 운영 현황을 보고하시오.",
    ]);
  });

  it("질의 나누기가 표의 번호·소속당·성함을 그대로 읽는다", () => {
    const parts = splitQueries(table);
    expect(parts.map((p) => [p.number, p.party, p.member])).toEqual([
      ["3", "국민의힘", "홍길동"],
      ["8", "더불어민주당", "김철수"],
      ["11", "무소속", "최지우"],
    ]);
    expect(parts[0].text).toBe("국고 여유자금 운용 현황을 제출하시오.");
  });

  it("열 순서가 달라도(질의가 앞, 이름이 뒤) 읽는다", () => {
    const row = ["국고 여유자금 운용 현황을 제출하시오.", "홍길동", "국민의힘", "5"].join(TAB);
    expect(normalizePastedTable(row)).toBe("5. [국민의힘 홍길동] 국고 여유자금 운용 현황을 제출하시오.");
  });

  it("번호 열이 없으면 번호 없이 [소속당 성함] 질의로 바꾼다", () => {
    const row = ["국민의힘", "홍길동", "국고 여유자금 운용 현황을 제출하시오."].join(TAB);
    expect(normalizePastedTable(row)).toBe("[국민의힘 홍길동] 국고 여유자금 운용 현황을 제출하시오.");
  });

  it("탭이 없는 일반 글은 그대로 둔다", () => {
    const plain = "1. 국고 여유자금 운용 현황\n2. 국채 발행 계획 수립";
    expect(normalizePastedTable(plain)).toBe(plain);
    expect(normalizePastedTable("")).toBe("");
  });

  it("탭이 일부 줄에만 우연히 있으면 표로 보지 않는다", () => {
    const text = ["1. 가나다라마바", "2. 사아자차카타", "3. 파하" + TAB + "갸냐", "4. 더러머버서어", "5. 저처커터퍼허"].join(NL);
    expect(normalizePastedTable(text)).toBe(text);
  });
});

describe("F. 작업 임시 저장 (브라우저 안에만)", () => {
  const work: SavedWork = {
    version: 1,
    savedAt: "2026-10-15T09:00:00.000Z",
    query: "1. [국민의힘 홍길동] 국고 여유자금 운용 현황을 제출하시오.",
    members: { 1: { party: "국민의힘", member: "홍길동" } },
    confirmed: { 1: one("국채정책과") },
    selected: [1],
  };

  function fakeStorage() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
  }

  it("저장하고 불러오면 같은 내용이 나온다", () => {
    const storage = fakeStorage();
    expect(saveWork(storage, work)).toBe(true);
    expect(storage.data.has(SAVED_WORK_KEY)).toBe(true);
    expect(loadWork(storage)).toEqual(work);
  });

  it("지우면 불러올 것이 없다", () => {
    const storage = fakeStorage();
    saveWork(storage, work);
    expect(clearWork(storage)).toBe(true);
    expect(loadWork(storage)).toBeNull();
  });

  it("저장된 것이 없거나 깨졌거나 모양이 다르면 null이다", () => {
    const storage = fakeStorage();
    expect(loadWork(storage)).toBeNull();
    storage.setItem(SAVED_WORK_KEY, "{깨진 글");
    expect(loadWork(storage)).toBeNull();
    storage.setItem(SAVED_WORK_KEY, JSON.stringify({ ...work, version: 2 }));
    expect(loadWork(storage)).toBeNull();
    expect(parseSavedWork({ ...work, selected: ["a"] })).toBeNull();
    expect(parseSavedWork({ ...work, confirmed: { 1: 5 } })).toBeNull();
    expect(parseSavedWork(null)).toBeNull();
  });

  it("브라우저가 저장을 막아도(용량·개인 정보 보호 모드) 오류 없이 false다", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(saveWork(blocked, work)).toBe(false);
    expect(loadWork(blocked)).toBeNull();
    expect(clearWork(blocked)).toBe(false);
  });
});

describe("D. 비슷한 질의: 서로 다른 질의는 오탐하지 않는다", () => {
  it("정답 포함 질의 세트 20건(모두 서로 다른 질의) 사이에는 비슷한 질의가 없다", async () => {
    const queries = (await import("@/data/test-queries.json")).default as { query: string }[];
    const items = queries.map((q, i) => ({ index: i + 1, number: String(i + 1), text: q.query }));
    expect(findSimilarQueries(items)).toEqual({});
  });
});

describe("G. 대괄호 없이 적은 소속당·성함", () => {
  const read = (text: string) => splitQueries(text)[0];

  it("'소속당 성함 질의' 순서로 적어도 읽는다", () => {
    expect(read("1. 국민의힘 홍길동 국고 여유자금 운용 현황을 제출하시오.")).toMatchObject({
      number: "1",
      party: "국민의힘",
      member: "홍길동",
      text: "국고 여유자금 운용 현황을 제출하시오.",
    });
  });

  it("'의원', 쌍점, 쉼표, 가운뎃점으로 이은 모양도 읽는다", () => {
    expect(read("더불어민주당 김철수 의원: 국채 발행 계획을 설명하시오.")).toMatchObject({ party: "더불어민주당", member: "김철수", text: "국채 발행 계획을 설명하시오." });
    expect(read("조국혁신당/정하늘, 국유재산 매각 현황을 제출하시오.")).toMatchObject({ party: "조국혁신당", member: "정하늘", text: "국유재산 매각 현황을 제출하시오." });
    expect(read("무소속 최지우 의원 수의계약 제도 현황을 제출하시오.")).toMatchObject({ party: "무소속", member: "최지우" });
  });

  it("'성함(소속당) 질의' 모양도 읽는다", () => {
    expect(read("홍길동(국민의힘) 국고 여유자금 운용 현황을 제출하시오.")).toMatchObject({ party: "국민의힘", member: "홍길동", text: "국고 여유자금 운용 현황을 제출하시오." });
  });

  it("대괄호 모양은 전과 똑같이 읽는다", () => {
    expect(read("[국민의힘 홍길동] 국고 여유자금 운용 현황을 제출하시오.")).toMatchObject({ party: "국민의힘", member: "홍길동" });
  });

  it("일반 질의 글을 의원 정보로 잘못 읽지 않는다", () => {
    const texts = [
      "국민의힘 정책위원회가 요구한 국고 여유자금 자료를 제출하시오.",
      "국민의힘 소속 의원들이 요청한 국채 자료를 제출하시오.",
      "국고 여유자금 운용 현황을 제출하시오.",
      "정당 운영 자금 현황을 제출하시오.",
    ];
    for (const text of texts) {
      const part = read(text);
      expect(part.party).toBe("");
      expect(part.member).toBe("");
      expect(part.text).toBe(text);
    }
  });

  it("소속당·성함만 있고 질의 글이 없으면 질의를 버리지 않고 그대로 둔다", () => {
    const part = read("국민의힘 홍길동");
    expect(part.text).toBe("국민의힘 홍길동");
  });
});

describe("H. 국고실 아님 재확인·빠른 선택", () => {
  it("약한 근거가 있는 국고실 아님은 가장 가까운 과를 힌트로 보여 주고 확인 필요로 본다", () => {
    const weak = analyze({ index: 1, text: "국가 재정 운용 전반에 대한 의견을 말하시오." });
    const none = analyze({ index: 2, text: "학교 급식 단가 인상 방안을 제출하시오." });
    for (const r of [weak, none]) expect(r.status).toBe("no_basis");
    expect(none.nearest ?? null).toBeNull();
    expect(needsReview(none, {})).toBe(false);
    if (weak.nearest) {
      expect(needsReview(weak, {})).toBe(true);
      expect(needsReview(weak, { 1: one("국고총괄과") })).toBe(false);
    }
  });

  it("추천 판정 기준(국고실 아님)은 그대로이고, 힌트는 추천 후보에 들어가지 않는다", () => {
    const r = analyze({ index: 1, text: "국가 재정 운용 전반에 대한 의견을 말하시오." });
    expect(r.candidates).toEqual([]);
    expect(r.primary).toBeNull();
  });

  it("빠른 선택칸 값 바꾸기", () => {
    expect(quickValue({ main: [], related: [], other: "" })).toBe("");
    expect(quickValue(one("국채정책과"))).toBe("국채정책과");
    expect(quickValue({ main: ["국채정책과"], related: ["출자관리과"], other: "" })).toBe(QUICK_CUSTOM);
    expect(quickValue({ main: [], related: [], other: "한국은행 이첩" })).toBe(QUICK_CUSTOM);
    expect(entryFromQuick("")).toEqual({ main: [], related: [], other: "" });
    expect(entryFromQuick("국채정책과")).toEqual(one("국채정책과"));
  });
});
