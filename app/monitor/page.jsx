"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import styles from "./monitor.module.css";

function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function formatLocation(value) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean).join(" / ") || "위치 없음";
}

function actionText(action) {
  return {
    item_completed: "완료",
    item_undo: "완료 취소",
    problem_created: "문제 등록",
    problem_cleared: "문제 취소",
    job_created: "작업 생성",
    job_updated: "작업 수정"
  }[action] || action;
}

export default function MonitorPage() {
  const [pin, setPin] = useState("");
  const [inputPin, setInputPin] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  async function load(nextPin = pin) {
    if (!nextPin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/monitor?pin=" + encodeURIComponent(nextPin), { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "현황을 불러오지 못했습니다.");
      setData(payload);
      setError("");
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError(e.message);
      if (e.message.includes("PIN")) {
        localStorage.removeItem("monitorPin");
        setPin("");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const url = new URL(location.href);
    const urlPin = url.searchParams.get("pin") || url.searchParams.get("token");
    const saved = urlPin || localStorage.getItem("monitorPin") || "";
    if (saved) {
      setPin(saved);
      setInputPin(saved);
      localStorage.setItem("monitorPin", saved);
      load(saved);
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!pin || !data?.job?.id || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const refresh = () => load(pin);
    const channel = supabase
      .channel("monitor-job-" + data.job.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "picking_items", filter: "job_id=eq." + data.job.id }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs", filter: "job_id=eq." + data.job.id }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "picking_jobs", filter: "id=eq." + data.job.id }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pin, data?.job?.id]);

  const reasonEntries = useMemo(() => Object.entries(data?.reasonCounts || {}), [data]);

  function submitPin(e) {
    e.preventDefault();
    const next = inputPin.trim();
    if (!next) return;
    localStorage.setItem("monitorPin", next);
    setPin(next);
    load(next);
  }

  if (!pin) {
    return (
      <main className={styles.login}>
        <form onSubmit={submitPin}>
          <h1>피킹 현황보드</h1>
          <input value={inputPin} onChange={(e) => setInputPin(e.target.value)} placeholder="모니터 PIN" inputMode="numeric" />
          <button>현황 보기</button>
          {error && <p>{error}</p>}
        </form>
      </main>
    );
  }

  if (loading && !data) return <main className={styles.board}><div className={styles.empty}>현황 불러오는 중</div></main>;

  if (!data?.job) {
    return (
      <main className={styles.board}>
        <div className={styles.empty}>
          <h1>진행 중인 피킹 작업이 없습니다.</h1>
          <button onClick={() => load(pin)}>다시 확인</button>
          {error && <p>{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.board}>
      <section className={styles.hero}>
        <div>
          <span>실시간 피킹 현황</span>
          <h1>{data.job.title}</h1>
          <p>마지막 갱신 {formatTime(updatedAt)}</p>
        </div>
        <div className={styles.percent}>
          <strong>{data.summary.percent}%</strong>
          <div><i style={{ width: data.summary.percent + "%" }} /></div>
        </div>
        <div className={styles.totals}>
          <b>전체 <strong>{data.summary.total}</strong></b>
          <b>완료 <strong>{data.summary.done}</strong></b>
          <b>잔여 <strong>{data.summary.remain}</strong></b>
          <b>문제 <strong>{data.summary.problem}</strong></b>
        </div>
      </section>

      <section className={styles.workers}>
        <h2>작업자별 진행 현황</h2>
        <div className={styles.workerGrid}>
          {data.workerStats.map((worker) => (
            <article key={worker.id}>
              <div><strong>{worker.name}</strong><span>{formatTime(worker.lastAt)}</span></div>
              <b>{worker.done}개</b>
              <div className={styles.workerBar}><i style={{ width: worker.percent + "%" }} /></div>
              <p>전체 기준 {worker.percent}%</p>
            </article>
          ))}
          {!data.workerStats.length && <p className={styles.muted}>아직 처리 기록이 없습니다.</p>}
        </div>
      </section>

      <section className={styles.bottom}>
        <div>
          <h2>최근 작업 기록</h2>
          <div className={styles.list}>
            {data.recentLogs.map((log) => (
              <article key={log.id}>
                <time>{formatTime(log.created_at)}</time>
                <strong>{log.worker?.name || "-"}</strong>
                <span>{actionText(log.action)}</span>
                <p>{log.item?.product_name || ""} {log.item?.option_name || ""}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <h2>문제 상품 현황</h2>
          <div className={styles.reasonCards}>
            {reasonEntries.map(([reason, count]) => <b key={reason}>{reason}<strong>{count}</strong></b>)}
          </div>
          <div className={styles.problems}>
            {data.problemItems.map((item) => (
              <article key={item.id}>
                <strong>{item.problem_reason}</strong>
                <span>{formatLocation(item.location)}</span>
                <p>{item.product_name} / {item.option_name}</p>
              </article>
            ))}
            {!data.problemItems.length && <p className={styles.muted}>문제 상품이 없습니다.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
