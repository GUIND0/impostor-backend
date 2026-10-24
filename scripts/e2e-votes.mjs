import { io } from "socket.io-client";

const BASE = process.env.URL ?? "http://localhost:3300";
const PREFIX = process.env.PREFIX ?? "Test";
let failures = 0;
let checks = 0;

function check(cond, msg, extra) {
  checks++;
  if (!cond) {
    failures++;
    console.log("  ECHEC:", msg, extra !== undefined ? JSON.stringify(extra) : "");
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.state = null;
    this.waiters = [];
    this.events = [];
  }
  async register() {
    const res = await fetch(BASE + "/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: this.name }),
    });
    const body = await res.json();
    this.id = body.player.id;
    this.token = body.token;
  }
  connect() {
    this.socket = io(BASE, { auth: { token: this.token }, transports: ["websocket"], reconnection: false, forceNew: true });
    this.socket.on("room:state", (s) => {
      this.state = s;
      this.events.push(s.phase);
      this.waiters = this.waiters.filter((w) => !w(s));
    });
    this.socket.on("room:left", () => {
      this.state = null;
    });
    return new Promise((res, rej) => {
      this.socket.on("connect", res);
      this.socket.on("connect_error", rej);
    });
  }
  disconnect() {
    this.socket.close();
  }
  emit(ev, data = {}) {
    return new Promise((res) => this.socket.emit(ev, data, res));
  }
  waitFor(pred, timeout = 5000, label = "") {
    if (this.state && pred(this.state)) return Promise.resolve(this.state);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: timeout ${label} (phase=${this.state?.phase})`)), timeout);
      this.waiters.push((s) => {
        if (pred(s)) {
          clearTimeout(t);
          res(s);
          return true;
        }
        return false;
      });
    });
  }
}

const pool = [];

async function makePlayers(names) {
  while (pool.length < names.length) {
    const c = new Client(`${PREFIX} J${pool.length + 1}`);
    await c.register();
    pool.push(c);
  }
  const ps = pool.slice(0, names.length);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const wanted = `${PREFIX} ${names[i]}`.slice(0, 20);
    if (!p.socket || !p.socket.connected) await p.connect();
    await p.emit("room:leave");
    p.state = null;
    p.waiters = [];
    if (p.name !== wanted) {
      const r = await fetch(BASE + "/api/players/me", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: "Bearer " + p.token },
        body: JSON.stringify({ name: wanted }),
      });
      check(r.ok, "renommage du joueur");
      p.name = wanted;
    }
  }
  return ps;
}

async function createRoom(players, settings) {
  const [host, ...rest] = players;
  const c = await host.emit("room:create", settings);
  check(c.ok, "creation de la partie", c);
  for (const p of rest) {
    const j = await p.emit("room:join", { code: c.data.code });
    check(j.ok, `${p.name} rejoint`, j);
  }
  await Promise.all(players.map((p) => p.waitFor((s) => s.members.length === players.length, 3000, "membres")));
  return c.data.code;
}

async function playClues(players) {
  const host = players[0];
  let audioUrl = null;
  {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(3000)], { type: "audio/mp4" }), "clue.m4a");
    const r = await fetch(BASE + "/api/audio", { method: "POST", headers: { authorization: "Bearer " + host.token }, body: fd });
    audioUrl = (await r.json()).audioUrl;
  }
  let n = 0;
  while (host.state.phase === "clues") {
    const speakerId = host.state.round.currentSpeakerId;
    const speaker = players.find((p) => p.id === speakerId);
    const before = host.state.round.clues.length;
    const clue = n++ % 2 === 0 ? { type: "text", text: `indice ${n}` } : { type: "audio", audioUrl, durationMs: 1500 };
    const r = await speaker.emit("game:clue", clue);
    check(r.ok, "indice accepte", r);
    await host.waitFor((s) => s.phase !== "clues" || s.round.clues.length > before, 3000, "indice suivant");
  }
}

async function revealAll(players) {
  await Promise.all(players.map((p) => p.emit("game:seen")));
  await players[0].waitFor((s) => s.phase === "clues", 3000, "debut indices");
}

function imposterOf(players) {
  const st = players[0].state;
  if (st.round.mode === "none") return players.find((p) => p.state.round.you.isImposter);
  const words = players.map((p) => p.state.round.you.word);
  return players.find((p, i) => words.filter((w) => w === words[i]).length === 1);
}

function expectedOutcome(players, plan, imposterId, mode, guessCorrect) {
  const tally = {};
  for (const t of Object.values(plan)) tally[t] = (tally[t] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter((k) => tally[k] === max);
  const accused = max > 0 && top.length === 1 ? top[0] : null;
  const caught = accused === imposterId;
  const points = Object.fromEntries(players.map((p) => [p.id, 0]));
  if (caught) {
    if (mode === "none" && guessCorrect) points[imposterId] = 2;
    else for (const p of players) if (p.id !== imposterId) points[p.id] = plan[p.id] === imposterId ? 2 : 1;
  } else {
    points[imposterId] = mode === "none" && guessCorrect ? 3 : 2;
  }
  return { accused, caught, points };
}

function nameMap(players, obj) {
  if (!obj) return obj;
  const n = (id) => players.find((p) => p.id === id)?.name.replace(PREFIX + " ", "") ?? id;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [n(k), typeof v === "string" ? n(v) : v]));
}

async function voteRound(players, plan, { changeFirst = false, concurrent = true } = {}) {
  const voters = players.filter((p) => plan[p.id]);
  const last = voters[voters.length - 1];
  const firstVoters = voters.slice(0, -1);
  if (changeFirst) {
    for (const p of firstVoters) {
      const decoy = players.find((q) => q.id !== p.id && q.id !== plan[p.id]);
      if (decoy) {
        const r = await p.emit("game:vote", { targetId: decoy.id });
        check(r.ok, "vote leurre accepte", r);
      }
    }
  }
  const send = (p) => p.emit("game:vote", { targetId: plan[p.id] });
  let res;
  if (concurrent) res = await Promise.all(firstVoters.map(send));
  else {
    res = [];
    for (const p of firstVoters) res.push(await send(p));
  }
  res.forEach((r) => check(r.ok, "vote accepte", r));
  await wait(150);
  for (const p of players) {
    if (!p.state || p.state.phase !== "voting") continue;
    const r = p.state.round;
    check(r.votes === null, `${p.name} ne voit pas les votes des autres pendant le vote`, r.votes);
    if (firstVoters.includes(p)) check(r.myVote === plan[p.id], `${p.name} voit son propre vote`, { myVote: r.myVote, plan: plan[p.id] });
    if (p === last) check(r.myVote === null, `${p.name} n'a pas encore vote`, r.myVote);
    check(r.votedIds.length === firstVoters.length, `${p.name} compte des votants`, r.votedIds.length);
  }
  if (last) {
    const r = await send(last);
    check(r.ok, "dernier vote accepte", r);
  }
}

