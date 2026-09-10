import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusIndicator } from "../src/StatusIndicator.js";

describe("StatusIndicator", () => {
  it("shows the human label for a given status", () => {
    render(<StatusIndicator status="CREATED" />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for phone");
  });

  it("reflects VERIFIED with a live region for screen readers", () => {
    render(<StatusIndicator status="VERIFIED" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Verified");
  });
});
