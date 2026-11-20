const politeStart = /^(?:(?:鲸屿|鲸鲸)[，、：:\s]*|(?:你)?(?:可以|能不能|能否|能|可不可以)(?:请)?|(?:请|麻烦|帮我|替我|给我|先|再|顺便))[，、：:\s]*/u
const directTask = /^(?:搜索|搜(?:一)?下|检索|联网查|上网查|查(?:一)?下|查找(?:最新|最近|资料)|做(?:一)?下(?:资料|内容|市场)研究|运行|执行|重启|打开(?:浏览器|终端|文件夹)|启动|部署|提交代码|推送代码|跑(?:一遍|一下|下)?(?:测试|构建|命令|脚本)|(?:列出|创建|整理|修改|检查|看看|看一下|查看|打开|读取|分析)(?:当前|这个|那份|一下|我的|一个|本机|电脑上的|项目里的|工作区里的)*(?:项目|文件|目录|仓库|脚本|代码|错误日志|日志|构建|测试|报告|文档))/u

export function asksForWork(text, continuingWork = false) {
  if (/^(?:聊天|闲聊)[：:]\s*\S/u.test(text)) return false
  if (/^(?:帮我(?:在|用)(?:电脑|Mac|DSH)(?:上)?|请(?:在|用)(?:电脑|Mac|DSH)(?:上)?|让(?:电脑|Mac|DSH)|(?:新任务|工作任务)[：:\s])/iu.test(text)) return true
  let request = text
  for (let i = 0; i < 7 && politeStart.test(request); i++) request = request.replace(politeStart, '')
  if (directTask.test(request)) return true
  if (/^把.{1,70}(?:文件|项目|代码|测试|脚本|日志|仓库|报告|文档).{0,30}(?:跑|改|查|打开|整理|写|看|推送|发给我)/u.test(request)) return true
  if (/^(?:can you |could you |please )?(?:search for|look up|run the tests|check the repository|open the file|edit the file)\b/iu.test(text)) return true
  return continuingWork && /^(?:继续|接着做|按刚才的方案继续|就按这个做|可以继续)[。！？!?\s]*$/u.test(request)
}

export function asksForVoice(text) {
  if (/(?:别|不要|不用|不必)(?:给我|再)?(?:用语音|发语音)/u.test(text)) return false
  return /(?:^|[，。；\s])(?:你(?:可以|能(?:不能)?|能否)?|请|帮我|给我|再)*(?:用语音(?:回(?:复)?|说|读|告诉我|再说)|发(?:一(?:条|段|下)|个)?语音|语音(?:回(?:复)?我|说一遍))|(?:用语音再说一遍|用语音读给我听)/u.test(text)
}

export function wasWorking(jobs, now) {
  const previous = jobs?.at(-1)
  const observed = previous?.createdAt ?? previous?.sentAt
  return previous?.mode === 'work' && typeof observed === 'number' && now - observed < 20 * 60000
}
