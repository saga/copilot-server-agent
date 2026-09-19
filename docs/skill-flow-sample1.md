---

name: major-investment-approval
description: 对重大投资交易进行研究、合规与风险审查、投资委员会审批，并在批准后执行交易。
---------------------------------------------------

# 重大投资交易审批

## Purpose

对重大投资交易进行完整的事前审批。

流程包括：

1. 收集和分析投资信息
2. 形成投资建议
3. 验证研究资料完整性
4. 进行合规检查
5. 进行风险评估
6. 获得投资委员会批准
7. 执行经授权的交易操作
8. 保存完整的执行和审批证据

本 Skill 用于辅助决策和执行流程，不自行授予任何审批权限。

---

## Instructions

执行本 Skill 时：

* 使用公司批准的数据源和研究资料
* 区分事实、估计、假设和判断
* 所有重大结论都应能够追溯到证据
* 不得伪造数据、研究结果或审批结果
* 不得将 Agent 的判断视为正式审批
* 不得自行决定用户是否具有审批权限
* 不得绕过合规、风险或投资委员会审批
* 不得直接调用未经注册的交易系统
* 所有实际业务动作必须通过注册的 Command 执行
* 发生信息变化时，应重新验证相关审批条件

## Required Input

启动流程时，应尽可能提供：

* 投资标的
* 交易类型
* 预计交易金额
* 投资方向
* 投资期限
* 投资理由
* 已知风险
* 相关研究资料
* 交易相关文件

---

## @flow major-investment-approval

start -> investment-analysis

---

## @task investment-analysis

对投资机会进行初步研究，形成投资分析包。

至少分析：

* 标的基本情况
* 商业模式
* 财务情况
* 市场环境
* 竞争情况
* 估值情况
* 投资逻辑
* 主要风险
* 关键假设
* 可能影响投资判断的重要信息

输出：

* investment-thesis
* supporting-evidence
* key-assumptions
* key-risks
* valuation-summary
* open-questions

如果关键资料缺失，不得自行补充不存在的事实。

* success -> research-quality
* fail -> analysis-failed

---

## @gate research-quality

检查投资分析包是否满足后续审批要求。

至少检查：

* 核心字段是否完整
* 关键假设是否明确
* 重要结论是否有证据支持
* 估值是否存在明显缺失
* 重大风险是否已经识别
* 所需研究资料是否已经提供
* 输入数据是否属于允许使用的数据范围

可能结果：

* pass：研究包可以进入后续审批

* review：存在需要人工判断的问题

* fail：资料明显不足，不能继续

* pass -> compliance-check

* review -> research-review

* fail -> research-insufficient

---

## @review research-review

研究资料存在需要人工判断的问题。

本审核节点用于处理：

* 资料是否足以支持投资判断
* 关键假设是否合理
* 数据质量问题是否可以接受
* 是否允许在当前资料基础上继续审批

审核人员可以要求：

* 继续当前流程
* 驳回并要求重新准备研究材料

该节点的实际审批人员、多人会签规则和最少审批人数由服务端配置。

例如服务端可以配置：

* Research Lead
* Senior Analyst

并要求至少一名符合条件的人员批准。

* approve -> compliance-check
* reject -> research-revision

---

## @task research-revision

根据人工审核意见重新整理投资研究。

重点处理：

* 补充缺失证据
* 修正错误信息
* 明确关键假设
* 补充遗漏风险
* 更新估值分析
* 回应人工审核意见

不得简单重复上一轮结果。

重新生成完整的投资分析包，并再次进入研究质量检查。

* success -> research-quality
* fail -> analysis-failed

---

## @gate compliance-check

按照注册的合规政策检查投资建议。

至少检查：

* 投资标的限制
* 交易限制
* 法规和内部政策要求
* 信息隔离要求
* 受限名单
* 利益冲突
* 信息披露要求
* 所需文件
* 特殊审批要求

该节点的最终判断必须由注册的 Compliance Policy / Rule / Decision Service 产生。

Agent 可以提供辅助信息，但不能自行给出正式合规结论。

可能结果：

* pass：满足标准合规要求

* review：需要人工合规判断

* fail：违反明确规则

* pass -> risk-analysis

* review -> compliance-review

* fail -> compliance-rejected

---

## @review compliance-review

该交易存在需要人工处理的合规事项。

审核人员需要确认：

* 合规问题的性质
* 是否存在可接受的例外
* 是否需要额外限制
* 是否需要补充披露
* 是否需要进一步升级

该 Review 不定义审批权限。

例如服务端可以配置：

* Compliance Officer
* Compliance Manager

并可以要求：

* 至少一名审批通过
* 或两名审批人全部通过

