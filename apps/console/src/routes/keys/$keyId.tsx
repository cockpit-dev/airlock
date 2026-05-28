import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  useOverlayState
} from "@heroui/react";
import {
  FiAlertTriangle,
  FiArchive,
  FiArrowLeft,
  FiCopy,
  FiEdit2,
  FiRotateCw,
  FiShield,
  FiTrash2
} from "react-icons/fi";

import {
  useArchiveKey,
  useConfig,
  useDeleteKey,
  useKey,
  useKeyEvents,
  useMetrics,
  useKeyStatus,
  useRestoreKey,
  useRotateKey,
  useUpdateKey,
  useUpdateKeyRegistryOverride
} from "../../hooks/use-queries";
import type {
  GatewayApiKeyLifecycleStatus,
  GatewayApiKeyPolicy,
  GatewayApiKeyRegistrySnapshot,
  RegistryKeyView
} from "../../lib/api";
import {
  buildUpdatedKeyPolicy,
  generateGatewayKeyValue,
  getConfiguredModels,
  hashGatewayKeyValue
} from "../../lib/key-policy";
import {
  CacheUsageByModelChart,
  TokenUsageByModelChart
} from "../../components/dashboard-charts";
import { DataTable, Table } from "../../components/data-table";

export const Route = createFileRoute("/keys/$keyId")({
  component: KeyDetailPage
});

