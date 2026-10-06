/**
 * Parser for tier data sent to the Telegram bot.
 * Supported line formats (first match wins):
 * - "Имя (тир)"  e.g. "Азимов (2+)"   <- what the bot actually receives
 * - "Имя,тир"    e.g. "Робот,2+"
 * - "Имя:тир"    e.g. "Робот:2+"
 * Lines starting with # or // are ignored.
 */

// Valid tier values
const VALID_TIERS = ['1', '1+', '1-', '2', '2+', '2-', '3', '3+', '3-', '4', 'un-tired', 'скам']

/**
 * Strip decoration from a name, keeping letters of ANY script (incl. Cyrillic),
 * digits, spaces, hyphens and apostrophes.
 * NOTE: \w is [A-Za-z0-9_] in JS and does NOT match Cyrillic - using it here
 * used to blank out every Russian name, which made every lookup match the
 * first mutant in the list. Unicode property escapes are required.
 */
function normalizeForComparison(str) {
  return String(str)
    .replace(/[«»"'`]/g, '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Normalize tier value to accepted format
 * Valid tiers: 1, 1+, 1-, 2, 2+, 2-, 3, 3+, 3-, 4, un-tired, скам
 */
function normalizeTierValue(tier) {
  tier = String(tier).trim()

  // Direct mapping (case-insensitive for Russian text)
  const tierUpper = tier.toUpperCase()
  const tierMapping = {
    1: '1',
    '1+': '1+',
    '1-': '1-',
    2: '2',
    '2+': '2+',
    '2-': '2-',
    3: '3',
    '3+': '3+',
    '3-': '3-',
    4: '4',
    'UN-TIRED': 'un-tired',
    СКАМ: 'скам',
    // Russian variations
    '1ПЛЮС': '1+',
    '1МИНУС': '1-',
    '2ПЛЮС': '2+',
    '2НОРМ': '2',
    '2МИНУС': '2-',
    '3ПЛЮС': '3+',
    '3НОРМ': '3',
    '3МИНУС': '3-',
    '4НОРМ': '4',
  }

  const normalizedTier = tierMapping[tierUpper] || tier

  if (!VALID_TIERS.includes(normalizedTier)) {
    throw new Error(
      `Invalid tier value: ${normalizedTier}. Valid tiers are: ${VALID_TIERS.join(', ')}`,
    )
  }

  return normalizedTier
}

/**
 * Find ALL mutant IDs matching a Russian name.
 * Returns an array because distinct mutants can share a name (e.g. "Колосс" is
 * both specimen_ae_01 and specimen_ce_99) - returning only the first would
 * leave the other one's tier permanently stale.
 * Exact matches first; the substring fallback is guarded so it can never
 * degrade into "empty string matches everything".
 */
function findMutantIdsByName(name, nameToIds) {
  const cleanedName = String(name)
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (!cleanedName) return []

  // 1. Exact match on the raw / cleaned name
  if (nameToIds[cleanedName]) return nameToIds[cleanedName]
  if (nameToIds[name]) return nameToIds[name]

  // 2. Exact match on the normalized form
  const normalizedInput = normalizeForComparison(cleanedName)
  if (!normalizedInput) return []

  for (const [storedName, mutantIds] of Object.entries(nameToIds)) {
    if (normalizeForComparison(storedName) === normalizedInput) return mutantIds
  }

  // 3. Guarded substring fallback: both sides must be reasonably long, and
  //    among the candidates we take the closest one by length. A short input
  //    is never allowed to swallow an unrelated mutant.
  if (normalizedInput.length < 4) return []

  let best = null
  let bestDelta = Infinity
  for (const [storedName, mutantIds] of Object.entries(nameToIds)) {
    const normalizedStored = normalizeForComparison(storedName)
    if (normalizedStored.length < 4) continue

    if (normalizedStored.includes(normalizedInput) || normalizedInput.includes(normalizedStored)) {
      const delta = Math.abs(normalizedStored.length - normalizedInput.length)
      if (delta < bestDelta) {
        bestDelta = delta
        best = mutantIds
      }
    }
  }

  return best ?? []
}

/**
 * Back-compat helper: first matching ID or null.
 */
function findMutantIdByName(name, nameToIds) {
  const ids = findMutantIdsByName(name, nameToIds)
  return ids.length > 0 ? ids[0] : null
}

/**
 * Split one line into [name, tier]. Returns null if the line carries no tier.
 */
function splitLine(line) {
  // "Имя (тир)"
  const parenMatch = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (parenMatch) return [parenMatch[1], parenMatch[2]]

  // "Имя,тир"
  if (line.includes(',')) {
    const parts = line.split(',')
    if (parts.length >= 2) return [parts[0], parts.slice(1).join(',')]
  }

  // "Имя:тир"
  if (line.includes(':')) {
    const parts = line.split(':')
    if (parts.length >= 2) return [parts[0], parts.slice(1).join(':')]
  }

  return null
}

/**
 * Load mapping from Russian names to mutant IDs
 * @param {string} mutantsJson - JSON string of mutants data
 */
function loadMutantMapping(mutantsJson) {
  console.log(`loadMutantMapping: received ${mutantsJson ? mutantsJson.length : 0} chars`)

  if (!mutantsJson || mutantsJson.length === 0) {
    throw new Error('Empty mutantsJson received')
  }

  let mutantsData
  try {
    mutantsData = JSON.parse(mutantsJson)
  } catch (e) {
    console.error(`JSON parse error: ${e.message}`)
    console.error(`First 500 chars: ${mutantsJson.slice(0, 500)}`)
    throw new Error(`Invalid JSON: ${e.message}`)
  }

  const nameToIds = {}
  const addVariant = (variant, mutantId) => {
    // Empty keys are what let a blank normalization match every lookup.
    if (!variant) return
    if (!nameToIds[variant]) nameToIds[variant] = []
    if (!nameToIds[variant].includes(mutantId)) nameToIds[variant].push(mutantId)
  }

  for (const mutant of mutantsData) {
    if (!mutant || !mutant.name || !mutant.id) continue

    const name = String(mutant.name).trim().toLowerCase()
    addVariant(name, mutant.id)
    addVariant(
      String(mutant.name)
        .replace(/[«»"'`]/g, '')
        .trim()
        .toLowerCase(),
      mutant.id,
    )
    addVariant(normalizeForComparison(mutant.name), mutant.id)
    addVariant(String(mutant.name).replace(/\s+/g, ' ').trim().toLowerCase(), mutant.id)
  }

  console.log(`Loaded ${Object.keys(nameToIds).length} mutant mappings`)
  return nameToIds
}

/**
 * Parse tier data from text content (main function)
 * @param {string} content - Text content with tier data
 * @param {string} mutantsJson - JSON string of mutants data
 */
function parseTierData(content, mutantsJson) {
  const nameToIds = loadMutantMapping(mutantsJson)

  const tiers = {}
  // Files arrive from Telegram with CRLF line endings.
  const lines = String(content).split(/\r?\n/)

  for (const line of lines) {
    const processedLine = line.trim()
    if (!processedLine || processedLine.startsWith('#') || processedLine.startsWith('//')) {
      continue
    }

    // One malformed line must never abort the whole file.
    try {
      const split = splitLine(processedLine)
      if (!split) continue

      const mutantName = split[0].trim().toLowerCase()
      const tier = normalizeTierValue(split[1])

      // A name can legitimately belong to several mutants - set the tier on all.
      const mutantIds = findMutantIdsByName(mutantName, nameToIds)
      if (mutantIds.length > 0) {
        for (const mutantId of mutantIds) tiers[mutantId] = tier
      } else {
        console.log(`NOT FOUND: "${mutantName}" (tier: ${tier})`)
      }
    } catch (e) {
      console.log(`SKIPPED LINE: "${processedLine}" - ${e.message}`)
    }
  }

  return tiers
}

// Export functions for use in other modules
export {
  parseTierData,
  normalizeTierValue,
  loadMutantMapping,
  findMutantIdsByName,
  findMutantIdByName,
  normalizeForComparison,
}
