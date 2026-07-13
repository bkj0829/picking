import bcrypt from "bcryptjs";
import { fail, json } from "../../../lib/http";
import { setSession } from "../../../lib/session";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export async function POST(request) {
  try {
    const { loginId, pin } = await request.json();
    if (!loginId || !/^\d{4}$/.test(String(pin || ""))) return fail("ID와 4자리 비밀번호를 확인하세요.");
    const supabase = getSupabaseAdmin();
    const { data: worker, error } = await supabase
      .from("workers")
      .select("id, login_id, name, role, is_active, pin_hash, failed_login_count, locked_until")
      .eq("login_id", String(loginId).trim())
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!worker) return fail("로그인 정보가 맞지 않습니다.", 401);
    if (!worker.is_active) return fail("사용 중지된 계정입니다.", 403);
    if (worker.locked_until && new Date(worker.locked_until).getTime() > Date.now()) return fail("로그인 잠금 중입니다. 잠시 후 다시 시도하세요.", 423);

    const ok = await bcrypt.compare(String(pin), worker.pin_hash);
    if (!ok) {
      const failed = Number(worker.failed_login_count || 0) + 1;
      await supabase
        .from("workers")
        .update({
          failed_login_count: failed,
          locked_until: failed >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null
        })
        .eq("id", worker.id);
      return fail("로그인 정보가 맞지 않습니다.", 401);
    }

    await supabase.from("workers").update({ failed_login_count: 0, locked_until: null }).eq("id", worker.id);
    const user = { id: worker.id, login_id: worker.login_id, name: worker.name, role: worker.role, is_active: worker.is_active };
    await setSession(user);
    return json({ user });
  } catch (error) {
    return fail(error.message, 500);
  }
}
