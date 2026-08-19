import { ValidationError } from './errors.js'

export function parseVersion(input) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input)
  if (match === null) throw new ValidationError(`unsupported semantic version ${input}`)
  return {
    raw: input,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.').map(part => /^\d+$/.test(part) ? Number(part) : part) ?? [],
  }
}

export function compareVersions(leftInput, rightInput) {
  const left = typeof leftInput === 'string' ? parseVersion(leftInput) : leftInput
  const right = typeof rightInput === 'string' ? parseVersion(rightInput) : rightInput
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    if (typeof a === 'number' && typeof b !== 'number') return -1
    if (typeof a !== 'number' && typeof b === 'number') return 1
    return a < b ? -1 : 1
  }
  return 0
}

function satisfiesComparator(version, comparator) {
  const match = /^(<=|>=|<|>|=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(comparator.trim())
  if (match === null) throw new ValidationError(`unsupported version comparator ${comparator}`)
  const comparison = compareVersions(version, match[2])
  return match[1] === '<' ? comparison < 0
    : match[1] === '<=' ? comparison <= 0
      : match[1] === '>' ? comparison > 0
        : match[1] === '>=' ? comparison >= 0
          : comparison === 0
}

export function satisfies(version, range = '*') {
  const trimmed = range.trim()
  if (trimmed === '' || trimmed === '*') return true
  if (trimmed.includes('||')) return trimmed.split('||').some(branch => satisfies(version, branch))
  if (trimmed.startsWith('^')) {
    const base = parseVersion(trimmed.slice(1))
    const upper = base.major > 0 ? `${base.major + 1}.0.0`
      : base.minor > 0 ? `0.${base.minor + 1}.0` : `0.0.${base.patch + 1}`
    return compareVersions(version, base) >= 0 && compareVersions(version, upper) < 0
  }
  if (trimmed.startsWith('~')) {
    const base = parseVersion(trimmed.slice(1))
    return compareVersions(version, base) >= 0 && compareVersions(version, `${base.major}.${base.minor + 1}.0`) < 0
  }
  return trimmed.split(/\s+/).every(comparator => satisfiesComparator(version, comparator))
}
