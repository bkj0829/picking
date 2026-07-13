import bcrypt from "bcryptjs";
import { fail, json } from "../../../lib/http";
import { setSession } from "../../../lib/session";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export async function POST(request) {
  try {
    const { pin } = await request.json();
    if (!/^\d{4}$/.test(String(pin || ""))) return fail("4자리 숫자 비밀번호를 입력하세요.");
    const supabase = getSupabaseAdmin();
    const { count, error: countError } = await supabase.from("workers").select("id", { count: "exact", head: true });
    if (countError) return fail(countError.message, 500);
    if ((count || 0) > 0) return fail("최초 관리자 설정은 이미 완료되었습니다.", 409);

    const pin_hash = await bcrypt.hash(String(pin), 10);
    const { data, error } = await supabase
      .from("workers")
      .insert({ login_id: "bkj0829", name: "백기종", role: "admin", pin_hash, is_active: true })
      .select("id, login_id, name, role, is_active")
      .single();
    if (error) return fail(error.message, 500);
    await setSession(data);
    return json({ user: data });
  } catch (error) {
    return fail(error.message, 500);
  }
}
