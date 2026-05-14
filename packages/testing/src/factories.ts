export interface OpenAIChatTextContentPartFixture {
  type: "text";
  text: string;
}

export type OpenAIChatMessageFixture =
  | {
      role: "system" | "user" | "developer";
      content: string | OpenAIChatTextContentPartFixture[];
    }
  | {
      role: "assistant";
      content: string | OpenAIChatTextContentPartFixture[];
    }
  | {
      role: "assistant";
      content: string;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

export interface OpenAIChatRequestFixture {
  model: string;
  stream: false;
  messages: OpenAIChatMessageFixture[];
}

export function createOpenAIChatRequestFixture(): OpenAIChatRequestFixture {
  return {
    model: "gpt-4.1-mini",
    stream: false,
    messages: [
      {
        role: "system",
        content: "You are precise."
      },
      {
        role: "user",
        content: "Say hi."
      }
    ]
  };
}
