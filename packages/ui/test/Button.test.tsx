import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../src/Button.js";

describe("Button", () => {
  it("renders children and responds to clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Cancel</Button>);
    const button = screen.getByRole("button", { name: "Cancel" });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables interaction while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Submit
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Submit/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
