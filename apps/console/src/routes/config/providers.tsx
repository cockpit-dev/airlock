import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  Modal,
  Select,
  Skeleton,
  TextField,
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
import { DataTable, Table } from "../../components/data-table";
import { EmptyContent } from "../../components/empty-content";

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
    <div className="console-page console-stack animate-fade-in">
      <div className="console-header">
        <div>
          <h1 className="console-title">Providers</h1>
          <p className="console-subtitle">Configure AI model providers</p>
        </div>
        <Button size="sm" variant="primary" onPress={() => openEdit()}>
          <FiPlus size={14} /> Add Provider
        </Button>
      </div>

      {section.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card.Root key={i}>
              <Card.Content className="gap-2 p-3">
                <div className="flex items-center justify-between">
                  <Skeleton animationType="pulse" className="h-4 w-24 rounded" />
                  <Skeleton animationType="pulse" className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton animationType="pulse" className="h-3 w-full rounded" />
                <div className="flex gap-1.5 mt-1">
                  <Skeleton animationType="pulse" className="h-6 w-20 rounded" />
                  <Skeleton animationType="pulse" className="h-6 w-10 rounded" />
                  <Skeleton animationType="pulse" className="h-6 w-12 rounded" />
                </div>
              </Card.Content>
            </Card.Root>
          ))}
        </div>
      ) : providers.length === 0 ? (
        <Card.Root>
          <Card.Content>
            <EmptyContent
              icon={<FiServer />}
              title="No providers configured"
              description="Add your first provider to get started."
              action={
                <Button size="sm" variant="primary" onPress={() => openEdit()}>
                  <FiPlus size={14} /> Add Provider
                </Button>
              }
            />
          </Card.Content>
        </Card.Root>
      ) : (
        <Card.Root>
          <Card.Header className="flex-row items-center justify-between">
            <Card.Title>Provider Registry</Card.Title>
            <span className="text-xs text-muted">
              {providers.length} total
            </span>
          </Card.Header>
          <Card.Content className="p-0">
          <DataTable aria-label="Providers">
            <Table.Header>
              <Table.Column id="provider" isRowHeader>
                Provider
              </Table.Column>
              <Table.Column id="type">Type</Table.Column>
              <Table.Column id="baseUrl">Base URL</Table.Column>
              <Table.Column id="defaultModel">Default Model</Table.Column>
              <Table.Column id="actions">Actions</Table.Column>
            </Table.Header>
            <Table.Body>
              {providers.map((provider) => (
                <Table.Row key={provider.id} className="hover:bg-default/50">
                  <Table.Cell>
                    <span className="font-semibold text-[13px]">{provider.id}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip size="sm" variant="soft" color="accent">
                      {provider.type}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono text-[11px] text-muted">
                      {provider.baseUrl}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono text-[11px] text-muted">
                      {provider.defaultModel ?? "-"}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={fetchModels.isPending}
                        onPress={() => handleFetchModels(provider)}
                      >
                        <FiRefreshCw
                          size={12}
                          className={fetchModels.isPending ? "animate-spin" : ""}
                        />
                        Models
                      </Button>
                      <Button size="sm" variant="ghost" onPress={() => openEdit(provider)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        onPress={() => confirmDelete(provider.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </DataTable>
          </Card.Content>
        </Card.Root>
      )}

      {fetchModels.data && fetchModels.data.models.length > 0 && (
        <Card.Root>
          <Card.Header className="px-2.5 pt-2 pb-0">
            <h3 className="text-sm font-semibold">Available Models</h3>
            <span className="text-xs text-muted ml-1.5">
              ({fetchModels.data.models.length})
            </span>
          </Card.Header>
          <Card.Content className="px-2.5 pb-2.5">
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

      <Modal.Backdrop
        isOpen={modalState.isOpen}
        onOpenChange={modalState.setOpen}
      >
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {isEditing ? "Edit Provider" : "Add Provider"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="gap-3">
                <TextField value={editId} onChange={setEditId}>
                  <Label>Provider ID</Label>
                  <Input
                    placeholder="e.g. openai-primary"
                    readOnly={isEditing}
                  />
                  {isEditing && (
                    <Description>Provider ID cannot be changed after creation</Description>
                  )}
                </TextField>
                <Select.Root
                  aria-label="Provider type"
                  selectedKey={editType}
                  onSelectionChange={(key) => setEditType(key as string | null)}
                >
                  <Label>Type</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBoxItem id="openai" key="openai" textValue="OpenAI">
                        OpenAI
                      </ListBoxItem>
                      <ListBoxItem
                        id="anthropic"
                        key="anthropic"
                        textValue="Anthropic"
                      >
                        Anthropic
                      </ListBoxItem>
                      <ListBoxItem id="gemini" key="gemini" textValue="Gemini">
                        Gemini
                      </ListBoxItem>
                    </ListBox>
                  </Select.Popover>
                </Select.Root>
                <TextField value={editBaseUrl} onChange={setEditBaseUrl}>
                  <Label>Base URL</Label>
                  <Input
                    placeholder="https://api.openai.com/v1"
                  />
                </TextField>
                <TextField value={editApiKey} onChange={setEditApiKey}>
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    placeholder="sk-..."
                  />
                  <Description>
                    {isEditing
                      ? "Leave empty to keep existing key"
                      : "Required for new providers"}
                  </Description>
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button size="sm" variant="ghost" onPress={modalState.close}>
                  Cancel
                </Button>
                <Button
                  size="sm"
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

      <Modal.Backdrop
        isOpen={deleteModalState.isOpen}
        onOpenChange={deleteModalState.setOpen}
      >
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Delete Provider</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-muted">
                  Are you sure you want to delete provider{" "}
                  <span className="font-semibold text-foreground">{deleteTarget}</span>? This action cannot be undone.
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button size="sm" variant="ghost" onPress={deleteModalState.close}>
                  Cancel
                </Button>
                <Button
                  size="sm"
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
    </div>
  );
}
