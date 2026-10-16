import type { Confirmed, MemberInfo } from "@/lib/format-results";

// Design Ref: §7 보안·개인정보 — 작업 임시 저장은 직원이 [저장] 버튼을 눌렀을 때만, 이 컴퓨터의 브라우저 안에만 한다.
// 서버로 보내지 않고, 직원이 [지우기]를 누르거나 브라우저 데이터를 지우면 사라진다.

/** 임시 저장하는 작업 내용. */
export type SavedWork = {
  version: 1;
  /** 저장한 시각 (ISO 글) */
  savedAt: string;
  /** 입력칸에 붙여넣었던 질의 전체 글 */
  query: string;
  /** 직원이 입력·수정한 의원 정보 (질의 순서 번호별) */
  members: Record<number, MemberInfo>;
  /** 직원이 확정한 소관과 (질의 순서 번호별) */
  confirmed: Confirmed;
  /** 복사·엑셀에 포함하도록 고른 질의 순서 번호 */
  selected: number[];
};

/** 브라우저 저장소에 쓰는 이름. */
export const SAVED_WORK_KEY = "gukgam-treasury-work-v1";

type Writer = Pick<Storage, "setItem">;
type Reader = Pick<Storage, "getItem">;
type Remover = Pick<Storage, "removeItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 저장 내용이 약속한 모양인지 검사한다. 맞지 않으면 null이다. */
export function parseSavedWork(raw: unknown): SavedWork | null {
  if (!isRecord(raw) || raw.version !== 1) return null;
  if (typeof raw.savedAt !== "string" || typeof raw.query !== "string") return null;
  if (!isRecord(raw.members) || !isRecord(raw.confirmed) || !Array.isArray(raw.selected)) return null;

  const members: Record<number, MemberInfo> = {};
  for (const [key, value] of Object.entries(raw.members)) {
    if (!isRecord(value) || typeof value.party !== "string" || typeof value.member !== "string") return null;
    members[Number(key)] = { party: value.party, member: value.member };
  }
  const confirmed: Confirmed = {};
  for (const [key, value] of Object.entries(raw.confirmed)) {
    if (typeof value === "string") {
      // 예전 저장 형식(과 이름 한 개)도 읽는다.
      if (value.trim() !== "") confirmed[Number(key)] = { main: [value], related: [], other: "" };
      continue;
    }
    if (!isRecord(value) || typeof value.other !== "string") return null;
    const { main, related } = value;
    if (!Array.isArray(main) || !Array.isArray(related)) return null;
    if (![...main, ...related].every((name) => typeof name === "string")) return null;
    confirmed[Number(key)] = { main: main as string[], related: related as string[], other: value.other };
  }
  if (!raw.selected.every((n) => typeof n === "number")) return null;

  return {
    version: 1,
    savedAt: raw.savedAt,
    query: raw.query,
    members,
    confirmed,
    selected: raw.selected as number[],
  };
}

/** 작업을 저장한다. 브라우저가 막으면(개인 정보 보호 모드 등) false를 돌려준다. */
export function saveWork(storage: Writer, work: SavedWork): boolean {
  try {
    storage.setItem(SAVED_WORK_KEY, JSON.stringify(work));
    return true;
  } catch {
    return false;
  }
}

/** 저장한 작업을 불러온다. 없거나 모양이 맞지 않으면 null이다. */
export function loadWork(storage: Reader): SavedWork | null {
  try {
    const text = storage.getItem(SAVED_WORK_KEY);
    if (text === null) return null;
    return parseSavedWork(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 저장한 작업을 지운다. */
export function clearWork(storage: Remover): boolean {
  try {
    storage.removeItem(SAVED_WORK_KEY);
    return true;
  } catch {
    return false;
  }
}
