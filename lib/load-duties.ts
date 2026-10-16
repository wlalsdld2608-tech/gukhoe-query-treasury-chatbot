import "server-only";

import rawDuties from "@/data/duties.json";
import type { Department, Head } from "@/lib/types";

// Design Ref: §5.1 업무분장표 — 서버에서만 읽는다 (과장 명단이 브라우저로 내려가지 않게 한다).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseHead(value: unknown, label: string): Head | null {
  if (value === null) return null;
  if (!isRecord(value) || !isNonEmptyString(value.title) || !isNonEmptyString(value.name)) {
    throw new Error(`${label}: head는 null이거나 title·name이 있는 객체여야 합니다.`);
  }
  return { title: value.title, name: value.name };
}

function parseSynonyms(value: unknown, label: string): Record<string, string[]> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`${label}: synonyms는 객체여야 합니다.`);
  }
  const result: Record<string, string[]> = {};
  for (const [duty, words] of Object.entries(value)) {
    if (!Array.isArray(words) || !words.every(isNonEmptyString)) {
      throw new Error(`${label}: synonyms["${duty}"]는 문자열 목록이어야 합니다.`);
    }
    result[duty] = words;
  }
  return result;
}

/** 업무분장표 원본(JSON)이 약속한 모양인지 검사하고 `Department` 목록으로 바꾼다. */
export function parseDepartments(raw: unknown): Department[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("업무분장표가 비어 있거나 목록이 아닙니다.");
  }

  const names = new Set<string>();
  return raw.map((item, index) => {
    const label = `업무분장표 ${index + 1}번째 항목`;
    if (!isRecord(item)) throw new Error(`${label}: 객체여야 합니다.`);
    if (!isNonEmptyString(item.bureau)) throw new Error(`${label}: bureau가 없습니다.`);
    if (!isNonEmptyString(item.name)) throw new Error(`${label}: name이 없습니다.`);
    if (names.has(item.name)) throw new Error(`${label}: 과 이름이 중복됩니다.`);
    names.add(item.name);
    if (!Array.isArray(item.duties) || item.duties.length === 0 || !item.duties.every(isNonEmptyString)) {
      throw new Error(`${label}: duties는 비어 있지 않은 문자열 목록이어야 합니다.`);
    }

    return {
      bureau: item.bureau,
      name: item.name,
      head: parseHead(item.head ?? null, label),
      duties: item.duties,
      synonyms: parseSynonyms(item.synonyms, label),
    };
  });
}

let cached: Department[] | null = null;

/** 국고실 과 목록을 돌려준다. 처음 한 번만 검사하고 이후에는 같은 결과를 쓴다. */
export function getDepartments(): Department[] {
  if (cached === null) {
    cached = parseDepartments(rawDuties);
  }
  return cached;
}
