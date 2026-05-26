import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  Modal,
  ProgressBar,
  Spinner,
  useOverlayState,
} from "@heroui/react";
import { FiArrowLeft, FiRotateCw, FiArchive, FiTrash2, FiRefreshCw } from "react-icons/fi";
import {
  useKey,
  useKeyStatus,
  useKeyEvents,
  useDeleteKey,
  useArchiveKey,
  useRestoreKey,
  useRotateKey,
} from "../../hooks/use-queries";
import { useState } from "react";

export const Route = createFileRoute("/keys/$keyId")({
  component: KeyDetailPage,
});

function KeyDetailPage() {
  const { keyId } = Route.useParams();
  const navigate = useNavigate();
  const key = useKey(keyId);
  const keyStatus = useKeyStatus(keyId);
  const keyEvents = useKeyEvents(keyId);
  const deleteKey = useDeleteKey();
  const archiveKey = useArchiveKey();
  const restoreKey = useRestoreKey();
  const rotateKey = useRotateKey();

  const confirmDelete = useOverlayState();
  const confirmArchive = useOverlayState();
  const confirmRotate = useOverlayState();
  const [pending, setPending] = useState(false);

  if (key.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  const keyData = key.data?.key;
  if (!keyData) {
    return <p className="p-6 text-danger">Key not found</p>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          isIconOnly
          variant="ghost"
          onPress={() => navigate({ to: "/keys" })}
        >
          <FiArrowLeft />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {keyData.name || keyData.id.slice(0, 16)}
          </h1>
          <p className="text-sm text-default-400 font-mono">{keyData.id}</p>
        </div>
        <div className="ml-auto flex gap-2">
          {keyData.status === "active" && (
            <>
              <Button variant="ghost" onPress={confirmRotate.open}>
                <FiRotateCw /> Rotate
              </Button>
              <Button variant="outline" onPress={confirmArchive.open}>
                <FiArchive /> Archive
              </Button>
            </>
          )}
          {keyData.status === "archived" && (
            <Button
              variant="primary"
              isDisabled={pending}
              onPress={async () => {
                setPending(true);
                try {
                  await restoreKey.mutateAsync({ keyId });
                } finally {
                  setPending(false);
                }
              }}
            >
              <FiRefreshCw /> Restore
            </Button>
          )}
          <Button variant="danger-soft" onPress={confirmDelete.open}>
            <FiTrash2 /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card.Root>
          <Card.Header>
            <h2 className="text-lg font-semibold">Key Info</h2>
          </Card.Header>
          <Card.Content className="gap-2">
            <InfoRow label="Status">
              <Chip
                size="sm"
                variant="soft"
                color={
                  keyData.status === "active"
                    ? "success"
                    : keyData.status === "archived"
                      ? "warning"
                      : "danger"
                }
              >
                {keyData.status}
              </Chip>
            </InfoRow>
            <InfoRow label="Tier">{keyData.tier || "—"}</InfoRow>
            <InfoRow label="Scopes">
              <div className="flex gap-1 flex-wrap">
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
              <div className="flex gap-1 flex-wrap">
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
              {new Date(keyData.createdAt).toLocaleString()}
            </InfoRow>
            {keyData.expiresAt && (
              <InfoRow label="Expires">
                {new Date(keyData.expiresAt).toLocaleString()}
              </InfoRow>
            )}
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <h2 className="text-lg font-semibold">Quotas</h2>
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
              <p className="text-sm text-default-400">No quotas configured</p>
            )}
          </Card.Content>
        </Card.Root>
      </div>

      <Card.Root>
        <Card.Header>
          <h2 className="text-lg font-semibold">Audit Events</h2>
        </Card.Header>
        <Card.Content>
          {keyEvents.data?.events?.length ? (
            <div className="space-y-2">
              {keyEvents.data.events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-3 py-2 border-b border-divider last:border-0"
                >
                  <Chip size="sm" variant="soft">
                    {event.type}
                  </Chip>
                  <span className="text-sm text-default-400">
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                  {event.actor && (
                    <span className="text-sm text-default-400">
                      by {event.actor}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-default-400">No events</p>
          )}
        </Card.Content>
      </Card.Root>

      <Modal.Root state={confirmDelete}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>Delete Key</Modal.Header>
              <Modal.Body>
                Are you sure you want to delete this key? This action cannot be
                undone.
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={confirmDelete.close}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  isDisabled={pending}
                  onPress={async () => {
                    setPending(true);
                    try {
                      await deleteKey.mutateAsync({ keyId });
                      confirmDelete.close();
                      navigate({ to: "/keys" });
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {pending ? "Deleting..." : "Delete"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      <Modal.Root state={confirmArchive}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>Archive Key</Modal.Header>
              <Modal.Body>
                Are you sure you want to archive this key? It can be restored later.
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={confirmArchive.close}>
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  isDisabled={pending}
                  onPress={async () => {
                    setPending(true);
                    try {
                      await archiveKey.mutateAsync({ keyId });
                      confirmArchive.close();
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {pending ? "Archiving..." : "Archive"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      <Modal.Root state={confirmRotate}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>Rotate Key</Modal.Header>
              <Modal.Body>
                This will generate a new key value. The old value will stop working.
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={confirmRotate.close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  isDisabled={pending}
                  onPress={async () => {
                    setPending(true);
                    try {
                      await rotateKey.mutateAsync({ keyId });
                      confirmRotate.close();
                    } finally {
                      setPending(false);
                    }
                  }}
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

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-default-400">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-default-400">
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
