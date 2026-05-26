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
  Table,
  toast,
  useOverlayState,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { FiPlus, FiGitBranch } from "react-icons/fi";
import { useState } from "react";
import {
  useConfigStoreSection,
  usePutConfigStoreSection,
} from "../../hooks/use-queries";

export const Route = createFileRoute("/config/routes")({
  component: ConfigRoutesPage,
});

const STRATEGIES = [
  "weighted",
  "lowest_cost",
  "health_priority",
  "priority",
  "health_score",
];

interface RouteConfig {
  externalModel: string;
  target: { provider: string; providerModel: string };
  fallbacks?: Array<{ provider: string; providerModel: string }>;
  strategy?: string;
}

function ConfigRoutesPage() {
  const section = useConfigStoreSection("routes");
  const putSection = usePutConfigStoreSection("routes");
  const modalState = useOverlayState();
  const deleteModalState = useOverlayState();

  const routes = (section.data?.data as RouteConfig[]) ?? [];

  const [editModel, setEditModel] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editProvider, setEditProvider] = useState("");
  const [editProviderModel, setEditProviderModel] = useState("");
  const [editStrategy, setEditStrategy] = useState<string | null>("weighted");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function openEdit(route?: RouteConfig) {
    if (route) {
      setEditModel(route.externalModel);
      setIsEditing(true);
      setEditProvider(route.target.provider);
      setEditProviderModel(route.target.providerModel);
      setEditStrategy(route.strategy ?? "weighted");
    } else {
      setEditModel("");
      setIsEditing(false);
      setEditProvider("");
      setEditProviderModel("");
      setEditStrategy("weighted");
    }
    modalState.open();
  }

  function handleSave() {
    if (!editModel.trim() || !editProvider.trim() || !editProviderModel.trim()) {
      toast.danger("All fields are required.");
      return;
    }
    const existing = routes.filter((r) => r.externalModel !== editModel);
    const updated = [
      ...existing,
      {
        externalModel: editModel,
        target: { provider: editProvider, providerModel: editProviderModel },
        strategy: editStrategy ?? "weighted",
      },
    ];
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(`Route "${editModel}" ${isEditing ? "updated" : "created"} successfully.`);
        modalState.close();
      },
      onError: (err) => {
        toast.danger(`Failed to save route: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
    });
  }

  function confirmDelete(model: string) {
    setDeleteTarget(model);
    deleteModalState.open();
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const updated = routes.filter((r) => r.externalModel !== deleteTarget);
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(`Route "${deleteTarget}" deleted.`);
        deleteModalState.close();
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast.danger(`Failed to delete route: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
    });
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Route Configuration</h1>
          <p className="text-sm text-default-400">Map external models to providers</p>
        </div>
        <Button variant="primary" onPress={() => openEdit()}>
          <FiPlus size={16} /> Add Route
        </Button>
      </div>

      {section.isLoading ? (
        <Card.Root>
          <Card.Content className="p-0">
            <div className="p-4 space-y-3">
              <div className="flex gap-4">
                <Skeleton animationType="pulse" className="h-4 w-32 rounded" />
                <Skeleton animationType="pulse" className="h-4 w-28 rounded" />
                <Skeleton animationType="pulse" className="h-4 w-20 rounded" />
                <Skeleton animationType="pulse" className="h-4 w-24 rounded" />
                <Skeleton animationType="pulse" className="h-4 w-20 rounded" />
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton animationType="pulse" className="h-8 w-32 rounded" />
                  <Skeleton animationType="pulse" className="h-8 w-28 rounded" />
                  <Skeleton animationType="pulse" className="h-8 w-20 rounded" />
                  <Skeleton animationType="pulse" className="h-6 w-24 rounded-full" />
                  <Skeleton animationType="pulse" className="h-8 w-20 rounded" />
                </div>
              ))}
            </div>
          </Card.Content>
        </Card.Root>
      ) : routes.length === 0 ? (
        <Card.Root className="border-dashed border-2 border-default-200">
          <Card.Content className="py-12">
            <EmptyState.Root>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-default-100">
                  <FiGitBranch size={24} className="text-default-400" />
                </div>
                <div>
                  <p className="text-lg font-medium text-default-700">No routes configured</p>
                  <p className="text-sm text-default-400 mt-1">Add a route to map models to providers</p>
                </div>
                <Button variant="primary" onPress={() => openEdit()} className="mt-2">
                  <FiPlus size={16} /> Add Route
                </Button>
              </div>
            </EmptyState.Root>
          </Card.Content>
        </Card.Root>
      ) : (
        <Card.Root>
          <Card.Content className="p-0">
            <Table.Root aria-label="Routes configuration">
              <Table.Header>
                <Table.Column isRowHeader>External Model</Table.Column>
                <Table.Column>Target</Table.Column>
                <Table.Column>Fallbacks</Table.Column>
                <Table.Column>Strategy</Table.Column>
                <Table.Column>Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {routes.map((route) => (
                  <Table.Row key={route.externalModel} className="hover:bg-default-50">
                    <Table.Cell>
                      <span className="font-mono text-sm">{route.externalModel}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-sm">
                        {route.target.provider}/{route.target.providerModel}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-1 flex-wrap">
                        {route.fallbacks?.length ? (
                          route.fallbacks.map((fb, i) => (
                            <Chip key={i} size="sm" variant="soft">
                              {fb.provider}/{fb.providerModel}
                            </Chip>
                          ))
                        ) : (
                          <span className="text-default-400">{"—"}</span>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft" color="accent">
                        {route.strategy ?? "weighted"}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => openEdit(route)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-soft"
                          onPress={() => confirmDelete(route.externalModel)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card.Content>
        </Card.Root>
      )}

      {/* Add/Edit Modal */}
      <Modal.Root state={modalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                {isEditing ? "Edit Route" : "Add Route"}
              </Modal.Header>
              <Modal.Body className="gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">External Model</label>
                  <Input
                    placeholder="e.g. gpt-4o"
                    value={editModel}
                    onChange={(e) => setEditModel(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Target Provider</label>
                  <Input
                    placeholder="e.g. openai-primary"
                    value={editProvider}
                    onChange={(e) => setEditProvider(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Target Model</label>
                  <Input
                    placeholder="e.g. gpt-4o"
                    value={editProviderModel}
                    onChange={(e) => setEditProviderModel(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Strategy</label>
                  <Select.Root
                    selectedKey={editStrategy}
                    onSelectionChange={(key) =>
                      setEditStrategy(key as string | null)
                    }
                  >
                    <Select.Trigger />
                    <Select.Value>
                      {({ isPlaceholder }) =>
                        isPlaceholder ? "Select strategy" : undefined
                      }
                    </Select.Value>
                    <Select.Indicator />
                    <Select.Popover>
                      <ListBox>
                        {STRATEGIES.map((s) => (
                          <ListBoxItem key={s} textValue={s}>
                            {s}
                          </ListBoxItem>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select.Root>
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
              <Modal.Header>Delete Route</Modal.Header>
              <Modal.Body>
                <p className="text-sm text-default-500">
                  Are you sure you want to delete route{" "}
                  <span className="font-mono font-semibold text-foreground">{deleteTarget}</span>? This action cannot be undone.
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
