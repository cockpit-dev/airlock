import type { CanonicalStreamEvent } from "./models.js";

export async function* createStreamReassemblyIterable(
  source: AsyncIterable<CanonicalStreamEvent>,
  fallbackResponseId: string,
  fallbackModel: string
): AsyncIterable<CanonicalStreamEvent> {
  let sawStarted = false;
  let sawCompleted = false;
  let activeResponseId = fallbackResponseId;
  let activeModel = fallbackModel;

  for await (const event of source) {
    if (event.type === "response_started") {
      sawStarted = true;
      activeResponseId = event.responseId;
      activeModel = event.model;
      yield event;
      continue;
    }

    if (!sawStarted) {
      sawStarted = true;
      yield {
        type: "response_started",
        responseId: activeResponseId,
        model: activeModel
      };
    }

    if (event.type === "response_completed") {
      sawCompleted = true;
      yield event;
      continue;
    }

    activeResponseId = event.responseId;
    activeModel = event.model;
    yield event;
  }

  if (sawStarted && !sawCompleted) {
    yield {
      type: "response_completed",
      responseId: activeResponseId,
      model: activeModel,
      finishReason: "stop"
    };
  }
}
