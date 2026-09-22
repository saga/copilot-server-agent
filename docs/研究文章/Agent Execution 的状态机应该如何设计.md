# Agent Execution 的状态机应该如何设计

Agent 开始真正进入生产环境以后，一个经常被低估的问题会出现：

> **Agent 到底应该处于什么状态？这些状态由谁改变？什么情况下可以暂停、恢复、重试、取消？**

原型阶段，Agent 往往就是一个循环：

```text
User
  ↓
LLM
  ↓
Tool
  ↓
Tool Result
  ↓
LLM
  ↓
Tool
  ↓
...
```

这已经足够做出一个可以工作的 Agent。

但生产环境很快就会遇到：

```text
LLM 调用超时了怎么办？
Tool 已经发出去，但响应没回来怎么办？
用户批准以后如何恢复？
Agent Pod 挂掉以后从哪里继续？
一个 Run 能不能同时被两个 Worker 恢复？
工具调用重试会不会重复扣款？
Policy 在等待审批期间发生变化怎么办？
多 Agent 中一个子 Agent 失败，父 Agent 是继续还是终止？
业务 Case 状态和 Agent Session 状态谁是事实来源？
```

这些问题本质上都不是 Prompt Engineering 问题，而是 **Execution State Management** 问题。

目前主流 Agent 平台已经明显朝这个方向演进。Anthropic 把 workflow 与 agent 区分为“代码定义的固定路径”和“LLM 动态决定过程”；AWS 的 Agentic AI Lens 将 checkpoint、状态恢复、幂等、阶段化恢复、分级人工审批列为生产 Agent 的核心能力；LangGraph 使用 checkpoint + interrupt 实现可恢复执行；OpenAI Agents SDK 已经提供可序列化的 `RunState`，用于 Human-in-the-loop 的暂停与恢复；AWS AgentCore 则把 session、隔离执行环境和持久化状态直接作为 Runtime 能力。

因此，一个成熟的 Agent Runtime 不应该再被设计成：

```text
while (!done) {
    call LLM
    if tool:
        call tool
}
```

更准确的模型应该是：

```text
LLM 决定“下一步想做什么”
        ↓
Runtime 验证“现在允许不允许做”
        ↓
State Machine 决定“当前 Run 是否可以进入下一状态”
        ↓
Tool Executor 执行
        ↓
结果形成 Event
        ↓
State Machine 再次推进
```

这篇文章讨论的，就是这套状态机应该如何设计。

---

# 一、首先要区分三个完全不同的 State

Agent 系统最常见的问题，是把三个不同层次的 State 混在一起：

```text
Business State
Agent Run State
Tool Execution State
```

它们都叫 State，但职责完全不同。

例如一个金融业务：

```text
Proxy Vote Case
```

业务状态可能是：

```text
DRAFT
→ REVIEW_REQUIRED
→ APPROVED
→ SUBMITTED
→ CONFIRMED
```

Agent Run 状态可能是：

```text
QUEUED
→ RUNNING
→ WAITING_APPROVAL
→ RUNNING
→ SUCCEEDED
```

某次调用外部投票系统的 Tool，又可能处于：

```text
PROPOSED
→ POLICY_CHECKED
→ EXECUTING
→ SUCCEEDED
```

这三个状态绝不能合并成一个巨大状态机。

推荐关系应该是：

```text
Business Workflow
        │
        │ owns
        ▼
Business State

Agent Runtime
        │
        │ executes work for
        ▼
Agent Run State

Tool Runtime
        │
        │ executes side effect
        ▼
Tool Execution State
```

这也是生产 Agent 系统里非常重要的一条边界：

> **Agent Runtime 管“执行到哪里了”；Workflow / Domain 管“业务进行到哪里了”。**

AWS 的 Agentic AI Lens 将可靠性、状态恢复、Workflow orchestration 和 Agent execution 分成不同能力，并明确建议对于确定的工作流使用 state-machine/workflow orchestration，而 Agent 负责动态决策的部分。

Anthropic 也把固定路径 workflow 与由 Agent 自己决定工具使用和过程的 agent 做了明确区分。

---

# 二、Agent State Machine 不应该试图描述 LLM 的“思考过程”

这是设计 Agent State Machine 时最容易走偏的地方。

很多设计会写成：

```text
THINKING
→ PLANNING
→ REASONING
→ REFLECTING
→ THINKING
→ ...
```

这实际上没有太大价值。

因为这些状态：

```text
THINKING
PLANNING
REFLECTING
```

本身并不是可靠的 Runtime 状态。

LLM 内部到底怎么推理，系统通常无法以稳定、可验证、可恢复的方式把它当作业务状态。

ReAct 的研究表明，LLM Agent 的典型工作方式本身就是 reasoning 与 acting 交替进行：模型根据环境反馈更新下一步行动。

Anthropic 后来的工程实践也采用类似思想：Agent 根据工具和环境结果不断推进，并在长运行任务中通过 checkpoints、retry 和 resume 来保持可恢复性。

因此，Runtime 应该记录：

```text
MODEL_REQUESTED
MODEL_COMPLETED
TOOL_PROPOSED
POLICY_CHECKED
TOOL_STARTED
TOOL_COMPLETED
```

而不是：

```text
I_AM_THINKING
I_AM_PLANNING
I_AM_REFLECTING
```

换句话说：

> **State Machine 管可观察、可恢复、可控制的执行边界，而不是管理模型的内部认知过程。**

---

# 三、最合理的设计是“动态 Agent Loop + 确定性 Execution FSM”

这是整个架构的核心。

```text
                 ┌───────────────────────┐
                 │       Agent           │
                 │                       │
                 │ understand            │
                 │ plan                  │
                 │ choose tool           │
                 │ interpret result      │
                 └──────────┬────────────┘
                            │
                       Proposal
                            │
                            ▼
                 ┌───────────────────────┐
                 │    Execution FSM      │
                 │                       │
                 │ validate              │
                 │ authorize             │
                 │ approve               │
                 │ execute               │
                 │ retry                 │
                 │ pause                 │
                 │ resume                │
                 └──────────┬────────────┘
                            │
                            ▼
                         Tool/API
```

Agent 可以动态决定：

```text
搜索什么
先查哪个系统
是否需要进一步调查
是否调用子 Agent
如何解释结果
```

但 Runtime 必须确定：

```text
是否允许调用
当前 Run 是否还能执行
是否需要审批
是否已经执行过
失败后是否可以重试
是否能够恢复
是否允许进入下一个状态
```

AWS 明确建议将 deterministic enforcement 与 probabilistic controls 分开，并将高风险操作通过确定性的风险分类路由到人工审批，而不是把这些边界交给模型本身。

---

# 四、推荐使用“分层状态机”，而不是一个巨大 FSM

一个实用的 Agent Runtime，可以分成三层。

```text
Level 1: Run FSM
        ↓
Level 2: Turn / Step FSM
        ↓
Level 3: Tool Execution FSM
```

---

## 4.1 Level 1：Run FSM

Run 是最重要的持久化状态。

推荐最少有：

