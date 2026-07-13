"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

const REASONS = ["재고마감", "재고없음", "위치없음", "수량부족", "상품불일치", "기타확인"];
const FILTERS = ["전체", "남은 상품", "내 처리 상품", "문제 상품", "1~50번", "51~100번", "101번 이상", "문자 위치", "위치 없음"];

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "요청 실패");
  return data;
}

function locationText(value) {
  const parts = String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
  return parts.length ? parts.join("\n") : "위치 없음";
}

function rangeOf(location) {
  const raw = String(location || "").trim();
  if (!raw) return "위치 없음";
  const m = raw.match(/^(\d+)/);
  if (!m) return raw.includes("작업대") ? "작업대" : "문자 위치";
  const n = Number(m[1]);
  if (n <= 50) return "1~50번";
  if (n <= 100) return "51~100번";
  return "101번 이상";
}

function fmtTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Page() {
  const [boot, setBoot] = useState(null);
  const [user, setUser] = useState(null);
  const [login, setLogin] = useState({ loginId: "bkj0829", pin: "" });
  const [setupPin, setSetupPin] = useState("");
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [items, setItems] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [mode, setMode] = useState("pick");
  const [filter, setFilter] = useState("남은 상품");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [jobTitle, setJobTitle] = useState("");
  const [workerForm, setWorkerForm] = useState({ name: "", login_id: "", pin: "", role: "worker", assigned_zone: "" });
  const [problemItem, setProblemItem] = useState(null);
  const [problem, setProblem] = useState({ reason: "재고마감", memo: "" });

  async function loadBoot() {
    const status = await api("/api/setup/status");
    setBoot(status);
    if (status.envReady && !status.needsSetup) {
      try {
        const me = await api("/api/me");
        setUser(me.user);
      } catch {
        setUser(null);
      }
    }
  }

  async function loadJobs() {
    const data = await api("/api/jobs");
    const nextJobs = data.jobs || [];
    setJobs(nextJobs);
    if (!nextJobs.length) {
      setJobId("");
      setJob(null);
      setItems([]);
      setLogs([]);
      return;
    }
    if (!jobId || !nextJobs.some((j) => j.id === jobId)) setJobId(nextJobs[0].id);
  }

  async function loadJob(id = jobId) {
    if (!id) return;
    const data = await api("/api/jobs/" + id);
    setJob(data.job);
    setItems(data.items || []);
    const activity = await api("/api/activity?jobId=" + id);
    setLogs(activity.logs || []);
  }

  async function loadAdmin() {
    if (user?.role !== "admin") return;
    const data = await api("/api/workers");
    setWorkers(data.workers || []);
  }

  useEffect(() => {
    loadBoot().catch((e) => setMessage(e.message));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadJobs().catch((e) => setMessage(e.message));
    loadAdmin().catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!jobId) return;
    loadJob(jobId).catch((e) => setMessage(e.message));
  }, [jobId]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !jobId) return;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const channel = client
      .channel("picking-job-" + jobId)
      .on("postgres_changes", { event: "*", schema: "public", table: "picking_items", filter: "job_id=eq." + jobId }, () => loadJob(jobId))
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs", filter: "job_id=eq." + jobId }, () => loadJob(jobId))
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [jobId]);

  const stats = useMemo(() => {
    const done = items.filter((item) => item.status === "done").length;
    const problemCount = items.filter((item) => item.status === "problem").length;
    const totalQty = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return { done, problemCount, remain: items.length - done - problemCount, totalQty, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => {
        if (filter === "남은 상품" && item.status !== "pending") return false;
        if (filter === "내 처리 상품" && item.completed_by !== user?.id && item.problem_by !== user?.id) return false;
        if (filter === "문제 상품" && item.status !== "problem") return false;
        if (["1~50번", "51~100번", "101번 이상", "문자 위치", "위치 없음"].includes(filter) && rangeOf(item.location) !== filter) return false;
        if (!q) return true;
        return [item.product_name, item.option_name, item.location].join(" ").toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        return a.location_sort_1 - b.location_sort_1 || a.location_sort_2 - b.location_sort_2 || a.sequence - b.sequence;
      });
  }, [items, filter, query, user]);

  async function handleSetup(e) {
    e.preventDefault();
    const data = await api("/api/setup", { method: "POST", body: JSON.stringify({ pin: setupPin }) });
    setUser(data.user);
    setBoot({ envReady: true, needsSetup: false });
  }

  async function handleLogin(e) {
    e.preventDefault();
    const data = await api("/api/login", { method: "POST", body: JSON.stringify(login) });
    setUser(data.user);
  }

  async function handleUpload(file) {
    try {
      setMessage("");
      const form = new FormData();
      form.append("file", file);
      const data = await api("/api/uploads/preview", { method: "POST", body: form });
      setPreview(data);
      const now = new Date();
      setJobTitle(String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + " 피킹");
    } catch (e) {
      setPreview(null);
      setMessage(e.message);
    }
  }

  async function createJob() {
    try {
      const data = await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ title: jobTitle, sourceFileName: preview.sourceFileName, items: preview.items })
      });
      setPreview(null);
      setJobId(data.job.id);
      await loadJobs();
      await loadJob(data.job.id);
      setMode("pick");
    } catch (e) {
      setMessage(e.message);
    }
  }

  async function action(path, okMessage) {
    try {
      await api(path, { method: "POST", body: JSON.stringify({}) });
      setMessage(okMessage);
      await loadJob();
    } catch (e) {
      setMessage(e.message);
    }
  }

  async function saveProblem() {
    if (!problemItem) return;
    await api("/api/items/" + problemItem.id + "/problem", { method: "POST", body: JSON.stringify(problem) });
    setProblemItem(null);
    setProblem({ reason: "재고마감", memo: "" });
    await loadJob();
  }

  async function createWorker(e) {
    e.preventDefault();
    await api("/api/workers", { method: "POST", body: JSON.stringify(workerForm) });
    setWorkerForm({ name: "", login_id: "", pin: "", role: "worker", assigned_zone: "" });
    await loadAdmin();
  }

  async function archiveJob(targetJob) {
    if (!confirm(targetJob.title + " 작업을 목록에서 정리할까요?")) return;
    try {
      await api("/api/jobs/" + targetJob.id, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
      setMessage("작업을 정리했습니다.");
      await loadJobs();
    } catch (e) {
      setMessage(e.message);
    }
  }

  if (!boot) return <main className="center">불러오는 중</main>;
  if (!boot.envReady) {
    return (
      <main className="center">
        <section className="auth-card">
          <h1>환경변수 설정 필요</h1>
          <p>Supabase와 세션 환경변수를 Vercel 또는 로컬 .env에 설정한 뒤 다시 접속하세요.</p>
          <ul>
            <li>NEXT_PUBLIC_SUPABASE_URL</li>
            <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
            <li>SUPABASE_SERVICE_ROLE_KEY</li>
            <li>APP_SESSION_SECRET</li>
          </ul>
        </section>
      </main>
    );
  }
  if (boot.needsSetup) {
    return (
      <main className="center">
        <form className="auth-card" onSubmit={handleSetup}>
          <h1>최초 관리자 설정</h1>
          <p>관리자 ID는 bkj0829입니다. 사용할 4자리 비밀번호를 직접 설정하세요.</p>
          <input value="bkj0829" readOnly />
          <input inputMode="numeric" maxLength={4} placeholder="4자리 비밀번호" value={setupPin} onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, ""))} />
          <button>관리자 생성</button>
        </form>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="center">
        <form className="auth-card" onSubmit={handleLogin}>
          <h1>세븐밸리 피킹</h1>
          <input placeholder="로그인 ID" value={login.loginId} onChange={(e) => setLogin({ ...login, loginId: e.target.value })} />
          <input inputMode="numeric" maxLength={4} placeholder="4자리 비밀번호" value={login.pin} onChange={(e) => setLogin({ ...login, pin: e.target.value.replace(/\D/g, "") })} />
          <button>로그인</button>
          {message && <p className="alert">{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="top">
        <div className="toprow">
          <div>
            <strong>{job?.title || "피킹 작업"}</strong>
            <span>{user.name} · {user.role === "admin" ? "관리자" : "작업자"}</span>
          </div>
          <button className="ghost" onClick={() => api("/api/logout", { method: "POST" }).then(() => location.reload())}>로그아웃</button>
        </div>
        <div className="progress-meta"><span>{stats.done} / {items.length} 완료</span><span>{stats.pct}%</span></div>
        <div className="progress"><i style={{ width: stats.pct + "%" }} /></div>
        <div className="chips">
          <b>전체 {items.length}</b><b>완료 {stats.done}</b><b>남은 {stats.remain}</b><b>문제 {stats.problemCount}</b><b>수량 {stats.totalQty}</b>
        </div>
      </header>

      <nav className="nav">
        <button className={mode === "pick" ? "on" : ""} onClick={() => setMode("pick")}>피킹</button>
        <button className={mode === "status" ? "on" : ""} onClick={() => setMode("status")}>현황</button>
        <button className={mode === "upload" ? "on" : ""} onClick={() => setMode("upload")}>등록</button>
        {user.role === "admin" && <button className={mode === "admin" ? "on" : ""} onClick={() => setMode("admin")}>관리</button>}
      </nav>

      {message && <div className="toast" onClick={() => setMessage("")}>{message}</div>}

      {mode === "pick" && (
        <>
          <section className="toolbar">
            <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">작업 선택</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.status}</option>)}
            </select>
            <input placeholder="상품명, 옵션, 위치 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="filters">{FILTERS.map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>)}</div>
          </section>
          <section className="list">
            {filteredItems.map((item) => (
              <article key={item.id} className={"card " + item.status}>
                <div className="loc">{locationText(item.location)}</div>
                <div className="info">
                  <strong>{item.product_name}</strong>
                  <span>{item.option_name}</span>
                  <small>
                    {item.status === "done" && "완료 " + (item.completed?.name || "") + " " + fmtTime(item.completed_at)}
                    {item.status === "problem" && "문제 " + item.problem_reason + " " + (item.problem_worker?.name || "")}
                    {item.status === "pending" && "대기"}
                  </small>
                  {item.problem_memo && <em>{item.problem_memo}</em>}
                </div>
                <div className="qty">{item.quantity}<small>개</small></div>
                <div className="actions">
                  {item.status !== "done" && <button className="donebtn" onClick={() => action("/api/items/" + item.id + "/complete", "완료 처리했습니다.")}>완료</button>}
                  {item.status === "done" && <button onClick={() => action("/api/items/" + item.id + "/undo", "완료를 취소했습니다.")}>완료 취소</button>}
                  {item.status !== "done" && <button className="problembtn" onClick={() => setProblemItem(item)}>문제 등록</button>}
                  {item.status === "problem" && <button onClick={() => action("/api/items/" + item.id + "/problem-clear", "문제를 취소했습니다.")}>문제 취소</button>}
                </div>
              </article>
            ))}
            {!filteredItems.length && <p className="empty">표시할 상품이 없습니다.</p>}
          </section>
        </>
      )}

      {mode === "status" && (
        <section className="admin">
          <h2>진행 현황</h2>
          <div className="grid">
            <div className="panel"><b>완료율</b><strong>{stats.pct}%</strong></div>
            <div className="panel"><b>문제</b><strong>{stats.problemCount}</strong></div>
          </div>
          <h2>문제 상품</h2>
          {items.filter((item) => item.status === "problem").map((item) => <div className="row" key={item.id}>{item.problem_reason} · {item.product_name} · {locationText(item.location)}</div>)}
          <h2>최근 작업 기록</h2>
          {logs.map((log) => <div className="row" key={log.id}>{fmtTime(log.created_at)} · {log.worker?.name || "-"} · {log.action} · {log.item?.product_name || ""}</div>)}
        </section>
      )}

      {mode === "upload" && (
        <section className="admin">
          <h2>셀메이트 파일 등록</h2>
          <label className="upload">XLS/XLSX 선택<input type="file" accept=".xls,.xlsx" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} /></label>
          {preview && (
            <div className="preview">
              <b>{preview.sourceFileName}</b>
              <p>{preview.summary.totalItems}품목 / 총 {preview.summary.totalQuantity}개 / 위치 없음 {preview.summary.missingLocation}개</p>
              {preview.errors.length > 0 && <p className="alert">오류 {preview.errors.length}건</p>}
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
              <button onClick={createJob}>피킹 작업 생성</button>
            </div>
          )}
        </section>
      )}

      {mode === "admin" && user.role === "admin" && (
        <section className="admin">
          <h2>작업 정리</h2>
          {jobs.map((j) => {
            const total = j.picking_items?.length || 0;
            const done = j.picking_items?.filter((item) => item.status === "done").length || 0;
            return (
              <div className="row" key={j.id}>
                <span>{j.title} · {done}/{total} 완료 · {j.total_quantity}개</span>
                <button onClick={() => archiveJob(j)}>정리</button>
              </div>
            );
          })}
          {!jobs.length && <p className="empty">정리할 작업이 없습니다.</p>}
          <h2>담당자 등록</h2>
          <form className="worker-form" onSubmit={createWorker}>
            <input placeholder="이름" value={workerForm.name} onChange={(e) => setWorkerForm({ ...workerForm, name: e.target.value })} />
            <input placeholder="로그인 ID" value={workerForm.login_id} onChange={(e) => setWorkerForm({ ...workerForm, login_id: e.target.value })} />
            <input placeholder="4자리 PIN" inputMode="numeric" maxLength={4} value={workerForm.pin} onChange={(e) => setWorkerForm({ ...workerForm, pin: e.target.value.replace(/\D/g, "") })} />
            <select value={workerForm.role} onChange={(e) => setWorkerForm({ ...workerForm, role: e.target.value })}><option value="worker">작업자</option><option value="admin">관리자</option></select>
            <input placeholder="담당 구역" value={workerForm.assigned_zone} onChange={(e) => setWorkerForm({ ...workerForm, assigned_zone: e.target.value })} />
            <button>등록</button>
          </form>
          <h2>담당자</h2>
          {workers.map((w) => <div className="row" key={w.id}>{w.name} · {w.login_id} · {w.role} · {w.is_active ? "사용 중" : "중지"}</div>)}
        </section>
      )}

      {problemItem && (
        <div className="modal">
          <section>
            <h2>문제 등록</h2>
            <p>{problemItem.product_name}</p>
            <div className="reason-grid">{REASONS.map((r) => <button key={r} className={problem.reason === r ? "on" : ""} onClick={() => setProblem({ ...problem, reason: r })}>{r}</button>)}</div>
            <textarea placeholder="메모" value={problem.memo} onChange={(e) => setProblem({ ...problem, memo: e.target.value })} />
            <div className="modal-actions"><button onClick={() => setProblemItem(null)}>닫기</button><button onClick={saveProblem}>저장</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
