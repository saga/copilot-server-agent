import type { ExecutionService } from './execution-service.js';

/**
 * 当前 execution 的写入通道。
 *
 *   wiring 装配时 bindExecutionSink(executionService) → 消费方运行时 executionSink()
 *
 * 为什么要多加这一层：agent-runner / tool-evidence / hooks/events / agent-context 都要往
 * 「当前 execution」里写（usage、审计事件、工具证据、hook 事件、turn 上下文），但它们
 * **不能** 直接 `import { executionService } from '../wiring.js'` —— wiring 装配时必须 import
 * 它们，直接 import 会成环（wiring → agent-execution → session-service → tool-evidence → wiring）。
 *
 * ESM 的环在「上层入口先进入这些模块」的加载顺序下会变成运行时错误：
 * `Cannot access 'sessionService' before initialization`（进程启动即崩）。单测未必覆盖到，
 * 因为它取决于 import 顺序。所以依赖反过来：wiring 装配时填入，消费方在调用点惰性取用。
 *
 * 这里只放「写执行证据」这一类动作。谁可以进会话、能发消息吗属于
 * SessionAccessService；execution 的生命周期（create/start/complete）只有
 * ExecutionService 的调用方（路由 / 协作层）才该碰，不进这个通道。
 */
export type ExecutionSink = Pick<
  ExecutionService,
  | 'setActive'
  | 'clearActive'
  | 'activeFor'
  | 'addUsage'
  | 'setContextWindow'
  | 'appendEvent'
  | 'beginToolCall'
  | 'endToolCall'
  | 'denyToolCall'
>;

let sink: ExecutionSink | null = null;

/** 唯一写入点：wiring 建好 ExecutionService 后调用 */
export function bindExecutionSink(service: ExecutionSink): void {
  sink = service;
}

/** 取写入通道；未装配时抛错而不是静默丢证据 */
export function executionSink(): ExecutionSink {
  if (!sink) {
    throw new Error('execution 写入通道尚未装配：请在 wiring 里调用 bindExecutionSink(executionService)');
  }
  return sink;
}

/** 诊断用：当前是否已装配（未装配时只影响证据写入，不影响启动） */
export function hasExecutionSink(): boolean {
  return sink !== null;
}
