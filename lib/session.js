import crypto from "crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "./supabaseAdmin";

const COOKIE = "sv_pick_session";
const MAX_AGE = 60 * 60 * 12;

function secret() {
  if (!process.env.APP_SESSION_SECRET) throw new Error("APP_SESSION_SECRET이 없습니다.");
  return process.env.APP_SESSION_SECRET;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createToken(worker) {
  const payload = Buffer.from(
    JSON.stringify({
      id: worker.id,
      login_id: worker.login_id,
      name: worker.name,
      role: worker.role,
      exp: Math.floor(Date.now() / 1000) + MAX_AGE
    })
  ).toString("base64url");
  return payload + "." + sign(payload);
}

export async function setSession(worker) {
  const jar = await cookies();
  jar.set(COOKIE, createToken(worker), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function readSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token || !token.includes(".")) return null;
  const [payload, mac] = token.split(".");
  if (sign(payload) !== mac) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function requireUser({ admin = false } = {}) {
  const session = await readSession();
  if (!session) return { error: "로그인이 필요합니다.", status: 401 };
  if (admin && session.role !== "admin") return { error: "관리자 권한이 필요합니다.", status: 403 };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("workers")
    .select("id, login_id, name, role, is_active, assigned_zone")
    .eq("id", session.id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data || !data.is_active) return { error: "비활성 계정입니다.", status: 403 };
  if (admin && data.role !== "admin") return { error: "관리자 권한이 필요합니다.", status: 403 };
  return { user: data, supabase };
}
