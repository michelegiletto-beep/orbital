import {
  forecast,
  dispersion,
  type Workspace,
} from "../../../../packages/sim-core/src/advanced.js";
const scope = self as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = (event) => {
  const { id, type, workspace, options } = event.data as {
    id: number;
    type: "forecast" | "dispersion";
    workspace: Workspace;
    options: {
      vehicleId: string;
      seed: number;
      count: number;
      seconds: number;
      positionSigma: number;
      velocitySigma: number;
      stride: number;
    };
  };
  try {
    const result =
      type === "dispersion"
        ? dispersion(workspace, options.vehicleId, options)
        : forecast(workspace, options.seconds, options.stride);
    scope.postMessage({ id, type, result });
  } catch (error) {
    scope.postMessage({
      id,
      type,
      error: error instanceof Error ? error.message : "Analysis failed",
    });
  }
};
