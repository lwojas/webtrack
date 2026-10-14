import { describe, expect, it, vi } from "vitest";
import { createResampleController } from "../src/audio/resampleController.js";

// A faked webdsp AudioRuntime slice — same convention test/lookaheadPlayer.test.js's
// createFakeRuntime uses — just the two calls resampleController.js actually touches.
function createFakeRuntime({ maxCaptureSeconds = 30 } = {}) {
  let pendingResolve;
  let pendingReject;
  const armCapture = vi.fn(() => ({
    handle: { id: 1 },
    result: new Promise((resolve, reject) => {
      pendingResolve = resolve;
      pendingReject = reject;
    }),
  }));
  return {
    getCapabilities: () => ({ maxCaptureSeconds }),
    armCapture,
    resolveCapture(value) {
      pendingResolve(value);
    },
    rejectCapture(err) {
      pendingReject(err);
    },
  };
}

describe("createResampleController", () => {
  it("refuses to arm when nothing is playing", () => {
    const runtime = createFakeRuntime();
    const controller = createResampleController({ runtime, isPlaying: () => false });

    const armed = controller.arm(16, 0.125);

    expect(armed.ok).toBe(false);
    expect(runtime.armCapture).not.toHaveBeenCalled();
  });

  it("refuses a second arm while one is already in progress", () => {
    const runtime = createFakeRuntime();
    const controller = createResampleController({ runtime, isPlaying: () => true });

    controller.arm(16, 0.125);
    const second = controller.arm(16, 0.125);

    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already in progress/);
  });

  it("refuses synchronously (no armCapture call at all) when the estimated duration exceeds capacity", () => {
    const runtime = createFakeRuntime({ maxCaptureSeconds: 1 });
    const controller = createResampleController({ runtime, isPlaying: () => true });

    const armed = controller.arm(64, 0.125); // 64 * 0.125 = 8s > 1s capacity

    expect(armed.ok).toBe(false);
    expect(armed.reason).toMatch(/exceeds/);
    expect(runtime.armCapture).not.toHaveBeenCalled();
  });

  it("onStepScheduled is a no-op until something is armed", () => {
    const runtime = createFakeRuntime();
    const controller = createResampleController({ runtime, isPlaying: () => true });

    controller.onStepScheduled(5.0, 0.125);

    expect(runtime.armCapture).not.toHaveBeenCalled();
    expect(controller.getStatus()).toBe("idle");
  });

  it("captures exactly [stepTime, stepTime + steps*duration) at the next step boundary, using the grid time, not a swing-shifted one", async () => {
    const runtime = createFakeRuntime();
    const controller = createResampleController({ runtime, isPlaying: () => true });

    const armed = controller.arm(16, 0.125);
    expect(armed.ok).toBe(true);
    expect(controller.getStatus()).toBe("armed");

    // Simulates lookaheadPlayer.js's tick() reporting the *unswung* grid time for the next
    // step it's about to schedule — resampleController.js never sees the swing-delayed
    // scheduledTime at all.
    controller.onStepScheduled(10.0, 0.125);

    expect(runtime.armCapture).toHaveBeenCalledTimes(1);
    expect(runtime.armCapture).toHaveBeenCalledWith({ startTime: 10.0, stopTime: 10.0 + 16 * 0.125 });
    expect(controller.getStatus()).toBe("capturing");

    const captured = { metadata: { id: 99 }, channelData: [] };
    runtime.resolveCapture(captured);
    await expect(armed.result).resolves.toBe(captured);
    expect(controller.getStatus()).toBe("idle");
  });

  it("ignores further onStepScheduled calls once capturing has started", () => {
    const runtime = createFakeRuntime();
    const controller = createResampleController({ runtime, isPlaying: () => true });

    controller.arm(16, 0.125);
    controller.onStepScheduled(10.0, 0.125);
    controller.onStepScheduled(10.125, 0.125); // the very next step, after capturing already began

    expect(runtime.armCapture).toHaveBeenCalledTimes(1);
  });

  it("rejects the result promise if armCapture() throws synchronously (e.g. a late capacity check)", async () => {
    const runtime = createFakeRuntime();
    runtime.armCapture.mockImplementation(() => {
      throw new Error("capacity exceeded");
    });
    const controller = createResampleController({ runtime, isPlaying: () => true });

    const armed = controller.arm(16, 0.125);
    controller.onStepScheduled(10.0, 0.125);

    await expect(armed.result).rejects.toThrow("capacity exceeded");
    expect(controller.getStatus()).toBe("idle");
  });

  it("cancel() rejects an armed-but-not-yet-capturing resample and frees it for a new arm()", async () => {
    const runtime = createFakeRuntime();
    const controller = createResampleController({ runtime, isPlaying: () => true });

    const armed = controller.arm(16, 0.125);
    controller.cancel("stopped");

    await expect(armed.result).rejects.toThrow("stopped");
    expect(controller.getStatus()).toBe("idle");

    const second = controller.arm(16, 0.125);
    expect(second.ok).toBe(true);
  });

  it("cancel() during capturing rejects immediately, and the engine's later resolution is silently ignored", async () => {
    const runtime = createFakeRuntime();
    const controller = createResampleController({ runtime, isPlaying: () => true });

    const armed = controller.arm(16, 0.125);
    controller.onStepScheduled(10.0, 0.125);
    controller.cancel("playback stopped");

    await expect(armed.result).rejects.toThrow("playback stopped");

    // The underlying webdsp capture has no cancel — it runs to completion. Its eventual
    // resolution must not throw (a promise can only settle once) and must not resurrect state.
    expect(() => runtime.resolveCapture({ metadata: {}, channelData: [] })).not.toThrow();
    expect(controller.getStatus()).toBe("idle");
  });
});