```text
CREATED
QUEUED
RUNNING
WAITING_INPUT
WAITING_APPROVAL
WAITING_EXTERNAL
RETRY_WAIT
PAUSED
CANCELLING
SUCCEEDED
FAILED
CANCELED
EXPIRED
RECOVERY_REQUIRED
```

典型路径：

```text
CREATED
   ↓
QUEUED
   ↓
RUNNING
   ├──────────────→ WAITING_INPUT
   │                    ↓
   │                  RUNNING
   │
   ├──────────────→ WAITING_APPROVAL
   │                    ↓
   │              APPROVED / REJECTED
   │                    ↓
   │                 RUNNING
   │
   ├──────────────→ WAITING_EXTERNAL
   │                    ↓
   │                 RUNNING
   │
   ├──────────────→ RETRY_WAIT
   │                    ↓
   │                 RUNNING
   │
   ├──────────────→ RECOVERY_REQUIRED
   │
   ├──────────────→ FAILED
   │
   ├──────────────→ CANCELED
   │
   └──────────────→ SUCCEEDED
```

这里最值得强调的是：

> **`WAITING_APPROVAL`、`WAITING_EXTERNAL` 和 `RECOVERY_REQUIRED` 必须是正式状态，而不能只是某个 Node 里 `await` 一下。**

因为 Server-side Agent 很可能等几十分钟、几小时甚至更久。

OpenAI Agents SDK 的 `RunState` 就是一个很接近这个思想的实现：当工具需要审批时，Run 会被中断，完整 execution state 可以序列化，审批完成后从保存的 State 恢复。

LangGraph 的 `interrupt()` 也是类似思路：保存 graph state，等待外部输入，之后使用相同的 `thread_id` 恢复。

---

# 五、Level 2：Turn / Step State 不应该无限持久化

一个 Run 里面可能有很多 Agent turns：

```text
Turn 1
  LLM
  tool A

Turn 2
  LLM
  tool B

Turn 3
  LLM
  tool C
```

可以定义：

```text
MODEL_RUNNING
MODEL_RESULT_RECEIVED
PROPOSAL_VALIDATING
POLICY_CHECKING
WAITING_APPROVAL
TOOL_READY
TOOL_EXECUTING
TOOL_RESULT_RECEIVED
CONTINUING
```

但这些状态主要用于：

```text
Runtime coordination
Observability
Recovery
```

而不是全部作为长期业务状态。

例如：

```text
MODEL_RUNNING
```

可能只存在几秒。

它不需要变成：

```text
业务数据库里永久保存的一行“当前状态”
```

真正需要 durable persistence 的应该是：

```text
checkpoint
pending tool call
approval
external job
important output
recovery boundary
```

AWS 的 Agentic AI Lens 明确建议在有意义的阶段边界做 checkpoint，而不是每个 reasoning step 都同步保存；否则状态存储成本会快速增长。

---

# 六、Level 3：Tool Execution 必须单独建 State Machine

这是最容易被忽略、但实际上最重要的一层。

考虑：

```text
Agent → submit_trade()
```

不能简单认为：

```text
tool_call
```

只有：

```text
success / failure
```

更实际的是：

```text
PROPOSED
   ↓
VALIDATING
   ↓
AUTHORIZED
   ↓
APPROVAL_PENDING
   ↓
READY
   ↓
EXECUTING
   ├────→ SUCCEEDED
   ├────→ FAILED
   └────→ UNKNOWN
```

尤其必须有：

```text
UNKNOWN
```

---

# 七、为什么必须存在 UNKNOWN？

假设 Agent 调用：

```http
POST /payment
```

服务器返回：

```text
timeout
```

现在到底发生了什么？

有三种可能：

```text
A. 请求根本没有到达
B. 请求到了但业务系统拒绝
C. 请求已经成功，但响应在网络里丢了
```

如果 Runtime 看到 timeout 就：

```text
FAILED
```

然后重新执行：

```text
POST /payment
```

可能造成重复付款。

因此：

```text
timeout
≠
failed
```

更准确的是：

```text
EXECUTION_UNKNOWN
```

然后进入：

```text
RECONCILING
```

再通过：

```text
idempotency key
query API
transaction status
execution ledger
```

判断最终结果。

AWS 的 Agentic AI Lens 将幂等执行列为高风险项，并明确指出 checkpoint recovery 如果没有 idempotency，重放可能造成 duplicate side effects 或数据损坏。

AWS Step Functions 也明确区分执行语义、Retry 和外部任务行为，并提供 Callback、Retry、Catch 等机制来处理这些情况。

因此一个可靠的 Agent Runtime 应该至少区分：

```text
FAILED
```

和：

```text
OUTCOME_UNKNOWN
```

这是生产环境和 Demo 最大的差别之一。

---

# 八、Agent Runtime 的核心原则：LLM 不能直接改变 State

假设 LLM 返回：

```json
{
  "action": "submit_vote",
  "approved": true
}
```

Runtime 不应该直接做：

```text
approved == true
→ transition to EXECUTING
```

而应该：

```text
LLM Output
   ↓
Parse
   ↓
Schema Validation
   ↓
Policy Check
   ↓
Authorization
   ↓
Approval Check
   ↓
State Transition
   ↓
Tool Execution
```

即：

> **LLM 输出应该被看作 Command / Proposal，而不是 State。**

这与 AWS Agentic AI Lens 对 deterministic enforcement 的设计方向一致：权限、输入验证、风险分类和审批应该在确定性控制层实施，而不是只依赖自然语言指令。

AgentDojo 等研究也表明，Tool 返回的数据本身可能成为 prompt injection 载体，LLM agent 即使在没有攻击时也可能失败，因此不应该把模型一次输出直接当作可信的执行决定。

---

# 九、推荐采用 Event → Transition → Snapshot，而不是直接 UPDATE state

一个非常实用的实现方式是：

```text
Command
  ↓
Transition Guard
  ↓
Event
  ↓
Apply Event
  ↓
New State
```

例如：

```text
ApproveToolCall
       ↓
validate pending approval
       ↓
ApprovalGranted
       ↓
Run:
WAITING_APPROVAL → RUNNING
```

数据库可以保持：

```text
agent_run
agent_run_event
agent_checkpoint
```

而不是只存：

```text
agent_run.status = 'RUNNING'
```

例如：

```text
agent_run
------------------------------
run_id
status
version
current_step
checkpoint_id
waiting_reason
updated_at
```

以及：

```text
agent_run_event
------------------------------
event_id
run_id
sequence
event_type
event_payload
created_at
actor
```

这种设计的价值不是为了“上 Event Sourcing 很先进”，而是解决三个现实问题：

```text
1. 如何审计状态为什么变化
2. 如何恢复
3. 如何防止并发 Worker 抢同一个 Run
```

最小实现甚至不需要完整 Event Sourcing。

可以采用：

```text
Current State Snapshot
+
Append-only Event Log
+
Checkpoint
```

这通常已经足够。

---

# 十、状态转换必须有版本号

假设两个 Worker 同时看到：

```text
RUNNING
```

然后：

```text
Worker A → WAITING_APPROVAL

Worker B → SUCCEEDED
```

