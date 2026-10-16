import type { SimilarInput } from "@/lib/duplicates";
import QuickConfirm from "@/components/QuickConfirm";
import {
  departmentLabel,
  EMPTY_ENTRY,
  entryFromResult,
  entryLabel,
  isEntryEmpty,
  NOT_TREASURY,
  type ConfirmedEntry,
  type MemberInfo,
} from "@/lib/format-results";
import { highlightSegments } from "@/lib/highlight";
import { LOW_MATCH_RATE } from "@/lib/result-views";
import type { DepartmentMatch, QueryResult } from "@/lib/types";

// Design Ref: §3 화면 구성 ③ — 질의 한 건의 결과 카드 (선택, 의원 정보, 소관과 확정, 추천 결과, 후보 보기)

const NO_BASIS_TEXT = "국고실 아님 — 근거 없음, 직원 확인 필요";
const AMBIGUOUS_TEXT = "판단 어려움: 주관 과 판단이 어렵습니다. 후보를 확인하세요";

function headText(match: DepartmentMatch): string {
  return match.head ? `${match.head.title} ${match.head.name}` : "과장 정보 없음";
}

function LowMatchWarning({ match }: { match: DepartmentMatch }) {
  if (match.matchRate >= LOW_MATCH_RATE) return null;
  return (
    <span className="text-sm font-medium text-orange-700 dark:text-orange-400">
      ⚠ 일치도 {match.matchRate}%로 낮습니다. 직접 확인하세요
    </span>
  );
}

function DepartmentLine({ match, label }: { match: DepartmentMatch; label?: string }) {
  return (
    <div className="flex flex-col">
      <span>
        {label && <span className="mr-1 text-xs font-medium text-subtle">{label}</span>}
        <strong>{match.department}</strong>{" "}
        <span className="text-sm text-muted">({headText(match)})</span>
      </span>
      <span className="text-sm text-muted">근거: {match.basis}</span>
      <LowMatchWarning match={match} />
    </div>
  );
}