async function verifyResults(players, plan, imposterId, mode, guessCorrect, label) {
  const exp = expectedOutcome(players, plan, imposterId, mode, guessCorrect);
  for (const p of players) {
    if (!p.state) continue;
    const r = p.state.round;
    check(r.result !== null, `${label} ${p.name} voit le resultat`);
    if (!r.result) continue;
    check(JSON.stringify(nameMap(players, r.votes)) === JSON.stringify(nameMap(players, plan)) ||
      Object.keys(plan).every((k) => r.votes[k] === plan[k]) && Object.keys(r.votes).length === Object.keys(plan).length,
      `${label} ${p.name} votes identiques au plan`, { recu: nameMap(players, r.votes), attendu: nameMap(players, plan) });
    check(r.accusedId === exp.accused, `${label} ${p.name} accuse`, { recu: r.accusedId, attendu: exp.accused });
    check(r.result.imposterId === imposterId, `${label} ${p.name} imposteur`);
    check(r.result.caught === exp.caught, `${label} ${p.name} demasque`);
    check(JSON.stringify(r.result.points) === JSON.stringify(exp.points) ||
      Object.keys(exp.points).every((k) => r.result.points[k] === exp.points[k]),
      `${label} ${p.name} points`, { recu: nameMap(players, r.result.points), attendu: nameMap(players, exp.points) });
    check(r.myVote === (plan[p.id] ?? null), `${label} ${p.name} myVote final`, r.myVote);
  }
  return exp;
}

