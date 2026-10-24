import crypto from "node:crypto";
import { GameError, Room, type Member } from "./room.js";

type Profile = Pick<Member, "id" | "name" | "avatarUrl">;

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomManager {
  rooms = new Map<string, Room>();
  private playerRoom = new Map<string, string>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private hooks: {
      changed: (room: Room) => void;
      finished: (room: Room) => void;
      removed: (playerId: string, code: string) => void;
    },
  ) {}

  private newCode() {
    for (;;) {
      let code = "";
      for (let i = 0; i < 5; i++) code += alphabet[crypto.randomInt(alphabet.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  roomOf(playerId: string) {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) ?? null : null;
  }

  get(code: string) {
    return this.rooms.get(code.toUpperCase()) ?? null;
  }

  create(player: Profile) {
    this.leave(player.id);
    const room = new Room(this.newCode(), player);
    this.rooms.set(room.code, room);
    this.playerRoom.set(player.id, room.code);
    this.hooks.changed(room);
    return room;
  }

  join(code: string, player: Profile) {
    const room = this.get(code);
    if (!room) throw new GameError("room_not_found", "Aucune partie avec ce code");
    const current = this.roomOf(player.id);
    if (current && current !== room) this.leave(player.id);
    this.mutate(room, () => {
      room.addMember(player);
      this.playerRoom.set(player.id, room.code);
    });
    return room;
  }

  leave(playerId: string) {
    const room = this.roomOf(playerId);
    this.playerRoom.delete(playerId);
    if (!room) return;
    this.mutate(room, () => room.removeMember(playerId));
    this.hooks.removed(playerId, room.code);
    this.dropIfAbandoned(room);
  }

  kick(room: Room, by: string, playerId: string) {
    this.mutate(room, () => room.kick(by, playerId));
    this.playerRoom.delete(playerId);
    this.hooks.removed(playerId, room.code);
  }

  setConnected(playerId: string, connected: boolean) {
    const room = this.roomOf(playerId);
    if (!room || !room.members.has(playerId)) return null;
    this.mutate(room, () => room.setConnected(playerId, connected));
    return room;
  }

  updateProfile(player: Profile) {
    const room = this.roomOf(player.id);
    if (!room) return;
    this.mutate(room, () => room.updateProfile(player.id, player.name, player.avatarUrl));
  }

  mutate<T>(room: Room, action: () => T): T {
    const before = room.phase;
    try {
      return action();
    } finally {
      this.afterChange(room, before);
    }
  }

  private afterChange(room: Room, before: string) {
    for (const [id, code] of this.playerRoom) {
      if (code === room.code && !room.members.has(id)) this.playerRoom.delete(id);
    }
    if (before !== "finished" && room.phase === "finished") this.hooks.finished(room);
    this.schedule(room);
    this.hooks.changed(room);
  }

  private schedule(room: Room) {
    const existing = this.timers.get(room.code);
    if (existing) clearTimeout(existing);
    this.timers.delete(room.code);
    if (room.deadline === null || !this.rooms.has(room.code)) return;
    const delay = Math.max(0, room.deadline - Date.now()) + 50;
    this.timers.set(
      room.code,
      setTimeout(() => {
        this.timers.delete(room.code);
        this.mutate(room, () => room.tick());
      }, delay),
    );
  }

  private dropIfAbandoned(room: Room) {
    if (room.members.size === 0) this.destroy(room);
  }

  private destroy(room: Room) {
    const timer = this.timers.get(room.code);
    if (timer) clearTimeout(timer);
    this.timers.delete(room.code);
    this.rooms.delete(room.code);
    for (const [id, code] of this.playerRoom) if (code === room.code) this.playerRoom.delete(id);
  }

  sweep(idleMs: number) {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.isEmpty && now - room.updatedAt > idleMs) this.destroy(room);
    }
  }
}
