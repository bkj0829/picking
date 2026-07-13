import fs from "fs";
import { parsePickingFile } from "../lib/parser.js";

const sample = "tests/fixtures/sellmate_sample_20260710_100735.xls";
const result = parsePickingFile(fs.readFileSync(sample), sample.split("/").pop());
console.log(JSON.stringify({
  summary: result.summary,
  errors: result.errors,
  contains: {
    complex: result.items.some((item) => item.location === "124-3,163-0"),
    front179: result.items.some((item) => item.location === "179앞"),
    aircon: result.items.some((item) => item.location === "에어컨 앞"),
    table: result.items.some((item) => item.location === "작업대"),
    missing: result.items.filter((item) => !item.location).length
  },
  firstLocations: result.items.slice(0, 10).map((item) => item.location || "위치 없음")
}, null, 2));
