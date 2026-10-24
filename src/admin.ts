import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { normalizeWord } from "./game/text.js";
import {
  addWords,
  adminCategories,
  createCategory,
  deleteCategory,
  deleteWord,
  stats,
  updateCategory,
  updateWord,
} from "./catalog.js";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function sign(value: string) {
  return crypto.createHmac("sha256", config.adminPassword).update(value).digest("base64url");
}

function issueToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return `${exp}.${sign(exp)}`;
}

function verifyToken(token: string) {
  const [exp, signature] = token.split(".");
  if (!exp || !signature || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function samePassword(given: string) {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

const text = (max: number) =>
  z.string({ error: "Champ obligatoire" }).trim().min(1, "Champ obligatoire").max(max, "Texte trop long");
const idParams = z.object({ id: z.string().uuid() });
const pairSchema = z
  .object({ word: text(60), similarWord: text(60) })
  .refine((p) => normalizeWord(p.word) !== normalizeWord(p.similarWord), {
    message: "Les deux mots d'une paire doivent être différents",
  });

export async function adminRoutes(app: FastifyInstance) {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!config.adminPassword) {
      return reply.code(503).send({ error: "admin_disabled", message: "Administration désactivée" });
    }
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!verifyToken(token)) return reply.code(401).send({ error: "unauthorized", message: "Session expirée" });
  };

  app.post(
    "/api/admin/login",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (req, reply) => {
      if (!config.adminPassword) {
        return reply.code(503).send({ error: "admin_disabled", message: "Administration désactivée" });
      }
      const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
      if (!samePassword(password)) {
        return reply.code(401).send({ error: "unauthorized", message: "Mot de passe incorrect" });
      }
      return { token: issueToken() };
    },
  );

  app.get("/api/admin/stats", { preHandler: guard }, async () => stats());

  app.get("/api/admin/categories", { preHandler: guard }, async () => adminCategories());

  app.post("/api/admin/categories", { preHandler: guard }, async (req, reply) => {
    const { name } = z.object({ name: text(40) }).parse(req.body);
    reply.code(201).send({ id: await createCategory(name) });
  });

  app.patch("/api/admin/categories/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ name: text(40).optional(), active: z.boolean().optional() }).parse(req.body);
    if (!(await updateCategory(id, body))) return reply.code(404).send({ error: "not_found", message: "Catégorie introuvable" });
    return { ok: true };
  });

  app.delete("/api/admin/categories/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    if (!(await deleteCategory(id))) return reply.code(404).send({ error: "not_found", message: "Catégorie introuvable" });
    return { ok: true };
  });

  app.post("/api/admin/categories/:id/words", { preHandler: guard }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { words } = z.object({ words: z.array(pairSchema).min(1).max(500) }).parse(req.body);
    const added = await addWords(id, words);
    if (added === null) return reply.code(404).send({ error: "not_found", message: "Catégorie introuvable" });
    reply.code(201).send({ added });
  });

  app.put("/api/admin/words/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = pairSchema.parse(req.body);
    if (!(await updateWord(id, body))) return reply.code(404).send({ error: "not_found", message: "Mot introuvable" });
    return { ok: true };
  });

  app.delete("/api/admin/words/:id", { preHandler: guard }, async (req, reply) => {
    const { id } = idParams.parse(req.params);
    if (!(await deleteWord(id))) return reply.code(404).send({ error: "not_found", message: "Mot introuvable" });
    return { ok: true };
  });
}
