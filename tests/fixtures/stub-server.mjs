#!/usr/bin/env node
import http from "node:http";

const host = process.env.MUSES_HOST ?? process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.MUSES_PORT ?? process.env.PORT ?? "43119");
let sequence = 0;

function meta() {
  return {
    requestId: `req_stub_${sequence + 1}`,
    timestamp: new Date().toISOString(),
    schemaVersion: "0.1",
  };
}

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/v0/health") {
    send(response, 200, {
      ok: true,
      data: {
        status: "ok",
        version: "0.1.0",
        database: { status: "ready", journalMode: "wal" },
      },
      meta: meta(),
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v0/events") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        const event = JSON.parse(body);
        sequence += 1;
        send(response, 202, {
          ok: true,
          data: { accepted: true, eventId: event.eventId, sequence },
          meta: meta(),
        });
      } catch {
        send(response, 400, {
          ok: false,
          error: { code: "INVALID_JSON", message: "Malformed JSON body." },
          meta: meta(),
        });
      }
    });
    return;
  }
  send(response, 404, {
    ok: false,
    error: { code: "NOT_FOUND", message: "Fixture route not found." },
    meta: meta(),
  });
});

server.listen(port, host, () =>
  process.stdout.write(`stub listening on http://${host}:${port}\n`),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
