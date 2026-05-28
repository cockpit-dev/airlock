import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Chip,
  Description,
  Form,
  Input,
  Label,
  Modal,
  Skeleton,
  Switch,
  TextField,
  toast,
  useOverlayState,
} from "@heroui/react";
import {
  FiCheck,
  FiCopy,
  FiEdit3,
  FiKey,
  FiPlus,
  FiSearch,
  FiShield,
} from "react-icons/fi";

import { useConfig, useCreateKey, useKeys } from "../hooks/use-queries";
import type { GatewayApiKeyRegistrySnapshot } from "../lib/api";
import {
  buildGatewayKeyCreatePayload,
  generateGatewayKeyValue,
  getConfiguredModels,
} from "../lib/key-policy";
import { DataTable, Table } from "../components/data-table";
import { EmptyContent } from "../components/empty-content";

export const Route = createFileRoute("/keys")({
  component: KeysRoutePage,
});

function KeysRoutePage() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (pathname !== "/keys" && pathname !== "/keys/") {
    return <Outlet />;
  }

  return <KeysPage />;
}

function KeysPage() {
  const navigate = useNavigate();
  const keys = useKeys();
  const config = useConfig();
  const createKey = useCreateKey();
  const modalState = useOverlayState();

  const [search, setSearch] = useState("");
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [blockedModels, setBlockedModels] = useState<string[]>([]);
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null);

  const configuredModels = useMemo(
    () => (config.data ? getConfiguredModels(config.data) : []),
    [config.data]
  );

  const filteredKeys = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (keys.data?.keys ?? []).filter((key) => {
      if (!term) return true;
      return (
        key.keyId.toLowerCase().includes(term) ||
        key.runtime.label.toLowerCase().includes(term) ||
        key.ownership.toLowerCase().includes(term)
      );
    });
  }, [keys.data?.keys, search]);

  const summary = useMemo(() => {
    const entries = keys.data?.keys ?? [];
    return {
      active: entries.filter((key) => key.runtime.acceptedNow).length,
      blocked: entries.filter((key) => getBlockedModels(key).length > 0)
        .length,
      registry: entries.filter((key) => key.ownership === "registry").length,
    };
  }, [keys.data?.keys]);

  async function handleCreate() {
    const plainTextKey = generateGatewayKeyValue();
    try {
      const payload = await buildGatewayKeyCreatePayload({
        label: newKeyLabel,
        plainTextKey,
        blockedExternalModels: blockedModels,
        reason: "created from console",
      });
      await createKey.mutateAsync(payload);
      setCreatedKeyValue(plainTextKey);
      setNewKeyLabel("");
      setBlockedModels([]);
      toast.success("Key created");
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "Failed to create key"
      );
    }
  }

  function closeCreateModal() {
    modalState.close();
    setCreatedKeyValue(null);
    setNewKeyLabel("");
    setBlockedModels([]);
  }

  function setModelEnabled(model: string, isEnabled: boolean) {
    setBlockedModels((current) => {
      const blocked = new Set(current);
      if (isEnabled) {
        blocked.delete(model);
      } else {
        blocked.add(model);
      }
      return configuredModels.filter((candidate) => blocked.has(candidate));
    });
  }

  return (
    <div className="console-page console-stack animate-fade-in">
      <div className="console-header flex-col sm:flex-row">
        <div>
          <h1 className="console-title">API Keys</h1>
          <p className="console-subtitle">
            Create runtime keys and control per-key model access.
          </p>
        </div>
        <Button size="sm" variant="primary" onPress={modalState.open}>
          <FiPlus size={14} /> Create Key
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Accepted now" value={summary.active} />
        <SummaryTile label="Registry owned" value={summary.registry} />
        <SummaryTile label="Model limited" value={summary.blocked} />
      </div>

      <Card.Root>
        <Card.Content className="flex-row items-center justify-between gap-3 p-3">
        <div className="relative w-full sm:max-w-xs">
          <FiSearch
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <Input
            aria-label="Search keys"
            placeholder="Search label, ID, or ownership"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8 text-sm"
          />
        </div>
        <p className="text-[11px] text-muted hidden sm:block">
          No blocked models means the key can use every configured model.
        </p>
        </Card.Content>
      </Card.Root>

      {keys.isLoading ? (
        <KeysSkeleton />
      ) : !filteredKeys.length ? (
        <Card.Root>
          <Card.Content>
            <EmptyContent
              icon={<FiKey />}
              title="No keys found"
              description="Create a registry key, or clear the current search."
              action={
                <Button size="sm" variant="primary" onPress={modalState.open}>
                  <FiPlus size={14} /> Create Key
                </Button>
              }
            />
          </Card.Content>
        </Card.Root>
      ) : (
        <Card.Root>
          <Card.Header className="flex-row items-center justify-between">
            <Card.Title>Keys</Card.Title>
            <span className="text-xs text-muted">
              {filteredKeys.length} shown
            </span>
          </Card.Header>
          <div className="grid gap-2 p-2 sm:hidden">
            {filteredKeys.map((key) => {
              const blocked = getBlockedModels(key);
              return (
                <div
                  key={key.keyId}
                  className="rounded-3xl bg-default/40 p-3"
                >
                  <button
                    type="button"
                    className="block w-full min-w-0 text-left"
                    onClick={() =>
                      navigate({
                        to: "/keys/$keyId",
                        params: { keyId: key.keyId },
                      })
                    }
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">
                          {key.runtime.label}
                        </p>
                        <p className="truncate font-mono text-[10px] text-muted">
                          {key.keyId}
                        </p>
                      </div>
                      <StatusChip status={key.runtime.effectiveStatus} />
                    </div>
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Chip size="sm" variant="soft">
                      {key.ownership}
                    </Chip>
                    {blocked.length > 0 ? (
                      <Chip size="sm" variant="soft" color="warning">
                        {blocked.length} disabled
                      </Chip>
                    ) : (
                      <Chip size="sm" variant="soft" color="success">
                        all enabled
                      </Chip>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="ml-auto"
                      aria-label={`Edit ${key.runtime.label}`}
                      onPress={() =>
                        navigate({
                          to: "/keys/$keyId",
                          params: { keyId: key.keyId },
                        })
                      }
                    >
                      <FiEdit3 size={14} /> Edit
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted">
                    Updated {formatDate(key.registryUpdatedAt)}
                  </p>
                </div>
              );
            })}
          </div>
          <Card.Content className="hidden p-0 sm:block">
            <DataTable aria-label="API keys">
              <Table.Header>
                <Table.Column id="key" isRowHeader>
                  Key
                </Table.Column>
                <Table.Column id="status">Status</Table.Column>
                <Table.Column id="ownership">Ownership</Table.Column>
                <Table.Column id="models">Models</Table.Column>
                <Table.Column id="updated">Updated</Table.Column>
                <Table.Column id="actions">Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {filteredKeys.map((key) => {
                  const blocked = getBlockedModels(key);
                  return (
                    <Table.Row
                      key={key.keyId}
                      className="hover:bg-default/50 cursor-pointer"
                      onClick={() =>
                        navigate({
                          to: "/keys/$keyId",
                          params: { keyId: key.keyId },
                        })
                      }
                    >
                      <Table.Cell>
                        <div className="min-w-0">
                          <p className="font-medium text-[13px] truncate">
                            {key.runtime.label}
                          </p>
                          <p className="font-mono text-[10px] text-muted truncate">
                            {key.keyId}
                          </p>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <StatusChip status={key.runtime.effectiveStatus} />
                      </Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" variant="soft">
                          {key.ownership}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        {blocked.length > 0 ? (
                          <Chip size="sm" variant="soft" color="warning">
                            {blocked.length} disabled
                          </Chip>
                        ) : (
                          <Chip size="sm" variant="soft" color="success">
                            all enabled
                          </Chip>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-xs text-muted">
                          {formatDate(key.registryUpdatedAt)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit ${key.runtime.label}`}
                          onClick={(event) => event.stopPropagation()}
                          onPress={() =>
                            navigate({
                              to: "/keys/$keyId",
                              params: { keyId: key.keyId },
                            })
                          }
                        >
                          <FiEdit3 size={14} /> Edit
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
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
          <Modal.Dialog className="max-w-lg">
            <Modal.Header>
              <Modal.Heading>Create API Key</Modal.Heading>
            </Modal.Header>
              <Modal.Body className="gap-4">
                {createdKeyValue ? (
                  <CreatedKeyView
                    value={createdKeyValue}
                    onClose={closeCreateModal}
                  />
                ) : (
                  <Form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleCreate();
                    }}
                  >
                    <TextField isRequired value={newKeyLabel}>
                      <Label>Name</Label>
                      <Input
                        placeholder="Production client"
                        value={newKeyLabel}
                        onChange={(event) => setNewKeyLabel(event.target.value)}
                      />
                    </TextField>

                    <section className="space-y-3">
                      <div className="flex items-start gap-2">
                        <FiShield
                          size={14}
                          className="mt-0.5 text-muted shrink-0"
                        />
                        <div>
                          <p className="text-[13px] font-medium">Model access</p>
                          <p className="text-xs text-muted">
                            New keys can call every model unless you turn one off.
                          </p>
                        </div>
                      </div>

                      {configuredModels.length > 0 ? (
                        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                          {configuredModels.map((model) => (
                            <ModelAccessSwitch
                              key={model}
                              model={model}
                              isEnabled={!blockedModels.includes(model)}
                              onChange={(isEnabled) =>
                                setModelEnabled(model, isEnabled)
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted">
                          No configured models were reported by the gateway.
                        </p>
                      )}
                    </section>

                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onPress={closeCreateModal}>
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        variant="primary"
                        isPending={createKey.isPending}
                      >
                        Create
                      </Button>
                    </div>
                  </Form>
                )}
              </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

function ModelAccessSwitch({
  model,
  isEnabled,
  onChange,
}: {
  model: string;
  isEnabled: boolean;
  onChange: (isEnabled: boolean) => void;
}) {
  return (
    <Switch.Root
      aria-label={`${model} model access`}
      size="sm"
      isSelected={isEnabled}
      onChange={onChange}
      className="min-w-0 justify-between rounded-2xl bg-default/40 px-3 py-2"
    >
      <Switch.Content className="min-w-0">
        <Label className="truncate font-mono text-[11px]">{model}</Label>
        <Description>
          {isEnabled ? "Enabled" : "Disabled"}
        </Description>
      </Switch.Content>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Root>
  );
}

function CreatedKeyView({
  value,
  onClose,
}: {
  value: string;
  onClose: () => void;
}) {
  async function copy() {
    await navigator.clipboard.writeText(value);
    toast.success("Key copied");
  }

  return (
    <div className="space-y-3">
      <Alert.Root status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title className="text-sm">Copy this key now</Alert.Title>
          <Alert.Description className="text-xs">
            The gateway stores only a SHA-256 hash, so this plaintext value
            cannot be recovered after you close this dialog.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
      <div className="rounded-lg border border-border bg-surface-secondary p-2.5">
        <p className="break-all font-mono text-xs">{value}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onPress={copy}>
          <FiCopy size={14} /> Copy
        </Button>
        <Button size="sm" variant="primary" onPress={onClose}>
          <FiCheck size={14} /> Done
        </Button>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <Card.Root>
      <Card.Content className="p-3">
      <p className="console-label">{label}</p>
      <p className="console-value mt-0.5">{value}</p>
      </Card.Content>
    </Card.Root>
  );
}

function KeysSkeleton() {
  return (
    <Card.Root>
      <Card.Content className="p-0">
        <DataTable aria-label="Loading API keys">
          <Table.Header>
            <Table.Column id="key" isRowHeader>Key</Table.Column>
            <Table.Column id="status">Status</Table.Column>
            <Table.Column id="ownership">Ownership</Table.Column>
            <Table.Column id="models">Models</Table.Column>
            <Table.Column id="updated">Updated</Table.Column>
            <Table.Column id="actions">Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {Array.from({ length: 4 }).map((_, row) => (
              <Table.Row key={row}>
                {Array.from({ length: 6 }).map((_, cell) => (
                  <Table.Cell key={cell}>
                    <Skeleton className="h-3.5 w-full rounded" />
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </DataTable>
      </Card.Content>
    </Card.Root>
  );
}

function StatusChip({ status }: { status: string }) {
  const colorMap: Record<string, "success" | "warning" | "danger" | "default"> =
    {
      active: "success",
      archived: "warning",
      revoked: "danger",
      expired: "danger",
      not_yet_active: "warning",
    };
  return (
    <Chip size="sm" variant="soft" color={colorMap[status] ?? "default"}>
      {status}
    </Chip>
  );
}

function getBlockedModels(key: GatewayApiKeyRegistrySnapshot): string[] {
  return key.registryOverride?.policy?.blockedExternalModels ?? [];
}

function formatDate(value: string | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}
