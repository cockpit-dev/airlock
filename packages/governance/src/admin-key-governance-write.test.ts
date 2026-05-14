import { describe, expect, it } from "vitest";

import {
  resolveAdminMutationActorCommand,
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

describe("resolveAdminMutationActorCommand", () => {
  it("prefers structured credential actor over trusted header and payload actor metadata", async () => {
    await expect(
      resolveAdminMutationActorCommand({
        request: new Request("http://localhost/_airlock/keys", {
          headers: {
            authorization: "Bearer gateway-secret",
            "cf-access-authenticated-user-email": "header@example.com",
            "content-type": "application/json"
          }
        }),
        payload: {
          id: "key_dynamic",
          actor: "payload@example.com"
        },
        requestId: "req_123",
        invalidPayloadMessage: "Gateway dynamic key create payload is invalid",
        actorRequired: false,
        trustedActorHeaderName: "cf-access-authenticated-user-email",
        adminToken: undefined,
        structuredCredentialsConfig: JSON.stringify([
          {
            id: "ops_primary",
            tokenHash:
              "1e0baae50a6e2006d894f9e64c53a1317e6032f4ba67df08199d5378c5948ce6",
            actor: "credential@example.com"
          }
        ])
      })
    ).resolves.toEqual({
      actorContext: {
        actor: "credential@example.com",
        actorSource: "credential"
      },
      payload: {
        id: "key_dynamic"
      }
    });
  });

  it("rejects invalid trusted actor header values with the authentication error contract", async () => {
    await expect(
      resolveAdminMutationActorCommand({
        request: new Request("http://localhost/_airlock/keys", {
          headers: {
            authorization: "Bearer admin-secret",
            "cf-access-authenticated-user-email": "   "
          }
        }),
        payload: {
          id: "key_dynamic"
        },
        requestId: "req_123",
        invalidPayloadMessage: "Gateway dynamic key create payload is invalid",
        actorRequired: false,
        trustedActorHeaderName: "cf-access-authenticated-user-email",
        adminToken: "admin-secret",
        structuredCredentialsConfig: undefined
      })
    ).rejects.toMatchObject({
      code: "auth_invalid_admin_actor"
    });
  });

  it("requires actor metadata when configured and no credential, header, or payload actor exists", async () => {
    await expect(
      resolveAdminMutationActorCommand({
        request: new Request("http://localhost/_airlock/keys", {
          headers: {
            authorization: "Bearer admin-secret"
          }
        }),
        payload: {
          id: "key_dynamic"
        },
        requestId: "req_123",
        invalidPayloadMessage: "Gateway dynamic key create payload is invalid",
        actorRequired: true,
        trustedActorHeaderName: undefined,
        adminToken: "admin-secret",
        structuredCredentialsConfig: undefined
      })
    ).rejects.toMatchObject({
      code: "auth_admin_actor_required"
    });
  });
});
