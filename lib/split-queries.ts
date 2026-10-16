import { normalizePastedTable } from "@/lib/paste-table";
import type { SplitQuery } from "@/lib/types";

// Design Ref: §4 데이터 흐름 — 질의 나누기: 붙여넣은 글을 번호·줄 단위로 질의 한 건씩 나눈다.
// 외부 호출 없이 글만 처리하는 함수라서, 화면·서버·시험 어디서든 쓸 수 있다.

// 줄 맨 앞의 번호 표시: "1.", "1)", "(1)", "①" 등. "3.5%"처럼 숫자가 바로 이어지면 번호가 아니다.
const NUMBER_MARKER = /^\s*(?:[(（]?\d{1,3}[.)）](?!\d)|[①-⑳])\s*/;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 번호 표시("1.", "(2)", "③" 등)에서 번호만 꺼낸다. 예: "(2) " → "2", "③ " → "3" */
function markerNumber(marker: string): string {
  const circled = /[①-⑳]/.exec(marker);
  if (circled) return String(circled[0].charCodeAt(0) - 0x2460 + 1);
  const digits = /\d{1,3}/.exec(marker);
  return digits ? digits[0] : "";
}

// 질의 맨 앞의 `[소속당 성함]` 표시. 예: "[국민의힘 홍길동] 국고 여유자금 …", "[국민의힘/홍길동 의원] …"
const MEMBER_PREFIX = /^\[([^\]]{1,40})\]\s*/;

function looksLikeParty(token: string): boolean {
  return /당$/.test(token) || token === "국민의힘" || token === "무소속";
}

// 대괄호 없이 질의 앞에 바로 적은 소속당·성함. 예: "국민의힘 홍길동 국고 …", "더불어민주당 김철수 의원: …", "홍길동(국민의힘) …"
// 질의 글을 잘못 의원 정보로 읽지 않도록, 알려진 정당 이름 + 성씨로 시작하는 2~4글자 이름일 때만 읽는다.
const KNOWN_PARTY = "더불어민주당|국민의힘|조국혁신당|개혁신당|진보당|새로운미래|기본소득당|사회민주당|무소속|민주당|국민의당";
const SURNAMES = "김이박최정강조윤장임한오서신권황안송류전홍문양손배백허유남심노하곽성차주우구나민진지엄채원천방공현함변염여추도석선설마길연위명기반왕금옥육인맹제모탁";
const NAME = `[${SURNAMES}][가-힣]{1,3}`;
const BARE_AFTER = String.raw`(?=[\s:,)\-·]|$)\s*[:,)\-·]?\s*`;
const BARE_PARTY_FIRST = new RegExp(String.raw`^(${KNOWN_PARTY})[\s/,·]+(${NAME})(?:\s*의원)?${BARE_AFTER}`);
const BARE_NAME_FIRST = new RegExp(String.raw`^(${NAME})(?:\s*의원)?\s*[(（](${KNOWN_PARTY})[)）]\s*[:,\-·]?\s*`);

function parseBareMember(text: string): { party: string; member: string; text: string } | null {
  const first = BARE_PARTY_FIRST.exec(text);
  if (first) return { party: first[1], member: first[2], text: text.slice(first[0].length) };
  const second = BARE_NAME_FIRST.exec(text);
  if (second) return { party: second[2], member: second[1], text: text.slice(second[0].length) };
  return null;
}

/**
 * 질의 앞머리의 `[소속당 성함]`을 떼어 내고 국회의원 정보로 돌려준다. 앞머리가 없으면 그대로 돌려준다.
 * 대괄호 없이 "국민의힘 홍길동 …"처럼 적어도 읽는다. 소속당과 성함은 띄어쓰기, "/", ","로 구분한다. 한쪽만 적으면 "…당"·"국민의힘"·"무소속"이면 소속당, 아니면 성함으로 본다.
 */
export function parseMemberPrefix(text: string): { party: string; member: string; text: string } {
  const matched = MEMBER_PREFIX.exec(text);
  if (!matched) {
    const bareMember = parseBareMember(text);
    // 소속당·성함만 있고 질의 글이 비면 의원 정보로 떼지 않는다. (질의를 버리지 않기 위해)
    return bareMember && bareMember.text.trim() !== "" ? bareMember : { party: "", member: "", text };
  }

  const tokens = matched[1].split(/[\s/,·]+/).filter((token) => token.length > 0);
  let party = "";
  let nameTokens = tokens;
  const partyIndex = tokens.findIndex(looksLikeParty);
  if (partyIndex >= 0) {
    party = tokens[partyIndex];
    nameTokens = tokens.filter((_, i) => i !== partyIndex);
  } else if (tokens.length >= 2) {
    party = tokens[0];
    nameTokens = tokens.slice(1);
  }
  const member = nameTokens.join(" ").replace(/\s*의원$/, "");
  return { party, member, text: text.slice(matched[0].length) };
}

type Piece = { raw: string; number: string };

/**
 * 붙여넣은 글을 질의 한 건씩 나눈다.
 *
 * - 번호가 붙은 줄이 하나라도 있으면: 번호 줄마다 새 질의가 시작되고, 번호 없는 줄은 앞 질의에 이어 붙인다.
 *   (질의가 여러 줄에 걸쳐 쓰인 경우를 하나로 유지하기 위해서다.)
 *   첫 번호보다 앞에 있는 글은 따로 한 건으로 보고, 번호는 비워 둔다.
 * - 번호가 없으면: 비어 있지 않은 줄 하나가 질의 한 건이다. 번호는 나뉜 순서로 매긴다.
 * - 질의를 임의로 합치거나 버리지 않는다. 비어 있는 줄만 버린다.
 * - 엑셀에서 복사한 표(탭으로 구분된 글)는 먼저 "번호. [소속당 성함] 질의" 모양으로 바꾼다.
 *
 * `index`는 화면 안에서 쓰는 순서 번호(1부터)이고, `number`는 의원실이 붙인 원본 질의 번호다.
 */
export function splitQueries(input: string): SplitQuery[] {
  const lines = normalizePastedTable(input).split(/\r\n|\r|\n/);
  const hasNumbers = lines.some((line) => NUMBER_MARKER.test(line));

  const pieces: Piece[] = [];

  if (hasNumbers) {
    let current: { lines: string[]; number: string } | null = null;
    const flush = () => {
      if (current) pieces.push({ raw: current.lines.join(" "), number: current.number });
    };
    for (const line of lines) {
      if (line.trim() === "") continue;
      const marker = NUMBER_MARKER.exec(line);
      if (marker) {
        flush();
        current = { lines: [line.slice(marker[0].length)], number: markerNumber(marker[0]) };
      } else if (current) {
        current.lines.push(line);
      } else {
        // 첫 번호보다 앞에 있는 글: 첫 번호 줄이 나올 때까지를 한 건으로 본다. (원본 번호 없음)
        current = { lines: [line], number: "" };
      }
    }
    flush();
  } else {
    for (const line of lines) {
      if (line.trim() !== "") pieces.push({ raw: line, number: "" });
    }
  }

  return pieces
    .map((piece) => ({ ...parseMemberPrefix(clean(piece.raw)), number: piece.number }))
    .filter((piece) => piece.text.length > 0)
    .map((piece, i) => ({
      index: i + 1,
      ...piece,
      // 번호가 없는 입력은 나뉜 순서를 번호로 쓴다.
      number: hasNumbers ? piece.number : String(i + 1),
    }));
}
