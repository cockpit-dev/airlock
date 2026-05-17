/**
 * Maximum allowed SSE buffer size in bytes (1 MB).
 * If the buffer exceeds this, the stream is aborted to prevent memory exhaustion.
 */
export const MAX_SSE_BUFFER_SIZE = 1_048_576;

export function assertSseBufferSize(buffer: string, provider: string): void {
  if (buffer.length > MAX_SSE_BUFFER_SIZE) {
    throw new Error(
      `SSE buffer exceeded maximum size (${buffer.length} > ${MAX_SSE_BUFFER_SIZE}) for provider ${provider}`
    );
  }
}
