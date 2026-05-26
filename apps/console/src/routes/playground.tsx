import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Input,
  Select,
  Spinner,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { useState, useRef, useEffect } from "react";
import { getStoredCredentials } from "../lib/auth";

export const Route = createFileRoute("/playground")({
  component: PlaygroundPage,
});

interface Message {
  role: "user" | "assistant";
  content: string;
}

function PlaygroundPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const creds = getStoredCredentials();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!creds) return;
    fetch(`${creds.url}/v1/models`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const ids = (data.data ?? []).map(
          (m: { id: string }) => m.id
        ) as string[];
        setModels(ids);
        if (ids.length > 0 && !model) setModel(ids[0]);
      })
      .catch(() => {});
  }, [creds]);

  async function handleSend() {
    if (!input.trim() || !model || !creds) return;
    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
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
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const err = await response.text();
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
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
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
        };
        return updated;
      });
    } finally {
      setLoading(false);
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-divider flex items-center gap-4">
        <h1 className="text-xl font-bold">Playground</h1>
        <Select.Root
          selectedKey={model}
          onSelectionChange={(key) => setModel(key as string | null)}
        >
          <Select.Trigger className="w-64" />
          <Select.Value>{({ isPlaceholder }) =>
            isPlaceholder ? "Select model" : undefined
          }</Select.Value>
          <Select.Indicator />
          <Select.Popover>
            <ListBox>
              {models.map((m) => (
                <ListBoxItem key={m} textValue={m}>{m}</ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select.Root>
        {messages.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onPress={() => setMessages([])}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-default-400">
            Select a model and start chatting
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <Card.Root
              className={`max-w-[80%] ${
                msg.role === "user" ? "bg-primary text-primary-foreground" : ""
              }`}
            >
              <Card.Content className="p-3">
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {streaming &&
                  i === messages.length - 1 &&
                  msg.role === "assistant" && (
                    <Spinner size="sm" color="current" className="mt-1" />
                  )}
              </Card.Content>
            </Card.Root>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-divider">
        <div className="flex gap-2">
          <textarea
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            className="flex-1 rounded-md border border-default-200 bg-content1 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            style={{ minHeight: "38px", maxHeight: "120px" }}
          />
          {streaming ? (
            <Button variant="danger" onPress={handleStop}>
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onPress={handleSend}
              isDisabled={!input.trim() || !model}
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
