/**
 * 加载结果与「加载在途期间用户新画的笔迹」合并。
 * 整幅覆盖接口下若直接 `strokes = loaded`，会把这几笔吞掉；
 * 若反过来只保留本地笔迹，又会丢掉服务端已有数据。
 * 后端返回的顺序在前、本地新增追加在后，保持渲染与入库一致。
 */
export function mergeLoadedStrokes(loaded, pendingLocal) {
  const base = Array.isArray(loaded) ? loaded : []
  const extra = Array.isArray(pendingLocal) ? pendingLocal : []
  return extra.length ? [...base, ...extra] : [...base]
}

/**
 * 画布笔迹「即时入库」写入器。
 *
 * 后端 `POST /api/canvas-strokes/:id` 是整幅快照覆盖，因此写入必须串行：
 * 否则旧的慢请求会在新请求之后落库，把刚画的一笔抹掉。
 *
 * 与标注一致：每次增 / 删 / 清空都立即发起写入，没有防抖窗口，也不依赖
 * 「关闭画布 / 组件卸载时才保存」。commit 时冻结 articleId，文章切换后
 * 在途请求仍指向原文章，不会串写到新文章。
 */
export function createStrokeWriter({
  save,
  onError = () => {},
  maxRetries = 3,
  retryDelay = 500,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof save !== 'function') throw new TypeError('createStrokeWriter 需要 save 函数')

  const queue = []
  const waiters = []
  let running = false
  let lastFailed = null

  const clone = (arr) => JSON.parse(JSON.stringify(arr ?? []))

  /** 一次笔迹变更后立即调用；无防抖，立即发起（或排队）写入 */
  function commit(articleId, strokes) {
    if (!articleId || articleId === 'default') return
    queue.push({ articleId, strokes: clone(strokes), attempts: 0 })
    void drain()
  }

  async function drain() {
    if (running) return
    running = true
    try {
      while (queue.length) {
        const job = queue[0]
        try {
          await save(job.articleId, job.strokes)
          queue.shift()
          lastFailed = null
        } catch (err) {
          job.attempts += 1
          if (job.attempts > maxRetries) {
            queue.shift()
            lastFailed = { articleId: job.articleId, strokes: job.strokes }
            try { onError(err, lastFailed) } catch {}
          } else {
            await sleep(retryDelay * job.attempts)
          }
        }
      }
    } finally {
      running = false
      if (queue.length === 0) waiters.splice(0).forEach((resolve) => resolve())
    }
  }

  /** 等待已排队的写入（含重试）全部结束，用于切文章 / 关闭画布前 */
  function flush() {
    if (!running && queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => waiters.push(resolve))
  }

  /** 尚未确认落库的最新快照，供 pagehide 兜底；全部落库后返回 null */
  function pending() {
    const src = queue.length ? queue[queue.length - 1] : lastFailed
    return src ? { articleId: src.articleId, strokes: clone(src.strokes) } : null
  }

  return { commit, flush, pending }
}
