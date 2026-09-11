import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { fakeBrowser } from "wxt/testing/fake-browser";

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  cleanup();
});
