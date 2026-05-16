export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.BAq3n_Dg.js",app:"_app/immutable/entry/app.DETzXTUn.js",imports:["_app/immutable/entry/start.BAq3n_Dg.js","_app/immutable/chunks/CK0TEY_8.js","_app/immutable/chunks/CuEjKckK.js","_app/immutable/chunks/OA8UcISh.js","_app/immutable/chunks/fJtwMrQ7.js","_app/immutable/entry/app.DETzXTUn.js","_app/immutable/chunks/Dp1pzeXC.js","_app/immutable/chunks/CuEjKckK.js","_app/immutable/chunks/C2oeYjwm.js","_app/immutable/chunks/BYaFANky.js","_app/immutable/chunks/fJtwMrQ7.js","_app/immutable/chunks/BPhiFkm4.js","_app/immutable/chunks/U8WNgKPc.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('../output/server/nodes/0.js')),
			__memo(() => import('../output/server/nodes/1.js')),
			__memo(() => import('../output/server/nodes/2.js')),
			__memo(() => import('../output/server/nodes/3.js')),
			__memo(() => import('../output/server/nodes/4.js')),
			__memo(() => import('../output/server/nodes/5.js')),
			__memo(() => import('../output/server/nodes/6.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/config",
				pattern: /^\/config\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/keys",
				pattern: /^\/keys\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/login",
				pattern: /^\/login\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/routes",
				pattern: /^\/routes\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 6 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

export const prerendered = new Set([]);

export const base_path = "";
