import { config } from '../config.js';
import { preview } from '../execution/redact.js';
import type { ExecutionService } from '../execution/execution-service.js';
import type { ExecutionRecord } from '../execution/types.js';
import { EXECUTION_EVENT_TYPES as EVT, isTerminal } from '../execution/types.js';
import type { HumanTaskService } from '../human-tasks/human-task-service.js';
import type { HumanTask } from '../human-tasks/types.js';
import { skillSearchDirs, type LoadedSkill } from '../skills/index.js';
import type { ApprovalPolicy } from '../approval/types.js';
import { parseAgentTools } from './capability.js';
import {
  SkillFileDefinitionProvider,
  type FlowDefinitionProvider,
} from './definition-provider.js';
import {
  DefaultFlowNodeRuntime,
  type FlowNodeRuntime,
  type WorkflowTurnRunner,
} from './runtime.js';
import { findFlowReview, flowRegistryLookup, reviewBasePolicy } from './registry.js';
import {
  MAX_FLOW_STEPS,
  requiredVotes,
  type FlowContext,
  type FlowDefinition,
  type FlowIssue,
  type FlowNode,
  type FlowNodeType,
  type FlowPermissionKind,
  type WorkflowState,
} from './types.js';

/**
 * WorkflowRunner：Skill Flow 的编排器 —— 状态机部分。
 *
 * 它只做四件事：**推进状态、落库、路由、把人工任务接回来**。
 * 一个节点"具体怎么执行"在 `runtime.ts`，流程定义"从哪来"在 `definition-provider.ts`。
 * 底下三层全部复用现有体系：
 *
 *   @agent  → runExecutionTurn（同一个 Copilot session / model / tool policy）
 *   @review → HumanTaskService（同一套 My Tasks / 委派 / SoD / 租户隔离 / 审计）
 *   @action → ExecutionService.proposeAction（同一套策略 → 审批 → hash/版本复核 → executor）
 *
 * 两步之间的"状态"就是 `agent_execution.workflow_state` 里的一个节点 id 加上它的执行状态。
 *
 * ## 步骤持久化（step durability）
 *
 * 每一步的顺序是：**先把 `stepStatus = running` 落库，再执行那个节点**；执行完把 `current`
 * 推到下一个节点并落回 `pending`。
 *
 * 只有 `current` 一个字段时，"这一步跑没跑完"是不可知的：进程在"跑完但状态没落库"之间退出，
 * 重启后只能靠猜 —— 提前写 `current = next` 会**跳过**一个其实没执行完的步骤；不提前写又会
 * 重放一个可能已经产生副作用的步骤。所以状态里多一个 `stepStatus`，把顺序显式表达成
 *
 *   pending → running → pending
 *
 * 这样 crash 恢复才能明确回答"publish 已经开始过，但它完成了没有？"。
 *
 * 恢复策略见 `admitInterruptedStep()`：`@agent` / `@gate` 是纯计算，允许重放；
 * `@action` 有真实副作用，**不自动重放**，落 failed 交人工核对（幂等键只能防重复提交，
 * 防不了"外部系统已经生效但本地没记上"）。
 *
 * ## 进入等待态的顺序（`@review` / `@action`）
 *
 * 三步，顺序不能换：
 *
 *   1. 建人工任务（拿到 taskId）
 *   2. CAS 落 `workflow.stepStatus = waiting` + `waitingTaskId`
 *   3. 把 execution 迁移到 `waiting_for_approval`
 *
 * 先做 3 再做 2 会留下一个**不可判定**的崩溃窗口：`execution = waiting_for_approval`
 * 配 `workflow.stepStatus = running` —— 恢复时"这一步在等人工"和"这一步要重放"
 * 同时成立，没有任何字段能判断该信哪个（前者会漏掉一步，后者会重复提交）。
 *
 * 按上面的顺序，崩溃留下的最长是 `stepStatus = waiting` + `execution = running`：
 * 任务确实已经建出来了，只需要把它接回来（`reconcileWaiting()`）。
 *
 * 注意这个形状**不止**这一个来源：`resumeInto()` 的"推出等待态 → CAS 写下一个节点"
 * 之间崩溃会留下同样的字段组合，但那条任务**已经被处理过**。所以 `reconcileWaiting()`
 * 不能只读 durable 字段，必须回查任务本身的终态（见该方法的注释）。
 *
 * 代价是 2 与 3 之间崩溃会留下一条**孤儿人工任务**（流程那边会重新走一遍）。这是
 * 刻意选的：任务会自然过期，过期回调也会被 `resumeFromTask()` 的绑定校验拦下；
 * 而"流程状态不可判定"是没法靠超时自愈的。
 *
 * ## 单写者（single writer）
 *
 * 两个推进者同时改同一个 execution 时，"读 → 合并 → 整行写回"会让后写的把先写的
 * **整段覆盖掉**：表现为某一步被跳过或步数回退，而审计链上看不出任何异常。
 * 所以每次写状态都带版本号（CAS，见 `ExecutionService.updateWorkflowState`），
 * 拿到冲突的那个写者停下并留痕 —— 流程归先拿到的那个推进者继续。
 *
 * 进程内还有一把按 executionId 的锁（`withExecutionLock`）：CAS 是跨副本的正确性保证，
 * 这把锁则让同一进程里的"恢复推进"与"人工任务回调"不互相打架。
 */

export type { WorkflowTurnRunner };

export interface WorkflowRunnerDeps {
  executions: ExecutionService;
  humanTasks: HumanTaskService;
  runTurn: WorkflowTurnRunner;
  /** 技能搜索目录（默认内置 + COPILOT_SKILL_ROOTS） */
  skillDirs?: string[];
  /** 暂停等人工时释放 SDK session（审批可能几小时，不该占着 runtime） */
  disconnectIdle?: (sessionId: string) => Promise<unknown>;
  /** 流程定义来源（默认：技能目录里的 SKILL.md） */
  definitions?: FlowDefinitionProvider;
  /** 节点执行器（默认：复用 runExecutionTurn / HumanTaskService / ExecutionService） */
  runtime?: FlowNodeRuntime;
  /** `@agent` 能力上限（默认取 config.workflowAgentTools） */
  agentTools?: readonly FlowPermissionKind[];
}

/** 校验失败：带行号的问题列表，路由层直接回 400 */
export class FlowValidationError extends Error {
  constructor(readonly issues: FlowIssue[]) {
    super(
      `Skill Flow 校验失败：\n${issues.map((i) => `  SKILL.md:${i.line} ${i.message}`).join('\n')}`,
    );
    this.name = 'FlowValidationError';
  }
}

