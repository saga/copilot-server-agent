import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { serviceErrorStatus } from '../src/middleware/error-status.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { sendServiceError } from '../src/routes/shared.js';

/**
 * 错误消息 → HTTP 状态码的**全量清单**。
 *
 * 回归背景（三处，同源）：错误分类靠消息文案，只要文案没被某个分支覆盖就会静默变 500。
 *   1. 权限判定曾用 `/无权访问/` 精确匹配，而"能不能写"抛的是「无权发消息到 session」
 *      （PERMISSION_LABEL.send='发消息到'）→ observer 被拒反而 500。
 *   2. 「不能添加参与人」「已存在且归属不同」「已经...无需添加」「未轮到该角色」这类
 *      **业务规则**错误不在任何分支里 → 用户把请求写错了却显示成服务端炸了。
 *   3. 反向风险：判据一旦放宽到「未」这种单字，会把 `未注入（wiring 缺失）`
 *      这类**服务端装配错误**吞成 400，"服务端炸了"就被伪装成"用户传错了"。
 *
 * 所以本表逐条覆盖真实抛错文案，并同时验两条路径（路由内 sendServiceError / 兜底
 * errorHandler）给出同一个状态码。**新增抛错文案必须补进这张表**，
 * 否则会退回成 500（或 400）而不被察觉。
 */

/** 权限拒绝：一律以「无权」开头 */
const PERMISSION_DENIED = [
  '无权访问 session："s1"（无归属记录）',
  '无权访问 session："s1"（归属 t1/alice）',
  '无权访问 session："s1"（不是该共享会话的 active 参与人）',
  '无权发消息到 session："s1"（当前会话角色 observer）',
  '无权管理成员 session："s1"（当前会话角色 member）',
  '无权删除 session："s1"（当前会话角色 observer）',
  '无权访问 human task："t1"',
  '无权操作 human task："t1"（不在 eligible 范围内）',
  '无权审批：需要角色 approver，当前 member',
];

const NOT_FOUND = [
  'session 不存在："s1"',
  'session 不存在（无法恢复）："s1"。磁盘上没有可恢复的记录',
  'session 不存在（无法删除）："s1"',
  'execution 不存在："e1"',
  'human task 不存在："t1"',
  'agent="reviewer" 不存在，可选：default；请先在 agents/customAgents 中定义',
  '技能目录不存在：/tmp/x（解析为 /tmp/x）',
  'execution "e1" 的来源消息不存在：m1',
];

const CLIENT_ERROR = [
  // 参数校验
  'sessionId 非法："x"（须字母数字开头，仅含字母/数字/-/_，最长 128 字符）',
  'userId 不能为空',
  'toUserId 不能为空',
  '消息内容不能为空',
  'role 必须是 member 或 observer（owner 唯一，不可新增）',
  '缺少必填字段：amount',
  '字段 amount 必须是数字',
  '字段 approved 必须是布尔',
  '字段 level 必须是 high/low',
  '字段 note 必须是字符串',
  // 业务规则：操作与当前状态不符
  '会话 "s1" 是 single 模式，不能添加参与人（会话模式创建后不可修改）',
  '会话 "s1" 是 single 模式，没有可退出的成员资格',
  '不能移除会话 owner（需要删除会话或转移归属）',
  'owner 不能退出自己的会话（需要删除会话或转移归属）',
  '"bob" 已经是该会话的 owner，无需添加',
  '该用户不是本会话的参与人："bob"',
  'Separation of Duties：发起人不能审批自己发起的 action',
  '顺序审批未轮到该角色：当前等待 risk',
  // 状态冲突
  'session 已存在："s1"',
  'session 已存在且归属不同："s1"（归属 t1/alice）',
  'session 已存在且模式不同："s1"（single → shared）；会话模式创建后不可修改',
  '已投票，不能重复审批：alice',
  'human task 已关闭（approved）',
  'human task 已过期',
  '该任务不是审批任务',
  '该任务不是输入任务',
  '可信身份模式下，input human task 必须指定 eligibleRoles 或 eligibleUsers',
  // 配置写错
  '未知 MCP 预设：foo，可选：github',
  'COPILOT_MCP_SERVERS 解析失败：must be a JSON object',
  '内联 http MCP "m" 缺少 url',
  '内联 local MCP "m" 被拒绝：在服务器执行任意命令风险高',
  'MCP http url 非法：not-a-url',
  'MCP http url 协议被拒绝：ftp:（仅允许 http/https）',
  'MCP http url 指向内网/保留地址被拒绝：127.0.0.1',
  'MCP http 域名解析失败：nope.invalid',
  'MCP http 域名解析到内网地址被拒绝：x → 10.0.0.1',
  '技能目录被拒绝："/etc" 不在 COPILOT_SKILL_ROOTS allowlist 中',
  'COPILOT_LOG_LEVEL 非法："loud"，可选：none | error | warning | info | debug | all',
  'DATABASE_URL 非法：必须以 postgres:// 或 postgresql:// 开头（留空=用 SQLite）',
];

