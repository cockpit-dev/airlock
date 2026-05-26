import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  Input,
  Modal,
  Select,
  Spinner,
  Table,
  useOverlayState,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { FiPlus } from "react-icons/fi";
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

function ConfigRoutesPage() {
  const section = useConfigStoreSection("routes");
  const putSection = usePutConfigStoreSection("routes");
  const modalState = useOverlayState();

  const routes =
    (section.data?.data as Array<{
      externalModel: string;
      target: { provider: string; providerModel: string };
      fallbacks?: Array<{ provider: string; providerModel: string }>;
      strategy?: string;
    }>) ?? [];

  const [editModel, setEditModel] = useState("");
  const [editProvider, setEditProvider] = useState("");
  const [editProviderModel, setEditProviderModel] = useState("");
  const [editStrategy, setEditStrategy] = useState<string | null>("weighted");

  function openEdit(route?: (typeof routes)[0]) {
    if (route) {
      setEditModel(route.externalModel);
      setEditProvider(route.target.provider);
      setEditProviderModel(route.target.providerModel);
      setEditStrategy(route.strategy ?? "weighted");
    } else {
      setEditModel("");
      setEditProvider("");
      setEditProviderModel("");
      setEditStrategy("weighted");
    }
    modalState.open();
  }

  function handleSave() {
    if (!editModel.trim() || !editProvider.trim() || !editProviderModel.trim()) return;
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
      onSuccess: () => modalState.close(),
    });
  }

  function handleDelete(model: string) {
    const updated = routes.filter((r) => r.externalModel !== model);
    putSection.mutate(updated);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Route Configuration</h1>
        <Button variant="primary" onPress={() => openEdit()}>
          <FiPlus /> Add Route
        </Button>
      </div>

      {section.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
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
                  <Table.Row key={route.externalModel}>
                    <Table.Cell className="font-mono text-sm">
                      {route.externalModel}
                    </Table.Cell>
                    <Table.Cell className="text-sm">
                      {route.target.provider}/{route.target.providerModel}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-1 flex-wrap">
                        {route.fallbacks?.length
                          ? route.fallbacks.map((fb, i) => (
                              <Chip key={i} size="sm" variant="soft">
                                {fb.provider}/{fb.providerModel}
                              </Chip>
                            ))
                          : <span className="text-default-400">{"—"}</span>}
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
                          onPress={() => handleDelete(route.externalModel)}
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

      <Modal.Root state={modalState}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                {editModel && routes.find((r) => r.externalModel === editModel)
                  ? "Edit Route"
                  : "Add Route"}
              </Modal.Header>
              <Modal.Body className="gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">External Model</label>
                  <Input
                    placeholder="e.g. gpt-4o"
                    value={editModel}
                    onChange={(e) => setEditModel(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Target Provider</label>
                  <Input
                    placeholder="e.g. openai-primary"
                    value={editProvider}
                    onChange={(e) => setEditProvider(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Target Model</label>
                  <Input
                    placeholder="e.g. gpt-4o"
                    value={editProviderModel}
                    onChange={(e) => setEditProviderModel(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Strategy</label>
                  <Select.Root
                    selectedKey={editStrategy}
                    onSelectionChange={(key) => setEditStrategy(key as string | null)}
                  >
                    <Select.Trigger />
                    <Select.Value>{({ isPlaceholder }) =>
                      isPlaceholder ? "Select strategy" : undefined
                    }</Select.Value>
                    <Select.Indicator />
                    <Select.Popover>
                      <ListBox>
                        {STRATEGIES.map((s) => (
                          <ListBoxItem key={s} textValue={s}>{s}</ListBoxItem>
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