如果直接：

```sql
UPDATE agent_run
SET status = ...
WHERE run_id = ...
```

最后谁写得晚谁赢。

这在 Agent Runtime 中非常危险。

应该采用：

```sql
UPDATE agent_run
SET
    status = :new_status,
    version = version + 1
WHERE run_id = :run_id
  AND version = :expected_version;
```

如果更新结果是：

```text
0 rows
```

说明当前 State 已被其他执行者改变。

于是：

```text
reload state
→ reconcile
→ decide whether continue
```

这样才能保证：

```text
one logical Run
=
one authoritative transition sequence
```

---

# 十一、State Machine 应该有明确的 Transition Invariant

例如：

```text
CREATED
→ 只能 QUEUED / CANCELED
```

```text
QUEUED
→ 只能 RUNNING / CANCELED
```

```text
RUNNING
→ 只能：
   WAITING_INPUT
   WAITING_APPROVAL
   WAITING_EXTERNAL
   RETRY_WAIT
   SUCCEEDED
   FAILED
   CANCELED
   RECOVERY_REQUIRED
```

```text
SUCCEEDED
FAILED
CANCELED
EXPIRED
→ terminal
```

Terminal state 默认不能再修改。

例如：

```text
SUCCEEDED
→ RUNNING
```

必须禁止。

如果真的需要重新执行：

```text
create new Run
```

而不是：

```text
reuse old Run
```

这样可以极大降低恢复和审计复杂度。

---

# 十二、Approval 不是一个 Boolean

非常不推荐：

```json
{
  "approved": true
}
```

真正的 Approval 应该是一个独立对象：

```json
{
  "approval_id": "apr_123",
  "run_id": "run_456",
  "tool_call_id": "call_789",
  "action_hash": "sha256:...",
  "requested_by": "agent_x",
  "reviewer": "user_123",
  "decision": "APPROVED",
  "decided_at": "...",
  "expires_at": "..."
}
```

其中尤其重要的是：

```text
action_hash
```

因为不能允许：

```text
User approved:

submit_vote(
    fund=A,
    vote=FOR
)
```

然后 Agent 在恢复时偷偷执行：

```text
submit_vote(
    fund=A,
    vote=AGAINST
)
```

Approval 应该绑定到具体的：

```text
Tool
Arguments
Resource
Risk Classification
Policy Version
```

OpenAI Agents SDK 的文档已经明确要求 server-side approval 必须绑定服务器保存的 pending request，审核者身份由应用认证系统确定，不能从 client 传入的 approval body 中直接信任；同时要防止同一个 approval snapshot 被并发或重复消费。

因此：

> **Approval 的本质不是“人点了按钮”，而是对一个精确 Action Proposal 的授权。**

---

# 十三、Approval 期间 Policy 可能发生变化

这是金融场景尤其需要注意的问题。

例如：

```text
10:00 Agent 提交交易
10:01 进入 WAITING_APPROVAL
10:15 用户批准
10:16 执行
```

但在：

```text
10:10
```

的时候：

```text
Restricted List
```

发生变化。

因此不能简单认为：

```text
approved = true
→ execute
```

更安全的模型是：

```text
Proposal
 ↓
Policy Check
 ↓
Approval
 ↓
Revalidate Policy
 ↓
Execute
```

即：

> **Approval 是必要条件，不一定是充分条件。**

特别是长时间等待的审批，执行前应该重新确认：

```text
authorization
policy version
resource status
action validity
deadline
```

这也符合 AWS 对风险分级审批和可撤销、受范围限制的 approval grant 的建议。

---

# 十四、Retry 不应该是一个统一的“自动重试”

Agent Runtime 至少应该把失败分成：

```text
Transient
Permanent
Business Rejection
Policy Rejection
Unknown Outcome
```

例如：

| 错误                          | 推荐处理                       |
| --------------------------- | -------------------------- |
| 429                         | Retry                      |
| 503                         | Retry                      |
| 网络连接失败，且无副作用                | Retry                      |
| Schema validation failed    | 不重试                        |
| Permission denied           | 不重试                        |
| Policy denied               | 不重试                        |
| Business rule rejected      | 不重试                        |
| Tool timeout，可能已执行          | Unknown / Reconcile        |
| Provider timeout，尚未确认是否生成结果 | Recovery / retry with care |
| Agent loop 超限               | Fail / escalate            |

AWS Step Functions 的 `Retry` / `Catch` 就是典型的显式错误分类模型，而不是所有失败都重新执行。

所以不要写：

```python
except Exception:
    retry()
```

而应该：

```text
error
  ↓
classify
  ├── retryable
  ├── non_retryable
  ├── business_failure
  └── outcome_unknown
```

---

# 十五、“重试 Agent”与“重试 Tool”是两回事

例如：

```text
LLM
 ↓
Tool A
 ↓
Tool B
```

Tool B 失败了。

最危险的做法是：

```text
restart entire Agent
```

因为可能重复：

```text
Tool A
```

正确做法应该尽可能是：

```text
Checkpoint after Tool A
          ↓
Tool B failed
          ↓
Retry only Tool B
```

如果：

```text
Tool B = side effect
```

再配合：

```text
idempotency key
```

进行安全重试。

Anthropic 在长运行 Agent 的工程实践中明确提到：不能因为中途错误就从头重新运行整个 Agent，需要通过 durable execution、regular checkpoints 和 retry logic 从已有进度继续。

AWS 也明确建议把工作流拆成阶段，在自然边界持久化结果，从最后一个成功 checkpoint 恢复，而不是整个流程从头开始。

---

# 十六、Checkpoint 应该放在哪里？

不是：

```text
每一个 token
```

也不是：

```text
每一次 LLM call
```

更合理的是：

> **放在“已经完成、有独立价值、可以安全恢复”的语义边界。**

例如：

```text
Parse Document
       ↓ checkpoint

Retrieve Relevant Evidence
       ↓ checkpoint

Generate Proposal
       ↓ checkpoint

Policy Check
       ↓ checkpoint

Approval
       ↓ checkpoint

Execute
       ↓ checkpoint

Verify Result
```

而不是：

```text
LLM token 1
LLM token 2
LLM token 3
...
```

AWS 的 Agentic AI Lens 对此非常明确：长运行任务应该在 natural stage boundaries 建立 checkpoint，并要求 stage outputs 可独立验证；同时不应无意义地在每个 reasoning step 做同步持久化。

LangGraph 也将 node boundary 作为 durable execution 的关键边界，因为恢复时会从中断 Node 的起点重新执行，因此 Node 太粗会导致大量重复工作，太细则会增加复杂度。

---

# 十七、一个非常重要的设计：Checkpoint 前后必须考虑副作用

例如：

```text
Node: submit_payment
```

如果状态保存：

```text
BEFORE checkpoint
```

然后：

```text
payment API successfully executes
```

服务器突然崩溃。

恢复后：

```text
重新运行 submit_payment
```

就可能重复付款。

因此高风险 side effect 更合理的模式是：

