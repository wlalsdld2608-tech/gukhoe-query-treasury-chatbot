import {
  departmentLabel,
  finalDepartment,
  isEntryEmpty,
  NOT_TREASURY,
  type Confirmed,
  type ConfirmedEntry,
  type MemberInfo,
} from "@/lib/format-results";
import type { QueryResult } from "@/lib/types";

// Design Ref: §3 화면 구성 ③ — 결과를 탭(보기 방식)별로 걸러 보고, 과별·의원별로 묶어 보기 위한 계산.
// 화면과 따로 두어 시험할 수 있게 했다.

/** 일치도가 이 값(%)보다 낮으면 "직접 확인하세요" 경고를 붙인다. */
export const LOW_MATCH_RATE = 50;

export type TabId =
  | "all"
  | "inside"
  | "ambiguous"
  | "outside"
  | "review"
  | "byDepartment"
  | "byMember"
  | "changed"
  | "selected";

/** 탭 순서와 이름. */
export const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "inside", label: "국고실만 보기" },
  { id: "ambiguous", label: "판단 어려움만 보기" },
  { id: "outside", label: "국고실 아님" },
  { id: "review", label: "확인 필요" },
  { id: "byDepartment", label: "과별로 보기" },
  { id: "byMember", label: "의원별로 보기" },
  { id: "changed", label: "직원이 바꾼 질의" },
  { id: "selected", label: "선택한 질의" },
];

/** 탭 계산에 필요한 화면 상태. */
export type ViewState = {
  confirmed: Confirmed;
  members: Record<number, MemberInfo>;
  selected: Set<number>;
};

/** 직원이 소관과를 확정했는지 (비어 있으면 추천 그대로). */
export function isConfirmed(result: QueryResult, confirmed: Confirmed): boolean {
  return !isEntryEmpty(confirmed[result.index]);
}

/** 직원이 확정한 값이 추천 결과와 다른지. */
export function isChanged(result: QueryResult, confirmed: Confirmed): boolean {
  return isConfirmed(result, confirmed) && finalDepartment(result, confirmed) !== departmentLabel(result);
}

/** 확정한 소관·관련과 중 국고실 과 이름 (국고실 아님·직접 적은 글은 뺀다). */
function confirmedDepartments(entry: ConfirmedEntry): string[] {
  return [...entry.main, ...entry.related].filter((name) => name !== NOT_TREASURY);
}

/** 국고실 소관으로 보는지: 확정한 값이 있으면 국고실 과가 하나라도 들어 있는지, 없으면 추천 결과. */
export function isInside(result: QueryResult, confirmed: Confirmed): boolean {
  if (isConfirmed(result, confirmed)) return confirmedDepartments(confirmed[result.index]).length > 0;
  return result.status !== "no_basis";
}

/** 직원이 한 번 더 확인해야 하는 질의: 아직 확정하지 않은 판단 어려움, 일치도가 낮은 추천, 약한 근거가 있는 "국고실 아님". */
export function needsReview(result: QueryResult, confirmed: Confirmed): boolean {
  if (isConfirmed(result, confirmed)) return false;
  if (result.status === "ambiguous") return true;
  if (result.status === "no_basis") return !!result.nearest;
  return result.status === "recommended" && !!result.primary && result.primary.matchRate < LOW_MATCH_RATE;
}

/** 질의가 이 탭에 보이는지. "과별로 보기"·"의원별로 보기"는 전부 보이고 묶어서만 다르게 보여 준다. */
export function matchesTab(tab: TabId, result: QueryResult, state: ViewState): boolean {
  switch (tab) {
    case "all":
    case "byDepartment":
    case "byMember":
      return true;
    case "inside":
      return isInside(result, state.confirmed);
    case "ambiguous":
      return result.status === "ambiguous";
    case "outside":
      return !isInside(result, state.confirmed);
    case "review":
      return needsReview(result, state.confirmed);
    case "changed":
      return isChanged(result, state.confirmed);
    case "selected":
      return state.selected.has(result.index);
  }
}

/** 탭마다 질의가 몇 건인지. */
export function tabCounts(results: QueryResult[], state: ViewState): Record<TabId, number> {
  const counts = Object.fromEntries(TABS.map((tab) => [tab.id, 0])) as Record<TabId, number>;
  for (const result of results) {
    for (const tab of TABS) {
      if (matchesTab(tab.id, result, state)) counts[tab.id] += 1;
    }
  }
  return counts;
}

/** 묶어 보기에서 한 묶음. */
export type Group = { key: string; title: string; items: QueryResult[] };

/** 판단 어려움이고 아직 확정하지 않은 질의를 묶는 이름. */
export const UNDECIDED = "판단 어려움 (소관과 미확정)";

/** 과별 묶음 이름: 확정한 값이 있으면 그 값, 없으면 추천 결과의 주관 과. */
export function departmentGroupKey(result: QueryResult, confirmed: Confirmed): string {
  if (isConfirmed(result, confirmed)) return confirmedDepartments(confirmed[result.index])[0] ?? NOT_TREASURY;
  if (result.status === "no_basis") return NOT_TREASURY;
  if (result.status === "ambiguous") return UNDECIDED;
  return result.primary ? result.primary.department : UNDECIDED;
}

/** 질의를 소관과별로 묶는다. 업무분장표 순서의 과, 판단 어려움, 국고실 아님 순이고 빈 묶음은 뺀다. */
export function groupByDepartment(results: QueryResult[], confirmed: Confirmed, departments: string[]): Group[] {
  const buckets = new Map<string, QueryResult[]>();
  for (const result of results) {
    const key = departmentGroupKey(result, confirmed);
    buckets.set(key, [...(buckets.get(key) ?? []), result]);
  }
  const order = [...departments, UNDECIDED, NOT_TREASURY];
  const known = order.filter((key) => buckets.has(key));
  const other = [...buckets.keys()].filter((key) => !order.includes(key));
  return [...known, ...other].map((key) => ({ key, title: key, items: buckets.get(key) ?? [] }));
}

/** 의원 묶음 이름. 소속당과 성함 중 있는 것만 붙이고, 둘 다 없으면 "의원 정보 없음". */
export const NO_MEMBER = "의원 정보 없음";

export function memberGroupKey(result: QueryResult, members: Record<number, MemberInfo>): string {
  const info = members[result.index];
  const party = (info ? info.party : result.party).trim();
  const name = (info ? info.member : result.member).trim();
  const title = [name, party ? `(${party})` : ""].filter((part) => part !== "").join(" ");
  return title === "" ? NO_MEMBER : title;
}

/** 질의를 국회의원별로 묶는다. 처음 나온 순서대로 하고 "의원 정보 없음"은 맨 뒤에 둔다. */
export function groupByMember(results: QueryResult[], members: Record<number, MemberInfo>): Group[] {
  const buckets = new Map<string, QueryResult[]>();
  for (const result of results) {
    const key = memberGroupKey(result, members);
    buckets.set(key, [...(buckets.get(key) ?? []), result]);
  }
  const keys = [...buckets.keys()];
  const ordered = [...keys.filter((key) => key !== NO_MEMBER), ...keys.filter((key) => key === NO_MEMBER)];
  return ordered.map((key) => ({ key, title: key, items: buckets.get(key) ?? [] }));
}