export interface PreparedFlow {
  skill: LoadedSkill;
  definition: FlowDefinition;
}

/** `@agent` 输出落进 workflow_state 的截断长度（它只是下一步的判断依据，不是证据仓库） */
const OUTPUT_MAX_CHARS = 4000;

/**
 * 允许"重放"的节点类型：纯计算，重跑只是多花一次算力，不会留下副作用。
 *
 * `@action` **刻意不在里面**：它可能已经把动作做出去了，重放等于重复提交。
 *
 * `@review` 同样不在里面：它的产物是一条人工任务，而"任务建没建出来"没法从 durable
 * 状态判断（`waitingTaskId` 是建完之后才写的）。重放会建出第二条一样的待办，
 * 审核人无从分辨哪条作数。见 `admitInterruptedStep()`。
 */
const REPLAY_SAFE_NODE_TYPES: ReadonlySet<FlowNodeType> = new Set<FlowNodeType>(['agent', 'gate']);

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 节点正文的第一行非空内容，用作停止/完成原因 */
function firstLine(body: string): string {
  return body.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
}

/** 一步的结果：出口名 + 落进审计的细节 */
interface StepResult {
  outcome: string;
  detail?: Record<string, unknown>;
  lastOutput?: string;
}

/** 推进过程中一次状态写入的结果：`conflict` = 另一个推进者已经改过，本次必须停下 */
type WriteOutcome = 'ok' | 'conflict';

/**
 * 带版本的 workflow 状态写入器。
 *
 * 版本号在**一次推进**内是连续的：每次写入成功都会带回新版本，下一次写入拿它做 CAS。
 * 冲突时调 `onConflict` 留痕并让调用方停止推进 —— 不抛异常，因为"另一个推进者在跑"
 * 不是错误（`runDetached` 的兜底 catch 会把它当成未预期异常把 execution 落 failed，
 * 那就把别人正在推进的流程打死了）。
 */
class StateWriter {
  constructor(
    private readonly executions: ExecutionService,
    private readonly executionId: string,
    public version: number,
    private readonly onConflict: (current?: ExecutionRecord) => Promise<void>,
  ) {}

  async write(state: WorkflowState): Promise<WriteOutcome> {
    const result = await this.executions.updateWorkflowState(
      this.executionId,
      state,
      this.version,
    );
    if (!result.ok) {
      await this.onConflict(result.current);
      return 'conflict';
    }
    this.version = result.version;
    return 'ok';
  }
}

/**
 * 由 `@review` 节点 + 服务端基策略算出**生效审批策略**。
 *
 * SKILL.md 的四个属性全部是**收窄**，没有一个能放宽：
 *
 *   role      → 与基策略取交集（写一个不在基策略里的角色 = 空集 = 校验失败）
 *   strategy  → 只能 ANY→ALL
 *   required  → 只能 ≥ 基策略票数
 *   exclude   → 只能把"允许自批"关掉，不能打开
 *
 * 外加一条**与收窄方向不同**的规则：`strategy: ALL` 必须真的是全员。
 * ANY 与 ALL 的唯一区别落在票数上，所以 `ALL + required: 1`（3 个资格角色）
 * 实际仍然只需要 1 票 —— 它只是名字叫 ALL 的 ANY。校验器会静态拒绝这种写法，
 * 这里再用 `requiredVotes()` clamp 一次（见 types.ts）。
 *
 * 运行时再 clamp 一次（而不是信任校验器）：校验器可能没被调用（比如直接构造
 * WorkflowState），而这里的 clamp 是 fail-closed 的最后一道。
 *
 * 导出给单测：这是一个纯函数，直接验它比"造一份校验器拦不住的定义再跑一遍流程"清楚得多。
 */
export function reviewPolicyFor(
  node: FlowNode,
  base: ReturnType<typeof reviewBasePolicy>,
): { policy: ApprovalPolicy } | { error: string } {
  const attrs = node.attrs;
  const roles = attrs.role
    ? base.eligibleRoles.filter((r) => r === attrs.role)
    : [...base.eligibleRoles];
  if (!roles.length) {
    return {
      error:
        `review "${node.id}" 没有生效的审核角色：` +
        (attrs.role
          ? `SKILL.md 写的 role: ${attrs.role} 不在注册表给该 review 的资格角色里`
          : '注册表没有给该 review 登记 eligibleRoles') +
        '（一个没人有资格批的任务不该被建出来）',
    };
  }
  // 基策略是 ALL 时无论 SKILL.md 写什么都保持 ALL
  const strategy = base.strategy === 'ALL' ? 'ALL' : (attrs.strategy ?? 'ANY');
  const requiredCount = requiredVotes({
    strategy,
    requiredCount:
      attrs.required !== undefined ? Math.max(base.requiredCount, attrs.required) : base.requiredCount,
    roleCount: roles.length,
  });
  return {
    policy: {
      policyId: `workflow-review:${node.id}`,
      actionType: `workflow.review.${node.id}`,
      strategy,
      requiredCount,
      eligibleRoles: roles,
      // SoD：基策略没开就一律不许自批（`exclude: none` 不能把 false 改成 true）
      allowInitiator: base.allowInitiator && attrs.exclude !== 'initiator',
      ...(base.timeoutSeconds !== undefined ? { timeoutSeconds: base.timeoutSeconds } : {}),
    },
  };
}

export class WorkflowRunner {
  /** executionId → 进程内串行链（CAS 之外的本地互斥，见类注释） */
  private readonly chains = new Map<string, Promise<void>>();
  private provider?: FlowDefinitionProvider;
  private nodeRuntime?: FlowNodeRuntime;

  constructor(private readonly deps: WorkflowRunnerDeps) {}

  private skillDirs(): string[] {
    return this.deps.skillDirs ?? skillSearchDirs();
  }

  private agentTools(): readonly FlowPermissionKind[] {
    return (
      this.deps.agentTools ?? parseAgentTools(config.workflowAgentTools, DEFAULT_AGENT_TOOLS)
    );
  }

  private definitions(): FlowDefinitionProvider {
    if (this.deps.definitions) return this.deps.definitions;
    if (!this.provider) {
      this.provider = new SkillFileDefinitionProvider({
        dirs: this.skillDirs(),
        registry: flowRegistryLookup,
        agentTools: this.agentTools(),
        requireAgentOutput: config.workflowRequireAgentOutput,
      });
    }
    return this.provider;
  }