```text
1. Persist Execution Intent
2. Generate Idempotency Key
3. Execute Side Effect
4. Persist Execution Result
5. Transition State
```

例如：

```text
EXECUTION_INTENT_RECORDED
        ↓
TOOL_EXECUTING
        ↓
TOOL_SUCCEEDED
        ↓
RUNNING
```

如果第二次恢复：

```text
发现同一个 idempotency_key
→ query existing result
→ 不重新创造副作用
```

这个模式比简单地：

```text
checkpoint = current_state
```

可靠得多。

AWS 明确把外部调用的 idempotency keys、conditional writes 和 event deduplication 作为 checkpoint-based recovery 的配套要求。

---

# 十八、业务 Workflow 状态不要塞进 Agent Run

假设：

```text
Trade Case
```

拥有：

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
EXECUTED
```

这些状态应该由：

```text
Domain / Workflow Service
```

拥有。

Agent Runtime 只需要：

```text
RUNNING
WAITING_APPROVAL
SUCCEEDED
```

例如：

```text
Business Workflow
-----------------------------
Trade Case
UNDER_REVIEW
        ↓
APPROVED
        ↓
EXECUTED


Agent Run
-----------------------------
RUNNING
        ↓
WAITING_APPROVAL
        ↓
RUNNING
        ↓
SUCCEEDED
```

一个业务 Case 甚至可以拥有多个 Agent Runs：

```text
Case #123

Run #1: Research
Run #2: Risk Analysis
Run #3: Draft Client Email
Run #4: Submit Trade
```

因此：

```text
Business Case ≠ Agent Run
```

这对长期运行金融 Agent 尤其重要。

---

# 十九、为什么不能让 Agent Memory 充当状态机？

例如：

```text
Memory:
"已经审批了，可以继续"
```

这是危险的。

因为：

```text
Memory
```

回答的是：

> Agent 记得什么？

而：

```text
Business State
```

回答的是：

> 系统当前的事实是什么？

真正的执行条件应该来自：

```text
System of Record
+
Policy
+
Workflow State
```

而不是：

```text
LLM Memory
```

AWS 也明确把短期 session context、长期 memory、workflow checkpoint 和业务执行状态区分开，并建议分别管理。

---

# 二十、Multi-Agent 不应该共享一个巨大状态对象

例如：

```text
Supervisor Agent
   ├── Research Agent
   ├── Risk Agent
   └── Compliance Agent
```

推荐：

```text
Parent Run
   │
   ├── Child Run A
   ├── Child Run B
   └── Child Run C
```

每一个 Child Run 都拥有：

```text
run_id
status
checkpoint
events
outputs
errors
```

Parent 只保存：

```text
child_run_id
dependency
join status
```

例如：

```text
PARENT RUN
    ↓
FAN OUT
    ├── Research RUN-101
    ├── Risk RUN-102
    └── Compliance RUN-103
             ↓
          JOIN
             ↓
        SYNTHESIS
```

这样某个 Agent 失败：

```text
Risk RUN-102 = FAILED
```

并不意味着：

```text
整个 Agent Runtime 的 state object 损坏
```

而是由 Parent 的 transition policy 决定：

```text
FAILED child
→ retry
→ fallback
→ continue with partial result
→ terminate parent
```

AWS 的 Agentic AI Lens 将多 Agent 协调、arbiter、handoff 和 distributed failure 单独作为架构问题，而不是把它们隐含在一个“大 Agent State”里。

OpenAI 近期 Agents API 也把 subagents 作为独立 execution context，并支持并行执行。

---

# 二十一、Agent Run 应该采用显式 Event Model

一个推荐的 Event 集合：

```text
RunCreated
RunQueued
RunStarted

ModelCallStarted
ModelCallCompleted
ModelCallFailed

ToolProposalCreated
ToolValidationPassed
ToolValidationFailed

PolicyCheckStarted
PolicyAllowed
PolicyDenied
ApprovalRequested
ApprovalGranted
ApprovalRejected

ToolExecutionStarted
ToolExecutionSucceeded
ToolExecutionFailed
ToolExecutionUnknown
ToolOutcomeReconciled

CheckpointCreated

RunPaused
RunResumed
RunCanceled
RunExpired

RunSucceeded
RunFailed
RunRecoveryRequired
```

这套 Event Model 的好处是：

```text
当前状态
=
事件折叠结果
```

但真正落地时不一定要严格做完整 event sourcing。

简单版本完全可以：

```text
agent_run.status
+
agent_run.version
+
agent_run_event
+
agent_checkpoint
```

这样已经足够支持：

```text
audit
recovery
debugging
concurrency control
```

---

# 二十二、建议把 State、Event、Command 三个概念严格分开

这是实现层面最重要的三个词。

### Command

表示：

> 我想让系统做什么。

例如：

```text
StartRun
ApproveToolCall
CancelRun
ResumeRun
```

### Event

表示：

> 系统实际上发生了什么。

例如：

```text
RunStarted
ApprovalGranted
ToolExecutionSucceeded
```

### State

表示：

> 系统现在处于什么状态。

例如：

```text
RUNNING
WAITING_APPROVAL
SUCCEEDED
```

因此：

```text
LLM
  ↓
Command / Proposal

Runtime
  ↓
Validate

Event
  ↓
State transition
```

千万不要：

```text
LLM
  ↓
directly mutate state
```

---

# 二十三、一个完整的 Agent Execution State Machine

综合前面的原则，可以得到：

```text
                         ┌──────────────┐
                         │   CREATED    │
                         └──────┬───────┘
                                ↓
                         ┌──────────────┐
                         │   QUEUED     │
                         └──────┬───────┘
                                ↓
                     ┌────────────────────┐
                     │      RUNNING       │
                     └─────────┬──────────┘
                               │
               ┌───────────────┼────────────────┐
               │               │                │
               ▼               ▼                ▼
       WAITING_INPUT   WAITING_APPROVAL   WAITING_EXTERNAL
               │               │                │
               └───────┬───────┴────────┬───────┘
                       │                │
                       ▼                ▼
                    RUNNING        RETRY_WAIT
                       │                │
                       ├────────────────┘
                       │
              ┌────────┼─────────┐
              │        │         │
              ▼        ▼         ▼
         SUCCEEDED   FAILED   CANCELED
              │
              ▼
           terminal


特殊恢复路径：

RUNNING
   ↓
Tool outcome uncertain
   ↓
RECOVERY_REQUIRED
   ↓
RECONCILING
   ├── SUCCESS → continue
   ├── FAILURE → fail
   └── UNKNOWN → manual / policy escalation
