import { G as ensure_array_like, z as attr_class, P as stringify } from "../../chunks/renderer.js";
import { N as Nav } from "../../chunks/Nav.js";
import { g as escape_html } from "../../chunks/attributes.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    Nav($$renderer2);
    $$renderer2.push(`<!----> <main class="max-w-7xl mx-auto px-6 py-8"><h2 class="text-xl font-bold text-gray-100 mb-6">Dashboard</h2> `);
    if (data.status) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8"><div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="text-sm text-gray-400">Mode</p> <p class="text-lg font-semibold text-white">${escape_html(data.status.mode)}</p></div> <div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="text-sm text-gray-400">Routes</p> <p class="text-lg font-semibold text-white">${escape_html(data.status.routes.length)}</p></div> <div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="text-sm text-gray-400">Keys</p> <p class="text-lg font-semibold text-white">${escape_html(data.status.keys.total)} <span class="text-sm text-gray-500">(${escape_html(data.status.keys.registryOwned)} registry)</span></p></div> <div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="text-sm text-gray-400">Circuit Breakers</p> <p class="text-lg font-semibold text-white">${escape_html(data.status.circuitBreaker.openTargets)} <span class="text-sm text-gray-500">open / ${escape_html(data.status.circuitBreaker.totalTargets)} total</span></p></div></div> <div class="mb-8"><h3 class="text-lg font-semibold text-gray-200 mb-3">Providers</h3> <div class="grid grid-cols-1 md:grid-cols-3 gap-4"><!--[-->`);
      const each_array = ensure_array_like(data.status.providers);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let provider = each_array[$$index];
        $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between"><div><p class="font-medium text-white">${escape_html(provider.id)}</p> <p class="text-sm text-gray-400">${escape_html(provider.routeCount)} route${escape_html(provider.routeCount !== 1 ? "s" : "")}</p></div> <span${attr_class(`px-2 py-1 rounded text-xs font-medium ${stringify(provider.configured ? "bg-green-900 text-green-300" : "bg-gray-800 text-gray-500")}`)}>${escape_html(provider.configured ? "Configured" : "Not configured")}</span></div>`);
      }
      $$renderer2.push(`<!--]--></div></div> `);
      if (data.metrics) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="mb-8"><h3 class="text-lg font-semibold text-gray-200 mb-3">Request Metrics</h3> <div class="grid grid-cols-1 md:grid-cols-3 gap-4"><div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="text-sm text-gray-400">Total Requests</p> <p class="text-2xl font-bold text-white">${escape_html(data.metrics.requests.total)}</p></div> <div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="text-sm text-gray-400">Error Rate</p> <p class="text-2xl font-bold text-white">${escape_html(data.metrics.requests.total > 0 ? (data.metrics.requests.errors / data.metrics.requests.total * 100).toFixed(1) : 0)}%</p></div> <div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="text-sm text-gray-400">Avg Latency</p> <p class="text-2xl font-bold text-white">${escape_html(data.metrics.requests.avgDurationMs.toFixed(0))}ms</p></div></div></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if (data.routingHealth?.routes) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div><h3 class="text-lg font-semibold text-gray-200 mb-3">Route Health</h3> <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"><table class="w-full text-sm"><thead><tr class="border-b border-gray-800 text-gray-400 text-left"><th class="px-4 py-3">Route</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Healthy / Total</th><th class="px-4 py-3">Strategy</th></tr></thead><tbody><!--[-->`);
        const each_array_1 = ensure_array_like(Object.entries(data.routingHealth.routes));
        for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
          let [name, route] = each_array_1[$$index_1];
          $$renderer2.push(`<tr class="border-b border-gray-800 last:border-0"><td class="px-4 py-3 text-white font-medium">${escape_html(name)}</td><td class="px-4 py-3"><span${attr_class(`px-2 py-1 rounded text-xs font-medium ${stringify(route.healthStatus === "healthy" ? "bg-green-900 text-green-300" : route.healthStatus === "degraded" ? "bg-yellow-900 text-yellow-300" : "bg-red-900 text-red-300")}`)}>${escape_html(route.healthStatus)}</span></td><td class="px-4 py-3 text-gray-300">${escape_html(route.healthyTargetCount)} / ${escape_html(route.totalTargetCount)}</td><td class="px-4 py-3 text-gray-400">${escape_html(route.strategy ?? "default")}</td></tr>`);
        }
        $$renderer2.push(`<!--]--></tbody></table></div></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center"><p class="text-gray-400">Failed to load gateway status. Check your connection.</p></div>`);
    }
    $$renderer2.push(`<!--]--></main>`);
  });
}
export {
  _page as default
};
