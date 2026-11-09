/**
 * Test fixtures.
 *
 * The suite must not depend on whatever the developer happens to keep in
 * `packs/local/` (private or generated skins). These helpers copy the shipped
 * packs into a temp directory so assertions stay deterministic.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'packs')

/** A temp packs root containing only the packs shipped in this repository. */
export function repoOnlyPacks() {
  const root = mkdtempSync(join(tmpdir(), 'fish-packs-'))
  for (const name of readdirSync(REPO_PACKS)) {
    if (name === 'local') continue
    cpSync(join(REPO_PACKS, name), join(root, name), { recursive: true })
  }
  return root
}

export function cleanup(root) {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {}
}
