import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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

// Store active sessions (server + transport pairs) for stateful mode
const sessions = new Map<
  string,
  { server: McpServer; transport: StreamableHTTPServerTransport }
>();

/**
 * Creates a new McpServer with all tools registered and connects it to the transport.
 */
async function createConnectedServer(
  transport: StreamableHTTPServerTransport,
): Promise<McpServer> {
  const server = new McpServer(
    {
      name: env.MCP_SERVER_NAME,
      version: env.MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        extensions: {
          "ai.promptopinion/fhir-context": {
            scopes: [
              { name: "patient/Patient.rs", required: true },
              { name: "offline_access" },
              { name: "patient/Observation.rs" },
              { name: "patient/MedicationStatement.rs" },
              { name: "patient/Condition.rs" },
            ],
          },
        },
      },
    },
  );

  registerTools(server, logger.child({ component: "tools" }));
  await server.connect(transport);
  return server;
}

// ---------------------------------------------------------------------------
// HTTP mode: StreamableHTTPServerTransport (for Render / Claude remote)
// ---------------------------------------------------------------------------

async function startHttpServer(): Promise<void> {
  httpServer = http.createServer(async (req, res) => {
    // CORS headers for browser-based MCP clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, mcp-session-id, mcp-protocol-version",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check for Render
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          server: env.MCP_SERVER_NAME,
          version: env.MCP_SERVER_VERSION,
          transport: "streamable-http",
          activeSessions: sessions.size,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // Root — server info
    if (req.url === "/" && req.method === "GET") {
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

    // MCP endpoint — this is what Claude connects to
    if (req.url === "/mcp") {
      // Check for existing session
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const session = sessionId ? sessions.get(sessionId) : undefined;

      if (session) {
        // Existing session — route to its transport
        await session.transport.handleRequest(req, res);
        return;
      }

      // No existing session — create a new one with session management
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          sessions.delete(sid);
          logger.info("Session closed", { sessionId: sid });
        }
      };

      const server = await createConnectedServer(transport);

      // Handle the request (this will be the initialize request)
      await transport.handleRequest(req, res);

      // Store the session for subsequent requests
      const newSessionId = transport.sessionId;
      if (newSessionId) {
        sessions.set(newSessionId, { server, transport });
        logger.info("New MCP session created", { sessionId: newSessionId });
      }

      return;
    }

    // Serve favicon for Claude Desktop and browsers
    if (req.url?.startsWith("/favicon.ico")) {
      try {
        const logoPath = path.join(process.cwd(), "assets", "logo.png");
        const logo = fs.readFileSync(logoPath);
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        });
        res.end(logo);
      } catch (err) {
        res.writeHead(404);
        res.end();
      }
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
  const server = new McpServer(
    {
      name: env.MCP_SERVER_NAME,
      version: env.MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        extensions: {
          "ai.promptopinion/fhir-context": {
            scopes: [
              { name: "patient/Patient.rs", required: true },
              { name: "offline_access" },
              { name: "patient/Observation.rs" },
              { name: "patient/MedicationStatement.rs" },
              { name: "patient/Condition.rs" },
            ],
          },
        },
      },
    },
  );

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
    // Close all active sessions
    for (const [sid, session] of sessions) {
      await session.transport.close();
      await session.server.close();
      logger.info("Session cleaned up", { sessionId: sid });
    }
    sessions.clear();

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
