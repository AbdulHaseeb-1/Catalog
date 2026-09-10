import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Countdown } from "../src/Countdown.js";

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the initial mm:ss remaining", () => {
    render(<Countdown expiresAt="2026-01-01T00:04:42.000Z" label="Expires in" />);
    expect(screen.getByText("Expires in 4:42")).toBeInTheDocument();
  });

  it("counts down and calls onExpire once it hits zero", () => {
    const onExpire = vi.fn();
    render(<Countdown expiresAt="2026-01-01T00:00:02.000Z" onExpire={onExpire} />);
    expect(screen.getByText("0:02")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(onExpire).toHaveBeenCalledOnce();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onExpire).toHaveBeenCalledOnce();
  });
});
