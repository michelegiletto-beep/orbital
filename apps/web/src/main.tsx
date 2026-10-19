import {
  readJSON,
  type APIConfiguration,
  type AuthenticationStatus,
  type APIError,
} from "./transport.js";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Scene } from "./Scene.js";
import { Library, recordRun } from "./Library.js";
import { Proximity } from "./Proximity.js";
import type { Mission } from "../../../packages/library/src/index.js";
import {
  MODEL,
  createSession,
  elements,
  execute,
  applyCommand,
  nextApogee,
  entryTime,
  replay,
  report,
  transferPlan,
  validateConfiguration,
  type Session,
  type Command,
} from "../../../packages/sim-core/src/index.js";
import "./style.css";
import { WorkspaceBoundary } from "./WorkspaceBoundary.js";
import { Hub } from "./Hub.js";
import "./hub.css";

const fmt = (n: number, d = 1) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })
    : "∞";
const time = (n: number) =>
  `${String(Math.floor(n / 3600)).padStart(2, "0")} : ${String(Math.floor(n / 60) % 60).padStart(2, "0")} : ${String(Math.floor(n) % 60).padStart(2, "0")}`;
function restore(mission: Mission): Session {
  const config = {
    ...mission,
    family: mission.family as "transfer" | "deorbit",
  };
  try {
    const raw = localStorage.getItem("orbital.session.v2." + mission.id);
    if (raw) {
      const s = JSON.parse(raw) as Session;
      if (
        JSON.stringify(s.configuration) !==
          JSON.stringify(validateConfiguration(config)) ||
        s.events.length > 10000
      )
        throw Error();
      const initial = createSession(s.mode, s.difficulty, config);
      return {
        ...initial,
        state: replay(initial.initial, s.events),
        events: s.events,
      };
    }
  } catch {}
  return createSession("guided", "standard", config);
}
function Icon({
  name,
}: {
  name:
    | "play"
    | "pause"
    | "reset"
    | "arrow"
    | "view"
    | "close"
    | "export"
    | "check"
    | "expand"
    | "orbit";
}) {
  const paths = {
    play: "M8 5l11 7-11 7z",
    pause: "M8 5v14M16 5v14",
    reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    view: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    close: "m6 6 12 12M6 18 18 6",
    export: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    check: "m5 12 4 4L19 6",
    expand: "M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5",
    orbit: "M12 3a9 9 0 1 1-9 9M3 3l18 18M3 8V3h5",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function FlightApp({
  mission,
  onBack,
}: {
  mission: Mission;
  onBack: () => void;
}) {
  const storageKey = "orbital.session.v2." + mission.id;
  const deorbit = mission.family === "deorbit";
  const [session, setSession] = useState<Session>(() => restore(mission)),
    [tab, setTab] = useState<"flight" | "report">("flight"),
    [deltaV, setDeltaV] = useState(
      Math.abs(
        transferPlan(mission.initialAltitude, mission.targetAltitude).first,
      ).toFixed(1),
    ),
    [direction, setDirection] = useState<
      "prograde" | "retrograde" | "radial" | "normal"
    >(deorbit ? "retrograde" : "prograde");
  const [running, setRunning] = useState(false),
    [speed, setSpeed] = useState(60),
    [view, setView] = useState(0),
    [modal, setModal] = useState<"model" | "history" | null>(null),
    [message, setMessage] = useState(""),
    [gl, setGL] = useState(true),
    [xr, setXR] = useState(0),
    [cursor, setCursor] = useState<number | null>(null),
    [backend, setBackend] = useState(false),
    [busy, setBusy] = useState(false),
    [demonstrating, setDemonstrating] = useState(false);
  const [authRequired, setAuthRequired] = useState(false),
    [loginConfigured, setLoginConfigured] = useState(false);
  const serverId = useRef<string | null>(null),
    demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    dialogRef = useRef<HTMLDialogElement>(null),
    previousFocus = useRef<HTMLElement | null>(null),
    sessionRef = useRef(session),
    flightRef = useRef<HTMLElement>(null);
  sessionRef.current = session;
  const visibleState = useMemo(
    () =>
      cursor === null
        ? session.state
        : replay(session.initial, session.events, cursor),
    [session, cursor],
  );
  const orbit = useMemo(() => elements(visibleState), [visibleState]),
    evaluation = useMemo(() => report(session), [session]);
  const forecast = useMemo(() => {
    try {
      return cursor === null
        ? applyCommand(session.state, {
            type: "burn",
            deltaV: Number(deltaV),
            direction,
          })
        : null;
    } catch {
      return null;
    }
  }, [session.state, deltaV, direction, cursor]);
  const plan = transferPlan(mission.initialAltitude, mission.targetAltitude),
    burns = session.state.burns;
  const recorded = useRef(false);
  useEffect(() => {
    if (evaluation.complete && !recorded.current) {
      recorded.current = true;
      try {
        recordRun(mission, evaluation.score, true, {
          mission,
          session,
          evaluation,
          serverId: serverId.current,
        });
      } catch {}
    }
  }, [evaluation.complete, mission]);
  const phase = evaluation.complete
    ? 3
    : burns === 0
      ? 0
      : Math.abs(elements(session.state).radialSpeed) < 0.01 &&
          elements(session.state).altitude >
            mission.targetAltitude - mission.tolerance
        ? 2
        : 1;
  const instruction = evaluation.complete
    ? "Objective achieved. Assess the mission."
    : deorbit
      ? burns === 0
        ? "Reduce velocity to lower the perigee."
        : "Reach the 120 km interface on descent."
      : phase === 0
        ? `Increase velocity to raise the apogee to ${mission.targetAltitude} km.`
        : phase === 1
          ? "Reach apogee before the second impulse."
          : "Circularize the orbit with a prograde impulse.";
  const ready = useCallback((value: boolean) => setGL(value), []),
    xrMessage = useCallback((value: string) => setMessage(value), []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(session));
    } catch {
      setMessage(
        "Local storage unavailable. Export the assessment to retain it.",
      );
    }
  }, [session]);
  useEffect(() => {
    let active = true;
    void fetch("/v1/config")
      .then((r) => (r.ok ? readJSON<APIConfiguration>(r) : null))
      .then(async (data) => {
        if (!active) return;
        if (data?.auth === "local") setBackend(true);
        else if (data?.auth === "oidc") {
          setBackend(true);
          setLoginConfigured(!!data.loginConfigured);
          const status = await fetch("/v1/auth/session").then((r) =>
            readJSON<AuthenticationStatus>(r),
          );
          if (active) setAuthRequired(!status.authenticated);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!modal) return;
    previousFocus.current = document.activeElement as HTMLElement;
    dialogRef.current?.showModal();
    return () => {
      dialogRef.current?.close();
      previousFocus.current?.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 7000);
    return () => clearTimeout(timer);
  }, [message]);
  const commit = useCallback(
    async (command: Command) => {
      setBusy(true);
      setMessage("");
      try {
        let next: Session;
        if (backend) {
          if (!serverId.current) {
            const created = await fetch("/v1/sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: sessionRef.current.mode,
                difficulty: sessionRef.current.difficulty,
                configuration: sessionRef.current.configuration,
                mission,
              }),
            });
            if (!created.ok) throw Error("API unavailable.");
            const payload = await readJSON<{ id: string }>(created);
            serverId.current = payload.id;
            for (const event of sessionRef.current.events) {
              const restored = await fetch(
                `/v1/sessions/${payload.id}/commands`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(event.command),
                },
              );
              if (!restored.ok) {
                serverId.current = null;
                throw Error("Session restore failed.");
              }
            }
          }
          const response = await fetch(
            `/v1/sessions/${serverId.current}/commands`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(command),
            },
          );
          if (response.status === 401) setAuthRequired(true);
          if (!response.ok)
            throw Error((await readJSON<APIError>(response)).error);
          next = await readJSON<Session>(response);
        } else next = execute(sessionRef.current, command);
        sessionRef.current = next;
        setSession(next);
        setCursor(null);
        if (command.type === "burn")
          setMessage(
            report(next).complete
              ? "Circularization complete."
              : `Impulse executed. Apogee ${fmt(elements(next.state).apogee, 0)} km.`,
          );
        return next;
      } catch (error) {
        setRunning(false);
        setMessage(
          error instanceof Error ? error.message : "Operation failed.",
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [backend],
  );
  useEffect(() => {
    if (!running || busy || tab !== "flight") return;
    const timer = setTimeout(() => {
      void commit({ type: "advance", seconds: speed });
    }, 1000);
    return () => clearTimeout(timer);
  }, [running, busy, session, commit, speed, tab]);
  useEffect(() => {
    if (session.state.impacted) {
      setRunning(false);
      setMessage("The spacecraft reached the surface. Start a new mission.");
    }
  }, [session.state.impacted]);
  useEffect(
    () => () => {
      if (demoTimer.current) clearTimeout(demoTimer.current);
    },
    [],
  );
  function reset(mode = session.mode, difficulty = session.difficulty) {
    if (demoTimer.current) clearTimeout(demoTimer.current);
    setDemonstrating(false);
    setRunning(false);
    serverId.current = null;
    const next = createSession(mode, difficulty, session.configuration);
    recorded.current = false;
    sessionRef.current = next;
    setSession(next);
    setCursor(null);
    setTab("flight");
    setDeltaV(Math.abs(plan.first).toFixed(1));
    setDirection(deorbit ? "retrograde" : "prograde");
    setMessage("");
  }
  async function coast() {
    setRunning(false);
    try {
      const seconds = deorbit
        ? entryTime(session.state)
        : nextApogee(session.state);
      await commit({ type: "advance", seconds });
      setDeltaV(plan.second.toFixed(1));
    } catch {
      setMessage("Apply an impulse first to create an elliptical orbit.");
    }
  }
  async function demonstration() {
    reset("guided");
    setDemonstrating(true);
    if (deorbit) {
      const first = await commit({
        type: "burn",
        deltaV: Math.abs(plan.first),
        direction: "retrograde",
      });
      if (first)
        await commit({ type: "advance", seconds: entryTime(first.state) });
      setDemonstrating(false);
      setTab("report");
      return;
    }
    setMessage("First impulse. The apogee rises.");
    const first = await commit({
      type: "burn",
      deltaV: plan.first,
      direction: "prograde",
    });
    if (!first) {
      setDemonstrating(false);
      return;
    }
    demoTimer.current = setTimeout(() => {
      void (async () => {
        const second = await commit({
          type: "advance",
          seconds: nextApogee(first.state),
        });
        if (!second) {
          setDemonstrating(false);
          return;
        }
        setDeltaV(plan.second.toFixed(1));
        setMessage("Apogee reached. The second impulse raises the perigee.");
        demoTimer.current = setTimeout(() => {
          void commit({
            type: "burn",
            deltaV: plan.second,
            direction: "prograde",
          }).then(() => {
            setDemonstrating(false);
            setTab("report");
          });
        }, 2400);
      })();
    }, 2400);
  }
  function exportReport() {
    const payload = {
      schema: "orbital.aar.v1",
      model: MODEL,
      session,
      evaluation,
      authority: backend ? "local-api" : "browser",
      classification: "SYNTHETIC",
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "orbital-aar.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const canAct =
    !busy &&
    !demonstrating &&
    cursor === null &&
    !session.state.impacted &&
    !authRequired;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to mission controls
      </a>
      <header className="topbar">
        <div className="brand">
          <button
            className="back-library"
            aria-label="Back to library"
            onClick={onBack}
          >
            ←
          </button>
          <span className="brand-mark">
            <Icon name="orbit" />
          </span>
          Orbital
        </div>
        <nav aria-label="Main navigation">
          <button
            className={tab === "flight" ? "active" : ""}
            onClick={() => {
              setTab("flight");
              setCursor(null);
            }}
          >
            Simulation
          </button>
          <button
            className={tab === "report" ? "active" : ""}
            onClick={() => {
              setRunning(false);
              setTab("report");
              setCursor(null);
            }}
          >
            Assessment{evaluation.complete && <span className="nav-dot" />}
          </button>
          <button onClick={() => setModal("model")}>Model</button>
        </nav>
        <div className="connection">
          <i />
          {backend ? "Local API" : "Device local"}
        </div>
      </header>
      <main id="workspace" className="workspace">
        <section
          className="visual-panel"
          aria-label="Orbital situation"
          ref={flightRef}
        >
          <div className="scene-top">
            <div>
              <span className="scene-index">01</span>
              <span>{deorbit ? "DEORBITING" : "ORBITAL TRANSFER"}</span>
            </div>
            <button
              className="scene-button"
              aria-label="Change orbital view"
              title="Change view"
              onClick={() => setView((v) => v + 1)}
            >
              <Icon name="view" />
            </button>
          </div>
          <Scene
            targetAltitude={mission.targetAltitude}
            state={visibleState}
            forecast={tab === "flight" ? forecast : null}
            view={view}
            onReady={ready}
            xrRequest={xr}
            onXR={xrMessage}
          />
          {!gl && (
            <div className="render-fallback">
              3D rendering unavailable. Telemetry and simulation remain
              available.
            </div>
          )}
          <div className="scene-callout">
            <span>{deorbit ? "PERIGEE" : "APOGEE"}</span>
            <strong>
              {fmt(deorbit ? orbit.perigee : orbit.apogee, 0)}
              <small>km</small>
            </strong>
            <div className="callout-line" />
          </div>
          <div className="scene-target">
            <i />
            Target orbit<span>{mission.targetAltitude} km</span>
          </div>
          <div className="scene-coordinate">
            {cursor !== null ? "REPLAY" : "MISSION ELAPSED"}
            <strong>{time(visibleState.time)}</strong>
          </div>
          <div className="scene-toolbar">
            <button
              className="scene-button"
              aria-label="Reset view"
              title="Reset view"
              onClick={() => {
                setView((v) => v + 3);
              }}
            >
              <Icon name="reset" />
            </button>
            <button
              className="scene-button"
              aria-label="Enter immersive view"
              title="Immersive view"
              onClick={() => setXR((n) => n + 1)}
            >
              <span>VR</span>
            </button>
            <button
              className="scene-button"
              aria-label="Full screen"
              title="Full screen"
              onClick={() => {
                void (document.fullscreenElement
                  ? document.exitFullscreen()
                  : flightRef.current?.requestFullscreen());
              }}
            >
              <Icon name="expand" />
            </button>
          </div>
          <div className="scene-legend">
            <span>
              <i className="current-orbit" />
              Current orbit
            </span>
            {tab === "flight" && (
              <span>
                <i className="planned-orbit" />
                Impulse prediction
              </span>
            )}
          </div>
          <div className="scene-watermark">SYNTHETIC DATA</div>
        </section>
        <aside className="control-panel">
          <div className="panel-heading">
            <span className="eyebrow">MISSION 01</span>
            <button
              className="text-button"
              disabled={busy || demonstrating}
              onClick={() => reset()}
              aria-label="Start new mission"
            >
              <Icon name="reset" />
              Restart
            </button>
          </div>
          <h1>{tab === "flight" ? mission.title : "Assessment"}</h1>
          {authRequired && (
            <div className="auth-required">
              <p>Sign in with your institutional identity.</p>
              {loginConfigured ? (
                <a className="primary" href="/v1/auth/login">
                  Sign in
                  <Icon name="arrow" />
                </a>
              ) : (
                <p>
                  The identity gateway requires administrator configuration.
                </p>
              )}
            </div>
          )}
          {tab === "flight" ? (
            <>
              <div
                className="mode-switch"
                role="group"
                aria-label="Training mode"
              >
                <button
                  aria-pressed={session.mode === "guided"}
                  disabled={busy || demonstrating}
                  onClick={() => reset("guided")}
                >
                  Guided
                </button>
                <button
                  aria-pressed={session.mode === "practice"}
                  disabled={busy || demonstrating}
                  onClick={() => reset("practice")}
                >
                  Practice
                </button>
              </div>
              <div className="mission-orbits">
                <div>
                  <span>Departure</span>
                  <strong>
                    {mission.initialAltitude}
                    <small>km</small>
                  </strong>
                </div>
                <Icon name="arrow" />
                <div>
                  <span>Target</span>
                  <strong>
                    {mission.targetAltitude}
                    <small>km</small>
                  </strong>
                </div>
              </div>
              <div
                className="phase-track"
                aria-label={`Phase ${phase + 1} of 4`}
              >
                {(deorbit
                  ? ["Plan", "Reduce energy", "Descent", "Verify"]
                  : ["Plan", "Transfer", "Circularize", "Verify"]
                ).map((p, i) => (
                  <span key={p} className={i <= phase ? "done" : ""}>
                    <i>
                      {i < phase ? (
                        <Icon name="check" />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </i>
                    {p}
                  </span>
                ))}
              </div>
              {session.mode === "guided" && (
                <p className="instruction">{instruction}</p>
              )}
              {evaluation.complete ? (
                <div className="completion">
                  <span className="complete-icon">
                    <Icon name="check" />
                  </span>
                  <p>
                    {deorbit ? "Entry interface reached" : "Orbit acquired"}
                  </p>
                  <button
                    className="primary"
                    onClick={() => {
                      setRunning(false);
                      setTab("report");
                    }}
                  >
                    Assess mission
                    <Icon name="arrow" />
                  </button>
                </div>
              ) : (
                <div className="maneuver">
                  <div className="section-label">
                    <h2>Maneuver</h2>
                    {session.mode === "guided" && (
                      <button
                        className="text-button"
                        disabled={!canAct}
                        onClick={() => {
                          const v =
                            burns === 0
                              ? Math.abs(plan.first)
                              : Math.max(
                                  0.1,
                                  (Math.sqrt(
                                    MODEL.mu / (MODEL.radius + orbit.altitude),
                                  ) -
                                    orbit.speed) *
                                    1000,
                                );
                          setDeltaV(Math.min(350, v).toFixed(1));
                          setDirection(deorbit ? "retrograde" : "prograde");
                        }}
                      >
                        Calculate impulse
                      </button>
                    )}
                  </div>
                  <label className="field-label" htmlFor="direction">
                    Direction
                  </label>
                  <select
                    id="direction"
                    value={direction}
                    disabled={!canAct}
                    onChange={(e) =>
                      setDirection(e.target.value as typeof direction)
                    }
                  >
                    <option value="prograde">Prograde</option>
                    <option value="retrograde">Retrograde</option>
                    <option value="radial">Radial</option>
                    <option value="normal">Normal</option>
                  </select>
                  <div className="impulse-field">
                    <label htmlFor="impulse">Impulse</label>
                    <div>
                      <input
                        id="impulse"
                        type="number"
                        min="0.1"
                        max="350"
                        step="0.1"
                        value={deltaV}
                        disabled={!canAct}
                        onChange={(e) => setDeltaV(e.target.value)}
                      />
                      <span>m·s⁻¹</span>
                    </div>
                  </div>
                  <input
                    className="impulse-slider"
                    type="range"
                    aria-label="Adjust impulse"
                    min="0.1"
                    max="250"
                    step="0.1"
                    value={Number(deltaV) || 0.1}
                    disabled={!canAct}
                    onChange={(e) => setDeltaV(e.target.value)}
                  />
                  <div className="prediction-values">
                    <span>
                      {deorbit ? "Predicted perigee" : "Predicted apogee"}
                      <strong>
                        {forecast
                          ? fmt(
                              deorbit
                                ? elements(forecast).perigee
                                : elements(forecast).apogee,
                              0,
                            )
                          : "∞"}
                        <small>km</small>
                      </strong>
                    </span>
                    <span>
                      Propellant
                      <strong>
                        {forecast
                          ? fmt(session.state.mass - forecast.mass, 1)
                          : "0"}
                        <small>kg</small>
                      </strong>
                    </span>
                  </div>
                  <button
                    className="primary"
                    disabled={!canAct || !forecast || running}
                    onClick={() => {
                      void commit({
                        type: "burn",
                        deltaV: Number(deltaV),
                        direction,
                      });
                    }}
                  >
                    Execute impulse
                    <Icon name="arrow" />
                  </button>
                  <button
                    className="secondary"
                    disabled={!canAct || burns === 0 || running}
                    onClick={() => {
                      void coast();
                    }}
                  >
                    {deorbit ? "Coast to entry" : "Coast to apogee"}
                    <span>→</span>
                  </button>
                </div>
              )}
              <div className="objectives">
                <div className="section-label">
                  <h2>Competencies</h2>
                  <span>
                    {evaluation.objectives.filter((o) => o.achieved).length} of
                    3
                  </span>
                </div>
                {evaluation.objectives.map((o) => (
                  <div
                    className={o.achieved ? "objective achieved" : "objective"}
                    key={o.id}
                  >
                    <span>{o.achieved ? <Icon name="check" /> : <i />}</span>
                    {o.competency}
                  </div>
                ))}
              </div>
              <button
                className="demonstrate"
                disabled={busy || demonstrating}
                onClick={() => {
                  void demonstration();
                }}
              >
                <Icon name="play" />
                {demonstrating
                  ? "Demonstration running"
                  : "Watch demonstration"}
              </button>
            </>
          ) : (
            <div className="report-panel">
              <div className="result-score">
                <strong>
                  {evaluation.score}
                  <small>100</small>
                </strong>
                <span>
                  {evaluation.complete
                    ? "Mission complete"
                    : "Mission incomplete"}
                </span>
              </div>
              <div className="report-metrics">
                <div>
                  <span>Orbit error</span>
                  <strong>
                    {fmt(evaluation.metrics.orbitError ?? Infinity, 2)} km
                  </strong>
                </div>
                <div>
                  <span>Total delta V</span>
                  <strong>{fmt(evaluation.metrics.deltaV)} m·s⁻¹</strong>
                </div>
                <div>
                  <span>Propellant consumed</span>
                  <strong>{fmt(evaluation.metrics.propellant)} kg</strong>
                </div>
                <div>
                  <span>Maneuvers executed</span>
                  <strong>{evaluation.metrics.burns}</strong>
                </div>
              </div>
              <div className="objectives">
                {evaluation.objectives.map((o) => (
                  <div
                    className={o.achieved ? "objective achieved" : "objective"}
                    key={o.id}
                  >
                    <span>{o.achieved ? <Icon name="check" /> : <i />}</span>
                    {o.competency}
                  </div>
                ))}
              </div>
              <p className="recommendation">{evaluation.recommendation}</p>
              <div className="replay-control">
                <label htmlFor="replay">
                  Replay
                  <span>
                    {cursor ?? session.events.length} of {session.events.length}
                  </span>
                </label>
                <input
                  id="replay"
                  type="range"
                  min="0"
                  max={session.events.length}
                  value={cursor ?? session.events.length}
                  disabled={!session.events.length}
                  onChange={(e) => setCursor(Number(e.target.value))}
                />
                <button
                  className="secondary"
                  disabled={!session.events.length}
                  onClick={() => {
                    setCursor((c) =>
                      c === null || c >= session.events.length ? 0 : c + 1,
                    );
                  }}
                >
                  Next step
                  <Icon name="play" />
                </button>
              </div>
              <button className="primary" onClick={exportReport}>
                Export assessment
                <Icon name="export" />
              </button>
              <button
                className="secondary"
                onClick={() =>
                  reset(
                    "practice",
                    evaluation.nextDifficulty as Session["difficulty"],
                  )
                }
              >
                {evaluation.nextDifficulty === "precision"
                  ? "Precision practice"
                  : "Repeat in practice"}
                <Icon name="arrow" />
              </button>
            </div>
          )}
        </aside>
        <section className="telemetry" aria-label="Telemetry">
          <div className="telemetry-identity">
            <i />
            SPACECRAFT 01
            <span>
              {session.state.impacted
                ? "Impact"
                : running
                  ? "Propagating"
                  : "In orbit"}
            </span>
          </div>
          <div>
            <span>Altitude</span>
            <strong>
              {fmt(orbit.altitude, 1)}
              <small>km</small>
            </strong>
          </div>
          <div>
            <span>Velocity</span>
            <strong>
              {fmt(orbit.speed, 3)}
              <small>km·s⁻¹</small>
            </strong>
          </div>
          <div>
            <span>Perigee</span>
            <strong>
              {fmt(orbit.perigee, 1)}
              <small>km</small>
            </strong>
          </div>
          <div>
            <span>Eccentricity</span>
            <strong>{fmt(orbit.eccentricity, 4)}</strong>
          </div>
          <div>
            <span>Propellant</span>
            <strong>
              {fmt(visibleState.mass - MODEL.dryMass, 1)}
              <small>kg</small>
            </strong>
          </div>
        </section>
        <div className="transport">
          <div className="transport-actions">
            <button
              className="play-button"
              aria-label={running ? "Pause simulation" : "Run simulation"}
              disabled={!canAct || tab === "report"}
              onClick={() => setRunning((v) => !v)}
            >
              <Icon name={running ? "pause" : "play"} />
            </button>
            <select
              aria-label="Time scale"
              value={speed}
              disabled={demonstrating}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              <option value={2}>2×</option>
              <option value={60}>60×</option>
              <option value={600}>600×</option>
            </select>
            <button
              className="text-button"
              disabled={!canAct || running || tab === "report"}
              onClick={() => {
                void commit({ type: "advance", seconds: 60 });
              }}
            >
              Advance 60 s
            </button>
          </div>
          <button
            className="text-button event-button"
            onClick={() => setModal("history")}
          >
            Log<span>{session.events.length}</span>
          </button>
        </div>
      </main>
      <footer>
        <span>© Michele Giletto</span>
        <span>
          {session.difficulty === "precision"
            ? "3 km precision"
            : "15 km tolerance"}
        </span>
      </footer>
      {message && (
        <div className="toast" role="status">
          {message}
          <button
            aria-label="Dismiss notification"
            onClick={() => setMessage("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {modal && (
        <dialog
          ref={dialogRef}
          className="modal"
          onCancel={() => setModal(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div className="modal-heading">
            <h2>{modal === "model" ? "Physics model" : "Mission log"}</h2>
            <button aria-label="Close" onClick={() => setModal(null)}>
              <Icon name="close" />
            </button>
          </div>
          {modal === "model" ? (
            <>
              <p>
                Earth uses locally stored photographic composites. The training
                spacecraft follows two body gravity with a fixed 2 second step
                and fourth order Runge Kutta integration.
              </p>
              <dl>
                <div>
                  <dt>Gravitational parameter</dt>
                  <dd>398 600,4418 km³·s⁻²</dd>
                </div>
                <div>
                  <dt>Central body radius</dt>
                  <dd>6 371 km</dd>
                </div>
                <div>
                  <dt>Specific impulse</dt>
                  <dd>320 s</dd>
                </div>
                <div>
                  <dt>Dry mass</dt>
                  <dd>700 kg</dd>
                </div>
              </dl>
              <p>
                Maneuvers are impulsive. Propellant consumption follows the
                rocket equation. This exercise excludes drag, gravity harmonics,
                third bodies and burn duration. The 3D attitude is illustrative.
              </p>
              <p>
                Local mode uses synthetic data and retains the session on this
                device. Institutional use requires an authorized environment and
                the controls documented with the software.
              </p>
            </>
          ) : (
            <div className="event-list">
              {!session.events.length ? (
                <p>No commands executed.</p>
              ) : (
                session.events.map((e) => (
                  <div key={e.sequence}>
                    <time>{time(e.time)}</time>
                    <span>
                      {e.command.type === "burn"
                        ? `Impulse ${fmt(e.command.deltaV)} m·s⁻¹`
                        : `Propagation ${fmt(e.command.seconds, 0)} s`}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </dialog>
      )}
    </div>
  );
}
function Product() {
  return (
    <Hub
      renderMission={(mission, onBack) =>
        ["transfer", "deorbit"].includes(mission.family) ? (
          <FlightApp key={mission.id} mission={mission} onBack={onBack} />
        ) : (
          <Proximity key={mission.id} mission={mission} onBack={onBack} />
        )
      }
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <WorkspaceBoundary>
    <Product />
  </WorkspaceBoundary>,
);
