export function splitLocation(location) {
  return String(location || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function locationSortTuple(location) {
  const raw = String(location || "").trim();
  if (!raw) return { group: 4, n1: 999999, n2: 999999, text: "위치 없음" };
  if (raw.includes("작업대")) return { group: 3, n1: 999998, n2: 0, text: raw };

  const first = splitLocation(raw)[0] || raw;
  const match = first.match(/^(\d+)(?:-(\d+))?(\D.*)?$/);
  if (match) {
    return {
      group: match[3] ? 1 : 0,
      n1: Number(match[1]),
      n2: match[2] ? Number(match[2]) : 0,
      text: raw
    };
  }
  return { group: 2, n1: 999997, n2: 0, text: raw };
}

export function formatLocation(location) {
  const parts = splitLocation(location);
  return parts.length ? parts.join("\n") : "위치 없음";
}
