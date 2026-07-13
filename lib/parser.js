import iconv from "iconv-lite";
import * as XLSX from "@e965/xlsx";
import { locationSortTuple } from "./locationSort.js";

const ENCODINGS = ["utf8", "euc-kr", "cp949"];

function looksHtmlXls(buffer) {
  const head = buffer.subarray(0, 256).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return head.startsWith("<") && (head.includes("<table") || head.includes("<html") || head.includes("<tr"));
}

function decodeHtml(buffer) {
  for (const enc of ENCODINGS) {
    try {
      const html = iconv.decode(buffer, enc).replace(/^\uFEFF/, "");
      if (/<t[dh][\s>]/i.test(html) && /<tr[\s>]/i.test(html)) return html;
    } catch {}
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function cellText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function pickColumn(headers, candidates) {
  for (const candidate of candidates) {
    const found = headers.find((h) => h.includes(candidate));
    if (found) return found;
  }
  return null;
}

function readWorkbook(buffer, fileName) {
  if (fileName.toLowerCase().endsWith(".xls") && looksHtmlXls(buffer)) {
    const html = decodeHtml(buffer);
    return XLSX.read("<html><body>" + html + "</body></html>", { type: "string" });
  }
  try {
    return XLSX.read(buffer, { type: "buffer" });
  } catch (error) {
    if (looksHtmlXls(buffer)) {
      const html = decodeHtml(buffer);
      return XLSX.read("<html><body>" + html + "</body></html>", { type: "string" });
    }
    throw error;
  }
}

export function parsePickingFile(buffer, fileName = "upload.xls") {
  const workbook = readWorkbook(buffer, fileName);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("엑셀 시트를 찾을 수 없습니다.");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
  if (!rows.length) throw new Error("엑셀에 데이터 행이 없습니다.");

  const headers = Object.keys(rows[0]).map(cellText);
  const productCol = pickColumn(headers, ["상품명", "품명"]);
  const optionCol = pickColumn(headers, ["옵션명", "옵션", "규격", "색상", "사이즈"]);
  const locationCol = pickColumn(headers, ["위치"]);
  const quantityCol = pickColumn(headers, ["상품수량", "수량", "개수"]);
  if (!productCol) throw new Error("상품명 컬럼을 찾을 수 없습니다. 현재 컬럼: " + headers.join(", "));
  if (!quantityCol) throw new Error("상품수량 컬럼을 찾을 수 없습니다. 현재 컬럼: " + headers.join(", "));

  const errors = [];
  const items = [];
  rows.forEach((row, index) => {
    const productName = cellText(row[productCol]);
    if (!productName) return;
    const rawQty = cellText(row[quantityCol]).replace(/,/g, "");
    const quantity = Number(rawQty);
    if (!Number.isFinite(quantity)) {
      errors.push({ row: index + 2, message: "수량 변환 실패: " + row[quantityCol] });
      return;
    }
    const location = locationCol ? cellText(row[locationCol]) : "";
    const sort = locationSortTuple(location);
    items.push({
      sequence: 0,
      product_name: productName,
      option_name: optionCol ? cellText(row[optionCol]) || "단일상품" : "단일상품",
      location,
      location_sort_1: sort.group * 1000000 + sort.n1,
      location_sort_2: sort.n2,
      quantity,
      status: "pending"
    });
  });

  items.sort((a, b) => a.location_sort_1 - b.location_sort_1 || a.location_sort_2 - b.location_sort_2 || a.product_name.localeCompare(b.product_name, "ko"));
  items.forEach((item, index) => {
    item.sequence = index + 1;
  });

  return {
    sourceFileName: fileName,
    headers,
    items,
    errors,
    summary: {
      totalItems: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      missingLocation: items.filter((item) => !item.location).length
    }
  };
}
