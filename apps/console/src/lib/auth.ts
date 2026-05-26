import { AirlockClient, AuthError } from "./api";

const STORAGE_KEY_URL = "airlock_gateway_url";
const STORAGE_KEY_TOKEN = "airlock_admin_token";

export function getStoredCredentials(): { url: string; token: string } | null {
  const url = localStorage.getItem(STORAGE_KEY_URL);
  const token = localStorage.getItem(STORAGE_KEY_TOKEN);
  if (!url || !token) return null;
  return { url, token };
}

export function storeCredentials(url: string, token: string): void {
  localStorage.setItem(STORAGE_KEY_URL, url);
  localStorage.setItem(STORAGE_KEY_TOKEN, token);
}

export function clearCredentials(): void {
  localStorage.removeItem(STORAGE_KEY_URL);
  localStorage.removeItem(STORAGE_KEY_TOKEN);
}

export function createClientFromStorage(): AirlockClient | null {
  const creds = getStoredCredentials();
  if (!creds) return null;
  return new AirlockClient(creds.url, creds.token);
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
