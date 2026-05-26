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
  Switch,
  Table,
  toast,
  useOverlayState,
  ListBox,
  ListBoxItem,
} from "@heroui/react";
import { FiPlus, FiUsers } from "react-icons/fi";
import { useState } from "react";
import {
  useConfigStoreSection,
  usePutConfigStoreSection,
} from "../../hooks/use-queries";

export const Route = createFileRoute("/config/accounts")({
  component: AccountsPage,
});

const ROLES = ["super_admin", "admin", "operator", "viewer"];

interface Account {
  email: string;
  role: string;
  enabled: boolean;
}

const ROLE_COLORS: Record<string, "accent" | "default" | "success" | "warning"> = {
  super_admin: "accent",
  admin: "default",
  operator: "success",
  viewer: "warning",
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
      { email: editEmail, role: editRole ?? "viewer", enabled },
    ];
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(`Account "${editEmail}" ${isEditing ? "updated" : "created"} successfully.`);
        modalState.close();
      },
      onError: (err) => {
        toast.danger(`Failed to save account: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
    });
  }

  function handleToggle(email: string, enabled: boolean) {
    const updated = accounts.map((a) =>
      a.email === email ? { ...a, enabled } : a
    );
    putSection.mutate(updated, {
      onSuccess: () => {
        toast.success(`Account "${email}" ${enabled ? "enabled" : "disabled"}.`);
      },
      onError: (err) => {
        toast.danger(`Failed to update account: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
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
        toast.danger(`Failed to delete account: ${err instanceof Error ? err.message : "Unknown error"}`);
      },
    });
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
          <p className="text-sm text-default-400">Manage admin access</p>
        </div>
        <Button variant="primary" onPress={() => openEdit()}>
          <FiPlus size={16} /> Add Account
        </Button>
      </div>

      {section.isLoading ? (
        <Card.Root>
          <Card.Content className="p-0">
            <div className="p-4 space-y-3">
              <div className="flex gap-4">
                <Skeleton animationType="pulse" className="h-4 w-40 rounded" />
                <Skeleton animationType="pulse" className="h-4 w-24 rounded" />
                <Skeleton animationType="pulse" className="h-4 w-20 rounded" />
                <Skeleton animationType="pulse" className="h-4 w-24 rounded" />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton animationType="pulse" className="h-8 w-40 rounded" />
                  <Skeleton animationType="pulse" className="h-6 w-24 rounded-full" />
                  <Skeleton animationType="pulse" className="h-6 w-10 rounded" />
                  <Skeleton animationType="pulse" className="h-8 w-24 rounded" />
                </div>
              ))}
            </div>
          </Card.Content>
        </Card.Root>
      ) : accounts.length === 0 ? (
        <Card.Root className="border-dashed border-2 border-default-200">
          <Card.Content className="py-12">
            <EmptyState.Root>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-default-100">
                  <FiUsers size={24} className="text-default-400" />
                </div>
                <div>
                  <p className="text-lg font-medium text-default-700">No accounts configured</p>
                  <p className="text-sm text-default-400 mt-1">Add an account to manage admin access</p>
                </div>
                <Button variant="primary" onPress={() => openEdit()} className="mt-2">
                  <FiPlus size={16} /> Add Account
                </Button>
              </div>
            </EmptyState.Root>
          </Card.Content>
        </Card.Root>
      ) : (
        <Card.Root>
          <Card.Content className="p-0">
            <Table.Root aria-label="Accounts">
              <Table.Header>
                <Table.Column isRowHeader>Email</Table.Column>
                <Table.Column>Role</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {accounts.map((account) => (
                  <Table.Row key={account.email} className="hover:bg-default-50">
                    <Table.Cell>
                      <span className="font-mono text-sm">{account.email}</span>
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
                      <div className="flex items-center gap-2">
                        <Switch.Root
                          size="sm"
                          isSelected={account.enabled}
                          onChange={(v) => handleToggle(account.email, v)}
                        >
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch.Root>
                        <span className="text-xs text-default-400">
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
                {isEditing ? "Edit Account" : "Add Account"}
              </Modal.Header>
              <Modal.Body className="gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    type="email"
                    placeholder="user@example.com"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <Select.Root
                    selectedKey={editRole}
                    onSelectionChange={(key) =>
                      setEditRole(key as string | null)
                    }
                  >
                    <Select.Trigger />
                    <Select.Value>
                      {({ isPlaceholder }) =>
                        isPlaceholder ? "Select role" : undefined
                      }
                    </Select.Value>
                    <Select.Indicator />
                    <Select.Popover>
                      <ListBox>
                        {ROLES.map((r) => (
                          <ListBoxItem key={r} textValue={r}>
                            <div className="flex items-center gap-2">
                              <Chip size="sm" variant="soft" color={ROLE_COLORS[r] ?? "default"}>
                                {r}
                              </Chip>
                            </div>
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
              <Modal.Header>Delete Account</Modal.Header>
              <Modal.Body>
                <p className="text-sm text-default-500">
                  Are you sure you want to delete account{" "}
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
