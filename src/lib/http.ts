export async function json<T>(url: string, init?: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await fetch(url, { cache: "no-store", ...init });
  return { response, body: await response.json() as T };
}
