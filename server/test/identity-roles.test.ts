import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  businessRoleLookup,
  findBusinessRole,
  registerBusinessRole,
  resolveRolesForGroups,
} from '../src/identity/business-roles.js';
import { AuthorizationService } from '../src/identity/authorization-service.js';

/**
 * 业务角色层：`业务角色 → Microsoft Entra / AD group object ID → User`。
 *
 * 这一层要证明三件事：
 *   - 角色到组的映射是**纯映射**（无网络、无 token），组 ID 大小写不敏感
 *   - 没配 group 的角色**谁都拿不到**（fail-closed）—— 漏配一个组不该变成"人人可批"
 *   - 解析结果是"直接声明的业务角色"与"从 group 映射来的角色"的并集
 *
 * 每个用例用独立的角色 id：RoleRegistry 是模块级单例，跨用例注册同名角色会互相污染。
 */

test('RoleRegistry：ANY 命中任一 group 即授予角色', () => {
  registerBusinessRole({
    id: 'test.any',
    name: '测试角色（ANY）',
    groups: ['grp-a', 'grp-b'],
    match: 'ANY',
  });
  assert.deepEqual(resolveRolesForGroups(['grp-b']), ['test.any']);
  assert.deepEqual(resolveRolesForGroups(['grp-a', 'x']), ['test.any']);
  assert.deepEqual(resolveRolesForGroups(['grp-c']), [], '不属于任何映射组 → 不授予');
});

test('RoleRegistry：ALL 必须同时属于全部 group', () => {
  registerBusinessRole({
    id: 'test.all',
    name: '测试角色（ALL）',
    groups: ['grp-1', 'grp-2'],
    match: 'ALL',
  });
  assert.deepEqual(resolveRolesForGroups(['grp-1']), [], '只属于一个 → 不满足 ALL');
  assert.deepEqual(resolveRolesForGroups(['grp-1', 'grp-2']), ['test.all']);
});

test('RoleRegistry：group object ID 大小写不敏感（GUID 常被大写粘贴）', () => {
  registerBusinessRole({
    id: 'test.case',
    name: '测试角色（大小写）',
    groups: ['3A7F1C2E-0000-0000-0000-000000000001'],
    match: 'ANY',
  });
  assert.deepEqual(resolveRolesForGroups(['3a7f1c2e-0000-0000-0000-000000000001']), ['test.case']);
});

test('RoleRegistry：没配 group 的角色谁都拿不到（fail-closed，不是人人可批）', () => {
  registerBusinessRole({ id: 'test.unmapped', name: '测试角色（未映射）', groups: [], match: 'ANY' });
  // 无论用户属于多少组，未映射的角色都不会被授予 —— 漏配一个组不该变成"所有人可批"
  assert.ok(!resolveRolesForGroups(['grp-a', 'grp-b', 'grp-1', 'grp-2']).includes('test.unmapped'));
  // 它仍然是合法的角色 id：SKILL.md 可以引用，只是暂时谁都不具备
  assert.ok(businessRoleLookup.hasRole('test.unmapped'));
});

test('RoleRegistry：match=ALL 但没有 group 是配置错误，直接拒绝登记', () => {
  assert.throws(
    () => registerBusinessRole({ id: 'test.badall', name: 'x', groups: [], match: 'ALL' }),
    /match=ALL 但没有/,
  );
});

test('RoleRegistry：内置角色已登记（流程可以引用它们）', () => {
  assert.ok(businessRoleLookup.hasRole('compliance.reviewer'));
  assert.ok(businessRoleLookup.hasRole('investment.committee.member'));
  assert.equal(businessRoleLookup.hasRole('APP-FIL-Compliance-Reviewer'), false, 'AD 组名不是角色');
  assert.equal(findBusinessRole('COMPLIANCE.REVIEWER')?.id, 'compliance.reviewer', '角色 id 大小写不敏感');
});

test('AuthorizationService：直接声明的业务角色与 group 映射取并集', () => {
  registerBusinessRole({
    id: 'test.union',
    name: '测试角色（并集）',
    groups: ['grp-union'],
    match: 'ANY',
  });
  const authz = new AuthorizationService();
  assert.deepEqual(
    authz.resolveRoles({ roles: ['approver'], groups: ['grp-union'] }),
    ['approver', 'test.union'],
  );
  assert.deepEqual(authz.resolveRoles({ roles: ['APPROVER'], groups: [] }), ['approver'], '归一化小写 + 去重');
  assert.deepEqual(authz.resolveRoles({ roles: [], groups: [] }), []);
  assert.deepEqual(authz.resolveRoles({ roles: [] }), [], '没有 groups 字段也不炸（本地开发/单测）');
});

test('AuthorizationService：缺角色时的报错要指向"该去配什么"', () => {
  const authz = new AuthorizationService();
  assert.throws(
    () => authz.assertRole({ roles: [], groups: ['grp-a'] }, 'compliance.reviewer'),
    /缺少业务角色 "compliance\.reviewer"/,
  );
  assert.throws(
    () => authz.assertRole({ roles: [], groups: ['grp-a'] }, 'compliance.reviewer'),
    /COPILOT_BUSINESS_ROLES/,
    '最常见的失败原因不是"这个人没权限"，而是"角色还没映射到组"，报错要说出来',
  );
  assert.doesNotThrow(() => authz.assertRole({ roles: ['compliance.reviewer'], groups: [] }, 'compliance.reviewer'));
});
