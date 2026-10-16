"use client";

import { useEffect, useRef } from "react";

// 처음 들어왔을 때 쓰는 법을 짧게 알려 주는 안내 창. [다시 보지 않기]를 고르면 이 브라우저에는 다시 띄우지 않는다.
// 위쪽의 [사용 안내] 버튼으로 언제든 다시 열 수 있다. 질의 내용과는 무관하며 서버로 보내는 것도 없다.

const HIDE_KEY = "gukgam-treasury-guide-hidden";

const STEPS = [
  {
    title: "질의를 붙여넣고 [소관 과 찾기]",
    body: "국회의원 질의를 번호나 줄바꿈으로 구분해 붙여넣으세요. 앞에 국민의힘 홍길동처럼 소속당·성함을 적으면 엑셀에 같이 들어갑니다.",
  },
  {
    title: "추천은 참고용, 확정은 직원이",
    body: "근거와 일치도를 보고 소관과를 고르세요. 여러 과나 다른 기관 이첩도 직접 정할 수 있고, 판단 어려움·국고실 아님은 한 번 더 확인하세요.",
  },
  {
    title: "엑셀로 목록 받기",
    body: "넣을 칸을 고르고 [엑셀 파일로 받기]를 누르세요. 제출여부는 빈 칸으로 들어가니 엑셀에서 직접 체크하면 됩니다.",
  },
];

export default function GuideDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const hideRef = useRef<HTMLInputElement>(null);

  // 처음 화면이 그려진 뒤, 숨기기로 한 적이 없으면 안내 창을 연다.
  useEffect(() => {
    let hidden = false;
    try {
      hidden = window.localStorage.getItem(HIDE_KEY) === "1";
    } catch {
      // 저장소를 못 쓰면 매번 보여 준다.
    }
    if (!hidden && ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  function close() {
    try {
      if (hideRef.current?.checked) window.localStorage.setItem(HIDE_KEY, "1");
      else window.localStorage.removeItem(HIDE_KEY);
    } catch {
      // 기억하지 못해도 이번에는 닫힌다.
    }
    ref.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="rounded-lg bg-line px-3 py-1.5 text-sm font-semibold text-muted hover:bg-subtle/30"
      >
        사용 안내
      </button>

      <dialog
        ref={ref}
        aria-labelledby="guide-title"
        className="m-auto w-[min(92vw,34rem)] rounded-3xl bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-5 p-7">
          <div className="flex flex-col gap-1">
            <h2 id="guide-title" className="text-2xl font-extrabold text-brand-deep">
              처음 오셨나요? 3단계로 쓰세요
            </h2>
            <p className="text-sm text-muted">국회의원 질의의 국고실 소관과를 찾고 엑셀 목록까지 만드는 도구예요.</p>
          </div>

          <ol className="flex flex-col gap-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3 rounded-2xl bg-tint p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-0.5">
                  <strong className="text-base">{step.title}</strong>
                  <span className="text-sm leading-relaxed text-muted">{step.body}</span>
                </div>
              </li>
            ))}
          </ol>

          <p className="rounded-xl bg-pink-100 px-4 py-3 text-sm font-semibold text-pink-900 dark:bg-pink-950 dark:text-pink-100">
            ⚠️ 시연용 가상 자료입니다. 실제 질의나 개인정보는 넣지 마세요. 질의는 외부 AI로 보내지 않고 서버에 저장하지 않습니다.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input ref={hideRef} type="checkbox" className="h-4 w-4" />
              다시 보지 않기
            </label>
            <button
              type="button"
              onClick={close}
              autoFocus
              className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-hover"
            >
              시작하기
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
