# Command Hash、Resource Version 与 TOCTOU 防护

## ——金融 Agent 在 Approval → Command → Execution 链上的一致性与安全控制

## 摘要

在金融 Agent 架构中，`Command Hash`、`Resource Version` 和 `TOCTOU（Time-of-Check to Time-of-Use）`经常同时出现，但它们解决的其实是三个不同层面的风险：

```text
Command Hash
    ↓
“批准的到底是不是这个 Command？”

Resource Version
    ↓
“执行时资源还是不是我检查时的那个版本？”

TOCTOU 防护
    ↓
“Check 与 Use 之间，状态有没有被改变？”
```

这三个问题如果没有明确区分，很容易设计出一种表面上很安全、实际上仍然存在漏洞的 Agent Workflow：

```text
Agent
  ↓
读取业务状态
  ↓
生成 Command
  ↓
Policy Check
  ↓
Human Approval
  ↓
等待
  ↓
Execute
```

看起来已经有：

```text
Authorization
Approval
Command
```

但实际上可能存在两个典型漏洞。

第一类是 **Command Drift**：

```text
Approval 时：

Transfer $100
Account A → B

                ↓

Execution 时：

Transfer $100,000
Account A → B
```

如果 Approval 只绑定：

```text
commandId
```

却没有绑定 Command 的具体内容，批准的对象和执行的对象可能已经不是同一个。

第二类是 **Resource Drift**：

```text
10:00
Agent 读取：

Account A
availableLimit = 1,000,000

                ↓
         Approval

                ↓

10:05
其他系统修改：

availableLimit = 100,000

                ↓

10:06
Agent 执行原 Command
```

即使 Command 本身完全没有被修改，执行时使用的业务前提已经发生变化。

因此需要两个不同的完整性约束：

```text
Approved Command
    └── commandHash
          ↓
保证“动作没变”

Resource
    └── resourceVersion
          ↓
保证“依据的状态没变”
```

再进一步，还需要把 Check 和 Use 放在同一个原子条件中：

```text
Check
+
Use
+
Version Validation
```

而不能：

```text
Check
    ↓
等待
    ↓
Use
```

OWASP 将这类问题明确归入 Race Condition / TOCTOU：当系统先读取共享状态、作出判断，然后才执行写操作时，并发主体可能在检查与使用之间改变状态。OWASP 的 Business Logic Security Cheat Sheet 进一步强调，对“check then act”型敏感操作，应尽量把检查和动作放在单一原子操作中。

RFC 9110 则定义了通用的 HTTP 条件请求模型：`If-Match` 可以把资源当前版本作为更新前提，避免并发客户端之间的 lost update；如果条件不满足，服务器应拒绝该状态改变请求。

Kubernetes 的 `resourceVersion` 是一个非常典型的工程实践：客户端提交更新时带上读取到的 `resourceVersion`，API Server 如果发现版本已经过期，就返回 `409 Conflict`，而不是默默覆盖新的状态。

因此，对金融 Agent 来说，一个更完整的执行链应该是：

```text
Agent Proposal
      ↓
Canonical Command
      ↓
Command Hash
      ↓
Policy / Authorization
      ↓
Human Approval
      ↓
Approved Command Snapshot
      ↓
Load Current Resource
      ↓
Verify Resource Version
      ↓
Atomic Check-and-Use
      ↓
Execute
```

核心原则可以概括为：

> **Command Hash 防止“批准的动作被替换”，Resource Version 防止“批准所依据的资源状态过期”，而 TOCTOU 防护要求最终的状态检查和业务使用必须在同一个不可被插入竞争窗口的原子边界内完成。**

---

# 1. 为什么 Agent 特别容易产生 TOCTOU

TOCTOU 并不是 Agent 独有的问题。

传统 Web 应用、操作系统、数据库和分布式系统长期都在处理：

```text
Check
    ↓
Use
```

之间的竞争窗口。

例如最经典的：

```text
if (balance >= amount) {
    debit(amount);
}
```

如果两个请求同时运行：

```text
Request A:
read balance = 100
check >= 100 → true

Request B:
read balance = 100
check >= 100 → true

A debit 100
B debit 100
```

结果：

```text
balance = -100
```

或者：

```text
两个订单都通过库存检查
```

最终：

```text
库存被超卖
```

OWASP 对这类 race condition 的描述正是：“读取一个值、做决定、再写回”的操作在并发环境中存在竞争窗口；其示例包括余额扣款、优惠券使用次数、库存和唯一性检查。

Agent 只是把这个问题进一步放大，因为 Agent Workflow 天然增加了：

```text
LLM reasoning
Tool Call
Workflow scheduling
Queue
Retry
Human Approval
Checkpoint
Resume
External API
```

于是原本：

```text
milliseconds
```

级别的 TOCTOU window，可能变成：

```text
seconds
minutes
hours
```

例如：

```text
Read resource
     ↓
LLM reasoning
     ↓
Policy evaluation
     ↓
Human approval
     ↓
Queue
     ↓
Worker
     ↓
Execute
```

这个时间窗口足够长，资源状态几乎一定可能发生变化。

---

# 2. 金融 Agent 中最危险的不是“Command 被修改”，而是“Command 和现实世界脱节”

在普通 CRUD 应用中，TOCTOU 常常表现为：

```text
A 读取
B 修改
A 覆盖 B
```

Agent Workflow 中会出现两种独立的问题：

```text
问题 A：
Command 本身变了

问题 B：
Command 没变，
但 Command 所依据的资源状态变了
```

可以分别称为：

```text
Command Integrity
```

和：

```text
Resource Freshness
```

例如：

### Command Integrity

批准：

```text
Buy 10,000 shares of XYZ
```

执行：

```text
Buy 100,000 shares of XYZ
```

这是：

```text
Command Drift
```

---

### Resource Freshness

批准时：

```text
Risk Limit = $10m
```

执行时：

```text
Risk Limit = $5m
```

Command：

```text
Buy $8m
```

根本没有变。

但它已经不应该继续执行。

这是：

```text
Resource Version Drift
```

所以：

> **只做 Command Hash，不足以防止 TOCTOU。**

同样：

> **只做 Resource Version，也不足以证明审批对象没有改变。**

需要两者同时存在。

---

# 3. Command Hash 到底解决什么

`Command Hash` 的核心作用是：

> **证明当前执行的 Command 与之前批准、授权或冻结的 Command 内容完全一致。**

例如：

```json
{
  "type": "SubmitProxyVote",
  "accountId": "A123",
  "meetingId": "M456",
  "proposalId": "P7",
  "vote": "FOR"
}
```

经过 canonicalization 后：

```text
canonicalCommand
        ↓
SHA-256
        ↓
H
```

形成：

```text
commandHash = H
```

Approval：

```text
ApprovedCommandHash = H
```

Execution：

```text
hash(currentCommand) == ApprovedCommandHash
```

才允许继续。

这样可以防止：

```text
Approval:
amount = 1,000

Execution:
amount = 100,000
```

即使：

```text
commandId
```

仍然相同，也无法通过 Hash 验证。

---

# 4. 为什么 Command ID 本身不够

一个常见设计是：

```text
commandId = UUID
```

然后 Approval：

```text
approve(commandId)
```

这个设计存在一个隐藏假设：

> `commandId` 永远对应同一个不可变 Command。

如果 Command Store 可以被更新：

```text
CMD-123
    ↓
payload changed
```

那么：

```text
Approval:
CMD-123

Execution:
CMD-123
```

形式上完全一样。

但实际上：

```text
approved command ≠ executed command
```

因此应该把：

```text
commandId
```

理解为：

> “这是哪个 Command 对象？”

而：

```text
commandHash
```

理解为：

> “这个 Command 对象当时具体包含什么？”

两者结合：

```text
commandId
+
commandHash
```

才真正建立：

```text
identity
+
content integrity
```

---

# 5. Command Hash 为什么必须 Canonicalize

直接：

```typescript
sha256(JSON.stringify(command))
```

通常是不够严谨的。

例如两个 JSON：

```json
{
  "amount": 100,
  "currency": "USD"
}
```

和：

```json
{
  "currency": "USD",
  "amount": 100
}
```

语义上可能相同，但普通字符串序列化未必产生相同结果。

因此需要：

```text
Semantic Command
        ↓
Canonicalization
        ↓
Canonical Bytes
        ↓
Cryptographic Hash
```

RFC 8785（JSON Canonicalization Scheme）正是为这种场景定义的：需要 Hash 或签名时，应首先把数据转换成稳定、确定性的 canonical representation，使不同端对同一 JSON 数据得到一致的密码学输入。

因此企业 Command Hash 至少应该规定：

```text
serialization format
field ordering
number representation
null handling
default values
Unicode handling
timestamp format
decimal representation
enum normalization
```

而不是让不同服务各自：

```text
JSON.stringify(...)
```

然后声称它们的 Hash 一定相同。

---

# 6. 金融系统尤其要注意 Decimal / Currency 的 canonicalization

例如：

```text
100
100.0
100.00
```

在某些语言运行时中可能表示：

```text
different serialized values
```

但业务意义可能相同。

反过来：

```text
1.00 USD
```

与：

```text
1.00 JPY
```

显然不能视为相同。

因此金融 Command 的 canonicalization 不应该只是技术层面的 JSON 排序，而应该定义业务语义：

```text
amount:
    canonical decimal representation

currency:
    ISO currency code

timestamp:
    UTC + defined precision

quantity:
    canonical decimal

enum:
    canonical uppercase symbolic value
```

这也是为什么：

> **Command Hash 应该建立在 Canonical Business Command 上，而不是直接建立在 LLM 输出 JSON 上。**

---

# 7. LLM Output 不应该直接 Hash

错误：

```text
LLM response
    ↓
SHA-256
    ↓
approvedHash
```

因为 LLM Response 可能包含：

```text
reasoning
explanation
formatting
uncertain text
tool chatter
```

而这些不是最终业务动作。

应该：

```text
LLM Output
    ↓
Proposal
    ↓
Schema Validation
    ↓
Business Normalization
    ↓
Canonical Command
    ↓
Hash
```

因此：

```text
LLM Output
```

是：

```text
untrusted input
```

而：

```text
Canonical Command
```

才是：

```text
controlled business object
```

AWS Agentic AI Lens 当前明确强调：不能让 Agent 自己承担工具授权边界，授权应在模型之外通过确定性的机制执行；模型生成的参数本身也应经过 schema 和 policy validation。

---

# 8. Command Hash 不是 Authorization

这是非常重要的边界。

Hash 可以证明：

```text
“现在执行的 Command 和批准时一样。”
```

但不能证明：

```text
“这个 Command 本来就有权限。”
```

例如攻击者生成：

```text
Refund $100,000
```

系统正确计算：

```text
hash = ABC
```

然后执行前验证：

```text
currentHash == approvedHash
```

结果：

```text
true
```

但：

```text
approvedHash
```

根本不应该存在，因为：

```text
user had no authorization
```

因此：

```text
Authentication
    ↓
Authorization
    ↓
Policy
    ↓
Approval
    ↓
Command Hash
```

是不同层次。

Hash 是：

```text
Integrity Binding
```

不是：

```text
Authorization
```

---

# 9. Hash 也不是不可伪造的安全证明

另一个常见误区：

```text
commandHash
```

看起来是一个：

```text
SHA-256
```

于是认为：

> “Command 已经被保护了。”

不一定。

如果攻击者能够同时修改：

```text
command
```

和：

```text
commandHash
```

那么：

```text
newCommand
+
newHash
```

仍然可以保持一致。

因此真正需要保护的是：

```text
Command
+
Approved Hash
+
Approval Record
```

的可信存储和写入权限。

在跨信任边界传递审批凭证时，则应进一步考虑：

```text
HMAC
Digital Signature
Signed Approval Token
```

而不是单独依赖裸 Hash。

RFC 7515 定义了 JWS，通过数字签名或 MAC 为内容提供密码学完整性和来源认证；RFC 8785 也明确区分 canonicalization 与后续的签名验证。

因此：

```text
Hash
```

适合：

```text
same-content detection
integrity comparison
audit correlation
```

而：

```text
Signature / MAC
```

适合更强的：

```text
authenticity
tamper evidence across trust boundaries
```

---

# 10. Resource Version 到底解决什么

`Resource Version` 解决的是另外一个问题：

> **Command 所依据的资源状态，在执行时还是不是原来的状态？**

例如：

```text
Account A
version = 17
```

Agent 读取：

```text
balance = 1,000,000
version = 17
```

于是 Command：

```json
{
  "accountId": "A",
  "amount": 800000,
  "expectedVersion": 17
}
```

执行时：

