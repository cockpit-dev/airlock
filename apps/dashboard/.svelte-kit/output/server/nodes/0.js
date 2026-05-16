import * as universal from '../entries/pages/_layout.ts.js';

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export { universal };
export const universal_id = "src/routes/+layout.ts";
export const imports = ["_app/immutable/nodes/0.Chn4NoY8.js","_app/immutable/chunks/OA8UcISh.js","_app/immutable/chunks/CUx6HUEU.js","_app/immutable/chunks/BYaFANky.js","_app/immutable/chunks/CuEjKckK.js","_app/immutable/chunks/U8WNgKPc.js"];
export const stylesheets = ["_app/immutable/assets/0.CDOOe26f.css"];
export const fonts = [];
