"use client";

import { useState } from "react";

export interface Endpoint {
  method: "GET" | "POST";
  path: string;
  summary: string;
  body?: Record<string, unknown>;
}

/** A request runner wired to this deployment, so the docs are always truthful. */
export function Playground({ endpoints }: { endpoints: Endpoint[] }) {
  const [selected, setSelected] = useState(0);
  const endpoint = endpoints[selected];
  const [body, setBody] = useState(() => JSON.stringify(endpoint.body ?? {}, null, 2));
  const [response, setResponse] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (index: number) => {
    setSelected(index);
    setBody(JSON.stringify(endpoints[index].body ?? {}, null, 2));
    setResponse(null);
    setStatus(null);
  };

  const send = async () => {
    setBusy(true);
    setResponse(null);
    try {
      const init: RequestInit = { method: endpoint.method, cache: "no-store" };
      if (endpoint.method === "POST") {
        init.headers = { "content-type": "application/json" };
        init.body = body.trim() || "{}";
      }
      const result = await fetch(endpoint.path, init);
      setStatus(result.status);
      setResponse(JSON.stringify(await result.json(), null, 2));
    } catch (error) {
      setStatus(null);
      setResponse(`// request failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel overflow-hidden">
      <div className="scroll-x border-b border-[var(--color-line)]">
        <div className="flex min-w-max">
          {endpoints.map((item, index) => (
            <button
              key={`${item.method}-${item.path}`}
              type="button"
              onClick={() => pick(index)}
              className={`num whitespace-nowrap border-b-2 px-4 py-3 text-xs transition-colors ${
                index === selected
                  ? "border-[var(--color-mint-400)] text-[var(--color-mist-100)]"
                  : "border-transparent text-[var(--color-mist-600)] hover:text-[var(--color-mist-300)]"
              }`}
            >
              <span
                className={item.method === "GET" ? "text-[var(--color-mint-300)]" : "text-[var(--color-flame-400)]"}
              >
                {item.method}
              </span>{" "}
              {item.path.replace("/api/v1", "")}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        <p className="text-sm text-[var(--color-mist-300)]">{endpoint.summary}</p>

        {endpoint.method === "POST" && (
          <>
            <p className="eyebrow mt-5 mb-2">Request body</p>
            <textarea
              className="textarea h-40"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              spellCheck={false}
            />
          </>
        )}

        <button type="button" className="btn btn-mint mt-4" disabled={busy} onClick={send}>
          {busy ? "Sending…" : `Send ${endpoint.method}`}
        </button>

        {response && (
          <>
            <div className="mt-6 mb-2 flex items-center gap-2">
              <p className="eyebrow">Response</p>
              {status !== null && (
                <span className={`badge ${status < 400 ? "badge-mint" : "badge-bad"}`}>{status}</span>
              )}
            </div>
            <div className="scroll-x max-h-96 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-900)]">
              <pre className="num p-4 text-[11px] leading-relaxed text-[var(--color-mist-300)]">
                {response}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