async function scenarioExhaustive(mode) {
  console.log(`\n== Scenario : 8 combinaisons de votes a 3 joueurs, mode ${mode} ==`);
  const players = await makePlayers(["Awa", "Bakary", "Coumba"]);
  await createRoom(players, { rounds: 8, clueTurns: 1, imposterMode: mode, revealSeconds: 60 });
  const host = players[0];
  const r0 = await host.emit("game:start");
  check(r0.ok, "lancement", r0);
  const totals = Object.fromEntries(players.map((p) => [p.id, 0]));
  for (let combo = 0; combo < 8; combo++) {
    await Promise.all(players.map((p) => p.waitFor((s) => s.phase === "reveal" && s.round.number === combo + 1, 4000, "reveal")));
    const imp = imposterOf(players);
    check(!!imp, "imposteur identifiable");
    for (const p of players) {
      const you = p.state.round.you;
      if (mode === "similar") {
        check(you.isImposter === false, `${p.name} ne sait pas s'il est imposteur (mode similaire)`);
        check(!!you.word, `${p.name} a un mot`);
      } else {
        check(you.isImposter === (p === imp), `${p.name} role connu (classique)`);
        check((you.word === null) === (p === imp), `${p.name} mot cache pour l'imposteur`);
      }
    }
    await revealAll(players);
    await playClues(players);
    check(host.state.phase === "voting", "phase de vote", host.state.phase);
    const plan = {};
    players.forEach((p, i) => {
      const others = players.filter((q) => q !== p);
      plan[p.id] = others[(combo >> i) & 1].id;
    });
    await voteRound(players, plan, { changeFirst: combo % 2 === 1, concurrent: combo % 3 !== 0 });
    let guessCorrect = false;
    if (mode === "none") {
      await Promise.all(players.map((p) => p.waitFor((s) => s.phase === "guess", 3000, "guess")));
      for (const p of players) check(p.state.round.result === null, `${p.name} ne voit pas l'imposteur pendant la devinette`);
      guessCorrect = combo % 2 === 0;
      const word = players.find((p) => p !== imp).state.round.you.word;
      const notImp = players.find((p) => p !== imp);
      const bad = await notImp.emit("game:guess", { guess: word });
      check(!bad.ok && bad.error.code === "not_imposter", "un civil ne peut pas deviner", bad);
      const g = await imp.emit("game:guess", { guess: guessCorrect ? word.toLowerCase() : "mauvaise reponse" });
      check(g.ok, "devinette acceptee", g);
    }
    const endPhase = combo === 7 ? "finished" : "results";
    await Promise.all(players.map((p) => p.waitFor((s) => s.phase === endPhase, 3000, endPhase)));
    const exp = await verifyResults(players, plan, imp.id, mode, guessCorrect, `manche ${combo + 1}`);
    for (const p of players) totals[p.id] += exp.points[p.id];
    for (const p of players) {
      for (const m of p.state.members) check(m.score === totals[m.id], `${p.name} score cumule de ${m.name}`, { recu: m.score, attendu: totals[m.id] });
    }
    console.log(`  manche ${combo + 1}: votes ${JSON.stringify(nameMap(players, plan))} imposteur ${imp.name} -> accuse ${players.find((p) => p.id === exp.accused)?.name ?? "personne"}`);
    if (combo < 7) {
      const late = await players[1].emit("game:vote", { targetId: players[0].id });
      check(!late.ok, "vote refuse apres resolution", late);
      const n = await host.emit("game:next");
      check(n.ok, "manche suivante", n);
      await Promise.all(players.map((p) => p.waitFor((s) => s.round?.number === combo + 2, 3000, "nouvelle manche")));
      for (const p of players) {
        check(p.state.round.myVote === null && p.state.round.votedIds.length === 0, `${p.name} votes remis a zero`);
      }
    }
  }
  check(!!host.state.ranking, "classement final present");
  players.forEach((p) => p.disconnect());
}

async function setupToVoting(names, settings) {
  const players = await makePlayers(names);
  await createRoom(players, { rounds: 3, clueTurns: 1, imposterMode: "similar", ...settings });
  const s = await players[0].emit("game:start");
  check(s.ok, "lancement", s);
  await Promise.all(players.map((p) => p.waitFor((st) => st.phase === "reveal", 3000, "reveal")));
  await revealAll(players);
  await playClues(players);
  return players;
}

async function scenarioSpam() {
  console.log("\n== Scenario : changements de vote rapides (20 envois sans attendre) ==");
  const players = await setupToVoting(["Dado", "Eli", "Fanta"]);
  const [a, b, c] = players;
  const sends = [];
  for (let i = 0; i < 20; i++) sends.push(a.emit("game:vote", { targetId: i % 2 ? b.id : c.id }));
  const res = await Promise.all(sends);
  check(res.every((r) => r.ok), "tous les envois acceptes");
  await wait(150);
  check(a.state.round.myVote === b.id, "le dernier vote envoye est retenu", a.state.round.myVote);
  await Promise.all([b.emit("game:vote", { targetId: c.id }), c.emit("game:vote", { targetId: a.id })]);
  await a.waitFor((s) => s.round.result !== null, 3000, "resultat");
  check(a.state.round.votes[a.id] === b.id && a.state.round.votes[b.id] === c.id && a.state.round.votes[c.id] === a.id, "votes finaux corrects", nameMap(players, a.state.round.votes));
  check(a.state.round.accusedId === null, "egalite a trois : personne accuse");
  players.forEach((p) => p.disconnect());
}

