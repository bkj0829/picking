import bcrypt from "bcryptjs";
import { fail, json } from "../../../../lib/http";
import { requireUser } from "../../../../lib/session";

export async function PATCH(request, { params }) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return fail(auth.error, auth.status);
  const body = await request.json();
  const patch = {};
  for (const key of ["name", "login_id", "assigned_zone"]) {
    if (body[key] !== undefined) patch[key] = body[key] || null;
  }
  if (body.role) patch.role = body.role === "admin" ? "admin" : "worker";
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
  if (body.pin !== undefined) {
    if (!/^\d{4}$/.test(String(body.pin))) return fail("4자리 숫자 비밀번호가 필요합니다.");
    patch.pin_hash = await bcrypt.hash(String(body.pin), 10);
    patch.failed_login_count = 0;
    patch.locked_until = null;
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from("workers")
    .update(patch)
    .eq("id", params.id)
    .select("id, login_id, name, role, is_active, assigned_zone")
    .single();
  if (error) return fail(error.message, 500);
  await auth.supabase.from("activity_logs").insert({
    worker_id: auth.user.id,
    action: "worker_updated",
    details: { target_worker_id: params.id, fields: Object.keys(patch).filter((v) => v !== "pin_hash") }
  });
  return json({ worker: data });
}