function KeyDetailPage() {
  const { keyId } = Route.useParams();
  const navigate = useNavigate();

  const key = useKey(keyId);
  const keyStatus = useKeyStatus(keyId);
  const keyEvents = useKeyEvents(keyId);
  const metrics = useMetrics(10_000);
  const config = useConfig();
  const deleteMut = useDeleteKey();
  const archiveMut = useArchiveKey();
  const restoreMut = useRestoreKey();
  const rotateMut = useRotateKey();
  const updateKey = useUpdateKey();
  const updateOverride = useUpdateKeyRegistryOverride();

  const deleteModal = useOverlayState();
  const archiveModal = useOverlayState();
  const editModal = useOverlayState();
  const rotateModal = useOverlayState();
  const [pending, setPending] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editBlockedModels, setEditBlockedModels] = useState<string[]>([]);
  const [rotatedPlainTextKey, setRotatedPlainTextKey] = useState<string | null>(
    null
  );

  const snapshot = keyStatus.data;
  const registryKey = key.data;
  const configuredModels = useMemo(
    () => (config.data ? getConfiguredModels(config.data) : []),
    [config.data]
  );

  useEffect(() => {
    if (!snapshot) return;
    const effectivePolicy = getEffectivePolicy(snapshot, registryKey);
    setEditLabel(snapshot.runtime.label);
    setEditEnabled(snapshot.runtime.configuredStatus === "active");
    setEditBlockedModels(effectivePolicy.blocked ?? []);
  }, [snapshot, registryKey]);

  const keyModelMetrics = useMemo(() => {
    if (!metrics.data?.byKeyModel || !snapshot) return {};
    return Object.fromEntries(
      Object.entries(metrics.data.byKeyModel).filter(
        ([, value]) => value.keyId === snapshot.keyId
      )
    );
  }, [metrics.data?.byKeyModel, snapshot]);

  if (keyStatus.isLoading || key.isLoading) return <KeyDetailSkeleton />;

  if (!snapshot) {
    return (
      <div className="p-4 animate-fade-in">
        <Alert.Root status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Key not found</Alert.Title>
            <Alert.Description>
              The gateway did not return status data for this key.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </div>
    );
  }

  const isRegistryOwned = snapshot.ownership === "registry";
  const effectivePolicy = getEffectivePolicy(snapshot, registryKey);
  const isAccepted = snapshot.runtime.acceptedNow;
  const disabledModelCount = effectivePolicy.blocked.length;
  const keyMetrics = metrics.data?.byKey?.[snapshot.keyId];

  async function handleDelete() {
    setPending(true);
    try {
      await deleteMut.mutateAsync({ keyId });
      toast.success("Key deleted");
      deleteModal.close();
      navigate({ to: "/keys" });
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setPending(false);
    }
  }

  async function handleArchive() {
    setPending(true);
    try {
      await archiveMut.mutateAsync({
        keyId,
        payload: { reason: "archived from console" }
      });
      toast.success("Key archived");
      archiveModal.close();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Archive failed");
    } finally {
      setPending(false);
    }
  }

  async function handleRestore() {
    setPending(true);
    try {
      await restoreMut.mutateAsync({
        keyId,
        payload: { reason: "restored from console" }
      });
      toast.success("Key restored");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Restore failed");
    } finally {
      setPending(false);
    }
  }

  async function handleRotate() {
    const nextKeyValue = generateGatewayKeyValue();
    setPending(true);
    try {
      await rotateMut.mutateAsync({
        keyId,
        payload: {
          valueHash: await hashGatewayKeyValue(nextKeyValue),
          reason: "rotated from console"
        }
      });
      setRotatedPlainTextKey(nextKeyValue);
      toast.success("Key rotated");
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Rotate failed");
    } finally {
      setPending(false);
    }
  }

  function openEditModal() {
    if (!snapshot) return;
    setEditLabel(snapshot.runtime.label);
    setEditEnabled(snapshot.runtime.configuredStatus === "active");
    setEditBlockedModels(effectivePolicy.blocked);
    editModal.open();
  }

  function setEditModelEnabled(model: string, isEnabled: boolean) {
    setEditBlockedModels((current) => {
      const blocked = new Set(current);
      if (isEnabled) {
        blocked.delete(model);
      } else {
        blocked.add(model);
      }
      return configuredModels.filter((candidate) => blocked.has(candidate));
    });
  }

  async function handleSaveEdit() {
    if (!snapshot) return;
    const currentPolicy = effectivePolicy.policy;
    const nextPolicy = buildUpdatedKeyPolicy(currentPolicy, editBlockedModels);
    const payload = {
      label: editLabel.trim() || snapshot.runtime.label,
      status: editEnabled ? "active" : "revoked",
      policy: nextPolicy ?? null,
      reason: "updated from console"
    } as const;

    try {
      if (isRegistryOwned) {
        await updateKey.mutateAsync({ keyId, payload });
      } else {
        await updateOverride.mutateAsync({ keyId, payload });
      }
      toast.success("Key updated");
      editModal.close();
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "Key update failed"
      );
    }
  }

  async function copyRotatedKey() {
    if (!rotatedPlainTextKey) return;
    await navigator.clipboard.writeText(rotatedPlainTextKey);
    toast.success("Key copied");
  }

  return (
    <div className="console-page console-stack animate-fade-in">
      <div className="console-header flex-col lg:flex-row">
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          onPress={() => navigate({ to: "/keys" })}
          aria-label="Back to keys"
        >
          <FiArrowLeft size={16} />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="console-title truncate">{snapshot.runtime.label}</h1>
            <StatusChip status={snapshot.runtime.effectiveStatus} />
            <Chip size="sm" variant="soft">
              {snapshot.ownership}
            </Chip>
          </div>
          <p className="text-[11px] text-muted font-mono mt-0.5 break-all">
            {snapshot.keyId}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          <Button
            size="sm"
            variant="secondary"
            aria-label="Edit key"
            onPress={openEditModal}
          >
            <FiEdit2 size={14} /> Edit
          </Button>
          {isRegistryOwned && snapshot.runtime.effectiveStatus === "active" && (
            <>
              <Button size="sm" variant="ghost" onPress={rotateModal.open}>
                <FiRotateCw size={14} /> Rotate
              </Button>
              <Button size="sm" variant="outline" onPress={archiveModal.open}>
                <FiArchive size={14} /> Archive
              </Button>
            </>
          )}
          {isRegistryOwned &&
            snapshot.runtime.effectiveStatus === "archived" && (
              <Button
                size="sm"
                variant="primary"
                isPending={pending}
                onPress={handleRestore}
              >
                Restore
              </Button>
            )}
          {isRegistryOwned && (
            <Button size="sm" variant="danger-soft" onPress={deleteModal.open}>
              <FiTrash2 size={14} /> Delete
            </Button>
          )}
        </div>
      </div>

      {rotatedPlainTextKey && (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title className="text-sm">
              Copy the rotated key now
            </Alert.Title>
            <Alert.Description className="text-xs">
              The plaintext value is shown once. After this page changes, only
              the hash remains in the registry.
            </Alert.Description>
            <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <code className="break-all rounded-md bg-surface-secondary px-2.5 py-1.5 text-[11px]">
                {rotatedPlainTextKey}
              </code>
              <Button size="sm" variant="secondary" onPress={copyRotatedKey}>
                <FiCopy size={13} /> Copy
              </Button>
            </div>
          </Alert.Content>
        </Alert.Root>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <Card.Root>
            <Card.Header>
              <Card.Title className="text-sm">Runtime Status</Card.Title>
              <Card.Description className="text-[11px]">
                Effective state after lifecycle windows, overrides, and
                revocation.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <div className="grid grid-cols-2 gap-3">
                <InfoItem
                  label="Accepted now"
                  value={isAccepted ? "Yes" : "No"}
                />
                <InfoItem
                  label="Lifecycle"
                  value={snapshot.runtime.lifecycleStatus}
                />
                <InfoItem
                  label="Configured status"
                  value={snapshot.runtime.configuredStatus}
                />
                <InfoItem
                  label="Override"
                  value={snapshot.registryOverrideApplied ? "Applied" : "None"}
                />
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-default/40 px-3 py-2.5">
                <div>
                  <p className="text-[13px] font-medium">Enable key</p>
                  <p className="text-[11px] text-muted">
                    Edit the key to change this state.
                  </p>
                </div>
                <Chip
                  size="sm"
                  variant="soft"
                  color={
                    snapshot.runtime.configuredStatus === "active"
                      ? "success"
                      : "danger"
                  }
                >
                  {snapshot.runtime.configuredStatus === "active"
                    ? "enabled"
                    : "disabled"}
                </Chip>
              </div>
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title className="text-sm">Model Access</Card.Title>
              <Card.Description className="text-[11px]">
                All configured models stay enabled unless they appear in the
                disabled list.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip
                  size="sm"
                  variant="soft"
                  color={disabledModelCount > 0 ? "warning" : "success"}
                >
                  {disabledModelCount > 0
                    ? `${disabledModelCount} disabled`
                    : "all enabled"}
                </Chip>
                {effectivePolicy.policy?.allowedExternalModels?.length ? (
                  <Chip size="sm" variant="soft" color="warning">
                    explicit allow-list present
                  </Chip>
                ) : null}
              </div>

              {configuredModels.length > 0 ? (
                <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2">
                  {configuredModels.map((model) => (
                    <ModelAccessStatus
                      key={model}
                      model={model}
                      isEnabled={!effectivePolicy.blocked.includes(model)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">
                  No configured models were reported by the gateway.
                </p>
              )}

              <div className="flex justify-end">
                <Button size="sm" variant="primary" onPress={openEditModal}>
                  Edit Access
                </Button>
              </div>
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title className="text-sm">Usage Analytics</Card.Title>
              <Card.Description className="text-[11px]">
                Live key-level requests, tokens, and cache usage.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              {metrics.isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="space-y-1.5">
                      <Skeleton className="h-2.5 w-16 rounded" />
                      <Skeleton className="h-5 w-20 rounded" />
                    </div>
                  ))}
                </div>
              ) : keyMetrics ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <InfoItem label="Requests" value={keyMetrics.requests} />
                  <InfoItem
                    label="Avg latency"
                    value={`${keyMetrics.avgDurationMs}ms`}
                  />
                  <InfoItem
                    label="Input tokens"
                    value={keyMetrics.inputTokens.toLocaleString()}
                  />
                  <InfoItem
                    label="Output tokens"
                    value={keyMetrics.outputTokens.toLocaleString()}
                  />
                  <InfoItem
                    label="Total tokens"
                    value={keyMetrics.totalTokens.toLocaleString()}
                  />
                  <InfoItem
                    label="Cached input"
                    value={keyMetrics.cachedInputTokens.toLocaleString()}
                  />
                  <InfoItem
                    label="Cache read"
                    value={keyMetrics.cacheReadTokens.toLocaleString()}
                  />
                  <InfoItem
                    label="Cache write"
                    value={keyMetrics.cacheWriteTokens.toLocaleString()}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted">
                  No usage has been recorded for this key in the current metrics
                  window.
                </p>
              )}
            </Card.Content>
          </Card.Root>

          {keyMetrics ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card.Root>
                <Card.Header>
                  <Card.Title className="text-sm">
                    Token Usage by Model
                  </Card.Title>
                </Card.Header>
                <Card.Content>
                  <TokenUsageByModelChart byModel={keyModelMetrics} />
                </Card.Content>
              </Card.Root>
              <Card.Root>
                <Card.Header>
                  <Card.Title className="text-sm">
                    Cached Input by Model
                  </Card.Title>
                </Card.Header>
                <Card.Content>
                  <CacheUsageByModelChart byModel={keyModelMetrics} />
                </Card.Content>
              </Card.Root>
            </div>
          ) : null}

          <Card.Root>
            <Card.Header>
              <Card.Title className="text-sm">Audit Events</Card.Title>
            </Card.Header>
            <Card.Content className="p-0 overflow-x-auto">
              {keyEvents.data?.events?.length ? (
                <DataTable aria-label="Key audit events">
                  <Table.Header>
                    <Table.Column id="event" isRowHeader>
                      Event
                    </Table.Column>
                    <Table.Column id="actor">Actor</Table.Column>
                    <Table.Column id="reason">Reason</Table.Column>
                    <Table.Column id="time">Time</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {keyEvents.data.events.map((event, index) => (
                      <Table.Row key={event.id ?? `${event.kind}-${index}`}>
                        <Table.Cell>
                          <Chip size="sm" variant="soft">
                            {event.kind}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-xs">{event.actor ?? "-"}</span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-xs text-muted">
                            {event.reason ?? "-"}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-xs text-muted">
                            {formatDate(event.timestamp)}
                          </span>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </DataTable>
              ) : (
                <p className="px-3 py-4 text-center text-xs text-muted">
                  No audit events
                </p>
              )}
            </Card.Content>
          </Card.Root>
        </div>

        <div className="space-y-3">
          <Card.Root>
            <Card.Header>
              <Card.Title className="text-sm">Key Metadata</Card.Title>
            </Card.Header>
            <Card.Content>
              <InfoRow label="Ownership">{snapshot.ownership}</InfoRow>
              <InfoRow label="Runtime label">{snapshot.runtime.label}</InfoRow>
              <InfoRow label="Not before">
                {formatDate(snapshot.runtime.notBefore)}
              </InfoRow>
              <InfoRow label="Expires">
                {formatDate(snapshot.runtime.expiresAt)}
              </InfoRow>
              <InfoRow label="Overlay revoked">
                {snapshot.runtime.overlayRevoked ? "Yes" : "No"}
              </InfoRow>
              <InfoRow label="Overlay updated">
                {formatDate(snapshot.runtime.overlayUpdatedAt)}
              </InfoRow>
              {registryKey?.createdAt ? (
                <InfoRow label="Created">
                  {formatDate(registryKey.createdAt)}
                </InfoRow>
              ) : null}
              {registryKey?.updatedAt ? (
                <InfoRow label="Updated">
                  {formatDate(registryKey.updatedAt)}
                </InfoRow>
              ) : null}
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title className="text-sm">Policy Snapshot</Card.Title>
            </Card.Header>
            <Card.Content>
              <pre className="console-code max-h-64">
                {JSON.stringify(effectivePolicy.policy ?? {}, null, 2)}
              </pre>
            </Card.Content>
          </Card.Root>
        </div>
      </div>

      <ConfirmModal
        state={deleteModal}
        title="Delete Key"
        description="This deletes the registry-owned key permanently. Configured keys cannot be deleted from the console."
        actionLabel="Delete"
        actionVariant="danger"
        isPending={pending}
        onAction={handleDelete}
      />
      <ConfirmModal
        state={archiveModal}
        title="Archive Key"
        description="Archived keys stop authenticating but can be restored later."
        actionLabel="Archive"
        actionVariant="outline"
        isPending={pending}
        onAction={handleArchive}
      />
      <EditKeyModal
        state={editModal}
        label={editLabel}
        isEnabled={editEnabled}
        blockedModels={editBlockedModels}
        configuredModels={configuredModels}
        isPending={updateKey.isPending || updateOverride.isPending}
        onLabelChange={setEditLabel}
        onEnabledChange={setEditEnabled}
        onModelEnabledChange={setEditModelEnabled}
        onSave={handleSaveEdit}
      />
      <ConfirmModal
        state={rotateModal}
        title="Rotate Key"
        description="The old value stops working immediately. The new plaintext value will be shown once after rotation."
        actionLabel="Rotate"
        actionVariant="primary"
        isPending={pending}
        onAction={handleRotate}
      />
    </div>
  );
}

function getEffectivePolicy(
  snapshot: GatewayApiKeyRegistrySnapshot,
  registryKey: RegistryKeyView | undefined
): { policy: GatewayApiKeyPolicy | undefined; blocked: string[] } {
  const policy =
    snapshot.ownership === "registry"
      ? registryKey?.key.policy
      : (snapshot.registryOverride?.policy ?? undefined);

  return {
    policy,
    blocked: policy?.blockedExternalModels ?? []
  };
}

function ModelAccessStatus({
  model,
  isEnabled
}: {
  model: string;
  isEnabled: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-2xl bg-default/40 px-3 py-2">
      <p className="truncate font-mono text-[11px]">{model}</p>
      <Chip size="sm" variant="soft" color={isEnabled ? "success" : "warning"}>
        {isEnabled ? "enabled" : "disabled"}
      </Chip>
    </div>
  );
}

function StatusChip({ status }: { status: GatewayApiKeyLifecycleStatus }) {
  const colorMap: Record<
    GatewayApiKeyLifecycleStatus,
    "success" | "warning" | "danger" | "default"
  > = {
    active: "success",
    archived: "warning",
    revoked: "danger",
    expired: "danger",
    not_yet_active: "warning"
  };
  return (
    <Chip size="sm" variant="soft" color={colorMap[status] ?? "default"}>
      {status}
    </Chip>
  );
}

function EditKeyModal({
  state,
  label,
  isEnabled,
  blockedModels,
  configuredModels,
  isPending,
  onLabelChange,
  onEnabledChange,
  onModelEnabledChange,
  onSave
}: {
  state: ReturnType<typeof useOverlayState>;
  label: string;
  isEnabled: boolean;
  blockedModels: string[];
  configuredModels: string[];
  isPending: boolean;
  onLabelChange: (label: string) => void;
  onEnabledChange: (isEnabled: boolean) => void;
  onModelEnabledChange: (model: string, isEnabled: boolean) => void;
  onSave: () => void;
}) {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={state.setOpen}>
      <Modal.Container placement="center">
        <Modal.Dialog className="max-h-[calc(100dvh-2rem)] max-w-2xl p-4 sm:p-6">
          <Modal.Header>
            <Modal.Heading>Edit key</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="overflow-y-auto pr-1">
            <Form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
            >
              <TextField isRequired value={label}>
                <Label>Key name</Label>
                <Input
                  value={label}
                  onChange={(event) => onLabelChange(event.target.value)}
                />
              </TextField>

              <Switch.Root
                aria-label="Key enabled"
                size="sm"
                isSelected={isEnabled}
                onChange={onEnabledChange}
                className="justify-between rounded-2xl bg-default/40 px-3 py-2.5"
              >
                <Switch.Content>
                  <Label className="text-[13px]">Enabled</Label>
                  <Description>
                    Disabled keys are rejected before routing.
                  </Description>
                </Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Root>

              <section className="space-y-3">
                <div className="flex items-start gap-2">
                  <FiShield size={14} className="mt-0.5 shrink-0 text-muted" />
                  <div>
                    <p className="text-[13px] font-medium">Model access</p>
                    <p className="text-xs text-muted">
                      This key can call every model you leave enabled.
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
                        onChange={(nextEnabled) =>
                          onModelEnabledChange(model, nextEnabled)
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
            </Form>
          </Modal.Body>
          <Modal.Footer>
            <Button size="sm" variant="ghost" onPress={state.close}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              isPending={isPending}
              onPress={onSave}
            >
              Save changes
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ModelAccessSwitch({
  model,
  isEnabled,
  onChange
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
        <Description>{isEnabled ? "Enabled" : "Disabled"}</Description>
      </Switch.Content>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Root>
  );
}

function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-muted">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium">{value}</p>
    </div>
  );
}

function InfoRow({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-border pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-right text-xs">{children}</span>
    </div>
  );
}

function ConfirmModal({
  state,
  title,
  description,
  actionLabel,
  actionVariant,
  isPending,
  onAction
}: {
  state: ReturnType<typeof useOverlayState>;
  title: string;
  description: string;
  actionLabel: string;
  actionVariant: "primary" | "danger" | "outline";
  isPending: boolean;
  onAction: () => void;
}) {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={state.setOpen}>
      <Modal.Container>
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex items-start gap-2.5">
              <FiAlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-warning"
              />
              <p className="text-sm text-muted">{description}</p>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button size="sm" variant="ghost" onPress={state.close}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={actionVariant}
              isPending={isPending}
              onPress={onAction}
            >
              {actionLabel}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function KeyDetailSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <div className="flex items-start gap-3">
        <Skeleton className="h-7 w-7 rounded" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-3 w-64 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card.Root key={index}>
            <Card.Content className="gap-2.5">
              <Skeleton className="h-4 w-28 rounded" />
              {Array.from({ length: 5 }).map((__, row) => (
                <Skeleton key={row} className="h-7 w-full rounded" />
              ))}
            </Card.Content>
          </Card.Root>
        ))}
      </div>
    </div>
  );
}

function formatDate(value: string | undefined): string {
  if (!value || value === "1970-01-01T00:00:00.000Z") return "-";
  return new Date(value).toLocaleString();
}
