import bcrypt from "bcryptjs";
import { fail, json } from "../../../lib/http";
import { requireUser } from "../../../lib/session";

export async function GET() {
  const auth = await requireUser({ admin: true });
  if (auth.error) return fail(auth.error, auth.status);
  const { data, error } = await auth.supabase
    .from("workers")
    .select("id, login_id, name, role, is_active, assigned_zone, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) return fail(error.message, 500);
  return json({ workers: data });
}

export async function POST(request) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return fail(auth.error, auth.status);
  const body = await request.json();
  const login_id = String(body.login_id || "").trim();
  const name = String(body.name || "").trim();
  const pin = String(body.pin || "");
  if (!login_id || !name || !/^\d{4}$/.test(pin)) return fail("이름, 로그인 ID, 4자리 비밀번호가 필요합니다.");
  const pin_hash = await bcrypt.hash(pin, 10);
  const { data, error } = await auth.supabase
    .from("workers")
    .insert({
      login_id,
      name,
      pin_hash,
      role: body.role === "admin" ? "admin" : "worker",
      is_active: body.is_active !== false,
      assigned_zone: body.assigned_zone || null
    })
    .select("id, login_id, name, role, is_active, assigned_zone")
    .single();
  if (error) return fail(error.message, 500);
  await auth.supabase.from("activity_logs").insert({
    worker_id: auth.user.id,
    action: "worker_created",
    details: { login_id, name, role: data.role }
  });
  return json({ worker: data });
}
