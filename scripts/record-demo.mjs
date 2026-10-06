#!/usr/bin/env node
/**
 * Records the demo walkthrough at 1080p, paced to the voiceover script, and (optionally) adds the voice.
 *
 *   npm run dev                                                  (in another terminal)
 *   npm run record -- --url http://localhost:5173                silent video, paced for you to read over
 *   npm run record:voice -- --url http://localhost:5173          video with the script spoken
 *
 * Voice: ElevenLabs when ELEVENLABS_API_KEY is set (in the environment or in .env.local), otherwise the
 * Mac's built-in voice. Force one with --voice elevenlabs | mac | none. Optional settings in .env.local:
 *   ELEVENLABS_VOICE_ID=...       which voice (default: a premade ElevenLabs voice)
 *   ELEVENLABS_MODEL=...          default eleven_multilingual_v2
 *   MAC_VOICE=Samantha
 * Generated speech is cached in demo/voice/, so re-recording doesn't spend credits again.
 *
 * Output in demo/: thaw-demo.mp4 (silent), thaw-demo-voiced.mp4 (with voice), thaw-demo-cues.md
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import ffmpegPath from 'ffmpeg-static'
import { chromium } from 'playwright-core'

// ---- The script. Each line is spoken (or left for you to read) while its part of the walkthrough plays.
const LINES = {
  intro: 'Imagine selling $1,000 on Stripe and having $100 of it frozen for three months, even after every order arrives. I’m Rayhan, and this is Thaw: reserves that thaw as trust is proven.',
  problem: 'Today, risky merchants can have up to 25% of their sales held for 90 to 180 days. Merchants notice: Stripe’s Trustpilot rating is 1.6 out of 5.',
  solution: 'But every order gets safer as proof arrives, and Thaw uses that. This $100 order starts with today’s $10 hold.',
  verified: '3D Secure confirms the real cardholder paid, so the fraud cover comes back.',
  delivered: 'The carrier confirms delivery, and more comes back.',
  fades: 'The rest shrinks as the dispute window closes.',
  results:
    'I replayed a year of payments from 300 simulated stores. Thaw holds half as much money, half of it is back by day 7 instead of day 90, and losses stay level. Across Stripe, that’s about $1.6 billion back with merchants.',
  merchant: 'Here’s what a merchant sees: $4,587 on hold instead of $8,654, mostly waiting on delivery proof.',
  tracking: 'She adds tracking to 234 orders, and $2,597 comes back on the spot.',
  sale: 'Across 670,000 simulated orders, a third of the money comes back the day of the sale and half within a week. Today’s reserve waits until day 90.',
  admin: 'Stripe’s risk team sees the same store. If anything looks wrong, one click puts it back on today’s reserve.',
  year: 'Across 300 stores and a full year, Thaw holds about half as much, and the safety switch caught ten of sixteen failing stores, typically nine days early.',
  normal: 'Then I stress-tested it. A normal year: safe in all six simulated years.',
  noFloor: 'Remove the safety minimum, and losses break the limit.',
  stress: 'Triple the store failures: still safe.',
  scam: 'The real weak spot is scammers faking delivery proof.',
  fix: 'So new stores start on today’s reserve until they earn trust. Safe again, with 37% less held.',
  close: 'Next, I’d test this in shadow mode on Stripe’s real payments. Merchants get money back as fast as they can prove it’s safe, and Stripe keeps every control. Thanks for watching.',
}

// ---- Settings
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
if (existsSync('.env.local')) {
  for (const row of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = row.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
const BASE = arg('url', 'http://localhost:5173').replace(/\/$/, '')
const OUT_DIR = arg('out', 'demo')
const VOICE = arg('voice', process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'mac')
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const W = 1440
const H = 810
const SCALE = 4 / 3 // 1440x810 CSS pixels, captured at 1920x1080
const FPS = 30
const WORDS_PER_SEC = 2.6 // pacing for a silent video: about 155 words a minute
const GAP = 0.45 // seconds of quiet after each spoken line
const NAV = 64

// ---- Voice: one audio clip per line, cached by its text and voice.
const durationOf = (file) => {
  const m = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/)
  if (!m) throw new Error(`Could not read the length of ${file}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

async function speak(text) {
  const dir = `${OUT_DIR}/voice`
  mkdirSync(dir, { recursive: true })
  if (VOICE === 'elevenlabs') {
    const key = process.env.ELEVENLABS_API_KEY
    if (!key) throw new Error('Set ELEVENLABS_API_KEY in .env.local (or use --voice mac).')
    const voiceId = process.env.ELEVENLABS_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb'
    const model = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2'
    const file = `${dir}/el-${createHash('sha1').update(`${voiceId}|${model}|${text}`).digest('hex').slice(0, 12)}.mp3`
    if (!existsSync(file)) {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true } }),
      })
      if (!res.ok) throw new Error(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 300)}`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    }
    return file
  }
  const voice = process.env.MAC_VOICE ?? 'Samantha'
  const file = `${dir}/mac-${createHash('sha1').update(`${voice}|${text}`).digest('hex').slice(0, 12)}.aiff`
  if (!existsSync(file)) {
    const r = spawnSync('say', ['-v', voice, '-r', '172', '-o', file, text.replace(/’/g, "'")])
    if (r.status !== 0) throw new Error(`The Mac voice failed: ${r.stderr}`)
  }
  return file
}

mkdirSync(OUT_DIR, { recursive: true })
const audio = {}
if (VOICE !== 'none') {
  console.log(`Generating the voice (${VOICE})…`)
  for (const [id, text] of Object.entries(LINES)) {
    const file = await speak(text)
    audio[id] = { file, seconds: durationOf(file) }
  }
}

// A visible cursor and click ripple for the video. The demo date bar is hidden: it's a presenter control.
const OVERLAY = () => {
  const install = () => {
    if (document.getElementById('__cursor')) return
    const style = document.createElement('style')
    style.textContent = `
      [data-demo-dock]{display:none!important}
      #__cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);filter:drop-shadow(0 2px 5px rgba(0,0,0,.65))}
      .__ripple{position:fixed;z-index:2147483646;pointer-events:none;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
        border:2px solid rgba(125,211,252,.95);background:rgba(56,189,248,.2);animation:__rip .6s ease-out forwards}
      @keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.35);opacity:0}}
    `
    document.head.appendChild(style)
    const c = document.createElement('div')
    c.id = '__cursor'
    c.innerHTML =
      '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2.5l15.5 9.2-6.9 1.5 3.9 7.4-2.9 1.5-3.9-7.5L4 19.3z" fill="#fff" stroke="#0b1220" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    document.body.appendChild(c)
    addEventListener('mousemove', (e) => (c.style.transform = `translate(${e.clientX - 4.6}px, ${e.clientY - 2.9}px)`), true)
    addEventListener(
      'mousedown',
      (e) => {
        const r = document.createElement('div')
        r.className = '__ripple'
        r.style.left = `${e.clientX}px`
        r.style.top = `${e.clientY}px`
        document.body.appendChild(r)
        setTimeout(() => r.remove(), 700)
      },
      true,
    )
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install)
  else install()
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] })
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: 'dark', reducedMotion: 'no-preference' })
const page = await context.newPage()
await page.addInitScript(OVERLAY)
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)

// ---- Recording: screencast frames are timestamped, so each one is held for exactly as long as it was on screen.
const cdp = await context.newCDPSession(page)
const video = `${OUT_DIR}/thaw-demo.mp4`
const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] })
let start
let last = null
let written = 0
const flushUntil = (t) => {
  if (!last) return
  const target = Math.round((t - start) * FPS)
  while (written < target) {
    ff.stdin.write(last)
    written++
  }
}
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  if (start === undefined) start = metadata.timestamp
  flushUntil(metadata.timestamp)
  last = Buffer.from(data, 'base64')
})

// ---- Helpers
const sleep = (ms) => page.waitForTimeout(ms)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
let mouse = { x: 1040, y: 620 }
const cues = []
const now = () => Date.now() / 1000 - start

async function moveTo(x, y, ms = 600) {
  const steps = Math.max(12, Math.round(ms / 16))
  const from = { ...mouse }
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps)
    await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k)
    await sleep(ms / steps)
  }
  mouse = { x, y }
}
async function hover(locator, dx = 0.5, dy = 0.5, ms) {
  const b = await locator.boundingBox()
  if (!b) throw new Error(`Not on screen: ${locator}`)
  await moveTo(b.x + b.width * dx, b.y + b.height * dy, ms)
}
async function click(locator, dx, dy) {
  await hover(locator, dx, dy)
  await sleep(150)
  await page.mouse.down()
  await sleep(80)
  await page.mouse.up()
  await sleep(150)
}
/** Smoothly scroll so the span from `first`'s top to `last`'s bottom sits centered below the nav. */
async function frame(first, last = first, ms = 1200) {
  const top = await first.evaluate((el) => el.getBoundingClientRect().top + scrollY)
  const bottom = await last.evaluate((el) => el.getBoundingClientRect().bottom + scrollY)
  await page.evaluate(
    async ({ top, bottom, ms, nav }) => {
      const room = innerHeight - nav
      const to = Math.max(0, Math.min(top - nav - Math.max(24, (room - (bottom - top)) / 2), document.documentElement.scrollHeight - innerHeight))
      const from = scrollY
      const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      const t0 = performance.now()
      await new Promise((done) => {
        const step = (n) => {
          const t = Math.min(1, (n - t0) / ms)
          scrollTo(0, from + (to - from) * e(t))
          t < 1 ? requestAnimationFrame(step) : done()
        }
        requestAnimationFrame(step)
      })
    },
    { top, bottom, ms, nav: NAV },
  )
  await sleep(250)
}
/** One script line: held on screen for as long as it takes to say, while `action` plays alongside. */
async function line(id, action) {
  const text = LINES[id]
  cues.push({ t: now(), id, text })
  const seconds = audio[id] ? audio[id].seconds + GAP : text.split(/\s+/).length / WORDS_PER_SEC + 0.3
  await Promise.all([sleep(seconds * 1000), action ? action() : null])
}
const nav = (name) => page.locator('header nav a', { hasText: name })
const card = (i) => page.locator('main section.card').nth(i)

