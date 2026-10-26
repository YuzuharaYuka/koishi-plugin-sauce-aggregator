// 插件配置页的悬浮导航面板
//
// 控制台会把 `Schema.intersect` 里每个子对象的 description 渲染成
// `<h2 class="k-schema-header">`，本文件按标题原文定位分组并滚动过去。
// 因此改动 config.ts 里的分组名时，同步下面 NAV_SECTIONS 的 header 即可；
// 找不到的分组会自动从面板上隐藏，不会报错。

import { defineComponent, h, inject, onUnmounted, ref, type Component, type Ref } from 'vue'

/**
 * 控制台客户端上下文里本文件用到的部分。
 * 不直接引用 `@koishijs/client` 的类型：该包的入口是 .ts 源码，
 * 引进来会把整个 webui 的源码拖进类型检查。
 */
interface ConsoleContext {
  slot(options: { type: string; component: Component; order?: number }): void
}

/** 面板上的一个跳转条目 */
interface NavItem {
  /** 显示名 */
  label: string
  /** 配置分组的标题原文，与应用内的 description 保持一致 */
  header: string
}

/** 面板上的一个分组 */
interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: '常规',
    items: [
      { label: '引擎与图源', header: '引擎与图源' },
      { label: '搜索设置', header: '搜索设置' },
      { label: '网络设置', header: '网络设置' },
      { label: '链接解析', header: '链接解析' },
      { label: '图片处理', header: '图片处理' },
      { label: '浏览器', header: '浏览器' },
    ],
  },
  {
    title: '引擎',
    items: [
      { label: 'SauceNAO', header: 'SauceNAO 设置' },
      { label: 'Trace.moe', header: 'Trace.moe 设置' },
      { label: 'IQDB', header: 'IQDB 设置' },
      { label: '搜图bot酱', header: '搜图bot酱设置' },
      { label: 'Yandex', header: 'Yandex 设置' },
      { label: 'Ascii2D', header: 'Ascii2D 设置' },
      { label: 'Google Lens', header: 'Google Lens 设置' },
    ],
  },
  {
    title: '图源',
    items: [
      { label: 'Yande.re', header: 'Yande.re 图源设置' },
      { label: 'Konachan', header: 'Konachan 图源设置' },
      { label: 'Gelbooru', header: 'Gelbooru 图源设置' },
      { label: 'Danbooru', header: 'Danbooru 图源设置' },
      { label: 'Pixiv', header: 'Pixiv 图源设置' },
    ],
  },
  {
    title: '其他',
    items: [{ label: '调试设置', header: '调试设置' }],
  },
]

/** 分组标题 → 显示名 */
const LABEL_BY_HEADER = new Map<string, string>()
for (const section of NAV_SECTIONS) {
  for (const item of section.items) LABEL_BY_HEADER.set(item.header, item.label)
}

/** 只有本插件的配置页才渲染面板 */
const PLUGIN_NAME = 'koishi-plugin-sauce-aggregator'

/** 拖动时的边距与判定当前分组的位置 */
const EDGE = 8
const ACTIVE_LINE = 140

const PANEL_CSS = `
.sauce-nav{position:fixed;z-index:2000;width:172px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--k-card-border,#e5e7eb);border-radius:8px;background:var(--k-card-bg,#fff);box-shadow:var(--k-card-shadow,0 4px 16px rgba(0,0,0,.12));font-size:13px;user-select:none}
.sauce-nav-header{display:flex;align-items:center;justify-content:space-between;height:28px;padding:0 6px 0 10px;border-bottom:1px solid var(--k-color-divider,#ebeef5);background:var(--k-hover-bg,#f5f6f8);color:var(--k-text-light,#909399);cursor:move}
.sauce-nav-title{font-size:12px;font-weight:600}
.sauce-nav-toggle{padding:2px 6px;border:0;background:transparent;color:inherit;font-size:12px;line-height:1;cursor:pointer}
.sauce-nav-body{overflow-y:auto;padding:4px 0}
.sauce-nav-section{padding:6px 10px 2px;color:var(--k-text-light,#909399);font-size:11px;font-weight:600}
.sauce-nav-item{padding:5px 12px;border-left:3px solid transparent;color:var(--k-text-normal,#606266);cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.sauce-nav-item:hover{background:var(--k-hover-bg,#f5f6f8);color:var(--k-text-active,#303133)}
.sauce-nav-item.is-active{border-left-color:var(--k-color-primary,#409eff);background:var(--k-activity-bg,rgba(64,158,255,.08));color:var(--k-color-primary,#409eff);font-weight:500}
.sauce-nav.is-collapsed .sauce-nav-body{display:none}
`

let styleInjected = false

/** 注入面板样式（只注入一次） */
function ensureStyle() {
  if (styleInjected || typeof document === 'undefined') return
  styleInjected = true
  const style = document.createElement('style')
  style.dataset.sauceAggregatorNav = '1'
  style.textContent = PANEL_CSS
  document.head.appendChild(style)
}

/** 收集配置页上的全部分组标题 */
function collectHeaders(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.k-schema-header'))
}

/** 按标题原文定位分组，未找到返回 null */
function resolveHeader(header: string): HTMLElement | null {
  return collectHeaders().find((el) => (el.textContent ?? '').trim() === header) ?? null
}

/** 找出承载配置表单的滚动容器（控制台用的是 el-scrollbar） */
function findScroller(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    const style = getComputedStyle(parent)
    if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) return parent
    parent = parent.parentElement
  }
  return null
}

interface Point { x: number; y: number }

function pointOf(event: MouseEvent | TouchEvent): Point {
  if ('touches' in event) {
    const touch = event.touches[0] ?? event.changedTouches[0]
    return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 }
  }
  return { x: event.clientX, y: event.clientY }
}

