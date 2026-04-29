import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { env } from "./config/env";
import { Logger } from "./logging/logger";
import { registerTools } from "./tools/registerTools";

const logger = new Logger(env.LOG_LEVEL, {
  service: env.MCP_SERVER_NAME,
  version: env.MCP_SERVER_VERSION,
  environment: env.NODE_ENV,
});

let shuttingDown = false;
let httpServer: http.Server | undefined;

// ---------------------------------------------------------------------------
// HTTP mode: StreamableHTTPServerTransport + health check (for Railway / Claude)
// ---------------------------------------------------------------------------

async function startHttpServer(): Promise<void> {
  const server = new McpServer({
    name: env.MCP_SERVER_NAME,
    version: env.MCP_SERVER_VERSION,
  });

  registerTools(server, logger.child({ component: "tools" }));

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  httpServer = http.createServer(async (req, res) => {
    // CORS headers for browser-based MCP clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check for Railway
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          server: env.MCP_SERVER_NAME,
          version: env.MCP_SERVER_VERSION,
          transport: "streamable-http",
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // MCP endpoint — this is what Claude connects to
    if (req.url === "/mcp") {
      await transport.handleRequest(req, res);
      return;
    }

    // Root — server info
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          name: env.MCP_SERVER_NAME,
          version: env.MCP_SERVER_VERSION,
          transport: "streamable-http",
          mcpEndpoint: "/mcp",
          healthEndpoint: "/health",
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(env.PORT, () => {
    logger.info(
      `MediGuard MCP server started (http) on port ${env.PORT} — MCP endpoint: /mcp`,
    );
  });
}

// ---------------------------------------------------------------------------
// Stdio mode: for local MCP clients (Claude Desktop, Cursor, etc.)
// ---------------------------------------------------------------------------

async function startStdioServer(): Promise<void> {
  const server = new McpServer({
    name: env.MCP_SERVER_NAME,
    version: env.MCP_SERVER_VERSION,
  });

  registerTools(server, logger.child({ component: "tools" }));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MediGuard MCP server started (stdio)");
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function startServer(): Promise<void> {
  try {
    if (env.MCP_TRANSPORT === "http") {
      await startHttpServer();
    } else {
      await startStdioServer();
    }
  } catch (error) {
    handleFatalError(error, "startup");
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("Shutdown signal received", { signal });

  try {
    httpServer?.close();
    logger.info("MediGuard MCP server stopped gracefully");
    process.exit(0);
  } catch (error) {
    logger.error("Failed to close server cleanly", {
      signal,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

function handleFatalError(error: unknown, origin: string): void {
  logger.error("Fatal process error", {
    origin,
    error: error instanceof Error ? error.message : String(error),
  });

  process.exit(1);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  handleFatalError(error, "uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  handleFatalError(reason, "unhandledRejection");
});

void startServer();
