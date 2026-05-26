import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Select,
  TextArea,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { FiMessageSquare, FiSend, FiSquare } from "react-icons/fi";
import { useState, useRef, useEffect } from "react";
import { getStoredCredentials } from "../lib/auth";

export const Route = createFileRoute("/playground")({
  component: PlaygroundPage,
});

interface Message {
  role: "user" | "assistant" | "error";
  content: string;
}

function PlaygroundPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const creds = getStoredCredentials();
  const gatewayUrl = creds?.url ?? null;
  const gatewayToken = creds?.token ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!gatewayUrl || !gatewayToken) return;
    fetch(`${gatewayUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${gatewayToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const ids = (data.data ?? []).map(
          (m: { id: string }) => m.id,
        ) as string[];
        setModels(ids);
        if (ids.length > 0 && !model) setModel(ids[0]);
      })
      .catch(() => {});
  }, [gatewayUrl, gatewayToken]);

  async function handleSend() {
    if (!input.trim() || !model || !creds) return;
    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setStreaming(true);

    const assistantMessage: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${creds.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [...messages, userMessage]
            .filter((m) => m.role !== "error")
            .map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const err = await response.text().catch(() => response.statusText);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "error",
            content: `Error: ${response.status} ${err}`,
          };
          return updated;
        });
        return;
      }

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
            if (delta) {
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
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "error",
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
        return updated;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleClear() {
    setMessages([]);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-divider">
        <h1 className="text-2xl font-bold tracking-tight shrink-0">Playground</h1>
        <Select.Root
          selectedKey={model}
          onSelectionChange={(key) => setModel(key as string | null)}
        >
          <Select.Trigger className="w-64" />
          <Select.Value>
            {({ isPlaceholder }) =>
              isPlaceholder ? "Select model" : undefined
            }
          </Select.Value>
          <Select.Indicator />
          <Select.Popover>
            <ListBox>
              {models.map((m) => (
                <ListBoxItem key={m} textValue={m}>
                  {m}
                </ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select.Root>
        {messages.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onPress={handleClear}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-default-100">
                <FiMessageSquare size={24} className="text-default-400" />
              </div>
              <p className="text-default-400 text-sm">
                Select a model and start chatting
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.role === "error") {
            return (
              <div key={i} className="flex justify-center">
                <Card.Root className="max-w-[80%] border border-danger-200 bg-danger-50">
                  <Card.Content className="py-2 px-4">
                    <p className="text-sm text-danger whitespace-pre-wrap">{msg.content}</p>
                  </Card.Content>
                </Card.Root>
              </div>
            );
          }
          const isUser = msg.role === "user";
          const isStreamingThis =
            streaming && i === messages.length - 1 && msg.role === "assistant";
          return (
            <div
              key={i}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`px-4 py-2.5 max-w-[80%] ${
                  isUser
                    ? "rounded-2xl rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-2xl rounded-bl-sm bg-default-100"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {isStreamingThis && (
                  <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse rounded-sm ml-1 align-text-bottom" />
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input Bar */}
      <div className="border-t border-divider p-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <TextArea
              placeholder="Type a message..."
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setInput(e.target.value)
              }
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={2}
            />
            <p className="text-xs text-default-400 mt-1.5 px-1">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
          {streaming ? (
            <Button
              variant="danger"
              isIconOnly
              onPress={handleStop}
              className="shrink-0 mb-6"
            >
              <FiSquare size={16} />
            </Button>
          ) : (
            <Button
              variant="primary"
              isIconOnly
              onPress={handleSend}
              isDisabled={!input.trim() || !model}
              className="shrink-0 mb-6"
            >
              <FiSend size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
