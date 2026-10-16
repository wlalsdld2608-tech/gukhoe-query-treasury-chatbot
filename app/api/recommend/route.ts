import { getDepartments } from "@/lib/load-duties";
import { createAnalyzer } from "@/lib/recommend";
import { splitQueries } from "@/lib/split-queries";
import type { RecommendResponse } from "@/lib/types";

// Design Ref: §6 API 명세 — POST /api/recommend: 여러 질의가 든 글을 받아 질의별 결과를 돌려준다.
// 질의 원문은 저장·기록하지 않는다. 오류 때도 원문을 로그에 남기지 않고 고정 문구만 돌려준다. 외부 호출은 없다.

/**
 * 비정상적으로 큰 요청을 막는 서버 쪽 상한(글자 수). 화면은 길이 제한을 두지 않는다(PRD 6번).
 * 이 값은 수백 건의 질의를 담을 만큼 넉넉하게 잡았다.
 */
const MAX_QUERY_CHARS = 100_000;

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

let analyzer: ReturnType<typeof createAnalyzer> | null = null;
function getAnalyzer() {
  if (analyzer === null) analyzer = createAnalyzer(getDepartments());
  return analyzer;
}

export async function POST(request: Request) {
  // 본문이 너무 크면 읽기 전에 거절한다. (글자 수 상한의 4배를 바이트 상한으로 쓴다.)
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_QUERY_CHARS * 4) {
    return errorResponse("요청이 너무 큽니다.", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("요청 형식이 올바르지 않습니다.", 400);
  }

  const query =
    typeof body === "object" && body !== null && "query" in body ? (body as { query: unknown }).query : undefined;
  if (typeof query !== "string" || query.trim() === "") {
    return errorResponse("질의를 입력하세요.", 400);
  }
  if (query.length > MAX_QUERY_CHARS) {
    return errorResponse("요청이 너무 큽니다.", 413);
  }

  try {
    const queries = splitQueries(query);
    if (queries.length === 0) {
      return errorResponse("질의를 찾지 못했습니다.", 400);
    }
    const analyze = getAnalyzer();
    const response: RecommendResponse = {
      results: queries.map(analyze),
      departments: getDepartments().map((department) => department.name),
    };
    return Response.json(response, { headers: NO_STORE });
  } catch {
    // 오류 내용에 질의 일부가 섞일 수 있어서 기록하지 않고 고정 문구만 돌려준다.
    return errorResponse("처리 중 문제가 생겼습니다. 다시 시도하세요.", 500);
  }
}