```

这里有三个非常重要的特点。

第一：

```text
Agent 的 dynamic reasoning
```

只发生在：

```text
RUNNING
```

内部。

第二：

```text
等待
```

是正式状态。

第三：

```text
Unknown outcome
```

是正式状态，而不是简单的 `FAILED`。

---

# 二十四、不要把所有等待都建成一个 WAITING

实际系统最好区分：

```text
WAITING_INPUT
WAITING_APPROVAL
WAITING_EXTERNAL
RETRY_WAIT
PAUSED
```

因为它们的恢复条件完全不同。

| 状态               | Resume 条件     |
| ---------------- | ------------- |
| WAITING_INPUT    | 用户提交输入        |
| WAITING_APPROVAL | 授权人批准         |
| WAITING_EXTERNAL | 外部事件/Callback |
| RETRY_WAIT       | Timer 到期      |
| PAUSED           | 管理员/系统恢复      |

这样做以后：

```text
GET /runs/:id
```

就可以明确告诉 UI：

```json
{
  "status": "WAITING_APPROVAL",
  "resume_condition": "approval",
  "approval_id": "apr_123"
}
```

而不是：

```json
{
  "status": "WAITING"
}
```

---

# 二十五、为什么 Server-side Agent 特别需要这样的 State Machine？

IDE Agent 有一个天然优势：

```text
用户就在旁边。
```

Server-side Agent 没有。

一个 Cloud Agent 可以：

```text
运行 30 分钟
暂停 4 小时
重新恢复
再运行 2 小时
```

OpenAI 近期将 Codex harness 做成 Agents API 时，就把“长时间运行”“durable sessions”“恢复”“sandbox”和“中间结果保存”作为核心能力，而不是普通 stateless API 的附加功能。

AWS AgentCore 也直接把 session lifecycle、Active / Idle / Stopped 状态、session resume 和 execution environment isolation 作为 Runtime 本身的能力。

所以：

> **Server-side Agent Runtime 如果没有持久化 State，本质上只是一个长一点的 HTTP request。**

---

# 二十六、Anthropic 的长期 Agent 实践说明：必须把“恢复”当作正常路径

Anthropic 在自己的 multi-agent research system 中明确提到，长运行 Agent 会跨很多 Tool Call，错误会累积，因此不能因为错误发生就从头开始；其系统使用 durable execution、retry 和 regular checkpoints，让 Agent 可以从中间继续。

Anthropic 后续关于 long-running agents 的工程实践进一步强调，跨多个 context windows 时，需要借助初始化 Agent、增量工作和清晰 artifacts，使后续 session 能接着前一阶段继续工作。

这说明：

```text
Resume
```

不是异常功能。

对于真正长期运行的 Agent：

> **Resume 是普通执行路径之一。**

---

# 二十七、金融服务场景应该进一步增加“Policy Check”这个状态边界

金融 Agent 不应该是：

```text
LLM
→ Tool
```

而应该是：

```text
LLM
→ Proposal
→ Policy
→ Approval
→ Tool
```

例如一个交易 Agent：

```text
RUNNING
   ↓
PROPOSE_TRADE
   ↓
POLICY_CHECK
   ├── DENY → FAILED / REJECTED
   ├── ALLOW → TOOL_READY
   └── REQUIRE_APPROVAL
             ↓
       WAITING_APPROVAL
             ↓
         APPROVED
             ↓
       POLICY_RECHECK
             ↓
        TOOL_EXECUTING
```

这里 Policy 不应该只是：

```text
SKILL.md:
"Make sure you are authorized."
```

而应该是一个实际的 transition guard。

AWS Agentic AI Lens 明确建议通过 deterministic risk classification 把 Agent Action 路由到 autonomous、notify、approve 等不同等级，并强调高风险操作应在执行前进行 Human review。

FINRA 2026 年对证券行业 GenAI 的监管观察也明确提出机构应关注 Agent 的系统访问、数据处理、human-in-the-loop、Agent actions/decisions 以及限制 Agent 行为的 guardrails。

---

# 二十八、一个真实金融案例：Deutsche Bank 的 TPRM AI

Deutsche Bank 在 2026 年公开介绍了一个已经用于第三方风险管理的 agentic AI 系统。

其 TPRM AI 使用三个专门 Agent 顺序执行：

```text
Agent 1
检索相关 control questions

      ↓

Agent 2
根据供应商材料形成答案

      ↓

Agent 3
提出评估结果并给出精确引用

      ↓

Human Assessor
review / edit / override
```

Deutsche Bank 表示，该系统于 2025 年 12 月进入 Global Procurement & Vendor Management，用于供应商证据审查；其公开数据称人工评估一个证据文件通常约 30 分钟，而 TPRM AI 可在不到两分钟内分析最多五个文档并给出带引用的建议结果。最终决策权仍由训练有素的人工评估者掌握。

这个案例尤其适合用来理解 Agent Execution State Machine。

虽然 Deutsche Bank 并未公开其内部 Runtime 的具体 FSM 实现，因此不能据此断言其系统内部就是某一种状态机，但从公开描述的顺序 Agent、结果建议和人工最终决策，可以看到一个很自然的阶段模型：

```text
INGEST_EVIDENCE
      ↓
RETRIEVE_CONTROLS
      ↓
ANALYZE_EVIDENCE
      ↓
PROPOSE_OUTCOME
      ↓
HUMAN_REVIEW
      ├── ACCEPT
      ├── EDIT
      └── OVERRIDE
      ↓
FINALIZE
```

关键不在于三个 Agent，而在于：

> **Agent 可以负责“产生建议”，但 Business Decision / Final Outcome 有自己的控制边界。**

这正是金融 Agent Execution State Machine 应该表达的东西。

---

# 二十九、金融监管环境也意味着“状态变化”必须可追踪

FSB 2026 年关于金融机构负责任采用 AI 的 consultation report，将 AI governance 扩展到组织级 AI lifecycle，并强调金融机构需要识别和管理 AI adoption 带来的风险，同时给出了涵盖治理、开发和部署生命周期的 12 项 sound practices。

这意味着 Agent Runtime 的 audit 不应该只有：

```text
Prompt
Response
```

而应该能够回答：

```text
Run 在什么时候开始？
为什么进入 WAITING_APPROVAL？
哪一个 Tool Call 触发了审批？
Policy 当时是什么？
谁批准？
Approval 针对什么具体 Action？
恢复后重新进行了哪些检查？
实际 Tool 是否成功？
最终 Business State 变成了什么？
```

FINRA 对 Agent actions、decisions 和 control mechanisms 的关注同样说明，生产 Agent 的可追踪性必须延伸到执行边界，而不只是模型输出。

---

# 三十、Workflow State Machine 与 Agent State Machine 应该如何配合？

这是架构设计中最容易混淆的地方。

推荐：

```text
             Business Workflow
                    │
                    │ command
                    ▼
             Agent Run
                    │
                    │ proposal
                    ▼
             Policy Engine
                    │
                    │ allow / approve
                    ▼
             Tool Execution
                    │
                    │ result
                    ▼
             Agent Run
                    │
                    │ business action
                    ▼
             Business Workflow
```

因此：

```text
Workflow
```

定义：

```text
业务流程是什么
```

而：

```text
Agent Runtime
```

定义：

```text
Agent 如何完成这个流程中的某一个工作
```

例如：

```text
Business Workflow:

CASE_CREATED
→ REVIEWING
→ APPROVAL_REQUIRED
→ APPROVED
→ EXECUTED
→ CLOSED
```

Agent Runtime：

```text
RUNNING
→ WAITING_APPROVAL
→ RUNNING
→ SUCCEEDED
```

这是两个不同的 FSM。

---

# 三十一、什么时候应该直接用传统 Workflow Engine？

并不是每个 Agent 都需要一个复杂的 Agent FSM。

如果流程是：

```text
A → B → C → D
```

而且：

```text
A/B/C/D
```

长期稳定、规则明确、可预测，那么传统 Workflow / State Machine 更合适。

Anthropic 的实践明确认为：定义清楚的任务更适合 workflow，因为它能提供更强的 predictability 和 consistency；只有当需要模型动态决定过程时，才有理由引入 Agent。

AWS Agentic AI Lens 也明确建议：对于设计时路径已知的 deterministic workflows，例如 approval、data transformation、batch processing，应使用状态机式 Workflow orchestration；Agent 更适合放在需要动态 reasoning 的节点。

因此一个很实用的架构是：

```text
Workflow Engine
      ↓
deterministic stages
      ↓
Agent Node
      ↓
dynamic reasoning
      ↓
deterministic policy / validation
      ↓
continue workflow
```

而不是：

```text
Agent
  ↓
“自己记住整个 BPMN”
```

---

# 三十二、对于 Agent Execution，本身不需要做成重型 BPMN

Agent Runtime 最常见的另一个极端是：

```text
为了支持 Agent
→ 上一个复杂 BPMN / Workflow Engine
→ 把每一个 LLM turn 都建成 Node
```

没有必要。

Agent Runtime 的状态机通常只需要稳定地解决：

```text
run lifecycle
pause/resume
approval
retry
timeout
cancellation
recovery
tool execution
checkpoint
concurrency
```

因此可以使用：

```text
Typed State + Transition Function
```

而不是：

```text
几百个 BPMN node
```

例如：

```typescript
type RunStatus =
  | "CREATED"
  | "QUEUED"
  | "RUNNING"
  | "WAITING_INPUT"
  | "WAITING_APPROVAL"
  | "WAITING_EXTERNAL"
  | "RETRY_WAIT"
  | "PAUSED"
  | "CANCELLING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "EXPIRED"
  | "RECOVERY_REQUIRED";
```

然后：

```typescript
function transition(
  state: RunState,
  event: RunEvent
): RunState {
  assertValidTransition(state.status, event);

  return applyEvent(state, event);
}
```

真正复杂的是：

```text
Policy
Tool execution
Durability
Recovery
```

而不是 FSM 代码本身。

---

# 三十三、一个可以直接落地的数据库模型

最小可行版本可以只有五张表。

### `agent_run`

```text
run_id
tenant_id
agent_id
status
version
current_step
waiting_reason
checkpoint_id
parent_run_id
created_at
updated_at
```

### `agent_run_event`

```text
event_id
run_id
sequence
event_type
payload
actor
created_at
```

### `agent_checkpoint`

```text
checkpoint_id
run_id
state_version
context_ref
tool_state_ref
workspace_ref
created_at
```

### `tool_execution`

```text
tool_call_id
run_id
tool_name
arguments_hash
idempotency_key
status
policy_decision_id
approval_id
external_reference
result_ref
created_at
updated_at
```

### `approval_request`

```text
approval_id
run_id
tool_call_id
action_hash
policy_version
requested_for
status
reviewer_id
expires_at
decision_at
```

这样已经足够支撑：

```text
pause
resume
retry
approval
audit
concurrency
recovery
```

不需要一开始就构建一个庞大的 Agent State Platform。

---

# 三十四、Run State 中不要保存所有东西

一个很大的误区是：

```text
把整个 Agent Context
+
所有 Tool Output
+
所有 Documents
+
所有 Memory
+
所有 Workspace
```

全部塞进：

```text
Run State JSON
```

这样很快会失控。

更合理的是：

```text
Run State
   ├── references
   ├── checkpoint metadata
   ├── current control state
   └── pending actions
```

大型对象进入：

```text
Object Store
Document Store
Database
Artifact Store
Workspace
```

例如：

```json
{
  "run_id": "run_123",
  "status": "WAITING_APPROVAL",
  "current_step": "SUBMIT_VOTE",
  "checkpoint": "cp_17",
  "tool_call_id": "call_93",
  "evidence_ref": "s3://.../evidence.json",
  "workspace_ref": "workspace_123"
}
```

而不是：

```json
{
  "run_state": {
    "entire_conversation": "...",
    "all_documents": "...",
    "all_tool_results": "..."
  }
}
```

AWS AgentCore 也明确区分 session context、filesystem state、Memory 与长期持久化数据。

---

# 三十五、状态机应该记录“事实”，而不是复制“解释”

例如：

```text
ToolExecutionSucceeded
```

应该记录：

```text
tool_call_id
timestamp
external_reference
result_ref
```

而不是：

```text
AgentReason:
“I think the trade probably succeeded because...”
```

同样：

```text
PolicyAllowed
```

应该记录：

```text
policy_id
policy_version
decision
subject
resource
action
```

而不是：

```text
LLM explanation:
“It seems safe.”
```

这会让 Agent Runtime 的审计从：

```text
模型说了什么
```

转变为：

```text
系统实际发生了什么
```

---

# 三十六、停止条件也应该是状态机的一部分

Agent 最容易出现的另一个问题是：

```text
一直循环
```

因此至少应该有：

```text
max_turns
max_runtime
max_tool_calls
max_cost
deadline
```

例如：

```text
RUNNING
  │
  ├── turn_count >= limit
  │       ↓
  │    FAILED / ESCALATE
  │
  ├── runtime >= deadline
  │       ↓
  │    EXPIRED
  │
  └── budget exhausted
          ↓
       PAUSED / FAILED
```

Anthropic 在其 Agent 设计建议中也明确提出停止条件，例如最大迭代次数等，以控制 Agent 的自主执行。

这类边界不应该由：

```text
“请不要无限循环”
```

解决。

应该由 Runtime enforcement 解决。

---

# 三十七、Cancellation 也不是简单 kill process

例如用户点击：

```text
Cancel
```

此时状态应该：

```text
RUNNING
→ CANCELLING
```

然后 Runtime：

```text
stop model call
cancel pending tasks
revoke / stop tool execution where possible
persist state
```

最后：

```text
CANCELED
```

但如果：

```text
Tool side effect already happened
```

就不能假装：

```text
CANCELED
```

意味着业务动作也没发生。

因此更准确的结果可能是：

```text
Run = CANCELED
Tool Execution = UNKNOWN
Business Case = RECONCILIATION_REQUIRED
```

这也是为什么不同 State Machine 必须独立。

---

# 三十八、Circuit Breaker 应该能够改变 State

对于生产 Agent：

```text
Agent 调用某个 Tool
```

如果连续：

```text
100 次失败
```

不能继续无限执行。

可以触发：

```text
CIRCUIT_OPEN
```

进而：

```text
RUNNING
→ PAUSED
```

甚至：

```text
Agent Type
→ QUARANTINED
```

AWS Agentic AI Lens 当前也把 behavioral anomaly detection、credential revocation、circuit breaker 和 state preservation 作为 Agent containment 的组成部分。

因此 State Machine 不只处理“正常业务流程”，还应该支持：

```text
Containment
Degradation
Recovery
```

---

# 三十九、建议定义一个清晰的 Agent Runtime Event Contract

例如：

```typescript
type AgentEvent =
  | {
      type: "RunStarted";
      runId: string;
    }
  | {
      type: "ToolProposalCreated";
      runId: string;
      toolCallId: string;
      toolName: string;
      argumentsHash: string;
    }
  | {
      type: "PolicyAllowed";
      runId: string;
      toolCallId: string;
      policyVersion: string;
    }
  | {
      type: "ApprovalRequested";
      runId: string;
      approvalId: string;
      actionHash: string;
    }
  | {
      type: "ApprovalGranted";
      runId: string;
      approvalId: string;
      reviewerId: string;
    }
  | {
      type: "ToolExecutionStarted";
      runId: string;
      toolCallId: string;
      idempotencyKey: string;
    }
  | {
      type: "ToolExecutionUnknown";
      runId: string;
      toolCallId: string;
    }
  | {
      type: "RunSucceeded";
      runId: string;
    };