// ---- The walkthrough
await page.mouse.move(mouse.x, mouse.y)
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
while (start === undefined) await sleep(20)
await sleep(600)

// 1. Overview
cues.push({ t: now(), section: 'Overview' })
await line('intro', async () => {
  await sleep(1200)
  await hover(page.locator('h1'), 0.55, 0.75, 1000)
  await sleep(1800)
  await hover(page.locator('.card').first(), 0.5, 0.55, 1000)
})

// 2. The problem
cues.push({ t: now(), section: 'The problem' })
await frame(page.locator('#problem .t-eyebrow'), page.locator('#problem .grid.gap-5'))
const stats = page.locator('#problem .grid.gap-5 > .card')
await line('problem', async () => {
  await hover(stats.nth(0), 0.4, 0.6)
  await sleep(2300)
  await hover(stats.nth(1), 0.4, 0.6)
  await sleep(3000)
  await hover(stats.nth(2), 0.4, 0.6)
})

// 3. The solution
cues.push({ t: now(), section: 'The solution' })
await frame(page.locator('#solution .t-eyebrow'), page.locator('#solution .card').first())
const next = page.getByRole('button', { name: 'Next step' })
await line('solution', async () => {
  await hover(page.locator('#solution ol li').first(), 0.5, 0.3)
  await sleep(1500)
  await hover(next)
})
await click(next)
await line('verified')
await click(next)
await line('delivered')
await click(next)
await line('fades', async () => {
  await sleep(600)
  await click(next)
})

