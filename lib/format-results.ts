import type { QueryResult } from "@/lib/types";

// Design Ref: §3 화면 구성 ③ — 선택한 질의의 결과를 엑셀·메일에 붙여넣기 좋은 표(탭으로 구분한 글)로 바꾼다.
// 복사만 할 뿐 어디로도 전송하지 않는다. (PRD 6번: 해당 과로의 자동 전달은 만들지 않는다.)

/** 결과 화면에서 직원이 입력·수정한 국회의원 정보. */
export type MemberInfo = { party: string; member: string };

/**
 * 직원이 확정한 소관: 소관과(여러 개 가능, "국고실 아님"도 고를 수 있음), 관련과(여러 개 가능),
 * 직접 적은 글(다른 기관 이첩 등). 셋 다 비어 있으면 확정하지 않은 것이라 추천 그대로다.
 */
export type ConfirmedEntry = { main: string[]; related: string[]; other: string };

/** 직원이 확정한 소관: 질의 번호(index)별. 없으면 추천 그대로다. */
export type Confirmed = Record<number, ConfirmedEntry>;

/** 소관과를 "국고실 아님"으로 확정할 때 쓰는 값. */
export const NOT_TREASURY = "국고실 아님";

export const EMPTY_ENTRY: ConfirmedEntry = { main: [], related: [], other: "" };

/** 아무것도 확정하지 않은 상태인지. */
export function isEntryEmpty(entry: ConfirmedEntry | undefined): boolean {
  return !entry || (entry.main.length === 0 && entry.related.length === 0 && entry.other.trim() === "");
}

/** 확정한 소관을 표의 "소관과" 칸에 들어갈 글로 만든다. 관련과가 있으면 소관과에 (주관)을 붙인다. */
export function entryLabel(entry: ConfirmedEntry): string {
  const hasRelated = entry.related.length > 0;
  const parts = [
    ...entry.main.map((name) => (hasRelated && name !== NOT_TREASURY ? `${name}(주관)` : name)),
    ...entry.related.map((name) => `${name}(관련)`),
    ...(entry.other.trim() !== "" ? [entry.other.trim()] : []),
  ];
  return parts.join(", ");
}

/** 추천 결과를 확정 입력의 시작값으로 바꾼다. (직원이 고쳐 쓰기 쉽게) */
export function entryFromResult(result: QueryResult): ConfirmedEntry {
  if (result.status === "no_basis") return { main: [NOT_TREASURY], related: [], other: "" };
  if (result.status === "ambiguous") return { ...EMPTY_ENTRY };
  return {
    main: result.primary ? [result.primary.department] : [],
    related: result.related.map((c) => c.department),
    other: "",
  };
}

/** 표(복사·엑셀)에 넣을 수 있는 칸. 직원이 목록에서 골라 넣고 뺄 수 있다. */
export type ColumnKey = "number" | "party" | "member" | "text" | "department" | "submitted";

/** 칸의 순서 (고른 칸은 항상 이 순서로 나온다). */
export const COLUMN_KEYS: readonly ColumnKey[] = ["number", "party", "member", "text", "department", "submitted"];

/** 처음에 체크돼 있는 칸. 제출여부는 직원이 필요할 때 체크해서 넣는다. */
export const DEFAULT_COLUMNS: readonly ColumnKey[] = ["number", "party", "member", "text", "department"];

/** 화면에 보이는 칸 이름. */
export const COLUMN_LABELS: Record<ColumnKey, string> = {
  number: "질의 번호",
  party: "소속당",
  member: "국회의원 이름",
  text: "질의 내용",
  department: "소관과",
  submitted: "제출여부",
};

/** 복사 표의 제목 줄 (다섯 칸 모두 고른 경우). */
export const COPY_HEADER = ["질의번호", "국회의원 소속당", "국회의원 성함", "질의내용", "소관과"] as const;
const COPY_LABELS: Record<ColumnKey, string> = {
  number: COPY_HEADER[0],
  party: COPY_HEADER[1],
  member: COPY_HEADER[2],
  text: COPY_HEADER[3],
  department: COPY_HEADER[4],
  submitted: "제출여부",
};

