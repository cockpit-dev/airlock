export function createRequestId(): string {
  return crypto.randomUUID();
}

const INBOUND_REQUEST_ID_PREFIX = "in_";
const INBOUND_REQUEST_ID_MAX_LENGTH = 128;
const INBOUND_REQUEST_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function resolveRequestId(
  clientRequestId: string | undefined
): string {
  if (!clientRequestId) return createRequestId();
  const trimmed = clientRequestId.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > INBOUND_REQUEST_ID_MAX_LENGTH ||
    !INBOUND_REQUEST_ID_PATTERN.test(trimmed)
  ) {
    return createRequestId();
  }
  return `${INBOUND_REQUEST_ID_PREFIX}${trimmed}`;
}
