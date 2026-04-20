import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
