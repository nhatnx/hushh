(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/lib/app-logic.js [app-client] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "static/chunks/lib_926f3234._.js",
  "static/chunks/lib_app-logic_18707e74.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/lib/app-logic.js [app-client] (ecmascript)");
    });
});
}),
"[project]/lib/analytics.js [app-client] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "static/chunks/lib_analytics_0da58432.js",
  "static/chunks/lib_analytics_18707e74.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/lib/analytics.js [app-client] (ecmascript)");
    });
});
}),
]);