```sql
UPDATE account
SET balance = balance - 800000,
    version = version + 1
WHERE account_id = 'A'
  AND version = 17;
```

如果：

```text
affected rows = 1
```

说明：

```text
Check
+
Use
```

在同一个原子操作中成立。

如果：

```text
affected rows = 0
```

说明：

```text
resource changed
```

必须：

```text
abort
```

或者：

```text
re-read
re-evaluate
re-approve
```

不能直接继续。

AWS DynamoDB 官方把这个模式称为 optimistic locking：资源包含一个 version attribute，每次更新递增；更新时携带读取时的版本，条件不满足则写入失败。AWS 明确将这种模式用于多个主体并发更新同一资源的场景，包括 financial transaction records。

---

# 11. Resource Version 本质上是 Optimistic Concurrency Control

其核心不是：

```text
lock
```

而是：

```text
“I am willing to execute this operation only if the resource is still the version I observed.”
```

即：

```text
read version = 17

...

write WHERE version = 17
```

这就是：

```text
Compare-And-Swap
```

或者：

```text
Optimistic Concurrency Control
```

它不阻止别人修改资源。

它只保证：

> **如果资源已经被别人修改，我不会静默覆盖新的状态。**

Kubernetes 的 `resourceVersion` 是非常成熟的实际案例：客户端更新资源时提供读取到的 `resourceVersion`；如果版本已过期，API Server 返回 `409 Conflict`，客户端再处理冲突。

---

# 12. HTTP 的 ETag / If-Match 其实就是同一个思想

HTTP 已经标准化了这种模式。

服务器返回：

```http
ETag: "abc123"
```

客户端修改时：

```http
If-Match: "abc123"
```

服务器在执行修改之前检查：

```text
current ETag == "abc123" ?
```

如果不相等：

```text
412 Precondition Failed
```

RFC 9110 明确说明 `If-Match` 可以用于状态修改操作，避免并发客户端之间出现 lost update；服务器必须在执行状态改变之前评估该前置条件。

因此：

```text
Resource Version
ETag
If-Match
Optimistic Lock Version
Compare-And-Swap
Kubernetes resourceVersion
```

虽然 API 名称不同，但核心思想高度一致：

```text
expectedState
+
atomic validation
+
state-changing operation
```

---

# 13. 为什么 Resource Version 不是“资源 Hash”

看起来可以：

```text
resourceHash = SHA-256(resource)
```

然后：

```text
execute only if hash unchanged
```

这有时可以工作，但通常不如：

```text
version / ETag
```

直接。

原因包括：

### 性能

每次更新前不需要重新 hash 整个资源。

### 语义

Version 明确表达：

```text
“这是我观察到的版本。”
```

而 Hash 更像：

```text
“这些字段当前序列化后是这个内容。”
```

### 并发控制

Version 很容易：

```sql
WHERE version = ?
```

原子执行。

### 外部 API 兼容

HTTP `ETag / If-Match` 已经提供类似标准语义。

但是：

> **Resource Version 不是一定要用整数版本号。**

也可以是：

```text
ETag
rowVersion
opaque revision token
change sequence
MVCC token
```

重要的是它必须是：

```text
opaque
stable
server-controlled
checked atomically
```

---

# 14. Version 必须由可信系统生成

不要：

```json
{
  "resourceVersion": "17"
}
```

然后让：

```text
LLM
```

自己生成：

```text
18
```

也不要让 Agent：

```text
“我判断这个资源还是 version 17”
```

Version 应该来自：

```text
database
resource server
domain service
external API
```

例如：

```text
GET /accounts/A123

{
  ...
  "version": 17
}
```

Agent 只能：

```text
carry forward version = 17
```

最终执行时由 authoritative system 判断：

```text
currentVersion == 17
```

---

# 15. Command Hash 与 Resource Version 的分工

这两个概念可以放在一张表里理解：

| 控制               | 防止什么          | 示例           |
| ---------------- | ------------- | ------------ |
| Command ID       | 找到哪个 Command  | CMD-123      |
| Command Hash     | Command 内容被替换 | hash = ABC   |
| Resource ID      | 指向哪个业务资源      | Account A123 |
| Resource Version | 资源状态已经变化      | version = 17 |
| Idempotency Key  | 同一操作重复执行      | OP-123       |
| Approval ID      | 哪个审批决定        | AP-456       |
| Policy Version   | 使用哪个业务规则      | POLICY-v8    |

因此：

```text
Command Hash
    ≠
Resource Version
```

一个回答：

```text
What was approved?
```

另一个回答：

```text
What state was approved against?
```

---

# 16. 最重要的组合：Approved Command + Expected Resource Version

一个金融 Command 可以定义成：

```typescript
interface SubmitTradeCommand {
  commandId: string;

  operationId: string;

  accountId: string;
  instrumentId: string;

  side: "BUY" | "SELL";
  quantity: string;
  limitPrice?: string;

  expectedResourceVersion: string;

  commandHash: string;
}
```

审批时：

```text
commandHash = H1
expectedResourceVersion = 17
```

于是审批实际表达的是：

> “我批准 **这个具体交易动作**，并且它是在 **资源版本 17** 的前提下被审查的。”

而不是模糊地：

> “我批准这个 Agent 操作。”

这会大幅提高审批的精确性。

AWS Agentic AI Lens 当前建议高风险 Agent 操作的批准范围应绑定到特定 command、parameter shape 或 resource，并要求审批记录包含 reviewer identity 和 timestamp。

---

# 17. 但 Approval 时读取 Version 还不够

这是最关键的 TOCTOU 问题。

流程：

```text
10:00
read resource version = 17

10:01
approve

10:05
execute
```

即使：

```text
approvedExpectedVersion = 17
```

也不能说明：

```text
currentVersion = 17
```

因为：

```text
10:02
another system updates resource

version = 18
```

因此 Execution 必须重新检查：

```text
currentVersion == approvedExpectedVersion
```

而且必须：

```text
在实际业务修改的同一个原子操作中检查
```

这就是：

```text
TOCTOU 防护
```

---

# 18. 错误实现：先读再写

例如：

```typescript
const resource =
  await repository.get(accountId);

if (
  resource.version !== command.expectedVersion
) {
  throw new StaleCommandError();
}

await paymentService.execute(command);
```

这里仍然有 TOCTOU：

```text
T1:
read version = 17

T2:
check passed

T3:
another system updates version = 18

T4:
paymentService.execute(command)
```

你的检查完全正确。

但它发生在：

```text
Use
```

之前。

所以：

> **“check passed”并不代表“use 时仍然成立”。**

---

# 19. 正确实现：Check-and-Use 必须原子化

对于内部数据库资源：

```sql
UPDATE account
SET balance = balance - :amount,
    version = version + 1
WHERE account_id = :accountId
  AND version = :expectedVersion
  AND status = 'ACTIVE'
  AND balance >= :amount;
```

这个 SQL 同时完成：

```text
resource version check
+
business precondition
+
state mutation
```

如果：

```text
affected rows = 1
```

说明：

```text
check passed
AND
use succeeded
```

如果：

```text
affected rows = 0
```

说明：

```text
至少一个前置条件已经不再成立
```

然后：

```text
reject / re-evaluate
```

而不是：

```text
继续执行
```

OWASP 对“check then act”型操作的建议正是把 check 与 act 放进单一原子操作，以消除竞争窗口。

---

# 20. PostgreSQL 中的推荐实现

假设：

```sql
CREATE TABLE account (
    account_id UUID PRIMARY KEY,
    balance NUMERIC(20, 2) NOT NULL,
    status TEXT NOT NULL,
    version BIGINT NOT NULL
);
```

执行：

```sql
UPDATE account
SET
    balance = balance - $1,
    version = version + 1
WHERE
    account_id = $2
    AND version = $3
    AND status = 'ACTIVE'
    AND balance >= $1;
```

代码：

```typescript
const result = await db.query(
  `
  UPDATE account
  SET
      balance = balance - $1,
      version = version + 1
  WHERE
      account_id = $2
      AND version = $3
      AND status = 'ACTIVE'
      AND balance >= $1
  `,
  [
    amount,
    accountId,
    expectedVersion,
  ],
);

if (result.rowCount !== 1) {
  throw new StaleResourceError();
}
```

这比：

```typescript
const account = await getAccount();

if (account.balance >= amount) {
  await debit(account);
}
```

安全很多。

---

# 21. `SELECT FOR UPDATE` 也可以解决一类问题，但语义不同

PostgreSQL 的：

```sql
SELECT ...
FOR UPDATE
```

可以在 transaction 中对读取到的行加锁，使其他事务对这些行的更新/删除受到阻塞。

例如：

```sql
BEGIN;

SELECT *
FROM account
WHERE account_id = $1
FOR UPDATE;

-- validate

UPDATE account
SET balance = balance - $2
WHERE account_id = $1;

COMMIT;
```

这个模式适用于：

```text
短事务
+
同一数据库
+
需要锁定当前资源
```

但它并不意味着：

```text
Agent Workflow
```

可以拿着：

```text
database row lock
```

等待：

```text
human approval
```

或者：

```text
external payment API
```

几个小时。

因此：

```text
SELECT FOR UPDATE
```

解决的是：

```text
短事务内的并发控制
```

而：

```text
Resource Version
```

更适合：

```text
long-lived command
```

提前读取：

```text
version
```

然后在真正写入时进行 CAS。

---

# 22. 长流程更适合 Optimistic Concurrency

Agent Workflow 通常：

```text
read
    ↓
reason
    ↓
approval
    ↓
wait
    ↓
execute
```

如果一直持有悲观锁：

```text
read
    ↓
LOCK
    ↓
wait 2 hours
    ↓
execute
    ↓
UNLOCK
```

显然不合理。

更好的方式：

```text
read:
version=17

wait

execute:
WHERE version=17
```

如果：

```text
version=18
```

就：

```text
CONFLICT
```

这正是 Optimistic Concurrency Control 的典型使用方式。AWS DynamoDB 官方也将 version attribute + conditional write 定义为 optimistic locking，并明确指出它适合冲突相对少、retry 成本较低的场景。

---

# 23. Resource Version Conflict 不应该自动等于 Retry

这是 Agent 场景非常重要的一点。

例如：

```text
Command:
Buy 10,000 XYZ
expectedVersion=17
```

执行：

```text
version=18
```

意味着：

```text
resource changed
```

不能简单：

```text
retry same command
```

因为：

```text
new state
```

可能改变了：

```text
risk
limit
position
eligibility
price
restriction
authority
```

正确处理通常是：

```text
VERSION_CONFLICT
      ↓
reload resource
      ↓
re-evaluate policy / business rules
      ↓
possibly create new command
      ↓
possibly require re-approval
```

因此：

> **乐观锁冲突不是“网络错误”，而是一个业务事实：你批准的前提已经不成立。**

---

# 24. Hash Match + Version Match 才形成完整的 Approval Binding

执行前：

```text
check 1:
hash(currentCommand)
==
approvedCommandHash

check 2:
resource.version
==
approvedResourceVersion
```

如果两个都成立：

```text
Command Integrity = valid
Resource Freshness = valid
```

然后：

```text
atomic mutation
```

才可以继续。

可以形式化成：

```text
Executable
=
ApprovedCommandHashMatches
AND
ResourceVersionMatches
AND
AuthorizationStillValid
AND
PreconditionsHold
AND
IdempotencyAllowsExecution
```

注意：

```text
Hash + Version
```

仍然不是全部。

还可能需要：

```text
Policy Version
Entitlement Version
Approval Expiry
Limit Version
External State
```

---

# 25. Policy Version 也可能成为 TOCTOU 问题

例如：

```text
10:00
Policy v7:
trade <= $10m → auto-approved
```

Agent 创建：

```text
Trade = $8m
PolicyVersion = 7
```

审批后：

```text
10:05
Policy v8:
trade <= $5m → auto-approved
```

如果 Executor 只检查：

```text
commandHash
resourceVersion
```

仍然可能执行：

```text
$8m
```

但当前 policy 已变化。

所以对于关键金融操作，必要时还需要：

```text
policyVersion
```

或者：

```text
policyDecisionId
```

作为 Approval Snapshot 的一部分。

---

# 26. Entitlement 也可能发生 TOCTOU

例如：

```text
10:00
User:
Can trade Account A

10:02
Entitlement revoked

10:05
Execute
```

如果：

```text
Authorization
```

只在 Approval 时判断一次：

```text
ALLOW
```

然后一直沿用：

```text
ALLOW
```

就可能执行越权操作。

因此：

```text
Authorization at approval
```

和：

```text
Authorization at execution
```

需要根据业务风险决定是否都要检查。