// 4. Results
cues.push({ t: now(), section: 'Results' })
await frame(page.locator('#results .t-eyebrow'), page.locator('#results .grid.gap-5'))
const metrics = page.locator('#results .grid.gap-5 > .card')
await line('results', async () => {
  await hover(page.locator('#results h2'), 0.6, 0.5, 900)
  await sleep(4200)
  await hover(metrics.nth(0), 0.45, 0.75)
  await sleep(3500)
  await hover(metrics.nth(1), 0.45, 0.75)
})

// 5. Merchant View
cues.push({ t: now(), section: 'Merchant View' })
await click(nav('Merchant View'))
await sleep(400)
await line('merchant', async () => {
  await hover(card(0).locator('.t-figure').first(), 0.5, 0.5)
  await sleep(1600)
  await hover(card(0).getByText('Waiting on delivery'), 0.5, 0.5)
  await sleep(600)
  await hover(page.getByRole('button', { name: /Add tracking/ }))
})
await click(page.getByRole('button', { name: /Add tracking/ }))
await line('tracking', async () => {
  await sleep(500)
  await hover(card(0).locator('.t-figure').nth(1), 0.5, 0.5)
})
await moveTo(1385, 420, 500)
await frame(page.locator('main h2', { hasText: 'one sale' }), card(2))
const sale = card(2)
await click(sale.getByRole('button', { name: /Play/ }))
await line('sale', async () => {
  await sleep(300)
  await hover(sale.getByRole('button', { name: /Today’s reserve finally lets go/ }), 0.3, 0.5, 1300)
})

