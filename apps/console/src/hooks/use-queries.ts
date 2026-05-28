import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useClient } from "../lib/client";
import { queryKeys } from "../lib/query-keys";

export function useStatus() {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => client.getStatus()
  });
}

export function useMetrics(refreshInterval = 10_000) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.metrics,
    queryFn: () => client.getMetrics(),
    refetchInterval: refreshInterval
  });
}

export function useConfig() {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => client.getConfig()
  });
}

export function useRoutingHealth() {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.routingHealth,
    queryFn: () => client.getRoutingHealth()
  });
}

export function useKeys(params?: Record<string, string>) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.keys.list(params),
    queryFn: () => client.listKeys(params)
  });
}

export function useKey(keyId: string) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.keys.detail(keyId),
    queryFn: () => client.getKey(keyId)
  });
}

export function useKeyStatus(keyId: string) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.keys.status(keyId),
    queryFn: () => client.getKeyStatus(keyId)
  });
}

export function useKeyEvents(keyId: string) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.keys.events(keyId),
    queryFn: () => client.getKeyEvents(keyId)
  });
}

export function useCreateKey() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof client.createKey>[0]) =>
      client.createKey(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keys.all });
      qc.invalidateQueries({ queryKey: queryKeys.status });
      qc.invalidateQueries({ queryKey: queryKeys.config });
    }
  });
}

export function useUpdateKey() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      keyId,
      payload
    }: {
      keyId: string;
      payload: Parameters<typeof client.updateKey>[1];
    }) => client.updateKey(keyId, payload),
    onSuccess: (_, { keyId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.keys.detail(keyId) });
      qc.invalidateQueries({ queryKey: queryKeys.keys.status(keyId) });
      qc.invalidateQueries({ queryKey: queryKeys.keys.events(keyId) });
      qc.invalidateQueries({ queryKey: queryKeys.keys.all });
    }
  });
}

export function useUpdateKeyRegistryOverride() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      keyId,
      payload
    }: {
      keyId: string;
      payload: Parameters<typeof client.updateKeyRegistryOverride>[1];
    }) => client.updateKeyRegistryOverride(keyId, payload),
    onSuccess: (_, { keyId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.keys.status(keyId) });
      qc.invalidateQueries({ queryKey: queryKeys.keys.events(keyId) });
      qc.invalidateQueries({ queryKey: queryKeys.keys.all });
    }
  });
}

export function useDeleteKey() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, payload }: { keyId: string; payload?: unknown }) =>
      client.deleteKey(keyId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.keys.all })
  });
}

export function useRotateKey() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, payload }: { keyId: string; payload?: unknown }) =>
      client.rotateKey(keyId, payload),
    onSuccess: (_, { keyId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.keys.detail(keyId) });
      qc.invalidateQueries({ queryKey: queryKeys.keys.all });
    }
  });
}

export function useArchiveKey() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, payload }: { keyId: string; payload?: unknown }) =>
      client.archiveKey(keyId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.keys.all })
  });
}

export function useRestoreKey() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, payload }: { keyId: string; payload?: unknown }) =>
      client.restoreKey(keyId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.keys.all })
  });
}

export function useRevokeKey() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, payload }: { keyId: string; payload?: unknown }) =>
      client.revokeKey(keyId, payload),
    onSuccess: (_, { keyId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.keys.detail(keyId) });
      qc.invalidateQueries({ queryKey: queryKeys.keys.all });
    }
  });
}

export function useConfigStoreSnapshot() {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.configStore.snapshot,
    queryFn: () => client.getConfigStoreSnapshot()
  });
}

export function useConfigStoreSection(section: string) {
  const client = useClient();
  return useQuery({
    queryKey: queryKeys.configStore.section(section),
    queryFn: () => client.getConfigStoreSection(section)
  });
}

export function usePutConfigStoreSection(section: string) {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => client.putConfigStoreSection(section, data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.configStore.snapshot })
  });
}

export function useDeleteConfigStoreSection() {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (section: string) => client.deleteConfigStoreSection(section),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.configStore.snapshot })
  });
}

export function useFetchProviderModels() {
  const client = useClient();
  return useMutation({
    mutationFn: ({
      baseUrl,
      apiKey,
      type
    }: {
      baseUrl: string;
      apiKey: string;
      type?: string;
    }) => client.fetchProviderModels(baseUrl, apiKey, type)
  });
}
