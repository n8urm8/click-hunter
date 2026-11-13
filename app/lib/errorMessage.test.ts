import { describe, expect, test } from "vitest";
import { toErrorMessage } from "./errorMessage";

describe("toErrorMessage", () => {
  test("returns the message Convex wraps as Uncaught Error", () => {
    const error = new Error(
      "[CONVEX A(auth:signIn)] [Request ID: abc123] Server Error\nUncaught Error: Invalid credentials\n    at handler (../convex/auth.ts:12:3)"
    );
    expect(toErrorMessage(error, "fallback")).toBe("Invalid credentials");
  });

  test("returns the message of a plain error", () => {
    expect(toErrorMessage(new Error("Name must be 1-32 characters"), "fallback")).toBe(
      "Name must be 1-32 characters"
    );
  });

  test("strips the Convex prefix when there is no Uncaught line", () => {
    const error = new Error("[CONVEX M(players:x)] [Request ID: 9] Server Error");
    expect(toErrorMessage(error, "fallback")).toBe("fallback");
  });

  test("uses the fallback for non-errors", () => {
    expect(toErrorMessage("boom", "fallback")).toBe("fallback");
  });
});
