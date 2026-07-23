module.exports = [
"[project]/lib/app-logic.js [app-ssr] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/ssr/lib_9ffef982._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/lib/app-logic.js [app-ssr] (ecmascript)");
    });
});
}),
"[project]/lib/analytics.js [app-ssr] (ecmascript, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "server/chunks/ssr/lib_analytics_2c9570a6.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/lib/analytics.js [app-ssr] (ecmascript)");
    });
});
}),
];