async function scenarioInvalid() {
  console.log("\n== Scenario : votes invalides ==");
  const players = await makePlayers(["Gaoussou", "Hawa", "Issa"]);
  await createRoom(players, { rounds: 1, clueTurns: 1 });
  const [a, b, c] = players;
  const early = await a.emit("game:vote", { targetId: b.id });
  check(!early.ok && early.error.code === "bad_phase", "vote refuse en salle d'attente", early);
  await a.emit("game:start");
  await Promise.all(players.map((p) => p.waitFor((s) => s.phase === "reveal", 3000)));
  await revealAll(players);
  const duringClues = await a.emit("game:vote", { targetId: b.id });
  check(!duringClues.ok && duringClues.error.code === "bad_phase", "vote refuse pendant les indices", duringClues);
  await playClues(players);
  const self = await a.emit("game:vote", { targetId: a.id });
  check(!self.ok, "vote pour soi refuse", self);
  const unknown = await a.emit("game:vote", { targetId: "00000000-0000-4000-8000-000000000000" });
  check(!unknown.ok, "vote pour un inconnu refuse", unknown);
  const garbage = await a.emit("game:vote", { targetId: "pas-un-id" });
  check(!garbage.ok && garbage.error.code === "invalid", "identifiant mal forme refuse", garbage);
  const outsider = new Client(`${PREFIX} Exterieur`);
  await outsider.register();
  await outsider.connect();
  const o = await outsider.emit("game:vote", { targetId: a.id });
  check(!o.ok && o.error.code === "no_room", "un joueur exterieur ne peut pas voter", o);
  check(a.state.round.votedIds.length === 0, "aucun vote invalide enregistre", a.state.round.votedIds);
  outsider.disconnect();
  players.forEach((p) => p.disconnect());
}

async function scenarioDisconnect() {
  console.log("\n== Scenario : un joueur se deconnecte pendant le vote sans voter ==");
  const players = await setupToVoting(["Jean", "Kadi", "Lassana"]);
  const [a, b, c] = players;
  c.disconnect();
  await a.emit("game:vote", { targetId: b.id });
  await b.emit("game:vote", { targetId: a.id });
  await wait(1000);
  check(a.state.phase === "voting", "le vote attend pendant le delai de grace", a.state.phase);
  await a.waitFor((s) => s.round.result !== null, 12000, "resolution apres deconnexion");
  check(Object.keys(a.state.round.votes).length === 2, "seuls les votes des connectes", nameMap(players, a.state.round.votes));
  check(a.state.round.votes[a.id] === b.id && a.state.round.votes[b.id] === a.id, "votes attribues correctement", nameMap(players, a.state.round.votes));
  await c.connect();
  await c.waitFor((s) => s.round?.result !== null, 3000, "resynchronisation");
  check(c.state.round.votes[a.id] === b.id, "le joueur reconnecte voit les memes votes", nameMap(players, c.state.round.votes));
  check(c.state.members.find((m) => m.id === c.id).connected, "le joueur reconnecte est marque connecte");
  players.forEach((p) => p.disconnect());
}

async function scenarioReconnectMidVote() {
  console.log("\n== Scenario : reconnexion rapide en plein vote ==");
  const players = await setupToVoting(["Mariam", "Nouhoum", "Oumou"]);
  const [a, b, c] = players;
  await a.emit("game:vote", { targetId: c.id });
  a.disconnect();
  await wait(1500);
  await a.connect();
  await a.waitFor((s) => s.phase === "voting", 3000, "resynchro");
  check(a.state.round.myVote === c.id, "le vote est conserve apres reconnexion", a.state.round.myVote);
  await b.emit("game:vote", { targetId: c.id });
  await c.emit("game:vote", { targetId: b.id });
  await a.waitFor((s) => s.round.result !== null, 3000, "resultat");
  check(a.state.round.votes[a.id] === c.id && a.state.round.votes[b.id] === c.id && a.state.round.votes[c.id] === b.id, "votes corrects", nameMap(players, a.state.round.votes));
  check(a.state.round.accusedId === c.id, "le bon joueur est accuse");
  players.forEach((p) => p.disconnect());
}

