import { describe, expect, it } from "vitest";

import { createRequestId, resolveRequestId } from "./request-id.js";

describe("request-id", () => {
  describe("createRequestId", () => {
    it("returns a UUID", () => {
      const id = createRequestId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("returns unique IDs", () => {
      expect(createRequestId()).not.toBe(createRequestId());
    });
  });

  describe("resolveRequestId", () => {
    it("generates a UUID when no client ID provided", () => {
      const id = resolveRequestId(undefined);
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("generates a UUID for empty string", () => {
      const id = resolveRequestId("");
      expect(id).not.toContain("in_");
    });

    it("generates a UUID for whitespace-only input", () => {
      const id = resolveRequestId("   ");
      expect(id).not.toContain("in_");
    });

    it("prefixes valid client ID with in_", () => {
      const id = resolveRequestId("my-trace-123");
      expect(id).toBe("in_my-trace-123");
    });

    it("trims whitespace from client ID", () => {
      const id = resolveRequestId("  my-trace-123  ");
      expect(id).toBe("in_my-trace-123");
    });

    it("accepts alphanumeric, dots, dashes, underscores", () => {
      expect(resolveRequestId("abc-123_XYZ.456")).toBe("in_abc-123_XYZ.456");
    });

    it("rejects IDs with special characters", () => {
      const id = resolveRequestId("id/with/slashes");
      expect(id).not.toContain("in_");
    });

    it("rejects IDs exceeding max length", () => {
      const longId = "a".repeat(129);
      const id = resolveRequestId(longId);
      expect(id).not.toContain("in_");
    });

    it("accepts IDs at max length", () => {
      const maxId = "a".repeat(128);
      const id = resolveRequestId(maxId);
      expect(id).toBe(`in_${maxId}`);
    });
  });
});
