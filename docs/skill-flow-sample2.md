---

name: vendor-onboarding
description: 对新供应商进行资料收集、风险评估、采购与法务审核、信息安全审查，并在全部条件满足后完成供应商注册。
--------------------------------------------------------------

# 新供应商准入

## Purpose

对新供应商进行标准化准入审核。

流程包括：

1. 收集供应商基础资料
2. 验证资料完整性
3. 评估供应商风险
4. 完成采购审核
5. 完成法务审核
6. 完成信息安全审核
7. 完成最终准入审批
8. 创建供应商主数据

本 Skill 用于辅助供应商准入流程，不自行授予任何审批权限，也不能绕过企业现有供应商管理政策。

---

## Instructions

执行本 Skill 时：

* 仅使用企业批准的信息源
* 区分供应商提供的信息和系统验证的信息
* 不得伪造供应商资料
* 不得将 Agent 的判断视为正式审批
* 不得自行决定审批人员
* 不得绕过采购、法务、信息安全或最终审批
* 不得直接修改供应商主数据
* 所有主数据变更必须通过注册的 Action 执行
* 对缺失资料应明确指出，不得自行补全不存在的事实

## Required Input

启动流程时，应尽可能提供：

* 供应商名称
* 注册国家或地区
* 供应商类型
* 产品或服务类型
* 业务联系人
* 合同资料
* 公司注册资料
* 银行账户资料
* 信息安全资料
* 预计年度采购金额
* 业务使用场景

---

## @flow vendor-onboarding

start -> supplier-analysis

---

## @agent supplier-analysis

分析供应商提交的资料，并建立供应商准入资料包。

至少整理：

* 公司基本信息
* 注册信息
* 所在地区
* 所提供的产品或服务
* 业务用途
* 关键联系人
* 合同状态
* 银行信息状态
* 信息安全资料状态
* 预计采购金额
* 是否涉及敏感数据
* 是否涉及企业内部系统访问

识别：

* 缺失资料
* 信息矛盾
* 高风险因素
* 需要人工确认的问题

输出完整的：

* supplier-profile

* missing-information

* identified-risks

* business-use-case

* data-access-profile

* success -> completeness-check

* fail -> analysis-failed

---

## @gate completeness-check

检查供应商资料是否满足准入要求。

至少检查：

* 法定公司名称
* 注册信息
* 联系信息
* 合同文件
* 必要税务资料
* 银行资料
* 业务用途
* 信息安全资料
* 其他按供应商类型要求的资料

可能结果：

* pass：资料完整

* review：存在可以由人工判断的问题

* fail：存在明确缺失

* pass -> supplier-risk

* review -> supplier-information-review

* fail -> information-insufficient

---

## @review supplier-information-review

人工审核供应商资料中的异常或缺失。

例如：

* 注册名称与合同名称不一致
* 某项资料无法从公开渠道验证
* 某些材料暂时无法提供
* 特殊供应商类型不适用标准材料

审核人员需要判断：

* 是否可以继续

* 是否需要补充资料

* 是否可以接受例外

* approve -> supplier-risk

* reject -> information-insufficient

---

## @agent supplier-risk

对供应商进行风险分析。

至少评估：

* 业务重要性
* 供应商依赖程度
* 地区风险
* 数据处理风险
* 系统访问风险
* 信息安全风险
* 合规风险
* 财务与持续经营风险
* 第三方风险
* 业务连续性风险

根据实际资料建立风险摘要，但不自行决定最终准入结论。

输出：

* risk-summary

* risk-level

* data-processing-profile

* system-access-profile

* recommended-controls

* success -> procurement-gate

* fail -> risk-analysis-failed

---

## @gate procurement-gate

根据企业采购政策进行确定性检查。

检查：

* 供应商类型
* 预计采购金额
* 是否需要采购流程
* 是否需要招标或比价
* 是否属于战略供应商
* 是否触发特殊采购政策
* 是否存在禁止合作条件

可能结果：

* pass：符合标准采购流程

* review：需要采购部门人工判断

* fail：不符合采购要求

* pass -> procurement-review

* review -> procurement-review

* fail -> procurement-rejected

---

## @review procurement-review

采购部门审核供应商的商业条件。

审核：

* 商业合理性
* 服务范围
* 采购金额
* 商务条件
* 供应商选择依据
* 是否满足采购政策
* 是否需要额外采购控制

采购审核通过后，进入法务审核。

* approve -> legal-review
* reject -> procurement-rejected

---

## @review legal-review

法务审核供应商合同及法律相关事项。

至少检查：

* 合同主体
* 服务范围
* 责任限制
* 保密义务
* 数据处理条款
* 知识产权
* 终止条款
* 赔偿条款
* 跨境要求
* 适用法律和争议解决

如存在明显法律问题，不得直接进入最终批准。

* approve -> security-gate
* reject -> legal-rejected

---

## @gate security-gate

根据企业信息安全和第三方风险政策进行确定性检查。

检查：

* 是否处理企业敏感数据
* 是否访问内部系统
* 是否需要网络访问
* 是否涉及身份认证
* 是否涉及个人信息
* 是否涉及生产数据
* 是否满足最低安全要求
* 是否需要额外安全控制
* 是否需要安全评估

可能结果：

* pass：满足标准安全要求

* review：需要信息安全部门人工判断

* fail：不满足最低安全要求

* pass -> security-review

* review -> security-review

* fail -> security-rejected

---

## @review security-review

信息安全部门审核供应商的安全风险。

重点确认：

* 数据访问范围
* 系统访问范围
* 安全控制
* 身份认证
* 加密要求
* 日志要求
* 漏洞管理
* 数据保留和删除
* 安全事件通知
* 第三方风险等级

必要时可以提出附加条件，例如：