/** 고른 칸만 칸 순서대로 남긴다. */
export function orderColumns(columns: readonly ColumnKey[]): ColumnKey[] {
  return COLUMN_KEYS.filter((key) => columns.includes(key));
}

/** 표 한 칸에 넣을 수 있게 탭·줄바꿈·따옴표를 정리한다. */
function cell(value: string | number): string {
  return String(value).replace(/[\t\r\n]+/g, " ").replace(/"/g, "'").trim();
}

/** 질의별 판정 이름. 화면에 보이는 말과 같게 맞춘다. */
export function statusLabel(result: QueryResult): string {
  if (result.status === "no_basis") return "국고실 아님";
  if (result.status === "ambiguous") return "판단 어려움";
  return result.related.length > 0 ? "여러 과" : "추천";
}

/** 복사 표의 "소관과" 칸에 넣을 글. */
export function departmentLabel(result: QueryResult): string {
  if (result.status === "no_basis") return "국고실 아님";
  if (result.status === "ambiguous") {
    return `판단 어려움 (후보: ${result.candidates.map((c) => c.department).join(" / ")})`;
  }
  const primary = result.primary?.department ?? "";
  if (result.related.length === 0) return primary;
  return [`${primary}(주관)`, ...result.related.map((c) => `${c.department}(관련)`)].join(", ");
}

/** 표의 "소관과" 칸에 넣을 글: 직원이 확정한 값이 있으면 그 값, 없으면 추천 결과. */
export function finalDepartment(result: QueryResult, confirmed: Confirmed = {}): string {
  const chosen = confirmed[result.index];
  return chosen && !isEntryEmpty(chosen) ? entryLabel(chosen) : departmentLabel(result);
}

/**
 * 결과를 탭으로 구분한 표 글로 만든다. 첫 줄은 제목 줄이다.
 * 호출하는 쪽이 복사할 질의만 골라서 넘긴다. `members`는 질의별로 직원이 입력·수정한 의원 정보이고,
 * 없으면 질의 앞머리에서 읽은 값(`result.party`, `result.member`)을 쓴다.
 * 질의번호는 의원실 원본 번호(`result.number`)이고, 소관과는 직원이 확정한 값이 우선한다.
 */
export function resultsToTsv(
  results: QueryResult[],
  members: Record<number, MemberInfo> = {},
  confirmed: Confirmed = {},
  columns: readonly ColumnKey[] = DEFAULT_COLUMNS,
): string {
  const keys = orderColumns(columns);
  const rows = results.map((result) => {
    const info = members[result.index];
    const values: Record<ColumnKey, string> = {
      number: result.number,
      party: info ? info.party : result.party,
      member: info ? info.member : result.member,
      text: result.text,
      department: finalDepartment(result, confirmed),
      submitted: "", // 제출여부는 엑셀에서 직접 적도록 빈 칸으로 둔다.
    };
    return keys.map((key) => values[key]);
  });
  return [keys.map((key) => COPY_LABELS[key]), ...rows].map((row) => row.map(cell).join("\t")).join("\n");
}

/** 빠른 선택칸에서 "상세에서 고른 값(복수·관련과·직접 입력)"을 나타내는 값. */
export const QUICK_CUSTOM = "__custom";

/** 확정 값을 빠른 선택칸의 값으로 바꾼다. 비어 있으면 "", 과 하나만 골랐으면 그 이름, 그 밖에는 QUICK_CUSTOM이다. */
export function quickValue(entry: ConfirmedEntry): string {
  if (isEntryEmpty(entry)) return "";
  if (entry.main.length === 1 && entry.related.length === 0 && entry.other.trim() === "") return entry.main[0];
  return QUICK_CUSTOM;
}

/** 빠른 선택칸에서 고른 값을 확정 값으로 바꾼다. ""이면 확정 취소다. */
export function entryFromQuick(value: string): ConfirmedEntry {
  return value === "" ? { ...EMPTY_ENTRY } : { main: [value], related: [], other: "" };
}
