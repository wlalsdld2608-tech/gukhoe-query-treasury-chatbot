import {
  entryFromQuick,
  NOT_TREASURY,
  QUICK_CUSTOM,
  quickValue,
  type ConfirmedEntry,
} from "@/lib/format-results";

// Design Ref: §3.1-1 소관과 확정 — 과 하나만 고르면 되는 흔한 경우를 선택칸 한 번으로 끝내는 빠른 선택칸.
// 여러 과·관련과·직접 입력은 카드의 "상세 설정"에서 한다.

type Props = {
  id: string;
  label: string;
  departments: string[];
  value: ConfirmedEntry;
  /** 추천 결과를 짧게 쓴 글 (첫 항목에 보여 준다) */
  recommended: string;
  onChange: (value: ConfirmedEntry) => void;
};

export default function QuickConfirm({ id, label, departments, value, recommended, onChange }: Props) {
  const current = quickValue(value);
  return (
    <select
      id={id}
      aria-label={label}
      value={current}
      onChange={(event) => {
        if (event.target.value === QUICK_CUSTOM) return;
        onChange(entryFromQuick(event.target.value));
      }}
      className="w-56 max-w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
    >
      <option value="">추천 그대로 — {recommended}</option>
      {departments.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
      <option value={NOT_TREASURY}>{NOT_TREASURY}</option>
      {current === QUICK_CUSTOM && <option value={QUICK_CUSTOM}>여러 과·직접 입력 (상세 설정에서 고른 값)</option>}
    </select>
  );
}
