"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./monitor.module.css";

const ALERT_STORAGE_KEY = "monitorAcknowledgedAlerts";
const SOUND_STORAGE_KEY = "monitorSoundEnabled";
const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 520;

function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function formatLocation(value) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean).join(" / ") || "위치 없음";
}

function actionText(action) {
  return {
    item_picked: "피킹",
    item_completed: "완료",
    item_undo: "완료 취소",
    problem_created: "문제 등록",
    problem_cleared: "문제 취소",
    quantity_updated: "수량 수정",
    cancel_memo_updated: "취소 메모 수정",
    monitor_memo_created: "공유 메모",
    monitor_memo_acknowledged: "공유 메모 확인",
    job_created: "작업 생성",
    job_updated: "작업 수정"
  }[action] || action;
}

function logActionText(log) {
  if (log?.action === "item_completed" && log.details?.reason === "마감") return "마감";
  return actionText(log?.action);
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
  const [installPrompt, setInstallPrompt] = useState(null);
  const [pipSupported, setPipSupported] = useState(false);
  const [desktopSupported, setDesktopSupported] = useState(false);
  const [alwaysOnTopActive, setAlwaysOnTopActive] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState([]);
  const [cancelMemoDrafts, setCancelMemoDrafts] = useState({});
  const [savingCancelMemo, setSavingCancelMemo] = useState({});
  const [sharedMemo, setSharedMemo] = useState("");
  const [savingSharedMemo, setSavingSharedMemo] = useState(false);
  const [acknowledgingMemo, setAcknowledgingMemo] = useState({});
  const [now, setNow] = useState(Date.now());
  const previousAlertIds = useRef(new Set());
  const initializedAlerts = useRef(false);
  const audioContext = useRef(null);
  const pipWindowRef = useRef(null);
  const latestJobId = useRef(null);

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
    setCompactMode(url.searchParams.get("compact") === "1");
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
    const desktopApi = window.pickingDesktop;
    const hasDesktopTop = Boolean(desktopApi?.isDesktop);
    setDesktopSupported(hasDesktopTop);
    setPipSupported(("documentPictureInPicture" in window) || hasDesktopTop);
    if (hasDesktopTop) {
      desktopApi.getAlwaysOnTop?.().then((enabled) => setAlwaysOnTopActive(Boolean(enabled))).catch(() => {});
      return desktopApi.onAlwaysOnTopChanged?.((enabled) => setAlwaysOnTopActive(Boolean(enabled)));
    }
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    latestJobId.current = data?.job?.id || null;
  }, [data?.job?.id]);

  useEffect(() => {
    if (!pin) return;
    let checking = false;

    async function refreshIfLatestJobChanged() {
      if (checking) return;
      checking = true;
      try {
        const res = await fetch("/api/monitor/latest-job?pin=" + encodeURIComponent(pin), { cache: "no-store" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || "최신 작업을 확인하지 못했습니다.");
        const nextJobId = payload.job?.id || null;
        if (nextJobId !== latestJobId.current) await load(pin);
      } catch (e) {
        setError(e.message);
      } finally {
        checking = false;
      }
    }

    const timer = setInterval(refreshIfLatestJobChanged, 45000);
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return () => clearInterval(timer);
    }

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const channel = supabase
      .channel("monitor-active-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "picking_jobs" }, refreshIfLatestJobChanged)
      .subscribe();

    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [pin]);

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

  useEffect(() => {
    if (!data?.cancelItems) return;
    setCancelMemoDrafts((current) => {
      const next = { ...current };
      for (const item of data.cancelItems) {
        if (next[item.id] === undefined) next[item.id] = item.problem_memo || "";
      }
      return next;
    });
  }, [data?.cancelItems]);

  const reasonEntries = useMemo(() => Object.entries(data?.reasonCounts || {}), [data]);
  const acknowledgedSet = useMemo(() => new Set(acknowledgedAlerts), [acknowledgedAlerts]);
  const alerts = useMemo(() => {
    if (!data?.job) return [];
    const generated = [];
    for (const log of data.recentLogs || []) {
      const item = log.item || {};
      if (log.action === "problem_created") {
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
      if (log.action === "cancel_memo_updated") {
        generated.push({
          id: "cancel-memo-" + log.id,
          type: "warning",
          title: "취소 메모 등록",
          message: [formatLocation(item.location), item.product_name, item.option_name, log.details?.memo].filter(Boolean).join(" / "),
          meta: {
            location: formatLocation(item.location),
            product: item.product_name || "-",
            option: item.option_name || "-",
            quantity: item.quantity ?? "-",
            worker: "대시보드",
            time: log.created_at
          },
          time: log.created_at
        });
      }
      if (log.action === "monitor_memo_created" && !log.details?.acknowledgedAt) {
        generated.push({
          id: "monitor-memo-" + log.id,
          type: "warning",
          title: "공유 메모 등록",
          message: log.details?.memo || "공유 메모가 등록되었습니다.",
          meta: {
            location: "-",
            product: log.details?.memo || "공유 메모",
            option: "",
            quantity: "-",
            worker: "대시보드",
            time: log.created_at
          },
          time: log.created_at
        });
      }
    }
    if (data.summary.percent === 100 && data.summary.total > 0) {
      generated.push({
        id: "complete-" + data.job.id,
        type: "success",
        title: "패킹중",
        message: data.job.title + " 피킹이 끝나 패킹중입니다.",
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

  async function installDashboard() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }

  async function saveCancelMemo(item) {
    if (!item || savingCancelMemo[item.id]) return;
    const memo = cancelMemoDrafts[item.id] || "";
    setSavingCancelMemo((current) => ({ ...current, [item.id]: true }));
    try {
      const res = await fetch("/api/monitor/cancel-memo?pin=" + encodeURIComponent(pin), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-monitor-pin": pin },
        body: JSON.stringify({ itemId: item.id, memo })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "취소 메모를 저장하지 못했습니다.");
      setData((current) => {
        if (!current) return current;
        const updateItem = (entry) => (entry.id === payload.item.id ? { ...entry, ...payload.item } : entry);
        return {
          ...current,
          items: (current.items || []).map(updateItem),
          cancelItems: (current.cancelItems || []).map(updateItem),
          problemItems: (current.problemItems || []).map(updateItem)
        };
      });
      setUpdatedAt(new Date().toISOString());
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingCancelMemo((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
  }

  async function saveSharedMemo(e) {
    e.preventDefault();
    const memo = sharedMemo.trim();
    if (!memo || savingSharedMemo) return;
    setSavingSharedMemo(true);
    try {
      const res = await fetch("/api/monitor/memo?pin=" + encodeURIComponent(pin), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-monitor-pin": pin },
        body: JSON.stringify({ memo })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "공유 메모를 저장하지 못했습니다.");
      setSharedMemo("");
      setData((current) => {
        if (!current) return current;
        const nextLog = payload.memo;
        return {
          ...current,
          recentLogs: [nextLog, ...(current.recentLogs || [])].slice(0, 10),
          monitorMemos: [nextLog, ...(current.monitorMemos || [])].slice(0, 8)
        };
      });
      setUpdatedAt(new Date().toISOString());
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingSharedMemo(false);
    }
  }

  async function acknowledgeSharedMemo(memo) {
    if (!memo || acknowledgingMemo[memo.id]) return;
    setAcknowledgingMemo((current) => ({ ...current, [memo.id]: true }));
    try {
      const res = await fetch("/api/monitor/memo?pin=" + encodeURIComponent(pin), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-monitor-pin": pin },
        body: JSON.stringify({ memoId: memo.id })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "공유 메모를 확인 처리하지 못했습니다.");
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          monitorMemos: (current.monitorMemos || []).filter((entry) => entry.id !== payload.memo.id)
        };
      });
      setUpdatedAt(new Date().toISOString());
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setAcknowledgingMemo((current) => {
        const next = { ...current };
        delete next[memo.id];
        return next;
      });
    }
  }

  function openSmallWindow() {
    const width = POPUP_WIDTH;
    const height = POPUP_HEIGHT;
    const availableLeft = window.screen?.availLeft ?? 0;
    const availableTop = window.screen?.availTop ?? 0;
    const availableWidth = window.screen?.availWidth || width;
    const left = Math.max(0, availableLeft + availableWidth - width - 12);
    const top = Math.max(0, availableTop + 12);
    const url = new URL("/monitor", location.origin);
    url.searchParams.set("compact", "1");
    const popup = window.open(
      url.toString(),
      "picking-monitor-small",
      "popup=yes,width=" + width + ",height=" + height + ",left=" + left + ",top=" + top + ",resizable=yes,scrollbars=yes"
    );
    try {
      popup?.resizeTo(width, height);
      popup?.moveTo(left, top);
    } catch {
      // 일부 브라우저는 팝업 이동/크기 조정을 제한한다.
    }
    popup?.focus();
  }

  async function toggleAlwaysOnTop() {
    const desktopApi = window.pickingDesktop;
    if (desktopApi?.isDesktop) {
      try {
        const enabled = await desktopApi.setAlwaysOnTop(!alwaysOnTopActive);
        setAlwaysOnTopActive(Boolean(enabled));
        setError("");
      } catch {
        setError("TOP 설정을 바꾸지 못했습니다. 프로그램을 다시 실행해주세요.");
      }
      return;
    }

    if (alwaysOnTopActive && pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
      setAlwaysOnTopActive(false);
      return;
    }

    if (!("documentPictureInPicture" in window)) {
      setError("TOP 기능은 Chrome 또는 Edge 최신 버전에서 지원됩니다.");
      openSmallWindow();
      return;
    }

    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT
      });
      const url = new URL("/monitor", location.origin);
      url.searchParams.set("compact", "1");
      if (pin) url.searchParams.set("token", pin);

      pipWindow.document.body.style.margin = "0";
      pipWindow.document.body.style.background = "#0d1422";
      const iframe = pipWindow.document.createElement("iframe");
      iframe.src = url.toString();
      iframe.title = "피킹 현황 최상위 창";
      iframe.style.cssText = "width:100vw;height:100vh;border:0;display:block;background:#0d1422;";
      pipWindow.document.body.appendChild(iframe);
      pipWindowRef.current = pipWindow;
      setAlwaysOnTopActive(true);
      pipWindow.addEventListener("pagehide", () => {
        pipWindowRef.current = null;
        setAlwaysOnTopActive(false);
      });
      setError("");
    } catch (e) {
      if (e?.name !== "NotAllowedError") setError("TOP 창을 열지 못했습니다. 브라우저 권한 또는 지원 여부를 확인해주세요.");
    }
  }

  const boardClassName = [styles.board, compactMode ? styles.compact : ""].filter(Boolean).join(" ");

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

  if (loading && !data) return <main className={boardClassName}><div className={styles.empty}>현황 불러오는 중</div></main>;

  if (!data?.job) {
    return (
      <main className={boardClassName}>
        <div className={styles.empty}>
          <h1>진행 중인 피킹 작업이 없습니다.</h1>
          <button onClick={() => load(pin)}>다시 확인</button>
          {error && <p>{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className={boardClassName}>
      <section className={styles.windowMenu}>
        <span>설정</span>
        <button
          type="button"
          className={alwaysOnTopActive ? styles.on : ""}
          onClick={toggleAlwaysOnTop}
          disabled={!pipSupported}
          title={desktopSupported ? "현재 대시보드 창을 항상 위로 고정/해제" : pipSupported ? "항상 위 작은창 켜기/끄기" : "Chrome 또는 Edge 최신 버전에서 지원됩니다"}
        >
          TOP
        </button>
      </section>

      <section className={styles.hero}>
        <div>
          <span>실시간 피킹 현황</span>
          <h1>{data.job.title}</h1>
          <p>마지막 갱신 {formatTime(updatedAt)}</p>
        </div>
        <div className={[styles.percent, data.summary.percent === 100 && data.summary.total > 0 ? styles.packing : ""].filter(Boolean).join(" ")}>
          <strong>{data.summary.percent === 100 && data.summary.total > 0 ? "패킹중" : data.summary.percent + "%"}</strong>
          <div><i style={{ width: data.summary.percent + "%" }} /></div>
        </div>
        <div className={styles.totals}>
          <b>전체 <strong>{data.summary.total}</strong></b>
          <b>완료 <strong>{data.summary.done}</strong></b>
          <b>잔여 <strong>{data.summary.remain}</strong></b>
          <b>문제 <strong>{data.summary.problem}</strong></b>
          <b>취소 <strong>{data.summary.cancel}</strong></b>
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
            {!compactMode && <button type="button" onClick={openSmallWindow}>작은창 열기</button>}
            <button type="button" onClick={installDashboard} disabled={!installPrompt}>대시보드 설치</button>
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

      <section className={styles.memoPanel}>
        <div className={styles.memoHeader}>
          <div>
            <span>공유 메모</span>
            <h2>대시보드 메모</h2>
          </div>
        </div>
        <form className={styles.sharedMemoForm} onSubmit={saveSharedMemo}>
          <input value={sharedMemo} onChange={(e) => setSharedMemo(e.target.value)} placeholder="모두에게 공유할 메모 입력" />
          <button type="submit" disabled={savingSharedMemo || !sharedMemo.trim()}>{savingSharedMemo ? "저장 중" : "메모 등록"}</button>
        </form>
        <div className={styles.sharedMemoList}>
          {(data.monitorMemos || []).map((memo) => (
            <article key={memo.id}>
              <time>{formatTime(memo.created_at)}</time>
              <p>{memo.details?.memo || ""}</p>
              <button type="button" onClick={() => acknowledgeSharedMemo(memo)} disabled={!!acknowledgingMemo[memo.id]}>
                {acknowledgingMemo[memo.id] ? "처리 중" : "확인"}
              </button>
            </article>
          ))}
          {!(data.monitorMemos || []).length && <p className={styles.muted}>공유 메모가 없습니다.</p>}
        </div>
      </section>

      <section className={styles.issueSection}>
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
          <h2>취소 현황</h2>
          <div className={styles.problems}>
            {(data.cancelItems || []).map((item) => (
              <article key={item.id} className={styles.cancelMemoCard}>
                <strong>{item.problem_reason || "부분취소"}</strong>
                <span>{formatLocation(item.location)}</span>
                <p>{item.product_name} / {item.option_name} / 취소 {item.canceled_quantity || 0}</p>
                <div className={styles.cancelMemoForm}>
                  <input
                    value={cancelMemoDrafts[item.id] ?? item.problem_memo ?? ""}
                    onChange={(e) => setCancelMemoDrafts((current) => ({ ...current, [item.id]: e.target.value }))}
                    placeholder="송장번호 / 이름 / 취소 메모"
                  />
                  <button type="button" onClick={() => saveCancelMemo(item)} disabled={!!savingCancelMemo[item.id]}>
                    {savingCancelMemo[item.id] ? "저장 중" : "메모 저장"}
                  </button>
                </div>
              </article>
            ))}
            {!(data.cancelItems || []).length && <p className={styles.muted}>취소건이 없습니다.</p>}
          </div>
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
                <span>{logActionText(log)}</span>
                <p>{log.item?.product_name || ""} {log.item?.option_name || ""}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
