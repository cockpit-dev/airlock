import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Card,
  Chip,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
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

export const Route = createFileRoute("/config/accounts")({
  component: AccountsPage,
});

const ROLES = ["super_admin", "admin", "operator", "viewer"];

interface Account {
  email: string;
  role: string;
  enabled: boolean;
}

function AccountsPage() {
  const section = useConfigStoreSection("accounts");
  const putSection = usePutConfigStoreSection("accounts");
  const modalState = useOverlayState();

  const accounts = (section.data?.data as Account[]) ?? [];
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<string | null>("viewer");

  function openEdit(account?: Account) {
    if (account) {
      setEditEmail(account.email);
      setEditRole(account.role);
    } else {
      setEditEmail("");
      setEditRole("viewer");
    }
    modalState.open();
  }

  function handleSave() {
    const existing = accounts.filter((a) => a.email !== editEmail);
    const updated = [...existing, { email: editEmail, role: editRole ?? "viewer", enabled: true }];
    putSection.mutate(updated, {
      onSuccess: () => modalState.close(),
    });
  }

  function handleToggle(email: string, enabled: boolean) {
    const updated = accounts.map((a) =>
      a.email === email ? { ...a, enabled } : a
    );
    putSection.mutate(updated);
  }

  function handleDelete(email: string) {
    const updated = accounts.filter((a) => a.email !== email);
    putSection.mutate(updated);
  }

  const roleColors: Record<string, "accent" | "default" | "success" | "warning"> = {
    super_admin: "accent",
    admin: "default",
    operator: "success",
    viewer: "warning",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <Button variant="primary" onPress={() => openEdit()}>
          <FiPlus /> Add Account
        </Button>
      </div>

      {section.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
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
                  <Table.Row key={account.email}>
                    <Table.Cell className="font-mono text-sm">
                      {account.email}
                    </Table.Cell>
                    <Table.Cell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={roleColors[account.role] ?? "default"}
                      >
                        {account.role}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <Switch.Root
                        size="sm"
                        isSelected={account.enabled}
                        onChange={(v) =>
                          handleToggle(account.email, v)
                        }
                      >
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Root>
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
                          onPress={() => handleDelete(account.email)}
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
                {editEmail && accounts.find((a) => a.email === editEmail)
                  ? "Edit Account"
                  : "Add Account"}
              </Modal.Header>
              <Modal.Body className="gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    type="email"
                    placeholder="user@example.com"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Role</label>
                  <Select.Root
                    selectedKey={editRole}
                    onSelectionChange={(key) => setEditRole(key as string | null)}
                  >
                    <Select.Trigger />
                    <Select.Value>{({ isPlaceholder }) =>
                      isPlaceholder ? "Select role" : undefined
                    }</Select.Value>
                    <Select.Indicator />
                    <Select.Popover>
                      <ListBox>
                        {ROLES.map((r) => (
                          <ListBoxItem key={r} textValue={r}>{r}</ListBoxItem>
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