  private runtime(): FlowNodeRuntime {
    if (this.deps.runtime) return this.deps.runtime;
    if (!this.nodeRuntime) {
      this.nodeRuntime = new DefaultFlowNodeRuntime({
        executions: this.deps.executions,
        humanTasks: this.deps.humanTasks,
        runTurn: this.deps.runTurn,
        agentTools: this.agentTools(),
      });
    }
    return this.nodeRuntime;
  }

  /** 加载 → 解析 → 校验。任一环节有问题就带上行号抛出去 */
  prepare(input: { skill: string; flow: string }): PreparedFlow {
    const loaded = this.definitions().load(input);
    if (!loaded.ok) throw new FlowValidationError(loaded.issues);
    return { skill: loaded.skill, definition: loaded.definition };
  }

  /** 只校验不抛（execution start 之前调用，把问题全部报出来再决定要不要建） */
  validate(input: { skill: string; flow: string }): { ok: boolean; issues: FlowIssue[] } {
    const loaded = this.definitions().load(input);
    return loaded.ok ? { ok: true, issues: [] } : { ok: false, issues: loaded.issues };
  }

  /**
   * 后台推进流程（202 之后调用，不阻塞 HTTP）。
   *
   * 编排器自己的异常**必须**在终态落地：只 log 的话，`buildIntent()` / `createApprovalTask()` /
   * `transition()` / registry 抛出来的意外错误会留下一个永远 `running` 的 execution ——
   * 它占着队列、挡住取消、也没人知道该不该重跑。
   *
   * 注意 `runtime.runGate()` / `runtime.runAction()` 自己 catch 了节点内的失败
   * （那是**可路由**的出口），所以这里兜住的是真正未预期的异常，
   * 测试里不容易碰到 —— 正因为不容易碰到才必须写。
   */
  runDetached(record: ExecutionRecord): void {
    void this.run(record.executionId).catch(async (err) => {
      console.error(`[workflow] execution ${record.executionId} 推进异常：`, err);
      try {
        const current = await this.deps.executions.get(record.executionId);
        if (current && !isTerminal(current.status)) {
          await this.deps.executions.fail(record.executionId, err);
        }
      } catch (failErr) {
        // 连落 failed 都失败（库挂了）：至少日志里要有，运维才能从外部状态核对
        console.error(`[workflow] execution ${record.executionId} 无法落 failed：`, failErr);
      }
    });
  }

  /** 从 execution 上的 durable 状态开始推进 */
  async run(executionId: string): Promise<void> {
    await this.withExecutionLock(executionId, async () => {
      const rec = await this.deps.executions.get(executionId);
      if (!rec) throw new Error(`execution 不存在："${executionId}"`);
      const state = rec.workflow;
      if (!state) throw new Error(`execution "${executionId}" 没有 workflow_state（不是 workflow）`);
      const loaded = await this.loadChecked(executionId, state);
      if (!loaded) return;
      if (state.steps === 0) {
        await this.append(executionId, EVT.workflowStarted, {
          skill: state.skill,
          flow: state.flow,
          start: state.current,
        });
      }
      // 等待态对账必须在"重跑节点"之前：这一步不是在等新东西，它在等一个**已经存在**的任务
      if (await this.reconcileWaiting(rec, state)) return;
      if (!(await this.admitInterruptedStep(executionId, state, loaded.definition))) return;
      await this.loop(rec, state, loaded.definition, rec.workflowVersion ?? 0);
    });
  }

  /**
   * 等待态的**对账**：durable 状态说"这一步在等任务 T"，到底该等它、还是该把那一格补完。
   *
   * 为什么需要它 —— 落库顺序是
   *
   *     建人工任务 → 落 workflow.stepStatus = waiting（带 waitingTaskId）→ 推 execution
   *
   * 崩溃可能停在第二步与第三步之间，留下 `stepStatus = waiting` + `execution = running`。
   * 那是一个**可判定**的状态（任务已经建出来了，只是没接上），但只有主动对账才能把它接上：
   * 不管它的话，`/run` 会把那个节点**再执行一遍** —— 同一个 review 建出第二条人工任务
   * （第一条还挂在审核人的"我的任务"里），或者同一个动作被再次提交。
   *
   * 反过来的顺序（先 transition 再落 workflow）就没法对账了：`execution =
   * waiting_for_approval` + `workflow.stepStatus = running` 时，"在等人工"与
   * "要重放这一步"同时成立，没有任何字段能判断该信哪个。
   *
   * ## `waitingTaskId` 说的是"任务被创建过"，不是"任务还没结束"
   *
   * 只看 durable 字段是不够的。`running` + `stepStatus = waiting` + `waitingTaskId = T`
   * 这个形状有**两个**来源，字段本身分不开：
   *
   *   甲、崩在"落 waiting"与"迁移 execution"之间 → T 还是 open，该等它
   *   乙、崩在 `resumeInto()` 的"把 execution 推出等待态"与"CAS 写 current = next"之间
   *       → T **已经被处理过**（就是那次续跑在处理它），回调不会再来了
   *
   * 乙如果不加区分地按甲处理，会把 execution 推回 `waiting_for_approval` 去等一个
   * 永不再来的回调 —— 而 `waiting_for_approval` 下 `complete()` 是静默 return 的
   * （见 ExecutionService.complete），于是这条流程**永久卡住**，连超时都救不回来
   * （超时只对 open 的任务产生回调）。这正是"先建任务"这个顺序要换来的可判定性：
   * 判定必须包含**回查任务本身的终态**，否则只是把不可判定换成了判错。
   *
   * 所以这里回查 `humanTasks.get(taskId)`：
   *   open                          → 甲，接回等待态（若 execution 还没迁过来）
   *   已收敛（approved/…/cancelled） → 乙，把那次续跑**原样重放**（`resumeFromTask()` 幂等）
   *   查不到                        → 状态与任务对不上，落 failed 让人看见
   *
   * @returns true = 已经收敛（调用方必须停止推进）
   */
  private async reconcileWaiting(rec: ExecutionRecord, state: WorkflowState): Promise<boolean> {
    if (state.stepStatus !== 'waiting') return false;
    const executionId = rec.executionId;
    const taskId = state.waitingTaskId;

    if (!taskId) {
      // 等一个不存在的任务 = 永远等下去。宁可落 failed 让人看见，也不要留在这里
      await this.failWorkflow(
        executionId,
        state,
        `节点 "${state.current}" 处于等待态但没有记录任务 id：状态不完整，无法接回人工任务`,
      );
      return true;
    }

    const task = await this.deps.humanTasks.get(taskId);
    if (!task) {
      await this.failWorkflow(
        executionId,
        state,
        `节点 "${state.current}" 记录的人工任务 "${taskId}" 不存在：durable 状态与任务对不上，无法判定该等它还是该补完这一步`,
      );
      return true;
    }

    if (task.status === 'open') {
      // 甲：任务仍在等人处理。只有"任务已建、execution 还没迁过来"这一种情况需要补迁移
      if (rec.status === 'running') {
        await this.append(executionId, EVT.workflowWaitingReconciled, {
          nodeId: state.current,
          taskId,
          note: '任务仍待处理，但 execution 还是 running（上一次推进在建任务与迁移之间退出），已接回等待态',
        });
        await this.deps.executions.transition(executionId, 'waiting_for_approval', {
          currentHumanTaskId: taskId,
          waitReason: 'approval',
        });
      }
      return true;
    }

    // 乙：任务已收敛，workflow 却还停在等待态 —— 上一次续跑没走完。回调不会再来。
    if (isTerminal(rec.status)) return true; // execution 已收敛，不必再补
    if (rec.status === 'running') {
      // resumeFromTask() 的四重绑定要求 execution 在 waiting_for_approval，先摆回去
      await this.append(executionId, EVT.workflowWaitingReconciled, {
        nodeId: state.current,
        taskId,
        taskStatus: task.status,
        note: '任务已收敛但 workflow 仍停在等待态（上一次续跑在推出等待态与推进节点之间退出），已重放该次续跑',
      });
      await this.deps.executions.transition(executionId, 'waiting_for_approval', {
        currentHumanTaskId: taskId,
        waitReason: 'approval',
      });
    }
    await this.resumeFromTask(task, task.status, task.decisions);
    return true;
  }

