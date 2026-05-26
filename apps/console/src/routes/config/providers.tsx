import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  Input,
  Modal,
  Select,
  Spinner,
  useOverlayState,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { FiPlus, FiRefreshCw } from "react-icons/fi";
import { useState } from "react";
import {
  useConfigStoreSection,
  usePutConfigStoreSection,
  useFetchProviderModels,
} from "../../hooks/use-queries";

export const Route = createFileRoute("/config/providers")({
  component: ProvidersPage,
});

function ProvidersPage() {
  const section = useConfigStoreSection("providers");
  const putSection = usePutConfigStoreSection("providers");
  const fetchModels = useFetchProviderModels();
  const modalState = useOverlayState();

  const [editId, setEditId] = useState("");
  const [editType, setEditType] = useState<string | null>("openai");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editApiKey, setEditApiKey] = useState("");

  const providers = (section.data?.data as Array<{
    id: string;
    type: string;
    baseUrl: string;
    apiKey?: string;
    defaultModel?: string;
  }>) ?? [];

  function handleSave() {
    if (!editId.trim() || !editBaseUrl.trim()) return;
    const existing = providers.filter((p) => p.id !== editId);
    const updated = [
      ...existing,
      {
        id: editId,
        type: editType ?? "openai",
        baseUrl: editBaseUrl,
        ...(editApiKey ? { apiKey: editApiKey } : {}),
      },
    ];
    putSection.mutate(updated, {
      onSuccess: () => modalState.close(),
    });
  }

  function handleDelete(id: string) {
    const updated = providers.filter((p) => p.id !== id);
    putSection.mutate(updated);
  }

  function openEdit(provider?: (typeof providers)[0]) {
    if (provider) {
      setEditId(provider.id);
      setEditType(provider.type);
      setEditBaseUrl(provider.baseUrl);
      setEditApiKey("");
    } else {
      setEditId("");
      setEditType("openai");
      setEditBaseUrl("");
      setEditApiKey("");
    }
    modalState.open();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Providers</h1>
        <Button variant="primary" onPress={() => openEdit()}>
          <FiPlus /> Add Provider
        </Button>
      </div>

      {section.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((provider) => (
            <Card.Root key={provider.id}>
              <Card.Content className="gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{provider.id}</h3>
                  <Chip size="sm" variant="soft" color="accent">
                    {provider.type}
                  </Chip>
                </div>
                <p className="text-sm text-default-400 font-mono truncate">
                  {provider.baseUrl}
                </p>
                {provider.defaultModel && (
                  <p className="text-sm">
                    Default: <span className="font-mono">{provider.defaultModel}</span>
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={fetchModels.isPending}
                    onPress={() =>
                      fetchModels.mutate({
                        baseUrl: provider.baseUrl,
                        apiKey: provider.apiKey ?? "",
                        type: provider.type,
                      })
                    }
                  >
                    <FiRefreshCw size={14} />
                    {fetchModels.isPending ? "Fetching..." : "Fetch Models"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => openEdit(provider)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    onPress={() => handleDelete(provider.id)}
                  >
                    Delete
                  </Button>
                </div>
              </Card.Content>
            </Card.Root>
          ))}
          {providers.length === 0 && (
            <p className="text-default-400 col-span-full text-center py-10">
              No providers configured. Add one to get started.
            </p>
          )}
        </div>
      )}

      {fetchModels.data && (
        <Card.Root>
          <Card.Content>
            <h3 className="font-semibold mb-2">Available Models</h3>
            <div className="flex gap-1 flex-wrap">
              {fetchModels.data.models.map((m) => (
                <Chip key={m} size="sm" variant="soft">
                  {m}
                </Chip>
              ))}
            </div>
          </Card.Content>
        </Card.Root>
      )}

      <Modal.Root state={modalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                {editId ? "Edit Provider" : "Add Provider"}
              </Modal.Header>
              <Modal.Body className="gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Provider ID</label>
                  <Input
                    placeholder="e.g. openai-primary"
                    value={editId}
                    onChange={(e) => setEditId(e.target.value)}
                    required
                    readOnly={!!providers.find((p) => p.id === editId)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Type</label>
                  <Select.Root
                    selectedKey={editType}
                    onSelectionChange={(key) => setEditType(key as string | null)}
                  >
                    <Select.Trigger />
                    <Select.Value>{({ isPlaceholder }) =>
                      isPlaceholder ? "Select type" : undefined
                    }</Select.Value>
                    <Select.Indicator />
                    <Select.Popover>
                      <ListBox>
                        <ListBoxItem key="openai" textValue="OpenAI">OpenAI</ListBoxItem>
                        <ListBoxItem key="anthropic" textValue="Anthropic">Anthropic</ListBoxItem>
                        <ListBoxItem key="gemini" textValue="Gemini">Gemini</ListBoxItem>
                      </ListBox>
                    </Select.Popover>
                  </Select.Root>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Base URL</label>
                  <Input
                    placeholder="https://api.openai.com/v1"
                    value={editBaseUrl}
                    onChange={(e) => setEditBaseUrl(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">API Key</label>
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={editApiKey}
                    onChange={(e) => setEditApiKey(e.target.value)}
                  />
                  <span className="text-xs text-default-400">
                    {editId
                      ? "Leave empty to keep existing key"
                      : "Required for new providers"}
                  </span>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={modalState.close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onPress={handleSave}
                  isDisabled={putSection.isPending}
                >
                  {putSection.isPending ? "Saving..." : "Save"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </div>
  );
}
