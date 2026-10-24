import crypto from "node:crypto";
import { sql } from "./db.js";
import { seedCategories, type Category } from "./game/words.js";

let cache: Category[] = [];

export function getCatalog() {
  return cache;
}

export function publicCategories() {
  return cache.map((c) => ({ id: c.id, label: c.label, count: c.words.length }));
}

export async function reloadCatalog() {
  const rows = await sql<{ id: string; name: string; word: string; imposter_word: string | null }[]>`
    select c.id, c.name, w.word, w.imposter_word
    from categories c join words w on w.category_id = c.id
    where c.active
    order by c.name, w.created_at`;
  const map = new Map<string, Category>();
  for (const r of rows) {
    let cat = map.get(r.id);
    if (!cat) {
      cat = { id: r.id, label: r.name, words: [] };
      map.set(r.id, cat);
    }
    cat.words.push({ word: r.word, imposterWord: r.imposter_word });
  }
  cache = [...map.values()];
}

export async function seedCatalog() {
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from categories`;
  if (count > 0) return;
  await sql.begin(async (tx) => {
    for (const cat of seedCategories) {
      const id = crypto.randomUUID();
      await tx`insert into categories (id, name) values (${id}, ${cat.label})`;
      for (const [word, imposterWord] of cat.pairs) {
        await tx`
          insert into words (id, category_id, word, imposter_word)
          values (${crypto.randomUUID()}, ${id}, ${word}, ${imposterWord})`;
      }
    }
  });
}

export interface AdminCategory {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  words: { id: string; word: string; imposterWord: string | null }[];
}

export async function adminCategories(): Promise<AdminCategory[]> {
  const cats = await sql<{ id: string; name: string; active: boolean; created_at: Date }[]>`
    select id, name, active, created_at from categories order by name`;
  const words = await sql<{ id: string; category_id: string; word: string; imposter_word: string | null }[]>`
    select id, category_id, word, imposter_word from words order by created_at`;
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active,
    createdAt: c.created_at,
    words: words
      .filter((w) => w.category_id === c.id)
      .map((w) => ({ id: w.id, word: w.word, imposterWord: w.imposter_word })),
  }));
}

export async function createCategory(name: string) {
  const id = crypto.randomUUID();
  await sql`insert into categories (id, name) values (${id}, ${name})`;
  await reloadCatalog();
  return id;
}

export async function updateCategory(id: string, data: { name?: string; active?: boolean }) {
  const [row] = await sql`
    update categories set
      name = coalesce(${data.name ?? null}, name),
      active = coalesce(${data.active ?? null}, active)
    where id = ${id}
    returning id`;
  await reloadCatalog();
  return !!row;
}

export async function deleteCategory(id: string) {
  const rows = await sql`delete from categories where id = ${id} returning id`;
  await reloadCatalog();
  return rows.length > 0;
}

export async function addWords(categoryId: string, pairs: { word: string; imposterWord: string | null }[]) {
  const [cat] = await sql`select id from categories where id = ${categoryId}`;
  if (!cat) return null;
  await sql.begin(async (tx) => {
    for (const p of pairs) {
      await tx`
        insert into words (id, category_id, word, imposter_word)
        values (${crypto.randomUUID()}, ${categoryId}, ${p.word}, ${p.imposterWord})`;
    }
  });
  await reloadCatalog();
  return pairs.length;
}

export async function updateWord(id: string, data: { word: string; imposterWord: string | null }) {
  const rows = await sql`
    update words set word = ${data.word}, imposter_word = ${data.imposterWord}
    where id = ${id} returning id`;
  await reloadCatalog();
  return rows.length > 0;
}

export async function deleteWord(id: string) {
  const rows = await sql`delete from words where id = ${id} returning id`;
  await reloadCatalog();
  return rows.length > 0;
}

export async function stats() {
  const [row] = await sql<{ players: number; games: number; categories: number; words: number }[]>`
    select
      (select count(*)::int from players) as players,
      (select count(*)::int from games) as games,
      (select count(*)::int from categories) as categories,
      (select count(*)::int from words) as words`;
  return row;
}
