import { createController } from './controller.mjs'
import { createDsh, dshInject } from './dsh.mjs'
import { createIlink } from './ilink.mjs'
import { startPanel } from './panel.mjs'
import { defaultDataDir } from './storage.mjs'

export const name = 'dsh-jingyu'
export const inject = dshInject

export function apply(ctx) {
  ctx.effect(() => {
    let disposed = false
    let panel
    let controller
    void Promise.resolve().then(async () => {
      if (disposed) return
      controller = createController({
        dataDir: defaultDataDir(),
        ilink: createIlink(),
        connectDsh: options => createDsh(ctx, options),
      })
      const port = Number(process.env.JINGYU_PANEL_PORT || 18429)
      panel = await startPanel({ port, onAction: controller.action, onGroup: controller.groupReply })
      if (disposed) {
        await panel.close()
        return
      }
      controller.start()
      console.info(`[鲸屿] 设置面板：${panel.url}`)
    }).catch(async error => {
      if (!disposed) console.error('[鲸屿] 启动失败：', error.message)
      await controller?.close()
    })
    return async () => {
      disposed = true
      await Promise.allSettled([panel?.close(), controller?.close()])
    }
  })
}
