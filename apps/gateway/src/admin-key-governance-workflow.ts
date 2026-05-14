import {
  resolveAdminMutationActorCommand
} from "./admin-actor.js";
import { createAdminKeyGovernanceRuntime } from "./admin-key-governance-runtime.js";
import type { GatewayBindings } from "./env.js";

export function createAdminKeyGovernanceWorkflow(
  env: GatewayBindings,
  requestId: string
) {
  let cachedReadRuntime:
    | ReturnType<typeof createAdminKeyGovernanceRuntime>
    | undefined;

  function getReadRuntime() {
    if (!cachedReadRuntime) {
      cachedReadRuntime = createAdminKeyGovernanceRuntime(env, requestId);
    }

    return cachedReadRuntime;
  }

  return {
    async withRead<T>(
      run: (runtime: ReturnType<typeof createAdminKeyGovernanceRuntime>) => Promise<T> | T
    ): Promise<T> {
      return run(getReadRuntime());
    },
    async withMutation<T>(
      request: Request,
      payload: unknown,
      invalidPayloadMessage: string,
      run: (context: {
        mutation: Awaited<ReturnType<typeof resolveAdminMutationActorCommand>>;
        runtime: ReturnType<typeof createAdminKeyGovernanceRuntime>;
      }) => Promise<T> | T
    ): Promise<T> {
      const mutation = await resolveAdminMutationActorCommand(
        request,
        env,
        payload,
        requestId,
        invalidPayloadMessage
      );

      const runtime = createAdminKeyGovernanceRuntime(
        env,
        requestId,
        mutation.actorContext
      );

      return run({
        mutation,
        runtime
      });
    }
  };
}