  /**
   * 按 executionId 串行化推进。
   *
   * CAS 已经保证"两个写者不会互相覆盖"，但**同一个进程里**两个推进者交错执行仍然会
   * 各自跑一遍节点（重复的 agent turn、重复的动作意图），所以在进程内再串一道。
   *
   * 用 promise 链而不是"忙就丢弃"：人工任务回调与恢复推进都可能排在对方后面，
   * 丢掉一条就等于丢掉一次续跑，流程会停在原地。
   */
  private withExecutionLock<T>(executionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(executionId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(executionId, tail);
    void tail.then(() => {
      if (this.chains.get(executionId) === tail) this.chains.delete(executionId);
    });
    return run;
  }

  /**
   * 上一次推进在**节点中途**退出（durable 状态里留着 `stepStatus = running`）时的准入判断。
   *
   * 这是 `stepStatus` 存在的全部意义：只有它能把"这一步已经开始过"和"这一步还没跑"区分开。
   *
   *   @agent / @gate  纯计算 → 记一条审计后直接重跑
   *   @review / @action  已经开始过 → **不重放**，落 failed 交人工核对
   *
   * `@review` 也归到"不重放"：它的执行结果是一条人工任务，而任务一旦建出来就没法从
   * durable 状态里看出来（`waitingTaskId` 是在建完之后才写的）。重放会建出第二条任务，
   * 审核人看到两条一样的待办，却没有任何字段能说清哪条作数。宁可停下来问人。
   *
   * @returns false = 已落终态 / 不该继续推进
   */
  private async admitInterruptedStep(
    executionId: string,
    state: WorkflowState,
    definition: FlowDefinition,
  ): Promise<boolean> {
    if (state.stepStatus !== 'running') return true;
    const node = definition.nodes[state.current];
    await this.append(executionId, EVT.workflowStepInterrupted, {
      nodeId: state.current,
      nodeType: node?.type ?? 'unknown',
      steps: state.steps,
    });
    // 节点不存在交给 loop() 报"节点不存在"，这里不重复判定
    if (!node || REPLAY_SAFE_NODE_TYPES.has(node.type)) return true;
    const guidance =
      node.type === 'review'
        ? '请先检查"我的任务"里是否已经有一条对应这个节点的人工任务：有就人工处理它，' +
          '没有（或已过期）再重新发起'
        : '请人工核对外部系统是否已生效（幂等键 action:<executionId>:<actionHash>），' +
          '确认后再决定是否重新发起';
    await this.failWorkflow(
      executionId,
      state,
      `节点 "${state.current}" 已开始执行但未确认完成（进程在步骤中途退出）：` +
        `已经开始过的步骤不自动重放 —— 重放可能重复提交或建出第二条人工任务。${guidance}`,
    );
    return false;
  }

  /**
   * 人工任务收敛后的续跑。由 wiring 的 dispatcher 按 `payload.workflow` 路由进来
   * （没有 workflow 标记的任务仍走 ExecutionService.onHumanTaskResolved，原有动作审批不受影响）。
   *
   * 整段跑在 execution 锁里：回调可能和"启动恢复推进"同时到达，两边都以为自己该续跑。
   */
  async onHumanTaskResolved(
    task: HumanTask,
    resolution: 'approved' | 'rejected' | 'expired' | 'cancelled' | 'input_submitted',
    decisions: HumanTask['decisions'],
  ): Promise<void> {
    await this.withExecutionLock(task.executionId, () =>
      this.resumeFromTask(task, resolution, decisions),
    );
  }

  private async resumeFromTask(
    task: HumanTask,
    resolution: 'approved' | 'rejected' | 'expired' | 'cancelled' | 'input_submitted',
    decisions: HumanTask['decisions'],
  ): Promise<void> {
    const executionId = task.executionId;
    const rec = await this.deps.executions.get(executionId);
    const state = rec?.workflow;
    if (!rec || !state) return;

    const marker = task.payload?.workflow as { nodeId?: string; kind?: string } | undefined;
    const nodeId = marker?.nodeId;

    /**
     * 绑定校验：这条任务真的是"当前这一步在等的那个任务"吗？
     *
     * 没有这一步，一条过期 / 重复 / 串台的任务回调就能把流程往前推一格 ——
     * 推错之后的状态**是自洽的**，审计链上也看不出问题，没人能发现它推错了。
     * 所以四件事必须同时成立，任一条不成立就只留痕、不动状态：
     *
     *   waitingTaskId === task.taskId   这条任务就是 durable 状态里记的那条
     *   state.current === marker.nodeId 流程还停在任务所属的那个节点上
     *   stepStatus === 'waiting'        这一步确实在等人工（不是 running/pending）
     *   status === 'waiting_for_approval' execution 确实在等审批（不是已终态）
     */
    const reject = async (reason: string, detail: Record<string, unknown> = {}): Promise<void> => {
      console.warn(`[workflow] execution ${executionId} 忽略人工任务回调：${reason}`);
      await this.append(executionId, EVT.workflowResumeRejected, {
        taskId: task.taskId,
        nodeId: nodeId ?? null,
        resolution,
        reason,
        ...detail,
      });
    };

    if (!nodeId) {
      await reject('workflow 人工任务缺少 nodeId 标记，无法判断它属于哪一步');
      return;
    }
    if (state.waitingTaskId !== task.taskId) {
      await reject('任务不是 durable 状态里记录的那一条（stale task）', {
        waitingTaskId: state.waitingTaskId ?? null,
      });
      return;
    }
    if (state.current !== nodeId) {
      await reject('任务指向的节点不是当前节点（流程已前进或被重放）', { current: state.current });
      return;
    }
    if (state.stepStatus !== 'waiting') {
      await reject('当前步骤不在等待态', { stepStatus: state.stepStatus ?? null });
      return;
    }
    if (rec.status !== 'waiting_for_approval') {
      await reject('execution 不在等待审批状态（已终态或被别人推进）', { status: rec.status });
      return;
    }

    const loaded = await this.loadChecked(executionId, state);
    if (!loaded) return;
    const node = loaded.definition.nodes[nodeId];
    if (!node) {
      await this.failWorkflow(executionId, state, `人工任务指向的节点 "${nodeId}" 不存在`);
      return;
    }
    if (resolution === 'input_submitted') {
      await this.failWorkflow(executionId, state, `workflow 节点 "${nodeId}" 不接受输入任务`);
      return;
    }

    if (marker?.kind === 'action') {
      await this.resumeAction(rec, state, node, resolution, decisions);
      return;
    }
    await this.resumeReview(rec, state, node, resolution, decisions);
  }

  // ---------- 主循环 ----------

  private async loop(
    rec: ExecutionRecord,
    initial: WorkflowState,
    definition: FlowDefinition,
    version: number,
  ): Promise<void> {
    const executionId = rec.executionId;
    let state = initial;
    const writer = new StateWriter(
      this.deps.executions,
      executionId,
      version,
      (current) => this.onWriteConflict(executionId, state, current),
    );

    for (;;) {
      const node = definition.nodes[state.current];
      if (!node) {
        await this.failWorkflow(executionId, state, `节点 "${state.current}" 不存在（SKILL.md 可能已变更）`);
        return;
      }
      if (state.steps >= MAX_FLOW_STEPS) {
        await this.failWorkflow(
          executionId,
          state,
          `超过单次 workflow 的步数上限 ${MAX_FLOW_STEPS}（环不收敛？review 一直在打回？）`,
        );
        return;
      }

      await this.append(executionId, EVT.workflowStepStarted, {
        nodeId: node.id,
        nodeType: node.type,
        step: state.steps,
      });

      // 执行**之前**先落 running：进程在节点中途退出时，durable 状态里留下"这一步开始了"。
      // 没有它，重启后既可能重放已完成的动作，也可能跳过没跑完的动作。
      if (state.stepStatus !== 'running') {
        state = { ...state, stepStatus: 'running' };
        if ((await writer.write(state)) === 'conflict') return;
      }

      let result: StepResult;
      switch (node.type) {
        case 'agent':
          result = await this.runAgentStep(rec, state, node);
          break;
        case 'gate':
          result = await this.runGateStep(rec, state, node);
          break;
        case 'action': {
          const action = await this.runActionStep(rec, state, node, writer);
          // 需要审批：流程暂停，等人工任务收敛后由 onHumanTaskResolved 续跑
          if (action === 'waiting') {
            await this.releaseSession(rec.sessionId);
            return;
          }
          if (action === 'conflict') return;
          result = action;
          break;
        }
        case 'review':
          if (!(await this.pauseForReview(rec, state, node, writer))) return;
          await this.releaseSession(rec.sessionId);
          return;
        case 'stop':
          await this.stopWorkflow(rec, state, node, writer);
          return;
        case 'end':
          await this.endWorkflow(rec, state, node, writer);
          return;
        default:
          await this.failWorkflow(executionId, state, `不支持的节点类型：${String(node.type)}`);
          return;
      }

      if (result.lastOutput !== undefined) state = { ...state, lastOutput: result.lastOutput };

      await this.append(executionId, EVT.workflowStepCompleted, {
        nodeId: node.id,
        nodeType: node.type,
        outcome: result.outcome,
        ...(result.detail ?? {}),
      });

      const next = this.findRoute(node, result.outcome);
      if (!next) {
        await this.failWorkflow(
          executionId,
          { ...state, lastOutcome: result.outcome },
          `节点 "${node.id}" 没有匹配出口 "${result.outcome}" 的 route（已声明：${node.routes.map((r) => r.on).join(', ') || '(无)'}）`,
        );
        return;
      }

      state = {
        ...state,
        current: next,
        stepStatus: 'pending',
        steps: state.steps + 1,
        lastOutcome: result.outcome,
        waitingTaskId: undefined,
      };
      // 执行完才把 current 推到下一个节点：中途退出时停在"跑了一半"的那一步，
      // 由 admitInterruptedStep() 决定能不能重放，而不是把没执行完的步骤直接跳过
      if ((await writer.write(state)) === 'conflict') return;
    }
  }

  // ---------- 节点实现（状态机这一侧：只决定出口，不管怎么执行） ----------

  /**
   * `@agent`：只把节点正文当 prompt 交给 runtime，**不再回头去技能目录里找一遍技能**。
   *
   * 原先这里会再调一次 `findSkill(node.id)` 做存在性检查。那看起来更保险，实际上
   * 引入了**第二条解析路径**：`findSkill` 会把每个候选 SKILL.md 重新读一遍、重新解析
   * frontmatter，于是"校验时看到的定义"和"执行时用的定义"可以是两份不同的内容
   * （文件在两次读之间被替换）。真正该保证的是"校验与执行用的是同一份内容"，
   * 而那由 `FlowDefinitionProvider` 单次读 + 单次解析负责（见 definition-provider.ts）。
   *
   * 技能是否存在已经在校验期查过（`validateSkillFlow` 的 `hasSkill`），而且每次
   * resume 都会重新校验一遍 —— 这里不需要第二个真相来源。
   */
  private async runAgentStep(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
  ): Promise<StepResult> {
    const prompt = node.body.trim() || `执行技能「${node.id}」`;
    const result = await this.runtime().runAgent({
      execution: rec,
      state,
      node,
      ctx: this.flowContext(rec, state, node),
      prompt,
    });
    if (!result.ok) {
      return {
        outcome: 'fail',
        detail: {
          nodeId: node.id,
          skill: node.id,
          ...(result.error ? { error: result.error } : {}),
        },
      };
    }
    return {
      outcome: 'success',
      detail: { nodeId: node.id, skill: node.id, chars: result.chars },
      lastOutput: preview(result.content, OUTPUT_MAX_CHARS),
    };
  }

  private async runGateStep(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
  ): Promise<StepResult> {
    const result = await this.runtime().runGate({
      ctx: this.flowContext(rec, state, node),
      node,
    });
    // 出口名统一小写后再路由：注册表登记时已归一化，route 的出口名由 parser 归一化，
    // 这里是第三处 —— 服务端实现的 gate 返回值是代码写的，大小写不该改变路由结果
    const outcome = result.outcome.trim().toLowerCase();
    return {
      outcome,
      detail: {
        nodeId: node.id,
        gate: node.id,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.error ? { error: result.error } : {}),
      },
    };
  }

