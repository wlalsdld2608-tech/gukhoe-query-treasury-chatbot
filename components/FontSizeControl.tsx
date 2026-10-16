"use client";

import { useEffect, useState } from "react";

// 글자 크기 조절: 화면 전체 글자를 한 단계씩 키우거나 줄인다. 고른 크기는 이 브라우저에만 기억한다. (질의 내용과 무관)

const LEVELS = [100, 112.5, 125, 150] as const;
const KEY = "gukgam-treasury-font-level";

function apply(level: number) {
  document.documentElement.style.fontSize = `${LEVELS[level]}%`;
}

export default function FontSizeControl() {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    // 화면이 처음 그려진 뒤, 기억해 둔 크기를 불러온다. (서버 화면과 어긋나지 않게 한 박자 늦춘다)
    const timer = window.setTimeout(() => {
      try {
        const saved = Number(window.localStorage.getItem(KEY));
        if (Number.isInteger(saved) && saved > 0 && saved < LEVELS.length) {
          setLevel(saved);
          apply(saved);
        }
      } catch {
        // 저장소를 못 쓰면 기본 크기로 둔다.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function change(next: number) {
    const clamped = Math.min(LEVELS.length - 1, Math.max(0, next));
    setLevel(clamped);
    apply(clamped);
    try {
      window.localStorage.setItem(KEY, String(clamped));
    } catch {
      // 기억하지 못해도 이번 화면에서는 적용된다.
    }
  }

  const button =
    "rounded-lg bg-line px-3 py-1.5 text-sm font-semibold text-muted hover:bg-subtle/30 disabled:cursor-not-allowed disabled:text-subtle";
  return (
    <div role="group" aria-label="글자 크기" className="flex items-center justify-end gap-2 text-sm text-muted">
      <span>글자 크기</span>
      <button type="button" className={button} onClick={() => change(level - 1)} disabled={level === 0} aria-label="글자 작게">
        가−
      </button>
      <button
        type="button"
        className={button}
        onClick={() => change(level + 1)}
        disabled={level === LEVELS.length - 1}
        aria-label="글자 크게"
      >
        가+
      </button>
    </div>
  );
}