对于高风险金融 Command，更合理的是：

```text
approval-time authorization
+
execution-time authorization
```

而不是把 Approval 变成：

```text
永久授权 token
```

AWS 当前 Agentic AI Lens 强调：Agent 权限需要外部、确定性的授权控制，并建议将高风险批准绑定到具体 command、parameter shape 或 resource，而不是给予未来同类操作的泛化信任。

---

# 27. 因此一个金融 Approval Snapshot 不应该只有 Hash

建议：

```typescript
interface ApprovalSnapshot {
  approvalId: string;

  commandId: string;
  commandHash: string;

  actor: {
    userId: string;
    agentId: string;
  };

  policyId: string;
  policyVersion: string;

  resourceSnapshots: Array<{
    resourceType: string;
    resourceId: string;
    resourceVersion: string;
  }>;

  approvedAt: string;
  expiresAt?: string;

  approverId: string;
}
```

这样可以重建：

```text
审批人看到了什么 Command
+
Command 针对什么 Resource
+
当时 Resource 是什么 Version
+
当时依据什么 Policy
+
谁批准
+
什么时候批准
```

---

# 28. 但不要把所有资源完整 Snapshot 都塞入 Approval

一种过度设计是：

```text
Approval
    ↓
复制整个 Account
复制整个 Portfolio
复制整个 Client Profile
复制整个 Policy
```

这样会导致：

```text
large payload
privacy duplication
stale copies
storage complexity
```

通常更合理：

```text
resourceId
+
resourceVersion
+
必要的 decision evidence
```

例如：

```json
{
  "resourceId": "A123",
  "resourceVersion": "17"
}
```

执行时：

```text
resourceId = A123
currentVersion = 17 ?
```

如果需要长期审计，再根据 retention / evidence 要求保存必要的业务快照。

---

# 29. Resource Version 不一定能够覆盖所有业务语义

这是实现时非常容易犯的错误：

```text
Version = 18
```

于是认为：

> “资源的一切相关条件都没变。”

并不一定。

例如一个 Trade Command 依赖：

```text
Account
Instrument
Market Status
Risk Limit
Restricted List
FX Rate
Client Mandate
```

你只有：

```text
Account.version
```

并不能证明：

```text
Instrument
Risk Limit
Restricted List
```

没有发生变化。

因此需要明确：

> **Resource Version 的覆盖范围必须与 Command 的 Preconditions 相匹配。**

---

# 30. 有时需要多个 Resource Version

例如：

```typescript
interface ResourceSnapshot {
  accountVersion: string;
  instrumentVersion: string;
  mandateVersion: string;
  riskPolicyVersion: string;
}
```

Command：

```text
expected:
account=17
instrument=203
mandate=42
riskPolicy=8
```

执行时：

```text
all expected versions match
```

才执行。

这种方式适合：

```text
multi-resource business invariant
```

但随着依赖资源数量增加：

```text
complexity ↑
conflict rate ↑
```

所以不能机械地为所有读取对象都加 Version。

应该找出真正决定：

```text
“这个 Command 是否仍然有效”
```

的 authoritative Preconditions。

---

# 31. 一个更好的抽象：Precondition Set

与其把整个资源世界都版本化，不如为 Command 建立：

```typescript
interface CommandPreconditions {
  resources: Array<{
    id: string;
    version: string;
  }>;

  policyVersion?: string;

  entitlementVersion?: string;

  expiresAt?: string;
}
```

例如：

```json
{
  "resources": [
    {
      "id": "ACCOUNT:A123",
      "version": "17"
    },
    {
      "id": "MANDATE:C88",
      "version": "42"
    }
  ],
  "policyVersion": "TRADE-8"
}
```

于是：

```text
Approved Command
```

实际上包含一个：

```text
Precondition Snapshot
```

而不是一个单独：

```text
version
```

---

# 32. 这和 HTTP If-Match 的思想高度一致

HTTP 中：

```http
If-Match: "abc123"
```

表达：

> “只有目标资源仍然是这个 representation 时，才执行状态变更。”

RFC 9110 明确把这种机制用于防止 lost update。

金融 Command 可以扩展为：

```text
If-Match:
Account-Version=17
Mandate-Version=42
Policy-Version=8
```

当然实际 API 不一定直接使用 HTTP Header，也可以：

```json
{
  "preconditions": {
    "accountVersion": "17",
    "mandateVersion": "42",
    "policyVersion": "8"
  }
}
```

核心语义是一致的：

```text
Expected State
+
Conditional Mutation
```

---

# 33. TOCTOU 的真正防护点不是“多检查一次”

有一种常见错误：

```text
Approval Check
   ↓
Execution Check
   ↓
Execute
```

有人会认为：

> “已经 check 两遍了，应该没问题。”

仍然可能：

```text
T1:
Execution Check:
version=17

T2:
Other process:
version=18

T3:
Execute
```

因此关键不是：

```text
check count
```

而是：

```text
check-to-use gap
```

是否仍然存在。

正确目标：

```text
Check
+
Use
```

形成：

```text
single atomic state transition
```

---

# 34. 一个非常重要的设计原则：Check and Use Must Share the Same Authority

如果：

```text
Check:
Authorization Service

Use:
Business DB
```

两个系统之间存在：

```text
network
```

那么：

```text
Authorization = ALLOW
```

之后：

```text
Resource
```

仍然可能变化。

因此最好：

```text
Business Authorization
+
Resource Preconditions
+
Mutation
```

最终在：

```text
trusted business execution boundary
```

被重新确认。

AWS Agentic AI Lens 对 Tool Authorization 的指导也强调，授权必须在 Agent 之外、在实际 Tool 执行之前由确定性机制执行，而不是依赖模型自己的判断。

---

# 35. Command Hash 是“what”，Resource Version 是“against what state”

一个非常好用的理解方式：

```text
Command Hash
    ↓
What are we doing?

Resource Version
    ↓
Against which resource state are we doing it?
```

例如：

```text
Command:
Sell 100,000 XYZ

Hash:
H123

Resource:
Account A123

Version:
17
```

完整含义：

> 在 Account A123 的 Version 17 状态下，批准并准备执行“卖出 100,000 股 XYZ”这个具体动作。

如果：

```text
Hash changed
```

表示：

```text
动作变了
```

如果：

```text
Version changed
```

表示：

```text
执行条件变了
```

如果：

```text
both unchanged
```

还需要：

```text
atomic precondition check
```

才真正安全。

---

# 36. Command Hash 不能防止 Replay

假设：

```text
Approved Command:
Transfer $100
Hash = H123
```

攻击者重放：

```text
same Command
same Hash
```

Hash 完全正常。

但业务可能已经：

```text
executed once
```

因此还需要：

```text
Idempotency Key
```

来区分：

```text
same approved command
```

和：

```text
new execution attempt
```

因此：

```text
Command Hash
+
Idempotency Key
```

分别解决：

```text
Hash:
内容完整性

Idempotency:
重复执行
```

---

# 37. Command Hash 不能防止 Resource Drift

同样：

```text
same Command
same Hash
```

但：

```text
Account Version:
17 → 18
```

Hash 仍然相同。

所以：

```text
Hash Match
```

不能代表：

```text
Safe to Execute
```

最终判定必须：

```text
Hash Match
AND
Version Match
AND
Policy Valid
AND
Authorization Valid
AND
Preconditions Valid
```

---

# 38. Resource Version 也不能防止 Command Drift

反过来：

```text
Resource Version:
17 → still 17
```

但：

```text
Command:
$100 → $100,000
```

Resource Version 没变化。

因此：

```text
Version Match
```

也不能证明：

```text
Approved Command == Executed Command
```

所以：

```text
Command Hash
+
Resource Version
```

是互补而非替代。

---

# 39. 一个完整的金融 TOCTOU 示例：Trade

考虑：

```text
用户：
买入 100,000 股 XYZ
```

Agent：

```text
1. 查询账户
2. 查询持仓
3. 查询风险限额
4. 分析市场
5. 生成 Trade Command
```

得到：

```json
{
  "account": "A123",
  "instrument": "XYZ",
  "side": "BUY",
  "quantity": "100000",
  "limitPrice": "100",
  "accountVersion": "17",
  "riskPolicyVersion": "8"
}
```

生成：

```text
commandHash = H1
```

然后：

```text
Policy → ALLOW
Approval → APPROVED
```

等待 20 分钟。

期间：

```text
AccountVersion = 18
```

或者：

```text
RiskPolicyVersion = 9
```

如果 Executor 只验证：

```text
commandHash == H1
```

仍然存在问题。

正确：

```text
hash(currentCommand) == H1
AND
account.version == 17
AND
riskPolicy.version == 8
```

否则：

```text
STALE_COMMAND
```

重新评估。

---

# 40. Proxy Voting 是另一个非常典型的 TOCTOU 场景

假设 Agent 研究：

```text
Meeting M100
Proposal P4
Vote FOR
```

创建：

```text
SubmitProxyVoteCommand
```

审批时：

```text
meetingVersion = 12
```

但等待期间：

```text
issuer updates proposal
```

或者：

```text
meeting details change
```

变成：

```text
meetingVersion = 13
```

如果系统继续：

```text
submit FOR
```

它可能是在：

```text
old evidence
```

上执行：

```text
new business state
```

这就是 TOCTOU。

因此至少需要：

```text
meetingVersion
```

或供应商提供的：

```text
ballotVersion / instructionVersion / ETag
```

在提交时进行条件验证。

如果外部投票系统不支持这种条件检查，则必须由内部 Adapter / Reconciliation 层建立更明确的安全策略，而不能把：

```text
old meeting data
```

当成：

```text
execution-time truth
```

---

# 41. 客户资料修改也存在相同问题

例如 Agent：

```text
“把客户邮箱改成 x@example.com。”
```

读取：

```text
Customer C123
version = 42
```

生成：

```text
UpdateCustomerEmailCommand
expectedVersion = 42
```

Approval：

```text
approved
```

等待。

期间：

```text
Customer version = 43
```

可能另一个操作已经修改了：

```text
phone
```

这时是否必须阻止 Email 修改？

取决于业务的数据模型。

如果：

```text
version
```

覆盖整个 Customer aggregate，那么：

```text
version mismatch
```

可以安全拒绝，重新读取再提交。

但如果：

```text
email
phone
address
```

本来可以独立并发修改，过于粗粒度的 version 会产生：

```text
false conflict
```

因此：

> **Resource Version 的粒度应该与业务并发模型一致。**

---

# 42. 粗粒度 Version 与细粒度 Version 的权衡

### 粗粒度

```text
Customer.version
```

优点：

```text
简单
一致
容易实现
```

缺点：

```text
false conflict
```

例如修改：

```text
phone
```

也会让：

```text
email command
```

失效。

### 细粒度

```text
Customer.Contact.version
Customer.Billing.version
Customer.Risk.version
```

优点：

```text
更高并发
更少 false conflicts
```

缺点：

```text
复杂
```

因此应该以：

```text
business invariant
```

决定版本粒度。

---

# 43. Version 不一定要是“每次更新都 +1”

可以使用：

```text
integer
UUID revision
timestamp + sequence
opaque ETag
database rowversion
MVCC token
```

关键要求：

```text
server generated
unambiguous
comparable
changes when relevant state changes
checked atomically
```

HTTP `ETag` 就是一个很好的通用例子。Kubernetes 的 `resourceVersion` 则采用由 API Server 控制的版本标识，并使用它检测 stale updates。

---

# 44. 不要让 Agent 直接修改 Resource Version

这是一个明显的安全反模式：

```json
{
  "balance": 1000000,
  "version": 17
}
```

Agent：

```text
version = 18
```

如果后端接受：

```text
“用户说 version 18，所以就更新到 18”
```

整个 Optimistic Concurrency 就失效了。

正确：

```text
Agent:
expectedVersion = 17

Server:
currentVersion == 17 ?
    YES → update to 18
    NO → conflict
```

Version 是：

```text
server-side control token
```

不是：

```text
client-writable business field
```

---

# 45. Command Hash 最好不包含由 Executor 运行时生成的字段

例如：

```text
commandHash
```

不应该依赖：

```text
executionAttemptId
workerId
retryCount
startedAt
latency
```

否则每次 retry：

```text
hash changes
```

而同一个业务 Command 会看起来不同。

应区分：

### Stable Command Fields

```text
type
schemaVersion
resource
parameters
expectedVersions
business reason
```

### Runtime Fields

```text
attemptId
workerId
startedAt
retryCount
```

Hash：

```text
stable business representation
```

Attempt：

```text
runtime metadata
```

这样：

```text
same Command
→ same Hash
```

但：

```text
multiple Attempts
→ different Attempt IDs
```

