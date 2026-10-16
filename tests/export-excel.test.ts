import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import duties from "@/data/duties.json";
import {
  createWorkbook,
  EXPORT_HEADER,
  exportFileName,
  exportTitle,
  toExportRows,
} from "@/lib/export-excel";
import { resultsToTsv } from "@/lib/format-results";
import { parseDepartments } from "@/lib/load-duties";
import { createAnalyzer } from "@/lib/recommend";
import { splitQueries } from "@/lib/split-queries";

const analyze = createAnalyzer(parseDepartments(duties));

const NL = "\n";
const input = [
  "1. [국민의힘 홍길동] 국고 여유자금 운용 수익률과 한시적 자금 조달 계획을 제출하시오.",
  "2. [더불어민주당 김철수] 최저임금 인상이 소상공인 고용에 미친 영향 분석 자료를 제출하시오.",
  "3. [무소속 최지우] 국유재산 제도 개선 방안을 설명하시오.",
  "4. [개혁신당 박민수] 국유재산 처분 대금이 국가결산 보고서에 어떻게 기록되는지 설명하시오.",
].join(NL);
const results = splitQueries(input).map(analyze);

/** 만든 통합 문서를 실제 .xlsx 파일 내용으로 저장했다가 다시 읽어 온다. */
async function roundTrip(rows = toExportRows(results), title = exportTitle(new Date(2026, 9, 15))) {
  const workbook = await createWorkbook(rows, title);
  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer as ArrayBuffer);
  return loaded.worksheets[0];
}

describe("엑셀 제목·파일 이름", () => {
  it("제목은 '2026년 10월 15일 국감 국고실 질의 소관과 목록' 모양이다", () => {
    expect(exportTitle(new Date(2026, 9, 15))).toBe("2026년 10월 15일 국감 국고실 질의 소관과 목록");
    expect(exportTitle(new Date(2027, 0, 3))).toBe("2027년 1월 3일 국감 국고실 질의 소관과 목록");
  });

  it("파일 이름에 날짜가 들어가고 .xlsx로 끝난다", () => {
    expect(exportFileName(new Date(2026, 9, 15))).toBe("20261015_국감_국고실 질의 소관과 목록.xlsx");
    expect(exportFileName(new Date(2026, 0, 3))).toBe("20260103_국감_국고실 질의 소관과 목록.xlsx");
  });
});

