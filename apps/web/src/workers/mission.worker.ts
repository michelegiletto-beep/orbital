import {
  advancedMissionCommand,
  createAdvancedMission,
  replayAdvancedMission,
} from "../../../../packages/sim-core/src/missions.js";
self.onmessage = (event) => {
  const { id, type, scenario, journal, through, session, command } = event.data;
  try {
    const result =
      type === "create"
        ? createAdvancedMission(scenario)
        : type === "replay"
          ? replayAdvancedMission(scenario, journal, through)
          : advancedMissionCommand(session, command);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error ? error.message : "Mission calculation failed",
    });
  }
};
