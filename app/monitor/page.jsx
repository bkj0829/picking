"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./monitor.module.css";

const ALERT_STORAGE_KEY = "monitorAcknowledgedAlerts";
const SOUND_STORAGE_KEY = "monitorSoundEnabled";

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

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function alertTime(value) {
  return value ? new Date(value).getTime() : 0;
}

export default function MonitorPage() {
  const [pin, setPin] = useState("");
  const [inputPin, setInputPin] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [soundOn, setSoundOn] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState("default");
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState([]);
  const [now, setNow] = useState(Date.now());
  const previousAlertIds = useRef(new Set());
  const initializedAlerts = useRef(false);
  const audioContext = useRef(null);

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
    setSoundOn(localStorage.getItem(SOUND_STORAGE_KEY) === "1");
    setAcknowledgedAlerts(readJsonStorage(ALERT_STORAGE_KEY, []));
    if ("Notification" in window) setNotificationPermission(Notification.permission);
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
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
  const acknowledgedSet = useMemo(() => new Set(acknowledgedAlerts), [acknowledgedAlerts]);
  const alerts = useMemo(() => {
    if (!data?.job) return [];
    const generated = [];
    for (const log of data.recentLogs || []) {
      if (log.action !== "problem_created") continue;
      const item = log.item || {};
      generated.push({
        id: "problem-" + log.id,
        type: "danger",
        title: (log.details?.reason || "문제") + " 문제 등록",
        message: [formatLocation(item.location), item.product_name, item.option_name].filter(Boolean).join(" / "),
        meta: {
          location: formatLocation(item.location),
          product: item.product_name || "-",
          option: item.option_name || "-",
          quantity: item.quantity ?? "-",
          worker: log.worker?.name || "-",
          time: log.created_at
        },
        time: log.created_at
      });
    }
    if (data.summary.percent === 100 && data.summary.total > 0) {
      generated.push({
        id: "complete-" + data.job.id,
        type: "success",
        title: "피킹 완료",
        message: data.job.title + " 작업이 100% 완료되었습니다.",
        meta: { time: updatedAt },
        time: updatedAt
      });
    }
    const lastProgressAt = data.monitor?.lastProgressAt;
    if (lastProgressAt && now - alertTime(lastProgressAt) >= 10 * 60 * 1000 && data.summary.percent < 100) {
      generated.push({
        id: "stalled-" + data.job.id + "-" + Math.floor(alertTime(lastProgressAt) / 600000),
        type: "warning",
        title: "작업 정체",
        message: "10분 이상 완료 또는 문제 등록이 없습니다.",
        meta: { time: lastProgressAt },
        time: lastProgressAt
      });
    }
    if (data.summary.problem >= 5) {
      generated.push({
        id: "problem-limit-" + data.job.id + "-" + data.summary.problem,
        type: "danger",
        title: "관리자 확인 필요",
        message: "문제 상품이 " + data.summary.problem + "개 누적되었습니다.",
        meta: { time: updatedAt },
        time: updatedAt
      });
    }
    return generated.sort((a, b) => alertTime(b.time) - alertTime(a.time)).slice(0, 12);
  }, [data, now, updatedAt]);

  useEffect(() => {
    const ids = new Set(alerts.map((alert) => alert.id));
    if (!initializedAlerts.current) {
      previousAlertIds.current = ids;
      initializedAlerts.current = true;
      return;
    }
    const fresh = alerts.filter((alert) => !previousAlertIds.current.has(alert.id) && !acknowledgedSet.has(alert.id));
    previousAlertIds.current = ids;
    if (!fresh.length) return;
    if (soundOn) playAlertSound();
    if (notificationPermission === "granted") {
      for (const alert of fresh.slice(0, 3)) {
        new Notification(alert.title, { body: alert.message, tag: alert.id, silent: !soundOn });
      }
    }
  }, [alerts, acknowledgedSet, notificationPermission, soundOn]);

  function submitPin(e) {
    e.preventDefault();
    const next = inputPin.trim();
    if (!next) return;
    localStorage.setItem("monitorPin", next);
    setPin(next);
    load(next);
  }

  function saveAcknowledged(next) {
    const compact = Array.from(new Set(next)).slice(-80);
    setAcknowledgedAlerts(compact);
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(compact));
  }

  function acknowledgeAlert(id) {
    saveAcknowledged([...acknowledgedAlerts, id]);
  }

  function acknowledgeAll() {
    saveAcknowledged([...acknowledgedAlerts, ...alerts.map((alert) => alert.id)]);
  }

  function ensureAudioContext() {
    audioContext.current ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.current.state === "suspended") audioContext.current.resume();
    return audioContext.current;
  }

  function playAlertSound() {
    try {
      const ctx = ensureAudioContext();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.38);
    } catch {
      // 브라우저가 자동재생을 막으면 소리 버튼을 다시 누르면 된다.
    }
  }

  function toggleSound() {
    const next = !soundOn;
    if (next) {
      ensureAudioContext();
      setTimeout(playAlertSound, 40);
    }
    setSoundOn(next);
    localStorage.setItem(SOUND_STORAGE_KEY, next ? "1" : "0");
  }

  async function requestNotifications() {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotificationPermission(result);
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

      <section className={styles.alertPanel}>
        <div className={styles.alertHeader}>
          <div>
            <span>관리자 알림</span>
            <h2>최근 알림</h2>
          </div>
          <div className={styles.alertControls}>
            <button type="button" onClick={toggleSound}>{soundOn ? "소리 끄기" : "소리 켜기"}</button>
            <button type="button" onClick={requestNotifications} disabled={!("Notification" in window) || notificationPermission === "granted"}>
              {notificationPermission === "granted" ? "브라우저 알림 허용됨" : "브라우저 알림 허용"}
            </button>
            <button type="button" onClick={acknowledgeAll} disabled={!alerts.length}>전체 확인</button>
          </div>
        </div>
        <div className={styles.alertList}>
          {alerts.map((alert) => {
            const acknowledged = acknowledgedSet.has(alert.id);
            return (
              <article key={alert.id} className={[styles.alertItem, styles[alert.type], acknowledged ? styles.acknowledged : ""].join(" ")}>
                <div>
                  <strong>{alert.title}</strong>
                  <time>{formatTime(alert.time)}</time>
                </div>
                <p>{alert.message}</p>
                {alert.meta?.product && (
                  <dl>
                    <div><dt>위치</dt><dd>{alert.meta.location}</dd></div>
                    <div><dt>상품</dt><dd>{alert.meta.product}</dd></div>
                    <div><dt>옵션</dt><dd>{alert.meta.option}</dd></div>
                    <div><dt>수량</dt><dd>{alert.meta.quantity}</dd></div>
                    <div><dt>등록자</dt><dd>{alert.meta.worker}</dd></div>
                    <div><dt>등록시간</dt><dd>{formatTime(alert.meta.time)}</dd></div>
                  </dl>
                )}
                <button type="button" onClick={() => acknowledgeAlert(alert.id)} disabled={acknowledged}>{acknowledged ? "확인됨" : "확인"}</button>
              </article>
            );
          })}
          {!alerts.length && <p className={styles.muted}>새 알림이 없습니다.</p>}
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