```

这样：

```text
UI
Workflow
Audit
Monitoring
Recovery
```

都可以订阅同一套 Event。

---

# 四十、最终推荐的整体架构

把前面的设计组合起来，可以得到：

```text
                         ┌──────────────────────┐
                         │       User           │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │ Business Workflow    │
                         │ / Case State         │
                         └──────────┬───────────┘
                                    │
                              Start Agent Run
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────┐
│                 Agent Runtime Control Plane               │
│                                                            │
│  Run State Machine                                         │
│  Session / Lease                                           │
│  Policy                                                    │
│  Approval                                                  │
│  Retry / Timeout                                           │
│  Checkpoint                                                │
│  Recovery                                                  │
│  Audit                                                     │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   Agent Harness  │
                    │                  │
                    │ LLM              │
                    │ Skills           │
                    │ Planning         │
                    │ Tool Selection   │
                    │ Context          │
                    └────────┬─────────┘
                             │
                         Proposal
                             │
                             ▼
                    ┌──────────────────┐
                    │ Policy / Guard   │
                    └────────┬─────────┘
                             │
                      allow / approval
                             │
                             ▼
                    ┌──────────────────┐
                    │ Tool Execution   │
                    │ State Machine    │
                    └────────┬─────────┘
                             │
                             ▼
                   Enterprise Tool/API
                             │
                             ▼
                    Tool Result / Event
                             │
                             ▼
                    Agent Runtime State
```

这里最重要的是：

```text
Agent Harness
```

和：

```text
Agent Runtime
```

不要混在一起。

---

# 四十一、如果只记住六条原则

Agent Execution State Machine 最终可以浓缩成六条。

### 1. State Machine 管 Execution，不管 Reasoning

不要把：

```text
thinking / planning / reflecting
```

当成核心 durable state。

真正持久化：

```text
run
checkpoint
approval
tool execution
external wait
recovery
```

---

### 2. LLM 输出是 Proposal，不是 State Transition

正确：

```text
LLM
→ proposal
→ validation
→ policy
→ transition
```

错误：

```text
LLM
→ directly mutate run status
```

---

### 3. Business State、Agent Run State、Tool State 分离

```text
Business:
APPROVED

Agent:
WAITING_APPROVAL

Tool:
EXECUTING
```

三者可以同时成立。

---

### 4. WAITING 是正式状态

```text
WAITING_APPROVAL
WAITING_INPUT
WAITING_EXTERNAL
RETRY_WAIT
```

不能靠：

```text
sleep()
```

表达。

---

### 5. UNKNOWN 比 FAILED 更重要

特别是 side effect：

```text
timeout
≠
failure
```

必须允许：

```text
UNKNOWN
→ RECONCILIATION
```

---

### 6. Checkpoint + Idempotency 必须一起设计

```text
checkpoint
without idempotency
```

并不能保证安全恢复。

真正可靠的是：

```text
checkpoint
+
idempotent tools
+
execution ledger
+
reconciliation
```

AWS 当前 Agentic AI Lens 将 checkpoint、idempotency、staged recovery、error handling 和 lifecycle management 作为相互关联的生产能力，而不是独立技巧。

---

# 四十二、结论：Agent Execution 的状态机应该是“控制面”，而不是“Agent 思维的可视化”

Agent State Machine 的价值，不是把：

```text
LLM 在想什么
```

画成一张漂亮的流程图。

它真正要解决的是：

```text
Agent 现在是否还能继续？
如果不能，为什么？
谁可以让它继续？
恢复以后从哪里继续？
哪些动作已经执行？
哪些动作可能执行过但结果未知？
当前权限是否仍然有效？
如何防止重复副作用？
系统崩溃以后怎么恢复？
如何证明这个动作是谁允许的？
```

因此，一个成熟的 Agent Execution State Machine 应该围绕：

```text
State
+
Event
+
Checkpoint
+
Policy
+
Approval
+
Idempotency
+
Recovery
```

来设计，而不是围绕：

```text
Prompt
+
Thought
+
Tool Call
```

来设计。

最终最值得采用的结构是：

```text
Business Workflow State
          │
          ▼
     Agent Run FSM
          │
          ▼
    Dynamic Agent Loop
          │
          ▼
   Tool Proposal
          │
          ▼
 Policy / Authorization
          │
          ▼
 Tool Execution FSM
          │
          ▼
 External Side Effect
          │
          ▼
 Result / Event
          │
          ▼
 Checkpoint / Recovery