具体规则由服务端 `FlowReview` 配置决定。

* approve -> risk-analysis
* reject -> compliance-rejected

---

## @task risk-analysis

对交易进行独立风险评估。

至少分析：

* 市场风险
* 流动性风险
* 信用风险
* 集中度风险
* 操作风险
* 估值风险
* 下行情景
* 压力情景
* 最大潜在损失
* 与现有组合的相关性
* 对组合整体风险的影响

必要时执行：

* stress test
* scenario analysis
* concentration analysis

输出：

* risk-summary
* risk-metrics
* stress-scenarios
* risk-limit-impact
* recommended-controls

如果发现无法量化或需要进一步判断的重大风险，应明确标识。

* success -> risk-gate
* fail -> risk-analysis-failed

---

## @gate risk-gate

将风险分析结果与注册的风险政策进行比较。

检查：

* 风险限额
* 单一标的集中度
* 组合集中度
* 流动性要求
* 投资等级要求
* 最大风险敞口
* 压力测试结果
* 其他适用风险规则

可能结果：

* pass：风险在允许范围内

* review：存在需要人工判断的风险事项

* fail：超过明确风险限制

* pass -> risk-review

* review -> risk-review

* fail -> risk-rejected

---

## @review risk-review

对重大风险事项进行人工审核。

审核人员至少应确认：

* 风险是否已经充分识别
* 风险水平是否可接受
* 是否需要额外风险控制
* 是否需要限制交易规模
* 是否需要加入额外监控条件

该节点可以配置为多人审批。

例如：

* Risk Manager
* Portfolio Risk Officer

可以要求两人全部批准。

如果审核意见要求重新进行风险分析，服务端可以通过现有业务处理机制重新启动 `risk-analysis`。

* approve -> investment-committee
* reject -> risk-rejected

---

## @review investment-committee

该交易属于重大投资，需要投资委员会正式审批。

投资委员会应审查：

* 投资逻辑
* 研究结论
* 主要风险
* 合规结果
* 风险评估结果
* 估值和价格假设
* 交易金额
* 预期收益与风险
* 风险控制措施
* 重大例外事项

该 Review 可以配置为：

* 多名委员会成员
* ALL 策略
* 固定最少批准人数
* 指定审批角色
* Segregation of Duties

这些规则不写入 Skill。

批准只能表示：

> 投资委员会同意继续执行该交易。

它不能绕过最终 Command 的授权和重新验证。

* approve -> execution-check
* reject -> investment-rejected

---

## @gate execution-check

在执行交易前进行最终状态检查。

重新确认：

* 投资委员会审批仍然有效
* 合规状态没有变化
* 风险状态没有变化
* 交易指令版本没有变化
* 标的状态没有变化
* 交易金额没有超出批准范围
* 审批对应的 CommandIntent 仍然有效
* 所需审批没有过期
* 没有新的阻断条件

这是执行前的最终确定性检查。

不能使用 Agent 的主观判断替代该检查。

可能结果：

* pass：允许进入执行

* review：需要重新人工确认

* fail：不能执行

* pass -> execute-trade

* review -> execution-review

* fail -> execution-blocked

---

## @review execution-review

执行前状态发生变化，需要人工确认。

例如：

* 交易价格发生明显变化
* 交易规模变化
* 风险指标发生变化
* 审批后出现新的重大信息
* 交易指令版本发生变化

审核人员必须确认：

* 当前交易是否仍然属于原批准范围
* 是否需要重新提交审批
* 是否需要调整交易规模
* 是否需要重新执行风险检查

如果当前交易已经实质性偏离原审批结果，不应直接批准执行。

* approve -> execute-trade
* reject -> execution-blocked

---

## @command execute-trade

执行已经批准的交易。

该 Command 必须通过注册的交易 Command 执行，不得由 Agent 直接调用底层交易系统。

执行前必须：

* 验证当前审批状态
* 验证审批人资格
* 验证 CommandIntent
* 验证 resourceVersion
* 验证 action hash
* 验证交易指令版本
* 验证当前风险状态
* 验证当前交易条件
* 使用幂等键防止重复执行

执行后必须记录：

* 实际执行时间

* 实际交易金额

* 实际价格

* 执行结果

* 下游系统返回结果

* 关联审批

* 执行主体

* Command idempotency key

* success -> post-trade-check

* fail -> execution-failed

---

## @task post-trade-check

对执行结果进行事后核对。

检查：

* 交易是否真正完成
* 实际交易结果是否与批准指令一致
* 实际金额是否在批准范围内
* 是否产生异常
* 是否需要补充记录
* 是否存在执行后风险变化

该步骤只进行核对和报告，不得重新执行交易。

