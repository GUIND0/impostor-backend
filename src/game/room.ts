import { categories, findCategory } from "./words.js";
import { isCorrectGuess } from "./text.js";

export type Phase = "lobby" | "reveal" | "clues" | "voting" | "guess" | "results" | "finished";

export interface Settings {
  rounds: number;
  clueTurns: number;
  category: string;
  turnSeconds: number;
  voteSeconds: number;
  imposterSeesCategory: boolean;
}

export interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
  connected: boolean;
  score: number;
  joinedAt: number;
}

export type ClueInput =
  | { type: "text"; text: string }
  | { type: "audio"; audioUrl: string; durationMs: number };

export interface Clue {
  id: string;
  playerId: string;
  turn: number;
  type: "text" | "audio" | "skip";
  text?: string;
  audioUrl?: string;
  durationMs?: number;
  createdAt: number;
}

interface Round {
  number: number;
  categoryId: string;
  word: string;
  imposterId: string;
  seen: Set<string>;
  order: string[];
  turn: number;
  index: number;
  clues: Clue[];
  votes: Map<string, string>;
  accusedId: string | null;
  guess: string | null;
  guessCorrect: boolean | null;
  points: Record<string, number>;
}

export class GameError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
export const GUESS_SECONDS = 30;
export const REVEAL_SECONDS = 20;

export const defaultSettings: Settings = {
  rounds: 3,
  clueTurns: 2,
  category: "random",
  turnSeconds: 60,
  voteSeconds: 60,
  imposterSeesCategory: true,
};

export type Random = () => number;

