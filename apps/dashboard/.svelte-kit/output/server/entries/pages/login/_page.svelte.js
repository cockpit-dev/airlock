import { c as attr, g as escape_html } from "../../../chunks/attributes.js";
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let url = "";
    let token = "";
    let loading = false;
    $$renderer2.push(`<div class="min-h-screen bg-gray-950 flex items-center justify-center"><div class="bg-gray-900 rounded-lg p-8 w-full max-w-md border border-gray-800"><h1 class="text-2xl font-bold text-white mb-6">Airlock Dashboard</h1> <form class="space-y-4"><div><label for="url" class="block text-sm font-medium text-gray-300 mb-1">Gateway URL</label> <input id="url" type="url"${attr("value", url)} placeholder="https://your-gateway.workers.dev" required="" class="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"/></div> <div><label for="token" class="block text-sm font-medium text-gray-300 mb-1">Admin Token</label> <input id="token" type="password"${attr("value", token)} placeholder="Bearer token" required="" class="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"/></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <button type="submit"${attr("disabled", loading, true)} class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-md transition-colors">${escape_html("Connect")}</button></form></div></div>`);
  });
}
export {
  _page as default
};
