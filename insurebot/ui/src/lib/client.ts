// Browser-side helper for the UI's own API. The custom header is part of the CSRF defence.
export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json", "x-lab-csrf": "1" } : { "x-lab-csrf": "1" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !(json && typeof json === "object" && "saved" in json)) {
    throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return json as T;
}
