import { fail, json } from "../../../lib/http";
import { requireUser } from "../../../lib/session";

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return fail(auth.error, auth.status);
  return json({ user: auth.user });
}
