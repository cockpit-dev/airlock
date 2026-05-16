import { G as ensure_array_like, z as attr_class, P as stringify } from "../../../chunks/renderer.js";
import { N as Nav } from "../../../chunks/Nav.js";
import { g as escape_html } from "../../../chunks/attributes.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    Nav($$renderer2);
    $$renderer2.push(`<!----> <main class="max-w-7xl mx-auto px-6 py-8"><h2 class="text-xl font-bold text-gray-100 mb-6">Configuration</h2> `);
    if (data.config) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="mb-8"><h3 class="text-lg font-semibold text-gray-200 mb-3">Providers</h3> <div class="grid grid-cols-1 md:grid-cols-3 gap-4"><!--[-->`);
      const each_array = ensure_array_like(Object.entries(data.config.providers));
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let [name, provider] = each_array[$$index];
        const p = provider;
        $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="font-medium text-white capitalize mb-1">${escape_html(name)}</p> `);
        if (p?.baseUrl) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<p class="text-sm text-gray-400 font-mono">${escape_html(p.baseUrl)}</p>`);
        } else {
          $$renderer2.push("<!--[-1-->");
          $$renderer2.push(`<p class="text-sm text-gray-500">Not configured</p>`);
        }
        $$renderer2.push(`<!--]--></div>`);
      }
      $$renderer2.push(`<!--]--></div></div> <div class="mb-8"><h3 class="text-lg font-semibold text-gray-200 mb-3">Routes (${escape_html(data.config.routes.length)})</h3> <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"><table class="w-full text-sm"><thead><tr class="border-b border-gray-800 text-gray-400 text-left"><th class="px-4 py-3">External Model</th><th class="px-4 py-3">Target</th><th class="px-4 py-3">Fallbacks</th><th class="px-4 py-3">Strategy</th></tr></thead><tbody><!--[-->`);
      const each_array_1 = ensure_array_like(data.config.routes);
      for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
        let route = each_array_1[$$index_1];
        $$renderer2.push(`<tr class="border-b border-gray-800 last:border-0"><td class="px-4 py-3 text-white font-medium">${escape_html(route.externalModel)}</td><td class="px-4 py-3 text-gray-300 font-mono text-xs">${escape_html(route.target.provider)}/${escape_html(route.target.providerModel)}</td><td class="px-4 py-3 text-gray-400">${escape_html(route.fallbacks?.length ?? 0)}</td><td class="px-4 py-3 text-gray-400">${escape_html(route.strategy ?? "default")}</td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div></div> <div class="mb-8"><h3 class="text-lg font-semibold text-gray-200 mb-3">Features</h3> <div class="grid grid-cols-2 md:grid-cols-5 gap-3"><!--[-->`);
      const each_array_2 = ensure_array_like(Object.entries(data.config.features));
      for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
        let [feature, enabled] = each_array_2[$$index_2];
        $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center justify-between"><span class="text-sm text-gray-300">${escape_html(feature)}</span> <span${attr_class(`w-3 h-3 rounded-full ${stringify(enabled ? "bg-green-500" : "bg-gray-700")}`)}></span></div>`);
      }
      $$renderer2.push(`<!--]--></div></div> <div><h3 class="text-lg font-semibold text-gray-200 mb-3">Limits</h3> <div class="grid grid-cols-2 md:grid-cols-3 gap-4"><!--[-->`);
      const each_array_3 = ensure_array_like(Object.entries(data.config.limits));
      for (let $$index_3 = 0, $$length = each_array_3.length; $$index_3 < $$length; $$index_3++) {
        let [name, value] = each_array_3[$$index_3];
        $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-4"><p class="text-sm text-gray-400">${escape_html(name)}</p> <p class="text-lg font-semibold text-white">${escape_html(value)}</p></div>`);
      }
      $$renderer2.push(`<!--]--></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center"><p class="text-gray-400">Failed to load configuration.</p></div>`);
    }
    $$renderer2.push(`<!--]--></main>`);
  });
}
export {
  _page as default
};
