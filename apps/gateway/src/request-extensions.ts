import { parseRequestRequestShaping, type RequestShapingProfile } from "@airlock/request-shaping";

export function parseRequestShapingExtension(
  input: unknown
): RequestShapingProfile | undefined {
  if (input === undefined) {
    return undefined;
  }

  return parseRequestRequestShaping(input);
}
