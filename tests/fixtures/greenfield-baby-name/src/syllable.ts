// Reference syllable counter — the kind of pattern PLAN would search for
// when SOURCE_CHECK.md needs an SC-REF entry for syllable scoring.
export function countSyllables(word: string): number {
  if (word.length === 0) return 0
  const vowelGroups = word.toLowerCase().match(/[aeiouy]+/g) ?? []
  return Math.max(1, vowelGroups.length)
}
