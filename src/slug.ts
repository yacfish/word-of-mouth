// Turns a page title into a URL slug.

export function slugify(title: string): string {
  let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > 60) slug = slug.slice(0, 60).replace(/-+$/g, '');
  return slug || 'page';
}

export function allocateSlug(title: string, taken: (slug: string) => boolean): string {
  const base = slugify(title);
  if (!taken(base)) return base;
  for (let n = 2; n < 100000; n += 1) {
    const suffix = `-${n}`;
    let stem = base;
    if (stem.length + suffix.length > 60) {
      stem = stem.slice(0, 60 - suffix.length).replace(/-+$/g, '');
    }
    if (!stem) stem = 'page';
    const candidate = `${stem}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error('No slug available');
}
