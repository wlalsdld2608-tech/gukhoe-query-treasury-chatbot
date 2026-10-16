// Design Ref: §4 데이터 흐름 — 엑셀에서 복사한 표(탭으로 구분된 글)를 "번호. [소속당 성함] 질의" 모양으로 바꾼다.
// 엑셀에서 번호·소속당·성함·질의 열을 복사해 붙여넣어도 질의 나누기가 같은 방식으로 읽을 수 있게 하기 위한 준비 단계다.
// 파일 업로드가 아니라 붙여넣기만 지원한다. (PRD 6번)

const HEADER_WORDS = new Set([
  "번호",
  "질의번호",
  "질의 번호",
  "소속당",
  "소속",
  "정당",
  "성함",
  "이름",
  "의원",
  "국회의원",
  "국회의원 성함",
  "국회의원 이름",
  "국회의원 소속당",
  "질의",
  "질의내용",
  "질의 내용",
  "소관과",
]);

function looksLikeParty(cell: string): boolean {
  return /당$/.test(cell) || cell === "국민의힘" || cell === "무소속";
}

function looksLikeNumber(cell: string): boolean {
  return /^[(（]?\d{1,3}[.)）]?$/.test(cell) || /^[①-⑳]$/.test(cell);
}

function looksLikeName(cell: string): boolean {
  return /^[가-힣]{2,5}( ?의원)?$/.test(cell) && !looksLikeParty(cell);
}

function numberOf(cell: string): string {
  const circled = /[①-⑳]/.exec(cell);
  if (circled) return String(circled[0].charCodeAt(0) - 0x2460 + 1);
  const digits = /\d{1,3}/.exec(cell);
  return digits ? digits[0] : "";
}

/**
 * 탭으로 구분된 표를 질의 한 줄씩으로 바꾼다. 표가 아니면 받은 글을 그대로 돌려준다.
 * - 줄 대부분(60% 이상)에 탭이 있어야 표로 본다.
 * - 각 줄에서 번호(숫자), 소속당("…당"·국민의힘·무소속), 성함(한글 2~5자), 질의(가장 긴 칸)를 찾는다.
 * - 제목 줄(예: "질의번호  소속당  …")과 질의를 찾지 못한 줄은 건너뛴다.
 */
export function normalizePastedTable(input: string): string {
  const lines = input.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return input;

  const tabbed = lines.filter((line) => line.includes("\t")).length;
  if (tabbed / lines.length < 0.6) return input;

  const out: string[] = [];
  for (const line of lines) {
    const cells = line
      .split("\t")
      .map((cell) => cell.replace(/\s+/g, " ").trim())
      .filter((cell) => cell.length > 0);
    if (cells.length === 0) continue;

    // 제목 줄: 두 칸 이상이 제목 낱말이면 건너뛴다.
    if (cells.filter((cell) => HEADER_WORDS.has(cell)).length >= 2) continue;

    let number = "";
    let party = "";
    let member = "";
    const rest: string[] = [];
    for (const cell of cells) {
      if (!number && looksLikeNumber(cell)) number = numberOf(cell);
      else if (!party && looksLikeParty(cell)) party = cell;
      else if (!member && looksLikeName(cell)) member = cell.replace(/ ?의원$/, "");
      else rest.push(cell);
    }
    const query = rest.sort((a, b) => b.length - a.length)[0];
    if (!query) continue;

    const who = [party, member].filter((part) => part.length > 0).join(" ");
    out.push(`${number ? `${number}. ` : ""}${who ? `[${who}] ` : ""}${query}`);
  }

  return out.length > 0 ? out.join("\n") : input;
}
