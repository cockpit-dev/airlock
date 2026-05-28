import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  ListBox,
  ListBoxItem,
  Select,
  Tabs,
  TextArea,
  toast,
} from "@heroui/react";
import { FiMessageSquare, FiSend, FiSquare } from "react-icons/fi";
import { useEffect, useMemo, useRef, useState } from "react";

import { getStoredCredentials } from "../lib/auth";

export const Route = createFileRoute("/playground")({
  component: PlaygroundPage,
});

type Protocol = "openai-chat" | "openai-responses" | "claude" | "gemini";

interface Message {
  role: "user" | "assistant" | "error";
  content: string;
  protocol?: Protocol;
}

const PROTOCOL_LABELS: Record<Protocol, string> = {
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  claude: "Claude Messages",
  gemini: "Gemini Generate",
};

function PlaygroundPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [protocol, setProtocol] = useState<Protocol>("openai-chat");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const creds = getStoredCredentials();
  const gatewayUrl = creds?.url ? stripTrailingSlash(creds.url) : null;
  const gatewayToken = creds?.token ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!gatewayUrl || !gatewayToken) return;
    fetch(`${gatewayUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${gatewayToken}` },
    })
      .then((response) => response.json())
      .then((data) => {
        const ids = (data.data ?? []).map(
          (entry: { id: string }) => entry.id
        ) as string[];
        setModels(ids);
        if (ids.length > 0 && !model) setModel(ids[0]);
      })
      .catch(() => {
        toast.danger("Failed to load models");
      });
  }, [gatewayUrl, gatewayToken, model]);

  const requestPreview = useMemo(() => {
    if (!model) return "";
    return JSON.stringify(
      buildPreviewPayload(protocol, model, input || "Hello from Airlock"),
      null,
      2
    );
  }, [input, model, protocol]);

  async function handleSend() {
    if (!input.trim() || !model || !creds) return;
    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", protocol },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await sendProtocolRequest({
        creds,
        model,
        protocol,
        messages: [...messages, userMessage],
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text().catch(() => response.statusText);
        replaceLastMessage({
          role: "error",
          content: `Error: ${response.status} ${err}`,
          protocol,
        });
        return;
      }

      if (protocol === "openai-chat") {
        await readOpenAiChatStream(response, appendToLastMessage);
      } else {
        const data = await response.json();
        replaceLastMessage({
          role: "assistant",
          content: extractProtocolText(protocol, data),
          protocol,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      replaceLastMessage({
        role: "error",
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        protocol,
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function appendToLastMessage(delta: string) {
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      updated[updated.length - 1] = {
        ...last,
        content: last.content + delta,
      };
      return updated;
    });
  }

  function replaceLastMessage(next: Message) {
    setMessages((prev) => {
      const updated = [...prev];
      updated[updated.length - 1] = next;
      return updated;
    });
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] bg-background">
      <div className="border-b border-border bg-surface px-3 py-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="console-title">Playground</h1>
            <p className="console-subtitle">
              Send requests through the gateway in multiple protocol formats.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select.Root
              aria-label="Model"
              selectedKey={model}
              onSelectionChange={(key) => setModel(key as string | null)}
            >
              <Select.Trigger className="w-full sm:w-60">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {models.map((entry) => (
                    <ListBoxItem id={entry} key={entry} textValue={entry}>
                      {entry}
                    </ListBoxItem>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select.Root>
            {messages.length > 0 && (
              <Button size="sm" variant="ghost" onPress={() => setMessages([])}>
                Clear
              </Button>
            )}
          </div>
        </div>
        <Tabs.Root
          className="mt-2.5"
          selectedKey={protocol}
          onSelectionChange={(key) => setProtocol(key as Protocol)}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Request protocol">
              {Object.entries(PROTOCOL_LABELS).map(([key, label]) => (
                <Tabs.Tab key={key} id={key}>
                  {label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs.Root>
      </div>

      <div className="grid min-h-0 grid-cols-1 bg-surface-secondary/60 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-h-0 overflow-auto p-2.5 sm:p-3 space-y-2.5">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-default text-muted">
                  <FiMessageSquare size={18} className="text-muted" />
                </div>
                <p className="text-muted text-xs">
                  Select a model and send a request.
                </p>
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <MessageBubble
              key={index}
              message={message}
              isStreaming={
                streaming &&
                index === messages.length - 1 &&
                message.role === "assistant"
              }
            />
          ))}
          <div ref={bottomRef} />
        </div>

        <aside className="hidden min-h-0 border-l border-border bg-surface lg:block">
          <Card.Root variant="transparent" className="h-full rounded-none border-0 shadow-none">
            <Card.Header className="px-3 pt-3">
              <Card.Title className="text-sm">Request Preview</Card.Title>
              <Card.Description className="text-[11px]">{PROTOCOL_LABELS[protocol]}</Card.Description>
            </Card.Header>
            <Card.Content className="min-h-0 px-3 pb-3 pt-2">
              <pre className="console-code h-full">
                {requestPreview}
              </pre>
            </Card.Content>
          </Card.Root>
        </aside>
      </div>

      <div className="border-t border-border bg-surface p-2.5">
        <div className="flex items-end gap-2">
          <TextArea
            aria-label="Message"
            placeholder="Type a message..."
            value={input}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              setInput(event.target.value)
            }
            onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            rows={2}
          />
          {streaming ? (
            <Button
              size="sm"
              variant="danger"
              isIconOnly
              aria-label="Stop streaming"
              onPress={() => abortRef.current?.abort()}
            >
              <FiSquare size={14} />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              isIconOnly
              aria-label="Send message"
              onPress={handleSend}
              isDisabled={!input.trim() || !model}
            >
              <FiSend size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming: boolean;
}) {
  if (message.role === "error") {
    return (
      <div className="flex justify-center">
        <Card.Root className="max-w-[90%] border-danger/30 bg-danger/5">
          <Card.Content className="py-1.5 px-3">
            <p className="text-xs text-danger whitespace-pre-wrap">
              {message.content}
            </p>
          </Card.Content>
        </Card.Root>
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-[10px] px-3 py-2 shadow-sm ${
          isUser
            ? "rounded-br-sm bg-accent text-accent-foreground"
            : "rounded-bl-sm bg-default"
        }`}
      >
        {!isUser && message.protocol ? (
          <Chip size="sm" variant="soft" className="mb-1.5 text-[10px]">
            {PROTOCOL_LABELS[message.protocol]}
          </Chip>
        ) : null}
        <p className="whitespace-pre-wrap text-[13px]">{message.content}</p>
        {isStreaming && (
          <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-foreground/50 align-text-bottom" />
        )}
      </div>
    </div>
  );
}

async function sendProtocolRequest({
  creds,
  model,
  protocol,
  messages,
  signal,
}: {
  creds: { url: string; token: string };
  model: string;
  protocol: Protocol;
  messages: Message[];
  signal: AbortSignal;
}): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${creds.token}`,
    "Content-Type": "application/json",
  };
  const body = buildRequestBody(protocol, model, messages);

  if (protocol === "claude") {
    return fetch(`${stripTrailingSlash(creds.url)}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  }

  if (protocol === "gemini") {
    return fetch(
      `${stripTrailingSlash(creds.url)}/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      }
    );
  }

  if (protocol === "openai-responses") {
    return fetch(`${stripTrailingSlash(creds.url)}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  }

  return fetch(`${stripTrailingSlash(creds.url)}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildRequestBody(
  protocol: Protocol,
  model: string,
  messages: Message[]
): unknown {
  const promptMessages = messages
    .filter((message) => message.role !== "error")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

  if (protocol === "claude") {
    return {
      model,
      max_tokens: 1024,
      messages: promptMessages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      })),
    };
  }

  if (protocol === "gemini") {
    return {
      contents: promptMessages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
    };
  }

  if (protocol === "openai-responses") {
    return {
      model,
      input: promptMessages.map((message) => ({
        role: message.role,
        content: [{ type: "input_text", text: message.content }],
      })),
    };
  }

  return {
    model,
    messages: promptMessages,
    stream: true,
  };
}

function buildPreviewPayload(
  protocol: Protocol,
  model: string,
  text: string
): unknown {
  return buildRequestBody(protocol, model, [{ role: "user", content: text }]);
}

async function readOpenAiChatStream(
  response: Response,
  onDelta: (delta: string) => void
) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch {
        // Ignore malformed SSE frames in the playground view.
      }
    }
  }
}

function extractProtocolText(protocol: Protocol, data: unknown): string {
  const value = data as Record<string, unknown>;

  if (protocol === "openai-responses") {
    if (typeof value.output_text === "string") return value.output_text;
    const output = Array.isArray(value.output) ? value.output : [];
    return output
      .flatMap((entry) => {
        const content =
          typeof entry === "object" && entry !== null && "content" in entry
            ? (entry as { content?: unknown }).content
            : undefined;
        return Array.isArray(content) ? content : [];
      })
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .join("");
  }

  if (protocol === "claude") {
    const content = Array.isArray(value.content) ? value.content : [];
    return content
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .join("");
  }

  if (protocol === "gemini") {
    const candidates = Array.isArray(value.candidates) ? value.candidates : [];
    return candidates
      .flatMap((candidate) => {
        const content =
          typeof candidate === "object" &&
          candidate !== null &&
          "content" in candidate
            ? (candidate as { content?: { parts?: unknown } }).content
            : undefined;
        return Array.isArray(content?.parts) ? content.parts : [];
      })
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .join("");
  }

  return JSON.stringify(data, null, 2);
}
