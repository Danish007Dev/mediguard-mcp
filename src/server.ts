import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import http from "node:http";
import { env } from "./config/env";
import { Logger } from "./logging/logger";
import { registerTools } from "./tools/registerTools";

const logger = new Logger(env.LOG_LEVEL, {
  service: env.MCP_SERVER_NAME,
  version: env.MCP_SERVER_VERSION,
  environment: env.NODE_ENV,
});

const server = new McpServer({
  name: env.MCP_SERVER_NAME,
  version: env.MCP_SERVER_VERSION,
});

registerTools(server, logger.child({ component: "tools" }));

let shuttingDown = false;

// Health check server for Railway
const port = env.PORT;
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "healthy",
        server: env.MCP_SERVER_NAME,
        version: env.MCP_SERVER_VERSION,
        timestamp: new Date().toISOString(),
      }),
    );
  } else if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        name: env.MCP_SERVER_NAME,
        version: env.MCP_SERVER_VERSION,
        healthEndpoint: "/health",
      }),
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(port, () => {
  logger.info(`Health check server listening on port ${port}`);
});

async function startServer(): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("MediGuard MCP server started");
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
    healthServer.close();
    await server.close();
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
