/** Saved views store a list page's filters as a query string. Only known filters are kept. */

export const VIEW_MODULES = {
  leads: { path: "/leads", params: ["q", "status", "ownerId", "sdrId"] },
} as const;

export type ViewModule = keyof typeof VIEW_MODULES;

export const isViewModule = (m: unknown): m is ViewModule => typeof m === "string" && m in VIEW_MODULES;

/** Keep only the module's filter params (non-empty), in a stable order. */
export function cleanViewQuery(module: ViewModule, query: string): string {
  const input = new URLSearchParams(query.replace(/^\?/, ""));
  const out = new URLSearchParams();
  for (const key of VIEW_MODULES[module].params) {
    const v = input.get(key)?.trim();
    if (v) out.set(key, v);
  }
  return out.toString();
}

export function viewHref(module: ViewModule, query: string) {
  return query ? `${VIEW_MODULES[module].path}?${query}` : VIEW_MODULES[module].path;
}
