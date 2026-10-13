import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Design rule: the app's own UI never uses emoji as decoration or icons (they look cheap next to the icon set).
// Use lucide icons, IconTile, ReactionIcon or GroupIcon instead. Emoji that members type stay as typed (user content).
// Where a stored value must be an emoji (reactions, group icons), write it as a code-point escape: '\u{1F44D}'.
const root = join(__dirname, '..')
const PICTO = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/u
const ALLOWED = new Set(['©', '®', '™', '▪'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
}

describe('no emoji in UI source', () => {
  it('src/**/*.ts(x) contains no emoji characters', () => {
    const hits: string[] = []
    for (const f of files(root)) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const ch of line) {
            if (PICTO.test(ch) && !ALLOWED.has(ch)) {
              hits.push(`${relative(root, f)}:${i + 1} ${JSON.stringify(ch)} ${line.trim().slice(0, 80)}`)
              break
            }
          }
        })
    }
    expect(hits).toEqual([])
  })
})
