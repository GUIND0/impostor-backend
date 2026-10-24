import { describe, expect, it } from "vitest";
import { GameError, Room, scoreRound } from "../src/game/room.js";
import type { Category } from "../src/game/words.js";

const catalog: Category[] = [
  {
    id: "animaux",
    label: "Animaux",
    words: [
      { word: "Lion", similarWord: "Tigre" },
      { word: "Chat", similarWord: "Chien" },
      { word: "Aigle", similarWord: null },
    ],
  },
  { id: "classique", label: "Classique", words: [{ word: "Plage", similarWord: null }] },
];
import { isCorrectGuess, normalizeWord } from "../src/game/text.js";

function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function setup(count = 4) {
  let t = 1000;
  const clock = () => t;
  const room = new Room("ABCD", { id: "p1", name: "P1", avatarUrl: null }, () => catalog, seeded(), clock);
  for (let i = 2; i <= count; i++) room.addMember({ id: `p${i}`, name: `P${i}`, avatarUrl: null });
  room.updateSettings("p1", { imposterMode: "none" });
  return { room, advance: (ms: number) => (t += ms) };
}

function playToVoting(room: Room) {
  if (room.phase === "reveal") for (const id of room.members.keys()) room.markSeen(id);
  while (room.phase === "clues") {
    room.submitClue(room.currentSpeakerId!, { type: "text", text: "indice" });
  }
}

describe("Room", () => {
  it("requires at least three players", () => {
    const { room } = setup(2);
    expect(() => room.start("p1")).toThrow(GameError);
  });

  it("only lets the host start", () => {
    const { room } = setup();
    expect(() => room.start("p2")).toThrow(/hôte/);
  });

  it("hides the word from the imposter only", () => {
    const { room } = setup();
    room.start("p1");
    const imposter = room.round!.imposterId;
    for (const id of room.members.keys()) {
      const v = room.view(id);
      if (id === imposter) {
        expect(v.round!.you.word).toBeNull();
        expect(v.round!.you.isImposter).toBe(true);
      } else {
        expect(v.round!.you.word).toBe(room.round!.word);
      }
      expect(v.round!.result).toBeNull();
    }
  });

  it("starts clues once everyone saw their card and runs every turn", () => {
    const { room } = setup();
    room.updateSettings("p1", { clueTurns: 2 });
    room.start("p1");
    for (const id of room.members.keys()) room.markSeen(id);
    expect(room.phase).toBe("clues");
    expect(new Set(room.round!.order).size).toBe(4);
    const first = room.currentSpeakerId!;
    expect(() => room.submitClue(room.round!.order[1], { type: "text", text: "x" })).toThrow(/tour/);
    room.submitClue(first, { type: "text", text: "rouge" });
    expect(room.currentSpeakerId).toBe(room.round!.order[1]);
    playToVoting(room);
    expect(room.phase).toBe("voting");
    expect(room.round!.clues).toHaveLength(8);
  });

  it("skips a turn when time runs out", () => {
    const { room, advance } = setup();
    room.start("p1");
    for (const id of room.members.keys()) room.markSeen(id);
    const first = room.currentSpeakerId;
    advance(61_000);
    expect(room.tick()).toBe(true);
    expect(room.round!.clues[0]).toMatchObject({ playerId: first, type: "skip" });
  });

  it("rewards civilians when the imposter is caught", () => {
    const { room } = setup();
    room.updateSettings("p1", { rounds: 1, clueTurns: 1 });
    room.start("p1");
    playToVoting(room);
    const imposter = room.round!.imposterId;
    const civilians = [...room.members.keys()].filter((id) => id !== imposter);
    for (const id of civilians) room.vote(id, imposter);
    room.vote(imposter, civilians[0]);
    expect(room.phase).toBe("guess");
    room.submitGuess(imposter, "zzzz");
    expect(room.phase).toBe("finished");
    const v = room.view("p1");
    expect(v.round!.result!.caught).toBe(true);
    for (const id of civilians) expect(room.members.get(id)!.score).toBe(2);
    expect(room.members.get(imposter)!.score).toBe(0);
    expect(v.ranking).not.toBeNull();
  });

  it("lets the imposter steal the round with the right word", () => {
    const { room } = setup();
    room.updateSettings("p1", { rounds: 2, clueTurns: 1 });
    room.start("p1");
    playToVoting(room);
    const imposter = room.round!.imposterId;
    for (const id of room.members.keys()) {
      room.vote(id, id === imposter ? [...room.members.keys()].find((x) => x !== id)! : imposter);
    }
    room.submitGuess(imposter, room.round!.word.toUpperCase());
    expect(room.phase).toBe("results");
    expect(room.members.get(imposter)!.score).toBe(2);
    room.nextRound("p1");
    expect(room.phase).toBe("reveal");
    expect(room.round!.number).toBe(2);
    expect(room.round!.imposterId).not.toBe(imposter);
  });

  it("keeps each player's last vote and attributes votes to the right voter", () => {
    const { room } = setup(5);
    room.updateSettings("p1", { rounds: 1, clueTurns: 1 });
    room.start("p1");
    playToVoting(room);
    room.vote("p1", "p4");
    room.vote("p1", "p2");
    room.vote("p2", "p3");
    room.vote("p3", "p2");
    room.vote("p4", "p2");
    expect(room.view("p2").round!.myVote).toBe("p3");
    expect(room.view("p5").round!.votes).toBeNull();
    room.vote("p5", "p1");
    expect(room.phase).not.toBe("voting");
    expect(room.view("p1").round!.votes).toEqual({ p1: "p2", p2: "p3", p3: "p2", p4: "p2", p5: "p1" });
    expect(room.round!.accusedId).toBe("p2");
  });

  it("treats a tie as the imposter escaping", () => {
    const points = scoreRound({
      memberIds: ["a", "b", "c", "d"],
      imposterId: "a",
      accusedId: null,
      votes: new Map([["a", "b"], ["b", "a"], ["c", "b"], ["d", "a"]]),
      guessCorrect: false,
    });
    expect(points).toEqual({ a: 2, b: 0, c: 0, d: 0 });
  });

  it("skips the speaker who disconnects and transfers host", () => {
    const { room } = setup();
    room.start("p1");
    for (const id of room.members.keys()) room.markSeen(id);
    const speaker = room.currentSpeakerId!;
    room.setConnected(speaker, false);
    expect(room.round!.clues[0]).toMatchObject({ playerId: speaker, type: "skip" });
    room.setConnected("p1", false);
    expect(room.hostId).not.toBe("p1");
  });

  it("refuses new players once the game started but accepts reconnection", () => {
    const { room } = setup();
    room.start("p1");
    expect(() => room.addMember({ id: "late", name: "Late", avatarUrl: null })).toThrow(/commencé/);
    room.setConnected("p2", false);
    expect(() => room.addMember({ id: "p2", name: "P2", avatarUrl: null })).not.toThrow();
  });
});

