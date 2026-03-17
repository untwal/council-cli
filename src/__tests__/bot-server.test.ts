import { describe, it, expect, afterEach } from "vitest";
import * as http from "http";
import { startServer, BotServerConfig } from "../bot/server";

const config: BotServerConfig = {
  port: 0,
  webhookSecret: "test-secret",
  githubToken: "test-token",
  botUsername: "test-bot",
  repoPath: "/tmp/test-repo",
};

function request(
  server: http.Server,
  method: string,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { host: "127.0.0.1", port: addr.port, method, path },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("GET /health", () => {
  let server: http.Server;

  afterEach(() => {
    server?.close();
  });

  it("responds 200 with JSON body containing status ok", async () => {
    server = startServer(config);
    await new Promise<void>((r) => server.once("listening", r));

    const { status, headers, body } = await request(server, "GET", "/health");

    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("application/json");

    const json = JSON.parse(body);
    expect(json.status).toBe("ok");
  });

  it("includes uptime as a non-negative integer", async () => {
    server = startServer(config);
    await new Promise<void>((r) => server.once("listening", r));

    const { body } = await request(server, "GET", "/health");
    const json = JSON.parse(body);

    expect(typeof json.uptime).toBe("number");
    expect(json.uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(json.uptime)).toBe(true);
  });

  it("includes a valid ISO 8601 timestamp", async () => {
    server = startServer(config);
    await new Promise<void>((r) => server.once("listening", r));

    const { body } = await request(server, "GET", "/health");
    const json = JSON.parse(body);

    expect(typeof json.timestamp).toBe("string");
    expect(new Date(json.timestamp).toISOString()).toBe(json.timestamp);
  });

  it("includes version string when package.json is available", async () => {
    server = startServer(config);
    await new Promise<void>((r) => server.once("listening", r));

    const { body } = await request(server, "GET", "/health");
    const json = JSON.parse(body);

    if ("version" in json) {
      expect(typeof json.version).toBe("string");
      expect(json.version.length).toBeGreaterThan(0);
    }
  });

  it("sets Cache-Control: no-cache", async () => {
    server = startServer(config);
    await new Promise<void>((r) => server.once("listening", r));

    const { headers } = await request(server, "GET", "/health");
    expect(headers["cache-control"]).toBe("no-cache");
  });
});

describe("POST /health", () => {
  let server: http.Server;

  afterEach(() => {
    server?.close();
  });

  it("responds 405 with Allow: GET header", async () => {
    server = startServer(config);
    await new Promise<void>((r) => server.once("listening", r));

    const { status, headers } = await request(server, "POST", "/health");

    expect(status).toBe(405);
    expect(headers["allow"]).toBe("GET");
  });
});

describe("/health/ trailing slash", () => {
  let server: http.Server;

  afterEach(() => {
    server?.close();
  });

  it("responds 404", async () => {
    server = startServer(config);
    await new Promise<void>((r) => server.once("listening", r));

    const { status } = await request(server, "GET", "/health/");
    expect(status).toBe(404);
  });
});
