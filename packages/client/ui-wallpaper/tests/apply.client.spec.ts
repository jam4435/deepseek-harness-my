/** Wallpaper plugin body: an empty service face whose only effect is the imported stylesheet. */
import { describe, expect, it } from 'vitest'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-wallpaper/client'

describe('ui-wallpaper apply', () => {
  it('declares no services and applies without a context', () => {
    expect(inject).toEqual([])
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