async function scenarioLeave() {
  console.log("\n== Scenario : un joueur quitte la partie pendant le vote ==");
  const players = await setupToVoting(["Paul", "Rokia", "Sekou"]);
  const [a, b, c] = players;
  await c.emit("game:vote", { targetId: a.id });
  const l = await c.emit("room:leave");
  check(l.ok, "depart accepte", l);
  await a.emit("game:vote", { targetId: b.id });
  await b.emit("game:vote", { targetId: a.id });
  await a.waitFor((s) => s.round.result !== null, 3000, "resultat");
  check(a.state.round.votes[c.id] === a.id, "le vote du joueur parti est conserve", nameMap(players, a.state.round.votes));
  check(a.state.round.accusedId === a.id, "accusation correcte (2 votes contre Paul)");
  check(c.state === null, "le joueur parti ne recoit plus l'etat");
  players.forEach((p) => p.disconnect());
}

async function scenarioHostLeaves() {
  console.log("\n== Scenario : l'hote quitte en cours de partie ==");
  const players = await makePlayers(["Tata", "Ursule", "Vieux", "Wassa"]);
  await createRoom(players, { rounds: 2, clueTurns: 1 });
  const [a, b, c, d] = players;
  await a.emit("game:start");
  await Promise.all(players.map((p) => p.waitFor((s) => s.phase === "reveal", 3000)));
  await a.emit("room:leave");
  await b.waitFor((s) => s.hostId !== a.id, 3000, "transfert d'hote");
  check(b.state.hostId === b.id, "le joueur suivant devient hote", b.state.hostId);
  await Promise.all([b, c, d].map((p) => p.emit("game:seen")));
  await b.waitFor((s) => s.phase === "clues", 3000);
  await playClues([b, c, d, a]);
  await b.emit("game:vote", { targetId: c.id });
  await c.emit("game:vote", { targetId: d.id });
  await d.emit("game:vote", { targetId: c.id });
  await b.waitFor((s) => s.phase === "results", 3000);
  check(b.state.round.votes[b.id] === c.id && b.state.round.votes[c.id] === d.id && b.state.round.votes[d.id] === c.id, "votes corrects apres depart de l'hote", nameMap(players, b.state.round.votes));
  check(b.state.round.accusedId === c.id, "accusation correcte");
  const n = await b.emit("game:next");
  check(n.ok, "le nouvel hote lance la manche suivante", n);
  players.forEach((p) => p.disconnect());
}

async function scenarioTimeout() {
  console.log("\n== Scenario : fin du temps de vote avec un seul vote (20 s) ==");
  const players = await setupToVoting(["Yaya", "Zeinab", "Adama"], { voteSeconds: 20 });
  const [a, b, c] = players;
  await a.emit("game:vote", { targetId: c.id });
  await a.waitFor((s) => s.round.result !== null, 25000, "fin du temps");
  check(Object.keys(a.state.round.votes).length === 1 && a.state.round.votes[a.id] === c.id, "seul le vote emis est compte", nameMap(players, a.state.round.votes));
  check(a.state.round.accusedId === c.id, "accusation avec un seul vote");
  players.forEach((p) => p.disconnect());
}

async function scenarioSameNames() {
  console.log("\n== Scenario : deux joueurs avec le meme nom ==");
  const players = await setupToVoting(["Moussa", "Moussa", "Bintou"]);
  const [a, b, c] = players;
  check(a.id !== b.id, "identifiants distincts");
  await a.emit("game:vote", { targetId: c.id });
  await b.emit("game:vote", { targetId: a.id });
  await c.emit("game:vote", { targetId: a.id });
  await a.waitFor((s) => s.round.result !== null, 3000);
  check(a.state.round.votes[b.id] === a.id && a.state.round.votes[c.id] === a.id && a.state.round.votes[a.id] === c.id, "votes distincts malgre les noms identiques");
  check(a.state.round.accusedId === a.id, "accusation correcte");
  players.forEach((p) => p.disconnect());
}

const only = process.argv[2];
const scenarios = {
  exhaustiveSimilar: () => scenarioExhaustive("similar"),
  exhaustiveClassic: () => scenarioExhaustive("none"),
  spam: scenarioSpam,
  invalid: scenarioInvalid,
  disconnect: scenarioDisconnect,
  reconnect: scenarioReconnectMidVote,
  leave: scenarioLeave,
  hostLeaves: scenarioHostLeaves,
  sameNames: scenarioSameNames,
  timeout: scenarioTimeout,
};
for (const [name, fn] of Object.entries(scenarios)) {
  if (only && only !== name) continue;
  try {
    await fn();
  } catch (err) {
    failures++;
    console.log(`  ERREUR dans ${name}:`, err.message);
  }
}
console.log(`\n${checks} verifications, ${failures} echec(s)`);
process.exit(failures ? 1 : 0);
