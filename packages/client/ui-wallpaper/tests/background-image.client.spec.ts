/**
 * Pins the wallpaper stylesheet to the source image: the bundled CSS embeds
 * the JPEG as a data URI because the client-modules route serves only
 * lib/client.js — no companion asset file has an HTTP route.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('wallpaper asset', () => {
  it('embeds exactly the bundled JPEG as the background image source', () => {
    const image = readFileSync(fileURLToPath(new URL('../src/client/background.jpg', import.meta.url)))
    const css = readFileSync(fileURLToPath(new URL('../src/client/background.module.css', import.meta.url)), 'utf8')
    expect(css).toContain(`url('data:image/jpeg;base64,${image.toString('base64')}')`)
  })
})
