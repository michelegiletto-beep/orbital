import {
  readJSON,
  type APIConfiguration,
  type AuthenticationStatus,
  type APIError,
} from "./transport.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProximityScene } from "./ProximityScene.js";
import { Modal } from "./Modal.js";
import { Glyph, recordRun } from "./Library.js";
import { FAMILIES, type Mission } from "../../../packages/library/src/index.js";
import {
  relativeSession,
  relativeExecute,
  relativeReport,
  relativeReplay,
  waypoints,
  type RelativeCommand,
  type RelativeSession,
} from "../../../packages/sim-core/src/proximity.js";
import { norm } from "../../../packages/sim-core/src/index.js";
import "./proximity.css";
const number = (value: number, d = 2) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
export function Proximity({
  mission,
  onBack,
}: {
  mission: Mission;
  onBack: () => void;
}) {
  const key = "orbital.relative." + mission.id;
  const [session, setSession] = useState<RelativeSession>(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null");
        if (saved && saved.mission.revision === mission.revision)
          return relativeReplay(mission, saved.events);
      } catch {}
      return relativeSession(mission);
    }),
    [tab, setTab] = useState<"operations" | "assessment">("operations"),
    [error, setError] = useState(""),
    [cursor, setCursor] = useState<number | null>(null),
    [pulse, setPulse] = useState(0.05),
    [busy, setBusy] = useState(false),
    [model, setModel] = useState(false);
  const recorded = useRef(false),
    lock = useRef(false),
    serverId = useRef<string | null>(null);
  const [backend, setBackend] = useState(false),
    [authentication, setAuthentication] = useState(false);
  useEffect(() => {
    void fetch("/v1/config")
      .then((r) => (r.ok ? readJSON<APIConfiguration>(r) : null))
      .then(async (config) => {
        if (config?.auth === "local") setBackend(true);
        else if (config?.auth === "oidc") {
          setBackend(true);
          const status = await fetch("/v1/auth/session").then((r) =>
            readJSON<AuthenticationStatus>(r),
          );
          setAuthentication(!status.authenticated);
        }
      })
      .catch(() => {});
  }, []);
  const shown = useMemo(
    () =>
      cursor === null
        ? session
        : relativeReplay(mission, session.events, cursor),
    [cursor, session, mission],
  );
  const assessment = relativeReport(session),
    s = shown.state,
    points = waypoints(mission),
    terminal = s.captured || s.collision || authentication;
  function commit(command: RelativeCommand) {
    if (lock.current || authentication) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setTimeout(() => {
      void (async () => {
        try {
          let next: RelativeSession;
          if (backend) {
            if (!serverId.current) {
              const response = await fetch("/v1/proximity", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(mission),
              });
              if (!response.ok) throw Error("Session creation failed.");
              const payload = await readJSON<{ id: string }>(response);
              serverId.current = payload.id;
              for (const event of session.events) {
                const r = await fetch(`/v1/proximity/${payload.id}/commands`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(event.command),
                });
                if (!r.ok) {
                  serverId.current = null;
                  throw Error("Restore failed.");
                }
              }
            }
            const response = await fetch(
              `/v1/proximity/${serverId.current}/commands`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(command),
              },
            );
            if (response.status === 401) setAuthentication(true);
            if (!response.ok)
              throw Error((await readJSON<APIError>(response)).error);
            next = await readJSON<RelativeSession>(response);
          } else next = relativeExecute(session, command);
          setSession(next);
          setCursor(null);
          localStorage.setItem(
            key,
            JSON.stringify({ mission, events: next.events }),
          );
          const result = relativeReport(next);
          if (result.complete && !recorded.current) {
            recorded.current = true;
            recordRun(mission, result.score, true, {
              schema: "orbital.relative.aar.v1",
              mission,
              session: next,
              assessment: result,
              serverId: serverId.current,
            });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Command failed.");
        } finally {
          setBusy(false);
          lock.current = false;
        }
      })();
    }, 20);
  }
  function exportAAR() {
    const payload = {
      schema: "orbital.relative.aar.v1",
      mission,
      session,
      assessment,
      serverId: serverId.current,
      model: "Clohessy Wiltshire",
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "orbital-mission.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (!recorded.current) {
      recorded.current = true;
      recordRun(mission, assessment.score, assessment.complete, payload);
    }
  }
  const nextWaypoint = Math.min(s.checkpoint, points.length - 1),
    inspection = mission.family === "inspection",
    avoidance = mission.family === "avoidance",
    recovery = mission.family === "recovery";
  return (
    <div className="proximity-shell">
      <header className="proximity-header">
        <button className="return-library" onClick={onBack}>
          <Glyph name="back" />
          <span>Orbital</span>
        </button>
        <nav aria-label="Mission">
          <button
            className={tab === "operations" ? "selected" : ""}
            onClick={() => {
              setTab("operations");
              setCursor(null);
            }}
          >
            Operations
          </button>
          <button
            className={tab === "assessment" ? "selected" : ""}
            onClick={() => setTab("assessment")}
          >
            Assessment
          </button>
          <button onClick={() => setModel(true)}>Model</button>
        </nav>
        <span className="mission-type">{FAMILIES[mission.family]}</span>
      </header>
      <main className="proximity-workspace">
        <section className="proximity-visual">
          <ProximityScene
            state={s}
            range={mission.initialRange}
            recovery={recovery}
          />
          <div className="proximity-scene-title">
            <span>{FAMILIES[mission.family].toUpperCase()}</span>
            <h1>{mission.title}</h1>
          </div>
          <div className="range-readout">
            <span>RELATIVE SEPARATION</span>
            <strong>
              {number(norm(s.position), 1)}
              <small>m</small>
            </strong>
          </div>
          <div className="proximity-target-label">
            TARGET
            <span>
              {s.captured
                ? "Capture confirmed"
                : recovery
                  ? "Noncooperative"
                  : "Cooperative"}
            </span>
          </div>
          <div className="proximity-view-note">VEHICLE SCALE EXAGGERATED</div>
          <div className="relative-map">
            <svg
              viewBox="0 0 180 130"
              role="img"
              aria-label="Spacecraft relative track"
            >
              <path
                d="M10 65h160M90 10v110"
                stroke="#59778d"
                strokeWidth=".5"
              />
              <circle cx="90" cy="65" r="4" fill="#c8d7e5" />
              <polyline
                points={shown.track
                  .filter(
                    (_, i) =>
                      i % Math.max(1, Math.floor(shown.track.length / 250)) ===
                      0,
                  )
                  .map(
                    (p) =>
                      `${90 + (p[1] / mission.initialRange) * 65},${65 - (p[0] / mission.initialRange) * 50}`,
                  )
                  .join(" ")}
                fill="none"
                stroke="#a0c0da"
                strokeWidth="1"
              />
              <circle
                cx={90 + (s.position[1] / mission.initialRange) * 65}
                cy={65 - (s.position[0] / mission.initialRange) * 50}
                r="2.5"
                fill="#e7bd91"
              />
            </svg>
          </div>
        </section>
        <aside className="proximity-controls">
          {authentication && (
            <div className="auth-required">
              <p>Sign in with your institutional identity.</p>
              <a className="solid-action wide-action" href="/v1/auth/login">
                Sign in
                <Glyph name="arrow" />
              </a>
            </div>
          )}
          <div className="relative-heading">
            <span>REV {mission.revision}</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                const next = relativeSession(mission);
                setSession(next);
                setCursor(null);
                setError("");
                recorded.current = false;
                serverId.current = null;
                localStorage.removeItem(key);
              }}
            >
              Restart
              <Glyph name="history" />
            </button>
          </div>
          {tab === "operations" ? (
            <>
              <h2>
                {assessment.complete
                  ? "Objective achieved"
                  : inspection
                    ? "Observation points"
                    : avoidance
                      ? "Separation"
                      : "Approach"}
              </h2>
              <p className="operation-description">{mission.description}</p>
              <div className="relative-checkpoints">
                {points.map((point, i) => (
                  <div key={i} className={s.checkpoint > i ? "reached" : ""}>
                    <span>
                      {s.checkpoint > i ? (
                        <Glyph name="check" />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <strong>
                      {inspection
                        ? `Point ${i + 1}`
                        : avoidance
                          ? "Safe separation"
                          : i === points.length - 1
                            ? "Contact"
                            : `${number(norm(point), 0)} m`}
                    </strong>
                    {s.checkpoint > i && <small>Reached</small>}
                  </div>
                ))}
              </div>
              {assessment.complete ? (
                <button
                  className="solid-action wide-action"
                  onClick={() => setTab("assessment")}
                >
                  Assess mission
                  <Glyph name="arrow" />
                </button>
              ) : (
                <>
                  <button
                    className="solid-action wide-action"
                    disabled={busy || terminal || s.checkpoint >= points.length}
                    onClick={() =>
                      commit({ type: "guide", waypoint: nextWaypoint })
                    }
                  >
                    {busy
                      ? "Computing"
                      : avoidance
                        ? "Begin departure"
                        : inspection
                          ? "Reach waypoint"
                          : s.checkpoint === points.length - 1
                            ? "Final approach"
                            : "Reach hold point"}
                    <Glyph name="arrow" />
                  </button>
                  {inspection ? (
                    <button
                      className="outline-action wide-action"
                      disabled={
                        busy || terminal || s.observations >= s.checkpoint
                      }
                      onClick={() => commit({ type: "observe" })}
                    >
                      Acquire observation
                      <Glyph name="check" />
                    </button>
                  ) : (
                    !avoidance && (
                      <>
                        <button
                          className="outline-action wide-action"
                          disabled={busy || terminal}
                          onClick={() => commit({ type: "attitude" })}
                        >
                          Synchronize attitude
                          <Glyph name="check" />
                        </button>
                        <button
                          className="outline-action wide-action"
                          disabled={busy || terminal || s.checkpoint < 3}
                          onClick={() => commit({ type: "capture" })}
                        >
                          {recovery ? "Capture target" : "Confirm docking"}
                          <Glyph name="check" />
                        </button>
                      </>
                    )
                  )}
                  <div className="relative-manual">
                    <div className="relative-manual-title">
                      <h3>Manual control</h3>
                      <label>
                        Δv
                        <input
                          aria-label="Thruster impulse"
                          type="number"
                          min={0.01}
                          max={0.5}
                          step={0.01}
                          value={pulse}
                          onChange={(e) => setPulse(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    {(["Radial", "Along track", "Normal"] as const).map(
                      (name, i) => (
                        <div className="relative-thrust" key={name}>
                          <span>{name}</span>
                          <button
                            disabled={busy || terminal}
                            aria-label={`Negative impulse ${name.toLowerCase()}`}
                            onClick={() =>
                              commit({
                                type: "thrust",
                                axis: i as 0 | 1 | 2,
                                deltaV: -pulse,
                              })
                            }
                          >
                            −
                          </button>
                          <button
                            disabled={busy || terminal}
                            aria-label={`Positive impulse ${name.toLowerCase()}`}
                            onClick={() =>
                              commit({
                                type: "thrust",
                                axis: i as 0 | 1 | 2,
                                deltaV: pulse,
                              })
                            }
                          >
                            +
                          </button>
                        </div>
                      ),
                    )}
                    <div className="relative-time">
                      <button
                        className="outline-action"
                        disabled={busy || terminal}
                        onClick={() => commit({ type: "advance", seconds: 10 })}
                      >
                        Advance 10 s
                      </button>
                      <button
                        className="outline-action"
                        disabled={busy || terminal}
                        onClick={() => commit({ type: "advance", seconds: 60 })}
                      >
                        Advance 60 s
                      </button>
                    </div>
                  </div>
                </>
              )}
              <div className="relative-objectives">
                <h3>Competencies</h3>
                {assessment.objectives.map((o) => (
                  <p key={o.id} className={o.achieved ? "achieved" : ""}>
                    <span>{o.achieved ? <Glyph name="check" /> : "○"}</span>
                    {o.title}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <div className="relative-assessment">
              <h2>Assessment</h2>
              <div className="relative-score">
                {assessment.score}
                <span>points</span>
              </div>
              <p>{assessment.recommendation}</p>
              <dl>
                <div>
                  <dt>Final separation</dt>
                  <dd>{number(assessment.metrics.distance)} m</dd>
                </div>
                <div>
                  <dt>Relative velocity</dt>
                  <dd>{number(assessment.metrics.speed, 3)} m·s⁻¹</dd>
                </div>
                <div>
                  <dt>Total delta V</dt>
                  <dd>{number(assessment.metrics.deltaV, 3)} m·s⁻¹</dd>
                </div>
                <div>
                  <dt>Mission elapsed</dt>
                  <dd>{number(assessment.metrics.time, 0)} s</dd>
                </div>
              </dl>
              <label className="relative-replay" htmlFor="relative-replay">
                Replay
                <span>
                  {cursor ?? session.events.length} of {session.events.length}
                </span>
              </label>
              <input
                id="relative-replay"
                type="range"
                min={0}
                max={session.events.length}
                value={cursor ?? session.events.length}
                onChange={(e) => setCursor(Number(e.target.value))}
              />
              <button className="solid-action wide-action" onClick={exportAAR}>
                Export assessment
                <Glyph name="download" />
              </button>
            </div>
          )}
        </aside>
        <section className="relative-telemetry" aria-label="Relative telemetry">
          <div>
            <span>Relative velocity</span>
            <strong>
              {number(norm(s.velocity), 3)}
              <small>m·s⁻¹</small>
            </strong>
          </div>
          <div>
            <span>Delta V used</span>
            <strong>
              {number(s.spent, 2)}
              <small>m·s⁻¹</small>
            </strong>
          </div>
          <div>
            <span>Attitude error</span>
            <strong>
              {number(Math.abs(s.angle), 1)}
              <small>°</small>
            </strong>
          </div>
          <div>
            <span>Mission elapsed</span>
            <strong>
              {number(s.time, 0)}
              <small>s</small>
            </strong>
          </div>
          <div>
            <span>Remaining budget</span>
            <strong>
              {number(mission.budget - s.spent, 2)}
              <small>m·s⁻¹</small>
            </strong>
          </div>
        </section>
      </main>
      <footer>
        <span>© Michele Giletto</span>
        <span>
          {mission.family === "recovery"
            ? "Noncooperative target"
            : "Relative dynamics"}
        </span>
      </footer>
      {error && (
        <div className="library-error" role="alert">
          {error}
          <button
            className="icon-action"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <Glyph name="close" />
          </button>
        </div>
      )}
      {model && (
        <Modal label="Proximity dynamics" onClose={() => setModel(false)}>
          <section
            className="history-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Proximity dynamics"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2>Proximity dynamics</h2>
              <button
                className="icon-action"
                aria-label="Close model"
                onClick={() => setModel(false)}
              >
                <Glyph name="close" />
              </button>
            </div>
            <p>
              Linear Clohessy Wiltshire dynamics in the local orbital frame of a
              target on a circular orbit. Runge Kutta integration at a 0.25
              second step. Coordinates are in meters and velocity in meters per
              second.
            </p>
            <p>
              Guidance applies impulses to the physics model with relative
              dynamics compensation. Each impulse updates mass and budget.
              Attitude synchronization uses a simplified scalar regulator rather
              than full rigid body dynamics.
            </p>
            <p>
              Capture requires separation within {mission.tolerance} m, velocity
              within {mission.closingSpeed} m/s and attitude error within 3°.
              Spacecraft are visually enlarged for readability. The map and
              telemetry show model values.
            </p>
          </section>
        </Modal>
      )}
    </div>
  );
}
