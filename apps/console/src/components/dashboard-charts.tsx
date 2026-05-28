import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps
} from "recharts";
import type { MetricsSnapshot } from "../lib/api";

const STATUS_COLORS: Record<string, string> = {
  "2": "var(--success)",
  "3": "var(--warning)",
  "4": "var(--warning)",
  "5": "var(--danger)"
};

export function StatusCodeChart({
  statusCodes
}: {
  statusCodes: MetricsSnapshot["statusCodes"];
}) {
  const data = Object.entries(statusCodes ?? {})
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    return <EmptyChart message="No status code data" />;
  }

  return (
    <BarChart
      data={data}
      margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
      responsive
      className="h-48 min-h-48 w-full min-w-0"
    >
      <CartesianGrid stroke="var(--separator)" vertical={false} />
      <XAxis
        dataKey="code"
        axisLine={false}
        tickLine={false}
        tick={{ fill: "var(--muted)", fontSize: 11 }}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        tick={{ fill: "var(--muted)", fontSize: 11 }}
        width={34}
      />
      <Tooltip
        content={(props) => <ChartTooltip {...props} />}
        cursor={{ fill: "var(--default)" }}
      />
      <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={42}>
        {data.map((item) => (
          <Cell
            key={item.code}
            fill={STATUS_COLORS[item.code.slice(0, 1)] ?? "var(--muted)"}
          />
        ))}
      </Bar>
    </BarChart>
  );
}

export function ProviderRequestsChart({
  byProvider
}: {
  byProvider: MetricsSnapshot["byProvider"];
}) {
  const data = Object.entries(byProvider ?? {})
    .map(([provider, info]) => ({
      label: provider,
      requests: info.requests,
      errors: info.errors
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 8);

  if (data.length === 0) {
    return <EmptyChart message="No provider data" />;
  }

  return (
    <HorizontalMetricChart
      data={data}
      dataKey="requests"
      unit=""
      color="var(--accent)"
    />
  );
}

export function RouteLatencyChart({
  byRoute
}: {
  byRoute: MetricsSnapshot["byRoute"];
}) {
  const data = Object.entries(byRoute ?? {})
    .map(([route, info]) => ({
      label: route,
      latency: Math.round(info.avgDurationMs),
      errors: info.errors
    }))
    .sort((a, b) => b.latency - a.latency)
    .slice(0, 8);

  if (data.length === 0) {
    return <EmptyChart message="No route data" />;
  }

  return (
    <HorizontalMetricChart
      data={data}
      dataKey="latency"
      unit="ms"
      color="var(--warning)"
    />
  );
}

export function TokenUsageByProtocolChart({
  byProtocol
}: {
  byProtocol: MetricsSnapshot["byProtocol"];
}) {
  const data = Object.entries(byProtocol ?? {})
    .map(([protocol, info]) => ({
      label: formatProtocolLabel(protocol),
      tokens: info.totalTokens,
      requests: info.requests
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 6);

  if (data.length === 0) {
    return <EmptyChart message="No token usage data" />;
  }

  return (
    <HorizontalMetricChart
      data={data}
      dataKey="tokens"
      unit=""
      color="var(--secondary)"
    />
  );
}

export function TokenUsageByModelChart({
  byModel
}: {
  byModel: MetricsSnapshot["byModel"];
}) {
  const data = Object.entries(byModel ?? {})
    .map(([model, info]) => ({
      label: model,
      tokens: info.totalTokens,
      requests: info.requests
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);

  if (data.length === 0) {
    return <EmptyChart message="No model usage data" />;
  }

  return (
    <HorizontalMetricChart
      data={data}
      dataKey="tokens"
      unit=""
      color="var(--success)"
    />
  );
}

export function TokenUsageByKeyChart({
  byKey
}: {
  byKey: MetricsSnapshot["byKey"];
}) {
  const data = Object.entries(byKey ?? {})
    .map(([keyId, info]) => ({
      label: keyId,
      tokens: info.totalTokens,
      requests: info.requests
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);

  if (data.length === 0) {
    return <EmptyChart message="No key usage data" />;
  }

  return (
    <HorizontalMetricChart
      data={data}
      dataKey="tokens"
      unit=""
      color="var(--primary)"
    />
  );
}

export function CacheUsageByModelChart({
  byModel
}: {
  byModel: MetricsSnapshot["byModel"];
}) {
  const data = Object.entries(byModel ?? {})
    .map(([model, info]) => ({
      label: model,
      cached: info.cachedInputTokens
    }))
    .filter((entry) => entry.cached > 0)
    .sort((a, b) => b.cached - a.cached)
    .slice(0, 8);

  if (data.length === 0) {
    return <EmptyChart message="No cache usage data" />;
  }

  return (
    <HorizontalMetricChart
      data={data}
      dataKey="cached"
      unit=""
      color="var(--warning)"
    />
  );
}

function HorizontalMetricChart({
  data,
  dataKey,
  unit,
  color
}: {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  unit: string;
  color: string;
}) {
  return (
    <BarChart
      data={data}
      layout="vertical"
      margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
      responsive
      className="h-48 min-h-48 w-full min-w-0"
    >
      <CartesianGrid stroke="var(--separator)" horizontal={false} />
      <XAxis
        type="number"
        axisLine={false}
        tickLine={false}
        tick={{ fill: "var(--muted)", fontSize: 11 }}
      />
      <YAxis
        dataKey="label"
        type="category"
        width={112}
        axisLine={false}
        tickLine={false}
        tick={{ fill: "var(--muted)", fontSize: 11 }}
      />
      <Tooltip
        content={(props) => <ChartTooltip {...props} unit={unit} />}
        cursor={{ fill: "var(--default)" }}
      />
      <Bar
        dataKey={dataKey}
        fill={color}
        radius={[0, 4, 4, 0]}
        maxBarSize={16}
      />
    </BarChart>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  unit = ""
}: TooltipContentProps & { unit?: string }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const value =
    typeof item.value === "number" ? item.value : Number(item.value ?? 0);

  return (
    <div className="rounded-md border border-border bg-overlay px-2.5 py-1.5 text-xs shadow-overlay">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-0.5 text-muted tabular-nums">
        {value.toLocaleString()}
        {unit}
      </p>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-border bg-surface-secondary/50">
      <p className="text-[13px] text-muted">{message}</p>
    </div>
  );
}

function formatProtocolLabel(protocol: string) {
  switch (protocol) {
    case "openai_chat":
      return "OpenAI Chat";
    case "openai_responses":
      return "OpenAI Responses";
    case "anthropic_messages":
      return "Claude Messages";
    case "gemini_generate_content":
      return "Gemini";
    default:
      return protocol.replace(/_/g, " ");
  }
}
