import { Note } from "../types/note";

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiBaseUrl) {
  throw new Error("Missing `EXPO_PUBLIC_API_URL` in environment.");
}

function toUrl(path: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : "/" + path}`;
}

async function request<T>(path: string, opts: { token: string; method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(toUrl(path), {
    method: opts.method ?? "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${opts.token}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const json = JSON.parse(text) as { detail?: string };
      detail = json.detail ?? text;
    } catch {
      // ignore
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function listNotes(token: string): Promise<Note[]> {
  return request<Note[]>("/notes", { token });
}

export async function createNote(token: string, body: { title?: string; content?: string }): Promise<Note> {
  return request<Note>("/notes", { token, method: "POST", body });
}

export async function updateNote(
  token: string,
  noteId: string,
  body: { title?: string; content?: string },
  signal?: AbortSignal
): Promise<Note> {
  return request<Note>(`/notes/${encodeURIComponent(noteId)}`, { token, method: "PATCH", body, signal });
}

export async function deleteNote(token: string, noteId: string): Promise<void> {
  await request(`/notes/${encodeURIComponent(noteId)}`, { token, method: "DELETE" });
}

export async function generateContinuation(
  token: string,
  body: { content: string; cursor: number },
  signal?: AbortSignal
): Promise<{ suggestion: string }> {
  return request<{ suggestion: string }>("/ai/generate", { token, method: "POST", body, signal });
}