---

# 46. 一个推荐的 Canonical Command

```typescript
interface CanonicalCommand {
  type: "SubmitTrade";
  schemaVersion: 3;

  operationId: "TRADE-123";

  actor: {
    userId: "U123";
    agentId: "AGENT-7";
  };

  target: {
    accountId: "A123";
    instrumentId: "XYZ";
  };

  action: {
    side: "BUY";
    quantity: "100000";
    limitPrice: "100.00";
  };

  preconditions: {
    accountVersion: "17";
    riskPolicyVersion: "8";
  };
}
```

然后：

```text
canonicalize()
     ↓
SHA-256
     ↓
commandHash
```

而：

```text
attemptId
workerId
startedAt
```

不进入 hash。

---

# 47. Approval 应该绑定 Command Hash，而不是 JSON Payload 的“视觉展示”

审批 UI：

```text
BUY XYZ
100,000 shares
limit 100
```

只是：

```text
human-readable representation
```

真正绑定：

```text
approval.commandHash
```

例如：

```json
{
  "approvalId": "AP-100",
  "commandId": "CMD-100",
  "commandHash": "9e5c...",
  "approverId": "U999"
}
```

执行时：

```text
canonical current command
        ↓
hash
        ↓
9e5c...
```

才允许。

这样即使 UI：

```text
formatting
```

发生变化，Approval binding 不受影响。

---

# 48. Human Approval 本身也要避免“批准未来所有操作”

一个危险的设计：

```text
Approve:
“Agent 可以提交 Proxy Vote。”
```

这实际上不是：

```text
Approval
```

而是：

```text
standing delegation
```

如果没有非常明确的权限模型，这可能让：

```text
一个批准
```

变成：

```text
无限 future commands
```

AWS 当前 Agentic AI Lens 对持续信任明确建议：如果存在 persistent trust，应将其限制到特定 Command、parameter shape 或 resource；不能给未来同类操作一个无限范围的 wildcard approval。

因此更安全：

```text
Approval
→ commandHash
→ resource snapshot
→ defined expiration
```

而不是：

```text
Approval
→ commandType only
```

---

# 49. TOCTOU 也可能发生在 Approval Context 本身

假设 Approval UI 显示：

```text
Account balance = $1m
```

但 UI：

```text
缓存了旧数据
```

审批人看到：

```text
$1m
```

而真正：

```text
current = $100k
```

那么：

```text
审批依据
```

本身就已经 stale。

因此 Approval Context 应至少带：

```text
observedAt
resourceVersion
```

必要时：

```text
policyVersion
dataSnapshotId
```

例如：

```json
{
  "account": "A123",
  "version": "17",
  "observedAt": "2026-09-20T08:00:00Z"
}
```

这样执行时：

```text
version mismatch
```

就知道：

```text
approval context is stale
```

---

# 50. “重新读取资源再执行”还不够

一个常见修复：

```text
approval
 ↓
re-read resource
 ↓
execute
```

仍然存在：

```text
TOCTOU
```

因为：

```text
T1:
read version=17

T2:
resource changes to 18

T3:
execute
```

真正需要：

```text
re-read
+
conditional write
```

例如：

```sql
UPDATE ...
WHERE version = 17;
```

而不是：

```text
SELECT version
```

之后再：

```text
UPDATE without version condition
```

---

# 51. External API 也需要 Conditional Execution

如果外部服务支持：

```text
ETag
If-Match
version
revision
sequence
```

应该优先利用。

例如：

```http
GET /accounts/A123

ETag: "v17"
```

然后：

```http
PUT /accounts/A123
If-Match: "v17"
```

如果：

```text
current ETag = "v18"
```

返回：

```http
412 Precondition Failed
```

这样 TOCTOU window 就被缩小到：

```text
server-side conditional mutation
```

RFC 9110 正是为这种条件状态修改定义语义。

---

# 52. 如果 External API 没有 Conditional Update

这时就必须承认：

```text
Check
+
Use
```

无法在外部系统中形成原子操作。

例如：

```text
GET /vote-status
```

然后：

```text
POST /vote
```

两步之间：

```text
another actor
```

可以修改：

```text
vote state
```

因此：

```text
GET then POST
```

不能被描述成：

```text
TOCTOU-safe
```

最多是：

```text
risk-reduced
```

这时可以考虑：

```text
provider idempotency
provider instruction ID
serializing adapter
server-side transaction
manual reconciliation
```

但必须明确：

> **如果外部系统既没有版本条件、也没有原子 mutation、也没有可靠的 operation identity，那么应用层很难对外部资源提供强 TOCTOU 保证。**

---

# 53. 一个很重要的架构边界：内部状态可以 CAS，外部状态可能只能 Reconcile

内部：

```text
PostgreSQL
```

可以：

```sql
UPDATE account
SET ...
WHERE version = 17;
```

这是：

```text
atomic
```

外部：

```text
Vendor
```

如果只提供：

```text
GET
POST
```

就不能：

```text
atomically compare-and-swap
```

因此：

```text
Internal:
CAS

External:
Idempotency + reference + reconciliation
```

是很现实的组合。

---

# 54. Command Hash 与 Resource Version 可以构成“Approval Contract”

一个高风险金融 Command 可以定义：

```typescript
interface ApprovalContract {
  commandId: string;
  commandHash: string;

  resources: Array<{
    id: string;
    version: string;
  }>;

  policyId: string;
  policyVersion: string;

  approverId: string;
  approvedAt: string;

  expiresAt: string;
}
```

执行条件：

```text
1. commandHash unchanged
2. all resource versions unchanged
3. policy still valid
4. approval not expired
5. authorization still valid
6. execution preconditions still true
```

这已经非常接近一个：

```text
Business Execution Contract
```

而不是一个简单的：

```text
approved=true
```

---

# 55. 一个完整的 Execution Guard

```typescript
async function validateForExecution(
  command: CanonicalCommand,
  approval: ApprovalContract,
) {
  // 1. Command integrity
  const actualHash =
    hashCanonical(command);

  if (actualHash !== approval.commandHash) {
    throw new CommandChangedError();
  }

  // 2. Approval validity
  if (
    new Date() >
    new Date(approval.expiresAt)
  ) {
    throw new ApprovalExpiredError();
  }

  // 3. Current resource state
  const current =
    await resourceService.snapshot(
      command.resources
    );

  for (const expected of approval.resources) {
    const actual =
      current.find(
        x => x.id === expected.id
      );

    if (
      actual?.version !==
      expected.version
    ) {
      throw new StaleResourceError(
        expected.id
      );
    }
  }

  // 4. Current authorization/policy
  await authorizationService.assertStillValid(
    command
  );

  // 5. Domain preconditions
  await domainPolicy.assertExecutable(
    command,
    current
  );
}
```

但是注意：

> 这段代码本身仍然不是完整的 TOCTOU 防护。

因为：

```text
snapshot()
```

和：

```text
actual mutation
```

之间仍然可能发生改变。

真正的保护还需要：

```text
atomic conditional execution
```

---

# 56. 真正的 Executor 应该把 Version 检查放到 Mutation 语句里

例如：

```typescript
await db.transaction(async tx => {
  const result = await tx.query(
    `
    UPDATE account
    SET
      balance = balance - $1,
      version = version + 1
    WHERE
      account_id = $2
      AND version = $3
      AND status = 'ACTIVE'
      AND balance >= $1
    `,
    [
      command.amount,
      command.accountId,
      command.expectedAccountVersion,
    ],
  );

  if (result.rowCount !== 1) {
    throw new StaleResourceError();
  }

  await tx.query(
    `
    INSERT INTO outbox (...)
    VALUES (...)
    `,
  );
});
```

这里：

```text
version check
+
business mutation
+
outbox
```

都在：

```text
same local transaction
```

里完成。

这样才真正消除了数据库内部的：

```text
Check
→
race
→
Use
```

窗口。

---

# 57. Command Hash 也可以在同一事务中绑定

例如：

```sql
INSERT INTO command_execution (
    command_id,
    command_hash,
    status
)
VALUES (...)
ON CONFLICT (command_id)
DO NOTHING;
```

然后：

```sql
UPDATE command_execution
SET status = 'EXECUTING'
WHERE command_id = ?
  AND command_hash = ?;
```

这样：

```text
Command identity
+
Command integrity
```

可以与：

```text
execution status
```

一起持久化。

---

# 58. 一个完整的 PostgreSQL 数据模型

```sql
CREATE TABLE business_command (
    command_id             UUID PRIMARY KEY,
    operation_id           UUID NOT NULL UNIQUE,

    command_type           TEXT NOT NULL,
    schema_version         INTEGER NOT NULL,

    canonical_payload      JSONB NOT NULL,
    command_hash           TEXT NOT NULL,

    created_at             TIMESTAMPTZ NOT NULL,
    expires_at             TIMESTAMPTZ
);

CREATE TABLE command_resource_precondition (
    command_id             UUID NOT NULL,
    resource_type          TEXT NOT NULL,
    resource_id            TEXT NOT NULL,
    expected_version       TEXT NOT NULL,

    PRIMARY KEY (
        command_id,
        resource_type,
        resource_id
    )
);

CREATE TABLE command_approval (
    approval_id             UUID PRIMARY KEY,

    command_id              UUID NOT NULL,
    command_hash            TEXT NOT NULL,

    policy_id               TEXT NOT NULL,
    policy_version          TEXT NOT NULL,

    approver_id             TEXT NOT NULL,

    approved_at             TIMESTAMPTZ NOT NULL,
    expires_at              TIMESTAMPTZ
);

CREATE TABLE command_execution (
    operation_id            UUID PRIMARY KEY,

    status                   TEXT NOT NULL,

    attempt_count            INTEGER NOT NULL DEFAULT 0,

    external_reference       TEXT,

    result                   JSONB,

    updated_at               TIMESTAMPTZ NOT NULL
);
```

这里的关键关系：

```text
Command
    ↓
commandHash

Command
    ↓
Resource Preconditions

Approval
    ↓
commandHash

Execution
    ↓
operationId
```

这已经能够表达非常完整的控制链。

---

# 59. 一个关键问题：应该 Hash 什么？

推荐 Hash：

```text
Business Command Canonical Representation
```

包含：

```text
commandType
schemaVersion
operationId
target resource
mutation parameters
expected resource versions
policy reference
```

谨慎考虑是否包含：

```text
actor identity
```

如果 Actor 是审批绑定的一部分，也可以纳入；但更重要的是：

```text
approval record
```

独立记录：

```text
who approved
```

不要把所有控制字段都塞进一个 Hash，导致未来 schema 演进困难。

不建议 Hash：

```text
attemptId
workerId
runtime timestamps
trace IDs
```

因为这些是：

```text
execution metadata
```

不是：

```text
business command
```

---

# 60. Hash Algorithm 如何选择

对于新的系统，常规选择：

```text
SHA-256
```

通常足够。

NIST 当前政策明确建议新应用优先使用 SHA-2 或 SHA-3，并指出 SHA-1 已逐步退出需要 collision resistance 的新用途。

因此不需要：

```text
MD5
SHA-1
```

作为新的 Command Integrity 设计。

更重要的不是：

```text
SHA-256 vs SHA-3
```

而是：

```text
canonicalization
+
stable schema
+
trusted storage
+
approval binding
```

否则换一个更强 Hash 也无法解决架构问题。

---

# 61. Command Hash 与签名的选择

如果：

```text
Approval Service
```

和：

```text
Execution Service
```

位于同一个受控信任域内：

```text
DB record:
commandHash
```

通常可以满足：

```text
integrity comparison
```

如果跨越：

```text
trust boundary
```

例如：

```text
Approval Service
    ↓
External Execution Gateway
```

则可以考虑：

```text
signed approval
```

例如：

```text
JWS:
{
  commandHash,
  commandId,
  policyVersion,
  resourceVersions,
  approvalId
}
```

Execution Service：

```text
verify signature
```

这样不仅证明：

```text
content unchanged
```

还证明：

```text
which trusted party issued approval
```

RFC 7515 定义了 JWS 的数字签名/MAC 结构以及验证模型。

---

# 62. 但签名仍然不能替代 Resource Version

即使：

```text
valid signature
```

也只能证明：

```text
Approval Service signed this Command
```

不能证明：

```text
Resource is still current
```

例如：

```text
Signed:
BUY 100,000 XYZ
AccountVersion=17
```

之后：

```text
AccountVersion=18
```

签名依然完全有效。

因此：

```text
Signature
+
Resource Version
```

仍然需要。

---

# 63. TOCTOU 可以分成三个层次

对于 Agent Business Execution，最好把 TOCTOU 分成：

