import type { Mission } from "../../../packages/library/src/index.js";
import {
  scenarioFromMission,
  type AdvancedMissionScenario,
} from "../../../packages/sim-core/src/missions.js";

export function ScenarioFields({
  mission,
  onChange,
}: {
  mission: Mission;
  onChange: (mission: Mission) => void;
}) {
  const s = mission.advanced;
  const enable = () => {
    try {
      onChange({ ...mission, advanced: scenarioFromMission(mission) });
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Review the mission parameters first.",
      );
    }
  };
  if (!s)
    return (
      <section className="scenario-fields">
        <button type="button" onClick={enable}>
          Configure advanced scenario
        </button>
      </section>
    );
  const change = (patch: Partial<AdvancedMissionScenario>) =>
    onChange({ ...mission, advanced: { ...s, ...patch } });
  const field = (
    label: string,
    value: number,
    update: (value: number) => void,
    min: number,
    max: number,
    step = 0.1,
  ) => (
    <label>
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toPrecision(12)) : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => update(Number(e.target.value))}
        required
      />
    </label>
  );
  return (
    <section className="scenario-fields">
      <h2>Advanced scenario</h2>
      <label>
        Epoch in UTC
        <input
          type="datetime-local"
          value={s.epoch.slice(0, 19)}
          onChange={(e) => {
            const value = Date.parse(e.target.value + "Z");
            if (Number.isFinite(value))
              change({ epoch: new Date(value).toISOString() });
          }}
          required
        />
      </label>
      <div className="editor-pair">
        <label>
          Gravity
          <select
            value={s.model.gravity}
            onChange={(e) =>
              change({
                model: {
                  ...s.model,
                  gravity: e.target.value as "j2" | "two-body",
                },
              })
            }
          >
            <option value="j2">J2 oblateness</option>
            <option value="two-body">Two body</option>
          </select>
        </label>
        <label>
          Atmospheric drag
          <select
            value={String(s.model.drag)}
            onChange={(e) =>
              change({ model: { ...s.model, drag: e.target.value === "true" } })
            }
          >
            <option value="true">Engineering density model</option>
            <option value="false">Disabled</option>
          </select>
        </label>
      </div>
      <label>
        Integration step in seconds
        <select
          value={s.model.step}
          onChange={(e) =>
            change({ model: { ...s.model, step: Number(e.target.value) } })
          }
        >
          <option value={0.1}>0.1</option>
          <option value={0.25}>0.25</option>
          <option value={0.5}>0.5</option>
        </select>
      </label>
      {(["chaser", "target"] as const).map((key) => (
        <details key={key}>
          <summary>
            {key === "chaser" ? "Chaser vehicle" : "Target vehicle"}
          </summary>
          <label>
            Name
            <input
              maxLength={40}
              value={s[key].name}
              onChange={(e) =>
                change({ [key]: { ...s[key], name: e.target.value } })
              }
            />
          </label>
          <div className="editor-pair">
            {field(
              "Wet mass in kg",
              s[key].mass,
              (mass) => change({ [key]: { ...s[key], mass } }),
              1,
              100000,
            )}
            {field(
              "Dry mass in kg",
              s[key].dryMass,
              (dryMass) => change({ [key]: { ...s[key], dryMass } }),
              1,
              100000,
            )}
            {field(
              "Specific impulse in seconds",
              s[key].isp,
              (isp) => change({ [key]: { ...s[key], isp } }),
              50,
              5000,
            )}
            {field(
              "Drag area in square metres",
              s[key].area,
              (area) => change({ [key]: { ...s[key], area } }),
              0.01,
              1000,
            )}
            {field(
              "Drag coefficient",
              s[key].cd,
              (cd) => change({ [key]: { ...s[key], cd } }),
              0.1,
              5,
            )}
            {(key === "target" || mission.family === "deorbit") &&
              field(
                "Ascending node in degrees",
                s[key].raan,
                (raan) => change({ [key]: { ...s[key], raan } }),
                0,
                360,
              )}
            {(key === "target" || mission.family === "deorbit") &&
              field(
                "True anomaly in degrees",
                s[key].anomaly,
                (anomaly) => change({ [key]: { ...s[key], anomaly } }),
                0,
                360,
              )}
          </div>
        </details>
      ))}
      {mission.family !== "deorbit" ? (
        <>
          <div className="editor-pair">
            {field(
              "Radial offset in metres",
              s.relativePosition[0],
              (v) =>
                change({
                  relativePosition: [
                    v,
                    s.relativePosition[1],
                    s.relativePosition[2],
                  ],
                }),
              -50000,
              50000,
            )}
            {field(
              "Cross track offset in metres",
              s.relativePosition[2],
              (v) =>
                change({
                  relativePosition: [
                    s.relativePosition[0],
                    s.relativePosition[1],
                    v,
                  ],
                }),
              -50000,
              50000,
            )}
          </div>
          <div className="scenario-vector">
            {s.relativeVelocity.map((v, i) => (
              <div key={i}>
                {field(
                  [
                    "Radial velocity",
                    "Along track velocity",
                    "Cross track velocity",
                  ][i] + " in metres per second",
                  v,
                  (value) => {
                    const velocity = [...s.relativeVelocity] as [
                      number,
                      number,
                      number,
                    ];
                    velocity[i] = value;
                    change({ relativeVelocity: velocity });
                  },
                  -50,
                  50,
                  0.001,
                )}
              </div>
            ))}
          </div>
          <label>
            Ordered hold points in metres
            <input
              value={s.holdPoints
                .map((value) =>
                  Number.isFinite(value) ? Number(value.toPrecision(12)) : "",
                )
                .join(", ")}
              onChange={(e) =>
                change({ holdPoints: e.target.value.split(",").map(Number) })
              }
            />
          </label>
          <div className="editor-pair">
            {field(
              "Hold tolerance in metres",
              s.holdTolerance,
              (holdTolerance) => change({ holdTolerance }),
              0.01,
              20,
              0.01,
            )}
            {field(
              "Corridor half angle in degrees",
              s.corridorAngle,
              (corridorAngle) => change({ corridorAngle }),
              1,
              45,
            )}
            {field(
              "Capture roll limit in degrees",
              s.capture.angle,
              (angle) => change({ capture: { ...s.capture, angle } }),
              0.1,
              10,
            )}
            {field(
              "Capture rotation limit in degrees per second",
              s.capture.angularRate,
              (angularRate) =>
                change({ capture: { ...s.capture, angularRate } }),
              0.001,
              1,
              0.001,
            )}
            {field(
              "Collision boundary in metres",
              s.capture.collisionDistance,
              (collisionDistance) =>
                change({ capture: { ...s.capture, collisionDistance } }),
              0.001,
              s.capture.distance * 0.25,
              0.001,
            )}
            {field(
              "Initial relative roll in degrees",
              s.attitude.angle,
              (angle) => change({ attitude: { ...s.attitude, angle } }),
              -180,
              180,
            )}
            {field(
              "Initial chaser roll rate in degrees per second",
              s.attitude.angularRate,
              (angularRate) =>
                change({ attitude: { ...s.attitude, angularRate } }),
              -5,
              5,
              0.01,
            )}
            {field(
              "Passive target roll in degrees per second",
              s.attitude.targetRate,
              (targetRate) =>
                change({ attitude: { ...s.attitude, targetRate } }),
              -5,
              5,
              0.01,
            )}
            {field(
              "Roll acceleration authority in degrees per second squared",
              s.attitude.authority,
              (authority) => change({ attitude: { ...s.attitude, authority } }),
              0.01,
              1,
              0.01,
            )}
          </div>
          <p className="model-note">
            The target orbit and relative RTN state define the initial geometry.
            Capture uses a distance boundary and one axis roll tracking.
          </p>
        </>
      ) : (
        <>
          <div className="editor-pair">
            {field(
              "Minimum descending speed at entry in metres per second",
              s.deorbit.minimumDescentRate,
              (minimumDescentRate) =>
                change({ deorbit: { ...s.deorbit, minimumDescentRate } }),
              0.01,
              1000,
            )}
          </div>
          <p className="model-note">
            Propagation stops at the descending 120 km interface. Atmospheric
            entry and ground impact are outside this model.
          </p>
        </>
      )}
      <button
        type="button"
        onClick={() => onChange({ ...mission, advanced: undefined })}
      >
        Restore scenario defaults
      </button>
      <p className="model-note">
        {mission.family === "deorbit"
          ? "Assessment records burn execution, perigee below 120 km and descending entry above the configured minimum speed."
          : mission.family === "recovery"
            ? "Assessment records the first stable hold, all holds with synchronized roll, and explicit capture within every limit."
            : "Assessment records the first hold without a corridor excursion, all holds within the speed limit, and explicit capture within every limit."}{" "}
        The three learning objectives below use these criteria in order.
      </p>
    </section>
  );
}
