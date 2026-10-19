import { useEffect, useMemo, useRef, useState } from "react";
import {
  validateMission,
  type Library,
  type Mission,
} from "../../../packages/library/src/index.js";
import { assetPath } from "./assets.js";
import {
  advancedMissionReport,
  measureAdvancedMission,
  scenarioFromMission,
  type AdvancedMissionCommand,
  type AdvancedMissionSession,
  type AdvancedMissionScenario,
  type MissionJournalEntry,
} from "../../../packages/sim-core/src/missions.js";
import { FlightScene } from "./FlightScene.js";
import { ProximityScene } from "./ProximityScene.js";
import {
  HubIcon,
  LineChart,
  elapsed,
  number,
  exportFile,
} from "./Simulation.js";
import { Modal } from "./Modal.js";
import "./missions.css";

type Envelope = {
  id: string;
  mission: Mission;
  session: AdvancedMissionSession;
  sequence: number;
  receipt: { sequence: number; hash: string };
};
type Archive = {
  schema: "orbital.mission.archive.v1";
  mission: Mission;
  scenario: AdvancedMissionScenario;
  journal: MissionJournalEntry[];
  serverId?: string;
  deviceId?: string;
  updatedAt: string;
};
const prefix = "orbital.mission.v1.";
const historyPrefix = "orbital.mission.history.v1.";
const keyFor = (mission: Mission) =>
  prefix + mission.clientId + "." + mission.id + "." + mission.revision;
