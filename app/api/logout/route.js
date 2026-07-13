import { json } from "../../../lib/http";
import { clearSession } from "../../../lib/session";

export async function POST() {
  await clearSession();
  return json({ ok: true });
}
