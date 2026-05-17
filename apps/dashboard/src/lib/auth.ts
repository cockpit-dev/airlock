import { browser } from "$app/environment";
import { AirlockClient, AuthError } from "./api.js";

const STORAGE_KEY_URL = "airlock_gateway_url";
const STORAGE_KEY_TOKEN = "airlock_admin_token";

export function getStoredCredentials(): { url: string; token: string } | null {
  if (!browser) return null;
  const url = localStorage.getItem(STORAGE_KEY_URL);
  const token = localStorage.getItem(STORAGE_KEY_TOKEN);
  if (!url || !token) return null;
  return { url, token };
}

export function storeCredentials(url: string, token: string): void {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY_URL, url);
  localStorage.setItem(STORAGE_KEY_TOKEN, token);
}

export function clearCredentials(): void {
  if (!browser) return;
  localStorage.removeItem(STORAGE_KEY_URL);
  localStorage.removeItem(STORAGE_KEY_TOKEN);
}

export function createClient(
  url?: string,
  token?: string,
  fetchFn?: typeof fetch
): AirlockClient | null {
  if (url && token) {
    return new AirlockClient(url, token, fetchFn);
  }

  const creds = getStoredCredentials();
  if (!creds) return null;
  return new AirlockClient(creds.url, creds.token, fetchFn);
}

export async function verifyCredentials(
  url: string,
  token: string
): Promise<boolean> {
  try {
    const client = new AirlockClient(url, token);
    await client.getStatus();
    return true;
  } catch (error) {
    if (error instanceof AuthError) return false;
    throw error;
  }
}
