import { G as ensure_array_like, P as stringify, z as attr_class, F as derived } from "../../../chunks/renderer.js";
import { N as Nav } from "../../../chunks/Nav.js";
import { g as escape_html, c as attr } from "../../../chunks/attributes.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    let keys = derived(() => Array.isArray(data.keys) ? data.keys : data.keys && typeof data.keys === "object" && "keys" in data.keys ? data.keys.keys : []);
    Nav($$renderer2);
    $$renderer2.push(`<!----> <main class="max-w-7xl mx-auto px-6 py-8"><div class="flex items-center justify-between mb-6"><h2 class="text-xl font-bold text-gray-100">Gateway Keys</h2> <button class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-md transition-colors">${escape_html("Create Key")}</button></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (keys().length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"><table class="w-full text-sm"><thead><tr class="border-b border-gray-800 text-gray-400 text-left"><th class="px-4 py-3">ID</th><th class="px-4 py-3">Label</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Actions</th></tr></thead><tbody><!--[-->`);
      const each_array = ensure_array_like(keys());
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let key = each_array[$$index];
        const k = key;
        const status = k.lifecycleStatus ?? k.status ?? "active";
        $$renderer2.push(`<tr class="border-b border-gray-800 last:border-0"><td class="px-4 py-3"><a${attr("href", `/keys/${stringify(k.id)}`)} class="text-blue-400 hover:text-blue-300 font-mono text-xs">${escape_html(k.id)}</a></td><td class="px-4 py-3 text-gray-300">${escape_html(k.label ?? "-")}</td><td class="px-4 py-3"><span${attr_class(`px-2 py-1 rounded text-xs font-medium ${stringify(status === "active" ? "bg-green-900 text-green-300" : status === "archived" ? "bg-gray-800 text-gray-400" : "bg-yellow-900 text-yellow-300")}`)}>${escape_html(status)}</span></td><td class="px-4 py-3"><div class="flex gap-2">`);
        if (status !== "archived") {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<button class="text-gray-400 hover:text-yellow-300 text-xs">Archive</button>`);
        } else {
          $$renderer2.push("<!--[-1-->");
          $$renderer2.push(`<button class="text-gray-400 hover:text-green-300 text-xs">Restore</button>`);
        }
        $$renderer2.push(`<!--]--> <button class="text-gray-400 hover:text-red-300 text-xs">Delete</button></div></td></tr>`);
      }
      $$renderer2.push(`<!--]--></tbody></table></div>`);
    } else if (data.keys) {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center"><p class="text-gray-400">No keys found.</p></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center"><p class="text-gray-400">Failed to load keys.</p></div>`);
    }
    $$renderer2.push(`<!--]--></main>`);
  });
}
export {
  _page as default
};
