import { describe, expect, it } from "vitest";

import {
  buildAdminMutationActorCommand,
  buildAdminMutationPayload,
  resolveAdminActorContextFromInputs
} from "./admin-key-governance-write.js";

describe("resolveAdminActorContextFromInputs", () => {
  it("prefers credential actor over trusted header and payload actors", () => {
    expect(
      resolveAdminActorContextFromInputs({
        credentialActor: "credential@example.com",
        trustedHeaderActor: "header@example.com",
        payloadActor: "payload@example.com",
        actorRequired: false,
        requestId: "req_123"
      })
    ).toEqual({
      actor: "credential@example.com",
      actorSource: "credential"
    });
  });

  it("falls back from trusted header to payload actor", () => {
    expect(
      resolveAdminActorContextFromInputs({
        credentialActor: undefined,
        trustedHeaderActor: "header@example.com",
        payloadActor: "payload@example.com",
        actorRequired: false,
        requestId: "req_123"
      })
    ).toEqual({
      actor: "header@example.com",
      actorSource: "trusted_header"
    });

    expect(
      resolveAdminActorContextFromInputs({
        credentialActor: undefined,
        trustedHeaderActor: undefined,
        payloadActor: "payload@example.com",
        actorRequired: false,
        requestId: "req_123"
      })
    ).toEqual({
      actor: "payload@example.com",
      actorSource: "payload"
    });
  });

  it("rejects missing actor metadata when actor is required", () => {
    try {
      resolveAdminActorContextFromInputs({
        credentialActor: undefined,
        trustedHeaderActor: undefined,
        payloadActor: undefined,
        actorRequired: true,
        requestId: "req_123"
      });
      throw new Error("expected actor-required validation to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "auth_admin_actor_required"
      });
    }
  });
});

describe("buildAdminMutationPayload", () => {
  it("strips actor metadata from object payloads when actor context is present", () => {
    expect(
      buildAdminMutationPayload(
        {
          reason: "scheduled rollover",
          actor: "payload@example.com",
          actorSource: "payload"
        },
        {
          actor: "credential@example.com",
          actorSource: "credential"
        }
      )
    ).toEqual({
      reason: "scheduled rollover"
    });
  });

  it("leaves non-object payloads unchanged", () => {
    expect(buildAdminMutationPayload(undefined, undefined)).toBeUndefined();
    expect(buildAdminMutationPayload("payload", undefined)).toBe("payload");
  });
});

describe("buildAdminMutationActorCommand", () => {
  it("returns normalized actor context and stripped payload for mutation orchestration", () => {
    expect(
      buildAdminMutationActorCommand({
        payload: {
          id: "key_dynamic",
          actor: "payload@example.com",
          actorSource: "payload"
        },
        credentialActor: undefined,
        payloadActor: "payload@example.com",
        trustedHeaderActor: "header@example.com",
        actorRequired: false,
        requestId: "req_123"
      })
    ).toEqual({
      actorContext: {
        actor: "header@example.com",
        actorSource: "trusted_header"
      },
      payload: {
        id: "key_dynamic"
      }
    });
  });

  it("returns untouched payload when no actor context resolves", () => {
    expect(
      buildAdminMutationActorCommand({
        payload: {
          reason: "cleanup"
        },
        credentialActor: undefined,
        trustedHeaderActor: undefined,
        payloadActor: undefined,
        actorRequired: false,
        requestId: "req_123"
      })
    ).toEqual({
      payload: {
        reason: "cleanup"
      }
    });
  });
});
