import { cp, mkdir, rm } from 'node:fs/promises'

const files = ['index.html', 'styles.css', 'game.js', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'maskable-icon.svg']
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await Promise.all(files.map((file) => cp(file, `dist/${file}`)))
console.log(`Built ${files.length} static files into dist/`)
