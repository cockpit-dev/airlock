class AirlockClient {
  baseUrl;
  token;
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }
  async request(path, options) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
    if (response.status === 401) {
      throw new AuthError("Unauthorized");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(
        body?.error?.message ?? `HTTP ${response.status}`,
        response.status
      );
    }
    return response.json();
  }
  // Health
  getStatus() {
    return this.request("/_airlock/status");
  }
  getMetrics() {
    return this.request("/_airlock/metrics");
  }
  getConfig() {
    return this.request("/_airlock/config");
  }
  getRoutingHealth() {
    return this.request("/_airlock/routing/health");
  }
  // Keys
  listKeys(params) {
    const query = params ? "?" + new URLSearchParams(params).toString() : "";
    return this.request(`/_airlock/keys${query}`);
  }
  getKey(keyId) {
    return this.request(`/_airlock/keys/${keyId}`);
  }
  createKey(payload) {
    return this.request("/_airlock/keys", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
  deleteKey(keyId, payload) {
    return this.request(`/_airlock/keys/${keyId}`, {
      method: "DELETE",
      ...payload ? { body: JSON.stringify(payload) } : {}
    });
  }
  rotateKey(keyId, payload) {
    return this.request(`/_airlock/keys/${keyId}/rotate`, {
      method: "POST",
      ...payload ? { body: JSON.stringify(payload) } : {}
    });
  }
  archiveKey(keyId, payload) {
    return this.request(`/_airlock/keys/${keyId}/archive`, {
      method: "POST",
      ...payload ? { body: JSON.stringify(payload) } : {}
    });
  }
  restoreKey(keyId, payload) {
    return this.request(`/_airlock/keys/${keyId}/restore`, {
      method: "POST",
      ...payload ? { body: JSON.stringify(payload) } : {}
    });
  }
  revokeKey(keyId, payload) {
    return this.request(`/_airlock/keys/${keyId}/revocation`, {
      method: "POST",
      ...payload ? { body: JSON.stringify(payload) } : {}
    });
  }
  getKeyStatus(keyId) {
    return this.request(`/_airlock/keys/${keyId}/status`);
  }
  getKeyEvents(keyId) {
    return this.request(`/_airlock/keys/${keyId}/events`);
  }
}
class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}
class ApiError extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
function getStoredCredentials() {
  return null;
}
function createClient() {
  const creds = getStoredCredentials();
  if (!creds) return null;
  return new AirlockClient(creds.url, creds.token);
}
export {
  createClient as c,
  getStoredCredentials as g
};