```

这套设计同时解释了为什么今天的主流 Agent 基础设施都在增加类似能力：LangGraph 强调 checkpoint + interrupt；OpenAI Agents SDK 提供可序列化 `RunState` 和 resume；AgentCore 提供 session lifecycle 与隔离执行环境；Anthropic 强调长运行 Agent 的 checkpoints、retry 和 durable execution；AWS 则进一步把 state management、idempotency、stage recovery、human approval 和 workflow orchestration 组织成完整的生产架构。

对金融服务尤其如此。

Agent 可以：

```text
reason
plan
propose
search
analyze
```

但：

```text
authorization
business state
approval
execution
audit
reconciliation
```

必须回到确定性的 Runtime / Policy / Workflow 控制面。

最终可以用一句话概括：

> **Agent 决定“下一步想做什么”，State Machine 决定“现在能不能做、做到了哪里、出了问题从哪里恢复”。**

这才是 Agent Execution State Machine 应该承担的职责。

---

# 参考资料

1. **Anthropic — Building effective agents**
   明确区分 workflows 与 agents，并讨论 prompt chaining、routing、orchestrator-workers 和动态 Agent loop。
   [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents?utm_source=chatgpt.com)

2. **Anthropic — How we built our multi-agent research system**
   真实生产 Agent 系统实践，重点讨论 long-running state、durable execution、checkpoint、retry 和恢复。
   [Anthropic — Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system?utm_source=chatgpt.com)

3. **Anthropic — Effective harnesses for long-running agents**
   讨论跨 context window 的长运行 Agent、阶段化工作和跨 session 恢复。
   [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents?utm_source=chatgpt.com)

4. **ReAct: Synergizing Reasoning and Acting in Language Models**
   经典 Agent Loop 研究，展示 reasoning 与 acting 交替进行的基本执行范式。
   [ReAct — arXiv](https://arxiv.org/abs/2210.03629?utm_source=chatgpt.com)

5. **AgentDojo — A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents**
   Tool-using agent 的可靠性与 prompt-injection 研究，覆盖电子邮件、e-banking 等场景。
   [AgentDojo — arXiv](https://arxiv.org/abs/2406.13352?utm_source=chatgpt.com)

6. **τ-bench — A Benchmark for Tool-Agent-User Interaction in Real-World Domains**
   评估 Agent 与用户、工具以及领域规则的交互可靠性，并通过最终数据库状态判断任务是否完成。
   [τ-bench — arXiv](https://arxiv.org/abs/2406.12045?utm_source=chatgpt.com)

7. **LangGraph — Interrupts**
   官方文档，说明 checkpoint、interrupt、thread ID、暂停和恢复语义。
   [LangGraph Interrupts](https://langchain-ai.github.io/langgraph/concepts/breakpoints/?utm_source=chatgpt.com)

8. **LangGraph — Thinking in LangGraph**
   讨论 graph node、控制流显式化、checkpoint boundary 和 node granularity。
   [Thinking in LangGraph](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph?utm_source=chatgpt.com)

9. **OpenAI Agents SDK — Human-in-the-loop**
   官方文档，说明 interruption、approval、RunState、长时间暂停和 server-side approval 的安全要求。
   [OpenAI Agents SDK — Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/?utm_source=chatgpt.com)

10. **OpenAI Agents SDK — RunState**
    官方 `RunState` 设计，用于序列化和恢复 Agent execution，包含 approval state、pending execution 等信息。
    [OpenAI Agents SDK — RunState](https://openai.github.io/openai-agents-python/ref/run_state/?utm_source=chatgpt.com)

11. **OpenAI Agents API — September 10, 2026**
    当前 Cloud Agent 基础设施，强调 long-running sessions、sandbox、state、recovery、context management 和 multi-agent execution。
    [OpenAI — Introducing the Agents API](https://openai.com/index/introducing-the-agents-api/?utm_source=chatgpt.com)

12. **OpenAI Agents SDK — The next evolution of the Agents SDK**
    讨论 harness、sandbox、snapshot、rehydration 和 long-running agent execution 的分离。
    [OpenAI — The next evolution of the Agents SDK](https://openai.com/index/the-next-evolution-of-the-agents-sdk/?utm_source=chatgpt.com)

13. **AWS Bedrock AgentCore — Use isolated sessions for agents**
    官方文档，介绍 session isolation、microVM、session lifecycle、ephemeral context 和 multi-step workflows。
    [AgentCore Runtime Sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html?utm_source=chatgpt.com)

14. **AWS Bedrock AgentCore — Runtime How It Works**
    介绍 Active / Idle / Terminated session 状态和 session 生命周期。
    [AgentCore Runtime How It Works](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html?utm_source=chatgpt.com)

15. **AWS Well-Architected Agentic AI Lens — Agent memory and state management**
    明确提出 state classification、checkpoint-based recovery、fault-tolerant memory 和 graceful degradation。
    [AWS Agentic AI Lens — Memory and State](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel03.html?utm_source=chatgpt.com)

16. **AWS Agentic AI Lens — Checkpoint-based recovery**
    明确讨论 checkpoint、idempotency、external calls、conditional writes、recovery 和 state persistence。
    [AWS — Checkpoint-based Recovery](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel03-bp03.html?utm_source=chatgpt.com)

17. **AWS Agentic AI Lens — Incremental recovery**
    讨论 workflow stage boundaries、persisted outputs、incremental recovery、redrive 和 output validation。
    [AWS — Incremental Recovery](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel07-bp01.html?utm_source=chatgpt.com)

18. **AWS Agentic AI Lens — Agent goal alignment and manipulation prevention**
    明确区分 deterministic enforcement、probabilistic controls 和 risk-tiered approval。
    [AWS — Agent Goal Alignment and Manipulation Prevention](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04.html?utm_source=chatgpt.com)

19. **AWS Agentic AI Lens — Human-in-the-loop for critical decisions**
    讨论 risk-tiered approval、timeout、escalation、reviewer identity、decision context 和 deterministic risk classification。
    [AWS — Human-in-the-loop for Critical Decisions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com)

20. **AWS Agentic AI Lens — Tiered human oversight**
    讨论 autonomous / notify / approve 三档监督以及 approval workflow 的结构化设计。
    [AWS — Tiered Human Oversight](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel02-bp05.html?utm_source=chatgpt.com)

21. **AWS Agentic AI Lens — Workflow orchestration security controls**
    明确区分 deterministic state-machine workflows 与 dynamic agent-delegated workflows。
    [AWS — Workflow Orchestration Security Controls](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec06-bp02.html?utm_source=chatgpt.com)

22. **AWS Step Functions — Standard vs Express Workflows**
    说明 durable execution、execution history、exactly-once / at-least-once 等工作流执行语义。
    [AWS Step Functions Workflow Types](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html?utm_source=chatgpt.com)

23. **AWS Step Functions — Error Handling**
    说明 Retry、Catch、Timeout 等明确的状态机错误处理机制。
    [AWS Step Functions Error Handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html?utm_source=chatgpt.com)

24. **AWS Step Functions — Callback with Task Token**
    说明如何暂停 workflow，等待人工审批、第三方系统或异步事件后继续。
    [AWS Step Functions Callback Pattern](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html?utm_source=chatgpt.com)

25. **FINRA — GenAI: Continuing and Emerging Trends, 2026**
    证券行业监管观察，涉及 Agent access、data handling、human oversight、actions/decisions 和 guardrails。
    [FINRA 2026 GenAI Report](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

26. **Financial Stability Board — Sound Practices for Responsible Adoption of AI, 2026**
    金融机构 AI governance 和 AI lifecycle 的最新 consultation report。
    [FSB — Sound Practices for Responsible AI Adoption](https://www.fsb.org/2026/06/sound-practices-for-responsible-adoption-of-artificial-intelligence-ai-consultation-report/?utm_source=chatgpt.com)

27. **Deutsche Bank — Putting agentic AI to work in third party risk management, 2026**
    真实金融机构案例：三个顺序 Agent、文档分析、建议结果以及最终人工决策。
    [Deutsche Bank — TPRM AI](https://gcp.prd.www.db.com/news/detail/20260513-putting-agentic-ai-to-work-in-third-party-risk-management?language_id=1&utm_source=chatgpt.com)

28. **Deutsche Bank — From tools to agents, 2026**
    讨论 Agent 从信息支持走向跨系统、多步骤执行，并以第三方风险管理作为金融服务案例。
    [Deutsche Bank — From tools to agents](https://www.db.com/news/detail/20260507-from-tools-to-agents-the-next-evolution-of-artificial-intelligence?language_id=1&utm_source=chatgpt.com)