### Level 1：Command TOCTOU

```text
Approved Command
    ↓
Command modified
```

防护：

```text
Command Hash
Signature
Immutable Command Store
```

### Level 2：Resource TOCTOU

```text
Approved resource state
    ↓
Resource changed
```

防护：

```text
Resource Version
ETag
Optimistic Concurrency
```

### Level 3：External TOCTOU

```text
Internal check
    ↓
External system changes
    ↓
External execution
```

防护：

```text
Provider conditional mutation
Provider idempotency
serialized adapter
external reference
reconciliation
```

这三个层次不能互相替代。

---

# 64. 一个完整的三层控制模型

```text
             Approved Command
                    │
             ┌──────┴──────┐
             │             │
         Command Hash   Resource Version
             │             │
             ▼             ▼
        “what”          “against what”
             │             │
             └──────┬──────┘
                    ▼
             Atomic Execution
                    │
                    ▼
              External System
                    │
               ┌────┴────┐
               │         │
          Conditional   Reconcile
           Mutation
```

这个模型比单独讨论：

```text
“我们要不要 Hash？”
```

完整得多。

---

# 65. Financial Control 中为什么尤其需要这个模型

金融系统天然有：

```text
long-lived approval
multiple actors
high-value actions
changing limits
changing positions
changing mandates
external market state
audit requirements
```

Basel operational risk guidance 明确强调银行应具备适当的审批与授权、风险阈值监控、职责分离和双重控制，并要求对例外和 override 进行跟踪。

这与：

```text
Command Hash
Resource Version
TOCTOU Prevention
```

的架构思想并不是监管条文上的一一对应关系。

更准确地说：

> 它们提供了一种工程实现手段，使 Approval、Execution、Resource State 和 Audit Evidence 能够形成更可靠的绑定。

---

# 66. SEC 的订单审计轨迹也说明“动作”和“状态变化”需要可关联

SEC Rule 613 要求建立 Consolidated Audit Trail，用于追踪 NMS securities 的订单事件，包括：

```text
origination
routing
modification
cancellation
execution
```

并要求这些事件能够在订单整个生命周期内关联起来。

这并不是在规定：

```text
“必须使用 Command Hash + Resource Version。”
```

没有这样的规定。

但对 Agent 架构而言，它提供了非常有价值的工程启示：

```text
一个业务动作
```

不能只留下：

```text
一个最终状态
```

而应该能够关联：

```text
original command
modifications
approvals
execution attempts
final execution
```

因此：

```text
commandId
commandHash
resourceVersion
attemptId
externalReference
```

都有很强的审计价值。

---

# 67. FINRA 对 Agent 的治理要求同样强调 Action Traceability

FINRA 2026 Regulatory Oversight Report 的 GenAI 部分明确讨论 Agent 的：

```text
Autonomy
Scope and Authority
Auditability and Transparency
Human-in-the-loop
Agent actions and decisions
Guardrails
```

并建议金融机构建立正式的 review / approval、governance、monitoring 和记录机制。

这并不意味着：

```text
FINRA requires Command Hash
```

而是说明：

> 当 Agent 开始代替人执行多步骤动作时，企业需要把“Agent 做了什么”和“最终执行了什么”绑定起来。

Command Hash 与 Resource Version 正适合成为这种绑定的技术基础。

---

# 68. 一个金融 Command 的完整 Audit Record

```json
{
  "operationId": "TRADE-123",

  "command": {
    "commandId": "CMD-900",
    "type": "SubmitTrade",
    "schemaVersion": 3,
    "hash": "9e5c..."
  },

  "resources": [
    {
      "type": "ACCOUNT",
      "id": "A123",
      "versionAtApproval": "17",
      "versionAtExecution": "17"
    },
    {
      "type": "RISK_POLICY",
      "id": "TRADE-RISK",
      "versionAtApproval": "8",
      "versionAtExecution": "8"
    }
  ],

  "approval": {
    "approvalId": "AP-77",
    "approverId": "U999",
    "approvedAt": "...",
    "approvedCommandHash": "9e5c..."
  },

  "execution": {
    "attemptId": "ATT-3",
    "startedAt": "...",
    "status": "SUCCEEDED",
    "externalReference": "BROKER-9988"
  }
}
```

这样可以回答：

```text
批准的是哪个 Command？
执行的是不是同一个 Command？
执行时资源是不是批准时的版本？
使用的是哪个 Policy？
谁批准？
执行了几次？
最终外部系统发生了什么？
```

这已经非常接近金融业务真正需要的：

```text
Business Evidence
```

而不只是：

```text
LLM Trace
```

---

# 69. Version Conflict 应该产生什么结果

不推荐：

```text
VersionConflict
    ↓
retry same command
```

推荐：

```text
VERSION_CONFLICT
       ↓
load current state
       ↓
re-evaluate
       ↓
┌──────────────┬──────────────┐
│              │              │
still valid  changed       no longer valid
│              │              │
│        new command        reject
│        / re-approval
│
execute
```

具体规则取决于业务。

例如：

### 低风险资料修改

可以：

```text
reload
merge
submit again
```

### 高风险 Trade

通常更适合：

```text
reject stale command
re-run risk
re-approval
```

### Proxy Vote

如果会议材料发生变化：

```text
重新读取
重新分析
重新生成建议
```

而不是：

```text
blind retry
```

---

# 70. Resource Version Conflict 和 Idempotency Conflict 不应该混淆

### Idempotency Conflict

```text
same operationId
different command payload
```

说明：

```text
ID reuse / command corruption
```

通常应该：

```text
reject
```

### Resource Version Conflict

```text
same command
resource changed
```

说明：

```text
stale command
```

通常：

```text
re-evaluate
```

两者含义完全不同。

---

# 71. 一个实际的 Command Executor Decision Tree

```text
Start
  │
  ▼
Load Command
  │
  ▼
Hash == Approved Hash?
  │
 ├── No → COMMAND_TAMPERED
 │
 ▼ Yes
Resource Version Current?
  │
 ├── No → STALE_COMMAND
 │             │
 │             ▼
 │       Re-evaluate / Re-approve
 │
 ▼ Yes
Authorization Still Valid?
  │
 ├── No → AUTHORIZATION_REVOKED
 │
 ▼ Yes
Policy Valid?
  │
 ├── No → POLICY_CHANGED
 │
 ▼ Yes
Idempotency State?
  │
 ├── SUCCEEDED → replay
 │
 ├── PROCESSING → recover/wait
 │
 ├── UNKNOWN → reconcile
 │
 ▼
Atomic Check-and-Use
  │
 ├── Conflict → STALE
 │
 ▼
Execute
```

这个流程非常适合作为企业 Agent Platform 的公共 Execution Guard。

---

# 72. 为什么“Command Hash + Resource Version”还不够

即使：

```text
Hash = same
Version = same
```

仍然可能有：

```text
Authorization changed
Policy changed
Approval expired
Business cutoff passed
Market closed
External state changed
```

因此最终应该是：

```text
Command Integrity
+
Resource Freshness
+
Authorization Freshness
+
Policy Freshness
+
Business Preconditions
+
Idempotency
```

这才是真正的：

```text
Execution Eligibility
```

所以：

> **Hash 和 Version 是 TOCTOU 防护的重要组成部分，而不是一个完整的授权系统。**

---

# 73. Approval 不应该冻结整个世界

还有一个非常重要的业务设计原则：

> **不要为了避免 TOCTOU，把所有可能变化的状态全部固定下来。**

例如：

```text
Trade Command
```

可能依赖：

```text
Account
Risk
Market
Price
Position
Mandate
```

不代表 Approval 后：

```text
整个市场状态
```

都必须“不允许变化”。

真正需要定义的是：

```text
哪些变化会使这个 Command 失效？
```

例如：

```text
Market Price
```

如果 Command 是：

```text
LIMIT 100
```

价格实时变化可能不影响 Command。

但：

```text
risk limit
account frozen
instrument restricted
mandate revoked
```

可能一定要使 Command 失效。

因此版本控制应该针对：

```text
business invariants
```

而不是机械追踪：

```text
every field
```

---

# 74. 这就是“Resource Version”与“Business Preconditions”的区别

Resource Version：

```text
version changed
```

是一种：

```text
technical signal
```

Business Precondition：

```text
account active
balance sufficient
security allowed
meeting open
limit available
```

是一种：

```text
business rule
```

最合理的执行条件是：

```text
technical concurrency check
+
business precondition check
```

不能认为：

```text
version unchanged
```

就一定：

```text
business valid
```

也不能认为：

```text
business state looks okay
```

就一定：

```text
same resource version
```

---

# 75. Command Hash 更适合“强绑定”，Version 更适合“乐观验证”

一个非常实用的区分：

```text
Command Hash
=
Strong binding to a specific command snapshot
```

而：

```text
Resource Version
=
Optimistic assumption about resource freshness
```

所以：

```text
Approval
```

更应该强绑定：

```text
commandHash
```

而：

```text
Execution
```

更适合验证：

```text
resourceVersion
```

这两个机制放在不同阶段：

```text
Approval:
    bind Command Hash

Execution:
    verify Command Hash
    verify Resource Version
    atomically mutate
```

---

# 76. 为什么 Command Hash 特别适合 Approval

Approval 的核心问题是：

```text
批准对象是什么？
```

所以最重要的是：

```text
immutable representation
```

Hash 正好提供：

```text
compact identity
```

例如：

```text
Command payload:
几 KB

Hash:
32 bytes
```

Approval Store 不一定需要重复存整个 Command。

可以：

```text
commandId
commandHash
```

指向：

```text
immutable Command Store
```

但对于长期审计，需要根据业务和监管要求决定是否保存完整 Command Snapshot，而不是只留下 Hash。

---

# 77. 为什么 Resource Version 特别适合 Execution

Execution 时真正的问题是：

```text
当前资源是什么状态？
```

最好的地方不是：

```text
Approval Store
```

而是：

```text
authoritative Resource Store
```

所以：

```text
Approval:
expectedVersion = 17

Execution:
SELECT current authoritative resource
WHERE version = 17
```

让：

```text
current truth
```

由：

```text
resource owner
```

决定。

这也符合典型的：

```text
source of truth
```

原则。

Agent Memory 不应该决定：

```text
version=17
```

Workflow Store 也不应该伪造：

```text
currentVersion
```

---

# 78. Kubernetes 为什么是一个很好的参考案例

Kubernetes API Server 长期面对：

```text
many actors
+
shared mutable resources
+
concurrent controllers
+
reconciliation loops
```

这与 Agent Workflow 有很强的结构相似性。

Kubernetes 使用：

```text
resourceVersion
```

检测客户端是否基于过期资源执行更新；如果发生 stale write，会返回：

```text
409 Conflict
```

要求客户端重新获取当前状态并处理冲突。

它体现了一个很重要的系统设计：

```text
Don't serialize all actors with a global lock.

Let them operate optimistically,
then reject stale writes.
```

Agent Workflow 很适合借鉴这一思路。

---

# 79. 但 Agent 不能简单“像 Kubernetes 一样重试”

Kubernetes controller 的典型模式：

```text
GET
 ↓
desired state
 ↓
UPDATE with resourceVersion
 ↓
409
 ↓
GET again
 ↓
reconcile
```

Agent 则不能总是：

```text
409
 ↓
LLM rethink
 ↓
automatically submit
```

因为金融 Command 可能涉及：

```text
approval
risk
delegated authority
client intent
```

所以：

```text
resource conflict
```

进入 Agent Workflow 后，可能需要：

```text
re-run deterministic policy
+
possibly re-run AI analysis
+
possibly obtain new approval
```

这一步不能简单视为：

```text
technical retry
```

---

# 80. TOCTOU 与 Re-Approval

对于高风险金融 Command，可以定义：

```text
Version match
    ↓
execute
```

否则：

```text
Version conflict
    ↓
invalidate approval
    ↓
new analysis
    ↓
new command
    ↓
new approval
```

这非常重要。

例如：

```text
Approval:
BUY 100,000 XYZ
AccountVersion=17
```

之后：

```text
AccountVersion=18
```

如果账户变化是：

```text
position materially changed
```

那么旧 Approval 不应该继续有效。

更合理：

```text
old Command = STALE
old Approval = INVALIDATED
```

重新：

```text
analyze
approve
execute
```

---

# 81. 低风险操作则可以采取更宽松的策略

例如：

```text
Update internal note
```

Resource Version Conflict：

```text
reload
merge
retry
```

可能就足够。

所以：

```text
TOCTOU policy
```

应该：

```text
risk-tiered
```

而不是：

```text
all commands same
```

