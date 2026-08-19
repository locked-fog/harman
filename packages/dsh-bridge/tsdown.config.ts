import { clientBundle } from '../../client/tsdown.client.ts'
import { typertPlugin } from '../../typert/generator/lib/types/tsdown-plugin.js'

const bundle = clientBundle('@harman/dsh-bridge', ['lib/types/index.js'], { hostPhase: true })

export default (inline: { env?: Record<string, unknown> }) => bundle(inline).map(config => {
  if (inline.env?.DSH_BUILD_FACE !== 'host' || config.entry === '') return config
  return { ...config, plugins: [...(config.plugins ?? []), typertPlugin({ mode: 'package', faces: ['host'] })] }
})