/** 질의 글에서 근거 업무명과 겹친 말을 연하게 강조해 보여 준다. */
function QueryText({ result }: { result: QueryResult }) {
  const shown = result.status === "recommended" ? [result.primary, ...result.related] : result.candidates;
  const grams = shown.flatMap((match) => (match ? match.hitGrams : []));
  return (
    <>
      {highlightSegments(result.text, grams).map((segment, i) =>
        segment.hit ? (
          <mark key={i} className="rounded bg-yellow-100 px-0.5 text-inherit dark:bg-yellow-900/50">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function Outcome({ result }: { result: QueryResult }) {
  if (result.status === "no_basis") {
    return (
      <p className="font-medium text-muted">
        <span className="mr-2 rounded-md bg-line px-2 py-0.5 text-xs font-semibold text-muted">국고실 아님</span>
        {NO_BASIS_TEXT}
        {result.nearest && (
          <span className="mt-1 block text-sm font-medium text-orange-600 dark:text-orange-300">
            🔎 약한 근거: {result.nearest.department}의 “{result.nearest.basis}”와 조금 겹칩니다 (일치도{" "}
            {result.nearest.matchRate}%). 국고실 업무가 맞는지 한 번 더 확인하세요.
          </span>
        )}
      </p>
    );
  }

  if (result.status === "ambiguous") {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-semibold text-orange-600 dark:text-orange-300">
          <span className="mr-2 rounded-md bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-600 dark:bg-orange-950">국고실</span>
          {AMBIGUOUS_TEXT}
        </p>
        {result.candidates.map((candidate) => (
          <DepartmentLine key={candidate.department} match={candidate} label="후보" />
        ))}
      </div>
    );
  }

  const primary = result.primary;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-brand">
        <span className="mr-2 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">국고실</span>
        {result.related.length > 0 ? "여러 과에 걸친 질의입니다" : "소관 과 추천"}
      </p>
      {primary && <DepartmentLine match={primary} label={result.related.length > 0 ? "주관 과" : undefined} />}
      {result.related.map((related) => (
        <DepartmentLine key={related.department} match={related} label="관련 과" />
      ))}
    </div>
  );
}

type Props = {
  result: QueryResult;
  /** 국고실 과 이름 목록 (소관과 선택 칸에 쓴다) */
  departments: string[];
  selected: boolean;
  member: MemberInfo;
  /** 직원이 확정한 소관 (비어 있으면 추천 그대로) */
  confirmed: ConfirmedEntry;
  /** 이 질의와 비슷한 다른 질의들 */
  similar: SimilarInput[];
  onToggle: () => void;
  onMember: (field: keyof MemberInfo, value: string) => void;
  onConfirm: (value: ConfirmedEntry) => void;
  /** 표의 [상세]로 펼친 카드인지 (표 줄과 id가 겹치지 않게 한다) */
  embedded?: boolean;
};

/** 비슷한 질의를 가리키는 말. 원본 번호가 있으면 번호, 없으면 화면 순서. */
function similarName(item: SimilarInput): string {
  return item.number ? `${item.number}번` : `${item.index}번째`;
}

export default function ResultItem({
  result,
  departments,
  selected,
  member,
  confirmed,
  similar,
  onToggle,
  onMember,
  onConfirm,
  embedded = false,
}: Props) {
  const recommended = departmentLabel(result);
  const isConfirmed = !isEntryEmpty(confirmed);
  const differs = isConfirmed && entryLabel(confirmed) !== recommended;
  const idPrefix = embedded ? "detail-" : "";
  const selectId = `${idPrefix}confirm-${result.index}`;

  // 같은 과를 소관과와 관련과에 동시에 넣지 않도록, 한쪽에 고르면 다른 쪽에서는 뺀다.
  function toggle(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
  }
  function toggleMain(name: string) {
    onConfirm({ ...confirmed, main: toggle(confirmed.main, name), related: confirmed.related.filter((n) => n !== name) });
  }
  function toggleRelated(name: string) {
    onConfirm({ ...confirmed, related: toggle(confirmed.related, name), main: confirmed.main.filter((n) => n !== name) });
  }

  return (
    <li className="flex flex-col gap-3 rounded-3xl bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 font-medium">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`${result.number || result.index}번 질의 복사에 포함`}
            className="h-4 w-4"
          />
          복사에 포함
        </label>
        <input
          type="text"
          value={member.party}
          onChange={(event) => onMember("party", event.target.value)}
          placeholder="소속당"
          aria-label={`${result.number || result.index}번 질의 국회의원 소속당`}
          className="w-32 rounded-xl border border-line bg-tint px-3 py-2 text-foreground outline-none focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand-soft"
        />
        <input
          type="text"
          value={member.member}
          onChange={(event) => onMember("member", event.target.value)}
          placeholder="의원 성함"
          aria-label={`${result.number || result.index}번 질의 국회의원 성함`}
          className="w-32 rounded-xl border border-line bg-tint px-3 py-2 text-foreground outline-none focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand-soft"
        />
      </div>

      <p className="text-sm text-foreground">
        <span className="mr-1 font-semibold">{result.number ? `${result.number}.` : "-"}</span>
        <QueryText result={result} />
      </p>

      {similar.length > 0 && (
        <p className="text-xs font-medium text-purple-700 dark:text-purple-300">
          ⚠ 비슷한 질의가 있습니다: {similar.map(similarName).join(", ")}
        </p>
      )}

      <Outcome result={result} />

      <div className="flex flex-col gap-2 rounded-2xl bg-tint px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor={selectId} className="font-semibold">
            소관과 확정
          </label>
          <QuickConfirm
            id={selectId}
            label={`${result.number || result.index}번 소관과 확정`}
            departments={departments}
            value={confirmed}
            recommended={recommended}
            onChange={onConfirm}
          />
          {isConfirmed && (
            <span
              className={
                differs
                  ? "rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand"
                  : "rounded-md bg-line px-2 py-0.5 text-xs font-semibold text-muted"
              }
            >
              {differs ? "직원이 바꿔 확정함" : "추천과 같게 확정함"}
            </span>
          )}
        </div>
        {isConfirmed && (
          <p className="text-muted">
            확정한 소관과: <strong className="text-foreground">{entryLabel(confirmed)}</strong>
          </p>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer select-none font-medium text-brand hover:text-brand-hover">
            상세 설정 (여러 과·관련과·직접 입력)
          </summary>

          <div className="mt-3 flex flex-col gap-3">
            <fieldset className="flex flex-col gap-1">
              <legend className="text-xs font-semibold text-muted">소관과 (여러 개 선택 가능)</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {[...departments, NOT_TREASURY].map((name) => (
                  <label key={name} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={confirmed.main.includes(name)}
                      onChange={() => toggleMain(name)}
                      aria-label={`${result.number || result.index}번 소관과 ${name}`}
                      className="h-4 w-4"
                    />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-xs font-semibold text-muted">관련과 (여러 개 선택 가능)</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {departments.map((name) => (
                  <label key={name} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={confirmed.related.includes(name)}
                      onChange={() => toggleRelated(name)}
                      aria-label={`${result.number || result.index}번 관련과 ${name}`}
                      className="h-4 w-4"
                    />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${selectId}-other`} className="text-xs font-semibold text-muted">
                직접 입력 (다른 기관 이첩 등)
              </label>
              <input
                id={`${selectId}-other`}
                type="text"
                value={confirmed.other}
                onChange={(event) => onConfirm({ ...confirmed, other: event.target.value })}
                placeholder="예) 한국은행 이첩, 금융위원회 이첩"
                className="w-72 max-w-full rounded-xl border border-line bg-card px-3 py-2 text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onConfirm(entryFromResult(result))}
                className="font-medium text-brand hover:text-brand-hover"
              >
                추천대로 채우기
              </button>
              <button
                type="button"
                onClick={() => onConfirm({ ...EMPTY_ENTRY })}
                disabled={!isConfirmed}
                className="font-medium text-muted hover:text-foreground disabled:text-subtle"
              >
                확정 취소 (추천 그대로)
              </button>
            </div>
          </div>
        </details>
      </div>

      {(result.candidates.length > 0 || result.topics.length > 0) && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer select-none">후보와 주제별 연결 보기</summary>
          <div className="mt-2 flex flex-col gap-2">
            {result.candidates.length > 0 && (
              <ul className="list-disc pl-5">
                {result.candidates.map((candidate, i) => (
                  <li key={candidate.department}>
                    {i + 1}순위 {candidate.department} ({headText(candidate)}) — 근거: {candidate.basis}, 일치도{" "}
                    {candidate.matchRate}%
                  </li>
                ))}
              </ul>
            )}
            {result.topics.length > 0 && (
              <ul className="list-disc pl-5">
                {result.topics.map((topic) => (
                  <li key={topic.department}>
                    “{topic.piece}” → {topic.department}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </li>
  );
}
