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
  Switch,
  TextField,
  toast,
  useOverlayState,
  ListBox,
  ListBoxItem
} from "@heroui/react";
import { FiPlus, FiUsers } from "react-icons/fi";
import { useState } from "react";
import {
  useConfigStoreSection,
  usePutConfigStoreSection
} from "../../hooks/use-queries";
import { DataTable, Table } from "../../components/data-table";
import { EmptyContent } from "../../components/empty-content";

export const Route = createFileRoute("/config/accounts")({
  component: AccountsPage
});

const ROLES = ["super_admin", "admin", "operator", "viewer"];

interface Account {
  email: string;
  role: string;
  enabled: boolean;
}

const ROLE_COLORS: Record<
  string,
  "accent" | "default" | "success" | "warning"
> = {
  super_admin: "accent",
  admin: "default",
  operator: "success",
  viewer: "warning"
};

function AccountsPage() {
  const section = useConfigStoreSection("accounts");
  const putSection = usePutConfigStoreSection("accounts");
  const modalState = useOverlayState();
  const deleteModalState = useOverlayState();

  const accounts = (section.data?.data as Account[]) ?? [];

  const [editEmail, setEditEmail] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editRole, setEditRole] = useState<string | null>("viewer");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  function openEdit(account?: Account) {
    if (account) {
      setEditEmail(account.email);
      setIsEditing(true);
      setEditRole(account.role);
    } else {
      setEditEmail("");
      setIsEditing(false);
      setEditRole("viewer");
    }
    modalState.open();
  }

  function handleSave() {
    if (!editEmail.trim()) {
      toast.danger("Email is required.");
      return;
    }
    const existing = accounts.filter((a) => a.email !== editEmail);
    const existingAccount = accounts.find((a) => a.email === editEmail);
    const enabled = isEditing ? (existingAccount?.enabled ?? true) : true;
    const updated = [
      ...existing,
      { email: editEmail, role: editRole ?? "viewer", enabled }
    ];
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(
          `Account "${editEmail}" ${isEditing ? "updated" : "created"} successfully.`
        );
        modalState.close();
      },
      onError: (err) => {
        toast.danger(
          `Failed to save account: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    });
  }

  function handleToggle(email: string, enabled: boolean) {
    const updated = accounts.map((a) =>
      a.email === email ? { ...a, enabled } : a
    );
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(
          `Account "${email}" ${enabled ? "enabled" : "disabled"}.`
        );
      },
      onError: (err) => {
        toast.danger(
          `Failed to update account: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    });
  }

  function confirmDelete(email: string) {
    setDeleteTarget(email);
    deleteModalState.open();
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const updated = accounts.filter((a) => a.email !== deleteTarget);
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(`Account "${deleteTarget}" deleted.`);
        deleteModalState.close();
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast.danger(
          `Failed to delete account: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    });
  }

  return (
    <div className="console-page console-stack animate-fade-in">
      <div className="console-header">
        <div>
          <h1 className="console-title">Accounts</h1>
          <p className="console-subtitle">Manage admin access</p>
        </div>
        <Button size="sm" variant="primary" onPress={() => openEdit()}>
          <FiPlus size={14} /> Add Account
        </Button>
      </div>

      {section.isLoading ? (
        <Card.Root>
          <Card.Content className="p-0">
            <div className="p-3 space-y-2.5">
              <div className="flex gap-3">
                <Skeleton
                  animationType="pulse"
                  className="h-3.5 w-32 rounded"
                />
                <Skeleton
                  animationType="pulse"
                  className="h-3.5 w-20 rounded"
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
                    className="h-7 w-32 rounded"
                  />
                  <Skeleton
                    animationType="pulse"
                    className="h-5 w-20 rounded-full"
                  />
                  <Skeleton animationType="pulse" className="h-5 w-8 rounded" />
                </div>
              ))}
            </div>
          </Card.Content>
        </Card.Root>
      ) : accounts.length === 0 ? (
        <Card.Root>
          <Card.Content>
            <EmptyContent
              icon={<FiUsers />}
              title="No accounts configured"
              description="Add an account to manage admin access."
              action={
                <Button size="sm" variant="primary" onPress={() => openEdit()}>
                  <FiPlus size={14} /> Add Account
                </Button>
              }
            />
          </Card.Content>
        </Card.Root>
      ) : (
        <Card.Root>
          <Card.Header className="flex-row items-center justify-between">
            <Card.Title>Access Directory</Card.Title>
            <span className="text-xs text-muted">{accounts.length} total</span>
          </Card.Header>
          <Card.Content className="p-0">
            <DataTable aria-label="Accounts">
              <Table.Header>
                <Table.Column id="email" isRowHeader>
                  Email
                </Table.Column>
                <Table.Column id="role">Role</Table.Column>
                <Table.Column id="status">Status</Table.Column>
                <Table.Column id="actions">Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {accounts.map((account) => (
                  <Table.Row
                    key={account.email}
                    className="hover:bg-default/50"
                  >
                    <Table.Cell>
                      <span className="font-mono text-xs">{account.email}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={ROLE_COLORS[account.role] ?? "default"}
                      >
                        {account.role}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1.5">
                        <Switch.Root
                          size="sm"
                          isSelected={account.enabled}
                          onChange={(v) => handleToggle(account.email, v)}
                        >
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch.Root>
                        <span className="text-[11px] text-muted">
                          {account.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => openEdit(account)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-soft"
                          onPress={() => confirmDelete(account.email)}
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
                {isEditing ? "Edit Account" : "Add Account"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="gap-3">
              <TextField value={editEmail} onChange={setEditEmail}>
                <Label>Email</Label>
                <Input type="email" placeholder="user@example.com" />
              </TextField>
              <Select.Root
                aria-label="Role"
                selectedKey={editRole}
                onSelectionChange={(key) => setEditRole(key as string | null)}
              >
                <Label>Role</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {ROLES.map((r) => (
                      <ListBoxItem id={r} key={r} textValue={r}>
                        <div className="flex items-center gap-1.5">
                          <Chip
                            size="sm"
                            variant="soft"
                            color={ROLE_COLORS[r] ?? "default"}
                          >
                            {r}
                          </Chip>
                        </div>
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
              <Modal.Heading>Delete Account</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">
                Are you sure you want to delete account{" "}
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
