import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-api-remotes',
  ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/client-safe.js'],
  { hostPhase: true },
)
