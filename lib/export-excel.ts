import type ExcelJS from "exceljs";

import {
  DEFAULT_COLUMNS,
  COLUMN_LABELS,
  finalDepartment,
  orderColumns,
  type ColumnKey,
  type Confirmed,
  type MemberInfo,
} from "@/lib/format-results";
import type { QueryResult } from "@/lib/types";

// Design Ref: §3 화면 구성 ③ — 선택한 질의의 결과를 엑셀(.xlsx) 파일로 바로 받는다.
// 파일은 이 브라우저 안에서만 만들어지고 어디로도 전송되지 않는다. (PRD 6번: 자동 전달은 만들지 않는다.)

/** 엑셀 표에 들어가는 한 줄. */
export type ExportRow = {
  /** 의원실 원본 질의 번호 */
  number: string;
  party: string;
  member: string;
  text: string;
  department: string;
  /** 제출여부: 엑셀에서 직접 적는 칸이라 언제나 빈 칸이다. */
  submitted: string;
};

/** 표 제목 줄 (이 다섯 칸만 넣는다). */
export const EXPORT_HEADER = ["질의 번호", "소속당", "국회의원 이름", "질의 내용", "소관과"] as const;

const SHEET_NAME = "소관과 목록";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 질의가 들어온 자리(행사) 종류. 엑셀 제목에 들어간다. 직접 입력도 할 수 있다. */
export const EVENT_KINDS = ["국감", "청문회", "대정부질문", "상임위 질의", "현안질의"] as const;
export const DEFAULT_EVENT_KIND = EVENT_KINDS[0];

/** 엑셀 맨 위 제목. 예: "2026년 10월 15일 국감 국고실 질의 소관과 목록" (행사 종류는 바꿀 수 있다) */
export function exportTitle(date: Date, kind: string = DEFAULT_EVENT_KIND): string {
  const name = kind.trim() === "" ? DEFAULT_EVENT_KIND : kind.trim();
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${name} 국고실 질의 소관과 목록`;
}

/** 파일 이름에 쓸 수 없는 글자(\ / : * ? " < > |)와 줄바꿈을 뺀다. */
function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

/** 파일 이름. 예: "20261015_청문회_국고실 질의 소관과 목록.xlsx" (날짜 8자리 _ 행사 종류 _ 이름) */
export function exportFileName(date: Date, kind: string = DEFAULT_EVENT_KIND): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const name = safeName(kind) === "" ? DEFAULT_EVENT_KIND : safeName(kind);
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}_${name}_국고실 질의 소관과 목록.xlsx`;
}

/**
 * 복사할 질의들을 엑셀 표의 줄로 바꾼다. 직원이 화면에서 입력·수정한 의원 정보가 앞머리 값보다 우선하고,
 * 소관과는 직원이 확정한 값이 추천 결과보다 우선한다. 질의 번호는 의원실 원본 번호다.
 */
export function toExportRows(
  results: QueryResult[],
  members: Record<number, MemberInfo> = {},
  confirmed: Confirmed = {},
): ExportRow[] {
  return results.map((result) => {
    const info = members[result.index];
    return {
      number: result.number,
      party: (info ? info.party : result.party).trim(),
      member: (info ? info.member : result.member).trim(),
      text: result.text,
      department: finalDepartment(result, confirmed),
      submitted: "", // 제출여부는 엑셀에서 직접 적도록 빈 칸으로 둔다.
    };
  });
}

const COLUMN_WIDTHS: Record<ColumnKey, number> = { number: 14, party: 18, member: 20, text: 70, department: 36, submitted: 14 };

/** 제목과 표가 들어 있는 엑셀 통합 문서를 만든다. 제목은 1행, 빈 줄 다음 3행이 표의 제목 줄이다. 직원이 고른 칸만 넣는다. */
export async function createWorkbook(
  rows: ExportRow[],
  title: string,
  columns: readonly ColumnKey[] = DEFAULT_COLUMNS,
): Promise<ExcelJS.Workbook> {
  const keys = orderColumns(columns);
  // 엑셀 라이브러리는 무거워서 파일을 받을 때만 불러온다.
  const { default: Excel } = await import("exceljs");

  const workbook = new Excel.Workbook();
  workbook.creator = "국회 질의 국고실 소관과 안내 챗봇";
  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = keys.map((key) => ({ width: COLUMN_WIDTHS[key] }));
  sheet.pageSetup.printTitlesRow = "3:3";

  // 1행: 제목 (고른 칸을 합쳐 가운데에 크게)
  if (keys.length > 1) sheet.mergeCells(1, 1, 1, keys.length);
  const titleCell = sheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { bold: true, size: 16 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 32;

  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  // 3행: 표 제목 줄
  const headerRow = sheet.getRow(3);
  keys.forEach((key, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = COLUMN_LABELS[key];
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border;
  });
  headerRow.height = 22;

  // 4행부터: 질의마다 한 줄
  rows.forEach((row, i) => {
    const excelRow = sheet.getRow(4 + i);
    // 질의 번호는 숫자면 숫자로, 아니면(빈 번호 등) 글로 넣는다.
    const numberValue = /^\d+$/.test(row.number) ? Number(row.number) : row.number;
    const all: Record<ColumnKey, string | number> = {
      number: numberValue,
      party: row.party,
      member: row.member,
      text: row.text,
      department: row.department,
      submitted: row.submitted,
    };
    keys.forEach((key, col) => {
      const cell = excelRow.getCell(col + 1);
      cell.value = all[key];
      cell.border = border;
      // 질의 내용만 왼쪽, 나머지(번호·소속당·이름·소관과)는 가운데 정렬
      cell.alignment =
        key === "text"
          ? { horizontal: "left", vertical: "top", wrapText: true }
          : { horizontal: "center", vertical: "top", wrapText: true };
    });
  });

  // 제목 줄에 필터(▼ 화살표)를 달아, 엑셀에서 칸별로 골라 보거나 정렬할 수 있게 한다.
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + Math.max(rows.length, 1), column: keys.length },
  };

  return workbook;
}

/** 엑셀 파일을 만들어 이 브라우저에서 바로 내려받는다. */
export async function downloadExcel(
  rows: ExportRow[],
  date: Date = new Date(),
  columns: readonly ColumnKey[] = DEFAULT_COLUMNS,
  kind: string = DEFAULT_EVENT_KIND,
): Promise<void> {
  const workbook = await createWorkbook(rows, exportTitle(date, kind), columns);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_TYPE });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(date, kind);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