/**
 * 服务端自身故障：必须留 500。
 * 这些文案里带「未」「没有」，正好是放宽判据时最容易被误吞的一类。
 */
const INTERNAL_ERROR = [
  'execution 写入通道尚未装配：请在 wiring 里调用 bindExecutionSink(executionService)',
  'ActionService 未注入（wiring 缺失）',
  'HumanTaskService 未注入（wiring 缺失）',
  'fetch failed',
  'socket hang up',
  'ECONNREFUSED 127.0.0.1:4321',
  "Cannot read properties of undefined (reading 'content')",
];

function fakeRes(): { res: Response; status: () => number | undefined; body: () => unknown } {
  let statusCode: number | undefined;
  let payload: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      payload = body;
      return res;
    },
  };
  return {
    res: res as unknown as Response,
    status: () => statusCode,
    body: () => payload,
  };
}

function fakeNext(): { next: NextFunction; called: () => boolean } {
  let hit = false;
  const next = (() => {
    hit = true;
  }) as unknown as NextFunction;
  return { next, called: () => hit };
}

test('分类器：403 / 404 / 400 / 未识别（→500）四档互不串味', () => {
  for (const message of PERMISSION_DENIED) {
    assert.equal(serviceErrorStatus(message), 403, `应 403：${message}`);
  }
  for (const message of NOT_FOUND) {
    assert.equal(serviceErrorStatus(message), 404, `应 404：${message}`);
  }
  for (const message of CLIENT_ERROR) {
    assert.equal(serviceErrorStatus(message), 400, `应 400：${message}`);
  }
  for (const message of INTERNAL_ERROR) {
    assert.equal(serviceErrorStatus(message), undefined, `不该被识别（留给 500）：${message}`);
  }
});

test('路由内 sendServiceError 与兜底 errorHandler 对同一文案给出同一状态码', () => {
  const table: Array<[string[], number]> = [
    [PERMISSION_DENIED, 403],
    [NOT_FOUND, 404],
    [CLIENT_ERROR, 400],
  ];
  for (const [messages, expected] of table) {
    for (const message of messages) {
      // 路由内：直接定状态，不落 next
      const viaRoute = fakeRes();
      const routeNext = fakeNext();
      sendServiceError(viaRoute.res, new Error(message), routeNext.next);
      assert.equal(viaRoute.status(), expected, `sendServiceError 应 ${expected}：${message}`);
      assert.equal(routeNext.called(), false, `不该落到 next：${message}`);

      // 兜底：同样给这个状态（覆盖漏网走到 next(err) 的情况）
      const viaHandler = fakeRes();
      errorHandler(new Error(message), {} as Request, viaHandler.res, fakeNext().next);
      assert.equal(viaHandler.status(), expected, `errorHandler 应 ${expected}：${message}`);
    }
  }
});

test('未识别的错误不伪装成 4xx：路由交给 next，兜底给 500', () => {
  for (const message of INTERNAL_ERROR) {
    const viaRoute = fakeRes();
    const routeNext = fakeNext();
    sendServiceError(viaRoute.res, new Error(message), routeNext.next);
    assert.equal(routeNext.called(), true, `应交给 next：${message}`);
    assert.equal(viaRoute.status(), undefined, `不该由路由定状态：${message}`);

    const viaHandler = fakeRes();
    errorHandler(new Error(message), {} as Request, viaHandler.res, fakeNext().next);
    assert.equal(viaHandler.status(), 500, `应 500：${message}`);
  }
});

test('参数校验失败（ZodError）→ 400 + details（优先于文案分类）', () => {
  const parsed = z.object({ prompt: z.string().min(1, 'prompt 不能为空') }).safeParse({});
  assert.equal(parsed.success, false);
  if (parsed.success) return;

  const viaHandler = fakeRes();
  errorHandler(parsed.error, {} as Request, viaHandler.res, fakeNext().next);
  assert.equal(viaHandler.status(), 400);
  const body = viaHandler.body() as { error: string; details: string[] };
  assert.equal(body.error, 'invalid request');
  assert.ok(Array.isArray(body.details) && body.details.length > 0);
  assert.match(body.details[0], /prompt/);
});
