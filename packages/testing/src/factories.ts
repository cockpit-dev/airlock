export interface OpenAIChatMessageFixture {
  role: "system" | "user" | "assistant";
  content: string;
}

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
