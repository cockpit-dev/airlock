export async function dispatchGovernanceTransport<T>(
  getStub: () => Promise<{
    fetch(request: Request): Promise<Response>;
  }> | {
    fetch(request: Request): Promise<Response>;
  },
  request: Request,
  requestId: string,
  options: {
    parse(response: Response): Promise<T> | T;
    handleStatus?: (response: Response) => Promise<T | undefined> | T | undefined;
    createUnavailableError(requestId: string, cause?: unknown): Error;
    createInvalidResponseError(requestId: string, cause?: unknown): Error;
  }
): Promise<T> {
  let response: Response;

  try {
    response = await (await getStub()).fetch(request);
  } catch (cause) {
    throw options.createUnavailableError(requestId, cause);
  }

  if (!response.ok) {
    const handled = options.handleStatus
      ? await options.handleStatus(response)
      : undefined;

    if (handled !== undefined) {
      return handled;
    }

    throw options.createUnavailableError(requestId);
  }

  try {
    return await options.parse(response);
  } catch (cause) {
    throw options.createInvalidResponseError(requestId, cause);
  }
}
