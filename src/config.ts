import path from "node:path";

function int(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: int(process.env.PORT, 3000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://impostor:impostor@localhost:5432/impostor",
  uploadsDir: path.resolve(process.env.UPLOADS_DIR ?? "uploads"),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  maxAvatarBytes: int(process.env.MAX_AVATAR_BYTES, 5 * 1024 * 1024),
  maxAudioBytes: int(process.env.MAX_AUDIO_BYTES, 3 * 1024 * 1024),
  roomIdleMinutes: int(process.env.ROOM_IDLE_MINUTES, 30),
};
