import type { Command } from "../../sim-core/src/index.js";
export function parseCommand(input: unknown): Command {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Command must be an object");
  const c = input as Record<string, unknown>;
  if (
    c.type === "advance" &&
    Object.keys(c).length === 2 &&
    Number.isInteger(c.seconds) &&
    typeof c.seconds === "number" &&
    c.seconds > 0 &&
    c.seconds <= 86400 &&
    c.seconds % 2 === 0
  )
    return { type: "advance", seconds: c.seconds };
  if (
    c.type === "burn" &&
    Object.keys(c).length === 3 &&
    typeof c.deltaV === "number" &&
    Number.isFinite(c.deltaV) &&
    c.deltaV >= 0.1 &&
    c.deltaV <= 350 &&
    typeof c.direction === "string" &&
    ["prograde", "retrograde", "radial", "normal"].includes(c.direction)
  )
    return {
      type: "burn",
      deltaV: c.deltaV,
      direction: c.direction as Extract<Command, { type: "burn" }>["direction"],
    };
  throw new Error("Invalid command");
}
export const SCHEMA_VERSION = "1.0.0";
