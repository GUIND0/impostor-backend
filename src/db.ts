import postgres from "postgres";
import { config } from "./config.js";

export const sql = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });

export interface PlayerRow {
  id: string;
  name: string;
  avatar_path: string | null;
  total_points: number;
  games_played: number;
  wins: number;
  created_at: Date;
}

export async function migrate() {
  await sql`
    create table if not exists players (
      id uuid primary key,
      name text not null,
      avatar_path text,
      token_hash text not null unique,
      total_points integer not null default 0,
      games_played integer not null default 0,
      wins integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists games (
      id uuid primary key,
      code text not null,
      rounds integer not null,
      started_at timestamptz,
      finished_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists game_players (
      game_id uuid not null references games(id) on delete cascade,
      player_id uuid not null references players(id) on delete cascade,
      score integer not null,
      rank integer not null,
      primary key (game_id, player_id)
    )`;
  await sql`create index if not exists game_players_player_idx on game_players(player_id)`;
  await sql`
    create table if not exists categories (
      id uuid primary key,
      name text not null,
      active boolean not null default true,
      created_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists words (
      id uuid primary key,
      category_id uuid not null references categories(id) on delete cascade,
      word text not null,
      imposter_word text,
      created_at timestamptz not null default now()
    )`;
  await sql`create index if not exists words_category_idx on words(category_id)`;
}

export async function waitForDatabase(attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      await sql`select 1`;
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