* success -> completed
* fail -> post-trade-failed

---

## @stop analysis-failed

投资分析无法完成。

流程进入失败状态。

必须保留：

* 输入
* Agent 执行结果
* 错误信息
* 已使用的数据
* 已产生的中间结果
* 失败原因

---

## @stop research-insufficient

研究资料不足，无法进入正式审批。

流程需要由业务人员补充必要资料后重新启动。

---

## @stop compliance-rejected

交易未通过合规要求，不能继续。

不得通过修改 Agent 输出绕过该结论。

---

## @stop risk-analysis-failed

风险分析无法完成。

在风险分析完整之前，不得进入投资委员会审批。

---

## @stop risk-rejected

交易未通过适用风险要求。

不得通过人工修改流程状态绕过该结果。

---

## @stop investment-rejected

投资委员会未批准该交易。

该交易不得执行。

---

## @stop execution-blocked

执行前最终检查未通过。

原审批结果不能直接视为当前执行授权。

---

## @stop execution-failed

交易已经进入执行阶段，但执行失败。

需要根据实际执行结果判断是否：

* 重试
* 对账
* 人工处理
* 取消后续流程

不得因为 Command 重试而重复产生未经幂等控制的业务副作用。

---

## @stop post-trade-failed

交易执行结果无法完成核对。

流程必须进入人工处理状态。

---

## @end completed

交易审批、执行以及执行结果核对全部完成。

流程应形成完整的审计证据链，包括：

* 谁发起
* 谁执行 Agent 分析
* 使用了哪些数据
* 经过哪些 Gate
* 哪些人员批准
* 每次批准发生在什么时间
* 最终批准了什么
* 实际执行了什么
* 为什么允许执行
* Command 使用了什么版本和幂等键
* 最终执行结果是什么

---

# 流程概览

```text
start
  │
  ▼
@task investment-analysis
  │
  ▼
@gate research-quality
  │
  ├── fail ───────────────→ STOP research-insufficient
  │
  ├── review → @review research-review
  │                         │
  │                         ├── reject → @task research-revision
  │                         │                 │
  │                         │                 └──→ research-quality
  │                         │
  │                         └── approve → compliance-check
  │
  └── pass ────────────────────────────────→ compliance-check
                                            │
                                            ├── fail → STOP compliance-rejected
                                            │
                                            ├── review → @review compliance-review
                                            │                  │
                                            │                  ├── reject → STOP
                                            │                  └── approve
                                            │
                                            └── pass
                                                 │
                                                 ▼
                                      @task risk-analysis
                                                 │
                                                 ▼
                                           @gate risk-gate
                                                 │
                              ┌──────────────────┼──────────────────┐
                              │                  │                  │
                              ▼                  ▼                  ▼
                            fail              review              pass
                              │                  │                  │
                              ▼                  ▼                  │
                         STOP risk         @review risk-review     │
                                                 │                 │
                                    ┌────────────┴────────────┐    │
                                    │                         │    │
                                  reject                    approve│
                                    │                         │    │
                                    ▼                         └────┘
                               STOP risk-rejected
                                                         
                                                         ▼
                                           @review investment-committee
                                                         │
                                      ┌──────────────────┴───────────────┐
                                      │                                  │
                                    reject                             approve
                                      │                                  │
                                      ▼                                  ▼
                           STOP investment-rejected             @gate execution-check
                                                                       │
                                                    ┌──────────────────┼──────────────┐
                                                    │                  │              │
                                                   fail              review          pass
                                                    │                  │              │
                                                    ▼                  ▼              ▼
                                              STOP blocked      @review execution  @command
                                                                    │             execute-trade
                                                               reject│              │
                                                                    ▼          success/fail
                                                               STOP blocked        │
                                                                                  ▼
                                                                          @task post-trade-check
                                                                                  │
                                                                    ┌─────────────┴────────────┐
                                                                    │                          │
                                                                  fail                       success
                                                                    │                          │
                                                                    ▼                          ▼
                                                             STOP post-trade-failed         END
```

### 这个例子里，Skill Flow 刻意没有表达的东西

例如“投资委员会需要 3 人中的 2 人批准”不会写成：

```md
## @review investment-committee

requiredCount: 2
```

而是由服务端 registry：

```ts
{
  name: 'investment-committee',
  eligibleRoles: [
    'investment-committee-member'
  ],
  strategy: 'ANY',
  requiredCount: 2
}
```

来定义。

这样 Skill 只负责描述：

```text
这里需要投资委员会审核
```

而系统负责决定：

```text
谁能审核
几个人审核
是否存在 SoD
谁已经审核
是否满足批准条件
```

这正是这套 Flow Skill 在金融场景下应该保持的边界。
