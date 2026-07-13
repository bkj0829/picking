import { fail, json } from "../../../../lib/http";
import { parsePickingFile } from "../../../../lib/parser";
import { requireUser } from "../../../../lib/session";

export async function POST(request) {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return fail("엑셀 파일을 첨부하세요.");
  if (!/\.(xls|xlsx)$/i.test(file.name)) return fail(".xls 또는 .xlsx 파일만 업로드할 수 있습니다.");
  if (file.size > 5 * 1024 * 1024) return fail("파일은 5MB 이하만 업로드할 수 있습니다.");
  try {
    const parsed = parsePickingFile(Buffer.from(await file.arrayBuffer()), file.name);
    return json({
      sourceFileName: parsed.sourceFileName,
      headers: parsed.headers,
      items: parsed.items,
      errors: parsed.errors,
      summary: parsed.summary
    });
  } catch (error) {
    return fail(error.message, 400);
  }
}
