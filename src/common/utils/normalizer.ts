export function normalizeToStore(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;

  const clean = String(value).trim().replace(/\s+/g, " ");
  if (!clean) return undefined;

  return clean.toUpperCase();
}

export function normalizeComparable(value?: string | null): string {
  if (!value) return "";

  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function areEquivalent(a?: string | null, b?: string | null): boolean {
  return normalizeComparable(a) === normalizeComparable(b);
}

export function sanitizeDeep<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeDeep(item)) as T;
  }

  if (input && typeof input === "object") {
    const out: any = {};
    for (const [key, value] of Object.entries(input as Record<string, any>)) {
      out[key] = sanitizeDeep(value);
    }
    return out;
  }

  if (typeof input === "string") {
    return (normalizeToStore(input) ?? "") as T;
  }

  return input;
}