import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  Modal,
  ProgressBar,
  Skeleton,
  useOverlayState,
  toast,
} from "@heroui/react";
import {
  FiArrowLeft,
  FiRotateCw,
  FiArchive,
  FiTrash2,
  FiRefreshCw,
  FiKey,
  FiAlertTriangle,
  FiInfo,
} from "react-icons/fi";
import {
  useKey,
  useKeyStatus,
  useKeyEvents,
  useDeleteKey,
  useArchiveKey,
  useRestoreKey,
  useRotateKey,
} from "../../hooks/use-queries";

export const Route = createFileRoute("/keys/$keyId")({
  component: KeyDetailPage,
});

function KeyDetailPage() {
  const { keyId } = Route.useParams();
  const navigate = useNavigate();

  const key = useKey(keyId);
  const keyStatus = useKeyStatus(keyId);
  const keyEvents = useKeyEvents(keyId);
  const deleteMut = useDeleteKey();
  const archiveMut = useArchiveKey();
  const restoreMut = useRestoreKey();
  const rotateMut = useRotateKey();

  const deleteModal = useOverlayState();
  const archiveModal = useOverlayState();
  const rotateModal = useOverlayState();
  const [pending, setPending] = useState(false);

  /* ── Loading ─────────────────────────────────────────────────────── */

  if (key.isLoading) return <KeyDetailSkeleton />;

  const keyData = key.data?.key;
  if (!keyData) {
    return (
      <div className="p-6 animate-fade-in">
        <p className="text-danger">Key not found</p>
      </div>
    );
  }

  /* ── Handlers ────────────────────────────────────────────────────── */

  async function handleDelete() {
    setPending(true);
    try {
      await deleteMut.mutateAsync({ keyId });
      toast.success("Key deleted");
      deleteModal.close();
      navigate({ to: "/keys" });
    } catch {
      toast.danger("Failed to delete key");
    } finally {
      setPending(false);
    }
  }

  async function handleArchive() {
    setPending(true);
    try {
      await archiveMut.mutateAsync({ keyId });
      toast.success("Key archived");
      archiveModal.close();
    } catch {
      toast.danger("Failed to archive key");
    } finally {
      setPending(false);
    }
  }

  async function handleRestore() {
    setPending(true);
    try {
      await restoreMut.mutateAsync({ keyId });
      toast.success("Key restored");
    } catch {
      toast.danger("Failed to restore key");
    } finally {
      setPending(false);
    }
  }

  async function handleRotate() {
    setPending(true);
    try {
      await rotateMut.mutateAsync({ keyId });
      toast.success("Key rotated");
      rotateModal.close();
    } catch {
      toast.danger("Failed to rotate key");
    } finally {
      setPending(false);
    }
  }

  /* ── Status color helper ─────────────────────────────────────────── */
  const statusColorMap: Record<string, "success" | "warning" | "danger"> = {
    active: "success",
    archived: "warning",
    revoked: "danger",
    expired: "danger",
  };

  /* ── Event type styling ──────────────────────────────────────────── */
  function eventBorderColor(type: string): string {
    if (type.includes("rotate")) return "border-l-primary";
    if (type.includes("archive")) return "border-l-warning";
    if (type.includes("delete") || type.includes("revoke"))
      return "border-l-danger";
    if (type.includes("restore")) return "border-l-success";
    if (type.includes("create")) return "border-l-accent";
    return "border-l-default";
  }

  function eventChipColor(
    type: string
  ): "default" | "accent" | "success" | "warning" | "danger" {
    if (type.includes("rotate")) return "accent";
    if (type.includes("archive")) return "warning";
    if (type.includes("delete") || type.includes("revoke")) return "danger";
    if (type.includes("restore")) return "success";
    if (type.includes("create")) return "accent";
    return "default";
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          isIconOnly
          variant="ghost"
          onPress={() => navigate({ to: "/keys" })}
        >
          <FiArrowLeft size={18} />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {keyData.name || keyData.id.slice(0, 16)}
          </h1>
          <p className="text-sm text-default-400 font-mono mt-0.5">
            {keyData.id}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {keyData.status === "active" && (
            <>
              <Button variant="ghost" onPress={rotateModal.open}>
                <FiRotateCw size={16} /> Rotate
              </Button>
              <Button variant="outline" onPress={archiveModal.open}>
                <FiArchive size={16} /> Archive
              </Button>
            </>
          )}
          {keyData.status === "archived" && (
            <Button
              variant="primary"
              isDisabled={pending}
              onPress={handleRestore}
            >
              {pending ? "Restoring..." : "Restore"}
            </Button>
          )}
          <Button variant="danger-soft" onPress={deleteModal.open}>
            <FiTrash2 size={16} /> Delete
          </Button>
        </div>
      </div>

      {/* Two-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Key Info Card */}
        <Card.Root>
          <Card.Header className="px-5 pt-5 pb-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-default-400 mb-3">
              Key Information
            </p>
          </Card.Header>
          <Card.Content className="gap-3">
            <InfoRow label="Status">
              <Chip
                size="sm"
                variant="soft"
                color={statusColorMap[keyData.status] ?? "default"}
              >
                {keyData.status}
              </Chip>
            </InfoRow>
            <InfoRow label="Tier">
              {keyData.tier ? (
                <Chip size="sm" variant="soft" color="accent">
                  {keyData.tier}
                </Chip>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label="Scopes">
              <div className="flex gap-1 flex-wrap justify-end">
                {keyData.scopes?.length
                  ? keyData.scopes.map((s) => (
                      <Chip key={s} size="sm" variant="soft">
                        {s}
                      </Chip>
                    ))
                  : "—"}
              </div>
            </InfoRow>
            <InfoRow label="Tags">
              <div className="flex gap-1 flex-wrap justify-end">
                {keyData.tags?.length
                  ? keyData.tags.map((t) => (
                      <Chip key={t} size="sm" variant="soft" color="accent">
                        {t}
                      </Chip>
                    ))
                  : "—"}
              </div>
            </InfoRow>
            <InfoRow label="Created">
              <span className="text-sm">
                {new Date(keyData.createdAt).toLocaleString()}
              </span>
            </InfoRow>
            {keyData.expiresAt != null && (
              <InfoRow label="Expires">
                <span className="text-sm">
                  {new Date(keyData.expiresAt).toLocaleString()}
                </span>
              </InfoRow>
            )}
          </Card.Content>
        </Card.Root>

        {/* Quotas Card */}
        <Card.Root>
          <Card.Header className="px-5 pt-5 pb-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-default-400 mb-3">
              Quotas
            </p>
          </Card.Header>
          <Card.Content className="gap-4">
            {keyStatus.data?.quotas ? (
              <>
                {keyStatus.data.quotas.requestQuota && (
                  <QuotaBar
                    label="Requests"
                    used={keyStatus.data.quotas.requestQuota.used}
                    limit={keyStatus.data.quotas.requestQuota.limit}
                  />
                )}
                {keyStatus.data.quotas.tokenQuota && (
                  <QuotaBar
                    label="Tokens"
                    used={keyStatus.data.quotas.tokenQuota.used}
                    limit={keyStatus.data.quotas.tokenQuota.limit}
                  />
                )}
                {keyStatus.data.quotas.concurrency && (
                  <QuotaBar
                    label="Concurrency"
                    used={keyStatus.data.quotas.concurrency.current}
                    limit={keyStatus.data.quotas.concurrency.limit}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-default-400 py-4 text-center">
                No quotas configured
              </p>
            )}
          </Card.Content>
        </Card.Root>
      </div>

      {/* Audit Events Card */}
      <Card.Root>
        <Card.Header className="px-5 pt-5 pb-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-default-400 mb-3">
            Audit Events
          </p>
        </Card.Header>
        <Card.Content>
          {keyEvents.data?.events?.length ? (
            <div className="space-y-2">
              {keyEvents.data.events.map((event) => (
                <div
                  key={event.id}
                  className={`flex items-center gap-3 py-2.5 px-3 border-l-4 rounded-r-md ${eventBorderColor(event.type)} border-b border-divider last:border-b-0`}
                >
                  <Chip
                    size="sm"
                    variant="soft"
                    color={eventChipColor(event.type)}
                  >
                    {event.type}
                  </Chip>
                  <span className="text-sm text-default-400 ml-auto">
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                  {event.actor && (
                    <span className="text-sm text-default-400">
                      by{" "}
                      <span className="font-medium text-default-500">
                        {event.actor}
                      </span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-default-400 py-8 text-center">
              No audit events
            </p>
          )}
        </Card.Content>
      </Card.Root>

      {/* Delete Confirmation Modal */}
      <Modal.Root state={deleteModal}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>Delete Key</Modal.Header>
              <Modal.Body>
                <div className="flex items-start gap-3">
                  <FiAlertTriangle
                    className="text-danger mt-0.5 shrink-0"
                    size={20}
                  />
                  <p className="text-sm">
                    Are you sure you want to delete this key?{" "}
                    <span className="font-semibold text-danger">
                      This action cannot be undone.
                    </span>
                  </p>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={deleteModal.close}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  isDisabled={pending}
                  onPress={handleDelete}
                >
                  {pending ? "Deleting..." : "Delete"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      {/* Archive Confirmation Modal */}
      <Modal.Root state={archiveModal}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>Archive Key</Modal.Header>
              <Modal.Body>
                <div className="flex items-start gap-3">
                  <FiInfo
                    className="text-warning mt-0.5 shrink-0"
                    size={20}
                  />
                  <p className="text-sm">
                    Are you sure you want to archive this key? It can be
                    restored later.
                  </p>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={archiveModal.close}>
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  isDisabled={pending}
                  onPress={handleArchive}
                >
                  {pending ? "Archiving..." : "Archive"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      {/* Rotate Confirmation Modal */}
      <Modal.Root state={rotateModal}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>Rotate Key</Modal.Header>
              <Modal.Body>
                <div className="flex items-start gap-3">
                  <FiAlertTriangle
                    className="text-warning mt-0.5 shrink-0"
                    size={20}
                  />
                  <p className="text-sm">
                    This will generate a new key value.{" "}
                    <span className="font-semibold">
                      The old value will stop working immediately.
                    </span>
                  </p>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={rotateModal.close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  isDisabled={pending}
                  onPress={handleRotate}
                >
                  {pending ? "Rotating..." : "Rotate"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </div>
  );
}

/* ── Info Row ───────────────────────────────────────────────────────── */

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center gap-4">
      <span className="text-sm text-default-400 shrink-0">{label}</span>
      <span className="text-sm text-right">{children}</span>
    </div>
  );
}

/* ── Quota Bar ──────────────────────────────────────────────────────── */

function QuotaBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="font-medium">{label}</span>
        <span className="text-default-400 tabular-nums">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <ProgressBar.Root
        value={pct}
        color={pct > 80 ? "danger" : pct > 50 ? "warning" : "success"}
      />
    </div>
  );
}

/* ── Skeleton Loading State ─────────────────────────────────────────── */

function KeyDetailSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-start gap-4">
        <Skeleton className="h-9 w-9 rounded" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-7 w-48 rounded" />
          <Skeleton className="h-4 w-64 rounded" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded" />
          <Skeleton className="h-9 w-24 rounded" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card.Root key={i}>
            <Card.Content className="gap-3">
              <Skeleton className="h-3 w-32 rounded mb-2" />
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="flex justify-between">
                  <Skeleton className="h-4 w-16 rounded" />
                  <Skeleton className="h-4 w-24 rounded" />
                </div>
              ))}
            </Card.Content>
          </Card.Root>
        ))}
      </div>

      <Card.Root>
        <Card.Content>
          <Skeleton className="h-3 w-24 rounded mb-4" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded mb-2" />
          ))}
        </Card.Content>
      </Card.Root>
    </div>
  );
}