const ConfigNav = defineComponent({
  name: 'SauceAggregatorConfigNav',
  setup() {
    ensureStyle()

    const collapsed = ref(false)
    const active = ref('')
    const origin = ref({ top: 120, right: 16 })
    /** 当前页面上真实存在的分组标题 */
    const available = ref<ReadonlySet<string>>(new Set<string>())

    const drag = { ing: false, startX: 0, startY: 0, startTop: 0, startRight: 0, width: 0, height: 0 }

    /** 收集页面上真实存在的跳转目标（按 DOM 顺序） */
    function collectTargets(): { el: HTMLElement; label: string }[] {
      const targets: { el: HTMLElement; label: string }[] = []
      for (const el of collectHeaders()) {
        const label = LABEL_BY_HEADER.get((el.textContent ?? '').trim())
        if (label) targets.push({ el, label })
      }
      return targets
    }

    let scroller: HTMLElement | null = null

    function currentScroller(targets: { el: HTMLElement }[]): HTMLElement | null {
      if (scroller?.isConnected) return scroller
      scroller = targets.length > 0 ? findScroller(targets[0].el) : null
      return scroller
    }

    /** 重新扫描分组，决定面板要显示哪些条目 */
    function refresh() {
      const found = new Set<string>()
      for (const el of collectHeaders()) {
        const text = (el.textContent ?? '').trim()
        if (LABEL_BY_HEADER.has(text)) found.add(text)
      }
      if (found.size !== available.value.size || [...found].some((text) => !available.value.has(text))) {
        available.value = found
      }
    }

    /** 高亮当前滚动到的分组 */
    function syncActive() {
      const targets = collectTargets()
      if (targets.length === 0) return

      // 滚到底部时最后一组到不了顶部，直接高亮最后一项
      const box = currentScroller(targets)
      if (box && box.scrollTop + box.clientHeight >= box.scrollHeight - 8) {
        active.value = targets[targets.length - 1].label
        return
      }

      let current = targets[0].label
      for (const target of targets) {
        if (target.el.getBoundingClientRect().top <= ACTIVE_LINE) current = target.label
        else break
      }
      active.value = current
    }

    function onScroll() {
      syncActive()
    }

    function jump(item: NavItem) {
      const target = resolveHeader(item.header)
      if (!target) return
      active.value = item.label
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }

    /** 拖动：按住标题栏移动面板，并限制在窗口内 */
    function onDragStart(event: MouseEvent | TouchEvent) {
      const panel = (event.currentTarget as HTMLElement).closest('.sauce-nav')
      const rect = panel?.getBoundingClientRect()
      if (rect) {
        drag.width = rect.width
        drag.height = rect.height
      }
      const point = pointOf(event)
      drag.ing = true
      drag.startX = point.x
      drag.startY = point.y
      drag.startTop = origin.value.top
      drag.startRight = origin.value.right
    }

    function onDragMove(event: MouseEvent | TouchEvent) {
      if (!drag.ing) return
      const point = pointOf(event)
      const maxTop = Math.max(EDGE, window.innerHeight - drag.height - EDGE)
      const maxRight = Math.max(EDGE, window.innerWidth - drag.width - EDGE)
      origin.value = {
        top: Math.min(Math.max(drag.startTop + point.y - drag.startY, EDGE), maxTop),
        right: Math.min(Math.max(drag.startRight - (point.x - drag.startX), EDGE), maxRight),
      }
    }

    function onDragEnd() {
      drag.ing = false
    }

    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragEnd)
    window.addEventListener('touchmove', onDragMove)
    window.addEventListener('touchend', onDragEnd)

    // 配置表单是异步渲染的，这里跟着 DOM 变化刷新一次
    let timer: number | null = null
    const observer = new MutationObserver(() => {
      scroller = null
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        refresh()
        syncActive()
      }, 120)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    refresh()
    syncActive()

    onUnmounted(() => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', onDragEnd)
      window.removeEventListener('touchmove', onDragMove)
      window.removeEventListener('touchend', onDragEnd)
      observer.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    })

    return () => {
      if (available.value.size === 0) return null

      const sections = NAV_SECTIONS
        .map((section) => ({ section, items: section.items.filter((item) => available.value.has(item.header)) }))
        .filter((entry) => entry.items.length > 0)

      return h('div', {
        class: ['sauce-nav', collapsed.value && 'is-collapsed'],
        style: { top: `${origin.value.top}px`, right: `${origin.value.right}px` },
      }, [
        h('div', { class: 'sauce-nav-header', onMousedown: onDragStart, onTouchstart: onDragStart }, [
          h('span', { class: 'sauce-nav-title' }, '配置导航'),
          h('button', {
            class: 'sauce-nav-toggle',
            type: 'button',
            title: collapsed.value ? '展开' : '收起',
            onClick: () => { collapsed.value = !collapsed.value },
          }, collapsed.value ? '▸' : '▾'),
        ]),
        h('div', { class: 'sauce-nav-body' }, sections.flatMap(({ section, items }) => [
          h('div', { class: 'sauce-nav-section' }, section.title),
          ...items.map((item) => h('div', {
            class: ['sauce-nav-item', active.value === item.label && 'is-active'],
            onClick: () => jump(item),
          }, item.label)),
        ])),
      ])
    }
  },
})

/** 只在属于本插件的配置页上挂载面板 */
const ConfigNavLoader = defineComponent({
  name: 'SauceAggregatorConfigNavLoader',
  setup() {
    const pluginName = inject<Ref<string> | undefined>('plugin:name')
    return () => (pluginName?.value === PLUGIN_NAME ? h(ConfigNav) : null)
  },
})

export default function apply(ctx: ConsoleContext) {
  ctx.slot({ type: 'plugin-details', component: ConfigNavLoader, order: -997 })
}
