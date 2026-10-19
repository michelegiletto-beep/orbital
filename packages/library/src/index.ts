import { transferPlan } from "../../sim-core/src/index.js";
import {
  scenarioFromMission,
  type AdvancedMissionScenario,
} from "../../sim-core/src/missions.js";
export const FAMILIES = {
  transfer: "Transfer",
  docking: "Docking",
  recovery: "Recovery",
  deorbit: "Deorbiting",
  inspection: "Inspection",
  avoidance: "Collision avoidance",
} as const;
export type Family = keyof typeof FAMILIES;
export type Mission = {
  id: string;
  revision: number;
  title: string;
  family: Family;
  clientId: string;
  description: string;
  level:
    "basic" | "intermediate" | "advanced" | "base" | "intermedio" | "avanzato";
  initialAltitude: number;
  targetAltitude: number;
  inclination: number;
  budget: number;
  tolerance: number;
  initialRange: number;
  closingSpeed: number;
  objectives: string[];
  updatedAt: string;
  advanced?: AdvancedMissionScenario;
};
export type Client = {
  id: string;
  name: string;
  createdAt: string;
  accentColor?: string;
};
export type Library = {
  schema: "orbital.library.v1";
  revision: number;
  clients: Client[];
  missions: Mission[];
};
const date = "2026-10-15T00:00:00.000Z";
const make = (
  id: string,
  title: string,
  family: Family,
  description: string,
  level: Mission["level"],
  altitude: number,
  target: number,
  inclination: number,
  objectives: string[],
  range = 1000,
): Mission => ({
  id,
  revision: 1,
  title,
  family,
  description,
  level,
  clientId: "general",
  initialAltitude: altitude,
  targetAltitude: target,
  inclination,
  budget: family === "transfer" ? 350 : family === "deorbit" ? 250 : 30,
  tolerance: family === "transfer" ? 15 : family === "deorbit" ? 10 : 1,
  initialRange: range,
  closingSpeed: 0.1,
  objectives,
  updatedAt: date,
});
export const CATALOG: Mission[] = [
  make(
    "transfer-leo",
    "LEO transfer",
    "transfer",
    "Acquire a circular orbit through a two impulse transfer.",
    "basic",
    400,
    900,
    28.5,
    [
      "Plan the transfer",
      "Circularize at apogee",
      "Stay within the delta V budget",
    ],
  ),
  make(
    "docking-axial",
    "Axial docking",
    "docking",
    "Final approach, hold point stabilization and contact at controlled velocity.",
    "intermediate",
    420,
    420,
    51.6,
    [
      "Maintain the approach corridor",
      "Respect the contact speed limit",
      "Complete soft capture",
    ],
    500,
  ),
  make(
    "recovery-passive",
    "Passive spacecraft recovery",
    "recovery",
    "Proximity rendezvous and capture of a target without active control.",
    "advanced",
    550,
    550,
    40,
    ["Reduce relative motion", "Synchronize rotation", "Capture the target"],
    800,
  ),
  make(
    "deorbit-controlled",
    "Controlled deorbit",
    "deorbit",
    "Lower the perigee and reach the atmospheric entry interface.",
    "intermediate",
    600,
    80,
    45,
    [
      "Execute a retrograde burn",
      "Lower perigee below 120 km",
      "Reach the entry interface on descent",
    ],
  ),
  make(
    "inspection-standoff",
    "Standoff inspection",
    "inspection",
    "Acquire three observation points around a cooperative target.",
    "intermediate",
    450,
    450,
    30,
    [
      "Reach the observation point",
      "Maintain separation",
      "Complete three observations",
    ],
    250,
  ),
  make(
    "avoidance-leo",
    "Safety separation",
    "avoidance",
    "Perform a relative departure maneuver to increase target separation.",
    "basic",
    700,
    700,
    60,
    ["Plan the separation", "Increase relative distance", "Stay within budget"],
    100,
  ),
  make(
    "transfer-high",
    "Orbit raising",
    "transfer",
    "Transfer from low orbit to a higher circular orbit.",
    "intermediate",
    600,
    1200,
    45,
    [
      "Estimate the energy cost",
      "Coordinate the two impulses",
      "Verify orbital elements",
    ],
  ),
  make(
    "docking-precision",
    "Precision docking",
    "docking",
    "Close approach with a reduced speed limit and an intermediate hold point.",
    "advanced",
    420,
    420,
    51.6,
    [
      "Cancel lateral drift",
      "Stabilize at the hold point",
      "Execute final contact",
    ],
    100,
  ),
  make(
    "recovery-close",
    "Close range capture",
    "recovery",
    "Stabilize relative motion and capture at close range.",
    "intermediate",
    500,
    500,
    35,
    ["Estimate relative velocity", "Stabilize the target", "Confirm capture"],
    150,
  ),
  make(
    "deorbit-low",
    "Low orbit departure",
    "deorbit",
    "Prepare descent from low orbit with a constrained delta V budget.",
    "basic",
    400,
    80,
    28.5,
    ["Reduce orbital energy", "Verify the perigee", "Cross 120 km on descent"],
  ),
  make(
    "inspection-close",
    "Close range inspection",
    "inspection",
    "Perform proximity inspection with a reduced observation radius.",
    "advanced",
    450,
    450,
    30,
    [
      "Control separation",
      "Acquire sequential observations",
      "Preserve the safety margin",
    ],
    80,
  ),
  make(
    "avoidance-extended",
    "Extended departure",
    "avoidance",
    "Acquire increased separation while remaining within the allocated budget.",
    "intermediate",
    650,
    650,
    70,
    [
      "Set up the departure maneuver",
      "Reach one kilometer separation",
      "Verify propellant consumption",
    ],
    200,
  ),
];
export function seedLibrary(): Library {
  return {
    schema: "orbital.library.v1",
    revision: 1,
    clients: [{ id: "general", name: "General library", createdAt: date }],
    missions: structuredClone(CATALOG),
  };
}
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[<>\u0000-\u001f]/.test(value);
export function validateMission(input: unknown): Mission {
  if (!plain(input)) throw Error("Mission must be an object.");
  const keys = [
    "id",
    "revision",
    "title",
    "family",
    "clientId",
    "description",
    "level",
    "initialAltitude",
    "targetAltitude",
    "inclination",
    "budget",
    "tolerance",
    "initialRange",
    "closingSpeed",
    "objectives",
    "updatedAt",
    "advanced",
  ];
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw Error("Unrecognized mission field.");
  for (const key of ["id", "clientId"])
    if (!text(input[key], 80) || !/^[a-zA-Z0-9-]+$/.test(input[key] as string))
      throw Error("Invalid identifier.");
  if (
    !text(input.title, 90) ||
    !text(input.description, 800) ||
    ![
      "basic",
      "intermediate",
      "advanced",
      "base",
      "intermedio",
      "avanzato",
    ].includes(input.level as string) ||
    !Object.hasOwn(FAMILIES, input.family as string)
  )
    throw Error("Invalid mission description.");
  const bounds = {
    initialAltitude: [200, 2000],
    targetAltitude: [40, 2500],
    inclination: [0, 180],
    budget: [1, 1500],
    tolerance: [0.1, 100],
    initialRange: [10, 10000],
    closingSpeed: [0.01, 0.5],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = input[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw Error(`Parameter ${key} outside allowed range.`);
  }
  if (
    !Number.isInteger(input.revision) ||
    Number(input.revision) < 1 ||
    !text(input.updatedAt, 40) ||
    !Number.isFinite(Date.parse(input.updatedAt as string))
  )
    throw Error("Invalid mission revision.");
  if (
    !Array.isArray(input.objectives) ||
    input.objectives.length !== 3 ||
    input.objectives.some((o) => !text(o, 160))
  )
    throw Error("Enter three learning objectives.");
  if (
    input.family === "transfer" &&
    (Number(input.targetAltitude) <= Number(input.initialAltitude) ||
      Number(input.targetAltitude) - Number(input.initialAltitude) < 20)
  )
    throw Error("Transfer requires a target orbit at least 20 km higher.");
  if (input.family === "deorbit" && Number(input.targetAltitude) >= 120)
    throw Error("Deorbit perigee must be below 120 km.");
  if (input.family === "transfer" || input.family === "deorbit") {
    const plan = transferPlan(
        Number(input.initialAltitude),
        Number(input.targetAltitude),
      ),
      required =
        Math.abs(plan.first) +
        (input.family === "transfer" ? Math.abs(plan.second) : 0);
    if (
      Math.abs(plan.first) > 350 ||
      (input.family === "transfer" && Math.abs(plan.second) > 350)
    )
      throw Error("Configuration exceeds the mission impulse limit.");
    if (Number(input.budget) < required - 0.1)
      throw Error("Budget does not cover the reference transfer.");
  }
  const mission = structuredClone(input) as unknown as Mission;
  if (input.advanced !== undefined) {
    if (!["docking", "recovery", "deorbit"].includes(mission.family))
      throw Error(
        "Advanced scenarios require docking, recovery or deorbiting.",
      );
    mission.advanced = scenarioFromMission(mission);
    if (
      mission.advanced.chaser.altitude !== mission.initialAltitude ||
      mission.advanced.target.altitude !== mission.initialAltitude ||
      mission.advanced.chaser.inclination !== mission.inclination ||
      mission.advanced.target.inclination !== mission.inclination ||
      mission.advanced.budget !== mission.budget ||
      (mission.family === "deorbit" &&
        mission.advanced.deorbit.perigee !== mission.targetAltitude) ||
      (mission.family !== "deorbit" &&
        (mission.advanced.capture.distance !== mission.tolerance ||
          mission.advanced.capture.speed !== mission.closingSpeed ||
          mission.advanced.relativePosition[1] !== -mission.initialRange))
    )
      throw Error("Advanced scenario and library parameters must agree.");
  }
  return mission;
}
export function validateLibrary(input: unknown): Library {
  if (
    !plain(input) ||
    input.schema !== "orbital.library.v1" ||
    !Number.isInteger(input.revision) ||
    Number(input.revision) < 1 ||
    !Array.isArray(input.clients) ||
    !Array.isArray(input.missions) ||
    input.clients.length < 1 ||
    input.clients.length > 100 ||
    input.missions.length > 1000
  )
    throw Error("Invalid library archive.");
  const clients = input.clients.map((c) => {
    if (
      !plain(c) ||
      !text(c.name, 80) ||
      !text(c.id, 80) ||
      !/^[a-zA-Z0-9-]+$/.test(c.id as string) ||
      !text(c.createdAt, 40) ||
      !Number.isFinite(Date.parse(c.createdAt as string)) ||
      (c.accentColor !== undefined &&
        (typeof c.accentColor !== "string" ||
          !/^#[0-9a-fA-F]{6}$/.test(c.accentColor)))
    )
      throw Error("Invalid client.");
    return {
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      ...(c.accentColor ? { accentColor: c.accentColor } : {}),
    } as Client;
  });
  const missions = input.missions.map(validateMission),
    ids = new Set(clients.map((c) => c.id));
  if (
    ids.size !== clients.length ||
    new Set(missions.map((m) => m.id)).size !== missions.length ||
    missions.some((m) => !ids.has(m.clientId))
  )
    throw Error("Invalid library references.");
  return {
    schema: "orbital.library.v1",
    revision: Number(input.revision),
    clients,
    missions,
  };
}