describe("similar word mode", () => {
  it("gives the imposter a similar word without telling them", () => {
    const { room } = setup();
    room.updateSettings("p1", { imposterMode: "similar", category: "animaux", rounds: 1, clueTurns: 1 });
    room.start("p1");
    const round = room.round!;
    expect(round.mode).toBe("similar");
    const imposter = round.imposterId;
    const v = room.view(imposter);
    expect(v.round!.you.isImposter).toBe(false);
    expect(v.round!.you.word).toBe(round.imposterWord);
    expect(v.round!.you.word).not.toBe(round.word);
    expect(v.round!.category).toBe("Animaux");
    const other = [...room.members.keys()].find((id) => id !== imposter)!;
    expect(room.view(other).round!.you.word).toBe(round.word);
  });

  it("skips the guess phase and reveals both words", () => {
    const { room } = setup();
    room.updateSettings("p1", { imposterMode: "similar", category: "animaux", rounds: 1, clueTurns: 1 });
    room.start("p1");
    playToVoting(room);
    const imposter = room.round!.imposterId;
    for (const id of room.members.keys()) {
      room.vote(id, id === imposter ? [...room.members.keys()].find((x) => x !== id)! : imposter);
    }
    expect(room.phase).toBe("finished");
    const v = room.view(imposter);
    expect(v.round!.result!.imposterWord).toBe(room.round!.imposterWord);
    expect(v.round!.you.isImposter).toBe(true);
    expect(room.members.get(imposter)!.score).toBe(0);
  });

  it("decides at random which word of the pair goes to the civilians", () => {
    const pairCatalog: Category[] = [{ id: "duo", label: "Duo", words: [{ word: "Lion", similarWord: "Tigre" }] }];
    const civilianWords = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      let t = 0;
      const room = new Room("SEED", { id: "p1", name: "P1", avatarUrl: null }, () => pairCatalog, seeded(seed * 7919), () => t);
      for (let i = 2; i <= 4; i++) room.addMember({ id: `p${i}`, name: `P${i}`, avatarUrl: null });
      room.updateSettings("p1", { imposterMode: "similar", category: "duo", rounds: 1 });
      room.start("p1");
      const round = room.round!;
      expect(new Set([round.word, round.imposterWord])).toEqual(new Set(["Lion", "Tigre"]));
      civilianWords.add(round.word);
      for (const id of room.members.keys()) {
        const v = room.view(id).round!;
        expect(v.you.isImposter).toBe(false);
        expect(v.you.word).toBe(id === round.imposterId ? round.imposterWord : round.word);
      }
      t += 1;
    }
    expect(civilianWords).toEqual(new Set(["Lion", "Tigre"]));
  });

  it("uses either word of a pair for the civilians in classic mode", () => {
    const pairCatalog: Category[] = [{ id: "duo", label: "Duo", words: [{ word: "Lion", similarWord: "Tigre" }] }];
    const civilianWords = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const room = new Room("SEED", { id: "p1", name: "P1", avatarUrl: null }, () => pairCatalog, seeded(seed * 104729));
      for (let i = 2; i <= 3; i++) room.addMember({ id: `p${i}`, name: `P${i}`, avatarUrl: null });
      room.updateSettings("p1", { imposterMode: "none", category: "duo" });
      room.start("p1");
      const round = room.round!;
      expect(round.mode).toBe("none");
      expect(round.imposterWord).toBeNull();
      expect(["Lion", "Tigre"]).toContain(round.word);
      expect(room.view(round.imposterId).round!.you.word).toBeNull();
      civilianWords.add(round.word);
    }
    expect(civilianWords).toEqual(new Set(["Lion", "Tigre"]));
  });

  it("does not replay the same pair before the category is exhausted", () => {
    const { room } = setup();
    room.updateSettings("p1", { imposterMode: "similar", category: "animaux", rounds: 2, clueTurns: 1 });
    room.start("p1");
    const first = new Set([room.round!.word, room.round!.imposterWord]);
    playToVoting(room);
    const imposter = room.round!.imposterId;
    for (const id of room.members.keys()) room.vote(id, id === imposter ? [...room.members.keys()].find((x) => x !== id)! : imposter);
    room.nextRound("p1");
    const second = new Set([room.round!.word, room.round!.imposterWord]);
    expect([...second].some((w) => first.has(w))).toBe(false);
  });

  it("treats a pair entered in both directions as the same pair", () => {
    const dupCatalog: Category[] = [
      {
        id: "dup",
        label: "Doublons",
        words: [
          { word: "Fiche ATP", similarWord: "Fiche incident" },
          { word: "fiche incident", similarWord: "fiche ATP" },
          { word: "Plage", similarWord: "Piscine" },
        ],
      },
    ];
    for (let seed = 1; seed <= 30; seed++) {
      const room = new Room("DUP", { id: "p1", name: "P1", avatarUrl: null }, () => dupCatalog, seeded(seed * 31));
      for (let i = 2; i <= 3; i++) room.addMember({ id: `p${i}`, name: `P${i}`, avatarUrl: null });
      room.updateSettings("p1", { imposterMode: "similar", category: "dup", rounds: 2, clueTurns: 1 });
      room.start("p1");
      const first = room.round!.word.toLowerCase();
      playToVoting(room);
      const imposter = room.round!.imposterId;
      for (const id of room.members.keys()) room.vote(id, id === imposter ? [...room.members.keys()].find((x) => x !== id)! : imposter);
      room.nextRound("p1");
      const second = room.round!.word.toLowerCase();
      const isFiche = (w: string) => w.startsWith("fiche");
      expect(isFiche(first) && isFiche(second)).toBe(false);
    }
  });

  it("falls back to the classic mode when the category has no similar words", () => {
    const { room } = setup();
    room.updateSettings("p1", { imposterMode: "similar", category: "classique" });
    room.start("p1");
    expect(room.round!.mode).toBe("none");
    expect(room.view(room.round!.imposterId).round!.you.isImposter).toBe(true);
  });

  it("uses the configured reveal time", () => {
    const { room, advance } = setup();
    room.updateSettings("p1", { revealSeconds: 10 });
    room.start("p1");
    advance(9_000);
    expect(room.tick()).toBe(false);
    advance(1_500);
    expect(room.tick()).toBe(true);
    expect(room.phase).toBe("clues");
  });

  it("refuses an unknown category", () => {
    const { room } = setup();
    expect(() => room.updateSettings("p1", { category: "inconnue" })).toThrow(/Catégorie/);
  });
});

describe("guess matching", () => {
  it("ignores accents, case and articles", () => {
    expect(normalizeWord("L'Éléphant")).toBe("elephant");
    expect(isCorrectGuess("la plage", "Plage")).toBe(true);
    expect(isCorrectGuess("elephan", "Éléphant")).toBe(true);
    expect(isCorrectGuess("lessive", "Lessive")).toBe(true);
    expect(isCorrectGuess("chat", "Chien")).toBe(false);
  });
});
