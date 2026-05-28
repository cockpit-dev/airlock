import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Modal,
  Select,
  Skeleton,
  TextField,
  toast,
  useOverlayState,
  ListBox,
  ListBoxItem
} from "@heroui/react";
import { FiPlus, FiGitBranch } from "react-icons/fi";
import { useState } from "react";
import {
  useConfigStoreSection,
  usePutConfigStoreSection
} from "../../hooks/use-queries";
import { DataTable, Table } from "../../components/data-table";
import { EmptyContent } from "../../components/empty-content";

export const Route = createFileRoute("/config/routes")({
  component: ConfigRoutesPage
});

const STRATEGIES = [
  "weighted",
  "lowest_cost",
  "health_priority",
  "priority",
  "health_score"
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
    if (
      !editModel.trim() ||
      !editProvider.trim() ||
      !editProviderModel.trim()
    ) {
      toast.danger("All fields are required.");
      return;
    }
    const existing = routes.filter((r) => r.externalModel !== editModel);
    const updated = [
      ...existing,
      {
        externalModel: editModel,
        target: { provider: editProvider, providerModel: editProviderModel },
        strategy: editStrategy ?? "weighted"
      }
    ];
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(
          `Route "${editModel}" ${isEditing ? "updated" : "created"} successfully.`
        );
        modalState.close();
      },
      onError: (err) => {
        toast.danger(
          `Failed to save route: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
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
        toast.danger(
          `Failed to delete route: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    });
  }

  return (
    <div className="console-page console-stack animate-fade-in">
      <div className="console-header">
        <div>
          <h1 className="console-title">Route Configuration</h1>
          <p className="console-subtitle">Map external models to providers</p>
        </div>
        <Button size="sm" variant="primary" onPress={() => openEdit()}>
          <FiPlus size={14} /> Add Route
        </Button>
      </div>

      {section.isLoading ? (
        <Card.Root>
          <Card.Content className="p-0">
            <div className="p-3 space-y-2.5">
              <div className="flex gap-3">
                <Skeleton
                  animationType="pulse"
                  className="h-3.5 w-28 rounded"
                />
                <Skeleton
                  animationType="pulse"
                  className="h-3.5 w-24 rounded"
                />
                <Skeleton
                  animationType="pulse"
                  className="h-3.5 w-16 rounded"
                />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton
                    animationType="pulse"
                    className="h-7 w-28 rounded"
                  />
                  <Skeleton
                    animationType="pulse"
                    className="h-7 w-24 rounded"
                  />
                  <Skeleton
                    animationType="pulse"
                    className="h-7 w-16 rounded"
                  />
                </div>
              ))}
            </div>
          </Card.Content>
        </Card.Root>
      ) : routes.length === 0 ? (
        <Card.Root>
          <Card.Content>
            <EmptyContent
              icon={<FiGitBranch />}
              title="No routes configured"
              description="Add a route to map models to providers."
              action={
                <Button size="sm" variant="primary" onPress={() => openEdit()}>
                  <FiPlus size={14} /> Add Route
                </Button>
              }
            />
          </Card.Content>
        </Card.Root>
      ) : (
        <Card.Root>
          <Card.Header className="flex-row items-center justify-between">
            <Card.Title>Model Routes</Card.Title>
            <span className="text-xs text-muted">{routes.length} total</span>
          </Card.Header>
          <Card.Content className="p-0">
            <DataTable aria-label="Routes configuration">
              <Table.Header>
                <Table.Column id="externalModel" isRowHeader>
                  External Model
                </Table.Column>
                <Table.Column id="target">Target</Table.Column>
                <Table.Column id="fallbacks">Fallbacks</Table.Column>
                <Table.Column id="strategy">Strategy</Table.Column>
                <Table.Column id="actions">Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {routes.map((route) => (
                  <Table.Row
                    key={route.externalModel}
                    className="hover:bg-default/50"
                  >
                    <Table.Cell>
                      <span className="font-mono text-xs">
                        {route.externalModel}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-xs">
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
                          <span className="text-muted text-xs">{"—"}</span>
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
            </DataTable>
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
                {isEditing ? "Edit Route" : "Add Route"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="gap-3">
              <TextField value={editModel} onChange={setEditModel}>
                <Label>External Model</Label>
                <Input placeholder="e.g. gpt-4o" />
              </TextField>
              <TextField value={editProvider} onChange={setEditProvider}>
                <Label>Target Provider</Label>
                <Input placeholder="e.g. openai-primary" />
              </TextField>
              <TextField
                value={editProviderModel}
                onChange={setEditProviderModel}
              >
                <Label>Target Model</Label>
                <Input placeholder="e.g. gpt-4o" />
              </TextField>
              <Select.Root
                aria-label="Strategy"
                selectedKey={editStrategy}
                onSelectionChange={(key) =>
                  setEditStrategy(key as string | null)
                }
              >
                <Label>Strategy</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {STRATEGIES.map((s) => (
                      <ListBoxItem id={s} key={s} textValue={s}>
                        {s}
                      </ListBoxItem>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select.Root>
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
              <Modal.Heading>Delete Route</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">
                Are you sure you want to delete route{" "}
                <span className="font-mono font-semibold text-foreground">
                  {deleteTarget}
                </span>
                ? This action cannot be undone.
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button
                size="sm"
                variant="ghost"
                onPress={deleteModalState.close}
              >
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
