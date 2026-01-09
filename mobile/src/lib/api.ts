import { Note } from "../types/note";

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiBaseUrl) {
  throw new Error("Missing `EXPO_PUBLIC_API_URL` in environment.");
}

function toUrl(path: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : "/" + path}`;
}

async function parseErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let detail = text;
  try {
    const json = JSON.parse(text) as { detail?: string };
    detail = json.detail ?? text;
  } catch {
    // ignore
  }
  return detail || `HTTP ${res.status}`;
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
    throw new Error(await parseErrorDetail(res));
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

function parseSseEvent(raw: string): { event: string; data: string } | null {
  const lines = raw.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length && event === "message") return null;
  return { event, data: dataLines.join("\n") };
}

function getStringField(value: unknown, key: "text" | "message"): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const field = record[key];
  return typeof field === "string" ? field : null;
}

export async function generateContinuationStream(
  token: string,
  body: { content: string; cursor: number },
  opts: { signal?: AbortSignal; onChunk: (text: string) => void }
): Promise<void> {
  const res = await fetch(toUrl("/ai/generate/stream"), {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(await parseErrorDetail(res));
  }

  if (!res.body) {
    const fallback = await generateContinuation(token, body, opts.signal);
    if (fallback?.suggestion) opts.onChunk(fallback.suggestion);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abortHandler = () => {
    reader.cancel().catch(() => undefined);
  };
  opts.signal?.addEventListener("abort", abortHandler);

  try {
    while (true) {
      if (opts.signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsed = parseSseEvent(rawEvent);
        if (parsed) {
          if (parsed.event === "done") return;
          let payload: unknown = parsed.data;
          if (parsed.data) {
            try {
              payload = JSON.parse(parsed.data) as unknown;
            } catch {
              payload = parsed.data;
            }
          }
          if (parsed.event === "error") {
            const message = getStringField(payload, "message") ?? (parsed.data ? parsed.data : "Erreur de génération.");
            throw new Error(message);
          }
          const text = getStringField(payload, "text") ?? (typeof payload === "string" ? payload : "");
          if (text) opts.onChunk(text);
        }
        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    opts.signal?.removeEventListener("abort", abortHandler);
  }
}
