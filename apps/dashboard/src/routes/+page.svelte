<script lang="ts">
  import type { GatewayStatusResponse, MetricsSnapshot, RoutingHealthResponse } from "$lib/api.js";
  import { createClient, getStoredCredentials } from "$lib/auth.js";
  import { onMount } from "svelte";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import * as Table from "$lib/components/ui/table";
  import * as Chart from "$lib/components/ui/chart";
  import { PieChart, LineChart, BarChart } from "layerchart";
  import { cn } from "$lib/utils";
  import Activity from "@lucide/svelte/icons/activity";
  import Gauge from "@lucide/svelte/icons/gauge";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Route from "@lucide/svelte/icons/route";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Zap from "@lucide/svelte/icons/zap";

  let { data } = $props<{
    data: {
      status: GatewayStatusResponse | null;
      metrics: MetricsSnapshot | null;
      routingHealth: RoutingHealthResponse | null;
    };
  }>();

  const MAX_DATA_POINTS = 30;
  let trendData = $state<{ time: string; requests: number; errors: number }[]>([]);

  const statusChartConfig = {
    success: { label: "Success", color: "var(--chart-2)" },
    error: { label: "Error", color: "var(--chart-1)" },
  } satisfies Chart.ChartConfig;

  const routeHealthConfig = {
    healthy: { label: "Healthy", color: "var(--chart-2)" },
    degraded: { label: "Degraded", color: "var(--chart-4)" },
    down: { label: "Down", color: "var(--chart-1)" },
  } satisfies Chart.ChartConfig;

  const trendConfig = {
    requests: { label: "Requests", color: "var(--chart-1)" },
    errors: { label: "Errors", color: "var(--chart-5)" },
  } satisfies Chart.ChartConfig;

  const errorRateConfig = {
    rate: { label: "Error Rate %", color: "var(--chart-1)" },
  } satisfies Chart.ChartConfig;

  const latencyConfig = {
    latency: { label: "Avg (ms)", color: "var(--chart-1)" },
  } satisfies Chart.ChartConfig;

  const providerLatencyConfig = {
    latency: { label: "Avg (ms)", color: "var(--chart-2)" },
    errors: { label: "Errors", color: "var(--chart-1)" },
  } satisfies Chart.ChartConfig;

  const providerRequestConfig = {
    requests: { label: "Requests", color: "var(--chart-1)" },
  } satisfies Chart.ChartConfig;

  const statusChartData = $derived.by(() => {
    const m = data.metrics;
    if (!m) return [];
    return [
      { key: "success", label: "Success", value: Math.max(0, m.requests - m.errors) },
      { key: "error", label: "Error", value: m.errors },
    ];
  });

  const routeHealthChartData = $derived.by(() => {
    const rh = data.routingHealth;
    if (!rh) return [];
    const entries = Object.entries(rh.routes);
    if (entries.length === 0) return [];
    const healthy = entries.filter(([, r]) => r.healthStatus === "healthy").length;
    const degraded = entries.filter(([, r]) => r.healthStatus === "degraded").length;
    const down = entries.length - healthy - degraded;
    return [
      { key: "healthy", label: "Healthy", value: healthy },
      { key: "degraded", label: "Degraded", value: degraded },
      ...(down > 0 ? [{ key: "down", label: "Down", value: down }] : []),
    ];
  });

  const errorRateChartData = $derived(
    trendData.map((d) => ({ time: d.time, rate: d.requests > 0 ? +((d.errors / d.requests) * 100).toFixed(1) : 0 }))
  );

  const latencyChartData = $derived.by(() => {
    const m = data.metrics;
    if (!m) return [];
    return Object.entries(m.byRoute).map(([name, rm]) => ({
      route: name,
      latency: rm.avgDurationMs,
    }));
  });

  const providerLatencyChartData = $derived.by(() => {
    const m = data.metrics;
    if (!m?.byProvider) return [];
    return Object.entries(m.byProvider).map(([name, pm]) => ({
      provider: name,
      latency: pm.avgDurationMs,
    }));
  });

  const providerRequestChartData = $derived.by(() => {
    const m = data.metrics;
    if (!m?.byProvider) return [];
    return Object.entries(m.byProvider)
      .map(([name, pm]) => ({
        provider: name,
        requests: pm.requests,
        errors: pm.errors,
        errorRate: pm.requests > 0 ? +((pm.errors / pm.requests) * 100).toFixed(1) : 0,
        streamRatio: pm.requests > 0 ? Math.round((pm.streamCount / pm.requests) * 100) : 0,
      }))
      .sort((a, b) => b.requests - a.requests);
  });

  function healthDot(status: string): string {
    if (status === "healthy") return "bg-success";
    if (status === "degraded") return "bg-warning";
    return "bg-destructive";
  }

  function healthBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
    if (status === "healthy") return "default";
    if (status === "degraded") return "secondary";
    return "destructive";
  }

  function formatCompact(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  function pushMetricsPoint(m: MetricsSnapshot) {
    const now = new Date();
    const label = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    trendData = [
      ...trendData.slice(-(MAX_DATA_POINTS - 1)),
      { time: label, requests: m.requests, errors: m.errors },
    ];
  }

  onMount(() => {
    if (data.metrics) pushMetricsPoint(data.metrics);
    const interval = setInterval(async () => {
      const creds = getStoredCredentials();
      if (!creds) return;
      const client = createClient(creds.url, creds.token);
      try {
        const m = await client.getMetrics();
        pushMetricsPoint(m);
      } catch {
        /* skip */
      }
    }, 10000);
    return () => clearInterval(interval);
  });
</script>

{#if !getStoredCredentials()}
  <Card.Root class="mb-4">
    <Card.Content class="flex items-center justify-between gap-3">
      <div>
        <p class="text-sm font-medium">Gateway Connection Required</p>
        <p class="text-xs text-muted-foreground">Connect to a gateway admin endpoint to view dashboard data.</p>
      </div>
      <Button href="/login" class="shrink-0">Connect</Button>
    </Card.Content>
  </Card.Root>
{/if}

<div class="mb-3 flex items-end justify-between">
  <div>
    <h1 class="text-xl font-semibold tracking-tight">Dashboard</h1>
    <p class="text-xs text-muted-foreground">AI Gateway overview and real-time metrics</p>
  </div>
  {#if data.status}
    <span class="font-mono text-[11px] text-muted-foreground">fingerprint: {data.status.configFingerprint.slice(0, 16)}</span>
  {/if}
</div>

{#if data.status}
  <!-- Stat Cards -->
  <div class="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
    <Card.Root>
      <Card.Content class="flex items-center gap-2.5">
        <div class="flex size-7 items-center justify-center rounded-md bg-brand/10">
          <Gauge class="size-3.5 text-brand" />
        </div>
        <div class="min-w-0">
          <p class="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Mode</p>
          <p class="text-base font-bold tracking-tight">{data.status.mode}</p>
        </div>
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Content class="flex items-center gap-2.5">
        <div class="flex size-7 items-center justify-center rounded-md bg-info/10">
          <Route class="size-3.5 text-info" />
        </div>
        <div class="min-w-0">
          <p class="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Routes</p>
          <p class="text-base font-bold tracking-tight">{data.status.routes.length}</p>
        </div>
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Content class="flex items-center gap-2.5">
        <div class="flex size-7 items-center justify-center rounded-md bg-success/10">
          <KeyRound class="size-3.5 text-success" />
        </div>
        <div class="min-w-0">
          <p class="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Keys</p>
          <p class="text-base font-bold tracking-tight">{data.status.keys.total}</p>
          <p class="text-[10px] text-muted-foreground">{data.status.keys.registryOwned} registry</p>
        </div>
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Content class="flex items-center gap-2.5">
        <div class="flex size-7 items-center justify-center rounded-md {data.status.circuitBreaker.openTargets.length > 0 ? 'bg-destructive/10' : 'bg-success/10'}">
          <ShieldCheck class="size-3.5 {data.status.circuitBreaker.openTargets.length > 0 ? 'text-destructive' : 'text-success'}" />
        </div>
        <div class="min-w-0">
          <p class="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Circuits</p>
          <p class="text-base font-bold tracking-tight">
            <span class={data.status.circuitBreaker.openTargets.length > 0 ? "text-destructive" : "text-success"}>{data.status.circuitBreaker.openTargets.length}</span>
            <span class="text-xs font-normal text-muted-foreground"> / {data.status.circuitBreaker.totalTargets}</span>
          </p>
        </div>
      </Card.Content>
    </Card.Root>
  </div>

  {#if data.metrics}
    <!-- Metric Highlights -->
    <div class="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Card.Root>
        <Card.Content class="flex items-center justify-between">
          <div>
            <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total Requests</p>
            <p class="text-2xl font-bold tracking-tight">{formatCompact(data.metrics.requests)}</p>
            <p class="text-[10px] text-muted-foreground">{(data.metrics.window.durationMs / 1000).toFixed(0)}s window</p>
          </div>
          <div class="flex size-8 items-center justify-center rounded-lg bg-info/10">
            <Activity class="size-4 text-info" />
          </div>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Content class="flex items-center justify-between">
          <div>
            <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Error Rate</p>
            <p class="text-2xl font-bold tracking-tight">
              <span class={data.metrics.errorRate > 0.05 ? "text-destructive" : data.metrics.errorRate > 0.01 ? "text-warning" : "text-success"}>
                {(data.metrics.errorRate * 100).toFixed(1)}%
              </span>
            </p>
            <p class="text-[10px] text-muted-foreground">{data.metrics.errors} errors</p>
          </div>
          <div class="flex size-8 items-center justify-center rounded-lg {data.metrics.errorRate > 0.05 ? 'bg-destructive/10' : data.metrics.errorRate > 0.01 ? 'bg-warning/10' : 'bg-success/10'}">
            {#if data.metrics.errorRate > 0.05}
              <AlertTriangle class="size-4 text-destructive" />
            {:else}
              <Zap class="size-4 {data.metrics.errorRate > 0.01 ? 'text-warning' : 'text-success'}" />
            {/if}
          </div>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Content class="flex items-center justify-between">
          <div>
            <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Avg Latency</p>
            <p class="text-2xl font-bold tracking-tight">
              <span class={data.metrics.avgDurationMs > 3000 ? "text-destructive" : data.metrics.avgDurationMs > 1000 ? "text-warning" : "text-success"}>
                {data.metrics.avgDurationMs}<span class="text-sm font-normal text-muted-foreground">ms</span>
              </span>
            </p>
          </div>
          <div class="flex size-8 items-center justify-center rounded-lg bg-info/10">
            <Zap class="size-4 text-info" />
          </div>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Content class="flex items-center justify-between">
          <div>
            <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Stream Ratio</p>
            <p class="text-2xl font-bold tracking-tight">
              {(data.metrics.streamRatio * 100).toFixed(0)}<span class="text-sm font-normal text-muted-foreground">%</span>
            </p>
            <p class="text-[10px] text-muted-foreground">{data.metrics.streamCount} streaming</p>
          </div>
          <div class="flex size-8 items-center justify-center rounded-lg bg-info/10">
            <Activity class="size-4 text-info" />
          </div>
        </Card.Content>
      </Card.Root>
    </div>

    <!-- Doughnut Charts -->
    <div class="mb-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
      <Card.Root>
        <Card.Header class="pb-1">
          <Card.Title class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Request Status</Card.Title>
        </Card.Header>
        <Card.Content>
          <Chart.Container config={statusChartConfig} class="h-44 w-full">
            <PieChart
              data={statusChartData}
              innerRadius={0.65}
              padAngle={0.02}
              legend
              tooltip={false}
            />
          </Chart.Container>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-1">
          <Card.Title class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Route Health</Card.Title>
        </Card.Header>
        <Card.Content>
          <Chart.Container config={routeHealthConfig} class="h-44 w-full">
            <PieChart
              data={routeHealthChartData}
              innerRadius={0.65}
              padAngle={0.02}
              legend
              tooltip={false}
            />
          </Chart.Container>
        </Card.Content>
      </Card.Root>
    </div>

    <!-- Trend & Error Rate -->
    <div class="mb-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
      <Card.Root>
        <Card.Header class="pb-1">
          <Card.Title class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Request Trend</Card.Title>
        </Card.Header>
        <Card.Content>
          <Chart.Container config={trendConfig} class="h-48 w-full">
            <LineChart
              data={trendData}
              x="time"
              axis="x"
              grid
              legend
              series={[
                { key: "requests", color: "var(--chart-1)" },
                { key: "errors", color: "var(--chart-5)" },
              ]}
            >
              {#snippet tooltip()}
                <Chart.Tooltip />
              {/snippet}
            </LineChart>
          </Chart.Container>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header class="pb-1">
          <Card.Title class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Error Rate</Card.Title>
        </Card.Header>
        <Card.Content>
          <Chart.Container config={errorRateConfig} class="h-48 w-full">
            <BarChart
              data={errorRateChartData}
              x="time"
              axis="x"
              grid
              tooltip={false}
              series={[
                { key: "rate", color: "var(--chart-1)" },
              ]}
            />
          </Chart.Container>
        </Card.Content>
      </Card.Root>
    </div>

    <!-- Route Latency -->
    {#if latencyChartData.length > 0}
      <Card.Root class="mb-4">
        <Card.Header class="pb-1">
          <Card.Title class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Route Latency</Card.Title>
        </Card.Header>
        <Card.Content>
          <Chart.Container config={latencyConfig} class="h-52 w-full">
            <BarChart
              data={latencyChartData}
              y="route"
              x="latency"
              orientation="horizontal"
              axis="x"
              grid
              tooltip={false}
              series={[
                { key: "latency", color: "var(--chart-1)" },
              ]}
            />
          </Chart.Container>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Provider Latency -->
    {#if providerLatencyChartData.length > 0}
      <Card.Root class="mb-4">
        <Card.Header class="pb-1">
          <Card.Title class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Provider Latency</Card.Title>
        </Card.Header>
        <Card.Content>
          <Chart.Container config={providerLatencyConfig} class="h-52 w-full">
            <BarChart
              data={providerLatencyChartData}
              y="provider"
              x="latency"
              orientation="horizontal"
              axis="x"
              grid
              tooltip={false}
              series={[
                { key: "latency", color: "var(--chart-2)" },
              ]}
            />
          </Chart.Container>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Provider Metrics Table -->
    {#if providerRequestChartData.length > 0}
      <div class="mb-4">
        <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Provider Metrics</p>
        <Card.Root>
          <Table.Root>
            <Table.Header>
              <Table.Row class="bg-muted/30">
                <Table.Head>Provider</Table.Head>
                <Table.Head>Requests</Table.Head>
                <Table.Head>Errors</Table.Head>
                <Table.Head>Error Rate</Table.Head>
                <Table.Head>Stream %</Table.Head>
                <Table.Head>Avg Latency</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each providerRequestChartData as pm}
                <Table.Row>
                  <Table.Cell class="font-mono text-xs">{pm.provider}</Table.Cell>
                  <Table.Cell>{pm.requests.toLocaleString()}</Table.Cell>
                  <Table.Cell>
                    <span class={pm.errors > 0 ? "text-destructive" : ""}>{pm.errors}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span class={pm.errorRate > 5 ? "text-destructive" : pm.errorRate > 1 ? "text-warning" : ""}>{pm.errorRate}%</span>
                  </Table.Cell>
                  <Table.Cell>{pm.streamRatio}%</Table.Cell>
                  <Table.Cell>
                    {#if data.metrics?.byProvider[pm.provider]}
                      <span class={data.metrics.byProvider[pm.provider].avgDurationMs > 3000 ? "text-destructive" : data.metrics.byProvider[pm.provider].avgDurationMs > 1000 ? "text-warning" : ""}>
                        {data.metrics.byProvider[pm.provider].avgDurationMs}ms
                      </span>
                    {/if}
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </Card.Root>
      </div>
    {/if}

    <!-- Status Codes -->
    {#if Object.keys(data.metrics.statusCodes).length > 0}
      <div class="mb-4">
        <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status Codes</p>
        <div class="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
          {#each Object.entries(data.metrics.statusCodes).sort(([a], [b]) => Number(a) - Number(b)) as [code, count]}
            <Card.Root size="sm">
              <Card.Content class="text-center">
                <p class={cn("font-mono text-sm font-semibold", Number(code) < 300 ? "text-success" : Number(code) < 400 ? "text-warning" : "text-destructive")}>{code}</p>
                <p class="text-[10px] text-muted-foreground">{count}</p>
              </Card.Content>
            </Card.Root>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Route Metrics Table -->
    {#if Object.keys(data.metrics.byRoute).length > 0}
      <div class="mb-4">
        <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Route Metrics</p>
        <Card.Root>
          <Table.Root>
            <Table.Header>
              <Table.Row class="bg-muted/30">
                <Table.Head>Route</Table.Head>
                <Table.Head>Requests</Table.Head>
                <Table.Head>Errors</Table.Head>
                <Table.Head>Avg Latency</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each Object.entries(data.metrics.byRoute) as [name, rm]}
                <Table.Row>
                  <Table.Cell class="font-mono text-xs">{name}</Table.Cell>
                  <Table.Cell>{rm.requests.toLocaleString()}</Table.Cell>
                  <Table.Cell>
                    <span class={rm.errors > 0 ? "text-destructive" : ""}>{rm.errors}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span class={rm.avgDurationMs > 3000 ? "text-destructive" : rm.avgDurationMs > 1000 ? "text-warning" : ""}>{rm.avgDurationMs}ms</span>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </Card.Root>
      </div>
    {/if}
  {/if}

  <!-- Providers -->
  {#if data.status.providers.length > 0}
    <div class="mb-4">
      <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Providers</p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each data.status.providers as provider}
          {@const pm = data.metrics?.byProvider[provider.id]}
          <Card.Root size="sm">
            <Card.Content>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <div class={cn("size-2 rounded-full", provider.configured ? "bg-success" : "bg-muted-foreground")}></div>
                  <div>
                    <p class="text-sm font-medium">{provider.id}</p>
                    <p class="text-[11px] text-muted-foreground">{provider.routeCount} route{provider.routeCount !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <Badge variant={provider.configured ? "default" : "outline"}>
                  {provider.configured ? "Active" : "Inactive"}
                </Badge>
              </div>
              {#if pm}
                <div class="mt-2 grid grid-cols-3 gap-2 border-t pt-2">
                  <div>
                    <p class="text-[10px] text-muted-foreground">Req</p>
                    <p class="text-xs font-semibold">{formatCompact(pm.requests)}</p>
                  </div>
                  <div>
                    <p class="text-[10px] text-muted-foreground">Err</p>
                    <p class={cn("text-xs font-semibold", pm.errors > 0 ? "text-destructive" : "")}>{pm.errors}</p>
                  </div>
                  <div>
                    <p class="text-[10px] text-muted-foreground">Latency</p>
                    <p class={cn("text-xs font-semibold", pm.avgDurationMs > 3000 ? "text-destructive" : pm.avgDurationMs > 1000 ? "text-warning" : "")}>{pm.avgDurationMs}ms</p>
                  </div>
                </div>
              {/if}
            </Card.Content>
          </Card.Root>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Route Health Table -->
  {#if data.routingHealth?.routes}
    <div>
      <p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Route Health</p>
      <Card.Root>
        <Table.Root>
          <Table.Header>
            <Table.Row class="bg-muted/30">
              <Table.Head>Route</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head>Healthy / Total</Table.Head>
              <Table.Head>Strategy</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each Object.entries(data.routingHealth.routes) as [name, route]}
              <Table.Row>
                <Table.Cell class="text-xs font-medium">{name}</Table.Cell>
                <Table.Cell>
                  <div class="flex items-center gap-1.5">
                    <div class={cn("size-2 rounded-full", healthDot(route.healthStatus))}></div>
                    <Badge variant={healthBadgeVariant(route.healthStatus)} class="text-xs">
                      {route.healthStatus}
                    </Badge>
                  </div>
                </Table.Cell>
                <Table.Cell class="text-xs">{route.healthyTargetCount} / {route.totalTargetCount}</Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground">{route.strategy ?? "default"}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Root>
    </div>
  {/if}
{:else}
  <Card.Root class="py-4 text-center">
    <Card.Content>
      <p class="text-sm text-muted-foreground">Failed to load gateway status.</p>
    </Card.Content>
  </Card.Root>
{/if}
