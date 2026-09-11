import { describe, expect, it } from "vitest";
import type { Face } from "@react-native-ml-kit/face-detection";
import { describeFaceGateReason, evaluateFaceGate } from "../lib/face-gate.js";

const IMAGE_WIDTH = 1000;
const IMAGE_HEIGHT = 1000;

function makeFace(overrides: Partial<Face> = {}): Face {
  return {
    frame: { width: 320, height: 320, top: 340, left: 340 },
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    leftEyeOpenProbability: 0.9,
    rightEyeOpenProbability: 0.9,
    ...overrides,
  } as Face;
}

describe("evaluateFaceGate", () => {
  it("rejects when no face is present", () => {
    const result = evaluateFaceGate([], { imageWidth: IMAGE_WIDTH, imageHeight: IMAGE_HEIGHT });
    expect(result).toEqual({ ok: false, reason: "no-face" });
  });

  it("rejects when more than one face is present", () => {
    const result = evaluateFaceGate([makeFace(), makeFace()], {
      imageWidth: IMAGE_WIDTH,
      imageHeight: IMAGE_HEIGHT,
    });
    expect(result).toEqual({ ok: false, reason: "multiple-faces" });
  });

  it("rejects a face that is too small (too far from camera)", () => {
    const face = makeFace({ frame: { width: 100, height: 100, top: 450, left: 450 } });
    const result = evaluateFaceGate([face], { imageWidth: IMAGE_WIDTH, imageHeight: IMAGE_HEIGHT });
    expect(result).toEqual({ ok: false, reason: "too-small" });
  });

  it("rejects a face that is off-center", () => {
    const face = makeFace({ frame: { width: 320, height: 320, top: 20, left: 20 } });
    const result = evaluateFaceGate([face], { imageWidth: IMAGE_WIDTH, imageHeight: IMAGE_HEIGHT });
    expect(result).toEqual({ ok: false, reason: "off-center" });
  });

  it("rejects when both eyes are closed", () => {
    const face = makeFace({ leftEyeOpenProbability: 0.05, rightEyeOpenProbability: 0.05 });
    const result = evaluateFaceGate([face], { imageWidth: IMAGE_WIDTH, imageHeight: IMAGE_HEIGHT });
    expect(result).toEqual({ ok: false, reason: "eyes-closed" });
  });

  it("does not gate on eyes when probabilities are unavailable", () => {
    const face = makeFace({
      leftEyeOpenProbability: undefined,
      rightEyeOpenProbability: undefined,
    });
    const result = evaluateFaceGate([face], { imageWidth: IMAGE_WIDTH, imageHeight: IMAGE_HEIGHT });
    expect(result).toEqual({ ok: true, reason: "ok" });
  });

  it("accepts a single, centered, close-enough, eyes-open face", () => {
    const result = evaluateFaceGate([makeFace()], {
      imageWidth: IMAGE_WIDTH,
      imageHeight: IMAGE_HEIGHT,
    });
    expect(result).toEqual({ ok: true, reason: "ok" });
  });

  it("respects custom thresholds", () => {
    const face = makeFace({ frame: { width: 200, height: 200, top: 400, left: 400 } });
    const strict = evaluateFaceGate([face], {
      imageWidth: IMAGE_WIDTH,
      imageHeight: IMAGE_HEIGHT,
      minFaceWidthRatio: 0.3,
    });
    expect(strict).toEqual({ ok: false, reason: "too-small" });

    const lenient = evaluateFaceGate([face], {
      imageWidth: IMAGE_WIDTH,
      imageHeight: IMAGE_HEIGHT,
      minFaceWidthRatio: 0.15,
    });
    expect(lenient).toEqual({ ok: true, reason: "ok" });
  });
});

describe("describeFaceGateReason", () => {
  it("returns a human-readable message for every reason", () => {
    const reasons = [
      "no-face",
      "multiple-faces",
      "too-small",
      "off-center",
      "eyes-closed",
      "ok",
    ] as const;
    for (const reason of reasons) {
      expect(describeFaceGateReason(reason)).toBeTruthy();
    }
  });
});