describe("엑셀 표 내용", () => {
  it("1행에 제목이 있고 다섯 칸이 합쳐져 있다", async () => {
    const sheet = await roundTrip();
    expect(sheet.getCell("A1").value).toBe("2026년 10월 15일 국감 국고실 질의 소관과 목록");
    expect(sheet.getCell("A1").isMerged).toBe(true);
    expect(sheet.getCell("E1").isMerged).toBe(true);
    expect(sheet.getCell("A1").alignment?.horizontal).toBe("center");
  });

  it("3행이 표 제목 줄이고, 다섯 칸뿐이다", async () => {
    const sheet = await roundTrip();
    const header = [1, 2, 3, 4, 5, 6].map((col) => sheet.getRow(3).getCell(col).value);
    expect(header.slice(0, 5)).toEqual(["질의 번호", "소속당", "국회의원 이름", "질의 내용", "소관과"]);
    expect(header[5]).toBeNull();
    expect([...EXPORT_HEADER]).toEqual(["질의 번호", "소속당", "국회의원 이름", "질의 내용", "소관과"]);
  });

  it("4행부터 질의마다 한 줄이 들어간다 (번호는 숫자, 나머지는 글)", async () => {
    const sheet = await roundTrip();
    const row = (n: number) => [1, 2, 3, 4, 5].map((col) => sheet.getRow(n).getCell(col).value);
    expect(row(4)).toEqual([
      1,
      "국민의힘",
      "홍길동",
      "국고 여유자금 운용 수익률과 한시적 자금 조달 계획을 제출하시오.",
      "국고총괄과",
    ]);
    expect(row(5)[4]).toBe("국고실 아님");
    expect(String(row(6)[4])).toMatch(/^판단 어려움 \(후보: /);
    expect(String(row(7)[4])).toMatch(/\(주관\), .+\(관련\)/);
    expect(sheet.rowCount).toBe(3 + results.length);
  });

  it("선택한 질의만 넣으면 그 질의만 표에 들어간다", async () => {
    const chosen = results.filter((r) => r.index === 2 || r.index === 4);
    const sheet = await roundTrip(toExportRows(chosen));
    expect(sheet.rowCount).toBe(3 + 2);
    expect([sheet.getCell("A4").value, sheet.getCell("A5").value]).toEqual([2, 4]);
  });

  it("직원이 화면에서 고친 의원 정보가 앞머리 값보다 우선한다", async () => {
    const rows = toExportRows(results, { 1: { party: "  진보당 ", member: "정하늘" } });
    const sheet = await roundTrip(rows);
    expect(sheet.getCell("B4").value).toBe("진보당");
    expect(sheet.getCell("C4").value).toBe("정하늘");
    expect(sheet.getCell("B5").value).toBe("더불어민주당"); // 고치지 않은 질의는 앞머리 값
  });

  it("의원 정보가 없으면 빈 칸이다", async () => {
    const rows = toExportRows([analyze({ index: 1, text: "국고 여유자금 운용 현황을 제출하시오." })]);
    const sheet = await roundTrip(rows);
    expect(sheet.getCell("B4").value ?? "").toBe("");
    expect(sheet.getCell("C4").value ?? "").toBe("");
  });
});

describe("엑셀 모양", () => {
  it("표 제목 줄 아래부터 고정, 질의 내용 칸은 줄바꿈, 테두리가 있다", async () => {
    const sheet = await roundTrip();
    const view = sheet.views[0] as { state?: string; ySplit?: number } | undefined;
    expect(view?.state).toBe("frozen");
    expect(view?.ySplit).toBe(3);
    expect(sheet.getCell("D4").alignment?.wrapText).toBe(true);
    expect(sheet.getCell("D4").border?.bottom?.style).toBe("thin");
    expect(sheet.getCell("A3").font?.bold).toBe(true);
    expect(sheet.getColumn(4).width).toBeGreaterThan(sheet.getColumn(1).width ?? 0);
  });

  it("수식처럼 보이는 글도 수식이 아니라 글로 저장된다", async () => {
    const rows = toExportRows([
      { ...analyze({ index: 1, text: "국고 여유자금 운용 현황을 제출하시오." }), text: "=1+1" },
    ]);
    const sheet = await roundTrip(rows);
    const value = sheet.getCell("D4").value;
    expect(value).toBe("=1+1");
    expect(typeof value).toBe("string");
  });
});

describe("엑셀: 원본 질의 번호·소관과 확정·가운데 정렬", () => {
  const original = splitQueries(
    ["7. [국민의힘 홍길동] 국고 여유자금 운용 현황을 제출하시오.", "12. [무소속 최지우] 학교 급식 단가 인상 방안을 제출하시오."].join(NL),
  ).map(analyze);

  it("질의 번호 칸에 의원실 원본 번호가 숫자로 들어간다", async () => {
    const sheet = await roundTrip(toExportRows(original));
    expect([sheet.getCell("A4").value, sheet.getCell("A5").value]).toEqual([7, 12]);
  });

  it("번호가 비어 있는 질의는 번호 칸이 빈 칸이다", async () => {
    const parts = splitQueries(["안내문입니다", "1. 국고 여유자금 운용 현황을 제출하시오."].join(NL)).map(analyze);
    const sheet = await roundTrip(toExportRows(parts));
    expect(sheet.getCell("A4").value ?? "").toBe("");
    expect(sheet.getCell("A5").value).toBe(1);
  });

  it("직원이 확정한 소관과가 엑셀 소관과 칸에 들어간다", async () => {
    const sheet = await roundTrip(toExportRows(original, {}, { 1: { main: ["국채정책과"], related: [], other: "" }, 2: { main: ["국고총괄과"], related: ["국채정책과"], other: "한국은행 이첩" } }));
    expect(sheet.getCell("E4").value).toBe("국채정책과");
    expect(sheet.getCell("E5").value).toBe("국고총괄과(주관), 국채정책과(관련), 한국은행 이첩");
    const untouched = await roundTrip(toExportRows(original));
    expect(untouched.getCell("E4").value).toBe("국고총괄과");
    expect(untouched.getCell("E5").value).toBe("국고실 아님");
  });

  it("소관과 칸은 가운데 정렬이고 질의 내용 칸은 왼쪽 정렬이다", async () => {
    const sheet = await roundTrip(toExportRows(original));
    expect(sheet.getCell("E4").alignment?.horizontal).toBe("center");
    expect(sheet.getCell("A4").alignment?.horizontal).toBe("center");
    expect(sheet.getCell("D4").alignment?.horizontal).toBe("left");
  });
});

describe("행사 종류(국감·청문회 등)", () => {
  it("행사 종류를 바꾸면 엑셀 제목이 바뀌고, 비우면 국감으로 돌아간다", () => {
    expect(exportTitle(new Date(2026, 9, 15), "청문회")).toBe("2026년 10월 15일 청문회 국고실 질의 소관과 목록");
    expect(exportTitle(new Date(2026, 9, 15), " 인사청문회 ")).toBe("2026년 10월 15일 인사청문회 국고실 질의 소관과 목록");
    expect(exportTitle(new Date(2026, 9, 15), "  ")).toBe("2026년 10월 15일 국감 국고실 질의 소관과 목록");
  });
});

describe("파일 이름의 행사 종류", () => {
  it("행사 종류가 파일 이름에 들어간다", () => {
    expect(exportFileName(new Date(2026, 9, 15), "청문회")).toBe("20261015_청문회_국고실 질의 소관과 목록.xlsx");
  });

  it("파일 이름에 쓸 수 없는 글자는 빼고, 비우면 국감이 된다", () => {
    expect(exportFileName(new Date(2026, 9, 15), "인사/청문회: A?")).toBe("20261015_인사 청문회 A_국고실 질의 소관과 목록.xlsx");
    expect(exportFileName(new Date(2026, 9, 15), " / ")).toBe("20261015_국감_국고실 질의 소관과 목록.xlsx");
  });
});

describe("엑셀 필터(▼ 화살표)", () => {
  it("표 제목 줄 전체에 자동 필터가 걸린다", async () => {
    const sheet = await roundTrip();
    const filter = sheet.autoFilter as unknown;
    expect(JSON.stringify(filter)).toContain(`A3:E${3 + results.length}`);
  });

  it("칸을 줄여도 필터 범위가 그 칸에 맞는다", async () => {
    const workbook = await createWorkbook(toExportRows(results), "제목", ["number", "department"]);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
    const filter = loaded.worksheets[0].autoFilter as unknown;
    expect(JSON.stringify(filter)).toContain(`A3:B${3 + results.length}`);
  });
});

describe("표에 넣을 칸 고르기", () => {
  it("고른 칸만, 정해진 순서대로 엑셀에 들어간다", async () => {
    const workbook = await createWorkbook(toExportRows(results), "제목", ["department", "number", "text"]);
    const buffer = await workbook.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer as ArrayBuffer);
    const sheet = loaded.worksheets[0];
    expect([1, 2, 3, 4].map((c) => sheet.getCell(3, c).value ?? "")).toEqual(["질의 번호", "질의 내용", "소관과", ""]);
    expect(sheet.getCell("A4").value).toBe(1);
    expect(sheet.getCell("C4").value).toBe(toExportRows(results)[0].department);
    expect(sheet.getCell("A1").value).toBe("제목");
  });

  it("한 칸만 골라도 파일이 만들어진다", async () => {
    const workbook = await createWorkbook(toExportRows(results), "제목", ["text"]);
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("복사 표도 고른 칸만 나온다", () => {
    const lines = resultsToTsv(results, {}, {}, ["text", "department"]).split(NL);
    expect(lines[0]).toBe("질의내용\t소관과");
    expect(lines[1].split("\t")).toHaveLength(2);
  });
});

describe("제출여부 칸 (엑셀에서 직접 적는 빈 칸)", () => {
  it("제목 줄은 만들고 값은 언제나 빈 칸이다", async () => {
    const rows = toExportRows(results);
    expect(rows.every((row) => row.submitted === "")).toBe(true);

    const workbook = await createWorkbook(rows, "제목", ["number", "submitted"]);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
    const sheet = loaded.worksheets[0];
    expect(sheet.getCell("B3").value).toBe("제출여부");
    expect(sheet.getCell("B4").value ?? "").toBe("");
    expect(sheet.getCell("A4").value).toBe(1);

    const tsv = resultsToTsv(results, {}, {}, ["number", "submitted"]).split(NL);
    expect(tsv[0]).toBe("질의번호	제출여부");
    expect(tsv[1]).toBe("1	");
  });
});
