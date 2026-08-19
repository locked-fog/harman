import { mkdir, writeFile } from 'node:fs/promises'

const home = process.env.DSH_HOME
await mkdir(home + '/sessions', { recursive: true })
await writeFile(home + '/settings.yaml', 'home: ' + home + '\n')
await writeFile(home + '/sessions/run.txt', process.argv.join(' '))
const attempts = {}
for (const [key, path] of [['forbidden', process.env.HARMAN_PROBE_FORBIDDEN], ['other', process.env.HARMAN_OTHER_HOME]]) {
  if (!path) continue
  try {
    await writeFile(path + '/escape.txt', 'bad')
    attempts[key] = 'writable'
  } catch (error) {
    attempts[key] = error.code
  }
}
console.log(JSON.stringify({ home, attempts, argv: process.argv.slice(2) }))
