/**
 * 游戏内存：自动 / 手动两种模式共用的计算规则。
 *
 * 放在 shared 里是为了让「主进程算 -Xmx」「设置页显示分配了多少」用的是同一套数字，
 * 不然界面写 8192、实际启动给 4096 这种事迟早发生。
 */

/** 手动模式允许的最小堆 */
export const MEM_MIN_MB = 512
/** 自动模式的硬上限：再大的机器也最多给 12 GB，Minecraft 吃不完 */
export const MEM_AUTO_CAP_MB = 12288
/** 自动模式最少也要给 2 GB */
export const MEM_AUTO_FLOOR_MB = 2048
/** 自动模式给系统留的余量 */
export const MEM_RESERVE_MB = 2048
/** 一切对齐到这个粒度 */
const STEP_MB = 512

/** 32 位 Java 地址空间只有 4 GB，自动模式按这个上限给 */
export const MEM_X86_AUTO_MB = 1024
/** 32 位 Java 手动模式的硬上限：再大 JVM 直接起不来 */
export const MEM_X86_CAP_MB = 2048

export type MemoryMode = 'auto' | 'manual'

export interface MemoryPlan {
  mode: MemoryMode
  /** 实际会写进 -Xmx 的值 */
  maxMemory: number
  /** 实际会写进 -Xms 的值 */
  minMemory: number
  /** 按这台机器物理内存算出来的建议值（手动模式下也照算，当参考） */
  autoMax: number
  /** 物理内存，MB；探测不到是 0 */
  totalMb: number
  /** 是否按 32 位堆（4 GB 地址空间）算的 */
  arch32: boolean
}

export interface MemoryOptions {
  /** 选了 32 位 Java：堆必须压进 4 GB 地址空间 */
  arch32?: boolean
}

const floorStep = (mb: number): number => Math.floor(mb / STEP_MB) * STEP_MB

/**
 * 按物理内存推一个最大堆。
 *
 * 思路：先扣掉 2 GB 给系统，剩下的拿六成，对齐到 512 MB，夹在 2~12 GB 之间；
 * 最后兜一条底线——不管怎么算都不能超过物理内存的一半，免得系统被撑死。
 */
export function autoMaxMemory(totalBytes: number): number {
  const bytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0
  const totalMb = Math.floor(bytes / 1024 / 1024)
  // 拿不到物理内存就退回一个保守值
  if (totalMb <= 0) return 4096

  const spare = Math.max(0, totalMb - MEM_RESERVE_MB)
  let mb = floorStep(spare * 0.6)
  mb = Math.max(MEM_AUTO_FLOOR_MB, Math.min(mb, MEM_AUTO_CAP_MB))

  const halfCap = Math.max(MEM_MIN_MB, floorStep(totalMb / 2))
  return Math.max(MEM_MIN_MB, Math.min(mb, halfCap))
}

/** 自动模式的最小堆固定 512 MB：堆按需往上长，不在启动时就把内存全占住 */
export function autoMinMemory(): number {
  return MEM_MIN_MB
}

/** 落一份最终决策：自动看机器，手动看用户填的（顺带夹一下范围） */
export function memoryPlan(mode: MemoryMode, totalBytes: number, manual: { maxMemory: number; minMemory: number }, opts: MemoryOptions = {}): MemoryPlan {
  const totalMb = Math.floor((Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0) / 1024 / 1024)
  const arch32 = Boolean(opts.arch32)
  // 32 位 Java 寻址不到 4 GB，物理内存再大也得先砍下来
  const autoMax = arch32 ? Math.min(autoMaxMemory(totalBytes), MEM_X86_AUTO_MB) : autoMaxMemory(totalBytes)
  const cap = arch32 ? MEM_X86_CAP_MB : 65536
  if (mode === 'manual') {
    const maxMemory = Math.max(MEM_MIN_MB, Math.min(Math.round(manual.maxMemory) || MEM_MIN_MB, cap))
    // Xms 不能比 Xmx 大，不然 JVM 直接拒绝启动
    const minMemory = Math.max(0, Math.min(Math.round(manual.minMemory) || 0, maxMemory))
    return { mode, maxMemory, minMemory, autoMax, totalMb, arch32 }
  }
  return { mode, maxMemory: autoMax, minMemory: Math.min(autoMinMemory(), autoMax), autoMax, totalMb, arch32 }
}

/** 滑块的合理上限：就是物理内存（拿不到按 16 GB 算） */
export function sliderMaxMemory(totalBytes: number): number {
  const totalMb = Math.floor((Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0) / 1024 / 1024)
  return Math.max(4096, floorStep(totalMb) || 16384)
}

/** 把 MB 说成人话：7680 → "7.5 GB" */
export function mbToGb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '—'
  const gb = mb / 1024
  return (Number.isInteger(gb) ? String(gb) : gb.toFixed(1)) + ' GB'
}

/** 物理内存说成人话，按 GB 保留一位 */
export function totalMemoryText(totalBytes: number): string {
  const totalMb = (Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0) / 1024 / 1024
  if (totalMb <= 0) return '未知'
  return (totalMb / 1024).toFixed(1) + ' GB'
}