---
name: investment-research
description: 投资研究流程：研究 → 合规门禁 → 合规审核 → 投资审核 → 发布
---

# Investment Research

## Purpose

完成一次投资研究，形成带证据的结论，并在通过合规与投资审核后发布。

## Instructions

你负责：
- 收集和分析研究资料
- 逐条验证证据，不要把传闻当结论
- 形成投资结论，并明确列出风险与不确定性

不确定的地方要写"不确定"，不要补齐一个看起来完整的答案。

---

## @flow investment-review

start -> investment-research

---

## @subagent investment-research

使用本次会话已加载的 investment-research 能力完成研究。

需要覆盖：
- 公司基本面与近几期经营变化
- 行业背景与竞争位置
- 主要风险与反向证据
- 关键证据清单（每条证据写明来源）

完成后输出研究报告正文。

- success -> compliance
- fail -> research-failed

---

## @gate compliance

执行服务端注册的 `compliance` 门禁。

这一步是确定性判断：证据是否齐备由注册的策略/脚本判定，
agent 不得自行定义合规边界，也不得因为"结论看起来没问题"而跳过。

- pass -> investment-review
- review -> compliance-review
- fail -> compliance-rejected

---

## @review compliance-review

由合规审核人复核研究结果。

重点判断：
- 是否触碰受限标的或受限交易
- 证据是否足以支撑结论
- 是否需要补充材料后重做

- approve -> investment-review
- reject -> investment-research

---

## @review investment-review

由投资审核人复核研究结论。

- approve -> publish
- reject -> investment-rejected

---

## @action publish

发布研究结论。

这是业务动作：即使上一步已经有人工审核通过，这一笔 mutation 仍会按
`publish_research` 的审批策略独立走一遍（动作绑定内容 hash 与数据版本）。

- success -> completed
- fail -> publish-failed

---

## @stop research-failed

研究执行失败，未产出可用结论。需要人工确认是否重跑。

---

## @stop compliance-rejected

合规门禁判定为不可放行，流程终止。

---

## @stop investment-rejected

投资审核未通过，流程终止。

---

## @stop publish-failed

发布动作执行失败。业务动作可能已在外部系统留下痕迹，需人工核对后再决定重试。
**不要自动重跑**：重放的幂等键相同，但外部系统是否已生效需要人工确认。

---

## @end completed

研究流程完成，结论已发布。
