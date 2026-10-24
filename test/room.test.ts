import { describe, expect, it } from "vitest";
import { GameError, Room, scoreRound } from "../src/game/room.js";
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
  const room = new Room("ABCD", { id: "p1", name: "P1", avatarUrl: null }, seeded(), clock);
  for (let i = 2; i <= count; i++) room.addMember({ id: `p${i}`, name: `P${i}`, avatarUrl: null });
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

describe("guess matching", () => {
  it("ignores accents, case and articles", () => {
    expect(normalizeWord("L'Éléphant")).toBe("elephant");
    expect(isCorrectGuess("la plage", "Plage")).toBe(true);
    expect(isCorrectGuess("elephan", "Éléphant")).toBe(true);
    expect(isCorrectGuess("lessive", "Lessive")).toBe(true);
    expect(isCorrectGuess("chat", "Chien")).toBe(false);
  });
});
