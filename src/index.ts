import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrate, sql, waitForDatabase } from "./db.js";
import type { RoomManager } from "./game/manager.js";
import { createSocketServer } from "./socket.js";

async function main() {
  await waitForDatabase();
  await migrate();

  let manager: RoomManager | null = null;
  const app = await buildApp(() => manager);
  const sockets = createSocketServer(app.server, app.log);
  manager = sockets.manager;

  await app.listen({ port: config.port, host: config.host });

  const shutdown = async () => {
    sockets.io.close();
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
