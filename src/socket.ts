import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { config } from "./config.js";
import { RoomManager } from "./game/manager.js";
import { GameError, type Room } from "./game/room.js";
import { findById, findByToken, recordGame } from "./players.js";

const DISCONNECT_GRACE_MS = 8000;

const schemas = {
  empty: z.object({}).passthrough(),
  join: z.object({ code: z.string().trim().min(4).max(8) }),
  kick: z.object({ playerId: z.string().uuid() }),
  settings: z.object({
    rounds: z.number().int().optional(),
    clueTurns: z.number().int().optional(),
    category: z.string().optional(),
    turnSeconds: z.number().int().optional(),
    voteSeconds: z.number().int().optional(),
    imposterSeesCategory: z.boolean().optional(),
  }),
  clue: z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string().max(200) }),
    z.object({ type: z.literal("audio"), audioUrl: z.string().max(200), durationMs: z.number().int().min(0) }),
  ]),
  vote: z.object({ targetId: z.string().uuid() }),
  guess: z.object({ guess: z.string().max(100) }),
};

type Ack = (response: { ok: boolean; data?: unknown; error?: { code: string; message: string } }) => void;

export function createSocketServer(http: HttpServer, log: { error: (obj: unknown, msg?: string) => void }) {
  const io = new Server(http, {
    cors: { origin: config.corsOrigin },
    pingInterval: 15000,
    pingTimeout: 20000,
    maxHttpBufferSize: 64 * 1024,
  });

  const broadcast = (room: Room) => {
    for (const id of room.members.keys()) {
      if (manager.roomOf(id) === room) io.to(`player:${id}`).emit("room:state", room.view(id));
    }
  };

  const manager = new RoomManager({
    changed: broadcast,
    finished: (room) => {
      recordGame({
        code: room.code,
        rounds: room.history.length,
        startedAt: room.startedAt,
        ranking: room.ranking(),
      }).catch((err) => log.error(err, "record game failed"));
    },
    removed: (playerId, code) => io.to(`player:${playerId}`).emit("room:left", { code }),
  });

  setInterval(() => manager.sweep(config.roomIdleMinutes * 60 * 1000), 60 * 1000).unref();

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? undefined;
      const player = await findByToken(token);
      if (!player) return next(new Error("unauthorized"));
      socket.data.playerId = player.id;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on("connection", (socket: Socket) => {
    const playerId = socket.data.playerId as string;
    socket.join(`player:${playerId}`);

    const profile = async () => {
      const row = await findById(playerId);
      if (!row) throw new GameError("unauthorized", "Profil introuvable");
      return { id: row.id, name: row.name, avatarUrl: row.avatar_path };
    };

    const current = manager.roomOf(playerId);
    if (current && current.members.has(playerId)) {
      const wasConnected = current.members.get(playerId)!.connected;
      if (!wasConnected) manager.setConnected(playerId, true);
      else socket.emit("room:state", current.view(playerId));
    } else {
      socket.emit("room:none");
    }

    const handle = <S extends z.ZodTypeAny>(
      event: string,
      schema: S,
      fn: (data: z.infer<S>) => unknown | Promise<unknown>,
    ) => {
      socket.on(event, async (payload: unknown, ack?: Ack) => {
        const reply: Ack = typeof ack === "function" ? ack : () => {};
        try {
          const data = schema.parse(payload ?? {});
          const result = await fn(data);
          reply({ ok: true, data: result ?? null });
        } catch (err) {
          if (err instanceof GameError) reply({ ok: false, error: { code: err.code, message: err.message } });
          else if (err instanceof z.ZodError) reply({ ok: false, error: { code: "invalid", message: "Données invalides" } });
          else {
            log.error(err, `socket ${event} failed`);
            reply({ ok: false, error: { code: "server_error", message: "Erreur du serveur" } });
          }
        }
      });
    };

    const myRoom = () => {
      const room = manager.roomOf(playerId);
      if (!room) throw new GameError("no_room", "Vous n'êtes dans aucune partie");
      return room;
    };

    const act = (fn: (room: Room) => void) => {
      const room = myRoom();
      manager.mutate(room, () => fn(room));
      return null;
    };

    handle("room:create", schemas.settings, async (settings) => {
      const room = manager.create(await profile());
      if (Object.keys(settings).length) manager.mutate(room, () => room.updateSettings(playerId, settings));
      return { code: room.code };
    });

    handle("room:join", schemas.join, async ({ code }) => {
      const room = manager.join(code, await profile());
      return { code: room.code };
    });

    handle("room:leave", schemas.empty, () => {
      manager.leave(playerId);
      return null;
    });

    handle("room:sync", schemas.empty, () => {
      const room = manager.roomOf(playerId);
      return room ? room.view(playerId) : null;
    });

    handle("room:settings", schemas.settings, (patch) => act((room) => room.updateSettings(playerId, patch)));
    handle("room:kick", schemas.kick, ({ playerId: target }) => {
      manager.kick(myRoom(), playerId, target);
      return null;
    });
    handle("game:start", schemas.empty, () => act((room) => room.start(playerId)));
    handle("game:seen", schemas.empty, () => act((room) => room.markSeen(playerId)));
    handle("game:clue", schemas.clue, (clue) => act((room) => room.submitClue(playerId, clue)));
    handle("game:vote", schemas.vote, ({ targetId }) => act((room) => room.vote(playerId, targetId)));
    handle("game:guess", schemas.guess, ({ guess }) => act((room) => room.submitGuess(playerId, guess)));
    handle("game:next", schemas.empty, () => act((room) => room.nextRound(playerId)));
    handle("game:restart", schemas.empty, () => act((room) => room.restart(playerId)));

    socket.on("disconnect", () => {
      setTimeout(async () => {
        const sockets = await io.in(`player:${playerId}`).fetchSockets();
        if (sockets.length === 0) manager.setConnected(playerId, false);
      }, DISCONNECT_GRACE_MS);
    });
  });

  return { io, manager };
}
