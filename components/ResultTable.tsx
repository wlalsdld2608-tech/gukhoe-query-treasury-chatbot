"use client";

import { Fragment, useState } from "react";
import QuickConfirm from "@/components/QuickConfirm";
import ResultItem from "@/components/ResultItem";
import type { SimilarInput } from "@/lib/duplicates";
import {
  departmentLabel,
  entryLabel,
  isEntryEmpty,
  statusLabel,
  type Confirmed,
  type ConfirmedEntry,
  type MemberInfo,
} from "@/lib/format-results";
import { needsReview } from "@/lib/result-views";
import type { QueryResult } from "@/lib/types";

// Design Ref: §3.1-1 표로 보기 — 질의가 많을 때 한 줄에 한 건씩 보고, 소관과·제출여부를 바로 고른다.
// 의원 정보·여러 과·직접 입력 같은 자세한 수정은 [상세]를 눌러 카드로 펼쳐서 한다.

type Props = {
  results: QueryResult[];
  departments: string[];
  selected: Set<number>;
  members: Record<number, MemberInfo>;
  confirmed: Confirmed;
  similar: Record<number, SimilarInput[]>;
  onToggle: (index: number) => void;
  onToggleAll: (on: boolean) => void;
  onMember: (index: number, field: keyof MemberInfo, value: string) => void;
  onConfirm: (index: number, value: ConfirmedEntry) => void;
};

const EMPTY_ENTRY_LIST: SimilarInput[] = [];

function memberText(result: QueryResult, members: Record<number, MemberInfo>): string {
  const info = members[result.index] ?? { party: result.party, member: result.member };
  const text = [info.member.trim(), info.party.trim() ? `(${info.party.trim()})` : ""].filter((p) => p !== "").join(" ");
  return text === "" ? "-" : text;
}

export default function ResultTable({
  results,
  departments,
  selected,
  members,
  confirmed,
  similar,
  onToggle,
  onToggleAll,
  onMember,
  onConfirm,
}: Props) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [wide, setWide] = useState<Set<number>>(new Set());
  const allSelected = results.length > 0 && results.every((r) => selected.has(r.index));

  function flip(setter: React.Dispatch<React.SetStateAction<Set<number>>>, index: number) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto rounded-3xl bg-card shadow-sm">
      <table className="w-full min-w-[1040px] border-collapse text-sm">
        <caption className="sr-only">질의별 추천 결과와 소관과 확정 표</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="w-10 px-3 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => onToggleAll(event.target.checked)}
                aria-label="보이는 질의 모두 선택"
                className="h-4 w-4"
              />
            </th>
            <th scope="col" className="w-14 px-2 py-3">번호</th>
            <th scope="col" className="w-32 px-2 py-3">의원</th>
            <th scope="col" className="min-w-[360px] px-2 py-3">질의</th>
            <th scope="col" className="w-48 px-2 py-3">추천 결과</th>
            <th scope="col" className="w-60 px-2 py-3">소관과 확정</th>
            <th scope="col" className="w-16 px-2 py-3">상세</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => {
            const entry = confirmed[result.index] ?? { main: [], related: [], other: "" };
            const isConfirmed = !isEntryEmpty(entry);
            const review = needsReview(result, confirmed);
            const expanded = open.has(result.index);
            const label = result.number || String(result.index);
            return (
              <Fragment key={result.index}>
                <tr className={`border-b border-line align-top ${review ? "bg-orange-50 dark:bg-orange-950/40" : ""}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(result.index)}
                      onChange={() => onToggle(result.index)}
                      aria-label={`${label}번 질의 복사·엑셀에 포함`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-2 py-3 font-semibold">{result.number || "-"}</td>
                  <td className="px-2 py-3 text-muted">{memberText(result, members)}</td>
                  <td className="px-2 py-3">
                    <p className={`text-base font-semibold leading-relaxed text-foreground ${wide.has(result.index) ? "" : "line-clamp-3"}`}>
                      {result.text}
                    </p>
                    {result.text.length > 90 && (
                      <button
                        type="button"
                        onClick={() => flip(setWide, result.index)}
                        className="mt-0.5 text-xs font-medium text-brand hover:text-brand-hover"
                      >
                        {wide.has(result.index) ? "접기" : "전체 보기"}
                      </button>
                    )}
                    {(similar[result.index] ?? EMPTY_ENTRY_LIST).length > 0 && (
                      <p className="mt-1 text-xs font-medium text-purple-700 dark:text-purple-300">⚠️ 비슷한 질의 있음</p>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <span className="mr-1 rounded-md bg-line px-1.5 py-0.5 text-xs font-semibold text-muted">
                      {statusLabel(result)}
                    </span>
                    <span>{departmentLabel(result)}</span>
                    {result.status === "recommended" && result.primary && result.primary.matchRate < 50 && (
                      <p className="text-xs font-medium text-orange-600 dark:text-orange-300">
                        ⚠️ 일치도 {result.primary.matchRate}%
                      </p>
                    )}
                    {result.status === "no_basis" && result.nearest && (
                      <p className="text-xs font-medium text-orange-600 dark:text-orange-300">
                        🔎 약한 근거: {result.nearest.department}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <QuickConfirm
                      id={`confirm-${result.index}`}
                      label={`${label}번 소관과 확정`}
                      departments={departments}
                      value={entry}
                      recommended={departmentLabel(result)}
                      onChange={(value) => onConfirm(result.index, value)}
                    />
                    {isConfirmed && (
                      <p className="mt-1 text-xs text-muted">확정: {entryLabel(entry)}</p>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      onClick={() => flip(setOpen, result.index)}
                      aria-expanded={expanded}
                      aria-label={`${label}번 상세 ${expanded ? "접기" : "펼치기"}`}
                      className="rounded-lg bg-line px-2 py-1 text-xs font-semibold text-muted hover:bg-subtle/30"
                    >
                      {expanded ? "접기" : "상세"}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-line bg-tint">
                    <td colSpan={7} className="p-3">
                      <ol>
                        <ResultItem
                          result={result}
                          departments={departments}
                          selected={selected.has(result.index)}
                          member={members[result.index] ?? { party: result.party, member: result.member }}
                          confirmed={entry}
                          similar={similar[result.index] ?? EMPTY_ENTRY_LIST}
                          onToggle={() => onToggle(result.index)}
                          onMember={(field, value) => onMember(result.index, field, value)}
                          onConfirm={(value) => onConfirm(result.index, value)}
                          embedded
                        />
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
