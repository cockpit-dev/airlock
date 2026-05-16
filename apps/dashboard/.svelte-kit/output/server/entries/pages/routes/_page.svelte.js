import { G as ensure_array_like, z as attr_class, P as stringify } from "../../../chunks/renderer.js";
import { N as Nav } from "../../../chunks/Nav.js";
import { g as escape_html } from "../../../chunks/attributes.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    Nav($$renderer2);
    $$renderer2.push(`<!----> <main class="max-w-7xl mx-auto px-6 py-8"><h2 class="text-xl font-bold text-gray-100 mb-6">Routing Health</h2> `);
    if (data.routingHealth) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="mb-8"><h3 class="text-lg font-semibold text-gray-200 mb-3">Routes</h3> <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"><table class="w-full text-sm"><thead><tr class="border-b border-gray-800 text-gray-400 text-left"><th class="px-4 py-3">Route</th><th class="px-4 py-3">Health</th><th class="px-4 py-3">Targets</th><th class="px-4 py-3">Strategy</th></tr></thead><tbody><!--[-->`);
      const each_array = ensure_array_like(Object.entries(data.routingHealth.routes));
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let [name, route] = each_array[$$index];
        $$renderer2.push(`<tr class="border-b border-gray-800 last:border-0"><td class="px-4 py-3 text-white font-medium">${escape_html(name)}</td><td class="px-4 py-3"><span${attr_class(`px-2 py-1 rounded text-xs font-medium ${stringify(route.healthStatus === "healthy" ? "bg-green-900 text-green-300" : route.healthStatus === "degraded" ? "bg-yellow-900 text-yellow-300" : "bg-red-900 text-red-300")}`)}>${escape_html(route.healthStatus)}</span></td><td class="px-4 py-3 text-gray-300">${escape_html(route.healthyTargetCount)}/${escape_html(route.totalTargetCount)}</td><td class="px-4 py-3 text-gray-400">${escape_html(route.strategy ?? "default")}</td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div></div> `);
      if (data.routingHealth.targets) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div><h3 class="text-lg font-semibold text-gray-200 mb-3">Targets</h3> <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"><table class="w-full text-sm"><thead><tr class="border-b border-gray-800 text-gray-400 text-left"><th class="px-4 py-3">Target</th><th class="px-4 py-3">Circuit State</th><th class="px-4 py-3">Error Rate</th><th class="px-4 py-3">Recovery Score</th></tr></thead><tbody><!--[-->`);
        const each_array_1 = ensure_array_like(Object.entries(data.routingHealth.targets));
        for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
          let [name, target] = each_array_1[$$index_1];
          $$renderer2.push(`<tr class="border-b border-gray-800 last:border-0"><td class="px-4 py-3 text-white font-mono text-xs">${escape_html(name)}</td><td class="px-4 py-3"><span${attr_class(`px-2 py-1 rounded text-xs font-medium ${stringify(target.circuitState === "closed" ? "bg-green-900 text-green-300" : target.circuitState === "open" ? "bg-red-900 text-red-300" : "bg-yellow-900 text-yellow-300")}`)}>${escape_html(target.circuitState)}</span></td><td class="px-4 py-3 text-gray-300">${escape_html(target.healthSnapshot?.errorRate !== void 0 ? `${(target.healthSnapshot.errorRate * 100).toFixed(1)}%` : "-")}</td><td class="px-4 py-3 text-gray-300">${escape_html(target.healthSnapshot?.recoveryScore !== void 0 ? `${(target.healthSnapshot.recoveryScore * 100).toFixed(0)}%` : "-")}</td></tr>`);
        }
        $$renderer2.push(`<!--]--></tbody></table></div></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]-->`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center"><p class="text-gray-400">Failed to load routing health data.</p></div>`);
    }
    $$renderer2.push(`<!--]--></main>`);
  });
}
export {
  _page as default
};
