"use client";

import { useEffect, useMemo, useState } from "react";
import ResultItem from "@/components/ResultItem";
import ResultTable from "@/components/ResultTable";
import { findSimilarQueries } from "@/lib/duplicates";
import { DEFAULT_EVENT_KIND, downloadExcel, EVENT_KINDS, toExportRows } from "@/lib/export-excel";
import {
  entryFromQuick,
  entryFromResult,
  isEntryEmpty,
  NOT_TREASURY,
  COLUMN_KEYS,
  COLUMN_LABELS,
  EMPTY_ENTRY,
  orderColumns,
  resultsToTsv,
  type ColumnKey,
  type Confirmed,
  type ConfirmedEntry,
  type MemberInfo,
} from "@/lib/format-results";
import {
  groupByDepartment,
  groupByMember,
  isChanged,
  isInside,
  matchesTab,
  tabCounts,
  TABS,
  type Group,
  type TabId,
} from "@/lib/result-views";
import type { QueryResult } from "@/lib/types";

// Design Ref: §3 화면 구성 ③ 결과 영역 — 요약, 보기 탭, 선택·복사·엑셀, 질의별 카드

/** 임시 저장에서 불러온 작업 상태 (없으면 처음 상태로 시작한다). */
export type RestoredState = {
  members: Record<number, MemberInfo>;
  confirmed: Confirmed;
  selected: number[];
};

type Props = {
  results: QueryResult[];
  /** 국고실 과 이름 목록 (소관과 선택 칸에 쓴다) */
  departments: string[];
  /** 임시 저장에서 불러온 상태 */
  restored?: RestoredState;
  /** 직원이 고친 내용(확정·제출여부·의원 정보)이 있는지 알려 준다. 다시 찾기 전에 경고하는 데 쓴다. */
  onDirtyChange?: (dirty: boolean) => void;
  /** [작업 임시 저장]을 눌렀을 때 현재 상태를 넘긴다. 저장에 성공했으면 true를 돌려준다. */
  onSaveWork?: (state: RestoredState) => boolean;
};

