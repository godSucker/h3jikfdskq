// Donate packs "bank_*" carry the mutant only inside <ArticleItems>, not in the
// itemId and not in obtain.json, so the usual itemId linking never finds them.
// Only single-mutant packs are linked (a pack with several specimens is a
// random pool, not a guaranteed appearance), and when one filter has several
// price tiers of the same pack (10ct / 25ct / 60ct) only the first tier is
// kept, so the recent-appearances list does not show the same day three times.
export function bankPackMutants(shopXml: string, mutantIds: Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const item of shopXml.match(/<ShopItem\b[^>]*>[\s\S]*?<\/ShopItem>/g) ?? []) {
    const itemId = item.match(/itemId="([^"]+)"/)?.[1]
    if (!itemId || !/^bank_/i.test(itemId)) continue
    const filter = item.match(/<Filter>([^<]*)<\/Filter>/)?.[1]
    if (!filter) continue
    const specimens = new Set(
      [...item.matchAll(/<ArticleItem\b[^>]*typeId="(Specimen_[A-Z]{2}_\d{2})"/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    )
    if (specimens.size !== 1) continue
    const [mutantId] = specimens
    if (!mutantIds.has(mutantId)) continue
    const key = `${filter}|${mutantId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.set(itemId, [mutantId])
  }
  return out
}
