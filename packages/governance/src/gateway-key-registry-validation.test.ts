import { describe, expect, it } from "vitest";
import { GatewayError } from "@airlock/shared";
import {
  assertRegistryOwnedKeyId,
  assertRegistryOwnedKeyIds,
  createGatewayKeyAlreadyArchivedError,
  createGatewayKeyNotArchivedError,
  createGatewayKeyNotFoundError,
  createGatewayKeyNotRegistryOwnedError,
  createGatewayKeyRotationNotCancelableError,
  createGatewayKeyRotationNotStagedError,
  isStringArray,
  requireRegistryKey,
  requireRegistryKeys
} from "./gateway-key-registry-validation.js";
import type { GatewayKeyRegistryDynamicKeyView } from "./gateway-key-registry.js";

describe("gateway-key-registry-validation", () => {
  describe("error constructors", () => {
    it("createGatewayKeyNotRegistryOwnedError returns 409", () => {
      const err = createGatewayKeyNotRegistryOwnedError("req_1");
      expect(err).toBeInstanceOf(GatewayError);
      expect(err.httpStatus).toBe(409);
      expect(err.code).toBe("gateway_key_not_registry_owned");
      expect(err.requestId).toBe("req_1");
    });

    it("createGatewayKeyNotFoundError returns 404", () => {
      const err = createGatewayKeyNotFoundError("req_2");
      expect(err).toBeInstanceOf(GatewayError);
      expect(err.httpStatus).toBe(404);
      expect(err.code).toBe("gateway_key_not_found");
      expect(err.requestId).toBe("req_2");
    });

    it("createGatewayKeyRotationNotStagedError returns 409", () => {
      const err = createGatewayKeyRotationNotStagedError("req_3");
      expect(err).toBeInstanceOf(GatewayError);
      expect(err.httpStatus).toBe(409);
      expect(err.code).toBe("gateway_key_rotation_not_staged");
    });

    it("createGatewayKeyRotationNotCancelableError returns 409", () => {
      const err = createGatewayKeyRotationNotCancelableError("req_4");
      expect(err).toBeInstanceOf(GatewayError);
      expect(err.httpStatus).toBe(409);
      expect(err.code).toBe("gateway_key_rotation_not_cancelable");
    });

    it("createGatewayKeyAlreadyArchivedError returns 409", () => {
      const err = createGatewayKeyAlreadyArchivedError("req_5");
      expect(err).toBeInstanceOf(GatewayError);
      expect(err.httpStatus).toBe(409);
      expect(err.code).toBe("gateway_key_already_archived");
    });

    it("createGatewayKeyNotArchivedError returns 409", () => {
      const err = createGatewayKeyNotArchivedError("req_6");
      expect(err).toBeInstanceOf(GatewayError);
      expect(err.httpStatus).toBe(409);
      expect(err.code).toBe("gateway_key_not_archived");
    });
  });

  describe("assertRegistryOwnedKeyId", () => {
    it("does nothing for non-configured key", () => {
      const isConfiguredKey = (id: string) => id.startsWith("cfg_");
      expect(() =>
        assertRegistryOwnedKeyId("reg_abc", "req_1", isConfiguredKey)
      ).not.toThrow();
    });

    it("throws for configured key", () => {
      const isConfiguredKey = (id: string) => id.startsWith("cfg_");
      expect(() =>
        assertRegistryOwnedKeyId("cfg_abc", "req_1", isConfiguredKey)
      ).toThrow(GatewayError);
    });

    it("throws error with correct code for configured key", () => {
      const isConfiguredKey = () => true;
      try {
        assertRegistryOwnedKeyId("any_key", "req_test", isConfiguredKey);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayError);
        const gw = e as GatewayError;
        expect(gw.code).toBe("gateway_key_not_registry_owned");
        expect(gw.requestId).toBe("req_test");
      }
    });
  });

  describe("assertRegistryOwnedKeyIds", () => {
    it("does nothing when all keys are non-configured", () => {
      const isConfiguredKey = (id: string) => id.startsWith("cfg_");
      expect(() =>
        assertRegistryOwnedKeyIds(["reg_1", "reg_2"], "req_1", isConfiguredKey)
      ).not.toThrow();
    });

    it("throws when any key is configured", () => {
      const isConfiguredKey = (id: string) => id.startsWith("cfg_");
      expect(() =>
        assertRegistryOwnedKeyIds(
          ["reg_1", "cfg_bad"],
          "req_1",
          isConfiguredKey
        )
      ).toThrow(GatewayError);
    });

    it("does nothing for empty array", () => {
      const isConfiguredKey = () => true;
      expect(() =>
        assertRegistryOwnedKeyIds([], "req_1", isConfiguredKey)
      ).not.toThrow();
    });
  });

  describe("requireRegistryKey", () => {
    it("returns key when found", async () => {
      const key: GatewayKeyRegistryDynamicKeyView = {
        keyId: "key_1",
        ownership: "registry",
        key: {
          id: "key_1",
          label: "test",
          valueHash: "hash_1",
          status: "active"
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const getRegistryKey = async (_keyId: string) =>
        await Promise.resolve(key);

      const result = await requireRegistryKey("key_1", "req_1", getRegistryKey);
      expect(result).toBe(key);
    });

    it("throws 404 when key not found", async () => {
      const getRegistryKey = async (_keyId: string) =>
        await Promise.resolve(null);

      await expect(
        requireRegistryKey("missing", "req_1", getRegistryKey)
      ).rejects.toThrow(GatewayError);

      try {
        await requireRegistryKey("missing", "req_err", getRegistryKey);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayError);
        const gw = e as GatewayError;
        expect(gw.httpStatus).toBe(404);
        expect(gw.requestId).toBe("req_err");
      }
    });
  });

  describe("requireRegistryKeys", () => {
    const key1: GatewayKeyRegistryDynamicKeyView = {
      keyId: "key_1",
      ownership: "registry",
      key: { id: "key_1", label: "test-1", valueHash: "h1", status: "active" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const key2: GatewayKeyRegistryDynamicKeyView = {
      keyId: "key_2",
      ownership: "registry",
      key: { id: "key_2", label: "test-2", valueHash: "h2", status: "active" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    it("returns all keys when all found", async () => {
      const getRegistryKeys = async (_keyIds: readonly string[]) =>
        await Promise.resolve([key1, key2]);
      const result = await requireRegistryKeys(
        ["key_1", "key_2"],
        "req_1",
        getRegistryKeys
      );
      expect(result).toEqual([key1, key2]);
    });

    it("throws 404 when any key is null", async () => {
      const getRegistryKeys = async (_keyIds: readonly string[]) =>
        await Promise.resolve([key1, null]);
      await expect(
        requireRegistryKeys(["key_1", "key_2"], "req_1", getRegistryKeys)
      ).rejects.toThrow(GatewayError);
    });

    it("throws on length mismatch", async () => {
      const getRegistryKeys = async (_keyIds: readonly string[]) =>
        await Promise.resolve([key1]);
      await expect(
        requireRegistryKeys(["key_1", "key_2"], "req_1", getRegistryKeys)
      ).rejects.toThrow("Registry key batch response length mismatch");
    });
  });

  describe("isStringArray", () => {
    it("returns true for string array", () => {
      expect(isStringArray(["a", "b", "c"])).toBe(true);
    });

    it("returns true for empty array", () => {
      expect(isStringArray([])).toBe(true);
    });

    it("returns false for non-array", () => {
      expect(isStringArray("string")).toBe(false);
      expect(isStringArray(42)).toBe(false);
      expect(isStringArray(null)).toBe(false);
    });

    it("returns false for array with non-string elements", () => {
      expect(isStringArray([1, 2, 3])).toBe(false);
      expect(isStringArray(["a", 1])).toBe(false);
    });

    it("returns false for array with empty strings", () => {
      expect(isStringArray(["a", ""])).toBe(false);
      expect(isStringArray(["a", "  "])).toBe(false);
    });
  });
});
