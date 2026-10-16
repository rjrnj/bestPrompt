// Runs before every Vitest file: jest-dom matchers and React Testing Library
// cleanup (automatic only when Vitest globals are on, which they are not).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