AWS 当前 Human-in-the-loop 指导也采用 risk-tiered approval，而不是所有 Agent 行为都要求同样的人审级别。

---

# 82. 金融业务建议把 Resource Version Conflict 分级

例如：

| Command           | Version Conflict              |
| ----------------- | ----------------------------- |
| 保存内部备注            | 自动 merge/retry                |
| 修改非关键客户资料         | reload + revalidate           |
| 发客户邮件             | 重新检查 recipient/context        |
| Refund            | 重新检查 refundable amount        |
| Trade             | 重新 risk check，必要时 re-approval |
| Proxy Vote        | 重新检查 meeting / mandate        |
| Account Freeze    | 通常阻断并升级                       |
| Permission Change | 通常阻断并重新授权                     |

这不是监管规定，而是一种合理的风险工程划分。

---

# 83. 一个很容易被忽略的问题：Resource Version 必须覆盖“读取依据”

假设 Agent 读了：

```text
Account balance
Risk limit
Restricted list
```

但只保存：

```text
AccountVersion
```

执行时：

```text
RiskLimitVersion changed
```

如果 Risk Limit 是独立资源：

```text
AccountVersion
```

可能完全没有变化。

所以需要：

```text
Decision Inputs
```

与：

```text
Version Tokens
```

明确关联。

可以把它表示成：

```text
Decision Evidence
   ├── Account:A123@17
   ├── RiskLimit:R77@8
   ├── Mandate:M9@42
   └── Policy:P3@12
```

最终 Command：

```text
depends on:
A123@17
R77@8
M9@42
P3@12
```

这才是可审计、可重建的 Decision Context。

---

# 84. Agent RAG 数据也可能存在 TOCTOU

例如 Agent 读取：

```text
Investment Policy v7
```

然后：

```text
生成 Trade Proposal
```

批准以后：

```text
Policy v8
```

执行。

这虽然不像数据库中的典型 TOCTOU，但本质上仍然是：

```text
Decision based on stale state
```

因此对于关键政策：

```text
policyVersion
documentVersion
effectiveAt
```

都值得成为 Command Preconditions。

这也是为什么企业 Agent 不能把：

```text
RAG output
```

直接当成：

```text
current authorization
```

而应该让：

```text
authoritative Policy Service
```

在执行时重新验证。

AWS Agentic AI Lens 当前强调 Agent 工具调用需要通过确定性的外部 Policy / Authorization 控制，而不是依赖模型自行判断。

---

# 85. 一个完整的 Decision Snapshot

对于高风险 Agent 操作，可以定义：

```json
{
  "commandHash": "H123",

  "inputs": [
    {
      "resource": "ACCOUNT:A123",
      "version": "17"
    },
    {
      "resource": "RISK_POLICY:R77",
      "version": "8"
    },
    {
      "resource": "MANDATE:M9",
      "version": "42"
    }
  ],

  "policy": {
    "id": "TRADE_POLICY",
    "version": "12"
  },

  "approvedAt": "2026-09-20T08:00:00Z"
}
```

这实际上建立了：

```text
Decision Snapshot
```

它可以帮助系统回答：

> “这个 Command 当时是依据哪些版本的业务事实和规则被批准的？”

---

# 86. 这对审计尤其重要

SEC 的 Consolidated Audit Trail 要求订单事件能够从生成一直关联到 routing、modification、cancellation 和 execution；这说明金融系统不仅需要记录最终结果，还需要保留业务动作生命周期。

对于 Agent，可以扩展成：

```text
Agent Run
    ↓
Proposal
    ↓
Command
    ↓
Command Hash
    ↓
Decision Inputs + Versions
    ↓
Approval
    ↓
Execution Attempts
    ↓
External Reference
    ↓
Final Outcome
```

这形成了一条完整的：

```text
decision → action → effect
```

证据链。

---

# 87. 一个非常重要的原则：Approved ≠ Executable Forever

Approval 应该被认为是：

```text
conditional authorization
```

而不是：

```text
permanent permission
```

因为：

```text
resource
policy
entitlement
market
time
```

都会变化。

因此一个 Approval 可以包含：

```text
expiresAt
```

并绑定：

```text
commandHash
resourceVersion
policyVersion
```

AWS 当前建议高风险 Agent 操作的审批设置明确时间窗口、超时与 escalation，并记录 reviewer identity 和 timestamp。

---

# 88. Approval Expiry 与 Resource Version Conflict 不应该混为一谈

### Approval Expired

```text
时间过了
```

### Resource Version Conflict

```text
资源变了
```

### Policy Version Conflict

```text
政策变了
```

### Command Hash Conflict

```text
Command 变了
```

四种不同的 Failure Code：

```text
APPROVAL_EXPIRED
STALE_RESOURCE
POLICY_CHANGED
COMMAND_TAMPERED
```

如果全部返回：

```text
409
```

Agent 和 Operations 都很难理解发生了什么。

推荐为业务语义提供：

```text
reasonCode
```

---

# 89. 推荐的 Execution Result

```typescript
type ExecutionRejection =
  | {
      code: "COMMAND_TAMPERED";
    }
  | {
      code: "STALE_RESOURCE";
      resourceId: string;
      expectedVersion: string;
      actualVersion: string;
    }
  | {
      code: "POLICY_CHANGED";
      expectedPolicyVersion: string;
      actualPolicyVersion: string;
    }
  | {
      code: "AUTHORIZATION_REVOKED";
    }
  | {
      code: "APPROVAL_EXPIRED";
    };
```

这样：

```text
Agent
```

可以得到：

```text
“该交易审批所依据的账户版本已经变化，需要重新评估。”
```

而不是：

```text
“HTTP 412”
```

---

# 90. 一个非常重要的实现细节：Version Conflict 不应该被 Agent 自动“修复”

例如：

```text
Command:
Refund $10,000

Expected Version:
17

Actual Version:
18
```

Agent 不应该自己：

```text
update expectedVersion = 18
retry
```

因为这等于：

```text
绕过 Version Check
```

正确：

```text
Version Conflict
    ↓
load current state
    ↓
deterministic policy
    ↓
maybe LLM re-analysis
    ↓
new command
    ↓
possibly new approval
```

尤其对：

```text
payment
trade
proxy vote
permission
client instruction
```

不能让 Agent 将：

```text
stale command
```

自动升级成：

```text
current command
```

---

# 91. Command Hash 也不能由 Agent 自己重新生成然后声称通过验证

错误：

```text
oldCommandHash = H1

Agent changes command

Agent:
newHash = H2

execute(command, hash=H2)
```

如果 Executor 接受：

```text
hash field came from caller
```

那么 Hash 保护失效。

正确：

```text
Executor
    ↓
load authoritative canonical command
    ↓
recompute hash
    ↓
compare approval hash
```

Hash 必须：

```text
recomputed
```

而不是：

```text
trusted from request
```

---

# 92. 推荐 Command Store 为 Immutable / Append-oriented

不要：

```sql
UPDATE command
SET amount = 100000
WHERE command_id = ...
```

更推荐：

```text
CMD-123 v1
```

固定不变。

修改：

```text
CMD-124 v2
```

建立：

```text
supersedes = CMD-123
```

这样审计链：

```text
CMD-123
    ↓
superseded by
CMD-124
```

非常清楚。

对于金融系统尤其有价值。

---

# 93. Command Version 与 Resource Version 也不要混淆

### Command Version

```text
Command schema / command revision
```

例如：

```text
SubmitTrade v3
```

### Resource Version

```text
Resource state revision
```

例如：

```text
Account A123 @ version 17
```

### Approval Version

有时还需要：

```text
Approval revision
```

例如：

```text
AP-123 v1
```

三个版本解决不同问题：

```text
Command Version
→ How is the command structured?

Resource Version
→ What state was the resource in?

Approval Revision
→ Which approval decision is current?
```

---

# 94. TOCTOU 不只是并发线程问题

在 Agent 系统中，TOCTOU 也可能由：

```text
human action
scheduled workflow
another agent
external event
market event
policy deployment
entitlement update
```

触发。

例如：

```text
Agent A
approved Trade

Agent B
changed risk limit

Operations
froze account

Policy Service
published new rule
```

这些都可能导致：

```text
check-time state
≠
use-time state
```

所以 Agent TOCTOU 应理解成：

> **任何在决策时刻和副作用时刻之间发生的相关状态变化。**

不只是：

```text
two threads
```

---

# 95. Agent 让 TOCTOU 的时间窗口变得更长

传统：

```text
READ
 ↓
business code
 ↓
WRITE
```

可能：

```text
1–10 ms
```

Agent：

```text
READ
 ↓
LLM
 ↓
tool calls
 ↓
RAG
 ↓
approval
 ↓
queue
 ↓
worker
 ↓
WRITE
```

可能：

```text
seconds
hours
days
```

因此：

> **Agent Workflow 不是制造了 TOCTOU，而是把原本短暂的 TOCTOU 窗口变成了显著的业务生命周期问题。**

这是为什么：

```text
Resource Version
```

在 Agent Execution Architecture 中尤其重要。

---

# 96. 一个值得采用的模式：Snapshot → Approve → Compare-and-Swap

完整模型：

```text
1. Snapshot
   ↓
   resource version = 17

2. Build Command
   ↓
   commandHash = H1

3. Policy
   ↓
   allow

4. Approval
   ↓
   approve H1 @ version 17

5. Wait

6. Execute
   ↓
   verify H1
   ↓
   CAS version 17 → 18

7. Side Effect
```

这就是：

```text
Snapshot
+
Approval Binding
+
Optimistic Concurrency
```

的标准组合。

---

# 97. 但是 CAS 成功也不代表所有外部副作用已经成功

假设：

```text
DB:
version 17 → 18
```

成功。

然后：

```text
Broker API
```

失败。

那么：

```text
resource version
```

已经变化。

这说明：

```text
CAS
```

只证明：

```text
internal state transition
```

成功，不等于：

```text
external side effect
```

成功。

因此：

```text
Internal CAS
+
External Idempotency
+
Reconciliation
```

仍然需要组合。

---

# 98. 一个更完整的执行架构

```text
             Approval Snapshot
                    │
          ┌─────────┴─────────┐
          │                   │
      Command Hash       Resource Version
          │                   │
          └─────────┬─────────┘
                    ▼
              Execution Guard
                    │
          ┌─────────┴─────────┐
          │                   │
        Valid              Conflict
          │                   │
          ▼                   ▼
     Atomic Internal      Reject / Re-evaluate
        Mutation
          │
          ▼
       Outbox
          │
          ▼
   External Adapter
          │
    ┌─────┴─────┐
    │           │
 SUCCESS      UNKNOWN
    │           │
    │      Reconciliation
    │           │
    └─────┬─────┘
          ▼
    Final Business State
```

---

# 99. 典型反模式一：只用 Command Hash

```text
Approval
  ↓
hash(command)
  ↓
Execute
```

问题：

```text
resource changed
```

仍然可能执行 stale Command。

---

# 100. 典型反模式二：只用 Resource Version

```text
Approval
  ↓
expectedVersion=17
  ↓
Execute
```

问题：

```text
command changed
```

Resource 可能没变，仍然执行了未经批准的动作。

---

# 101. 典型反模式三：Hash + Version，但没有 Atomic Use

```text
check hash
check version
execute
```

仍然存在：

```text
TOCTOU window
```

这是最容易遗漏的一点。

必须：

```text
hash validation
+
version conditional mutation
```

都落在真正的 Execution Boundary。

---

# 102. 典型反模式四：Execution 时直接覆盖 Version

错误：

```sql
UPDATE account
SET version = :newVersion
WHERE account_id = :id;
```

正确：

```sql
UPDATE account
SET version = version + 1
WHERE account_id = :id
  AND version = :expectedVersion;
```

前者：

```text
blind overwrite
```

后者：

```text
compare-and-swap
```

---

# 103. 典型反模式五：Conflict 后自动更新 expectedVersion

错误：

```text
expectedVersion=17
actual=18

→ set expectedVersion=18
→ retry
```

这实际上绕过了：

```text
stale command protection
```

正确：

```text
Conflict
→ Re-read
→ Re-evaluate
→ New Command
→ Maybe New Approval
```

---

# 104. 典型反模式六：Approval 只绑定 Command Type

```text
approved:
SubmitTrade
```

这相当于：

```text
所有未来 SubmitTrade
```

都可能被认为已批准。

高风险操作不应这样设计。

AWS 当前 Agentic AI Lens 明确建议将持续信任限制在具体 Command、参数形状或 Resource 范围内，避免 wildcard approval。

---

# 105. 典型反模式七：把 Agent Memory 当作 Resource Version

```text
Agent Memory:
Account A version = 17
```

不能作为：

