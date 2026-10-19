import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Library } from "./Library.js";
import { AdvancedMission, AdvancedResults } from "./AdvancedMission.js";
import { Modal } from "./Modal.js";
import { Simulation, useFlight, HubIcon, elapsed } from "./Simulation.js";
import type { Mission } from "../../../packages/library/src/index.js";
import { scenarioFromMission } from "../../../packages/sim-core/src/missions.js";
import { readJSON } from "./transport.js";
type Module =
  | "control"
  | "library"
  | "analysis"
  | "designer"
  | "clients"
  | "results"
  | "settings";
const modules: { id: Module; label: string; icon: string; key: string }[] = [
  { id: "control", label: "Mission control", icon: "orbit", key: "1" },
  { id: "library", label: "Mission library", icon: "grid", key: "2" },
  { id: "analysis", label: "Flight dynamics", icon: "chart", key: "3" },
  { id: "designer", label: "Mission designer", icon: "edit", key: "4" },
  { id: "clients", label: "Client workspaces", icon: "client", key: "5" },
  { id: "results", label: "After action", icon: "history", key: "6" },
];
export function Hub({
  renderMission,
}: {
  renderMission: (mission: Mission, onBack: () => void) => ReactNode;
}) {
  const flight = useFlight(),
    [active, setActive] = useState<Module>("control"),
    [mission, setMission] = useState<Mission | null>(null),
    [runId, setRunId] = useState<string | undefined>(undefined),
    [palette, setPalette] = useState(false),
    [search, setSearch] = useState(""),
    [commandIndex, setCommandIndex] = useState(0),
    [nav, setNav] = useState(false),
    [mobile, setMobile] = useState(
      () => window.matchMedia("(max-width: 780px)").matches,
    ),
    [clock, setClock] = useState(new Date()),
    [connection, setConnection] = useState<
      "checking" | "connected" | "offline" | "identity"
    >("checking"),
    [help, setHelp] = useState(false),
    [compact, setCompact] = useState(
      () => localStorage.getItem("orbital.compact") === "true",
    );
  const advancedScenario = useMemo(
    () => mission && ["docking", "recovery", "deorbit"].includes(mission.family)
      ? scenarioFromMission(mission) : null,
    [mission],
  );
  const assets = advancedScenario
    ? [advancedScenario.chaser, advancedScenario.target].map((spec, index) => ({
      spec, label: index === 0 ? "Chaser" : "Target",
    }))
    : flight.workspace.vehicles.map((vehicle) => ({
      spec: vehicle.spec, label: vehicle.state.entered ? "Entry" : "LEO",
    }));
  const contextModel = advancedScenario?.model ?? flight.workspace.model;
  const integrationStep = advancedScenario ? Math.min(0.5, contextModel.step) : contextModel.step;
  const go = (module: Module) => {
    flight.setRunning(false);
    setMission(null);
    setRunId(undefined);
    setActive(module);
    setPalette(false);
    setSearch("");
    setNav(false);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const query = window.matchMedia("(max-width: 780px)"),
      changed = () => setMobile(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    document.documentElement.lang = "en";
    document.title = "Orbital · Mission Simulation Hub";
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("compact", compact);
    localStorage.setItem("orbital.compact", String(compact));
  }, [compact]);
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const r = await fetch("/v1/auth/session", {
          signal: AbortSignal.timeout(4000),
        });
        const a = await readJSON<{ authenticated: boolean }>(r);
        if (live) setConnection(a.authenticated ? "connected" : "identity");
      } catch {
        if (live) setConnection("offline");
      }
    };
    void check();
    const timer = setInterval(() => void check(), 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const editing = (event.target as HTMLElement)?.matches(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((p) => !p);
        setSearch("");
        return;
      }
      if (event.key === "Escape") {
        setNav(false);
        return;
      }
      if (
        editing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector("dialog[open]")
      )
        return;
      if (
        event.key === " " &&
        (active === "control" || active === "analysis") &&
        !(event.target as HTMLElement)?.closest(
          "button,a,summary,[role=button]",
        ) &&
        !mission
      ) {
        event.preventDefault();
        flight.setRunning((r) => !r);
      }
      const module = modules.find((m) => m.key === event.key);
      if (module) go(module.id);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, mission, flight.setRunning]);
  useEffect(() => {
    if (!flight.notice) return;
    const timer = setTimeout(() => flight.setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [flight.notice, flight.setNotice]);
  const launch = (m: Mission) => {
    flight.setRunning(false);
    setMission(m);
    setRunId(undefined);
    setNav(false);
    window.scrollTo({ top: 0 });
  };
  const actions = [
    ...modules.map((m) => ({
      label: m.label,
      icon: m.icon,
      run: () => go(m.id),
      key: m.key,
    })),
    {
      label: flight.running ? "Pause simulation" : "Run simulation",
      icon: "play",
      run: () => {
        go("control");
        flight.setRunning(!flight.running);
      },
      key: "Space",
    },
    {
      label: "Export flight archive",
      icon: "download",
      run: flight.exportArchive,
      key: "",
    },
    {
      label: "Save verified checkpoint",
      icon: "shield",
      run: () => void flight.checkpoint(),
      key: "",
    },
    {
      label: "Dynamics and keyboard shortcuts",
      icon: "book",
      run: () => setHelp(true),
      key: "",
    },
  ].filter((a) => a.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className={`hub-shell ${nav ? "navigation-open" : ""}`}>
      <a className="skip-link" href="#hub-main">
        Skip to workspace
      </a>
      {mobile && nav && (
        <button
          className="navigation-backdrop"
          aria-label="Close navigation"
          onClick={() => setNav(false)}
        />
      )}
      <aside
        className="hub-sidebar"
        id="hub-navigation"
        inert={mobile && !nav}
        aria-hidden={mobile && !nav}
      >
        <button
          className="hub-brand"
          onClick={() => go("control")}
          aria-label="Orbital mission control"
        >
          <span className="brand-symbol">
            <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <circle cx="18" cy="18" r="10" />
              <ellipse
                cx="18"
                cy="18"
                rx="17"
                ry="6"
                transform="rotate(-42 18 18)"
              />
              <circle cx="29" cy="7" r="2" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <strong>
            orbital<span>MISSION SIMULATION HUB</span>
          </strong>
        </button>
        <div className="workspace-switch">
          <span className="workspace-logo">O</span>
          <span>
            Orbital workspace<small>Institutional training</small>
          </span>
          <i>⌘</i>
        </div>
        <div className="nav-group-label">WORKSPACE</div>
        <nav aria-label="Workspace modules">
          {modules.map((m) => (
            <button
              key={m.id}
              className={active === m.id && !mission ? "active" : ""}
              onClick={() => go(m.id)}
              aria-current={active === m.id && !mission ? "page" : undefined}
            >
              <HubIcon name={m.icon} />
              <span>{m.label}</span>
              {m.id === "control" ? (
                <span className="nav-live" />
              ) : (
                <kbd>{m.key}</kbd>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-group-label fleet-nav-heading">
          FLIGHT ASSETS<span>{assets.length}</span>
        </div>
        <div className="sidebar-assets">
          {assets.map((v) => (
            <button
              key={v.spec.id}
              disabled={!!advancedScenario}
              title={advancedScenario ? "Inspect this spacecraft in the mission workspace" : undefined}
              onClick={() => {
                if(advancedScenario)return;
                go("control");
                flight.setSelected(v.spec.id);
              }}
            >
              <i style={{ background: v.spec.color }} />
              <span>{v.spec.name}</span>
              <small>{v.label}</small>
            </button>
          ))}
        </div>
        <div className="sidebar-lower">
          <button
            onClick={() => go("settings")}
            className={active === "settings" ? "active" : ""}
          >
            <HubIcon name="settings" />
            <span>Workspace settings</span>
          </button>
          <button onClick={() => setHelp(true)}>
            <HubIcon name="book" />
            <span>Reference</span>
            <span>↗</span>
          </button>
          <div className="local-environment">
            <span
              className={`status-dot ${connection === "connected" ? "" : "warning"}`}
            />
            <span>
              {connection === "connected"
                ? "Local API connected"
                : connection === "identity"
                  ? "Identity required"
                  : connection === "checking"
                    ? "Checking connection"
                    : "Device workspace"}
              <small>Data stays in this environment</small>
            </span>
          </div>
          <div className="hub-copyright">© Michele Giletto</div>
        </div>
      </aside>
      <div className="hub-frame">
        <header className="hub-topbar">
          <button
            className="mobile-nav hub-icon-button"
            aria-label="Open navigation"
            aria-expanded={nav}
            aria-controls="hub-navigation"
            onClick={() => setNav(!nav)}
          >
            <HubIcon name="menu" />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <i>›</i>
            <strong>
              {mission
                ? mission.title
                : active === "settings"
                  ? "Settings"
                  : modules.find((m) => m.id === active)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="topbar-clock">
              {clock.toLocaleTimeString("en-GB", { timeZone: "UTC" })}
              <small>UTC</small>
            </span>
            <button
              className="command-search"
              aria-label="Search commands"
              onClick={() => setPalette(true)}
            >
              <HubIcon name="search" />
              <span>Search anything</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="training-badge">
              <i />
              TRAINING
            </span>
            <button
              className="operator-avatar"
              aria-label="Open workspace settings"
              onClick={() => go("settings")}
            >
              OP
            </button>
          </div>
        </header>
        <main id="hub-main" tabIndex={-1} className="hub-content">
          {mission ? (
            <div className="hub-training">
              {["docking", "recovery", "deorbit"].includes(mission.family) ? (
                <AdvancedMission
                  key={mission.id + mission.revision + (runId ?? "")}
                  mission={mission}
                  runId={runId}
                  onBack={() => {
                    setMission(null);
                    setRunId(undefined);
                    setActive("library");
                  }}
                />
              ) : (
                renderMission(mission, () => {
                  setMission(null);
                  setActive("library");
                })
              )}
            </div>
          ) : active === "control" || active === "analysis" ? (
            <Simulation
              flight={flight}
              analysis={active === "analysis"}
              onLibrary={() => go("library")}
            />
          ) : ["library", "designer", "clients", "results"].includes(active) ? (
            <>
              {active === "results" && (
                <AdvancedResults
                  onOpen={(m, id) => {
                    setMission(m);
                    setRunId(id);
                  }}
                />
              )}
              <Library
                key={active}
                onLaunch={launch}
                section={
                  active as "library" | "designer" | "clients" | "results"
                }
                embedded
              />
            </>
          ) : (
            <div className="settings-module">
              <div className="module-heading">
                <h1>Workspace settings</h1>
              </div>
              <section>
                <div className="panel-title">
                  <h2>Environment</h2>
                  <span className="table-status">Local workspace</span>
                </div>
                <dl className="settings-list">
                  <div>
                    <dt>API connection</dt>
                    <dd>
                      {connection === "connected"
                        ? "Connected and authenticated"
                        : connection === "identity"
                          ? "Sign in required"
                          : "Unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>Simulation engine</dt>
                    <dd>Dynamics 2.0.0</dd>
                  </div>
                  <div>
                    <dt>Workspace epoch</dt>
                    <dd>{flight.workspace.epoch}</dd>
                  </div>
                  <div>
                    <dt>Mission elapsed</dt>
                    <dd>{elapsed(flight.workspace.time)}</dd>
                  </div>
                  <div>
                    <dt>Data storage</dt>
                    <dd>Browser autosave and explicit server checkpoints</dd>
                  </div>
                </dl>
              </section>
              <section>
                <div className="panel-title">
                  <h2>Appearance</h2>
                </div>
                <label className="settings-toggle">
                  <span>
                    Compact density
                    <small>
                      Reduce spacing in operational tables and panels
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={compact}
                    onChange={(e) => setCompact(e.target.checked)}
                  />
                </label>
                <div className="settings-row">
                  <span>Theme</span>
                  <strong>Dark</strong>
                </div>
                <div className="settings-row">
                  <span>Language</span>
                  <strong>English</strong>
                </div>
              </section>
              <section>
                <div className="panel-title">
                  <h2>Flight archive</h2>
                </div>
                <div className="settings-actions">
                  <button className="hub-button" onClick={flight.exportArchive}>
                    <HubIcon name="download" />
                    Export reproducible archive
                  </button>
                  <button
                    className="hub-button"
                    disabled={flight.serverSaving}
                    onClick={() => void flight.checkpoint()}
                  >
                    <HubIcon name="shield" />
                    Save verified checkpoint
                  </button>
                </div>
                <p>
                  Server checkpoints replay the command journal, verify the
                  resulting state and record its digest in the signed audit
                  chain. Device archives can be imported from Mission control.
                </p>
              </section>
              <section>
                <div className="panel-title">
                  <h2>Verified checkpoints</h2>
                  <button
                    className="hub-icon-button"
                    aria-label="Refresh checkpoints"
                    onClick={() => void flight.refreshCheckpoints()}
                  >
                    <HubIcon name="reset" />
                  </button>
                </div>
                {flight.checkpoints.length ? (
                  <div className="table-scroll">
                    <table className="hub-table">
                      <thead>
                        <tr>
                          <th>Created</th>
                          <th>Elapsed</th>
                          <th>Spacecraft</th>
                          <th>Checkpoint</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {flight.checkpoints.map((c) => (
                          <tr key={c.id}>
                            <td>{new Date(c.date).toLocaleString("en-GB")}</td>
                            <td className="mono">{elapsed(c.time)}</td>
                            <td>{c.vehicles}</td>
                            <td className="mono" title={c.digest}>
                              {c.id.slice(0, 8)}
                            </td>
                            <td>
                              <button
                                className="hub-button"
                                onClick={() =>
                                  void flight
                                    .restoreCheckpoint(c.id)
                                    .then(() => go("control"))
                                }
                              >
                                Restore
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>No server checkpoints saved in this workspace.</p>
                )}
              </section>
              <section>
                <div className="panel-title">
                  <h2>Deployment status</h2>
                </div>
                <p>
                  This environment uses a local development identity. Production
                  identity federation, smart cards and accredited deployment
                  require infrastructure configuration and independent
                  validation.
                </p>
                {connection === "identity" && (
                  <a
                    className="hub-button primary-action"
                    href="/v1/auth/login"
                  >
                    Sign in
                  </a>
                )}
              </section>
            </div>
          )}
        </main>
        <footer className="hub-statusbar">
          <span>
            <i className="status-dot" />
            {advancedScenario ? "Mission workspace" : flight.running ? "Simulation running" : "Workspace ready"}
          </span>
          <span>ECI · RK4 · {contextModel.gravity === "j2" ? "J2" : "Two body"} · {contextModel.drag ? "Drag" : "No drag"} · {integrationStep} s</span>
          <span className="statusbar-right">
            {assets.length} spacecraft
            <span>Dynamics 2.0</span>
            <button onClick={() => setPalette(true)}>⌘ Command center</button>
          </span>
        </footer>
      </div>
      {(flight.error || flight.notice) && (
        <div
          className={`hub-toast ${flight.error ? "error" : ""}`}
          role={flight.error ? "alert" : "status"}
        >
          <HubIcon name={flight.error ? "shield" : "check"} />
          <span>{flight.error || flight.notice}</span>
          <button
            className="hub-icon-button"
            aria-label="Dismiss notification"
            onClick={() => {
              flight.setError("");
              flight.setNotice("");
            }}
          >
            <HubIcon name="close" />
          </button>
        </div>
      )}
      {palette && (
        <Modal label="Command center" onClose={() => setPalette(false)}>
          <div className="command-palette">
            <div className="command-palette-input">
              <HubIcon name="search" />
              <input
                autoFocus
                role="combobox"
                aria-label="Search commands"
                aria-controls="command-results"
                aria-expanded="true"
                aria-activedescendant={
                  actions.length
                    ? `command-${Math.min(commandIndex, actions.length - 1)}`
                    : undefined
                }
                placeholder="Type a command or destination"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCommandIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCommandIndex(
                      (i) => (i + 1) % Math.max(1, actions.length),
                    );
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCommandIndex(
                      (i) =>
                        (i - 1 + Math.max(1, actions.length)) %
                        Math.max(1, actions.length),
                    );
                  }
                  if (
                    e.key === "Enter" &&
                    actions[Math.min(commandIndex, actions.length - 1)]
                  ) {
                    e.preventDefault();
                    actions[Math.min(commandIndex, actions.length - 1)].run();
                    setPalette(false);
                  }
                }}
              />
              <button
                className="hub-icon-button"
                aria-label="Close command center"
                onClick={() => setPalette(false)}
              >
                <HubIcon name="close" />
              </button>
            </div>
            <div
              className="command-results"
              id="command-results"
              role="listbox"
              aria-label="Available commands"
            >
              {actions.map((a, index) => (
                <button
                  key={a.label}
                  id={`command-${index}`}
                  role="option"
                  aria-selected={
                    index === Math.min(commandIndex, actions.length - 1)
                  }
                  onClick={() => {
                    a.run();
                    setPalette(false);
                  }}
                >
                  <HubIcon name={a.icon} />
                  <span>{a.label}</span>
                  {a.key && <kbd>{a.key}</kbd>}
                  <span>↵</span>
                </button>
              ))}
              {!actions.length && <p>No matching commands</p>}
            </div>
            <div className="command-hint">
              Enter to open<span>Esc to close</span>
            </div>
          </div>
        </Modal>
      )}
      {help && (
        <Modal label="Workspace reference" onClose={() => setHelp(false)}>
          <section className="hub-dialog reference-dialog">
            <div className="panel-title">
              <h2>Workspace reference</h2>
              <button
                className="hub-icon-button"
                aria-label="Close reference"
                onClick={() => setHelp(false)}
              >
                <HubIcon name="close" />
              </button>
            </div>
            <h3>Keyboard</h3>
            <dl className="settings-list">
              {[
                ["Ctrl K", "Command center"],
                ["Space", "Run or pause flight"],
                ["1 to 6", "Open workspace module"],
                ["Escape", "Close a dialog"],
              ].map(([key, label]) => (
                <div key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
            <h3>Mission simulation</h3>
            <p>
              The Hub propagates up to eight spacecraft with central gravity, J2
              and optional drag. Schedule finite or impulsive maneuvers, inspect
              ECI elements, compare ground tracks and run deterministic
              uncertainty ensembles.
            </p>
            <h3>Mission training</h3>
            <p>
              The library includes orbital transfer, docking, recovery, deorbit,
              inspection and separation exercises. Each has three measured
              learning objectives, guided practice, assessment and replay.
              Client workspaces support custom libraries and signed offline
              deliveries.
            </p>
            <h3>Model scope</h3>
            <p>
              Docking, recovery and deorbit use the nonlinear ECI engine.
              Recovery uses single axis roll tracking. Inspection and separation
              retain a linear relative model around a circular reference orbit.
              Capture and atmospheric entry end the mission. This software has
              not been validated for operational flight control or certified for
              classified data.
            </p>
            <h3>Earth imagery</h3>
            <p>
              Real Earth photographic composites are bundled locally. These are
              historical images, not a live feed. Source attribution and
              licenses are included with the software.
            </p>
          </section>
        </Modal>
      )}
    </div>
  );
}
