"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ResultView, { type RestoredState } from "@/components/ResultView";
import { detectPii } from "@/lib/detect-pii";
import { clearWork, loadWork, saveWork } from "@/lib/saved-work";
import type { QueryResult, RecommendResponse } from "@/lib/types";

// Design Ref: §3 화면 구성 ② 입력 영역 + ③ 결과 영역
// 개인정보 안내, 입력칸, [소관 과 찾기], [지우기]. 질의는 이 앱의 서버(/api/recommend)로만 보내고 서버에는 저장하지 않는다.
// 작업 임시 저장은 직원이 눌렀을 때만, 이 컴퓨터의 브라우저에만 한다. (Design §7)
export default function QueryForm() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryResult[] | null>(null);
  // 지금 보이는 결과를 만든 질의 글. 입력칸을 고쳐도 임시 저장은 이 글로 해서, 저장한 확정 값이 엉뚱한 질의에 붙지 않게 한다.
  const [searchedQuery, setSearchedQuery] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [restored, setRestored] = useState<RestoredState | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  // 검색할 때마다 올라가서, 결과 화면의 선택·입력 상태를 새 결과에 맞게 처음부터 다시 만든다.
  const [searchId, setSearchId] = useState(0);

  // 직원이 확정·제출여부·의원 정보를 고쳐 둔 상태인지 (결과 화면이 알려 준다). 다시 찾기 전에 경고하는 데 쓴다.
  const dirtyRef = useRef(false);
  const handleDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const CONFIRM_LOSS =
    "직원이 고쳐 둔 소관과 확정·제출여부·의원 정보가 사라집니다. 계속할까요?\n(남기려면 취소하고 [작업 임시 저장]을 먼저 누르세요.)";

  // 공백만 있는 입력은 빈 입력으로 본다 (DESIGN §8: 빈 입력이면 버튼 비활성화)
  const isEmpty = query.trim().length === 0;

  // 개인정보로 보이는 글(전화번호 등)이 있으면 알려 준다. 막지는 않고, 찾은 값은 보여 주지 않는다.
  const piiFindings = useMemo(() => detectPii(query), [query]);

  /** 질의를 서버에 보내 결과를 받는다. `restore`가 있으면 그때 저장한 선택·의원 정보·확정 값을 되살린다. */
  async function search(text: string, restore?: RestoredState) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "처리 중 문제가 생겼습니다. 다시 시도하세요.";
        setError(message);
        return;
      }
      const body = data as RecommendResponse;
      setResults(body.results);
      setSearchedQuery(text);
      setDepartments(body.departments ?? []);
      setRestored(restore);
      setSearchId((id) => id + 1);
    } catch {
      // 입력한 질의는 그대로 둔다 (DESIGN §8)
      setError("처리 중 문제가 생겼습니다. 다시 시도하세요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isEmpty || loading) return;
    if (results && dirtyRef.current && !window.confirm(CONFIRM_LOSS)) return;
    setNotice("");
    await search(query);
  }

  function handleClear() {
    if (results && dirtyRef.current && !window.confirm(CONFIRM_LOSS)) return;
    setQuery("");
    setResults(null);
    setSearchedQuery("");
    setRestored(undefined);
    setError("");
    setNotice("");
  }

  /** 결과 화면에서 [작업 임시 저장]을 눌렀을 때: 입력 글과 직원이 정한 값을 이 브라우저에만 저장한다. */
  function handleSaveWork(state: RestoredState): boolean {
    return saveWork(window.localStorage, {
      version: 1,
      savedAt: new Date().toISOString(),
      query: searchedQuery,
      members: state.members,
      confirmed: state.confirmed,
      selected: state.selected,
    });
  }

  async function handleLoadWork() {
    if (results && dirtyRef.current && !window.confirm(CONFIRM_LOSS)) return;
    const work = loadWork(window.localStorage);
    if (!work) {
      setNotice("저장한 작업이 없습니다.");
      return;
    }
    setQuery(work.query);
    setNotice(`${new Date(work.savedAt).toLocaleString("ko-KR")}에 저장한 작업을 불러왔습니다.`);
    await search(work.query, { members: work.members, confirmed: work.confirmed, selected: work.selected });
  }

  function handleClearSaved() {
    const ok = clearWork(window.localStorage);
    setNotice(ok ? "임시 저장한 작업을 지웠습니다." : "임시 저장한 작업을 지우지 못했습니다.");
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-3xl bg-card p-6 shadow-sm">
        <p
          id="privacy-notice"
          className="rounded-xl bg-pink-100 px-3 py-2 text-sm font-semibold text-pink-900 ring-1 ring-pink-300 dark:bg-pink-950 dark:text-pink-100 dark:ring-pink-800"
        >
          ⚠️ 국회의원 소속당·성함은 그대로 입력해도 됩니다. 그 밖의 개인정보(민원인·제3자 이름, 연락처, 주민등록번호 등)는 지우고 입력하세요.
        </p>

        <label htmlFor="query" className="text-lg font-bold text-foreground">
          국회의원 질의 내용
          <span className="ml-2 text-sm font-medium text-muted">(국정감사·청문회 등, 여러 개는 번호나 줄바꿈으로 구분)</span>
        </label>
        <div className="flex flex-col gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-sm leading-relaxed text-foreground">
          <p>
            <strong className="text-brand">의원 정보 입력:</strong> 질의 앞에{" "}
            <code className="rounded bg-card px-1.5 py-0.5 font-semibold text-brand">[소속당 성함]</code>으로 적으면 복사 표와 엑셀에
            들어갑니다. 대괄호 없이 <strong>국민의힘 홍길동</strong>처럼 써도 읽습니다. (결과 화면에서 직접 입력·수정해도 됩니다.)
          </p>
          <p className="rounded-xl bg-card px-3 py-2">
            <strong className="text-brand">예)</strong> 1. [국민의힘 홍길동] 국고 여유자금 운용 현황을 제출하시오.
          </p>
          <p>
            <strong className="text-brand">엑셀 표 붙여넣기:</strong> 엑셀에서 번호·소속당·성함·질의 열을 복사해 그대로 붙여넣어도
            됩니다.
          </p>
        </div>
        <textarea
          id="query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby="privacy-notice"
          placeholder="질의를 여기에 붙여넣으세요. 예) 1. … 2. …"
          rows={8}
          className="w-full resize-y rounded-2xl border border-line bg-tint p-4 text-base text-foreground outline-none focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand-soft"
        />

        {piiFindings.length > 0 && (
          <p
            role="alert"
            className="rounded-2xl bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-200"
          >
            ⚠ 개인정보로 보이는 내용이 있습니다 (
            {piiFindings.map((finding) => `${finding.label} ${finding.count}건`).join(", ")}). 지우고 입력하세요.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={isEmpty || loading}
            className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-subtle"
          >
            {loading ? "찾는 중입니다…" : "소관 과 찾기"}
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={loading || (query.length === 0 && results === null && error === "")}
            className="rounded-xl bg-line px-5 py-3 text-base font-semibold text-muted hover:bg-subtle/30 disabled:cursor-not-allowed disabled:text-subtle"
          >
            지우기
          </button>
          <button
            type="button"
            onClick={handleLoadWork}
            disabled={loading}
            className="rounded-md px-2 py-2 text-sm font-medium text-brand hover:text-brand-hover disabled:text-subtle"
          >
            저장한 작업 불러오기
          </button>
          <button
            type="button"
            onClick={handleClearSaved}
            disabled={loading}
            className="rounded-md px-2 py-2 text-sm font-medium text-muted hover:text-foreground disabled:text-subtle"
          >
            임시 저장 내용 지우기
          </button>
          {isEmpty && !loading && (
            <span className="text-sm text-subtle">질의를 입력하면 버튼이 켜집니다.</span>
          )}
        </div>

        {notice && (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </form>

      {results && <ResultView key={searchId} results={results} departments={departments} restored={restored} onSaveWork={handleSaveWork} onDirtyChange={handleDirty} />}
    </div>
  );
}
