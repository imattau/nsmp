import puppeteer from 'puppeteer'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = new URL('../ui/dist', import.meta.url).pathname
const PORT = 8765
const SCREENSHOTS = new URL('../screenshots', import.meta.url).pathname

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

const server = createServer((req, res) => {
  let path = new URL(req.url, `http://localhost:${PORT}`).pathname
  if (path === '/') path = '/index.html'
  const file = join(ROOT, path)
  if (!existsSync(file)) {
    // SPA fallback
    const index = readFileSync(join(ROOT, 'index.html'))
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(index)
    return
  }
  const ext = extname(file)
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  res.end(readFileSync(file))
})

server.listen(PORT, async () => {
  console.log(`Server on http://localhost:${PORT}`)

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/home/mattthomson/.local/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = await browser.newPage()

  // Desktop login
  await page.setViewport({ width: 1280, height: 800 })
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' })
  await page.screenshot({ path: join(SCREENSHOTS, 'login-desktop.png'), fullPage: true })
  console.log('login-desktop.png')

  // Mobile login
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' })
  await page.screenshot({ path: join(SCREENSHOTS, 'login-mobile.png'), fullPage: true })
  console.log('login-mobile.png')

  await browser.close()
  server.close()
  console.log('done')
})