/** 클립보드에 글을 복사한다. 브라우저가 막으면 옛 방식으로 한 번 더 시도한다. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function initialMembers(results: QueryResult[], restored?: RestoredState): Record<number, MemberInfo> {
  return Object.fromEntries(
    results.map((r) => [r.index, restored?.members[r.index] ?? { party: r.party, member: r.member }]),
  );
}

export default function ResultView({ results, departments, restored, onSaveWork, onDirtyChange }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const [excelState, setExcelState] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [saveState, setSaveState] = useState<"idle" | "done" | "failed">("idle");
  const [tab, setTab] = useState<TabId>("all");
  // 보기 방식: 질의가 많으면(10건 이상) 표로, 적으면 카드로 시작한다.
  const [mode, setMode] = useState<"card" | "table">(results.length >= 10 ? "table" : "card");
  // 일괄 적용에 쓸 값
  const [bulkDept, setBulkDept] = useState("__none");
  const [bulkMessage, setBulkMessage] = useState("");
  // 복사·엑셀 표에 넣을 칸 (처음에는 다섯 칸 모두)
  // 질의가 들어온 자리 (엑셀 제목에 들어간다)
  const [eventKind, setEventKind] = useState<string>(DEFAULT_EVENT_KIND);
  const [customKind, setCustomKind] = useState("");
  const kindName = eventKind === "__custom" ? customKind : eventKind;
  const [columns, setColumns] = useState<ColumnKey[]>([...COLUMN_KEYS]);

  // 복사·엑셀에 포함할 질의 (처음에는 전부 선택, 불러온 작업이면 그때 고른 것)
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(restored ? restored.selected : results.map((r) => r.index)),
  );
  // 직원이 입력·수정한 국회의원 정보 (처음에는 질의 앞머리 `[소속당 성함]`에서 읽은 값)
  const [members, setMembers] = useState<Record<number, MemberInfo>>(() => initialMembers(results, restored));
  // 직원이 확정한 소관과 (없으면 추천 그대로)
  const [confirmed, setConfirmed] = useState<Confirmed>(() => restored?.confirmed ?? {});


  const state = { confirmed, members, selected };
  const counts = tabCounts(results, state);
  // 직원이 확정을 고치는 중인 카드는 탭 조건에서 벗어나도 탭을 바꿀 때까지 그 자리에 둔다. (관련과·직접 입력을 이어서 고르게)
  const [pinned, setPinned] = useState<Set<number>>(new Set());
  const visible = results.filter((r) => matchesTab(tab, r, state) || pinned.has(r.index));
  const similar = useMemo(
    () => findSimilarQueries(results.map((r) => ({ index: r.index, number: r.number, text: r.text }))),
    [results],
  );

  const total = results.length;
  const outside = results.filter((r) => !isInside(r, confirmed)).length;
  const ambiguous = results.filter((r) => r.status === "ambiguous").length;
  const inside = total - outside;
  const changed = results.filter((r) => isChanged(r, confirmed)).length;
  const similarCount = Object.keys(similar).length;
  const anyHighlight = results.some((r) => {
    const shown = r.status === "recommended" ? [r.primary, ...r.related] : r.candidates;
    return shown.some((match) => match && match.hitGrams.length > 0);
  });

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visible) {
        if (on) next.add(r.index);
        else next.delete(r.index);
      }
      return next;
    });
  }

  function updateMember(index: number, field: keyof MemberInfo, value: string) {
    setMembers((prev) => ({ ...prev, [index]: { ...prev[index], [field]: value } }));
  }

  // 직원이 고친 내용이 있으면 부모에게 알린다. (다시 찾기·불러오기 전에 경고하기 위해)
  const dirty =
    Object.values(confirmed).some((entry) => !isEntryEmpty(entry)) ||
    results.some((r) => {
      const info = members[r.index];
      return !!info && (info.party !== r.party || info.member !== r.member);
    });
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /** 선택한 질의에 소관과 확정·제출여부를 한꺼번에 적용한다. */
  function applyBulk() {
    const targets = results.filter((r) => selected.has(r.index));
    if (targets.length === 0 || bulkDept === "__none") return;
    {
      setConfirmed((prev) => {
        const next = { ...prev };
        for (const r of targets) {
          if (bulkDept === "__fill") next[r.index] = entryFromResult(r);
          else if (bulkDept === "__clear") next[r.index] = { ...EMPTY_ENTRY };
          else next[r.index] = entryFromQuick(bulkDept);
        }
        return next;
      });
    }
    setPinned((prev) => new Set([...prev, ...targets.map((r) => r.index)]));
    setBulkMessage(`선택한 ${targets.length}건에 적용했습니다.`);
    window.setTimeout(() => setBulkMessage(""), 4000);
  }

  function changeTab(next: TabId) {
    setPinned(new Set());
    setTab(next);
  }

  function updateConfirmed(index: number, value: ConfirmedEntry) {
    setPinned((prev) => (prev.has(index) ? prev : new Set(prev).add(index)));
    setConfirmed((prev) => ({ ...prev, [index]: value }));
  }

  const chosen = () => results.filter((r) => selected.has(r.index));

  async function handleExcel() {
    // 선택한 질의만, 제목 + 표(질의 번호·소속당·국회의원 이름·질의 내용·소관과)로 엑셀 파일을 만들어 바로 받는다.
    setExcelState("working");
    try {
      await downloadExcel(toExportRows(chosen(), members, confirmed), new Date(), columns, kindName);
      setExcelState("done");
    } catch {
      setExcelState("failed");
    }
    window.setTimeout(() => setExcelState("idle"), 4000);
  }

  async function handleCopy() {
    // 선택한 질의만, 질의번호·소속당·성함·질의내용·소관과 다섯 칸으로 복사한다.
    const ok = await copyText(resultsToTsv(chosen(), members, confirmed, columns));
    setCopyState(ok ? "done" : "failed");
    window.setTimeout(() => setCopyState("idle"), 3000);
  }

  function toggleColumn(key: ColumnKey) {
    setColumns((prev) => orderColumns(prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function handleSave() {
    const ok = onSaveWork ? onSaveWork({ members, confirmed, selected: [...selected] }) : false;
    setSaveState(ok ? "done" : "failed");
    window.setTimeout(() => setSaveState("idle"), 4000);
  }

  function renderItem(result: QueryResult) {
    return (
      <ResultItem
        key={result.index}
        result={result}
        departments={departments}
        selected={selected.has(result.index)}
        member={members[result.index] ?? { party: result.party, member: result.member }}
        confirmed={confirmed[result.index] ?? EMPTY_ENTRY}
        similar={similar[result.index] ?? []}
        onToggle={() => toggle(result.index)}
        onMember={(field, value) => updateMember(result.index, field, value)}
        onConfirm={(value) => updateConfirmed(result.index, value)}
      />
    );
  }

  function renderTable(items: QueryResult[]) {
    return (
      <ResultTable
        results={items}
        departments={departments}
        selected={selected}
        members={members}
        confirmed={confirmed}
        similar={similar}
        onToggle={toggle}
        onToggleAll={selectVisible}
        onMember={updateMember}
        onConfirm={updateConfirmed}
      />
    );
  }

  function renderGroups(groups: Group[]) {
    return (
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.title} className="flex flex-col gap-2">
            <h3 className="pb-1 text-lg font-bold">
              {group.title} <span className="text-sm font-normal text-subtle">({group.items.length}건)</span>
            </h3>
            {mode === "table" ? renderTable(group.items) : <ol className="flex flex-col gap-3">{group.items.map(renderItem)}</ol>}
          </section>
        ))}
      </div>
    );
  }

  let body;
  if (visible.length === 0) {
    body = <p className="rounded-3xl bg-card p-6 text-center text-sm text-subtle">이 보기에 해당하는 질의가 없습니다.</p>;
  } else if (tab === "byDepartment") {
    body = renderGroups(groupByDepartment(visible, confirmed, departments));
  } else if (tab === "byMember") {
    body = renderGroups(groupByMember(visible, members));
  } else if (mode === "table") {
    body = renderTable(visible);
  } else {
    body = <ol className="flex flex-col gap-3">{visible.map(renderItem)}</ol>;
  }

  return (
    <section aria-label="추천 결과" className="flex flex-col gap-4">
      <div
        role="status"
        className="rounded-3xl bg-brand-soft px-5 py-4 text-lg font-bold text-brand"
      >
        <p>
          질의 {total}건 중 국고실 {inside}건
          {ambiguous > 0 && ` (그중 판단 어려움 ${ambiguous}건)`}, 국고실 아님 {outside}건
        </p>
        {(changed > 0 || similarCount > 0) && (
          <p className="mt-1 text-sm font-normal">
            {changed > 0 && `직원이 추천과 다르게 확정한 질의 ${changed}건`}
            {changed > 0 && similarCount > 0 && " · "}
            {similarCount > 0 && `비슷한 질의가 있는 질의 ${similarCount}건`}
          </p>
        )}
      </div>

      <div role="tablist" aria-label="보기 방식" className="flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => changeTab(item.id)}
            className={
              tab === item.id
                ? "rounded-full bg-foreground px-4 py-1.5 text-sm font-semibold text-background"
                : "rounded-full bg-card px-4 py-1.5 text-sm font-medium text-muted hover:bg-line"
            }
          >
            {item.label} {counts[item.id]}
          </button>
        ))}
      </div>

      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <legend className="mb-1 text-xs font-semibold text-muted">
          복사·엑셀에 넣을 칸 (체크한 칸만 표에 들어갑니다)
        </legend>
        {COLUMN_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={columns.includes(key)}
              onChange={() => toggleColumn(key)}
              className="h-4 w-4"
            />
            {COLUMN_LABELS[key]}
          </label>
        ))}
        {columns.length === 0 && <span className="text-orange-700">칸을 하나 이상 고르세요.</span>}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-semibold text-muted">보기 방식</span>
        {(["table", "card"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={
              mode === m
                ? "rounded-full bg-foreground px-4 py-1.5 text-sm font-semibold text-background"
                : "rounded-full bg-card px-4 py-1.5 text-sm font-medium text-muted hover:bg-line"
            }
          >
            {m === "table" ? "표로 보기" : "카드로 보기"}
          </button>
        ))}
      </div>

      <div
        role="group"
        aria-label="선택한 질의에 한꺼번에 적용"
        className="flex flex-wrap items-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm shadow-sm"
      >
        <strong>선택한 {selected.size}건에 한꺼번에</strong>
        <label htmlFor="bulk-dept" className="sr-only">소관과 일괄 확정</label>
        <select
          id="bulk-dept"
          value={bulkDept}
          onChange={(event) => setBulkDept(event.target.value)}
          className="rounded-xl border border-line bg-card px-3 py-2 text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
        >
          <option value="__none">소관과: 바꾸지 않음</option>
          <option value="__fill">소관과: 추천대로 확정</option>
          {departments.map((name) => (
            <option key={name} value={name}>
              소관과: {name}
            </option>
          ))}
          <option value={NOT_TREASURY}>소관과: {NOT_TREASURY}</option>
          <option value="__clear">소관과: 확정 취소</option>
        </select>
        <button
          type="button"
          onClick={applyBulk}
          disabled={selected.size === 0 || bulkDept === "__none"}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-subtle"
        >
          적용
        </button>
        <span role="status" aria-live="polite" className="text-sm text-muted">
          {bulkMessage}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="event-kind" className="text-xs font-semibold text-muted">
          엑셀 제목의 행사 종류
        </label>
        <select
          id="event-kind"
          value={eventKind}
          onChange={(event) => setEventKind(event.target.value)}
          className="rounded-xl border border-line bg-card px-3 py-2 text-foreground outline-none focus:border-brand"
        >
          {EVENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
          <option value="__custom">직접 입력</option>
        </select>
        {eventKind === "__custom" && (
          <input
            type="text"
            value={customKind}
            onChange={(event) => setCustomKind(event.target.value)}
            placeholder="예) 인사청문회"
            aria-label="행사 종류 직접 입력"
            className="w-40 rounded-xl border border-line bg-tint px-3 py-2 text-foreground outline-none focus:border-brand focus:bg-card"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleCopy}
          disabled={selected.size === 0 || columns.length === 0}
          className="rounded-xl bg-brand-soft px-4 py-2.5 text-sm font-semibold text-brand hover:bg-line disabled:cursor-not-allowed disabled:bg-line disabled:text-subtle"
        >
          선택한 {selected.size}건 복사 (엑셀·메일에 붙여넣기)
        </button>
        <button
          type="button"
          onClick={handleExcel}
          disabled={selected.size === 0 || columns.length === 0 || excelState === "working"}
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-subtle"
        >
          {excelState === "working" ? "엑셀 파일 만드는 중…" : `선택한 ${selected.size}건 엑셀 파일로 받기`}
        </button>
        <button
          type="button"
          onClick={() => selectVisible(true)}
          className="rounded-md px-2 py-1.5 text-sm font-medium text-brand hover:text-brand-hover"
        >
          보이는 질의 모두 선택
        </button>
        <button
          type="button"
          onClick={() => selectVisible(false)}
          className="rounded-md px-2 py-1.5 text-sm font-medium text-brand hover:text-brand-hover"
        >
          보이는 질의 모두 해제
        </button>
        {onSaveWork && (
          <button
            type="button"
            onClick={handleSave}
            className="rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-subtle/30"
          >
            작업 임시 저장
          </button>
        )}
        <span role="status" aria-live="polite" className="text-sm text-muted">
          {copyState === "done" && "복사했습니다. 엑셀이나 메일에 붙여넣으세요."}
          {copyState === "failed" && "복사하지 못했습니다. 브라우저 권한을 확인하세요."}
          {excelState === "done" && "엑셀 파일을 받았습니다. 다운로드 폴더를 확인하세요."}
          {excelState === "failed" && "엑셀 파일을 만들지 못했습니다. 다시 시도하세요."}
          {saveState === "done" && "이 컴퓨터의 브라우저에 임시 저장했습니다. (서버로 보내지 않습니다)"}
          {saveState === "failed" && "임시 저장하지 못했습니다. 브라우저 설정을 확인하세요."}
        </span>
      </div>

      {anyHighlight && (
        <p className="text-xs text-subtle">
          질의에서 <mark className="rounded bg-yellow-100 px-0.5 text-inherit dark:bg-yellow-900/50">연하게 표시된 부분</mark>
          은 근거 업무와 겹친 말입니다.
        </p>
      )}

      {body}
    </section>
  );
}
