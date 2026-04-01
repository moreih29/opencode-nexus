export function extractTags(markdown: string): string[] {
  const m = markdown.match(/<!--\s*tags:\s*([^>]+)\s*-->/i);
  if (!m) {
    return [];
  }
  return m[1]
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function ensureTagsFrontmatter(content: string, tags?: string[]): string {
  if (!tags || tags.length === 0) {
    return content;
  }
  if (/<!--\s*tags:/i.test(content)) {
    return content;
  }
  const normalized = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) {
    return content;
  }
  return `<!-- tags: ${normalized.join(", ")} -->\n${content}`;
}

export function matchesHint(content: string, hint?: string): boolean {
  if (!hint || hint.trim().length === 0) {
    return true;
  }
  const tags = extractTags(content);
  if (tags.length === 0) {
    return false;
  }
  const hints = hint
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return hints.some((h) => tags.includes(h));
}
