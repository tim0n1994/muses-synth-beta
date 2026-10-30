import type { Readable } from "node:stream";

/** A trusted password manager may pipe a session token; never accept argv/env secrets. */
export async function readSessionToken(
  input: Readable & { isTTY?: boolean } = process.stdin,
): Promise<string> {
  if (input.isTTY) {
    throw new Error(
      "--token-stdin requires a pipe; terminal input is refused.",
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size > 8192) throw new Error("Token input is too large.");
      chunks.push(bytes);
    }
    const token = Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r?\n$/u, "");
    if (!/^[A-Za-z0-9._~+\/-]+=*$/u.test(token)) {
      throw new Error("Invalid token input.");
    }
    return token;
  } catch {
    throw new Error(
      "Cannot read session token; supply one token via a trusted pipe.",
    );
  }
}

/** Probe the actual collection API, without persisting or displaying its body. */
export async function verifyCollectionAccess(
  serverUrl: string,
  token?: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${serverUrl.replace(/\/$/u, "")}/api/v1/context/events?limit=1`,
      {
        headers:
          token === undefined ? {} : { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    await response.body?.cancel();
  } catch {
    throw new Error(
      "Cannot verify collection access; watcher was not started.",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Collection requires a valid session token via --token-stdin; watcher was not started.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Collection preflight failed (HTTP ${response.status}); watcher was not started.`,
    );
}