  /**
   * `@action` 的"需要审批"分支：**先落 workflow 状态，再迁移 execution**。
   *
   * 任务此时已经建好了（runtime 只建任务、不改状态，见 runtime.ts 的契约），
   * 所以顺序必须是
   *
   *     CAS workflow = waiting(带 taskId)  →  transition execution = waiting_for_approval
   *
   * 反过来的话，两步之间崩溃会留下 `execution = waiting_for_approval` +
   * `workflow.stepStatus = running` —— 恢复时既像"在等人工"又像"要重放这一步"。
   */
  private async runActionStep(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
    writer: StateWriter,
  ): Promise<StepResult | 'waiting' | 'conflict'> {
    const result = await this.runtime().runAction({
      execution: rec,
      node,
      ctx: this.flowContext(rec, state, node),
    });

    if (result.status === 'denied') {
      return { outcome: 'fail', detail: { nodeId: node.id, ...result.detail } };
    }
    if (result.status === 'waiting') {
      const waiting: WorkflowState = {
        ...state,
        current: node.id,
        stepStatus: 'waiting',
        waitingTaskId: result.taskId,
      };
      if ((await writer.write(waiting)) === 'conflict') {
        await this.orphanTaskNote(rec.executionId, node.id, result.taskId, 'action');
        return 'conflict';
      }
      await this.deps.executions.transition(rec.executionId, 'waiting_for_approval', {
        currentHumanTaskId: result.taskId,
        waitReason: 'approval',
      });
      await this.append(rec.executionId, EVT.waitingForApproval, { taskId: result.taskId });
      await this.append(rec.executionId, EVT.workflowWaiting, {
        nodeId: node.id,
        taskId: result.taskId,
        kind: 'action',
      });
      return 'waiting';
    }
    return {
      outcome: result.ok ? 'success' : 'fail',
      detail: { nodeId: node.id, ...result.detail },
    };
  }

