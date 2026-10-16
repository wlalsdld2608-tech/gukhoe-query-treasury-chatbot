// Design Ref: §5 데이터 모델 — 업무분장표와 요청·응답의 모양을 한곳에 정의한다.

// ── 5.1 업무분장표 ─────────────────────────────────────────

/** 과장 정보 (직책과 성명). 업무분장표에 없으면 과의 `head`가 null이다. */
export type Head = {
  title: string;
  name: string;
};

/** 국고실 안의 과 한 곳. */
export type Department = {
  /** 소속 정책관 (예: 국고정책관) */
  bureau: string;
  /** 과 이름 (실제 국고실 과 이름) */
  name: string;
  /** 과장 정보. 없으면 null → 화면에는 "과장 정보 없음"으로 표시한다. */
  head: Head | null;
  /** 업무명 목록 */
  duties: string[];
  /** 업무명 → 대신 쓰는 말 목록 (없으면 빈 객체) */
  synonyms: Record<string, string[]>;
};

// ── 5.2 요청과 응답 ────────────────────────────────────────

/** 붙여넣은 글에서 나눈 질의 한 건. `index`는 입력 순서대로 1부터 매기는 화면 안의 순서 번호다. */
export type SplitQuery = {
  index: number;
  /** 의원실이 붙인 원본 질의 번호 (예: "7"). 번호 없는 입력은 나뉜 순서, 번호 앞의 안내문 같은 글은 빈 글이다. */
  number?: string;
  text: string;
  /** 질의 앞에 `[소속당 성함]`으로 적은 국회의원 소속당 (없으면 비어 있음) */
  party?: string;
  /** 질의 앞에 `[소속당 성함]`으로 적은 국회의원 성함 (없으면 비어 있음) */
  member?: string;
};

/** 질의 한 건의 판정 상태. `no_basis`는 화면에서 "국고실 아님"으로 보인다. */
export type RecommendStatus = "recommended" | "ambiguous" | "no_basis";

/** 추천 후보로 보여 줄 과 한 건. */
export type DepartmentMatch = {
  department: string;
  head: Head | null;
  /** 근거가 된 업무명 */
  basis: string;
  /** 순위 계산에 쓰는 내부 점수 (비교용이며 화면에는 보이지 않는다) */
  score: number;
  /** 일치도(%, 0~100): 근거 업무명의 글자 조각 중 질의에 들어 있는 비율. 화면에 보여 준다. */
  matchRate: number;
  /** 근거 업무명과 질의가 겹친 두 글자 조각들. 질의 글에서 겹친 말을 강조해 보여 주는 데 쓴다. */
  hitGrams: string[];
};

/** 질의 조각과 연결된 과 (여러 과에 걸칠 때 주제별 연결에 쓴다). */
export type TopicLink = {
  piece: string;
  department: string;
};

/** 질의 한 건의 결과. */
export type QueryResult = {
  /** 화면 안의 순서 번호 (선택·수정 상태를 구분하는 열쇠로 쓴다) */
  index: number;
  /** 의원실 원본 질의 번호. 화면·엑셀·복사 표에 보이는 번호는 이것이다. 없으면 빈 글이다. */
  number: string;
  text: string;
  /** 국회의원 소속당. 결과 복사 표에만 쓰이며 없으면 빈 글이다. */
  party: string;
  /** 국회의원 성함. 결과 복사 표에만 쓰이며 없으면 빈 글이다. */
  member: string;
  status: RecommendStatus;
  /** 순위 후보 (점수 높은 순, 최대 3개). `no_basis`면 비어 있다. */
  candidates: DepartmentMatch[];
  /** 주관 과 (`recommended`일 때만) */
  primary: DepartmentMatch | null;
  /** 여러 과에 걸린 질의일 때 주관 과 외에 함께 다룰 과 */
  related: DepartmentMatch[];
  /** 질의 조각별 연결 (여러 과에 걸칠 때) */
  topics: TopicLink[];
  /** `no_basis`일 때만: 기준에는 못 미치지만 그나마 가장 가까운 과(참고용 힌트). 직원이 "국고실 아님"을 다시 확인할 때 쓴다. 추천이 아니다. */
  nearest?: DepartmentMatch | null;
};

export type RecommendRequest = {
  query: string;
};

export type RecommendResponse = {
  results: QueryResult[];
  /** 국고실 과 이름 목록 (업무분장표 순서). 화면에서 직원이 소관과를 고를 때 쓴다. */
  departments: string[];
};
