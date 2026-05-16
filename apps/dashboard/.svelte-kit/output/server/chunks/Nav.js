import { F as derived } from "./renderer.js";
import { g as getStoredCredentials } from "./auth.js";
import { g as escape_html } from "./attributes.js";
function Nav($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const creds = derived(getStoredCredentials);
    $$renderer2.push(`<nav class="bg-gray-900 text-white px-6 py-3 flex items-center justify-between"><div class="flex items-center gap-6"><a href="/" class="font-bold text-lg tracking-tight">Airlock</a> <div class="flex gap-4 text-sm"><a href="/" class="hover:text-gray-300">Dashboard</a> <a href="/keys" class="hover:text-gray-300">Keys</a> <a href="/routes" class="hover:text-gray-300">Routes</a> <a href="/config" class="hover:text-gray-300">Config</a></div></div> <div class="flex items-center gap-4 text-sm text-gray-400">`);
    if (creds()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="truncate max-w-48">${escape_html(creds().url)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <button class="hover:text-white">Logout</button></div></nav>`);
  });
}
export {
  Nav as N
};
