/**
 * Mutant Type Availability Filtering
 *
 * This module defines which mutant types can be bred and under what conditions.
 */

import { normalizeSearch } from '@/lib/search-normalize';

/**
 * Mutant types that CANNOT be bred under any circumstances.
 * These never appear in breeding results, even when breeding two of the same type.
 */
export const UNBREEDABLE_TYPES = new Set([
  'recipe',      // Recipe mutants (secret recipes only)
  'videogame',   // Video game crossover mutants
  'zodiac',      // Zodiac mutants
  'special',     // Special mutants
  'gacha',       // Gacha/Reactor mutants
  'community',   // Community mutants
  'seasonal',    // Seasonal mutants (e.g., Lincoln)
]);

/**
 * Mutant types that can ONLY be bred through inheritance.
 * These only appear if one of the parents is exactly this mutant.
 */
export const INHERITANCE_ONLY_TYPES = new Set([
  'heroic',      // Hero mutants
  'pvp'          // PvP mutants
]);

/**
 * Legendary mutants that are globally breedable (can be bred from any matching genes).
 * These are exceptions to the "Inheritance Only" rule for legendary types.
 *
 * All names are normalized (lowercase, alphanumeric only) for comparison.
 */
export const BREEDABLE_LEGENDS = new Set([
  // Normalized Russian names (as returned by normalizeSearch)
  'человек',
  'хуман',
  'дезингер',
  'механорог',
  'инвадрон',
  'проклятыйгонщик',
  'тачдаун',
  'жуткиймишка',
  'рагнар',
  'бакморис',
  'стражгалактики',
  'тор',
  'кобракай',
  'космоконг',
  'абсолем',
  'долгоног',
  'звездныйдесантник',
  'вампаа',
  'мастерйоуда',
  'анубис',
  'воронийглаз'
  // NOTE: Secret/Recipe mutants excluded:
  // буши, капитанкостьмилягу, капитангаечныйключ, мантидроид,
  // пожиратель, темновзор, перехватчица, киберслизень, коммодоракула
]);

/**
 * Checks if a mutant type is completely unbreedable.
 *
 * @param type The mutant's type (case-insensitive)
 * @returns true if this type cannot be bred at all
 */
export function isUnbreedableType(type: string | undefined): boolean {
  if (!type) return false;
  return UNBREEDABLE_TYPES.has(type.toLowerCase());
}

/**
 * Checks if a mutant type requires inheritance (one parent must be this exact mutant).
 *
 * @param type The mutant's type (case-insensitive)
 * @returns true if this type can only be inherited
 */
export function isInheritanceOnlyType(type: string | undefined): boolean {
  if (!type) return false;
  return INHERITANCE_ONLY_TYPES.has(type.toLowerCase());
}

/**
 * Checks if a legendary mutant is globally breedable (not inheritance-only).
 *
 * @param name The mutant's name
 * @returns true if this legend can be bred from any matching genes
 */
export function isBreedableLegend(name: string): boolean {
  const normalized = normalizeSearch(name);
  return BREEDABLE_LEGENDS.has(normalized);
}

/**
 * Determines if a mutant can appear in breeding results based on its type and the parents.
 *
 * @param mutant The candidate offspring mutant
 * @param parent1Id The first parent's ID
 * @param parent2Id The second parent's ID
 * @returns true if this mutant can be bred from these parents (based on type rules only)
 */
export function canBreedByType(
  mutant: { id: string; name: string; type?: string },
  parent1Id: string,
  parent2Id: string
): boolean {
  const mutantType = (mutant.type || 'default').toLowerCase();
  const mutantId = String(mutant.id);

  // 1. Unbreedable types: Never appear (includes 'secret' and 'recipe')
  if (isUnbreedableType(mutantType)) {
    return false;
  }

  // 2. Legendary type: Check if it's in the breedable list OR is a parent
  if (mutantType === 'legend' || mutantType === 'legendary') {
    const isParent = mutantId === parent1Id || mutantId === parent2Id;
    const isBreedable = isBreedableLegend(mutant.name);
    return isParent || isBreedable;
  }

  // 3. Inheritance-only types (Heroic, PvP): Only if one parent is this mutant
  if (isInheritanceOnlyType(mutantType)) {
    return mutantId === parent1Id || mutantId === parent2Id;
  }

  // 4. Normal/Default types: Always breedable if genes match
  return true;
}

/**
 * Gets a descriptive tag for a breeding result based on type rules.
 *
 * @param mutant The offspring mutant
 * @param parent1Id First parent's ID
 * @param parent2Id Second parent's ID
 * @returns A tag like 'КОПИЯ' (copy), 'ВОЗМОЖНО' (possible), etc.
 */
export function getBreedingTag(
  mutant: { id: string; name: string; type?: string },
  parent1Id: string,
  parent2Id: string
): string {
  const mutantId = String(mutant.id);
  const isParent = mutantId === parent1Id || mutantId === parent2Id;

  return isParent ? 'КОПИЯ' : 'ВОЗМОЖНО';
}