* 禁止访问生产环境
* 限制数据范围
* 必须使用企业统一身份认证
* 必须启用审计日志
* 必须完成安全整改

审核结果：

* approve：满足安全要求

* reject：安全风险不可接受

* approve -> final-approval

* reject -> security-rejected

---

## @review final-approval

完成最终供应商准入审批。

最终审批人需要综合确认：

* 供应商资料
* 采购审核
* 法务审核
* 信息安全审核
* 风险评估
* 业务用途
* 最终供应商风险等级
* 已提出的控制措施

该节点由服务端确定具体审批人员和审批规则。

最终审批通过后，才能创建供应商主数据。

* approve -> create-supplier
* reject -> onboarding-rejected

---

## @action create-supplier

创建供应商主数据。

该 Action 必须通过注册的供应商管理操作执行。

执行前必须重新验证：

* 所有必需审核均已通过
* 审批没有过期
* 供应商资料版本没有发生变化
* 风险状态没有发生变化
* 法务审核仍然有效
* 信息安全审核仍然有效
* 当前操作对象与最终批准对象一致

创建操作必须使用幂等键，防止重复创建供应商。

执行后记录：

* supplier ID

* 创建时间

* 创建结果

* 使用的数据版本

* 关联审批记录

* 操作主体

* idempotency key

* success -> post-onboarding-check

* fail -> creation-failed

---

## @agent post-onboarding-check

核对供应商主数据是否正确创建。

检查：

* Supplier ID 是否生成
* 供应商名称是否正确
* 供应商类型是否正确
* 风险等级是否正确
* 采购状态是否正确
* 必要字段是否完整
* 审批信息是否正确关联

本步骤只进行核对，不得修改供应商主数据。

* success -> completed
* fail -> post-check-failed

---

## @stop analysis-failed

供应商资料分析无法完成。

流程终止。

必须保留：

* 原始输入
* 分析结果
* 错误信息
* 使用的数据源
* 执行记录

---

## @stop information-insufficient

供应商资料不足，不能继续准入。

需要补充必要资料后重新发起或继续流程。

---

## @stop risk-analysis-failed

供应商风险分析无法完成。

风险评估完成之前不得进入正式审批。

---

## @stop procurement-rejected

采购审核未通过。

供应商不能进入后续准入流程。

---

## @stop legal-rejected

法务审核未通过。

在法律问题解决前，不得完成供应商准入。

---

## @stop security-rejected

供应商不满足企业信息安全要求。

不得绕过安全审核完成供应商注册。

---

## @stop onboarding-rejected

最终供应商准入审批未通过。

不得创建供应商主数据。

---

## @stop creation-failed

供应商主数据创建失败。

必须根据实际状态判断是否可以安全重试，不得在没有幂等控制的情况下重复创建。

---

## @stop post-check-failed

供应商主数据创建结果无法完成核对。

流程进入人工处理状态。

---

## @end completed

供应商已经通过全部必要审核，并成功创建供应商主数据。

流程必须形成完整证据链，包括：

* 谁发起了准入
* 使用了哪些供应商资料
* 哪些 Agent 步骤执行过
* 哪些 Gate 通过
* 谁完成了采购审核
* 谁完成了法务审核
* 谁完成了信息安全审核
* 谁完成了最终批准
* 最终批准基于哪个版本的供应商资料
* 实际创建了什么供应商主数据
* 使用了什么 Action 版本和幂等键
* 最终创建结果

---

# 流程概览

```text id="8tst1n"
start
  │
  ▼
@agent supplier-analysis
  │
  ▼
@gate completeness-check
  │
  ├── fail ────────→ STOP information-insufficient
  │
  ├── review ──────→ @review supplier-information-review
  │                         │
  │                         ├── reject → STOP information-insufficient
  │                         │
  │                         └── approve
  │
  └── pass ───────────────────────┐
                                   │
                                   ▼
                         @agent supplier-risk
                                   │
                                   ▼
                         @gate procurement-gate
                                   │
                       ┌───────────┼────────────┐
                       │           │            │
                      fail       review        pass
                       │           │            │
                       ▼           ▼            │
                   STOP       @review           │
                procurement   procurement        │
                 rejected      review             │
                                  │               │
                       ┌──────────┴───────┐       │
                       │                  │       │
                     reject            approve    │
                       │                  │       │
                       ▼                  └───────┘
                   STOP rejected
                                           │
                                           ▼
                                  @review legal-review
                                           │
                                  ┌────────┴────────┐
                                  │                 │
                                reject            approve
                                  │                 │
                                  ▼                 ▼
                            STOP legal       @gate security-gate
                                                   │
                                      ┌────────────┼────────────┐
                                      │            │            │
                                     fail        review        pass
                                      │            │            │
                                      ▼            ▼            │
                                  STOP         @review          │
                                security       security         │
                                rejected       review           │
                                                   │            │
                                           ┌───────┴──────┐     │
                                           │              │     │
                                         reject         approve │
                                           │              │     │
                                           ▼              └─────┘
                                     STOP rejected
                                                          │
                                                          ▼
                                                 @review final-approval
                                                          │
                                             ┌────────────┴────────────┐
                                             │                         │
                                           reject                    approve
                                             │                         │
                                             ▼                         ▼
                                   STOP onboarding-rejected     @action create-supplier
                                                                        │
                                                            ┌───────────┴───────────┐
                                                            │                       │
                                                          fail                    success
                                                            │                       │
                                                            ▼                       ▼
                                                   STOP creation-failed    @agent post-onboarding-check
                                                                                    │
                                                                         ┌──────────┴──────────┐
                                                                         │                     │
                                                                       fail                  success
                                                                         │                     │
                                                                         ▼                     ▼
                                                               STOP post-check-failed       @end
```
