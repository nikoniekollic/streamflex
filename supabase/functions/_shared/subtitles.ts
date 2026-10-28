// Conversion SubRip (.srt) → WebVTT (seul format lu par <track>)
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n')
      if (/^\d+$/.test(lines[0]?.trim() ?? '')) lines.shift() // index numérique
      if (!lines[0]?.includes('-->')) return ''
      lines[0] = lines[0].replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/\s+(X1|Y1|X2|Y2):\S+/g, '')
      return lines
        .map((l, i) => (i === 0 ? l : l.replace(/\{\\an?\d+\}/g, '').replace(/<\/?font[^>]*>/gi, '')))
        .join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
  return `WEBVTT\n\n${body}\n`
}

export function ensureVtt(text: string, format: 'vtt' | 'srt'): string {
  const t = text.replace(/^﻿/, '')
  if (format === 'vtt' || /^WEBVTT/.test(t)) return t.replace(/\r\n?/g, '\n')
  return srtToVtt(t)
}
