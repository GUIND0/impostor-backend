const articles = /^(?:(?:les|le|la|une|un|des|du|de la)\s+|(?:de l|l)')/;

export function normalizeWord(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .trim()
    .replace(articles, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

export function isCorrectGuess(guess: string, word: string): boolean {
  const g = normalizeWord(guess);
  const w = normalizeWord(word);
  if (!g) return false;
  if (g === w) return true;
  if (w.length >= 5 && levenshtein(g, w) <= 1) return true;
  if (g.length >= 4 && (g === w + "s" || g + "s" === w)) return true;
  return false;
}