  /**
   * `@review`：复用 HumanTask + ApprovalPolicy，不重新发明人工任务。
   *
   * 顺序：建任务 → CAS 落 `stepStatus = waiting` → 迁移 execution 到 waiting_for_approval。
   * 理由见类注释的"进入等待态的顺序"。
   */
  private async pauseForReview(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
    writer: StateWriter,
  ): Promise<boolean> {
    const review = findFlowReview(node.id);
    if (!review) {
      await this.failWorkflow(rec.executionId, state, `review "${node.id}" 未注册`);
      return false;
    }
    // 基策略来自服务端注册表；SKILL.md 的属性只能在其上收窄（见 reviewPolicyFor）
    const computed = reviewPolicyFor(node, reviewBasePolicy(review));
    if ('error' in computed) {
      await this.failWorkflow(rec.executionId, state, computed.error);
      return false;
    }
    const description = review.description ?? firstLine(node.body);
    const opened = await this.runtime().openReview({
      execution: rec,
      state,
      node,
      policy: computed.policy,
      title: review.title,
      ...(description ? { description } : {}),
    });

    if (
      (await writer.write({
        ...state,
        current: node.id,
        stepStatus: 'waiting',
        waitingTaskId: opened.taskId,
      })) === 'conflict'
    ) {
      await this.orphanTaskNote(rec.executionId, node.id, opened.taskId, 'review');
      return false;
    }

    await this.deps.executions.transition(rec.executionId, 'waiting_for_approval', {
      currentHumanTaskId: opened.taskId,
      waitReason: 'approval',
    });
    await this.append(rec.executionId, EVT.humanTaskCreated, {
      taskId: opened.taskId,
      type: opened.type,
    });
    await this.append(rec.executionId, EVT.waitingForApproval, { taskId: opened.taskId });
    await this.append(rec.executionId, EVT.workflowWaiting, {
      nodeId: node.id,
      taskId: opened.taskId,
      kind: 'review',
    });
    return true;
  }

  /**
   * 任务建出来了、但 workflow 状态没写进去（CAS 冲突 = 另一个推进者已经在推）。
   *
   * 这条任务成了**孤儿**：它不会挂到任何 durable 状态上，也就永远不会被流程认领。
   * 刻意不在这里取消它 —— 取消需要一个人工身份，而且另一个推进者可能已经在用它。
   * 它会自然过期，过期回调也会被 `resumeFromTask()` 的绑定校验拦下（`waitingTaskId`
   * 对不上）。这里至少留一条痕，运维排查"多出来的待办"时能找到原因。
   */
  private async orphanTaskNote(
    executionId: string,
    nodeId: string,
    taskId: string,
    kind: 'review' | 'action',
  ): Promise<void> {
    console.warn(
      `[workflow] execution ${executionId} 节点 ${nodeId} 的任务 ${taskId} 未被认领（状态写入冲突），将成为孤儿任务`,
    );
    await this.append(executionId, EVT.workflowOrphanTask, {
      nodeId,
      taskId,
      kind,
      note: '人工任务已创建但 workflow 状态写入冲突：该任务不会被流程认领，等待过期',
    });
  }