```text
authoritative state
```

应该：

```text
Execution Service
    ↓
Resource Store
    ↓
current version
```

Agent Memory 只能提供：

```text
context
```

而不是：

```text
truth
```

---

# 106. 典型反模式八：把 Event Timestamp 当 Resource Version

例如：

```text
lastUpdatedAt = 2026-09-20T10:00:00Z
```

然后：

```text
WHERE last_updated_at = :timestamp
```

这有诸多问题：

```text
timestamp precision
clock skew
multiple updates same timestamp
normalization
database time vs app time
```

如果业务需要 optimistic concurrency，优先使用：

```text
server-generated revision
row version
ETag
opaque version token
```

而不是自己拼时间戳。

---

# 107. 典型反模式九：Resource Version 只在 API Gateway 检查

例如：

```text
Gateway
  ↓
checks version
  ↓
passes request
  ↓
DB
```

如果 Gateway 与：

```text
DB mutation
```

之间存在：

```text
queue
service
retry
```

那么 version 可能已经失效。

正确：

```text
API Gateway
  ↓
coarse validation
  ↓
Business Executor
  ↓
authoritative atomic version check
```

真正的：

```text
TOCTOU barrier
```

应该靠近：

```text
state mutation
```

---

# 108. 典型反模式十：把 Version Conflict 当作普通 Retry

普通 transient retry：

```text
HTTP 503
```

可以：

```text
retry same command
```

Version conflict：

```text
409
```

通常意味着：

```text
business state changed
```

不能默认：

```text
retry same command
```

而应该：

```text
reconcile / revalidate
```

Kubernetes 的 `resourceVersion` 冲突同样要求客户端重新处理当前状态，而不是继续用 stale object 盲写。

---

# 109. 一个推荐的 Error Taxonomy

```text
COMMAND_TAMPERED
    ↓
Command Hash mismatch

STALE_RESOURCE
    ↓
Resource Version mismatch

POLICY_CHANGED
    ↓
Policy version mismatch

AUTHORIZATION_REVOKED
    ↓
Permission changed

APPROVAL_EXPIRED
    ↓
Approval no longer valid

IDEMPOTENCY_CONFLICT
    ↓
Same operation key + different command

EXTERNAL_UNKNOWN
    ↓
External side effect uncertain

PRECONDITION_FAILED
    ↓
Business invariant no longer holds
```

这些错误不应该全部进入：

```text
retry
```

因为它们代表完全不同的业务含义。

---

# 110. 自动恢复策略也应该不同

| Failure                          | 默认处理         |
| -------------------------------- | ------------ |
| Network timeout before send      | Retry        |
| Provider 503 with safe semantics | Retry        |
| Command hash mismatch            | Block        |
| Resource version conflict        | Re-evaluate  |
| Policy version changed           | Re-authorize |
| Approval expired                 | Re-approve   |
| Authorization revoked            | Block        |
| Same key + different payload     | Block        |
| External unknown                 | Reconcile    |
| Business precondition failed     | Re-evaluate  |

这里的核心原则：

> **Transport Failure 可以倾向 Retry；Business State Conflict 应倾向 Re-evaluate。**

---

# 111. 如何测试 Command Hash

至少测试：

```text
same semantic command
different JSON order
```

结果：

```text
same hash
```

测试：

```text
amount 100
→ 101
```

结果：

```text
hash changes
```

测试：

```text
currency USD
→ EUR
```

结果：

```text
hash changes
```

测试：

```text
attemptId changes
```

结果：

```text
hash unchanged
```

如果：

```text
workerId
timestamp
```

进入 Hash：

```text
retry
```

很可能会错误地产生：

```text
different command hash
```

---

# 112. 如何测试 Resource Version

测试：

```text
version = 17
command expected = 17
```

执行：

```text
success
```

测试并发：

```text
Worker A expected 17
Worker B expected 17
```

要求：

```text
one succeeds
one conflicts
```

而不是：

```text
both succeed
```

这正是 optimistic concurrency 应达到的性质。AWS DynamoDB 的 conditional write / version locking 就是这一模式的标准实现。

---

# 113. 如何测试真正的 TOCTOU

测试应该故意插入：

```text
after check
before use
```

例如：

```text
Worker A:
read version = 17

Test harness:
UPDATE resource
SET version = 18

Worker A:
execute
```

正确结果：

```text
STALE_RESOURCE
```

而不是：

```text
SUCCESS
```

更严格：

```text
Worker A:
attempt mutation

Worker B:
concurrent mutation

```

要求：

```text
business invariant preserved
```

而不是只验证：

```text
HTTP status
```

---

# 114. 最有价值的 Chaos Test

可以模拟：

```text
1. Command approved
2. Resource version 17
3. Pause executor
4. Modify resource to version 18
5. Resume executor
```

要求：

```text
execute = rejected
```

再测试：

```text
1. Command approved
2. Command payload modified
3. Resource unchanged
4. Resume executor
```

要求：

```text
COMMAND_TAMPERED
```

再测试：

```text
1. Command unchanged
2. Resource unchanged
3. Executor crashes
4. Retry
```

要求：

```text
safe idempotent retry
```

这样才能验证：

```text
Hash
+
Version
+
Idempotency
+
TOCTOU
```

是否真正形成完整控制。

---

# 115. 一个推荐的 Enterprise Agent Execution Contract

对于每个高风险 Command，平台可以强制：

```typescript
interface ExecutionContract {
  command: {
    commandId: string;
    operationId: string;
    commandHash: string;
  };

  approval: {
    approvalId: string;
    approvedCommandHash: string;
    policyVersion: string;
    expiresAt: string;
  };

  preconditions: {
    resources: Array<{
      id: string;
      version: string;
    }>;
  };

  execution: {
    idempotencyKey: string;
  };
}
```

执行时强制：

```text
commandHash
=
approvedCommandHash

AND

all resource versions
=
current expected versions

AND

approval valid

AND

policy valid

AND

idempotency safe
```

---

# 116. 可以把它抽象成一个“Execution Eligibility Predicate”

定义：

```text
Executable(Command, CurrentState)
```

只有：

```text
Executable = true
```

才能产生副作用。

其逻辑：

```text
Executable =
    HashMatches
    AND
    ResourceVersionsMatch
    AND
    PolicyMatches
    AND
    AuthorizationValid
    AND
    ApprovalValid
    AND
    PreconditionsHold
    AND
    NotAlreadyExecuted
```

然后真正的 Mutation：

```text
if Executable:
    atomic mutation
```

这种思维方式比：

```text
if approved:
    execute
```

强很多。

---

# 117. 但 Predicate 不能停留在应用内 Boolean

危险：

```typescript
const executable =
  hashMatches &&
  versionMatches &&
  authorizationValid;

if (executable) {
  await execute();
}
```

因为：

```text
executable = true
```

和：

```text
execute()
```

之间仍存在：

```text
TOCTOU window
```

所以最终：

```text
Predicate
```

必须尽可能下沉为：

```text
atomic business mutation
```

例如：

```sql
UPDATE ...
WHERE
    version = ?
    AND state = ?
    AND ...
```

---

# 118. 对外部系统则使用“Conditional Effect Contract”

如果 Provider 支持：

```text
If-Match
idempotencyKey
instructionId
version
sequence
```

就应使用。

例如：

```text
Internal:
operationId=OP-100
expectedVersion=17

External:
instructionId=OP-100
If-Match="v17"
```

这样：

```text
internal identity
+
external identity
+
resource freshness
```

都有对应关系。

---

# 119. 如果外部系统只支持 Idempotency，不支持 Resource Version

例如 Payment Provider：

```text
Idempotency-Key
```

但是没有：

```text
If-Match
```

那么可以：

```text
internal resource version
+
provider idempotency
```

组合：

```text
before execution:
validate resource version locally

external:
same operation idempotency key
```

但这里必须明确：

> **本地 Resource Version 并不能自动保护外部资源的状态。**

如果外部资源在内部检查后发生变化：

```text
local account state
```

和：

```text
external provider state
```

可能仍然不一致。

这时：

```text
reconciliation
```

仍然是最后一道防线。

---

# 120. 如果外部系统既无 Version、无 Idempotency、无 Query

这是最困难的情况。

例如：

```text
POST /submit
```

只返回：

```text
200
```

但：

```text
no request ID
no status query
no conditional update
```

那么系统无法建立：

```text
strong automated TOCTOU guarantee
```

正确架构只能明确 trade-off：

```text
Option A:
At-most-once + no automatic retry

Option B:
At-least-once + manual reconciliation

Option C:
Build adapter / wrapper that introduces durable operation identity

Option D:
Replace integration
```

不能假装：

```text
SHA-256 + database transaction
```

就能解决外部 TOCTOU。

---

# 121. 为什么这在金融企业特别重要

金融机构不可能让 Agent 直接控制：

```text
external side effect
```

同时假设：

```text
external system
```

具有与你内部数据库一样的 ACID semantics。

现实通常是：

```text
Internal:
PostgreSQL
SQL Server
Domain API

External:
Broker
Payment Network
Vendor
Proxy Voting Platform
Client Communication
```

因此最稳健的模型是：

```text
Internal:
Atomic + Versioned

External:
Idempotent + Reconciled
```

这比试图把所有系统抽象成：

```text
single transactional universe
```

现实得多。

---

# 122. Audit 需要同时保存 Hash 和 Version

推荐：

```text
Command:
hash=H1

Approval:
approvedHash=H1

Resource:
versionAtApproval=17

Execution:
versionAtExecution=17
```

如果发生：

```text
versionAtExecution=18
```

则显然：

```text
approved against stale state
```

审计系统可以直接发现。

同样：

```text
commandHashAtExecution ≠ approvedHash
```

也能直接发现：

```text
command drift
```

因此：

```text
Hash
+
Version
```

不只是 runtime protection，也非常适合：

```text
post-incident analysis
```

和：

```text
regulatory evidence
```

---

# 123. 一个非常好的 Audit 事件模型

```json
{
  "eventType": "COMMAND_EXECUTION_ATTEMPT",

  "operationId": "OP-123",
  "commandId": "CMD-123",

  "approvedCommandHash": "H1",
  "executedCommandHash": "H1",

  "resourceVersions": {
    "ACCOUNT:A123": {
      "approved": "17",
      "executed": "17"
    }
  },

  "policyVersion": {
    "approved": "8",
    "executed": "8"
  },

  "attemptId": "ATT-3",

  "result": "SUCCEEDED"
}
```

这种记录能够非常清晰地证明：

```text
approved = executed
```

而不是只有：

```text
approved = true
```

---

# 124. 它与金融“四眼原则”是什么关系

Basel operational risk guidance 强调：

```text
segregation of duties
dual controls
four-eyes principle
approval authorities
```

以及对审批、限额例外和 override 进行跟踪。

Command Hash 与 Resource Version 并不实现“四眼原则”。

它们解决的是：

```text
第一人/Agent 批准的东西
```

能不能保证：

```text
第二步执行时仍然是同一个东西
```

所以：

```text
Four-eyes
=
Who approved?

Command Hash
=
What exactly was approved?

Resource Version
=
Against which state was it approved?

TOCTOU protection
=
Did that state remain valid when used?
```

这是一个非常漂亮的控制层次关系。

---

# 125. 对 Agent 来说，最终的 Trust Boundary 应该落在 Execution Service

推荐：

```text
LLM
    untrusted
      ↓
Proposal
    untrusted
      ↓
Command Builder
    controlled
      ↓
Command Store
    trusted
      ↓
Approval
    trusted decision
      ↓
Execution Service
    security boundary
      ↓
Business System
```

Execution Service 不应该：

```text
相信 LLM
```

也不应该：

```text
相信 Agent Memory
```

甚至不应该：

```text
完全相信 Workflow State
```

而应该重新读取：

```text
Command
Approval
Resource Version
Policy
Authorization
Idempotency
```

然后：

```text
atomic execution
```

AWS 当前 Agentic AI Lens 明确强调 Agent 本身不是 trust boundary，关键授权和安全控制应在 Agent 之外，通过确定性机制执行。

---

# 126. 最终推荐架构

