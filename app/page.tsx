import Image from "next/image";
import FontSizeControl from "@/components/FontSizeControl";
import QueryForm from "@/components/QueryForm";

// Design Ref: §3 화면 구성 — ① 제목, ② 입력 영역, ④ 하단 안내 (③ 결과 영역은 추천 기능 연결 후 추가)
export default function Home() {
  return (
    <div className="flex w-full flex-1 flex-col bg-background">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 pb-16 pt-4">
        <div className="mx-auto w-full max-w-3xl">
          <FontSizeControl />
        </div>

        {/* 로고와 제목: 흰 카드에 담아 회색 바탕과 확실히 구분한다 */}
        <header className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 rounded-3xl bg-card px-6 py-8 text-center shadow-md ring-1 ring-line">
          {/* 어두운 화면에서도 로고 글자가 보이도록 흰 판 위에 둔다 */}
          <div className="rounded-2xl bg-white px-4 py-1">
            <Image
              src="/moef-logo.png"
              alt="재정경제부 로고"
              width={200}
              height={64}
              priority
              className="h-auto w-[200px]"
            />
          </div>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-brand-deep sm:text-4xl">
            국회 질의 국고실 소관과 안내 챗봇
          </h1>
          <p className="text-lg font-medium text-muted sm:text-xl">질의를 붙여넣으면 소관 과를 추천합니다.</p>
        </header>

        {/* 질의 입력칸 위에 눈에 띄는 빨간 안내 */}
        <p className="mx-auto w-full max-w-3xl rounded-2xl bg-red-50 px-5 py-4 text-center text-base font-bold text-red-600 dark:bg-red-950 dark:text-red-400">
          추천은 참고용이며, 최종 확정은 직원이 합니다.
        </p>

        <QueryForm />
      </main>
    </div>
  );
}
