import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const files = ['index.html', 'styles.css', 'game.js', 'market.js', 'portfolio.js', 'tycoon.js', 'advanced.js', 'world.js', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'maskable-icon.svg']

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await Promise.all(files.map((file) => cp(file, `dist/${file}`)))

// Phase 5 compatibility fix: two city meshes still referenced the old material helper name.
const gamePath = 'dist/game.js'
const gameSource = await readFile(gamePath, 'utf8')
const fixedGameSource = gameSource
  .replace('new THREE.PlaneGeometry(52,42),mat(', 'new THREE.PlaneGeometry(52,42),material(')
  .replace('new THREE.PlaneGeometry(15,40),mat(', 'new THREE.PlaneGeometry(15,40),material(')

if (fixedGameSource.includes('new THREE.PlaneGeometry(52,42),mat(') || fixedGameSource.includes('new THREE.PlaneGeometry(15,40),mat(')) {
  throw new Error('Phase 5 startup compatibility patch was not applied')
}

await writeFile(gamePath, fixedGameSource)
console.log(`Built ${files.length} static files into dist/ with Phase 5 startup fix`)
