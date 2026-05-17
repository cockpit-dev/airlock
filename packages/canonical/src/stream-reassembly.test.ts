import { describe, it, expect } from "vitest";
import { createStreamReassemblyIterable } from "./stream-reassembly.js";
import type { CanonicalStreamEvent } from "./models.js";

async function collect(
  source: AsyncIterable<CanonicalStreamEvent>
): Promise<CanonicalStreamEvent[]> {
  const events: CanonicalStreamEvent[] = [];
  for await (const event of source) {
    events.push(event);
  }
  return events;
}

async function* fromEvents(
  events: CanonicalStreamEvent[]
): AsyncIterable<CanonicalStreamEvent> {
  await Promise.resolve();
  for (const event of events) {
    yield event;
  }
}

const STARTED: CanonicalStreamEvent = {
  type: "response_started",
  responseId: "resp_123",
  model: "gpt-4"
};

const DELTA: CanonicalStreamEvent = {
  type: "output_text_delta",
  responseId: "resp_123",
  model: "gpt-4",
  delta: "hello"
};

const TOOL_DELTA: CanonicalStreamEvent = {
  type: "tool_call_delta",
  responseId: "resp_123",
  model: "gpt-4",
  toolCallId: "call_1",
  toolIndex: 0,
  toolName: "search",
  argumentsDelta: '{"query":"test"}'
};

const COMPLETED: CanonicalStreamEvent = {
  type: "response_completed",
  responseId: "resp_123",
  model: "gpt-4",
  finishReason: "stop",
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
};

describe("createStreamReassemblyIterable", () => {
  it("passes through a normal complete stream unchanged", async () => {
    const input = [STARTED, DELTA, COMPLETED];
    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents(input),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toEqual(input);
  });

  it("synthesizes response_started when missing", async () => {
    const input = [DELTA, COMPLETED];
    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents(input),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toHaveLength(3);
    expect(result[0]?.type).toBe("response_started");
    expect(result[0]?.responseId).toBe("fallback_1");
    expect(result[0]?.model).toBe("fallback-model");
    expect(result[1]).toEqual(DELTA);
    expect(result[2]).toEqual(COMPLETED);
  });

  it("synthesizes response_completed when missing", async () => {
    const input = [STARTED, DELTA];
    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents(input),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(STARTED);
    expect(result[1]).toEqual(DELTA);
    const completed = result[2];
    expect(completed?.type).toBe("response_completed");
    if (completed?.type === "response_completed") {
      expect(completed.finishReason).toBe("max_tokens");
    }
  });

  it("synthesizes both started and completed when both are missing", async () => {
    const input = [DELTA, TOOL_DELTA];
    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents(input),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toHaveLength(4);
    expect(result[0]?.type).toBe("response_started");
    expect(result[1]).toEqual(DELTA);
    expect(result[2]).toEqual(TOOL_DELTA);
    expect(result[3]?.type).toBe("response_completed");
  });

  it("yields nothing for an empty stream", async () => {
    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents([]),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toEqual([]);
  });

  it("synthesizes completion when only started is present", async () => {
    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents([STARTED]),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(STARTED);
    expect(result[1]?.type).toBe("response_completed");
  });

  it("synthesizes started when only completed is present", async () => {
    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents([COMPLETED]),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe("response_started");
    expect(result[1]).toEqual(COMPLETED);
  });

  it("propagates errors without synthesizing completion", async () => {
    async function* failingSource(): AsyncIterable<CanonicalStreamEvent> {
      await Promise.resolve();
      yield STARTED;
      yield DELTA;
      throw new Error("provider disconnected");
    }

    const iterable = createStreamReassemblyIterable(
      failingSource(),
      "fallback_1",
      "fallback-model"
    );

    await expect(collect(iterable)).rejects.toThrow("provider disconnected");
  });

  it("tracks responseId and model from delta events", async () => {
    const deltaWithDifferentModel: CanonicalStreamEvent = {
      type: "output_text_delta",
      responseId: "resp_updated",
      model: "gpt-4-turbo",
      delta: "world"
    };

    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents([STARTED, DELTA, deltaWithDifferentModel]),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toHaveLength(4);
    const completed = result[3]!;
    expect(completed.type).toBe("response_completed");
    if (completed.type === "response_completed") {
      expect(completed.responseId).toBe("resp_updated");
      expect(completed.model).toBe("gpt-4-turbo");
    }
  });

  it("handles stream with only deltas and tool deltas", async () => {
    const result = await collect(
      createStreamReassemblyIterable(
        fromEvents([DELTA, TOOL_DELTA]),
        "fallback_1",
        "fallback-model"
      )
    );
    expect(result).toHaveLength(4);
    expect(result[0]?.type).toBe("response_started");
    expect(result[1]).toEqual(DELTA);
    expect(result[2]).toEqual(TOOL_DELTA);
    expect(result[3]?.type).toBe("response_completed");
  });
});
