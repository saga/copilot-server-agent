import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { sessionService } from '../services/session-service.js';
import { concurrencyState } from '../services/concurrency.js';
import { stateBackend } from '../execution/index.js';
import { listProviderStatus } from '../providers/index.js';
import {
  listMcp,
  getMcpServerConfig,
  testMcpServer,
  assertSafeOutboundUrl,
} from '../mcp/registry.js';
import { listHooks } from '../hooks/registry.js';
import { requireAdmin, mcpServerSchema, normalizeInlineMcp } from './shared.js';

export const metaRouter = Router();

/** GET /api/providers — 通道列表与当前生效项 */
metaRouter.get('/providers', (_req, res) => {
  res.json({ providers: listProviderStatus() });
});

/** GET /api/models — 前端模型选择器用 */
metaRouter.get('/models', async (_req, res, next) => {
  try {
    res.json(await sessionService.listModels());
  } catch (err) {
    next(err);
  }
});

/** GET /api/agents — agent 预设、技能目录与可发现的技能 */
metaRouter.get('/agents', (_req, res) => {
  res.json(sessionService.listAgents());
});

/** GET /api/mcp — MCP 预设与内联开关（只含元信息，密钥字段永不返回） */
metaRouter.get('/mcp', (_req, res) => {
  res.json(listMcp());
});

const mcpTestSchema = z
  .object({
    name: z.string().optional(),
    server: mcpServerSchema.optional(),
  })
  .refine((v) => (v.name ? !v.server : !!v.server), {
    message: 'name 与 server 二选一、必传其一',
  });

/** POST /api/mcp/test — MCP 连通性自检（不建会话、不执行命令） */
metaRouter.post('/mcp/test', async (req, res, next) => {
  try {
    const body = mcpTestSchema.parse(req.body ?? {});
    if (body.name) {
      const cfg = getMcpServerConfig(body.name);
      return res.json({ name: body.name, ...(await testMcpServer(cfg)) });
    }
    const serverCfg = body.server;
    if (!serverCfg) return res.status(400).json({ error: 'server 与 name 必传其一' });
    const cfg = normalizeInlineMcp({ tmp: serverCfg })?.tmp;
    if (!cfg) return res.status(400).json({ error: 'server 解析失败' });
    const t = cfg.type ?? 'local';
    if ((t === 'local' || t === 'stdio') && !config.allowInlineMcpLocal) {
      return res.status(400).json({
        error:
          '内联 local MCP 测试被拒绝：在服务器执行任意命令风险高，如确需开放请设 COPILOT_ALLOW_INLINE_MCP_LOCAL=true',
      });
    }
    if ((t === 'http' || t === 'sse') && !config.allowInlineMcpHttp) {
      return res.status(400).json({
        error:
          '内联 http MCP 测试被拒绝：服务端已关闭（生产请用运维预置的 COPILOT_MCP_SERVERS）',
      });
    }
    if ((t === 'http' || t === 'sse') && 'url' in cfg && typeof cfg.url === 'string') {
      try {
        await assertSafeOutboundUrl(cfg.url);
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
      }
    }
    return res.json({ name: null, ...(await testMcpServer(cfg)) });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/hooks — hook 预设与最近 hook 事件（审计） */
metaRouter.get('/hooks', requireAdmin, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));
  res.json(listHooks(limit));
});

/** GET /api/debug — 诊断包（含 durable state 后端与并发状态） */
metaRouter.get('/debug', requireAdmin, async (_req, res, next) => {
  try {
    res.json({
      ...(await sessionService.getDebugInfo()),
      concurrency: concurrencyState(),
      stateBackend,
    });
  } catch (err) {
    next(err);
  }
});