  /** @stop：失败/拒绝终态。execution 落 failed（终态，不自动重试） */
  private async stopWorkflow(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
    writer: StateWriter,
  ): Promise<void> {
    const reason = firstLine(node.body) || `流程在节点 ${node.id} 终止`;
    // 终止节点也算一步：steps 要能和 stepCompleted 事件的条数对上，
    // 否则重启后的账目和实际推过的步数会差一步
    const settled: WorkflowState = {
      ...state,
      current: node.id,
      stepStatus: 'completed',
      steps: state.steps + 1,
      waitingTaskId: undefined,
    };
    await this.append(rec.executionId, EVT.workflowStepCompleted, {
      nodeId: node.id,
      nodeType: 'stop',
      outcome: 'stopped',
    });
    if ((await writer.write(settled)) === 'conflict') return;
    await this.failWorkflow(rec.executionId, settled, reason);
  }

  /** @end：成功终态 */
  private async endWorkflow(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
    writer: StateWriter,
  ): Promise<void> {
    const summary = firstLine(node.body) || '流程完成';
    const steps = state.steps + 1;
    const settled: WorkflowState = {
      ...state,
      current: node.id,
      stepStatus: 'completed',
      steps,
      lastOutcome: 'completed',
      waitingTaskId: undefined,
    };
    await this.append(rec.executionId, EVT.workflowStepCompleted, {
      nodeId: node.id,
      nodeType: 'end',
      outcome: 'completed',
    });
    if ((await writer.write(settled)) === 'conflict') return;
    await this.append(rec.executionId, EVT.workflowCompleted, {
      nodeId: node.id,
      skill: state.skill,
      flow: state.flow,
      steps,
    });
    await this.deps.executions.complete(rec.executionId, {
      result: {
        workflow: { skill: state.skill, flow: state.flow, steps, nodeId: node.id, summary },
      },
    });
  }

  // ---------- 人工任务收敛后的续跑 ----------

  private async resumeReview(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
    resolution: 'approved' | 'rejected' | 'expired' | 'cancelled',
    _decisions: HumanTask['decisions'],
  ): Promise<void> {
    // 审核出口就两个：approve / reject。
    // 想表达「打回重做」不必新造一个 decision 类型 —— 把 route 指回上一步即可
    // （`- reject -> research`），环是允许的，MAX_FLOW_STEPS 兜底。
    if (resolution !== 'approved' && resolution !== 'rejected') {
      // 过期 / 取消：流程无法继续。**必须把 execution 也落成终态** ——
      // 这条路径不走 ExecutionService.onHumanTaskResolved（workflow 任务被分派到编排器），
      // 只写一条审计事件的话，execution 会永远停在 waiting_for_approval。
      await this.settleUnresumable(rec.executionId, node, resolution);
      return;
    }
    const outcome = resolution === 'approved' ? 'approve' : 'reject';
    await this.append(rec.executionId, EVT.workflowStepCompleted, {
      nodeId: node.id,
      nodeType: node.type,
      outcome,
      resolution,
    });
    await this.resumeInto(rec.executionId, state, node, outcome);
  }

  private async resumeAction(
    rec: ExecutionRecord,
    state: WorkflowState,
    node: FlowNode,
    resolution: 'approved' | 'rejected' | 'expired' | 'cancelled',
    decisions: HumanTask['decisions'],
  ): Promise<void> {
    if (resolution === 'rejected') {
      await this.append(rec.executionId, EVT.workflowStepCompleted, {
        nodeId: node.id,
        nodeType: node.type,
        outcome: 'fail',
        resolution,
      });
      await this.resumeInto(rec.executionId, state, node, 'fail');
      return;
    }
    if (resolution !== 'approved') {
      await this.settleUnresumable(rec.executionId, node, resolution);
      return;
    }
    // 与普通动作审批**同一条**执行路径：同幂等键、同 hash/版本复核
    const result = await this.deps.executions.executeApprovedAction(rec.executionId, {
      completeOnSuccess: false,
      actor: decisions?.[decisions.length - 1]?.approverId ?? 'approver',
    });
    if (result.status === 'reapproval_required') {
      // 动作内容或数据版本变了：已另开审批任务并回到 waiting_for_approval，继续等
      return;
    }
    const ok = result.status === 'executed' && result.ok;
    await this.append(rec.executionId, EVT.workflowStepCompleted, {
      nodeId: node.id,
      nodeType: node.type,
      outcome: ok ? 'success' : 'fail',
      ...(result.status === 'executed' && result.error ? { error: result.error } : {}),
    });
    await this.resumeInto(rec.executionId, state, node, ok ? 'success' : 'fail');
  }

  /**
   * 人工任务以 expired / cancelled 收敛：流程没有可走的出口，把它落成对应的终态。
   *
   * `expired` 与 `cancelled` 是两个不同的业务事实（超时 vs 有人撤销），
   * 都用 failed 表示会把它们混成一件事。
   */
  private async settleUnresumable(
    executionId: string,
    node: FlowNode,
    resolution: 'expired' | 'cancelled',
  ): Promise<void> {
    const reason = `人工任务 ${resolution === 'expired' ? '已超时' : '已被取消'}（节点 ${node.id}）`;
    await this.append(executionId, EVT.workflowFailed, {
      nodeId: node.id,
      resolution,
      reason,
    });
    const rec = await this.deps.executions.get(executionId);
    if (!rec || isTerminal(rec.status)) return;
    try {
      await this.deps.executions.transition(executionId, resolution, { error: reason });
    } catch (err) {
      // 状态已经不允许跳过去（比如被并发取消）→ 交给 fail 兜底，绝不留 waiting
      await this.deps.executions.fail(executionId, new Error(`${reason}：${errMsg(err)}`));
    }
  }

  /** 从暂停点推进：补 resuming/running 状态 → 落新节点 → 继续主循环 */
  private async resumeInto(
    executionId: string,
    state: WorkflowState,
    node: FlowNode,
    outcome: string,
  ): Promise<void> {
    await this.append(executionId, EVT.workflowResumed, {
      nodeId: node.id,
      taskId: state.waitingTaskId,
      outcome,
    });
    const current = await this.deps.executions.get(executionId);
    if (!current) return;
    if (!(await this.ensureRunning(executionId))) {
      await this.append(executionId, EVT.workflowFailed, {
        nodeId: node.id,
        reason: `execution 已是 ${current.status}，流程无法继续`,
      });
      return;
    }
    const next = this.findRoute(node, outcome);
    if (!next) {
      await this.failWorkflow(
        executionId,
        { ...state, lastOutcome: outcome },
        `节点 "${node.id}" 没有匹配出口 "${outcome}" 的 route（已声明：${node.routes.map((r) => r.on).join(', ') || '(无)'}）`,
      );
      return;
    }
    const advanced: WorkflowState = {
      ...state,
      current: next,
      stepStatus: 'pending',
      steps: state.steps + 1,
      lastOutcome: outcome,
      waitingTaskId: undefined,
    };
    // 续跑写状态也要 CAS：拿到新版本后才继续推进，冲突说明别人已经在推了
    const written = await this.deps.executions.updateWorkflowState(
      executionId,
      advanced,
      current.workflowVersion ?? 0,
    );
    if (!written.ok) {
      await this.onWriteConflict(executionId, advanced, written.current);
      return;
    }

    const rec = await this.deps.executions.get(executionId);
    if (!rec) return;
    const loaded = await this.loadChecked(executionId, advanced);
    if (!loaded) return;
    await this.loop(rec, advanced, loaded.definition, written.version);
  }

