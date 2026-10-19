import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scene } from "./Scene.js";
import { Modal } from "./Modal.js";
import { assetPath } from "./assets.js";
import { ScenarioFields } from "./ScenarioFields.js";
import { initialState } from "../../../packages/sim-core/src/index.js";
import {
  CATALOG,
  FAMILIES,
  seedLibrary,
  validateLibrary as validateArchive,
  validateMission,
  type Library as MissionLibrary,
  type Mission,
  type Family,
} from "../../../packages/library/src/index.js";
import { readJSON, type APIError } from "./transport.js";
import {
  englishLibrary,
  englishText,
} from "../../../packages/library/src/english.js";
const validateLibrary = (value: unknown) =>
  englishLibrary(validateArchive(value));
import "./library.css";
import "./commercial.css";

export function Glyph({
  name,
}: {
  name:
    | "plus"
    | "arrow"
    | "search"
    | "edit"
    | "copy"
    | "download"
    | "upload"
    | "close"
    | "grid"
    | "client"
    | "history"
    | "back"
    | "trash"
    | "check";
}) {
  const d = {
    plus: "M12 5v14M5 12h14",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    search: "M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    edit: "m4 16 12-12 4 4L8 20H4v-4zm9-9 4 4",
    copy: "M9 9h11v11H9zM15 9V4H4v11h5",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
    close: "m6 6 12 12M6 18 18 6",
    grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
    client: "M3 21V8h18v13M8 8V3h8v5M8 13h1m6 0h1m-8 4h1m6 0h1",
    history: "M3 10a9 9 0 1 1 2 8M3 4v6h6m3-4v6l4 2",
    back: "M19 12H5m6-6-6 6 6 6",
    trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
    check: "m5 12 4 4L19 6",
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
      <path d={d[name]} />
    </svg>
  );
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function restore() {
  try {
    const raw = localStorage.getItem("orbital.library.v1");
    if (raw) return validateLibrary(JSON.parse(raw));
  } catch {}
  return seedLibrary();
}
export type RunRecord = {
  id: string;
  missionId: string;
  missionTitle: string;
  family: Family;
  clientId: string;
  date: string;
  score: number;
  complete: boolean;
  payload: unknown;
};
export function readRuns(): RunRecord[] {
  try {
    return JSON.parse(localStorage.getItem("orbital.runs.v1") ?? "[]");
  } catch {
    return [];
  }
}
export function recordRun(
  mission: Mission,
  score: number,
  complete: boolean,
  payload: unknown,
) {
  const records = readRuns();
  const compact = structuredClone(payload) as { session?: { track?: unknown } };
  if (compact?.session?.track) delete compact.session.track;
  records.unshift({
    id: (payload as { serverId?: string })?.serverId ?? crypto.randomUUID(),
    missionId: mission.id,
    missionTitle: englishText(mission.title),
    family: mission.family,
    clientId: mission.clientId,
    date: new Date().toISOString(),
    score,
    complete,
    payload: compact,
  });
  localStorage.setItem(
    "orbital.runs.v1",
    JSON.stringify(records.slice(0, 500)),
  );
  const sourceId = (payload as { serverId?: string })?.serverId;
  if (sourceId)
    void fetch("/v1/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId,
        kind: ["transfer", "deorbit"].includes(mission.family)
          ? "orbital"
          : "relative",
        mission,
      }),
    }).catch(() => {});
}
export function MissionMark({ family }: { family: Family }) {
  return (
    <svg
      className={`mission-mark ${family}`}
      viewBox="0 0 140 80"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`orb-${family}`}>
          <stop stopColor="#b1c2d0" stopOpacity=".18" />
          <stop offset="1" stopColor="#b1c2d0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="70" cy="40" r="36" fill={`url(#orb-${family})`} />
      {family === "docking" || family === "recovery" ? (
        <>
          <path
            d="M22 40h96"
            stroke="currentColor"
            strokeDasharray="2 4"
            opacity=".3"
          />
          <path
            d="M85 24h19v32H85zM104 32h14v16h-14M85 32H75v16h10M38 33h13v14H38zM38 37H27v6h11m13-6h9v6h-9"
            stroke="currentColor"
          />
          <path d="m62 36 5 4-5 4" stroke="currentColor" />
          <circle cx="95" cy="40" r="25" stroke="currentColor" opacity=".12" />
        </>
      ) : family === "deorbit" ? (
        <>
          <path
            d="M6 74a70 70 0 0 1 128 0"
            stroke="currentColor"
            opacity=".25"
          />
          <path
            d="M10 65C35 0 115 0 128 65M85 15c15 14 8 38-6 52"
            stroke="currentColor"
          />
          <path d="m75 60 4 7 8-2" stroke="currentColor" />
        </>
      ) : family === "inspection" ? (
        <>
          <ellipse
            cx="70"
            cy="40"
            rx="48"
            ry="23"
            stroke="currentColor"
            strokeDasharray="3 4"
          />
          <path
            d="M64 33h13v14H64zM77 37h9v6h-9M64 37h-9v6h9"
            stroke="currentColor"
          />
          {[20, 70, 120].map((x, i) => (
            <circle
              key={x}
              cx={x}
              cy={i === 1 ? 17 : 40}
              r="3"
              fill="currentColor"
            />
          ))}
        </>
      ) : (
        <>
          <ellipse
            cx="70"
            cy="40"
            rx="46"
            ry="15"
            transform="rotate(-24 70 40)"
            stroke="currentColor"
          />
          <ellipse
            cx="70"
            cy="40"
            rx="59"
            ry="28"
            transform="rotate(-24 70 40)"
            stroke="currentColor"
            opacity=".3"
            strokeDasharray="3 4"
          />
          <circle cx="70" cy="40" r="11" stroke="currentColor" opacity=".25" />
          <circle cx="111" cy="22" r="3" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
type Props = {
  onLaunch: (mission: Mission) => void;
  section?: "library" | "designer" | "clients" | "results";
  embedded?: boolean;
};
export function Library({
  onLaunch,
  section = "library",
  embedded = false,
}: Props) {
  const [loaded, setLoaded] = useState(false),
    [authRequired, setAuthRequired] = useState(false);
  const storage = useRef("orbital.library.v1");
  const [library, setLibrary] = useState<MissionLibrary>(restore),
    [selectedId, setSelectedId] = useState("docking-axial"),
    [client, setClient] = useState("all"),
    [family, setFamily] = useState<Family | "all">("all"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState<"library" | "clients" | "results">(
      section === "designer" ? "library" : section,
    ),
    [draft, setDraft] = useState<Mission | null>(() =>
      section === "designer"
        ? {
            ...structuredClone(CATALOG[0]),
            id: crypto.randomUUID(),
            title: "New mission",
            description: "Custom orbital transfer exercise.",
            updatedAt: new Date().toISOString(),
          }
        : null,
    ),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [clientName, setClientName] = useState(""),
    [api, setAPI] = useState(false),
    [saving, setSaving] = useState(false),
    [view, setView] = useState(0),
    [ready, setReady] = useState(true),
    [undo, setUndo] = useState<MissionLibrary | null>(null),
    [runs, setRuns] = useState(readRuns),
    [history, setHistory] = useState<MissionLibrary[]>(() => {
      try {
        return JSON.parse(
          localStorage.getItem("orbital.library.history") ?? "[]",
        );
      } catch {
        return [];
      }
    }),
    [showHistory, setShowHistory] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    catalogRef = useRef<HTMLDivElement>(null),
    libraryRef = useRef(library);
  libraryRef.current = library;
  const selected =
    library.missions.find((m) => m.id === selectedId) ??
    library.missions[0] ??
    CATALOG[0];
  const state = useMemo(
      () => initialState(selected.initialAltitude, selected.inclination),
      [selected.initialAltitude, selected.inclination],
    ),
    onReady = useCallback((value: boolean) => setReady(value), []),
    onXR = useCallback(() => {}, []);
  const missions = library.missions.filter(
    (m) =>
      (client === "all" || m.clientId === client) &&
      (family === "all" || m.family === family) &&
      `${m.title} ${m.description} ${FAMILIES[m.family]}`
        .toLocaleLowerCase("en")
        .includes(query.toLocaleLowerCase("en")),
  );
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const bundled = await fetch(assetPath("orbital-library.json"));
        if (
          bundled.ok &&
          (bundled.headers.get("content-type") ?? "").includes(
            "application/json",
          )
        ) {
          const bundledLibrary = validateLibrary(await bundled.json());
          storage.current = "orbital.client." + bundledLibrary.clients[0].id;
          let value = bundledLibrary;
          try {
            const saved = JSON.parse(
              localStorage.getItem(storage.current) ?? "null",
            );
            if (saved) {
              const checked = validateLibrary(saved);
              value = checked;
            }
          } catch {}
          if (active) setLibrary(value);
          return;
        }
        const response = await fetch("/v1/library");
        if (response.status === 401) {
          if (active) setAuthRequired(true);
          return;
        }
        if (response.ok) {
          const value = validateLibrary(await response.json());
          if (active) {
            setLibrary(value);
            setAPI(true);
          }
        }
      } catch {
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storage.current, JSON.stringify(library));
    } catch {
      setMessage("Local storage is full. Export the library.");
    }
  }, [library, loaded]);
  useEffect(() => {
    if (page !== "results" || !api) return;
    void fetch("/v1/results")
      .then((r) => (r.ok ? readJSON<RunRecord[]>(r) : []))
      .then((server: RunRecord[]) => {
        const merged = new Map(readRuns().map((r) => [r.id, r]));
        for (const r of server) merged.set(r.id, r);
        setRuns(
          [...merged.values()].sort((a, b) => b.date.localeCompare(a.date)),
        );
      })
      .catch(() => {});
  }, [page, api]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6500);
    return () => clearTimeout(timer);
  }, [message]);
  async function save(next: MissionLibrary) {
    setSaving(true);
    setError("");
    try {
      const valid = validateLibrary(next),
        prior = libraryRef.current;
      let saved: MissionLibrary;
      if (api) {
        const response = await fetch("/v1/library", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(prior.revision),
          },
          body: JSON.stringify(valid),
        });
        if (!response.ok) {
          const result = await readJSON<APIError>(response);
          throw Error(result.error ?? "Save failed.");
        }
        saved = validateLibrary(await response.json());
      } else saved = { ...valid, revision: prior.revision + 1 };
      const versions = [structuredClone(prior), ...history].slice(0, 30);
      setHistory(versions);
      try {
        localStorage.setItem(
          "orbital.library.history",
          JSON.stringify(versions),
        );
      } catch {}
      setUndo(prior);
      libraryRef.current = saved;
      setLibrary(saved);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      return false;
    } finally {
      setSaving(false);
    }
  }
  function edit(mission?: Mission) {
    const now = new Date().toISOString();
    setDraft(
      mission
        ? structuredClone(mission)
        : {
            ...structuredClone(CATALOG[0]),
            id: crypto.randomUUID(),
            revision: 1,
            title: "New mission",
            description: "Custom orbital transfer exercise.",
            clientId:
              client === "all"
                ? (library.clients.find((c) => c.id === "general")?.id ??
                  library.clients[0].id)
                : client,
            updatedAt: now,
          },
    );
    setError("");
    window.scrollTo({ top: 0 });
  }
  async function saveDraft() {
    if (!draft) return;
    try {
      const existing = library.missions.find((m) => m.id === draft.id),
        valid = validateMission({
          ...draft,
          revision: existing ? existing.revision + 1 : 1,
          updatedAt: new Date().toISOString(),
        });
      const missions = existing
        ? library.missions.map((m) => (m.id === valid.id ? valid : m))
        : [...library.missions, valid];
      if (await save({ ...library, missions })) {
        setSelectedId(valid.id);
        setDraft(null);
        setPage("library");
        setMessage("Mission saved.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid parameters.");
    }
  }
  async function duplicate(mission: Mission, clientId = mission.clientId) {
    const copy = {
      ...structuredClone(mission),
      id: crypto.randomUUID(),
      revision: 1,
      title: `${mission.title} copy`.slice(0, 90),
      clientId,
      updatedAt: new Date().toISOString(),
    };
    if (await save({ ...library, missions: [...library.missions, copy] })) {
      setSelectedId(copy.id);
      setMessage("Mission duplicated.");
    }
  }
  async function importLibrary(event: React.ChangeEvent<HTMLInputElement>) {
    const uploaded = event.target.files?.[0];
    if (!uploaded) return;
    try {
      if (uploaded.size > 4 * 1024 * 1024) throw Error("File exceeds 4 MB.");
      const imported = validateLibrary(JSON.parse(await uploaded.text()));
      const clients = new Map(library.clients.map((c) => [c.id, c])),
        missions = new Map(library.missions.map((m) => [m.id, m]));
      for (const c of imported.clients)
        if (!clients.has(c.id)) clients.set(c.id, c);
      for (const m of imported.missions) {
        const existing = missions.get(m.id);
        if (!existing || m.revision > existing.revision) missions.set(m.id, m);
      }
      if (
        await save({
          ...library,
          clients: [...clients.values()],
          missions: [...missions.values()],
        })
      )
        setMessage("Library imported.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid file.");
    }
    event.target.value = "";
  }
  async function exportClient(id: string) {
    if (api) {
      try {
        const response = await fetch("/v1/deliveries/" + id);
        if (!response.ok)
          throw Error("Package unavailable. Build the application first.");
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = "orbital-" + id + ".zip";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("Offline package exported.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Export failed.");
      }
      return;
    }
    const scoped = {
      ...library,
      clients: library.clients.filter((c) => c.id === id),
      missions: library.missions.filter((m) => m.clientId === id),
    };
    download(scoped, `orbital-client-${id}.json`);
    setMessage("Client package exported.");
  }
  async function addClient() {
    const name = clientName.trim();
    if (!name || name.length > 80 || /[<>\u0000-\u001f]/.test(name)) {
      setError("Enter a valid client name.");
      return;
    }
    if (
      library.clients.some(
        (c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setError("This client already exists.");
      return;
    }
    const item = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    if (await save({ ...library, clients: [...library.clients, item] })) {
      setClientName("");
      setClient(item.id);
      setMessage("Client workspace created.");
    }
  }
  function exportCSV() {
    const filtered = runs.filter(
      (r) => client === "all" || r.clientId === client,
    );
    const csv = [
      "mission;client;date;score;complete",
      ...filtered.map((r) =>
        [
          r.missionTitle,
          library.clients.find((c) => c.id === r.clientId)?.name ?? r.clientId,
          r.date,
          r.score,
          r.complete ? "yes" : "no",
        ]
          .map(
            (v) =>
              '"' +
              (/^[=+@\-]/.test(String(v))
                ? "'" + String(v)
                : String(v)
              ).replaceAll('"', '""') +
              '"',
          )
          .join(";"),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "orbital-results.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!loaded) return <div className="library-loading">Orbital</div>;
  if (authRequired)
    return (
      <div className="library-login">
        <h1>Orbital</h1>
        <a className="solid-action" href="/v1/auth/login">
          Sign in with institutional identity
          <Glyph name="arrow" />
        </a>
      </div>
    );
  const set = <K extends keyof Mission>(key: K, value: Mission[K]) =>
    setDraft((previous) => {
      if (!previous) return null;
      const next = { ...previous, [key]: value };
      if (next.advanced) {
        const s = structuredClone(next.advanced);
        s.chaser.altitude = s.target.altitude = next.initialAltitude;
        s.chaser.inclination = s.target.inclination = next.inclination;
        s.budget = next.budget;
        if (next.family === "deorbit") s.deorbit.perigee = next.targetAltitude;
        if (next.family !== "deorbit") {
          s.relativePosition[1] = -next.initialRange;
          s.capture.distance = next.tolerance;
          s.capture.speed = next.closingSpeed;
        }
        next.advanced = s;
      }
      return next;
    });
  return (
    <div
      className={`library-shell ${embedded ? "embedded" : ""}`}
      style={
        {
          "--customer-accent":
            library.clients.find(
              (c) =>
                c.id ===
                (client === "all" && library.clients.length === 1
                  ? library.clients[0].id
                  : client),
            )?.accentColor ?? "#243e59",
        } as React.CSSProperties
      }
    >
      <a className="skip-link" href="#mission-library">
        Skip to mission library
      </a>
      <header className="library-header">
        <button
          className="library-brand"
          onClick={() => {
            setPage("library");
            setDraft(null);
          }}
          aria-label="Orbital mission library"
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="11" />
            <ellipse
              cx="16"
              cy="16"
              rx="17"
              ry="6"
              transform="rotate(-35 16 16)"
            />
            <circle cx="28" cy="8" r="2" fill="currentColor" />
          </svg>
          Orbital
        </button>
        <nav aria-label="Library navigation">
          {(["library", "clients", "results"] as const).map((p, i) => (
            <button
              key={p}
              className={page === p && !draft ? "selected" : ""}
              onClick={() => {
                setPage(p);
                setDraft(null);
                setError("");
              }}
            >
              {["Library", "Clients", "Results"][i]}
            </button>
          ))}
        </nav>
        <button
          className="workspace-selector"
          onClick={() => {
            setPage("clients");
            setDraft(null);
          }}
        >
          <span className="workspace-avatar">
            {client === "all"
              ? "O"
              : library.clients.find((c) => c.id === client)?.name[0]}
          </span>
          <span>
            {client === "all"
              ? "Workspace"
              : library.clients.find((c) => c.id === client)?.name}
          </span>
          <span className="workspace-chevron">⌄</span>
        </button>
      </header>
      <div className="library-layout">
        <aside className="library-sidebar">
          <div className="sidebar-section">LIBRARIES</div>
          <button
            className={
              client === "all" ? "sidebar-item active" : "sidebar-item"
            }
            onClick={() => {
              setClient("all");
              setPage("library");
              setDraft(null);
            }}
          >
            <Glyph name="grid" />
            <span>All missions</span>
            <small>{library.missions.length}</small>
          </button>
          {library.clients.map((c) => (
            <button
              key={c.id}
              className={
                client === c.id ? "sidebar-item active" : "sidebar-item"
              }
              onClick={() => {
                setClient(c.id);
                setPage("library");
                setDraft(null);
              }}
            >
              <Glyph name="client" />
              <span>{c.name}</span>
              <small>
                {library.missions.filter((m) => m.clientId === c.id).length}
              </small>
            </button>
          ))}
          <button
            className="sidebar-add"
            onClick={() => {
              setPage("clients");
              setDraft(null);
            }}
          >
            <Glyph name="plus" />
            New client
          </button>
          <div className="sidebar-bottom">
            <button onClick={() => setShowHistory(true)}>
              <Glyph name="history" />
              Versions<span>{library.revision}</span>
            </button>
            <button onClick={() => file.current?.click()}>
              <Glyph name="upload" />
              Import library
            </button>
            <button onClick={() => download(library, "orbital-library.json")}>
              <Glyph name="download" />
              Export library
            </button>
            <span className="storage-state">
              <i />
              {api ? "Workspace archive" : "Device archive"}
            </span>
          </div>
        </aside>
        <main className="library-main" id="mission-library">
          {draft ? (
            <>
              <div className="library-title-row">
                <div className="editor-title">
                  <button
                    className="icon-action"
                    onClick={() => setDraft(null)}
                    aria-label="Back to library"
                  >
                    <Glyph name="back" />
                  </button>
                  <h1>
                    {library.missions.some((m) => m.id === draft.id)
                      ? "Edit mission"
                      : "Create mission"}
                  </h1>
                </div>
                <button
                  className="solid-action"
                  disabled={saving}
                  onClick={() => {
                    void saveDraft();
                  }}
                >
                  Save mission
                  <Glyph name="check" />
                </button>
              </div>
              <div className="editor-workspace">
                <form
                  className="mission-editor"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveDraft();
                  }}
                >
                  <label>
                    Name
                    <input
                      maxLength={90}
                      value={draft.title}
                      onChange={(e) => set("title", e.target.value)}
                      required
                    />
                  </label>
                  <div className="editor-pair">
                    <label>
                      Family
                      <select
                        value={draft.family}
                        onChange={(e) => {
                          const f = e.target.value as Family;
                          const base = CATALOG.find((m) => m.family === f)!;
                          setDraft({
                            ...draft,
                            family: f,
                            advanced: undefined,
                            objectives: base.objectives,
                            targetAltitude: base.targetAltitude,
                            initialAltitude: base.initialAltitude,
                            budget: base.budget,
                          });
                        }}
                      >
                        {Object.entries(FAMILIES).map(([key, value]) => (
                          <option key={key} value={key}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Client
                      <select
                        value={draft.clientId}
                        onChange={(e) => set("clientId", e.target.value)}
                      >
                        {library.clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Operational objective
                    <textarea
                      rows={3}
                      maxLength={800}
                      value={draft.description}
                      onChange={(e) => set("description", e.target.value)}
                      required
                    />
                  </label>
                  <div className="editor-pair">
                    <label>
                      Difficulty
                      <select
                        value={draft.level}
                        onChange={(e) =>
                          set("level", e.target.value as Mission["level"])
                        }
                      >
                        <option value="basic">Basic</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </label>
                    <label>
                      Inclination <span>degrees</span>
                      <input
                        type="number"
                        min={0}
                        max={180}
                        step={0.1}
                        value={draft.inclination}
                        onChange={(e) =>
                          set("inclination", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <div className="editor-pair">
                    <label>
                      Initial altitude <span>km</span>
                      <input
                        type="number"
                        min={200}
                        max={2000}
                        value={draft.initialAltitude}
                        onChange={(e) =>
                          set("initialAltitude", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      {draft.family === "deorbit"
                        ? "Target perigee"
                        : "Target altitude"}{" "}
                      <span>km</span>
                      <input
                        type="number"
                        min={40}
                        max={2500}
                        value={draft.targetAltitude}
                        onChange={(e) =>
                          set("targetAltitude", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <div className="editor-pair">
                    <label>
                      Delta V budget <span>m·s⁻¹</span>
                      <input
                        type="number"
                        min={1}
                        max={1500}
                        value={draft.budget}
                        onChange={(e) => set("budget", Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Tolerance{" "}
                      <span>
                        {["transfer", "deorbit"].includes(draft.family)
                          ? "km"
                          : "m"}
                      </span>
                      <input
                        type="number"
                        min={0.1}
                        max={100}
                        step={0.1}
                        value={draft.tolerance}
                        onChange={(e) =>
                          set("tolerance", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  {!["transfer", "deorbit"].includes(draft.family) && (
                    <div className="editor-pair">
                      <label>
                        Initial separation <span>m</span>
                        <input
                          type="number"
                          min={10}
                          max={10000}
                          value={draft.initialRange}
                          onChange={(e) =>
                            set("initialRange", Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        Contact speed <span>m·s⁻¹</span>
                        <input
                          type="number"
                          min={0.01}
                          max={0.5}
                          step={0.01}
                          value={draft.closingSpeed}
                          onChange={(e) =>
                            set("closingSpeed", Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                  )}
                  {["docking", "recovery", "deorbit"].includes(
                    draft.family,
                  ) && <ScenarioFields mission={draft} onChange={setDraft} />}
                  <label>
                    Learning objectives
                    <textarea
                      rows={5}
                      value={draft.objectives.join("\n")}
                      onChange={(e) =>
                        set("objectives", e.target.value.split("\n"))
                      }
                    />
                  </label>
                  {library.missions.some((m) => m.id === draft.id) && (
                    <button
                      className="delete-mission"
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        void save({
                          ...library,
                          missions: library.missions.filter(
                            (m) => m.id !== draft.id,
                          ),
                        }).then((ok) => {
                          if (ok) {
                            setDraft(null);
                            setMessage(
                              "Mission removed. Available in version history.",
                            );
                          }
                        });
                      }}
                    >
                      <Glyph name="trash" />
                      Remove mission
                    </button>
                  )}
                  <button
                    className="solid-action editor-save"
                    type="submit"
                    disabled={saving}
                  >
                    Save mission
                    <Glyph name="check" />
                  </button>
                </form>
                <div className="editor-preview">
                  <div className="preview-earth">
                    <Scene
                      targetAltitude={(draft ?? selected).targetAltitude}
                      state={state}
                      forecast={null}
                      view={view}
                      onReady={onReady}
                      xrRequest={0}
                      onXR={onXR}
                    />
                    <span>EARTH</span>
                    <button
                      onClick={() => setView((v) => v + 1)}
                      aria-label="Rotate view"
                    >
                      ↻
                    </button>
                  </div>
                  <div className="preview-spec">
                    <span>{FAMILIES[draft.family]}</span>
                    <h2>{draft.title}</h2>
                    <MissionMark family={draft.family} />
                    {draft.objectives.filter(Boolean).map((o, i) => (
                      <p key={i}>
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        {o}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : page === "library" ? (
            <>
              <div className="library-title-row">
                <h1>
                  {client === "all"
                    ? "Missions"
                    : library.clients.find((c) => c.id === client)?.name}
                  <span>{missions.length}</span>
                </h1>
                <div className="title-actions">
                  <button
                    className="outline-action desktop-action"
                    onClick={() => file.current?.click()}
                  >
                    <Glyph name="upload" />
                    Import
                  </button>
                  <button
                    className="solid-action"
                    disabled={saving}
                    onClick={() => edit()}
                  >
                    <Glyph name="plus" />
                    Create mission
                  </button>
                </div>
              </div>
              <div className="library-hero">
                <div className="hero-earth">
                  <Scene
                    targetAltitude={(draft ?? selected).targetAltitude}
                    state={state}
                    forecast={null}
                    view={view}
                    onReady={onReady}
                    xrRequest={0}
                    onXR={onXR}
                  />
                  <div className="earth-corner">
                    <i />
                    EARTH<span>{selected.initialAltitude} km</span>
                  </div>
                  <div className="hero-orbit-label">
                    {selected.inclination.toLocaleString("en")}°
                    <span>INCLINATION</span>
                  </div>
                  <button
                    className="hero-view"
                    onClick={() => setView((v) => v + 1)}
                    aria-label="Change Earth view"
                  >
                    ↻
                  </button>
                  {!ready && <p>3D rendering is unavailable on this device.</p>}
                </div>
                <div className="hero-mission">
                  <div className="mission-eyebrow">
                    <span>{FAMILIES[selected.family]}</span>
                    <span>
                      REV {String(selected.revision).padStart(2, "0")}
                    </span>
                  </div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                  <div className="hero-parameters">
                    <div>
                      <span>Altitude</span>
                      <strong>
                        {selected.initialAltitude}
                        <small>km</small>
                      </strong>
                    </div>
                    <div>
                      <span>Delta V budget</span>
                      <strong>
                        {selected.budget}
                        <small>m·s⁻¹</small>
                      </strong>
                    </div>
                  </div>
                  <ol className="hero-objectives">
                    {selected.objectives.map((o, i) => (
                      <li key={i}>
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        {o}
                      </li>
                    ))}
                  </ol>
                  <div className="hero-actions">
                    <button
                      className="solid-action"
                      onClick={() => onLaunch(selected)}
                    >
                      Launch mission
                      <Glyph name="arrow" />
                    </button>
                    <button
                      className="icon-action"
                      title="Edit mission"
                      aria-label="Edit selected mission"
                      onClick={() => edit(selected)}
                    >
                      <Glyph name="edit" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="catalog-toolbar">
                <div
                  className="family-filters"
                  role="group"
                  aria-label="Mission family"
                >
                  <button
                    className={family === "all" ? "chosen" : ""}
                    onClick={() => setFamily("all")}
                  >
                    All
                  </button>
                  {Object.entries(FAMILIES).map(([key, value]) => (
                    <button
                      key={key}
                      className={family === key ? "chosen" : ""}
                      onClick={() => setFamily(key as Family)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <label className="library-search">
                  <Glyph name="search" />
                  <input
                    type="search"
                    placeholder="Search missions"
                    aria-label="Search missions"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <div className="mission-catalog" ref={catalogRef}>
                {missions.map((m, i) => (
                  <article
                    key={m.id}
                    className={
                      selectedId === m.id
                        ? "mission-card selected-card"
                        : "mission-card"
                    }
                  >
                    <button
                      className="mission-card-select"
                      onClick={() => setSelectedId(m.id)}
                      aria-label={`Select ${m.title}`}
                    >
                      <div className="card-top">
                        <span>{FAMILIES[m.family]}</span>
                        <small>{String(i + 1).padStart(2, "0")}</small>
                      </div>
                      <MissionMark family={m.family} />
                      <h3>{m.title}</h3>
                      <div className="card-specs">
                        <span>{m.initialAltitude} km</span>
                        <i />
                        <span>
                          {m.level[0].toUpperCase() + m.level.slice(1)}
                        </span>
                        <i />
                        <span>{m.objectives.length} objectives</span>
                      </div>
                    </button>
                    <div className="card-actions">
                      <span>
                        {library.clients.find((c) => c.id === m.clientId)?.name}
                      </span>
                      <button
                        aria-label={`Duplicate ${m.title}`}
                        title="Duplicate"
                        disabled={saving}
                        onClick={() => {
                          void duplicate(m);
                        }}
                      >
                        <Glyph name="copy" />
                      </button>
                      <button
                        aria-label={`Edit ${m.title}`}
                        title="Edit"
                        onClick={() => edit(m)}
                      >
                        <Glyph name="edit" />
                      </button>
                      <button
                        aria-label={`Open ${m.title}`}
                        title="Open"
                        onClick={() => onLaunch(m)}
                      >
                        <Glyph name="arrow" />
                      </button>
                    </div>
                  </article>
                ))}
                {!missions.length && (
                  <div className="empty-library">
                    <Glyph name="grid" />
                    <p>
                      {query
                        ? "No missions match your search."
                        : "This library has no missions."}
                    </p>
                    <button className="solid-action" onClick={() => edit()}>
                      Create mission
                      <Glyph name="plus" />
                    </button>
                    {client !== "all" && client !== "general" && (
                      <button
                        className="outline-action"
                        disabled={saving}
                        onClick={() => {
                          void save({
                            ...library,
                            missions: [
                              ...library.missions,
                              ...CATALOG.map((m) => ({
                                ...structuredClone(m),
                                id: crypto.randomUUID(),
                                clientId: client,
                              })),
                            ],
                          }).then((ok) => {
                            if (ok)
                              setMessage(
                                "Templates added to the client library.",
                              );
                          });
                        }}
                      >
                        Add library templates
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : page === "clients" ? (
            <>
              <div className="library-title-row">
                <h1>
                  Clients<span>{library.clients.length - 1}</span>
                </h1>
              </div>
              <form
                className="new-client-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addClient();
                }}
              >
                <label htmlFor="new-client">New client workspace</label>
                <div>
                  <input
                    id="new-client"
                    placeholder="Client name"
                    value={clientName}
                    maxLength={80}
                    onChange={(e) => setClientName(e.target.value)}
                    required
                  />
                  <button
                    className="solid-action"
                    type="submit"
                    disabled={saving}
                  >
                    <Glyph name="plus" />
                    Create workspace
                  </button>
                </div>
              </form>
              <div className="client-grid">
                {library.clients
                  .filter((c) => c.id !== "general")
                  .map((c) => (
                    <article className="client-card" key={c.id}>
                      <div className="client-initial">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <input
                        className="client-name-edit"
                        aria-label={`Name of ${c.name}`}
                        defaultValue={c.name}
                        maxLength={80}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (name && name !== c.name)
                            void save({
                              ...library,
                              clients: library.clients.map((item) =>
                                item.id === c.id ? { ...item, name } : item,
                              ),
                            });
                        }}
                      />
                      <p>
                        {
                          library.missions.filter((m) => m.clientId === c.id)
                            .length
                        }{" "}
                        missions
                      </p>
                      <div>
                        <button
                          className="outline-action"
                          onClick={() => {
                            setClient(c.id);
                            setPage("library");
                          }}
                        >
                          Open library
                          <Glyph name="arrow" />
                        </button>
                        <button
                          className="icon-action"
                          aria-label={`Export ${c.name}`}
                          onClick={() => {
                            void exportClient(c.id);
                          }}
                        >
                          <Glyph name="download" />
                        </button>
                      </div>
                      <label className="assign-template">
                        Add template
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const mission = library.missions.find(
                              (m) => m.id === e.target.value,
                            );
                            if (mission) void duplicate(mission, c.id);
                            e.target.value = "";
                          }}
                        >
                          <option value="" disabled>
                            Choose a mission
                          </option>
                          {library.missions
                            .filter((m) => m.clientId === "general")
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="client-branding">
                        <span>Workspace accent</span>
                        <input
                          type="color"
                          aria-label={`Accent for ${c.name}`}
                          defaultValue={c.accentColor ?? "#243e59"}
                          onBlur={(e) => {
                            if (e.target.value !== c.accentColor)
                              void save({
                                ...library,
                                clients: library.clients.map((item) =>
                                  item.id === c.id
                                    ? { ...item, accentColor: e.target.value }
                                    : item,
                                ),
                              });
                          }}
                        />
                        <button
                          onClick={() =>
                            download(
                              {
                                ...library,
                                clients: [c],
                                missions: library.missions.filter(
                                  (m) => m.clientId === c.id,
                                ),
                              },
                              `orbital-${c.id}.json`,
                            )
                          }
                        >
                          JSON definitions
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {library.clients.length === 1 && (
                <div className="client-empty">
                  <Glyph name="client" />
                  <p>
                    Create a workspace to organize and deliver a client mission
                    library.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="library-title-row">
                <h1>
                  Results<span>{runs.length}</span>
                </h1>
                <button
                  className="outline-action"
                  disabled={!runs.length}
                  onClick={exportCSV}
                >
                  <Glyph name="download" />
                  Export CSV
                </button>
              </div>
              <div className="results-table">
                <div className="results-head">
                  <span>Mission</span>
                  <span>Date</span>
                  <span>Score</span>
                  <span>Outcome</span>
                  <span />
                </div>
                {runs
                  .filter((r) => client === "all" || r.clientId === client)
                  .map((r) => (
                    <div className="results-row" key={r.id}>
                      <span>
                        {englishText(r.missionTitle)}
                        <small>{FAMILIES[r.family]}</small>
                      </span>
                      <time>
                        {new Date(r.date).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <strong>{r.score}</strong>
                      <span
                        className={
                          r.complete ? "result-complete" : "result-partial"
                        }
                      >
                        {r.complete ? "Complete" : "Partial"}
                      </span>
                      <button
                        className="icon-action"
                        aria-label={`Export result ${r.missionTitle}`}
                        onClick={() =>
                          download(r.payload, `orbital-result-${r.id}.json`)
                        }
                      >
                        <Glyph name="download" />
                      </button>
                    </div>
                  ))}
                {!runs.length && (
                  <div className="client-empty">
                    <Glyph name="history" />
                    <p>Saved mission results appear here.</p>
                  </div>
                )}
              </div>
            </>
          )}
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
        </main>
      </div>
      <footer className="library-footer">
        <span>© Michele Giletto</span>
        <span>Orbital</span>
      </footer>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void importLibrary(e);
        }}
      />
      {message && (
        <div className="library-toast" role="status">
          {message}
          <button
            className="icon-action"
            aria-label="Dismiss notification"
            onClick={() => setMessage("")}
          >
            <Glyph name="close" />
          </button>
        </div>
      )}
      {showHistory && (
        <Modal
          label="Library version history"
          onClose={() => setShowHistory(false)}
        >
          <section
            className="history-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 id="history-title">Library version history</h2>
              <button
                className="icon-action"
                aria-label="Close version history"
                onClick={() => setShowHistory(false)}
              >
                <Glyph name="close" />
              </button>
            </div>
            <p>Current revision {library.revision}</p>
            {history.map((version, i) => (
              <article key={`${version.revision}-${i}`}>
                <span>
                  Revision {version.revision}
                  <small>{version.missions.length} missions</small>
                </span>
                <button
                  className="outline-action"
                  disabled={saving}
                  onClick={() => {
                    void save({ ...version, revision: library.revision }).then(
                      (ok) => {
                        if (ok) {
                          setShowHistory(false);
                          setMessage("Revision restored.");
                        }
                      },
                    );
                  }}
                >
                  Restore
                </button>
              </article>
            ))}
            {!history.length && <p>No previous versions.</p>}
          </section>
        </Modal>
      )}
    </div>
  );
}
