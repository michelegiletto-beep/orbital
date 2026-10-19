import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWorkspace,
  defaultVehicle,
  flightCommand,
  orbitalMetrics,
  replayArchive,
  DYNAMICS,
  type Workspace,
  type FlightCommand,
  type Maneuver,
  type VehicleSpec,
  type Sample,
  type Direction,
  type dispersion,
  type forecast,
} from "../../../packages/sim-core/src/advanced.js";
import { FlightScene } from "./FlightScene.js";
import { Modal } from "./Modal.js";
import { readJSON } from "./transport.js";
export const number = (n: number, d = 1) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })
    : "∞";
export const elapsed = (t: number) =>
  `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(Math.floor(t) % 60).padStart(2, "0")}`;
export type Checkpoint = {
  id: string;
  date: string;
  time: number;
  vehicles: number;
  digest: string;
};
type Archive = { initial: Workspace; commands: FlightCommand[] };
function loadFlight(): { archive: Archive; workspace: Workspace } {
  try {
    const raw = localStorage.getItem("orbital.flight.v2");
    if (raw) {
      return replayArchive(JSON.parse(raw));
    }
  } catch {}
  const initial = createWorkspace();
  return { archive: { initial, commands: [] }, workspace: initial };
}
export function exportFile(value: unknown, name: string) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function useFlight() {
  const [loaded] = useState(loadFlight),
    [workspace, setWorkspace] = useState(loaded.workspace),
    [running, setRunning] = useState(false),
    [rate, setRate] = useState(60),
    [selected, setSelected] = useState(loaded.workspace.vehicles[0].spec.id),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [savedAt, setSavedAt] = useState(""),
    [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]),
    [serverSaving, setServerSaving] = useState(false);
  const current = useRef(workspace),
    archive = useRef(loaded.archive);
  current.current = workspace;
  const commit = useCallback((command: FlightCommand) => {
    try {
      if (archive.current.commands.length >= 2000)
        throw Error(
          "Command journal is full. Export this flight and start a new workspace.",
        );
      const next = flightCommand(current.current, command);
      archive.current.commands.push(command);
      current.current = next;
      setWorkspace(next);
      if (next.vehicles.every((v) => v.state.entered) || next.time >= 604800)
        setRunning(false);
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Command rejected");
      setRunning(false);
      return false;
    }
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (!document.hidden) {
        const remaining = 604800 - current.current.time;
        if (remaining < 0.001) {
          setRunning(false);
          return;
        }
        commit({ type: "advance", seconds: Math.min(rate / 4, remaining) });
      }
    }, 250);
    return () => clearInterval(timer);
  }, [running, rate, commit]);
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(
          "orbital.flight.v2",
          JSON.stringify(archive.current),
        );
        setSavedAt(new Date().toISOString());
      } catch {
        setError("Local storage is full. Export the flight archive.");
      }
    };
    const timer = setInterval(save, 5000);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", save);
    };
  }, []);
  const reset = useCallback(() => {
    setRunning(false);
    const initial = createWorkspace(
      current.current.vehicles.map((v) => v.spec),
      current.current.epoch,
      current.current.model,
    );
    archive.current = { initial, commands: [] };
    current.current = initial;
    setWorkspace(initial);
    setError("");
    setNotice("New flight initialized");
  }, []);
  const refreshCheckpoints = useCallback(async () => {
    try {
      const response = await fetch("/v1/advanced");
      if (response.ok) setCheckpoints(await readJSON<Checkpoint[]>(response));
    } catch {}
  }, []);
  useEffect(() => {
    void refreshCheckpoints();
  }, [refreshCheckpoints]);
  async function restoreCheckpoint(id: string) {
    setRunning(false);
    try {
      const response = await fetch("/v1/advanced/" + encodeURIComponent(id)),
        result = await readJSON<{ archive?: Archive; error?: string }>(
          response,
        );
      if (!response.ok || !result.archive)
        throw Error(result.error ?? "Checkpoint unavailable");
      importArchive(result.archive);
      setNotice("Verified checkpoint restored");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  }
  async function checkpoint() {
    if (serverSaving) return;
    setServerSaving(true);
    setRunning(false);
    try {
      const response = await fetch("/v1/advanced", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(archive.current),
        }),
        result = await readJSON<{ id?: string; error?: string }>(response);
      if (!response.ok)
        throw Error(result.error ?? "Workspace archive was not saved");
      setNotice(`Verified server checkpoint ${result.id?.slice(0, 8)}`);
      await refreshCheckpoints();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Server checkpoint unavailable",
      );
    } finally {
      setServerSaving(false);
    }
  }
  function importArchive(value: unknown) {
    const replayed = replayArchive(value),
      w = replayed.workspace;
    archive.current = replayed.archive;
    current.current = w;
    setWorkspace(w);
    setSelected(w.vehicles[0].spec.id);
    setRunning(false);
    setNotice("Flight archive replayed and restored");
  }
  return {
    workspace,
    running,
    setRunning,
    rate,
    setRate,
    selected,
    setSelected,
    error,
    setError,
    notice,
    setNotice,
    savedAt,
    checkpoints,
    serverSaving,
    restoreCheckpoint,
    refreshCheckpoints,
    commit,
    reset,
    checkpoint,
    importArchive,
    exportArchive: () => exportFile(archive.current, "orbital-flight.json"),
  };
}
export type FlightController = ReturnType<typeof useFlight>;
export function LineChart({
  values,
  color = "#a899ff",
  unit = "km",
  label,
}: {
  values: number[];
  color?: string;
  unit?: string;
  label: string;
}) {
  const min = Math.min(...values),
    max = Math.max(...values),
    range = Math.max(0.00001, max - min),
    points = values
      .map(
        (v, i) =>
          `${(i / Math.max(1, values.length - 1)) * 480},${95 - ((v - min) / range) * 70}`,
      )
      .join(" ");
  return (
    <div className="flight-chart">
      <div>
        <span>{label}</span>
        <strong>
          {number(values.at(-1) ?? 0, 2)} <small>{unit}</small>
        </strong>
      </div>
      <svg
        viewBox="0 0 480 110"
        role="img"
        aria-label={`${label}, minimum ${number(min, 2)}, maximum ${number(max, 2)} ${unit}`}
      >
        <path
          d="M0 25H480M0 60H480M0 95H480"
          stroke="#222836"
          strokeWidth=".7"
        />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <footer>
        <span>
          {number(min, 2)} {unit}
        </span>
        <span>
          {number(max, 2)} {unit}
        </span>
      </footer>
    </div>
  );
}
export function Simulation({
  flight,
  analysis = false,
  onLibrary,
}: {
  flight: FlightController;
  analysis?: boolean;
  onLibrary: () => void;
}) {
  const {
      workspace: w,
      selected,
      running,
      setRunning,
      rate,
      setRate,
      commit,
    } = flight,
    v = w.vehicles.find((v) => v.spec.id === selected) ?? w.vehicles[0],
    metrics = orbitalMetrics(v.state);
  const [view, setView] = useState<"orbit" | "ground">("orbit"),
    [dialog, setDialog] = useState<"maneuver" | "vehicle" | "model" | null>(
      null,
    ),
    [maneuver, setManeuver] = useState<Maneuver | null>(null),
    [spec, setSpec] = useState<VehicleSpec>(defaultVehicle()),
    [result, setResult] = useState<ReturnType<typeof forecast> | null>(null),
    [disp, setDisp] = useState<ReturnType<typeof dispersion> | null>(null),
    [working, setWorking] = useState(""),
    [seed, setSeed] = useState(42),
    [count, setCount] = useState(24),
    [sigmaP, setSigmaP] = useState(25),
    [sigmaV, setSigmaV] = useState(0.01),
    [horizon, setHorizon] = useState(5400),
    [tab, setTab] = useState<"maneuvers" | "events">("maneuvers");
  const worker = useRef<Worker | null>(null),
    generation = useRef(0),
    dispVersion = useRef(-1),
    file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const instance = new Worker(
      new URL("./workers/analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = instance;
    instance.onmessage = (event) => {
      const data = event.data;
      if (data.id !== generation.current) return;
      setWorking("");
      if (data.error) {
        flight.setError(data.error);
        return;
      }
      if (data.type === "dispersion") setDisp(data.result);
      else setResult(data.result);
    };
    instance.onerror = () => {
      setWorking("");
      flight.setError(
        "Analysis worker failed. Reload the workspace to restart it.",
      );
    };
    return () => {
      instance.terminate();
      worker.current = null;
    };
  }, [flight.setError]);
  useEffect(() => {
    if (running) return;
    const timer = setTimeout(() => {
      const id = ++generation.current;
      setWorking("Forecasting");
      worker.current?.postMessage({
        id,
        type: "forecast",
        workspace: w,
        options: { seconds: Math.min(horizon, 604800 - w.time), stride: 60 },
      });
    }, 450);
    return () => clearTimeout(timer);
  }, [w, horizon, running]);
  const analyze = () => {
    setRunning(false);
    dispVersion.current = w.time;
    setWorking("Computing dispersion");
    const id = ++generation.current;
    worker.current?.postMessage({
      id,
      type: "dispersion",
      workspace: w,
      options: {
        vehicleId: v.spec.id,
        seed,
        count,
        seconds: Math.min(horizon, 10800, 604800 - w.time),
        positionSigma: sigmaP,
        velocitySigma: sigmaV,
      },
    });
  };
  const future = result?.samples.filter((p) => p.vehicleId === v.spec.id) ?? [],
    pending = w.plan.filter((p) => !w.completed.includes(p.id)),
    history = w.history.filter((s) => s.vehicleId === v.spec.id),
    altitudes = history.map((s) => s.altitude),
    propellants = history.map((s) => s.mass - v.spec.dryMass);
  const openManeuver = () => {
    setRunning(false);
    setManeuver({
      id: crypto.randomUUID(),
      vehicleId: v.spec.id,
      at: Math.ceil(w.time + 60),
      kind: "finite",
      direction: "prograde",
      deltaV: 20,
      thrust: 120,
      duration: 90,
    });
    setDialog("maneuver");
  };
  const editPlan = (p: Maneuver) => {
    setRunning(false);
    setManeuver(p);
    setDialog("maneuver");
  };
  const schedule = () => {
    if (!maneuver) return;
    const others = pending.filter(
      (p) => p.at >= w.time && p.id !== maneuver.id,
    );
    if (commit({ type: "plan", maneuvers: [...others, maneuver] })) {
      setDialog(null);
      flight.setNotice("Maneuver added to the flight plan");
    }
  };
  const exportTelemetry = () => {
    const rows = [
        "time_s,vehicle_id,x_km,y_km,z_km,vx_km_s,vy_km_s,vz_km_s,mass_kg,altitude_km,delta_v_m_s",
        ...w.history.map((s) =>
          [
            s.time,
            s.vehicleId,
            ...s.position,
            ...s.velocity,
            s.mass,
            s.altitude,
            s.deltaV,
          ].join(","),
        ),
      ],
      url = URL.createObjectURL(
        new Blob([rows.join("\n")], { type: "text/csv" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "orbital-telemetry.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="simulation-module">
      <div className="module-heading">
        <div>
          <span className="eyebrow">WORKSPACE 01</span>
          <h1>{analysis ? "Flight dynamics" : "Mission control"}</h1>
        </div>
        <div className="heading-actions">
          <button
            className="hub-button"
            onClick={() => {
              setRunning(false);
              file.current?.click();
            }}
          >
            <HubIcon name="upload" />
            Import
          </button>
          <button className="hub-button" onClick={flight.exportArchive}>
            <HubIcon name="download" />
            Export flight
          </button>
          <button className="hub-button primary-action" onClick={openManeuver}>
            <HubIcon name="plus" />
            Plan maneuver
          </button>
        </div>
      </div>
      <div className="metric-ribbon">
        <div>
          <span>Spacecraft</span>
          <strong>
            {String(w.vehicles.length).padStart(2, "0")}
            <small>in workspace</small>
          </strong>
        </div>
        <div>
          <span>Selected altitude</span>
          <strong>
            {number(metrics.altitude, 2)}
            <small>km</small>
          </strong>
        </div>
        <div>
          <span>Orbital velocity</span>
          <strong>
            {number(metrics.speed, 3)}
            <small>km/s</small>
          </strong>
        </div>
        <div>
          <span>Propellant remaining</span>
          <strong>
            {number(v.state.mass - v.spec.dryMass, 2)}
            <small>kg</small>
          </strong>
          <div className="micro-meter">
            <i
              style={{
                width: `${((v.state.mass - v.spec.dryMass) / (v.spec.mass - v.spec.dryMass)) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>
      <div className={`flight-workbench ${analysis ? "analysis-mode" : ""}`}>
        <section className="orbit-panel">
          <div className="panel-top">
            <div className="view-toggle">
              <button
                aria-pressed={view === "orbit"}
                onClick={() => setView("orbit")}
              >
                Orbital view
              </button>
              <button
                aria-pressed={view === "ground"}
                onClick={() => setView("ground")}
              >
                Ground track
              </button>
            </div>
            <span className="model-badge">
              <i />
              {w.model.gravity === "j2" ? "J2 PERTURBED" : "TWO BODY"}
              {w.model.drag ? " + DRAG" : ""}
            </span>
          </div>
          <FlightScene
            workspace={w}
            selected={selected}
            prediction={running ? [] : (result?.samples ?? [])}
            view={view}
            onSelect={flight.setSelected}
          />
          <div className="scene-coordinate">
            <span>EARTH CENTERED INERTIAL</span>
            <span>Earth reference constants · km</span>
          </div>
          <div className="scene-scale">
            <i />
            <span>Earth imagery · historical composite</span>
          </div>
          <div className="scene-hud">
            <span className="status-dot" />
            {v.state.entered
              ? "ENTRY INTERFACE"
              : running
                ? "PROPAGATING"
                : "SIMULATION PAUSED"}
          </div>
        </section>
        <aside className="inspector-panel">
          <div className="panel-title">
            <h2>Spacecraft</h2>
            <button
              className="hub-icon-button"
              aria-label="Add spacecraft"
              onClick={() => {
                setRunning(false);
                setSpec({
                  ...defaultVehicle(
                    "vehicle" + crypto.randomUUID().slice(0, 8),
                    `ORBITER ${String(w.vehicles.length + 1).padStart(2, "0")}`,
                  ),
                  raan: (24 + w.vehicles.length * 35) % 360,
                  color: ["#a899ff", "#53d6bc", "#ffbc78", "#77baff"][
                    w.vehicles.length % 4
                  ],
                });
                setDialog("vehicle");
              }}
            >
              <HubIcon name="plus" />
            </button>
          </div>
          <div className="fleet-list">
            {w.vehicles.map((vehicle) => (
              <button
                key={vehicle.spec.id}
                aria-pressed={vehicle.spec.id === selected}
                onClick={() => flight.setSelected(vehicle.spec.id)}
              >
                <span
                  className="vehicle-glyph"
                  style={{ color: vehicle.spec.color }}
                >
                  <HubIcon name="satellite" />
                </span>
                <span>
                  <strong>{vehicle.spec.name}</strong>
                  <small>
                    {vehicle.state.entered ? "Entry interface" : "Earth orbit"}
                  </small>
                </span>
                <i style={{ background: vehicle.spec.color }} />
              </button>
            ))}
          </div>
          <div className="inspector-heading">
            <span>ORBITAL ELEMENTS</span>
            <button
              aria-label="Force model settings"
              className="hub-icon-button"
              onClick={() => setDialog("model")}
            >
              <HubIcon name="sliders" />
            </button>
          </div>
          <dl className="element-list">
            {[
              ["Apogee", number(metrics.apogee, 2), "km"],
              ["Perigee", number(metrics.perigee, 2), "km"],
              ["Inclination", number(metrics.inclination, 3), "°"],
              ["Eccentricity", number(metrics.eccentricity, 6), ""],
              ["RAAN", number(metrics.raan, 3), "°"],
              ["Orbital period", number(metrics.period / 60, 2), "min"],
              ["Total delta V", number(v.state.deltaV, 3), "m/s"],
            ].map(([label, value, unit]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {value}
                  <small>{unit}</small>
                </dd>
              </div>
            ))}
          </dl>
          <div className="inspector-foot">
            <span>State vectors</span>
            <code>{v.state.position.map((n) => number(n, 2)).join(" · ")}</code>
            <span>ECI position · km</span>
          </div>
        </aside>
        <div className="flight-transport">
          <div className="transport-time">
            <span>MISSION ELAPSED</span>
            <strong>{elapsed(w.time)}</strong>
          </div>
          <div className="transport-buttons">
            <button
              aria-label="Reset flight"
              title="Reset flight to epoch"
              className="hub-icon-button"
              disabled={running}
              onClick={flight.reset}
            >
              <HubIcon name="reset" />
            </button>
            <button
              className="transport-play"
              aria-label={running ? "Pause simulation" : "Run simulation"}
              onClick={() => setRunning(!running)}
              disabled={
                w.time >= 604800 || w.vehicles.every((v) => v.state.entered)
              }
            >
              <HubIcon name={running ? "pause" : "play"} />
            </button>
            <button
              aria-label="Advance 60 seconds"
              title="Advance 60 seconds"
              className="hub-icon-button"
              disabled={running}
              onClick={() => commit({ type: "advance", seconds: 60 })}
            >
              <HubIcon name="step" />
            </button>
          </div>
          <div className="time-scale">
            <label htmlFor="flight-rate">TIME SCALE</label>
            <select
              id="flight-rate"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            >
              {[1, 10, 60, 300, 1000].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </div>
          <div
            className="timeline-strip"
            aria-label="Planned maneuver timeline"
          >
            <div className="timeline-line" />
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} style={{ left: `${(i / 6) * 100}%` }}>
                <i />
                {elapsed(w.time + i * 600)}
              </span>
            ))}
            {pending
              .filter((p) => p.at >= w.time && p.at <= w.time + 3600)
              .map((p) => (
                <button
                  key={p.id}
                  title={`${p.kind} burn at ${elapsed(p.at)}`}
                  style={{ left: `${((p.at - w.time) / 3600) * 100}%` }}
                  onClick={() => editPlan(p)}
                  aria-label={`Edit maneuver at ${elapsed(p.at)}`}
                >
                  <i />
                </button>
              ))}
          </div>
          <span className="utc-sim">
            {new Date(Date.parse(w.epoch) + w.time * 1000)
              .toISOString()
              .slice(11, 19)}{" "}
            UTC
          </span>
        </div>
      </div>
      {analysis && (
        <section className="analysis-suite">
          <div className="panel-title">
            <h2>Trajectory dispersion</h2>
            <span className="subtle">
              Seeded Gaussian initial state uncertainty
            </span>
          </div>
          <div className="analysis-controls">
            <label>
              Samples
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {[8, 16, 24, 32, 64].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Seed
              <input
                type="number"
                min="0"
                max="4294967295"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </label>
            <label>
              Position σ <small>m per axis</small>
              <input
                type="number"
                min="0"
                max="10000"
                value={sigmaP}
                onChange={(e) => setSigmaP(Number(e.target.value))}
              />
            </label>
            <label>
              Velocity σ <small>m/s per axis</small>
              <input
                type="number"
                min="0"
                max="10"
                step=".01"
                value={sigmaV}
                onChange={(e) => setSigmaV(Number(e.target.value))}
              />
            </label>
            <label>
              Horizon
              <select
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
              >
                <option value="1800">30 minutes</option>
                <option value="5400">90 minutes</option>
                <option value="10800">3 hours</option>
              </select>
            </label>
            <button
              className="hub-button primary-action"
              disabled={!!working || running}
              onClick={analyze}
            >
              <HubIcon name="chart" />
              {working || "Run analysis"}
            </button>
          </div>
          {disp ? (
            <div className="dispersion-results">
              <div>
                <span>Median position error</span>
                <strong>
                  {number(disp.p50, 1)}
                  <small>m</small>
                </strong>
              </div>
              <div>
                <span>95th percentile</span>
                <strong>
                  {number(disp.p95, 1)}
                  <small>m</small>
                </strong>
              </div>
              <div>
                <span>Maximum sample</span>
                <strong>
                  {number(disp.maximum, 1)}
                  <small>m</small>
                </strong>
              </div>
              <svg
                viewBox="0 0 320 110"
                role="img"
                aria-label="Sample position error distribution"
              >
                {disp.outcomes.map((o, i) => (
                  <rect
                    key={i}
                    x={(i / disp.count) * 320}
                    y={100 - (o.miss / Math.max(disp.maximum, 1)) * 85}
                    width={320 / disp.count - 3}
                    height={(o.miss / Math.max(disp.maximum, 1)) * 85}
                    rx="1"
                    fill="#a899ff"
                  />
                ))}
              </svg>
              <span className="analysis-note">
                {disp.count} samples · Seed {disp.seed} · {disp.seconds} s
                horizon
                {dispVersion.current !== w.time
                  ? " · Previous flight state"
                  : ""}
                . Sample dispersion is not collision probability.
              </span>
              <button
                className="hub-button"
                onClick={() => exportFile(disp, "orbital-dispersion.json")}
              >
                Export analysis
              </button>
            </div>
          ) : (
            <div className="analysis-empty">
              Run an ensemble to measure trajectory sensitivity to initial
              position and velocity uncertainty.
            </div>
          )}
        </section>
      )}
      <div className="flight-lower">
        <section className="operations-panel">
          <div className="panel-title">
            <div className="lower-tabs">
              <button
                aria-pressed={tab === "maneuvers"}
                onClick={() => setTab("maneuvers")}
              >
                Flight plan <span>{pending.length}</span>
              </button>
              <button
                aria-pressed={tab === "events"}
                onClick={() => setTab("events")}
              >
                Event log <span>{w.events.length}</span>
              </button>
            </div>
            <button
              className="hub-icon-button"
              aria-label="Add maneuver"
              onClick={openManeuver}
            >
              <HubIcon name="plus" />
            </button>
          </div>
          {tab === "maneuvers" ? (
            <div className="table-scroll">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Spacecraft</th>
                    <th>Maneuver</th>
                    <th>Command</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {w.plan.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{elapsed(p.at)}</td>
                      <td>
                        {
                          w.vehicles.find((v) => v.spec.id === p.vehicleId)
                            ?.spec.name
                        }
                      </td>
                      <td>
                        {p.kind === "finite" ? "Finite burn" : "Impulse"}
                        <small>{p.direction}</small>
                      </td>
                      <td>
                        {p.kind === "finite"
                          ? `${p.thrust} N · ${p.duration} s`
                          : `${p.deltaV} m/s`}
                      </td>
                      <td>
                        <span
                          className={`table-status ${w.completed.includes(p.id) ? "complete" : ""}`}
                        >
                          {w.completed.includes(p.id)
                            ? "Executed"
                            : p.at <= w.time
                              ? "Active"
                              : "Scheduled"}
                        </span>
                      </td>
                      <td>
                        {!w.completed.includes(p.id) && p.at >= w.time && (
                          <button
                            className="hub-icon-button"
                            aria-label="Remove maneuver"
                            disabled={running}
                            onClick={() =>
                              commit({
                                type: "plan",
                                maneuvers: pending.filter(
                                  (q) => q.id !== p.id && q.at >= w.time,
                                ),
                              })
                            }
                          >
                            <HubIcon name="close" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!w.plan.length && (
                <div className="plan-empty">
                  <span className="empty-orbit">
                    <HubIcon name="orbit" />
                  </span>
                  <span>No maneuvers scheduled</span>
                  <button onClick={openManeuver}>
                    Plan the first maneuver <span>↗</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flight-events">
              {w.events.length ? (
                w.events
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <div key={i}>
                      <time>{elapsed(e.time)}</time>
                      <i className={e.type} />
                      <span>{e.message}</span>
                    </div>
                  ))
              ) : (
                <div className="analysis-empty">
                  Flight initialized. Commands and physical events will appear
                  here.
                </div>
              )}
            </div>
          )}
        </section>
        <section className="telemetry-charts">
          <div className="panel-title">
            <h2>Telemetry</h2>
            <button
              className="hub-icon-button"
              aria-label="Export telemetry CSV"
              onClick={exportTelemetry}
            >
              <HubIcon name="download" />
            </button>
          </div>
          <LineChart
            label="Altitude"
            values={altitudes.length ? altitudes : [metrics.altitude]}
          />
          <LineChart
            label="Propellant"
            values={
              propellants.length ? propellants : [v.state.mass - v.spec.dryMass]
            }
            unit="kg"
            color="#53d6bc"
          />
        </section>
      </div>
      {analysis && (
        <section className="prediction-panel">
          <div className="panel-title">
            <h2>Propagated trajectory</h2>
            <span className="subtle">
              {working || `${future.length} samples · 60 s interval`}
            </span>
          </div>
          <div className="prediction-summary">
            <span>
              Horizon <strong>{horizon / 60} min</strong>
            </span>
            <span>
              Sampled closest approach{" "}
              <strong>
                {result?.closest
                  ? `${number(result.closest.distance, 2)} km`
                  : "Two spacecraft required"}
              </strong>
            </span>
            <span>
              Method <strong>RK4 · {w.model.step} s maximum step</strong>
            </span>
          </div>
          <LineChart
            label="Predicted altitude"
            values={
              future.length ? future.map((s) => s.altitude) : [metrics.altitude]
            }
          />
          <p className="analysis-note">
            Closest approach is a sampled separation estimate over this horizon.
            Operational conjunction assessment requires covariance, external
            ephemerides and independent validation.
          </p>
        </section>
      )}
      <div className="module-bottom">
        <button onClick={() => setDialog("model")}>
          <HubIcon name="sliders" />
          Dynamics {DYNAMICS.version}
        </button>
        <span>
          {flight.savedAt
            ? `Saved locally ${new Date(flight.savedAt).toLocaleTimeString("en-GB")}`
            : "Local autosave enabled"}
        </span>
        <button
          disabled={flight.serverSaving}
          onClick={() => void flight.checkpoint()}
        >
          <HubIcon name="shield" />
          Save verified checkpoint
        </button>
        <button onClick={onLibrary}>
          Open mission library <span>↗</span>
        </button>
      </div>
      <input
        type="file"
        ref={file}
        hidden
        accept="application/json,.json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            if (f.size > 4 * 1024 * 1024) throw Error("Archive exceeds 4 MB");
            flight.importArchive(JSON.parse(await f.text()));
          } catch (error) {
            flight.setError(
              error instanceof Error ? error.message : "Invalid archive",
            );
          }
        }}
      />
      {dialog && (
        <Modal
          label={
            dialog === "maneuver"
              ? "Plan maneuver"
              : dialog === "vehicle"
                ? "Add spacecraft"
                : "Dynamics model"
          }
          onClose={() => setDialog(null)}
        >
          <section className="hub-dialog">
            <div className="panel-title">
              <h2>
                {dialog === "maneuver"
                  ? "Plan maneuver"
                  : dialog === "vehicle"
                    ? "Add spacecraft"
                    : "Dynamics model"}
              </h2>
              <button
                className="hub-icon-button"
                aria-label="Close dialog"
                onClick={() => setDialog(null)}
              >
                <HubIcon name="close" />
              </button>
            </div>
            {dialog === "maneuver" && maneuver && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  schedule();
                }}
              >
                <label>
                  Spacecraft
                  <select
                    value={maneuver.vehicleId}
                    onChange={(e) =>
                      setManeuver({ ...maneuver, vehicleId: e.target.value })
                    }
                  >
                    {w.vehicles.map((v) => (
                      <option key={v.spec.id} value={v.spec.id}>
                        {v.spec.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-pair">
                  <label>
                    Maneuver type
                    <select
                      value={maneuver.kind}
                      onChange={(e) =>
                        setManeuver({
                          ...maneuver,
                          kind: e.target.value as Maneuver["kind"],
                        })
                      }
                    >
                      <option value="finite">Finite thrust</option>
                      <option value="impulse">Impulsive</option>
                    </select>
                  </label>
                  <label>
                    Direction
                    <select
                      value={maneuver.direction}
                      onChange={(e) =>
                        setManeuver({
                          ...maneuver,
                          direction: e.target.value as Direction,
                        })
                      }
                    >
                      {["prograde", "retrograde", "radial", "normal"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <label>
                  Mission elapsed start <small>seconds</small>
                  <input
                    type="number"
                    min={Math.ceil(w.time)}
                    max="604800"
                    step="1"
                    required
                    value={maneuver.at}
                    onChange={(e) =>
                      setManeuver({ ...maneuver, at: Number(e.target.value) })
                    }
                  />
                </label>
                {maneuver.kind === "finite" ? (
                  <div className="form-pair">
                    <label>
                      Thrust <small>N</small>
                      <input
                        type="number"
                        min=".01"
                        max="20000"
                        step=".01"
                        required
                        value={maneuver.thrust}
                        onChange={(e) =>
                          setManeuver({
                            ...maneuver,
                            thrust: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Duration <small>s</small>
                      <input
                        type="number"
                        min="1"
                        max="3600"
                        required
                        value={maneuver.duration}
                        onChange={(e) =>
                          setManeuver({
                            ...maneuver,
                            duration: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <label>
                    Delta V <small>m/s</small>
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      step=".01"
                      required
                      value={maneuver.deltaV}
                      onChange={(e) =>
                        setManeuver({
                          ...maneuver,
                          deltaV: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                )}
                <div className="burn-estimate">
                  <span>Estimated propellant</span>
                  <strong>
                    {number(
                      maneuver.kind === "finite"
                        ? (maneuver.thrust * maneuver.duration) /
                            (v.spec.isp * DYNAMICS.g0)
                        : v.state.mass *
                            (1 -
                              Math.exp(
                                -maneuver.deltaV / (v.spec.isp * DYNAMICS.g0),
                              )),
                      3,
                    )}{" "}
                    kg
                  </strong>
                  <p>
                    Finite thrust follows the local velocity, radial or orbit
                    normal direction. Integration resolves start, cutoff and dry
                    mass boundaries.
                  </p>
                </div>
                <button
                  type="submit"
                  className="hub-button primary-action wide-action"
                >
                  Schedule maneuver <HubIcon name="arrow" />
                </button>
              </form>
            )}
            {dialog === "vehicle" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (commit({ type: "vehicle", vehicle: spec })) {
                    flight.setSelected(spec.id);
                    setDialog(null);
                  }
                }}
              >
                <label>
                  Spacecraft name
                  <input
                    maxLength={60}
                    required
                    value={spec.name}
                    onChange={(e) => setSpec({ ...spec, name: e.target.value })}
                  />
                </label>
                <div className="form-pair">
                  {(
                    [
                      ["altitude", "Perigee altitude", "km", 160, 42000],
                      ["eccentricity", "Eccentricity", "", 0, 0.7],
                      ["inclination", "Inclination", "°", 0, 180],
                      ["raan", "RAAN", "°", 0, 360],
                      ["anomaly", "True anomaly", "°", 0, 360],
                      ["mass", "Wet mass", "kg", 1, 100000],
                      ["dryMass", "Dry mass", "kg", 0.1, 100000],
                      ["isp", "Specific impulse", "s", 50, 5000],
                      ["area", "Drag area", "m²", 0.01, 1000],
                      ["cd", "Drag coefficient", "", 0.1, 5],
                    ] as const
                  ).map(([key, label, unit, min, max]) => (
                    <label key={key}>
                      {label}
                      <small>{unit}</small>
                      <input
                        type="number"
                        min={min}
                        max={max}
                        step="any"
                        required
                        value={spec[key]}
                        onChange={(e) =>
                          setSpec({ ...spec, [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="hub-button primary-action wide-action"
                  type="submit"
                  disabled={w.vehicles.length >= 8}
                >
                  Add spacecraft <HubIcon name="plus" />
                </button>
              </form>
            )}
            {dialog === "model" && (
              <>
                <div className="model-description">
                  <h3>Numerical propagation</h3>
                  <p>
                    Earth centered inertial coordinates with the north pole on
                    Z. Fourth order Runge Kutta integration. Central gravity
                    with optional J2 oblateness and a co rotating exponential
                    atmosphere.
                  </p>
                </div>
                <label>
                  Gravity
                  <select
                    value={w.model.gravity}
                    onChange={(e) => {
                      setRunning(false);
                      commit({
                        type: "model",
                        model: {
                          ...w.model,
                          gravity: e.target.value as "j2" | "two-body",
                        },
                      });
                    }}
                  >
                    <option value="j2">Central gravity + J2</option>
                    <option value="two-body">Central gravity only</option>
                  </select>
                </label>
                <label className="switch-label">
                  Atmospheric drag
                  <input
                    type="checkbox"
                    checked={w.model.drag}
                    onChange={(e) => {
                      setRunning(false);
                      commit({
                        type: "model",
                        model: { ...w.model, drag: e.target.checked },
                      });
                    }}
                  />
                </label>
                <label>
                  Maximum integration step
                  <select
                    value={w.model.step}
                    onChange={(e) => {
                      setRunning(false);
                      commit({
                        type: "model",
                        model: { ...w.model, step: Number(e.target.value) },
                      });
                    }}
                  >
                    {[0.5, 1, 2, 5, 10].map((s) => (
                      <option key={s} value={s}>
                        {s} seconds
                      </option>
                    ))}
                  </select>
                </label>
                <dl className="model-constants">
                  <div>
                    <dt>Gravitational parameter</dt>
                    <dd>398600.4418 km³/s²</dd>
                  </div>
                  <div>
                    <dt>J2</dt>
                    <dd>0.00108262668</dd>
                  </div>
                  <div>
                    <dt>Gravity reference radius</dt>
                    <dd>6378.137 km</dd>
                  </div>
                  <div>
                    <dt>Altitude reference radius</dt>
                    <dd>6371 km</dd>
                  </div>
                </dl>
                <p className="model-limit">
                  Engineering training model. Density uses a representative
                  static table from 120 to 1000 km. Solar activity, higher
                  harmonics, third bodies, radiation pressure, high fidelity
                  attitude, terrain and atmospheric entry physics are excluded.
                  Earth orientation uses UTC as an approximation of UT1. Not
                  validated for operational flight decisions.
                </p>
              </>
            )}
          </section>
        </Modal>
      )}
    </div>
  );
}
export function HubIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    orbit: "M21 12a9 9 0 1 1-9-9M4 4l16 16M16 3h5v5",
    grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
    chart: "M3 3v18h18M7 15l4-5 4 3 6-8",
    edit: "m4 16 12-12 4 4L8 20H4v-4zm9-9 4 4",
    client: "M3 21V8h18v13M8 8V3h8v5M8 13h1m6 0h1m-8 4h1m6 0h1",
    history: "M3 10a9 9 0 1 1 2 8M3 4v6h6m3-4v6l4 2",
    settings:
      "M9 3h6l1 4 4 1v7l-4 1-1 5H9l-1-5-4-1V8l4-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    search: "M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    plus: "M12 5v14M5 12h14",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
    close: "m6 6 12 12M6 18 18 6",
    play: "M8 5l11 7-11 7z",
    pause: "M8 5v14M16 5v14",
    step: "M5 5l10 7-10 7zM19 5v14",
    reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
    satellite:
      "m9 7 8 8-4 4-8-8zm-6 0 4-4 4 4-4 4zm10 10 4-4 4 4-4 4zM13 3a8 8 0 0 1 8 8M14 7a3 3 0 0 1 3 3",
    sliders: "M4 7h16M4 17h16M8 4v6m8 4v6",
    shield: "M12 3 3 6v6c0 5 9 9 9 9s9-4 9-9V6zM8 12l3 3 5-6",
    command:
      "M8 8H5a3 3 0 1 1 3-3v14a3 3 0 1 1-3-3h14a3 3 0 1 1-3 3V5a3 3 0 1 1 3 3H8",
    book: "M4 3h6l2 2 2-2h6v16h-6l-2 2-2-2H4zM12 5v16",
    check: "m5 12 4 4L19 6",
    menu: "M4 6h16M4 12h16M4 18h16",
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
      <path d={paths[name] ?? paths.orbit} />
    </svg>
  );
}
