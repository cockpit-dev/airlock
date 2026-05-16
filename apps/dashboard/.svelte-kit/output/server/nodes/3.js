import * as universal from '../entries/pages/config/_page.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/config/_page.svelte.js')).default;
export { universal };
export const universal_id = "src/routes/config/+page.ts";
export const imports = ["_app/immutable/nodes/3.C7_VdOK-.js","_app/immutable/chunks/CUx6HUEU.js","_app/immutable/chunks/BYaFANky.js","_app/immutable/chunks/CuEjKckK.js","_app/immutable/chunks/C2oeYjwm.js","_app/immutable/chunks/BPhiFkm4.js","_app/immutable/chunks/U8WNgKPc.js","_app/immutable/chunks/6qBJhGGY.js"];
export const stylesheets = [];
export const fonts = [];
