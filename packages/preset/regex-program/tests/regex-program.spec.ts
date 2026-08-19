import { describe, expect, it } from 'vitest'
import { RegexProgramError, testRegex } from '../src/index.ts'

describe('preset regex worker', () => {
  it('returns the transformed text and first-match captures from the isolated evaluator', async () => {
    await expect(testRegex({
      id: 'wrap', name: 'Wrap', find: '(hello) (world)', replace: '$2, $1', flags: 'g',
    }, 'hello world')).resolves.toMatchObject({ output: 'world, hello', captures: ['hello', 'world'] })
  })

  it('measures UTF-8 bytes rather than JavaScript code units', async () => {
    await expect(testRegex({ id: 'noop', name: 'Noop', find: 'x', replace: 'x' }, '你好', {
      maxInputBytes: 5,
    })).rejects.toBeInstanceOf(RegexProgramError)
  })

  it('reports illegal flags with the script id', async () => {
    await expect(testRegex({ id: 'bad-flags', name: 'Bad flags', find: 'x', replace: '', flags: 'qq' }, 'x'))
      .rejects.toThrow('bad-flags')
  })
})