function shuffle<T>(items: T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick<T>(items: T[], random: Random): T {
  return items[Math.floor(random() * items.length)];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export class Room {
  hostId: string;
  phase: Phase = "lobby";
  settings: Settings = { ...defaultSettings };
  members = new Map<string, Member>();
  round: Round | null = null;
  history: { number: number; word: string; imposterId: string; caught: boolean }[] = [];
  deadline: number | null = null;
  usedWords = new Set<string>();
  previousImposters: string[] = [];
  startedAt: number | null = null;
  updatedAt: number;
  private clueSeq = 0;

  constructor(
    public code: string,
    host: Omit<Member, "connected" | "score" | "joinedAt">,
    private random: Random = Math.random,
    private now: () => number = Date.now,
  ) {
    this.hostId = host.id;
    this.updatedAt = this.now();
    this.addMember(host);
  }

  private touch() {
    this.updatedAt = this.now();
  }

  private requireHost(playerId: string) {
    if (playerId !== this.hostId) throw new GameError("not_host", "Seul l'hôte peut faire cette action");
  }

  private requirePhase(...phases: Phase[]) {
    if (!phases.includes(this.phase)) throw new GameError("bad_phase", "Action impossible à ce moment de la partie");
  }

  private requireMember(playerId: string) {
    const member = this.members.get(playerId);
    if (!member) throw new GameError("not_member", "Vous ne faites pas partie de cette partie");
    return member;
  }

  get connectedIds() {
    return [...this.members.values()].filter((m) => m.connected).map((m) => m.id);
  }

  addMember(player: Omit<Member, "connected" | "score" | "joinedAt">) {
    const existing = this.members.get(player.id);
    if (existing) {
      existing.name = player.name;
      existing.avatarUrl = player.avatarUrl;
      existing.connected = true;
      this.touch();
      return existing;
    }
    if (this.phase !== "lobby") throw new GameError("already_started", "La partie a déjà commencé");
    if (this.members.size >= MAX_PLAYERS) throw new GameError("room_full", "La partie est complète");
    const member: Member = { ...player, connected: true, score: 0, joinedAt: this.now() };
    this.members.set(player.id, member);
    this.touch();
    return member;
  }

  updateProfile(playerId: string, name: string, avatarUrl: string | null) {
    const member = this.members.get(playerId);
    if (!member) return;
    member.name = name;
    member.avatarUrl = avatarUrl;
    this.touch();
  }

  setConnected(playerId: string, connected: boolean) {
    const member = this.members.get(playerId);
    if (!member) return;
    member.connected = connected;
    if (!connected) this.ensureHost();
    this.touch();
    if (!connected) this.afterDisconnect(playerId);
  }

  removeMember(playerId: string) {
    if (!this.members.has(playerId)) return;
    if (this.phase === "lobby" || this.phase === "finished") {
      this.members.delete(playerId);
      this.ensureHost();
      this.touch();
      return;
    }
    this.setConnected(playerId, false);
  }

  kick(by: string, playerId: string) {
    this.requireHost(by);
    this.requirePhase("lobby");
    if (playerId === by) throw new GameError("invalid", "Vous ne pouvez pas vous exclure");
    this.members.delete(playerId);
    this.touch();
  }

  private ensureHost() {
    const host = this.members.get(this.hostId);
    if (host && host.connected) return;
    const next = [...this.members.values()]
      .filter((m) => m.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) this.hostId = next.id;
  }

  get isEmpty() {
    return this.connectedIds.length === 0;
  }

  updateSettings(by: string, patch: Partial<Settings>) {
    this.requireHost(by);
    this.requirePhase("lobby");
    const s = { ...this.settings };
    if (patch.rounds !== undefined) s.rounds = clamp(patch.rounds, 1, 10);
    if (patch.clueTurns !== undefined) s.clueTurns = clamp(patch.clueTurns, 1, 3);
    if (patch.turnSeconds !== undefined) s.turnSeconds = clamp(patch.turnSeconds, 20, 180);
    if (patch.voteSeconds !== undefined) s.voteSeconds = clamp(patch.voteSeconds, 20, 180);
    if (patch.imposterSeesCategory !== undefined) s.imposterSeesCategory = !!patch.imposterSeesCategory;
    if (patch.category !== undefined) {
      if (patch.category !== "random" && !findCategory(patch.category)) {
        throw new GameError("invalid", "Catégorie inconnue");
      }
      s.category = patch.category;
    }
    this.settings = s;
    this.touch();
  }

  start(by: string) {
    this.requireHost(by);
    this.requirePhase("lobby");
    for (const [id, m] of this.members) if (!m.connected) this.members.delete(id);
    if (this.members.size < MIN_PLAYERS) {
      throw new GameError("not_enough_players", `Il faut au moins ${MIN_PLAYERS} joueurs`);
    }
    for (const m of this.members.values()) m.score = 0;
    this.history = [];
    this.startedAt = this.now();
    this.startRound(1);
  }

  private startRound(number: number) {
    const category =
      this.settings.category === "random" ? pick(categories, this.random) : findCategory(this.settings.category)!;
    let pool = category.words.filter((w) => !this.usedWords.has(w));
    if (!pool.length) pool = category.words;
    const word = pick(pool, this.random);
    this.usedWords.add(word);

    const ids = [...this.members.keys()];
    const last = this.previousImposters[this.previousImposters.length - 1];
    const candidates = ids.length > 1 && last ? ids.filter((id) => id !== last) : ids;
    const imposterId = pick(candidates, this.random);
    this.previousImposters.push(imposterId);

    this.round = {
      number,
      categoryId: category.id,
      word,
      imposterId,
      seen: new Set(),
      order: [],
      turn: 1,
      index: 0,
      clues: [],
      votes: new Map(),
      accusedId: null,
      guess: null,
      guessCorrect: null,
      points: {},
    };
    this.phase = "reveal";
    this.deadline = this.now() + REVEAL_SECONDS * 1000;
    this.touch();
  }

  markSeen(playerId: string) {
    this.requireMember(playerId);
    this.requirePhase("reveal");
    this.round!.seen.add(playerId);
    this.touch();
    this.maybeFinishReveal();
  }

  private maybeFinishReveal() {
    if (this.phase !== "reveal") return;
    const round = this.round!;
    if (this.connectedIds.every((id) => round.seen.has(id))) this.beginClues();
  }

  private beginClues() {
    const round = this.round!;
    round.order = shuffle([...this.members.keys()], this.random);
    round.turn = 1;
    round.index = 0;
    this.phase = "clues";
    this.startTurn();
  }

  get currentSpeakerId(): string | null {
    if (this.phase !== "clues" || !this.round) return null;
    return this.round.order[this.round.index] ?? null;
  }

  private startTurn() {
    const speaker = this.currentSpeakerId;
    if (speaker && !this.members.get(speaker)?.connected) {
      this.recordClue(speaker, { type: "skip" });
      return;
    }
    this.deadline = this.now() + this.settings.turnSeconds * 1000;
    this.touch();
  }

  submitClue(playerId: string, input: ClueInput) {
    this.requireMember(playerId);
    this.requirePhase("clues");
    if (this.currentSpeakerId !== playerId) throw new GameError("not_your_turn", "Ce n'est pas votre tour");
    if (input.type === "text") {
      const text = input.text.trim().replace(/\s+/g, " ");
      if (!text) throw new GameError("invalid", "L'indice est vide");
      if (text.length > 120) throw new GameError("invalid", "L'indice est trop long");
      this.recordClue(playerId, { type: "text", text });
    } else {
      if (!/^\/uploads\/audio\/[a-zA-Z0-9-]+\.[a-z0-9]+$/.test(input.audioUrl)) {
        throw new GameError("invalid", "Message vocal invalide");
      }
      const durationMs = clamp(input.durationMs, 0, 60000);
      this.recordClue(playerId, { type: "audio", audioUrl: input.audioUrl, durationMs });
    }
  }

  private recordClue(playerId: string, data: Omit<Clue, "id" | "playerId" | "turn" | "createdAt">) {
    const round = this.round!;
    round.clues.push({ id: `c${++this.clueSeq}`, playerId, turn: round.turn, createdAt: this.now(), ...data });
    round.index++;
    if (round.index >= round.order.length) {
      round.index = 0;
      round.turn++;
    }
    if (round.turn > this.settings.clueTurns) {
      this.beginVoting();
      return;
    }
    this.startTurn();
  }

  private beginVoting() {
    this.phase = "voting";
    this.deadline = this.now() + this.settings.voteSeconds * 1000;
    this.touch();
  }

  vote(playerId: string, targetId: string) {
    this.requireMember(playerId);
    this.requirePhase("voting");
    if (playerId === targetId) throw new GameError("invalid", "Vous ne pouvez pas voter pour vous-même");
    if (!this.members.has(targetId)) throw new GameError("invalid", "Joueur inconnu");
    this.round!.votes.set(playerId, targetId);
    this.touch();
    this.maybeFinishVoting();
  }

  private maybeFinishVoting() {
    if (this.phase !== "voting") return;
    const votes = this.round!.votes;
    if (this.connectedIds.every((id) => votes.has(id))) this.resolveVotes();
  }

  private resolveVotes() {
    const round = this.round!;
    const tally = new Map<string, number>();
    for (const target of round.votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
    const max = Math.max(0, ...tally.values());
    const top = [...tally.entries()].filter(([, n]) => n === max).map(([id]) => id);
    round.accusedId = max > 0 && top.length === 1 ? top[0] : null;
    this.phase = "guess";
    this.deadline = this.now() + GUESS_SECONDS * 1000;
    this.touch();
    if (!this.members.get(round.imposterId)?.connected) this.resolveGuess(null);
  }

  submitGuess(playerId: string, guess: string) {
    this.requireMember(playerId);
    this.requirePhase("guess");
    if (this.round!.imposterId !== playerId) throw new GameError("not_imposter", "Seul l'imposteur peut deviner");
    const value = guess.trim().slice(0, 60);
    if (!value) throw new GameError("invalid", "Proposition vide");
    this.resolveGuess(value);
  }

  private resolveGuess(guess: string | null) {
    const round = this.round!;
    round.guess = guess;
    round.guessCorrect = guess ? isCorrectGuess(guess, round.word) : false;
    round.points = scoreRound({
      memberIds: [...this.members.keys()],
      imposterId: round.imposterId,
      accusedId: round.accusedId,
      votes: round.votes,
      guessCorrect: round.guessCorrect,
    });
    for (const [id, pts] of Object.entries(round.points)) {
      const m = this.members.get(id);
      if (m) m.score += pts;
    }
    this.history.push({
      number: round.number,
      word: round.word,
      imposterId: round.imposterId,
      caught: round.accusedId === round.imposterId,
    });
    this.phase = round.number >= this.settings.rounds ? "finished" : "results";
    this.deadline = null;
    this.touch();
  }

  nextRound(by: string) {
    this.requireHost(by);
    this.requirePhase("results");
    for (const [id, m] of this.members) if (!m.connected) this.members.delete(id);
    if (this.members.size < MIN_PLAYERS) {
      this.phase = "finished";
      this.touch();
      return;
    }
    this.startRound(this.round!.number + 1);
  }

  restart(by: string) {
    this.requireHost(by);
    this.requirePhase("finished");
    for (const [id, m] of this.members) if (!m.connected) this.members.delete(id);
    this.phase = "lobby";
    this.round = null;
    this.history = [];
    this.deadline = null;
    for (const m of this.members.values()) m.score = 0;
    this.touch();
  }

  private afterDisconnect(playerId: string) {
    if (this.phase === "reveal") this.maybeFinishReveal();
    else if (this.phase === "clues" && this.currentSpeakerId === playerId) this.recordClue(playerId, { type: "skip" });
    else if (this.phase === "voting") this.maybeFinishVoting();
    else if (this.phase === "guess" && this.round?.imposterId === playerId) this.resolveGuess(null);
  }

  tick() {
    if (this.deadline === null || this.now() < this.deadline) return false;
    switch (this.phase) {
      case "reveal":
        this.beginClues();
        return true;
      case "clues":
        this.recordClue(this.currentSpeakerId!, { type: "skip" });
        return true;
      case "voting":
        this.resolveVotes();
        return true;
      case "guess":
        this.resolveGuess(null);
        return true;
      default:
        this.deadline = null;
        return false;
    }
  }

  ranking() {
    return [...this.members.values()]
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .map((m, i, arr) => ({
        playerId: m.id,
        score: m.score,
        rank: arr.findIndex((x) => x.score === m.score) + 1,
      }));
  }

  view(viewerId: string) {
    const round = this.round;
    const revealed = this.phase === "results" || this.phase === "finished";
    const isImposter = round?.imposterId === viewerId;
    const category = round ? findCategory(round.categoryId) : undefined;
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      deadline: this.deadline,
      serverTime: this.now(),
      members: [...this.members.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(({ id, name, avatarUrl, connected, score }) => ({ id, name, avatarUrl, connected, score })),
      round: round
        ? {
            number: round.number,
            totalRounds: this.settings.rounds,
            category:
              !isImposter || this.settings.imposterSeesCategory || revealed ? (category?.label ?? null) : null,
            you: {
              isImposter: this.members.has(viewerId) ? isImposter : false,
              word: isImposter || !this.members.has(viewerId) ? null : round.word,
              seen: round.seen.has(viewerId),
            },
            seenIds: [...round.seen],
            order: round.order,
            turn: round.turn,
            clueTurns: this.settings.clueTurns,
            currentSpeakerId: this.currentSpeakerId,
            clues: round.clues,
            votedIds: [...round.votes.keys()],
            myVote: round.votes.get(viewerId) ?? null,
            accusedId: this.phase === "guess" || revealed ? round.accusedId : null,
            votes: this.phase === "guess" || revealed ? Object.fromEntries(round.votes) : null,
            result: revealed
              ? {
                  word: round.word,
                  imposterId: round.imposterId,
                  caught: round.accusedId === round.imposterId,
                  guess: round.guess,
                  guessCorrect: round.guessCorrect,
                  points: round.points,
                }
              : null,
          }
        : null,
      history: this.history,
      ranking: this.phase === "finished" ? this.ranking() : null,
    };
  }
}

export function scoreRound(input: {
  memberIds: string[];
  imposterId: string;
  accusedId: string | null;
  votes: Map<string, string>;
  guessCorrect: boolean;
}): Record<string, number> {
  const points: Record<string, number> = Object.fromEntries(input.memberIds.map((id) => [id, 0]));
  const caught = input.accusedId === input.imposterId;
  if (caught) {
    if (input.guessCorrect) {
      points[input.imposterId] = 2;
    } else {
      for (const id of input.memberIds) {
        if (id === input.imposterId) continue;
        points[id] = input.votes.get(id) === input.imposterId ? 2 : 1;
      }
    }
  } else {
    points[input.imposterId] = input.guessCorrect ? 3 : 2;
  }
  return points;
}