function useClientNames() {
  const [names, setNames] = useState<Record<string, string>>({
    general: "General library",
  });
  useEffect(() => {
    let active = true;
    const accept = (library: Library) => {
      if (active && Array.isArray(library.clients))
        setNames((previous) => ({
          ...previous,
          ...Object.fromEntries(
            library.clients.map((client) => [client.id, client.name]),
          ),
        }));
    };
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)!;
        if (key === "orbital.library.v1" || key.startsWith("orbital.client."))
          accept(JSON.parse(localStorage.getItem(key)!));
      }
    } catch {}
    void fetch(assetPath("orbital-library.json"), {
      signal: AbortSignal.timeout(4000),
    })
      .then(async (response) => {
        if (
          response.ok &&
          response.headers.get("content-type")?.includes("application/json")
        ) {
          accept(await response.json());
          return;
        }
        const backend = await fetch("/v1/library", {
          signal: AbortSignal.timeout(4000),
        });
        if (backend.ok) accept(await backend.json());
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return names;
}
const request = async <T,>(url: string, body?: unknown): Promise<T> => {
  const response = await fetch(url, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(120000),
  });
  const payload = await response.json().catch(() => ({
    error: "The mission service returned an invalid response",
  }));
  if (!response.ok) throw Error(payload.error ?? "Mission service unavailable");
  return payload as T;
};
export function AdvancedMission({
  mission,
  onBack,
  runId,
}: {
  mission: Mission;
  onBack: () => void;
  runId?: string;
}) {
  const [session, setSession] = useState<AdvancedMissionSession | null>(null),
    [historical, setHistorical] = useState<AdvancedMissionSession | null>(null),
    [cursor, setCursor] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [authority, setAuthority] = useState("Connecting"),
    [tab, setTab] = useState<"operate" | "review">("operate"),
    [view, setView] = useState<"relative" | "orbit" | "ground">(
      mission.family === "deorbit" ? "orbit" : "relative",
    ),
    [seconds, setSeconds] = useState(60),
    [impulse, setImpulse] = useState(0.1),
    [thrust, setThrust] = useState(800),
    [burn, setBurn] = useState<"finite" | "impulse">("finite"),
    [resetting, setResetting] = useState(false),
    [limits, setLimits] = useState(false);
  const worker = useRef<Worker | null>(null),
    calls = useRef(
      new Map<
        number,
        {
          resolve: (s: AdvancedMissionSession) => void;
          reject: (error: Error) => void;
        }
      >(),
    ),
    serial = useRef(0),
    live = useRef(true),
    locked = useRef(false),
    serverId = useRef<string | undefined>(undefined),
    deviceId = useRef<string | undefined>(undefined),
    mode = useRef<"server" | "device" | "blocked">("blocked"),
    current = useRef<AdvancedMissionSession | null>(null),
    replayGeneration = useRef(0);
  const scenario = useMemo(() => scenarioFromMission(mission), [mission]);
  const clientNames = useClientNames();
  const calculate = (payload: object) =>
    new Promise<AdvancedMissionSession>((resolve, reject) => {
      const id = ++serial.current;
      calls.current.set(id, { resolve, reject });
      worker.current!.postMessage({ id, ...payload });
    });
  const persist = (s: AdvancedMissionSession) => {
    const archive: Archive = {
      schema: "orbital.mission.archive.v1",
      mission,
      scenario: s.scenario,
      journal: s.journal,
      serverId: serverId.current,
      deviceId: deviceId.current,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(keyFor(mission), JSON.stringify(archive));
      if (mode.current === "device" && deviceId.current)
        localStorage.setItem(
          historyPrefix + deviceId.current,
          JSON.stringify(archive),
        );
    } catch {
      setNotice(
        "Device storage is full. Export the command archive before leaving.",
      );
    }
  };
  const accept = (s: AdvancedMissionSession) => {
    current.current = s;
    setSession(s);
    setCursor(s.journal.length);
    setHistorical(null);
    persist(s);
  };
  const boot = async (fresh = false) => {
    replayGeneration.current++;
    setBusy(true);
    locked.current = true;
    setError("");
    setHistorical(null);
    try {
      let stored: Archive | null = null;
      if (!fresh) {
        try {
          const raw = localStorage.getItem(
            runId?.startsWith("device:")
              ? historyPrefix + runId.slice(7)
              : keyFor(mission),
          );
          if (raw) stored = JSON.parse(raw);
        } catch {
          setNotice(
            "The device archive could not be read. A new run will be created.",
          );
        }
      }
      let api = false;
      try {
        const r = await fetch("/v1/config", {
          signal: AbortSignal.timeout(4000),
        });
        api =
          r.ok &&
          (r.headers.get("content-type") ?? "").includes("application/json");
      } catch {}
      if (api && !runId?.startsWith("device:")) {
        mode.current = "server";
        setAuthority("Signed workspace record");
        const id = !fresh ? (runId ?? stored?.serverId) : undefined;
        const result = id
          ? await request<Envelope>("/v1/mission-runs/" + id)
          : await request<Envelope>("/v1/mission-runs", {
              missionId: mission.id,
              revision: mission.revision,
            });
        if (
          result.mission.id !== mission.id ||
          result.mission.clientId !== mission.clientId ||
          result.mission.revision !== mission.revision ||
          JSON.stringify(result.session.scenario) !==
            JSON.stringify(scenarioFromMission(result.mission)) ||
          JSON.stringify(result.session.scenario) !== JSON.stringify(scenario)
        )
          throw Error(
            "The saved run belongs to a different scenario revision. Open its original assessment from After action or start a new attempt.",
          );
        serverId.current = result.id;
        if (live.current) accept(result.session);
      } else {
        if ((runId && !runId.startsWith("device:")) || stored?.serverId)
          throw Error(
            "Reconnect to the mission service to restore this signed run.",
          );
        mode.current = "device";
        serverId.current = undefined;
        deviceId.current = (!fresh && stored?.deviceId) || crypto.randomUUID();
        setAuthority("Device calculation");
        const same =
          stored?.schema === "orbital.mission.archive.v1" &&
          JSON.stringify(stored.scenario) === JSON.stringify(scenario);
        const s = same
          ? await calculate({
              type: "replay",
              scenario,
              journal: stored!.journal,
            })
          : await calculate({ type: "create", scenario });
        if (live.current) accept(s);
      }
    } catch (e) {
      if (live.current) {
        setError(
          e instanceof Error ? e.message : "Mission initialization failed",
        );
        mode.current = "blocked";
        setAuthority("Service required");
      }
    } finally {
      if (live.current) {
        setBusy(false);
        locked.current = false;
      }
    }
  };
  useEffect(() => {
    live.current = true;
    const w = new Worker(
      new URL("./workers/mission.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = (e) => {
      const call = calls.current.get(e.data.id);
      if (!call) return;
      calls.current.delete(e.data.id);
      e.data.error
        ? call.reject(Error(e.data.error))
        : call.resolve(e.data.result);
    };
    w.onerror = () => {
      for (const call of calls.current.values())
        call.reject(Error("Mission calculation worker failed"));
      calls.current.clear();
    };
    void boot();
    return () => {
      live.current = false;
      w.terminate();
      for (const call of calls.current.values())
        call.reject(Error("Workspace closed"));
      calls.current.clear();
    };
  }, [mission.id, mission.revision, runId]);
  const commit = async (command: AdvancedMissionCommand) => {
    if (locked.current || !current.current || mode.current === "blocked")
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const next =
        mode.current === "server"
          ? (
              await request<Envelope>(
                `/v1/mission-runs/${serverId.current}/commands`,
                { sequence: current.current.journal.length, command },
              )
            ).session
          : await calculate({
              type: "command",
              session: current.current,
              command,
            });
      if (live.current) accept(next);
    } catch (e) {
      if (live.current)
        setError(e instanceof Error ? e.message : "Command rejected");
    } finally {
      if (live.current) {
        setBusy(false);
        locked.current = false;
      }
    }
  };
  const replayTo = async (value: number) => {
    if (!session || locked.current) return;
    const generation = ++replayGeneration.current;
    setCursor(value);
    if (value === session.journal.length) {
      setHistorical(null);
      return;
    }
    try {
      const s = await calculate({
        type: "replay",
        scenario: session.scenario,
        journal: session.journal,
        through: value,
      });
      if (live.current && replayGeneration.current === generation)
        setHistorical(s);
    } catch (e) {
      if (live.current)
        setError(e instanceof Error ? e.message : "Replay failed");
    }
  };
  const shown = historical ?? session,
    measured = shown ? measureAdvancedMission(shown) : null,
    report = shown ? advancedMissionReport(shown) : null,
    deorbit = mission.family === "deorbit",
    replaying = !!session && cursor !== session.journal.length,
    terminal =
      !!shown &&
      (shown.state.captured ||
        shown.state.collision ||
        shown.state.aborted ||
        !!shown.state.entry),
    disabled = busy || replaying || terminal || !session;
  const commandText = (c: AdvancedMissionCommand) =>
    c.type === "guide"
      ? `Acquire hold ${c.waypoint + 1}`
      : c.type === "advance"
        ? `Coast ${c.seconds} s`
        : c.type === "impulse"
          ? `${["Radial", "Along track", "Cross track"][c.axis]} impulse ${c.deltaV} m·s⁻¹`
          : c.type === "deorbit"
            ? `${c.kind === "finite" ? "Finite" : "Impulsive"} deorbit burn`
            : c.type === "attitude"
              ? "Synchronize roll for 60 s"
              : c.type === "capture"
                ? "Command soft capture"
                : "Abort mission";
  return (
    <div className="advanced-mission">
      <header className="mission-commandbar">
        <button className="mission-back" onClick={onBack}>
          <HubIcon name="back" />
          Library
        </button>
        <div className="mission-identity">
          <h1>{mission.title}</h1>
          <span>
            {clientNames[mission.clientId] ?? "Client workspace"} <b>·</b>{" "}
            Revision {mission.revision}
          </span>
        </div>
        <div className="mission-authority">
          <i className={mode.current === "server" ? "" : "warning"} />
          {authority}
        </div>
        <button
          className="hub-icon-button"
          aria-label="Mission model and limits"
          onClick={() => setLimits(true)}
        >
          <HubIcon name="book" />
        </button>
      </header>
      <div className="mission-tabs">
        <button
          className={tab === "operate" ? "active" : ""}
          onClick={() => setTab("operate")}
        >
          Operations
        </button>
        <button
          className={tab === "review" ? "active" : ""}
          onClick={() => setTab("review")}
        >
          After action
        </button>
        <div className="mission-runtime">
          <i />
          {busy ? "Calculating" : (report?.status ?? "Initializing")}
          <time>{elapsed(shown?.workspace.time ?? 0)}</time>
        </div>
      </div>
      {error && (
        <div className="mission-message error" role="alert">
          {error}
          <button onClick={() => void boot()}>Reload saved run</button>
        </div>
      )}
      {notice && (
        <div className="mission-message" role="status">
          {notice}
          <button onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
      {!shown ? (
        <div className="mission-empty">
          {busy
            ? "Loading mission state"
            : "Connect the workspace service to continue"}
          {!busy && (
            <>
              <button onClick={() => void boot(true)}>
                Start a new attempt
              </button>
              <a href="/v1/auth/login">Institutional sign in</a>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mission-metrics" aria-label="Mission telemetry">
            {(deorbit
              ? [
                  ["Altitude", measured!.altitude, "km", 2],
                  ["Perigee", measured!.perigee, "km", 2],
                  ["Delta V", measured!.deltaV, "m·s⁻¹", 2],
                  ["Propellant used", report!.metrics.propellantUsed, "kg", 2],
                ]
              : [
                  ["Separation", measured!.distance, "m", 3],
                  ["Relative speed", measured!.speed, "m·s⁻¹", 4],
                  ["Roll error", measured!.angle, "°", 2],
                  ["Delta V", measured!.deltaV, "m·s⁻¹", 2],
                ]
            ).map(([label, value, unit, decimals]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>
                  {number(Number(value), Number(decimals))}
                  <small>{unit}</small>
                </strong>
              </div>
            ))}
          </div>
          {tab === "operate" ? (
            <div className="mission-workspace">
              <section className="mission-viewport">
                <div className="mission-viewbar">
                  <span>
                    {deorbit
                      ? "Earth centred inertial"
                      : view === "relative"
                        ? "Target reference frame"
                        : "Earth centred inertial"}
                  </span>
                  <div>
                    {(!deorbit
                      ? (["relative", "orbit"] as const)
                      : (["orbit", "ground"] as const)
                    ).map((v) => (
                      <button
                        key={v}
                        className={view === v ? "active" : ""}
                        onClick={() => setView(v)}
                      >
                        {v === "relative"
                          ? "Approach"
                          : v === "orbit"
                            ? "Earth"
                            : "Ground track"}
                      </button>
                    ))}
                  </div>
                </div>
                {view === "relative" ? (
                  <ProximityScene
                    state={{
                      position: measured!.position,
                      time: measured!.time,
                      angle: measured!.angle,
                      captured: shown.state.captured,
                    }}
                    range={Math.max(
                      5,
                      Math.min(
                        scenario.holdPoints[0] * 2,
                        measured!.distance * 1.3,
                      ),
                    )}
                    recovery={mission.family === "recovery"}
                    targetRate={scenario.attitude.targetRate}
                  />
                ) : (
                  <FlightScene
                    workspace={shown.workspace}
                    selected={scenario.chaser.id}
                    prediction={[]}
                    view={view}
                    onSelect={() => {}}
                  />
                )}
                <div className="mission-viewport-footer">
                  <span>
                    {deorbit
                      ? "Entry interface 120 km"
                      : "Vehicle scale exaggerated"}
                  </span>
                  <span>
                    {scenario.model.gravity === "j2" ? "J2" : "Two body"}{" "}
                    <b>·</b>{" "}
                    {scenario.model.drag ? "Drag enabled" : "Drag disabled"}{" "}
                    <b>·</b> {scenario.model.step} s integration
                  </span>
                </div>
              </section>
              <aside className="mission-console">
                <div className="mission-panel-heading">
                  <h2>{deorbit ? "Deorbit sequence" : "Approach sequence"}</h2>
                  <span>
                    {deorbit
                      ? shown.state.entry
                        ? "Entry"
                        : shown.state.deorbitBurn
                          ? "Coast"
                          : "Burn"
                      : `${shown.state.checkpoint} of ${scenario.holdPoints.length} holds`}
                  </span>
                </div>
                {deorbit ? (
                  <>
                    <div className="mission-form-pair">
                      <label>
                        Burn model
                        <select
                          value={burn}
                          onChange={(e) =>
                            setBurn(e.target.value as "finite" | "impulse")
                          }
                          disabled={disabled || shown.state.deorbitBurn}
                        >
                          <option value="finite">Finite thrust</option>
                          <option value="impulse">Impulsive</option>
                        </select>
                      </label>
                      <label>
                        Thrust in N
                        <input
                          type="number"
                          min={10}
                          max={20000}
                          step={10}
                          value={thrust}
                          disabled={
                            disabled ||
                            burn === "impulse" ||
                            shown.state.deorbitBurn
                          }
                          onChange={(e) => setThrust(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <div className="mission-target">
                      <span>Target perigee</span>
                      <strong>{scenario.deorbit.perigee} km</strong>
                    </div>
                    <button
                      className="mission-primary"
                      disabled={disabled || shown.state.deorbitBurn}
                      onClick={() =>
                        void commit({
                          type: "deorbit",
                          kind: burn,
                          ...(burn === "finite" ? { thrust } : {}),
                        })
                      }
                    >
                      Execute deorbit burn
                      <HubIcon name="play" />
                    </button>
                    <button
                      disabled={disabled || !shown.state.deorbitBurn}
                      onClick={() =>
                        void commit({ type: "advance", seconds: 10800 })
                      }
                    >
                      Coast to entry interface
                    </button>
                  </>
                ) : (
                  <>
                    <ol className="mission-sequence">
                      {scenario.holdPoints.map((distance, i) => (
                        <li
                          key={i}
                          className={
                            i < shown.state.checkpoint
                              ? "done"
                              : i === shown.state.checkpoint
                                ? "current"
                                : ""
                          }
                        >
                          <span>
                            {i < shown.state.checkpoint
                              ? "✓"
                              : String(i + 1).padStart(2, "0")}
                          </span>
                          <div>
                            <strong>{distance} m hold</strong>
                            <small>
                              {i < shown.state.checkpoint
                                ? "Acquired"
                                : i === shown.state.checkpoint
                                  ? "Next maneuver"
                                  : "Pending"}
                            </small>
                          </div>
                          <button
                            disabled={disabled || i > shown.state.checkpoint}
                            onClick={() =>
                              void commit({ type: "guide", waypoint: i })
                            }
                          >
                            {i < shown.state.checkpoint
                              ? "Reacquire"
                              : "Acquire"}
                          </button>
                        </li>
                      ))}
                    </ol>
                    <div className="mission-capture">
                      <button
                        disabled={disabled}
                        onClick={() => void commit({ type: "attitude" })}
                      >
                        Synchronize roll
                      </button>
                      <button
                        className="mission-primary"
                        disabled={disabled || !measured!.captureReady}
                        onClick={() => void commit({ type: "capture" })}
                      >
                        {shown.state.captured ? "Captured" : "Soft capture"}
                      </button>
                    </div>
                    <div className="capture-limits">
                      <span className={measured!.withinCorridor ? "met" : ""}>
                        Corridor
                      </span>
                      <span
                        className={
                          measured!.distance <= scenario.capture.distance
                            ? "met"
                            : ""
                        }
                      >
                        Distance ≤ {scenario.capture.distance} m
                      </span>
                      <span
                        className={
                          measured!.speed <= scenario.capture.speed ? "met" : ""
                        }
                      >
                        Speed ≤ {scenario.capture.speed} m·s⁻¹
                      </span>
                      <span
                        className={
                          Math.abs(measured!.angularRate) <=
                          scenario.capture.angularRate
                            ? "met"
                            : ""
                        }
                      >
                        Rotation ≤ {scenario.capture.angularRate} °·s⁻¹
                      </span>
                    </div>
                  </>
                )}
                <details className="manual-controls">
                  <summary>Manual control</summary>
                  <label>
                    RTN impulse in metres per second
                    <input
                      type="number"
                      value={impulse}
                      min={0.01}
                      max={5}
                      step={0.01}
                      onChange={(e) => setImpulse(Number(e.target.value))}
                      disabled={disabled}
                    />
                  </label>
                  <div className="mission-thrusters">
                    {([0, 1, 2] as const).map((axis) => (
                      <div key={axis}>
                        <span>
                          {["Radial", "Along track", "Cross track"][axis]}
                        </span>
                        <button
                          aria-label={`Negative ${["radial", "along track", "cross track"][axis]} impulse`}
                          disabled={disabled}
                          onClick={() =>
                            void commit({
                              type: "impulse",
                              axis,
                              deltaV: -impulse,
                            })
                          }
                        >
                          −
                        </button>
                        <button
                          aria-label={`Positive ${["radial", "along track", "cross track"][axis]} impulse`}
                          disabled={disabled}
                          onClick={() =>
                            void commit({
                              type: "impulse",
                              axis,
                              deltaV: impulse,
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
                <div className="mission-coast">
                  <label>
                    Coast in seconds
                    <input
                      type="number"
                      min={0.5}
                      max={10800}
                      step={0.5}
                      value={seconds}
                      onChange={(e) => setSeconds(Number(e.target.value))}
                      disabled={disabled}
                    />
                  </label>
                  <button
                    disabled={disabled}
                    onClick={() => void commit({ type: "advance", seconds })}
                  >
                    Propagate
                  </button>
                </div>
                <button
                  className="mission-abort"
                  disabled={disabled}
                  onClick={() => void commit({ type: "abort" })}
                >
                  Abort mission
                </button>
              </aside>
            </div>
          ) : (
            <div className="mission-review">
              <section>
                <div className="mission-panel-heading">
                  <h2>Assessment</h2>
                  <strong className={report!.complete ? "assessment-pass" : ""}>
                    {report!.score}%
                  </strong>
                </div>
                <div className="mission-objectives">
                  {report!.objectives.map((o) => (
                    <div key={o.id} className={o.achieved ? "achieved" : ""}>
                      <span>{o.achieved ? "✓" : "○"}</span>
                      <p>{o.title}</p>
                      <small>{o.achieved ? "Achieved" : "Pending"}</small>
                    </div>
                  ))}
                </div>
                <p className="mission-recommendation">
                  {report!.recommendation}
                </p>
                <dl className="mission-evidence">
                  <div>
                    <dt>Fuel consumed</dt>
                    <dd>{number(report!.metrics.propellantUsed, 3)} kg</dd>
                  </div>
                  <div>
                    <dt>
                      {deorbit ? "Entry radial velocity" : "Minimum separation"}
                    </dt>
                    <dd>
                      {deorbit
                        ? shown.state.entry
                          ? number(shown.state.entry.radialVelocity, 3) +
                            " m·s⁻¹"
                          : "Entry pending"
                        : number(report!.metrics.minimumRange, 4) + " m"}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {deorbit ? "Entry altitude" : "Corridor excursions"}
                    </dt>
                    <dd>
                      {deorbit
                        ? shown.state.entry
                          ? number(shown.state.entry.altitude, 6) + " km"
                          : "Entry pending"
                        : report!.metrics.corridorExcursions}
                    </dd>
                  </div>
                  <div>
                    <dt>Roll rate error</dt>
                    <dd>{number(measured!.angularRate, 4)} °·s⁻¹</dd>
                  </div>
                  <div>
                    <dt>Delta V remaining</dt>
                    <dd>
                      {number(scenario.budget - measured!.deltaV, 3)} m·s⁻¹
                    </dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{authority}</dd>
                  </div>
                </dl>
                <button
                  onClick={() =>
                    exportFile(
                      {
                        schema: "orbital.mission.report.v1",
                        mission,
                        report,
                        source: serverId.current ?? "device",
                        scenario: shown.scenario,
                        journal: shown.journal,
                      },
                      "orbital-mission-report.json",
                    )
                  }
                >
                  Export assessment
                </button>
              </section>
              <section className="mission-plots">
                <LineChart
                  values={
                    deorbit
                      ? shown.workspace.history
                          .filter((s) => s.vehicleId === scenario.chaser.id)
                          .map((s) => s.altitude)
                      : shown.track.map((t) => t.distance)
                  }
                  label={deorbit ? "Altitude" : "Relative separation"}
                  unit={deorbit ? "km" : "m"}
                />
                <LineChart
                  values={
                    deorbit
                      ? shown.workspace.history
                          .filter((s) => s.vehicleId === scenario.chaser.id)
                          .map((s) => s.mass - scenario.chaser.dryMass)
                      : shown.track.map((t) => t.speed)
                  }
                  label={deorbit ? "Propellant remaining" : "Relative speed"}
                  unit={deorbit ? "kg" : "m·s⁻¹"}
                  color="#53d6bc"
                />
                <div className="model-note">
                  {deorbit ? report!.model.boundary : report!.model.attitude}
                </div>
              </section>
            </div>
          )}
          <section className="mission-journal">
            <div className="mission-panel-heading">
              <h2>Command journal</h2>
              <span>{session!.journal.length} commands</span>
              <button
                onClick={() =>
                  exportFile(
                    {
                      schema: "orbital.mission.archive.v1",
                      mission,
                      scenario: session!.scenario,
                      journal: session!.journal,
                    },
                    "orbital-mission-archive.json",
                  )
                }
              >
                Export archive
              </button>
            </div>
            <div className="mission-replay">
              <button
                disabled={busy || cursor === 0}
                onClick={() => void replayTo(cursor - 1)}
                aria-label="Previous command"
              >
                ←
              </button>
              <label>
                Replay
                <input
                  type="range"
                  min={0}
                  max={session!.journal.length}
                  value={cursor}
                  disabled={busy}
                  onChange={(e) => void replayTo(Number(e.target.value))}
                />
              </label>
              <button
                disabled={busy || cursor === session!.journal.length}
                onClick={() => void replayTo(cursor + 1)}
                aria-label="Next command"
              >
                →
              </button>
              <button
                disabled={busy || !replaying}
                onClick={() => void replayTo(session!.journal.length)}
              >
                Live state
              </button>
              <span>
                {cursor} of {session!.journal.length}
              </span>
            </div>
            <div className="mission-command-list">
              {session!.journal.length ? (
                session!.journal.map((e, i) => (
                  <button
                    key={i}
                    className={cursor === i + 1 ? "selected" : ""}
                    disabled={busy}
                    onClick={() => void replayTo(i + 1)}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <time>{elapsed(e.time)}</time>
                    <strong>{commandText(e.command)}</strong>
                    <small>{cursor === i + 1 ? "Viewing" : "Replay"}</small>
                  </button>
                ))
              ) : (
                <p>No commands executed.</p>
              )}
            </div>
          </section>
          <footer className="mission-footer">
            <span>
              {busy
                ? "The integrator is calculating. Commands are locked until completion."
                : replaying
                  ? "Historical state. Return to live state to operate."
                  : report!.recommendation}
            </span>
            <button disabled={busy} onClick={() => setResetting(true)}>
              New attempt
            </button>
          </footer>
        </>
      )}
      {resetting && (
        <Modal
          label="Start a new attempt"
          onClose={() => setResetting(false)}
          className="mission-modal"
        >
          <h2>Start a new attempt</h2>
          <p>
            The signed workspace record remains available in After action.
            Export a device archive before replacing a local attempt.
          </p>
          <button
            onClick={() => {
              setResetting(false);
              void boot(true);
            }}
          >
            Start attempt
          </button>
          <button onClick={() => setResetting(false)}>Cancel</button>
        </Modal>
      )}
      {limits && (
        <Modal
          label="Mission model"
          onClose={() => setLimits(false)}
          className="mission-modal"
        >
          <h2>Mission model</h2>
          <p>
            Both vehicles are propagated in Earth centred inertial coordinates
            with fixed step fourth order Runge Kutta integration. Approach
            control applies bounded finite thrust with rocket equation mass
            accounting.
          </p>
          <p>
            Recovery tracks a passive target through a bounded single axis roll
            controller. Soft capture is a terminal condition based on hold
            points, corridor, distance, speed, roll and angular rate. No contact
            dynamics are modeled.
          </p>
          <p>
            Deorbiting ends at the descending 120 km boundary. The engineering
            atmosphere is static. Atmospheric entry, ground impact, debris
            breakup, navigation uncertainty and flight certification are outside
            this model.
          </p>
          <p>
            Earth imagery uses locally bundled historical composites. Scenario
            snapshots and ordered command journals reproduce the numerical
            result within this engine version.
          </p>
          <button onClick={() => setLimits(false)}>Close</button>
        </Modal>
      )}
    </div>
  );
}

export function AdvancedResults({
  onOpen,
}: {
  onOpen: (mission: Mission, runId: string) => void;
}) {
  type Row = {
    id: string;
    mission: Mission;
    sequence: number;
    updatedAt: string;
    report: ReturnType<typeof advancedMissionReport>;
    authority: "Signed workspace" | "Device calculation";
  };
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(true);
  const names = useClientNames();
  const [source, setSource] = useState("Checking workspace service");
  useEffect(() => {
    let active = true;
    let calculation: Worker | undefined;
    void (async () => {
      let api = false;
      try {
        const config = await fetch("/v1/config", {
          signal: AbortSignal.timeout(4000),
        });
        api =
          config.ok &&
          !!config.headers.get("content-type")?.includes("application/json");
      } catch {}
      if (api) {
        const result = await request<{ runs: Row[] }>("/v1/mission-runs");
        if (active) {
          setRows(
            result.runs.map((row) => ({
              ...row,
              authority: "Signed workspace",
            })),
          );
          setSource("Signed workspace assessments");
        }
        return;
      }
      if (active)
        setSource(
          "Device assessments. Signed records require the workspace service.",
        );
      const archives: Archive[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)!;
        if (!key.startsWith(historyPrefix)) continue;
        try {
          const raw = localStorage.getItem(key)!;
          if (raw.length > 2 * 1024 * 1024) continue;
          const archive = JSON.parse(raw) as Archive;
          if (
            archive.schema !== "orbital.mission.archive.v1" ||
            archive.serverId ||
            !archive.deviceId ||
            key !== historyPrefix + archive.deviceId
          )
            continue;
          archive.mission = validateMission(archive.mission);
          if (
            JSON.stringify(scenarioFromMission(archive.mission)) !==
            JSON.stringify(archive.scenario)
          )
            continue;
          archives.push(archive);
        } catch {}
      }
      archives.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      calculation = new Worker(
        new URL("./workers/mission.worker.ts", import.meta.url),
        { type: "module" },
      );
      const measured: Row[] = [];
      for (const archive of archives.slice(0, 20)) {
        if (!active) return;
        try {
          const session = await new Promise<AdvancedMissionSession>(
            (resolve, reject) => {
              calculation!.onmessage = (event) =>
                event.data.error
                  ? reject(Error(event.data.error))
                  : resolve(event.data.result);
              calculation!.onerror = () =>
                reject(Error("Device replay failed"));
              calculation!.postMessage({
                id: 1,
                type: "replay",
                scenario: archive.scenario,
                journal: archive.journal,
              });
            },
          );
          measured.push({
            id: "device:" + archive.deviceId,
            mission: archive.mission,
            sequence: session.journal.length,
            updatedAt: archive.updatedAt,
            report: advancedMissionReport(session),
            authority: "Device calculation",
          });
          if (active) setRows([...measured]);
        } catch {
          if (active)
            setError(
              "A device archive could not be replayed. Valid records remain available.",
            );
        }
      }
      calculation.terminate();
    })()
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      calculation?.terminate();
    };
  }, []);
  const clients = [...new Set(rows.map((r) => r.mission.clientId))];
  return (
    <section className="advanced-results">
      <div className="mission-panel-heading">
        <h1>Mission assessments</h1>
        <label>
          Client
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c} value={c}>
                {names[c] ?? "Client workspace"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>{source}</p>
      {error && <p role="status">{error}</p>}
      {loading ? (
        <p>Reconstructing assessment records</p>
      ) : !rows.length ? (
        <p>
          Launch a docking, recovery or deorbiting mission to create an
          assessment.
        </p>
      ) : (
        <div className="mission-result-table">
          <div className="result-table-head">
            <span>Mission</span>
            <span>Client</span>
            <span>Status</span>
            <span>Assessment</span>
            <span>Delta V</span>
            <span>Record</span>
          </div>
          {rows
            .filter((r) => filter === "all" || r.mission.clientId === filter)
            .map((r) => (
              <button key={r.id} onClick={() => onOpen(r.mission, r.id)}>
                <span>
                  <strong>{r.mission.title}</strong>
                  <small>
                    Revision {r.mission.revision} · {r.sequence} commands ·{" "}
                    {r.authority}
                  </small>
                </span>
                <span>{names[r.mission.clientId] ?? "Client workspace"}</span>
                <span className={r.report.complete ? "assessment-pass" : ""}>
                  {r.report.status}
                </span>
                <span>{r.report.score}%</span>
                <span>{number(r.report.metrics.deltaV, 2)} m·s⁻¹</span>
                <span>Review ↗</span>
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