  /**
   * 把 execution 从等待态推回 running。
   * @returns false = 状态已经不可能继续（终态/被别人改走），调用方应停止推进
   */
  private async ensureRunning(executionId: string): Promise<boolean> {
    const rec = await this.deps.executions.get(executionId);
    if (!rec) return false;
    if (rec.status === 'waiting_for_approval' || rec.status === 'waiting_for_input') {
      await this.deps.executions.transition(executionId, 'resuming');
      await this.deps.executions.transition(executionId, 'running');
      return true;
    }
    return rec.status === 'running';
  }

  // ---------- 内部 ----------

  /**
   * 状态写入冲突：另一个推进者已经改过这一段状态，本次推进必须停下。
   *
   * 刻意**不**落 failed：冲突说明有别人正在推进这个 execution（重启恢复 / 另一副本 /
   * 人工任务回调），把 execution 落成终态等于把对方正在跑的流程打死。
   * 只留一条审计事件，流程归拿到版本的那个推进者继续。
   */
  private async onWriteConflict(
    executionId: string,
    state: WorkflowState,
    current?: ExecutionRecord,
  ): Promise<void> {
    console.warn(
      `[workflow] execution ${executionId} workflow 状态写入冲突（另一个推进者已改过）：本次推进停止`,
    );
    await this.append(executionId, EVT.workflowWriteConflict, {
      nodeId: state.current,
      steps: state.steps,
      ...(current
        ? { status: current.status, persistedNode: current.workflow?.current ?? null }
        : {}),
    });
  }

  /** 唯一出口匹配：不做"只有一个出口就兜底"的猜测，出口名写错要立刻看得见 */
  private findRoute(node: FlowNode, outcome: string): string | undefined {
    return node.routes.find((r) => r.on === outcome)?.to;
  }

  private flowContext(rec: ExecutionRecord, state: WorkflowState, node: FlowNode): FlowContext {
    return {
      executionId: rec.executionId,
      sessionId: rec.sessionId,
      tenantId: rec.tenantId,
      initiatorId: rec.initiatedByUserId ?? rec.userId,
      skill: state.skill,
      flow: state.flow,
      nodeId: node.id,
      ...(rec.input !== undefined ? { input: rec.input } : {}),
      ...(state.lastOutput ? { lastOutput: state.lastOutput } : {}),
    };
  }

  private append(
    executionId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    return this.deps.executions.appendEvent({
      executionId,
      type,
      actorType: 'system',
      ...(payload ? { payload } : {}),
    });
  }

  /** 进等待态前释放 SDK session；释放失败不影响流程（下次 resume 会重新拉起） */
  private async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.deps.disconnectIdle?.(sessionId);
    } catch (err) {
      console.warn(`[workflow] 释放 session ${sessionId} 失败：${errMsg(err)}`);
    }
  }

  private async failWorkflow(
    executionId: string,
    state: WorkflowState,
    reason: string,
  ): Promise<void> {
    console.warn(`[workflow] execution ${executionId} 失败：${reason}`);
    await this.append(executionId, EVT.workflowFailed, {
      nodeId: state.current,
      steps: state.steps,
      reason,
    });
    await this.exitWaitingIfNeeded(executionId);
    await this.deps.executions.fail(executionId, new Error(`workflow 失败：${reason}`));
  }

  /**
   * 等待态**不能直接落 failed**：`ALLOWED_TRANSITIONS` 里 `waiting_for_approval` /
   * `waiting_for_input` 只有 `resuming / rejected / cancelled / expired`，没有 `failed`。
   *
   * 少了这一步，`failWorkflow()` 会抛"非法状态迁移"，而它跑在**收尾路径**上 ——
   * 异常往上抛的结果是 execution 反而永远停在等待态（`runDetached` 的兜底 catch
   * 再调一次 `fail()` 还是同一个异常，只剩一行日志）。"状态与任务对不上"这类
   * 内部不一致恰恰最常发生在等待态，所以每条收尾路径都必须能合法地退出等待。
   *
   * 走 `resuming` 而不是绕道 `running`：`resuming → failed` 是表里已有的边，少一次写入，
   * 而且语义准确 —— "本来要恢复，恢复不了"。
   */
  private async exitWaitingIfNeeded(executionId: string): Promise<void> {
    const rec = await this.deps.executions.get(executionId);
    if (!rec) return;
    if (rec.status !== 'waiting_for_approval' && rec.status !== 'waiting_for_input') return;
    await this.deps.executions.transition(executionId, 'resuming');
  }

  /**
   * 加载并确认 SKILL.md **没有在流程中途被改过**。
   *
   * sourceHash 只是一个字段，但它挡住的是金融流程最不该发生的事：
   * 已经开始的执行悄悄切到另一个版本的流程定义上继续跑。
   */
  private async loadChecked(
    executionId: string,
    state: WorkflowState,
  ): Promise<{ definition: FlowDefinition } | undefined> {
    const loaded = this.definitions().reload({
      skill: state.skill,
      flow: state.flow,
      sourceHash: state.sourceHash,
    });
    if (!loaded.ok) {
      // `skill-changed` 的问题信息本身已经说清了原委，不要再包一层"校验不过"
      const changed = loaded.issues.find((i) => i.code === 'skill-changed');
      const reason = changed
        ? changed.message
        : `SKILL.md 现在校验不过：${loaded.issues.map((i) => `SKILL.md:${i.line} ${i.message}`).join('；')}`;
      await this.failWorkflow(executionId, state, reason);
      return undefined;
    }
    return { definition: loaded.definition };
  }
}

/** 默认 `@agent` 能力上限（与 config 缺省值一致；config 为空串时兜底） */
const DEFAULT_AGENT_TOOLS: readonly FlowPermissionKind[] = ['read', 'write', 'url'];