// 6. Admin View
cues.push({ t: now(), section: 'Admin View' })
await click(nav('Admin View'))
await sleep(300)
await line('admin', async () => {
  await hover(card(0).locator('.t-figure').first(), 0.5, 0.5)
  await sleep(1700)
  await click(page.getByRole('radio', { name: 'Today’s reserve', exact: true }))
})
await click(page.getByRole('radio', { name: 'On Thaw', exact: true }))
await moveTo(1385, 420, 500)
await frame(page.locator('main h2', { hasText: 'a year across' }), card(1))
const year = card(1)
await click(year.getByRole('button', { name: /Replay|Play/ }))
await line('year', async () => {
  await sleep(300)
  await hover(year.getByText('16 stores failed during the year'), 0.3, 0.5, 1200)
  await sleep(3800)
  await hover(year.getByText(/The safety switch caught/), 0.3, 0.5)
})
await moveTo(1385, 420, 500)
await frame(page.locator('main h2', { hasText: 'Stress test' }), card(2))
const test = (name) => page.getByRole('radio', { name })
await line('normal', () => hover(test(/A normal year/), 0.35, 0.5))
await click(test(/No safety minimum/), 0.35, 0.5)
await line('noFloor')
await click(test(/Three times more stores fail/), 0.35, 0.5)
await line('stress')
await click(test(/^Scammers fake delivery proof/), 0.35, 0.5)
await line('scam')
await click(test(/new stores start on today/), 0.35, 0.5)
await line('fix')

// 7. Close
cues.push({ t: now(), section: 'Close' })
await click(nav('Overview'))
await moveTo(1040, 620, 800)
await line('close')
await sleep(800)

// ---- Finish the video
await cdp.send('Page.stopScreencast')
flushUntil(Date.now() / 1000)
ff.stdin.end()
await new Promise((done) => ff.on('close', done))
await browser.close()

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const total = written / FPS
console.log(`Saved ${video} (${mmss(total)})`)

// ---- Add the voice: each clip starts at its line's cue time.
let voiced = null
if (VOICE !== 'none') {
  voiced = `${OUT_DIR}/thaw-demo-voiced.mp4`
  const spoken = cues.filter((c) => c.id && audio[c.id])
  const inputs = spoken.flatMap((c) => ['-i', audio[c.id].file])
  const delays = spoken.map((c, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=mono,adelay=delays=${Math.round(c.t * 1000)}:all=1[a${i}]`)
  const mix = `${spoken.map((_, i) => `[a${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad[aout]`
  const r = spawnSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', video, ...inputs, '-filter_complex', [...delays, mix].join(';'),
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', voiced], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('Adding the voice failed.')
  console.log(`Saved ${voiced} (voice: ${VOICE})`)
}

const sheet = [
  '# Thaw demo: voiceover cue sheet',
  '',
  `Video: \`${video}\` (${mmss(total)}, 1080p, no sound)${voiced ? ` and \`${voiced}\` (with the ${VOICE} voice)` : ''}. Each line starts at its time.`,
  '',
  ...cues.map((c) => (c.section ? `\n## ${c.section}\n` : `- **${mmss(c.t)}** ${c.text}`)),
  '',
].join('\n')
writeFileSync(`${OUT_DIR}/thaw-demo-cues.md`, sheet)
console.log(`Saved ${OUT_DIR}/thaw-demo-cues.md`)
