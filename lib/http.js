import { NextResponse } from "next/server";

export function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}