```text
                    ┌──────────────┐
                    │    Agent     │
                    │ reasoning    │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Proposal   │
                    └──────┬───────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Command Builder    │
                 │                    │
                 │ schema validation  │
                 │ normalization      │
                 │ canonicalization   │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Canonical Command  │
                 │                    │
                 │ commandId          │
                 │ operationId        │
                 │ commandHash        │
                 │ resourceVersions   │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Policy / AuthZ     │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Human Approval     │
                 │                    │
                 │ commandHash        │
                 │ resourceVersion    │
                 │ policyVersion      │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Execution Guard    │
                 │                    │
                 │ hash check         │
                 │ auth check         │
                 │ policy check       │
                 │ expiry check       │
                 │ current versions   │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Atomic Mutation    │
                 │                    │
                 │ CAS / If-Match     │
                 │ domain precond.    │
                 │ idempotency        │
                 └─────────┬──────────┘
                           │
                     ┌─────┴─────┐
                     │           │
                     ▼           ▼
                 Internal      External
                 State         Adapter
                                  │
                           ┌──────┴──────┐
                           │             │
                      Conditional    Idempotency
                      Mutation       / Reference
                           │             │
                           └──────┬──────┘
                                  ▼
                            Reconciliation
```

---

# 127. 一个更简洁的工程模型

如果不考虑实现细节，整个机制可以浓缩成：

```text
Approved Command
    =
    commandHash
    +
    resourceVersion
    +
    policyVersion
    +
    approval
```

执行：

```text
Execution
    =
    verify commandHash
    +
    verify current resourceVersion
    +
    verify current authorization/policy
    +
    atomic compare-and-use
    +
    idempotency
```

失败：

```text
hash mismatch
    → block

version mismatch
    → re-evaluate

policy mismatch
    → re-authorize

authorization revoked
    → block

unknown external outcome
    → reconcile
```

这就是一套完整的：

```text
Agent Execution Consistency Model
```

---

# 128. 最终结论

`Command Hash`、`Resource Version` 和 `TOCTOU` 并不是三个独立的小技巧。

它们实际上对应 Agent Business Execution 中三个不同的核心问题：

```text
Command Hash
    ↓
“执行的动作是不是当初批准的那个动作？”

Resource Version
    ↓
“执行时资源是不是当初批准时所看到的那个状态？”

TOCTOU 防护
    ↓
“从检查到真正使用之间，状态是否仍然没有被改变？”
```

因此，一个只做：

```text
Approval + Command Hash
```

的系统仍然可能执行：

```text
stale command
```

一个只做：

```text
Resource Version
```

的系统仍然可能执行：

```text
unapproved command
```

而一个同时做：

```text
Hash + Version
```

但仍然采用：

```text
SELECT
  ↓
check
  ↓
UPDATE
```

的系统仍然存在 TOCTOU race。

真正完整的控制链应该是：

```text
                  Agent
                    │
                    ▼
                Proposal
                    │
                    ▼
            Canonical Command
                    │
             ┌──────┴──────┐
             │             │
        Command Hash   Resource Versions
             │             │
             └──────┬──────┘
                    ▼
             Policy / AuthZ
                    │
                    ▼
                Approval
                    │
                    ▼
             Durable Command
                    │
                    ▼
           Execution-time checks
             │       │       │
             │       │       └── Policy/AuthZ
             │       └────────── Resource Version
             └────────────────── Command Hash
                    │
                    ▼
          Atomic Compare-and-Use
                    │
                    ▼
               Side Effect
                    │
                    ▼
             Reconciliation
```

因此最重要的架构原则可以归纳为四句话：

> **Command Hash 绑定“做什么”。**

> **Resource Version 绑定“基于什么状态做”。**

> **TOCTOU 防护保证“检查结果在真正使用时仍然成立”。**

> **最终的 Check 和 Use 必须尽可能在同一个原子执行边界内完成。**

对于金融 Agent，这一点尤其重要。传统金融控制已经强调审批权限、职责分离、双重控制、风险阈值与可追踪性；证券市场的 Consolidated Audit Trail 也要求订单事件能够从生成到 routing、修改、取消和执行进行全生命周期关联。

Agent 并不会消除这些控制，反而会让它们更加重要。

因为传统应用可能是：

```text
User
 ↓
Application
 ↓
DB
```

而 Agent 应用变成：

```text
User
 ↓
Agent
 ↓
Reasoning
 ↓
Tools
 ↓
Workflow
 ↓
Approval
 ↓
Queue
 ↓
Executor
 ↓
External Systems
```

在这么长的链路中，“批准的动作”“批准时的资源状态”和“执行时的资源状态”如果没有被显式绑定，系统就无法可靠回答：

```text
为什么允许执行？
批准的到底是什么？
执行的到底是什么？
执行时依据的状态还是不是原来的状态？
```

因此，真正适合企业 Agent Platform 的设计，不应该只是：

```text
LLM
+
Tool Calling
+
Approval
```

而应该形成：

```text
Proposal
→ Canonical Command
→ Command Hash
→ Resource Preconditions
→ Authorization / Policy
→ Approval
→ Execution-time Validation
→ Atomic Compare-and-Use
→ Idempotent Execution
→ Reconciliation
→ Audit
```

这套模型最终把一个很模糊的 Agent 行为：

```text
“Agent 想执行某件事”
```

转换成一个可以被验证的确定性业务契约：

```text
“这个具体 Command，
由这个主体，
针对这些具体资源，
在这些具体版本和政策条件下，
经过这个审批，
现在仍然满足执行条件，
因此可以产生副作用。”
```

这才是 Command Hash、Resource Version 与 TOCTOU 防护在金融 Agent 架构中真正的价值。

---

# 参考资料

## 一、TOCTOU、Race Condition 与原子执行

**OWASP — Race Conditions**
介绍 Race Condition 与 TOCTOU 的基本概念，并说明多个并发执行者可能在检查和使用之间改变共享状态。
[OWASP — Race Conditions](https://community.owasp.org/pages/vulnerabilities/race_conditions?utm_source=chatgpt.com)

**OWASP Business Logic Security Cheat Sheet — Prevent Race Conditions on Sensitive Operations**
直接讨论 `check → decision → write` 型业务逻辑为什么容易出现竞争条件，并建议把 check 与 act 放入单一原子操作。
[OWASP — Business Logic Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html?utm_source=chatgpt.com)

---

## 二、HTTP Conditional Requests / ETag / If-Match

**RFC 9110 — HTTP Semantics, Section 13: Conditional Requests**
定义 `If-Match`、条件状态修改以及使用条件请求避免 lost update 的标准语义；不满足条件时服务器应拒绝状态改变。
[RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html?utm_source=chatgpt.com)

---

## 三、Canonicalization、Hash 与签名

**RFC 8785 — JSON Canonicalization Scheme**
说明为什么 Hash / Signature 需要稳定、确定性的 canonical representation，并规定 JSON canonicalization 方法。
[RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html?utm_source=chatgpt.com)

**NIST — Policy on Hash Functions**
NIST 当前建议新系统使用 SHA-2 或 SHA-3，并逐步淘汰 SHA-1 在需要 collision resistance 的新用途中的使用。
[NIST — Hash Functions Policy](https://csrc.nist.gov/Projects/Hash-Functions/NIST-Policy-on-Hash-Functions?utm_source=chatgpt.com)

**RFC 7515 — JSON Web Signature (JWS)**
定义数字签名和 MAC 保护 JSON 内容的标准机制，适合跨信任边界绑定 Approval、Command Hash 等内容。
[RFC 7515 — JSON Web Signature](https://www.rfc-editor.org/rfc/rfc7515.html?utm_source=chatgpt.com)

---

## 四、Optimistic Concurrency / Resource Version

**Amazon DynamoDB — Optimistic Locking with Version Number**
AWS 官方介绍 version attribute + conditional write 的 optimistic locking 模式，并明确讨论其在金融交易记录等并发业务中的适用性。
[AWS — Optimistic Locking with Version Number](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BestPractices_OptimisticLocking.html?utm_source=chatgpt.com)

**Amazon DynamoDB — Handling Concurrent Updates**
比较 optimistic locking、pessimistic locking 和 transaction / lock client，并说明 version + conditional write 的选择边界。
[AWS — Handling Concurrent Updates](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BestPractices_ImplementingVersionControl.html?utm_source=chatgpt.com)

**Kubernetes API Concepts — resourceVersion**
Kubernetes API Server 使用 `resourceVersion` 检测 stale updates，版本过期时返回 `409 Conflict`，是大规模控制器系统中非常成熟的 optimistic concurrency 实践。
[Kubernetes — API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/?utm_source=chatgpt.com)

---

## 五、Agentic AI 安全与执行控制

**AWS Well-Architected Agentic AI Lens — Secure agent tool usage**
AWS 当前建议每个 Tool Invocation 都在模型之外进行授权、参数验证和 policy enforcement，高风险 mutation 设置 human-in-the-loop，并保持完整可观测性。
[AWS — Secure agent tool usage](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02.html?utm_source=chatgpt.com)

**AWS — Implement tool authorization**
明确强调授权必须是外部、确定性的控制，不能依靠 Agent 自己判断权限。
[AWS — Implement tool authorization](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec02-bp01.html?utm_source=chatgpt.com)

**AWS — Agent identity and permission management**
讨论 Agent identity、Human identity、least privilege 以及代表用户行动时的 signed user context。
[AWS — Agent identity and permissions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec03.html?utm_source=chatgpt.com)

**AWS — Human-in-the-loop for critical decisions**
强调高风险 Agent 操作的风险分级审批、Command/parameter/resource 范围绑定、审批时效和可审计决策。
[AWS — Human-in-the-loop for critical decisions](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec04-bp02.html?utm_source=chatgpt.com)

**AWS — Multiple reviewers for critical operations**
讨论金融等高风险领域的 four-eyes / multi-reviewer 模式及其审计记录。
[AWS — Multiple reviewers for critical operations](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentsec07-bp03.html?utm_source=chatgpt.com)

---

## 六、Agent Workflow 与 Idempotent Execution

**AWS Durable Execution SDK — Idempotency and retries**
直接说明 replay/retry 会再次运行带副作用的 Step，并将 at-least-once 作为默认语义；要求 side-effecting operations 使用 Idempotency。
[AWS — Idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/?utm_source=chatgpt.com)

**AWS Durable Execution SDK Developer Guide**
介绍 durable state、checkpoint、retry、pause/resume 和 at-least-once / at-most-once Step semantics。
[AWS — Durable Execution SDK](https://docs.aws.amazon.com/durable-execution/?utm_source=chatgpt.com)

---

## 七、金融服务内部控制与审计

**Basel Committee — Operational Risk**
强调审批与授权、风险阈值、职责分离、双重控制、例外及 override tracking。适合作为金融 Agent Approval / Execution Control 的治理背景，而不是某个具体技术实现的规定。
[BIS — Operational Risk](https://www.bis.org/committees/bcbs/basel-consolidated-guidelines/module/orr/10?utm_source=chatgpt.com)

**SEC — Rule 613 / Consolidated Audit Trail**
要求订单生命周期能够关联 origination、routing、modification、cancellation 和 execution 等事件，是金融业务 Action Lineage 的重要现实参考。
[SEC — Consolidated Audit Trail](https://www.sec.gov/about/divisions-offices/division-trading-markets/rule-613-consolidated-audit-trail?utm_source=chatgpt.com)

**FINRA — 2026 Regulatory Oversight Report: GenAI**
讨论金融机构 GenAI / Agent 的 autonomy、scope and authority、auditability、human-in-the-loop、guardrails、review/approval 和持续监控。这里是治理背景，不应解释为 FINRA 对 Command Hash 或 Resource Version 的具体技术要求。
[FINRA — GenAI: Continuing and Emerging Trends](https://www.finra.org/rules-guidance/guidance/reports/2026-finra-annual-regulatory-oversight-report/gen-ai?utm_source=chatgpt.com)

---

## 八、最终架构参考

最值得作为企业 Agent Platform 标准沉淀的模型可以浓缩为：

```text
Agent
  ↓
Proposal
  ↓
Canonical Command
  ↓
┌──────────────────────────┐
│ Approved Execution Contract │
│                          │
│ commandHash              │
│ resourceVersions         │
│ policyVersion            │
│ approvalId               │
│ expiresAt                │
└────────────┬─────────────┘
             │
             ▼
      Execution-time Guard
             │
     ┌───────┼────────┐
     │       │        │
     ▼       ▼        ▼
   Hash   Version   Policy/AuthZ
     │       │        │
     └───────┴────────┘
             │
             ▼
   Atomic Compare-and-Use
             │
             ▼
       Idempotent Effect
             │
       ┌─────┴──────┐
       │            │
    Success       Unknown
       │            │
       │       Reconciliation
       │            │
       └─────┬──────┘
             ▼
       Final Business State
             │
             ▼
            Audit
```

最终的核心原则是：

> **Hash 防 Command Drift，Version 防 Resource Drift，Atomic Compare-and-Use 防 TOCTOU，Idempotency 防 Retry 重复，Reconciliation 处理无法确定的外部结果。**

五者组合，才构成金融 Agent 真正可控的安全执行边界。

