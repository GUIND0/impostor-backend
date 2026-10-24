import crypto from "node:crypto";
import { sql, type PlayerRow } from "./db.js";

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function publicPlayer(row: PlayerRow) {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_path,
    totalPoints: row.total_points,
    gamesPlayed: row.games_played,
    wins: row.wins,
    createdAt: row.created_at,
  };
}

export async function createPlayer(name: string) {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  const [row] = await sql<PlayerRow[]>`
    insert into players (id, name, token_hash)
    values (${id}, ${name}, ${hashToken(token)})
    returning id, name, avatar_path, total_points, games_played, wins, created_at`;
  return { player: row, token };
}

export async function findByToken(token: string | undefined | null) {
  if (!token) return null;
  const [row] = await sql<PlayerRow[]>`
    select id, name, avatar_path, total_points, games_played, wins, created_at
    from players where token_hash = ${hashToken(token)}`;
  return row ?? null;
}

export async function findById(id: string) {
  const [row] = await sql<PlayerRow[]>`
    select id, name, avatar_path, total_points, games_played, wins, created_at
    from players where id = ${id}`;
  return row ?? null;
}

export async function updatePlayer(id: string, data: { name?: string; avatarPath?: string | null }) {
  const [row] = await sql<PlayerRow[]>`
    update players set
      name = coalesce(${data.name ?? null}, name),
      avatar_path = ${data.avatarPath === undefined ? sql`avatar_path` : data.avatarPath},
      updated_at = now()
    where id = ${id}
    returning id, name, avatar_path, total_points, games_played, wins, created_at`;
  return row;
}

export async function recordGame(input: {
  code: string;
  rounds: number;
  startedAt: number | null;
  ranking: { playerId: string; score: number; rank: number }[];
}) {
  if (!input.ranking.length) return;
  const gameId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      insert into games (id, code, rounds, started_at)
      values (${gameId}, ${input.code}, ${input.rounds}, ${input.startedAt ? new Date(input.startedAt) : null})`;
    for (const r of input.ranking) {
      await tx`
        insert into game_players (game_id, player_id, score, rank)
        values (${gameId}, ${r.playerId}, ${r.score}, ${r.rank})`;
      await tx`
        update players set
          total_points = total_points + ${r.score},
          games_played = games_played + 1,
          wins = wins + ${r.rank === 1 ? 1 : 0}
        where id = ${r.playerId}`;
    }
  });
}

export async function leaderboard(limit = 50) {
  const rows = await sql<PlayerRow[]>`
    select id, name, avatar_path, total_points, games_played, wins, created_at
    from players where games_played > 0
    order by total_points desc, wins desc, created_at asc
    limit ${limit}`;
  return rows.map(publicPlayer);
}

export async function recentGames(playerId: string, limit = 20) {
  return sql<{ id: string; code: string; rounds: number; finished_at: Date; score: number; rank: number; players: number }[]>`
    select g.id, g.code, g.rounds, g.finished_at, gp.score, gp.rank,
      (select count(*)::int from game_players x where x.game_id = g.id) as players
    from game_players gp join games g on g.id = gp.game_id
    where gp.player_id = ${playerId}
    order by g.finished_at desc
    limit ${limit}`;
}
