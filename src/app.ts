import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { config } from "./config.js";
import { publicCategories } from "./catalog.js";
import { adminRoutes } from "./admin.js";
import type { RoomManager } from "./game/manager.js";
import type { PlayerRow } from "./db.js";
import {
  createPlayer,
  findByToken,
  leaderboard,
  publicPlayer,
  recentGames,
  updatePlayer,
} from "./players.js";

const imageTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const audioExtensions = new Set(["m4a", "aac", "mp4", "mp3", "ogg", "opus", "webm", "wav"]);

const nameSchema = z
  .string()
  .trim()
  .min(2, "Le nom doit contenir au moins 2 caractères")
  .max(20, "Le nom doit contenir au plus 20 caractères");

declare module "fastify" {
  interface FastifyRequest {
    player?: PlayerRow;
  }
}

export async function buildApp(getManager: () => RoomManager | null) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true });

  await fs.mkdir(path.join(config.uploadsDir, "avatars"), { recursive: true });
  await fs.mkdir(path.join(config.uploadsDir, "audio"), { recursive: true });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { files: 1, fileSize: Math.max(config.maxAvatarBytes, config.maxAudioBytes) } });
  await app.register(fastifyStatic, {
    root: config.uploadsDir,
    prefix: "/uploads/",
    maxAge: "7d",
    immutable: true,
  });

  await app.register(fastifyStatic, {
    root: config.adminDir,
    prefix: "/admin/",
    decorateReply: false,
    index: ["index.html"],
  });
  app.get("/admin", async (_req, reply) => reply.redirect("/admin/"));

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: "invalid", message: err.issues[0]?.message ?? "Données invalides" });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: status >= 500 ? "server_error" : "request_error", message: status >= 500 ? "Erreur du serveur" : err.message });
  });

  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const player = await findByToken(token);
    if (!player) return reply.code(401).send({ error: "unauthorized", message: "Profil introuvable" });
    req.player = player;
  };

  const saveUpload = async (req: FastifyRequest, folder: "avatars" | "audio") => {
    const file = await req.file();
    if (!file) throw Object.assign(new Error("Aucun fichier reçu"), { statusCode: 400 });
    let ext: string | undefined;
    if (folder === "avatars") {
      ext = imageTypes[file.mimetype];
    } else {
      const fromName = path.extname(file.filename ?? "").slice(1).toLowerCase();
      ext = audioExtensions.has(fromName) ? fromName : undefined;
      if (!ext && file.mimetype.startsWith("audio/")) ext = "m4a";
    }
    if (!ext) {
      file.file.resume();
      throw Object.assign(new Error("Format de fichier non pris en charge"), { statusCode: 415 });
    }
    const limit = folder === "avatars" ? config.maxAvatarBytes : config.maxAudioBytes;
    const name = `${crypto.randomUUID()}.${ext}`;
    const target = path.join(config.uploadsDir, folder, name);
    await pipeline(file.file, createWriteStream(target));
    const stat = await fs.stat(target);
    if (file.file.truncated || stat.size > limit) {
      await fs.rm(target, { force: true });
      throw Object.assign(new Error("Fichier trop volumineux"), { statusCode: 413 });
    }
    return `/uploads/${folder}/${name}`;
  };

  const syncRoomProfile = (row: PlayerRow) => {
    getManager()?.updateProfile({ id: row.id, name: row.name, avatarUrl: row.avatar_path });
  };

  await adminRoutes(app);

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/categories", async () => publicCategories());

  app.post(
    "/api/players",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z.object({ name: nameSchema }).parse(req.body);
      const { player, token } = await createPlayer(body.name);
      reply.code(201).send({ player: publicPlayer(player), token });
    },
  );

  app.get("/api/players/me", { preHandler: auth }, async (req) => publicPlayer(req.player!));

  app.patch("/api/players/me", { preHandler: auth }, async (req) => {
    const body = z.object({ name: nameSchema }).parse(req.body);
    const row = await updatePlayer(req.player!.id, { name: body.name });
    syncRoomProfile(row);
    return publicPlayer(row);
  });

  app.post(
    "/api/players/me/avatar",
    { preHandler: auth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const url = await saveUpload(req, "avatars");
      const previous = req.player!.avatar_path;
      const row = await updatePlayer(req.player!.id, { avatarPath: url });
      if (previous?.startsWith("/uploads/avatars/")) {
        await fs.rm(path.join(config.uploadsDir, "avatars", path.basename(previous)), { force: true });
      }
      syncRoomProfile(row);
      return publicPlayer(row);
    },
  );

  app.get("/api/players/me/games", { preHandler: auth }, async (req) => {
    const rows = await recentGames(req.player!.id);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      rounds: r.rounds,
      finishedAt: r.finished_at,
      score: r.score,
      rank: r.rank,
      players: r.players,
    }));
  });

  app.get("/api/leaderboard", async () => leaderboard());

  app.post(
    "/api/audio",
    { preHandler: auth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const url = await saveUpload(req, "audio");
      reply.code(201).send({ audioUrl: url });
    },
  );

  app.get("/api/rooms/:code", { preHandler: auth }, async (req, reply) => {
    const { code } = z.object({ code: z.string().trim().min(4).max(8) }).parse(req.params);
    const room = getManager()?.get(code);
    if (!room) return reply.code(404).send({ error: "room_not_found", message: "Aucune partie avec ce code" });
    return {
      code: room.code,
      phase: room.phase,
      players: room.members.size,
      canJoin: room.phase === "lobby" || room.members.has(req.player!.id),
    };
  });

  return app;
}
