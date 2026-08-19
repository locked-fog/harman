import { writeFile } from 'node:fs/promises'
import { StateStore, addPackage } from '../src/index.js'

const [root, stage, marker] = process.argv.slice(2)
const store = new StateStore(root, {
  async failpoint(actualStage) {
    if (actualStage !== stage) return
    await writeFile(marker, actualStage)
    await new Promise(() => { setInterval(() => {}, 1000) })
  },
})
await store.initialize()
await store.transaction({ action: `crash.${stage}` }, draft => addPackage(draft, {
  name: 'crash-fixture', version: '1', contentHash: '9'.repeat(64),
}))
