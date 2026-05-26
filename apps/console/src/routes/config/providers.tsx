import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Input,
  Modal,
  Select,
  Skeleton,
  toast,
  useOverlayState,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { FiPlus, FiRefreshCw, FiServer } from "react-icons/fi";
import { useState } from "react";
import {
  useConfigStoreSection,
  usePutConfigStoreSection,
  useFetchProviderModels,
} from "../../hooks/use-queries";

export const Route = createFileRoute("/config/providers")({
  component: ProvidersPage,
});

interface Provider {
  id: string;
  type: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
}

function ProvidersPage() {
  const section = useConfigStoreSection("providers");
  const putSection = usePutConfigStoreSection("providers");
  const fetchModels = useFetchProviderModels();
  const modalState = useOverlayState();
  const deleteModalState = useOverlayState();

  const [editId, setEditId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editType, setEditType] = useState<string | null>("openai");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const providers = (section.data?.data as Provider[]) ?? [];

  function handleSave() {
    if (!editId.trim() || !editBaseUrl.trim()) {
      toast.danger("Provider ID and Base URL are required.");
      return;
    }
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
      onSuccess: () => {
        toast.success(`Provider "${editId}" ${isEditing ? "updated" : "created"} successfully.`);
        modalState.close();
      },
      onError: (err) => {
        toast.danger(`Failed to save provider: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
    });
  }

  function confirmDelete(id: string) {
    setDeleteTarget(id);
    deleteModalState.open();
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const updated = providers.filter((p) => p.id !== deleteTarget);
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(`Provider "${deleteTarget}" deleted.`);
        deleteModalState.close();
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast.danger(`Failed to delete provider: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
    });
  }

  function openEdit(provider?: Provider) {
    if (provider) {
      setEditId(provider.id);
      setIsEditing(true);
      setEditType(provider.type);
      setEditBaseUrl(provider.baseUrl);
      setEditApiKey("");
    } else {
      setEditId("");
      setIsEditing(false);
      setEditType("openai");
      setEditBaseUrl("");
      setEditApiKey("");
    }
    modalState.open();
  }

  function handleFetchModels(provider: Provider) {
    fetchModels.mutate(
      { baseUrl: provider.baseUrl, apiKey: provider.apiKey ?? "", type: provider.type },
      {
        onSuccess: () => toast.success("Models fetched successfully."),
        onError: (err) => toast.danger(`Failed to fetch models: ${err instanceof Error ? err.message : "Unknown error"}`),
      },
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Providers</h1>
          <p className="text-sm text-default-400">Configure AI model providers</p>
        </div>
        <Button variant="primary" onPress={() => openEdit()}>
          <FiPlus size={16} /> Add Provider
        </Button>
      </div>

      {section.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card.Root key={i}>
              <Card.Content className="gap-3">
                <div className="flex items-center justify-between">
                  <Skeleton animationType="pulse" className="h-5 w-28 rounded" />
                  <Skeleton animationType="pulse" className="h-6 w-16 rounded-full" />
                </div>
                <Skeleton animationType="pulse" className="h-4 w-full rounded" />
                <Skeleton animationType="pulse" className="h-4 w-2/3 rounded" />
                <div className="flex gap-2 mt-2">
                  <Skeleton animationType="pulse" className="h-8 w-24 rounded" />
                  <Skeleton animationType="pulse" className="h-8 w-14 rounded" />
                  <Skeleton animationType="pulse" className="h-8 w-16 rounded" />
                </div>
              </Card.Content>
            </Card.Root>
          ))}
        </div>
      ) : providers.length === 0 ? (
        <Card.Root className="border-dashed border-2 border-default-200">
          <Card.Content className="py-12">
            <EmptyState.Root>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-default-100">
                  <FiServer size={24} className="text-default-400" />
                </div>
                <div>
                  <p className="text-lg font-medium text-default-700">No providers configured</p>
                  <p className="text-sm text-default-400 mt-1">Add your first provider to get started</p>
                </div>
                <Button variant="primary" onPress={() => openEdit()} className="mt-2">
                  <FiPlus size={16} /> Add Provider
                </Button>
              </div>
            </EmptyState.Root>
          </Card.Content>
        </Card.Root>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((provider) => (
            <Card.Root key={provider.id} className="hover:shadow-md transition-shadow">
              <Card.Content className="gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold truncate">{provider.id}</h3>
                  <Chip size="sm" variant="soft" color="accent">
                    {provider.type}
                  </Chip>
                </div>
                <p className="text-xs text-default-400 font-mono truncate">
                  {provider.baseUrl}
                </p>
                {provider.defaultModel && (
                  <p className="text-sm text-default-500">
                    Default: <span className="font-mono text-xs">{provider.defaultModel}</span>
                  </p>
                )}
                <div className="flex gap-2 mt-3 pt-3 border-t border-default-100">
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={fetchModels.isPending}
                    onPress={() => handleFetchModels(provider)}
                  >
                    <FiRefreshCw size={14} className={fetchModels.isPending ? "animate-spin" : ""} />
                    Fetch Models
                  </Button>
                  <Button size="sm" variant="ghost" onPress={() => openEdit(provider)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger-soft" onPress={() => confirmDelete(provider.id)}>
                    Delete
                  </Button>
                </div>
              </Card.Content>
            </Card.Root>
          ))}
        </div>
      )}

      {fetchModels.data && fetchModels.data.models.length > 0 && (
        <Card.Root>
          <Card.Header>
            <h3 className="font-semibold">Available Models</h3>
            <span className="text-sm text-default-400 ml-2">
              ({fetchModels.data.models.length} models)
            </span>
          </Card.Header>
          <Card.Content>
            <div className="flex gap-1.5 flex-wrap">
              {fetchModels.data.models.map((m) => (
                <Chip key={m} size="sm" variant="soft">
                  {m}
                </Chip>
              ))}
            </div>
          </Card.Content>
        </Card.Root>
      )}

      {/* Add/Edit Modal */}
      <Modal.Root state={modalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                {isEditing ? "Edit Provider" : "Add Provider"}
              </Modal.Header>
              <Modal.Body className="gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Provider ID</label>
                  <Input
                    placeholder="e.g. openai-primary"
                    value={editId}
                    onChange={(e) => setEditId(e.target.value)}
                    readOnly={isEditing}
                  />
                  {isEditing && (
                    <span className="text-xs text-default-400">Provider ID cannot be changed after creation</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Type</label>
                  <Select.Root
                    selectedKey={editType}
                    onSelectionChange={(key) => setEditType(key as string | null)}
                  >
                    <Select.Trigger />
                    <Select.Value>
                      {({ isPlaceholder }) =>
                        isPlaceholder ? "Select type" : undefined
                      }
                    </Select.Value>
                    <Select.Indicator />
                    <Select.Popover>
                      <ListBox>
                        <ListBoxItem key="openai" textValue="OpenAI">
                          OpenAI
                        </ListBoxItem>
                        <ListBoxItem key="anthropic" textValue="Anthropic">
                          Anthropic
                        </ListBoxItem>
                        <ListBoxItem key="gemini" textValue="Gemini">
                          Gemini
                        </ListBoxItem>
                      </ListBox>
                    </Select.Popover>
                  </Select.Root>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Base URL</label>
                  <Input
                    placeholder="https://api.openai.com/v1"
                    value={editBaseUrl}
                    onChange={(e) => setEditBaseUrl(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">API Key</label>
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={editApiKey}
                    onChange={(e) => setEditApiKey(e.target.value)}
                  />
                  <span className="text-xs text-default-400">
                    {isEditing
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
                  isPending={putSection.isPending}
                >
                  Save
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      {/* Delete Confirmation Modal */}
      <Modal.Root state={deleteModalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>Delete Provider</Modal.Header>
              <Modal.Body>
                <p className="text-sm text-default-500">
                  Are you sure you want to delete provider{" "}
                  <span className="font-semibold text-foreground">{deleteTarget}</span>? This action cannot be undone.
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={deleteModalState.close}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onPress={handleDelete}
                  isPending={putSection.isPending}
                >
                  Delete
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </div>
  );
}
