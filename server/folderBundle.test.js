import { describe, it, expect, vi } from 'vitest'
import {
  buildAudioSidecar,
  validateAudioSidecar,
  validateBundle,
  BUNDLE_FORMAT,
} from './folderBundle.js'
import { readTtsKey, READ_TTS_RATE, READ_TTS_VOICES } from './ttsCache.js'

const baseBundle = (extra = {}) => ({
  format: BUNDLE_FORMAT,
  version: 2,
  exportedAt: '2026-11-19T00:00:00.000Z',
  source: { folderId: 'f1', folderName: '测试' },
  counts: { folders: 0, articles: 1 },
  folders: [{ id: 'f1', name: '测试', parentId: null, sortOrder: 0 }],
  articles: [{ id: 'a1', title: 'T', content: 'hello', summary: '', folderId: 'f1' }],
  annotations: [],
  favorites: [],
  canvasStrokes: [],
  ...extra,
})

const key = readTtsKey('hello', READ_TTS_VOICES[0], READ_TTS_RATE)
const validWord = { text: 'hello', offset: 0, duration: 1000 }
const sidecar = (audio, extra = {}) => ({
  format: 'language-learning/tts-audio-bundle',
  version: 1,
  exportedAt: '2026-11-19T00:00:00.000Z',
  source: { bundleExportedAt: '2026-11-19T00:00:00.000Z', folderId: 'f1' },
  audio,
  ...extra,
})

describe('validateBundle v1/v2 兼容', () => {
  it('v2 带 audioManifest 通过并保留清单', () => {
    const b = baseBundle({
      audioManifest: {
        rate: '+0%',
        voices: READ_TTS_VOICES,
        files: [{ key, articleId: 'a1', paragraphIndex: 0, voice: READ_TTS_VOICES[0], rate: '+0%', bytes: 123 }],
        missing: 0,
      },
    })
    const { sanitized, summary } = validateBundle(b)
    expect(sanitized.audioManifest.files[0].key).toBe(key)
    expect(summary.audioFiles).toBe(1)
  })
  it('v1 无 audioManifest 仍通过', () => {
    const b = baseBundle({ version: 1 })
    const { sanitized } = validateBundle(b)
    expect(sanitized.audioManifest).toBeUndefined()
  })
  it('非法 key 被拒绝', () => {
    const b = baseBundle({
      audioManifest: { files: [{ key: 'bad', voice: 'x' }], voices: [], rate: '+0%', missing: 0 },
    })
    expect(() => validateBundle(b)).toThrow(/key 非法/)
  })
})

describe('validateAudioSidecar', () => {
  const bundle = baseBundle({
    audioManifest: {
      rate: '+0%', voices: READ_TTS_VOICES, missing: 0,
      files: [{ key, articleId: 'a1', paragraphIndex: 0, voice: READ_TTS_VOICES[0], rate: '+0%', bytes: 10 }],
    },
  })

  it('匹配的边车通过', () => {
    const r = validateAudioSidecar(sidecar([{ key, audio: 'AAAA', words: [validWord] }]), bundle)
    expect(r.count).toBe(1)
  })
  it('bundleExportedAt 不匹配整份拒绝', () => {
    const bad = sidecar([{ key, audio: 'AAAA', words: [] }], {
      source: { bundleExportedAt: '2020-01-01T00:00:00.000Z', folderId: 'f1' },
    })
    expect(() => validateAudioSidecar(bad, bundle)).toThrow(/不匹配/)
  })
  it('key 不在主包清单内整份拒绝', () => {
    const bad = sidecar([{ key: 'f'.repeat(64), audio: 'AAAA', words: [] }])
    expect(() => validateAudioSidecar(bad, bundle)).toThrow(/不在主包清单内/)
  })
  it('词边界形状非法整份拒绝', () => {
    const bad = sidecar([{ key, audio: 'AAAA', words: [{ text: 1, offset: 'x', duration: null }] }])
    expect(() => validateAudioSidecar(bad, bundle)).toThrow(/词边界非法/)
  })
  it('format 不匹配拒绝', () => {
    expect(() => validateAudioSidecar({ format: 'x', version: 1 }, bundle)).toThrow(/format/)
  })
})

describe('buildAudioSidecar', () => {
  it('只打包清单中存在的 key，payload 原样输出', async () => {
    const tts = await import('./ttsCache.js')
    const spy = vi.spyOn(tts, 'readTtsDiskFile').mockImplementation((k) =>
      k === key ? { audio: 'QUJD', words: [validWord] } : null
    )
    const b = baseBundle({
      audioManifest: {
        rate: '+0%', voices: READ_TTS_VOICES, missing: 1,
        files: [
          { key, articleId: 'a1', paragraphIndex: 0, voice: READ_TTS_VOICES[0], rate: '+0%', bytes: 5 },
          { key: 'a'.repeat(64), articleId: 'a1', paragraphIndex: 1, voice: READ_TTS_VOICES[1], rate: '+0%', bytes: 0 },
        ],
      },
    })
    const out = buildAudioSidecar(b.source, b.audioManifest, b.exportedAt)
    expect(out.audio).toHaveLength(1)
    expect(out.audio[0]).toEqual({ key, audio: 'QUJD', words: [validWord] })
    expect(out.source.bundleExportedAt).toBe(b.exportedAt)
    spy.mockRestore()
  })
})
