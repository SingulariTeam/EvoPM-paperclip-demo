import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

const agentId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";

const baseAgent = {
  id: agentId,
  companyId,
  name: "Builder",
  urlKey: "builder",
  role: "engineer",
  title: "Builder",
  icon: null,
  status: "idle",
  reportsTo: null,
  capabilities: null,
  adapterType: "process",
  adapterConfig: {},
  runtimeConfig: {},
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  pauseReason: null,
  pausedAt: null,
  permissions: { canCreateAgents: false },
  lastHeartbeatAt: null,
  metadata: null,
  createdAt: new Date("2026-03-19T00:00:00.000Z"),
  updatedAt: new Date("2026-03-19T00:00:00.000Z"),
};

function makeAgent(
  overrides: Partial<typeof baseAgent> = {},
): typeof baseAgent {
  return {
    ...baseAgent,
    ...overrides,
    permissions: overrides.permissions ?? baseAgent.permissions,
  };
}

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  create: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  terminate: vi.fn(),
  remove: vi.fn(),
  updatePermissions: vi.fn(),
  getChainOfCommand: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
  getMembership: vi.fn(),
  ensureMembership: vi.fn(),
  listPrincipalGrants: vi.fn(),
  setPrincipalPermission: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  listTaskSessions: vi.fn(),
  resetRuntimeSession: vi.fn(),
  cancelActiveForAgent: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(),
  resolveAdapterConfigForRuntime: vi.fn(),
}));

const mockAgentInstructionsService = vi.hoisted(() => ({
  materializeManagedBundle: vi.fn(),
}));
const mockCompanySkillService = vi.hoisted(() => ({
  listRuntimeSkillEntries: vi.fn(),
  resolveRequestedSkillKeys: vi.fn(),
}));
const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => mockAgentInstructionsService,
  accessService: () => mockAccessService,
  approvalService: () => mockApprovalService,
  companySkillService: () => mockCompanySkillService,
  budgetService: () => mockBudgetService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  secretService: () => mockSecretService,
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

function createDbStub() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue([{
            id: companyId,
            name: "Paperclip",
            requireBoardApprovalForNewAgents: false,
          }]),
        }),
      }),
    }),
  };
}

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", agentRoutes(createDbStub() as any));
  app.use(errorHandler);
  return app;
}

describe("agent permission routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockImplementation(async (id: string) => makeAgent({ id }));
    mockAgentService.getChainOfCommand.mockResolvedValue([]);
    mockAgentService.resolveByReference.mockResolvedValue({ ambiguous: false, agent: baseAgent });
    mockAgentService.create.mockResolvedValue(baseAgent);
    mockAgentService.pause.mockResolvedValue({
      ...baseAgent,
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-03-19T01:00:00.000Z"),
    });
    mockAgentService.resume.mockResolvedValue({
      ...baseAgent,
      status: "idle",
      pauseReason: null,
      pausedAt: null,
    });
    mockAgentService.terminate.mockResolvedValue({
      ...baseAgent,
      status: "terminated",
    });
    mockAgentService.remove.mockResolvedValue(baseAgent);
    mockAgentService.updatePermissions.mockResolvedValue(baseAgent);
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockAccessService.getMembership.mockResolvedValue({
      id: "membership-1",
      companyId,
      principalType: "agent",
      principalId: agentId,
      status: "active",
      membershipRole: "member",
      createdAt: new Date("2026-03-19T00:00:00.000Z"),
      updatedAt: new Date("2026-03-19T00:00:00.000Z"),
    });
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
    mockHeartbeatService.cancelActiveForAgent.mockResolvedValue(undefined);
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockImplementation(async (_companyId, requested) => requested);
    mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
    mockAgentInstructionsService.materializeManagedBundle.mockImplementation(
      async (agent: Record<string, unknown>, files: Record<string, string>) => ({
        bundle: null,
        adapterConfig: {
          ...((agent.adapterConfig as Record<string, unknown> | undefined) ?? {}),
          instructionsBundleMode: "managed",
          instructionsRootPath: `/tmp/${String(agent.id)}/instructions`,
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: `/tmp/${String(agent.id)}/instructions/AGENTS.md`,
          promptTemplate: files["AGENTS.md"] ?? "",
        },
      }),
    );
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockImplementation(
      async (_companyId: string, requested: string[]) => requested,
    );
    mockSecretService.normalizeAdapterConfigForPersistence.mockImplementation(async (_companyId, config) => config);
    mockSecretService.resolveAdapterConfigForRuntime.mockImplementation(async (_companyId, config) => ({ config }));
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("grants tasks:assign by default when board creates a new agent", async () => {
    const app = createApp({
      type: "board",
      userId: "board-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: [companyId],
    });

    const res = await request(app)
      .post(`/api/companies/${companyId}/agents`)
      .send({
        name: "Builder",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
      });

    expect(res.status).toBe(201);
    expect(mockAccessService.ensureMembership).toHaveBeenCalledWith(
      companyId,
      "agent",
      agentId,
      "member",
      "active",
    );
    expect(mockAccessService.setPrincipalPermission).toHaveBeenCalledWith(
      companyId,
      "agent",
      agentId,
      "tasks:assign",
      true,
      "board-user",
    );
  });

  it("exposes explicit task assignment access on agent detail", async () => {
    mockAccessService.listPrincipalGrants.mockResolvedValue([
      {
        id: "grant-1",
        companyId,
        principalType: "agent",
        principalId: agentId,
        permissionKey: "tasks:assign",
        scope: null,
        grantedByUserId: "board-user",
        createdAt: new Date("2026-03-19T00:00:00.000Z"),
        updatedAt: new Date("2026-03-19T00:00:00.000Z"),
      },
    ]);

    const app = createApp({
      type: "board",
      userId: "board-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: [companyId],
    });

    const res = await request(app).get(`/api/agents/${agentId}`);

    expect(res.status).toBe(200);
    expect(res.body.access.canAssignTasks).toBe(true);
    expect(res.body.access.taskAssignSource).toBe("explicit_grant");
  });

  it("keeps task assignment enabled when agent creation privilege is enabled", async () => {
    mockAgentService.updatePermissions.mockResolvedValue({
      ...baseAgent,
      permissions: { canCreateAgents: true },
    });

    const app = createApp({
      type: "board",
      userId: "board-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: [companyId],
    });

    const res = await request(app)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: true, canAssignTasks: false });

    expect(res.status).toBe(200);
    expect(mockAccessService.setPrincipalPermission).toHaveBeenCalledWith(
      companyId,
      "agent",
      agentId,
      "tasks:assign",
      true,
      "board-user",
    );
    expect(res.body.access.canAssignTasks).toBe(true);
    expect(res.body.access.taskAssignSource).toBe("agent_creator");
  });

  it("allows CEO agents to manage permissions", async () => {
    const ceoAgentId = "33333333-3333-4333-8333-333333333333";
    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === ceoAgentId) {
        return makeAgent({
          id,
          role: "ceo",
          permissions: { canCreateAgents: false },
        });
      }
      return makeAgent({ id });
    });

    const app = createApp({
      type: "agent",
      agentId: ceoAgentId,
      companyId,
      source: "agent_key",
    });

    const res = await request(app)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: true, canAssignTasks: true });

    expect(res.status).toBe(200);
    expect(mockAgentService.updatePermissions).toHaveBeenCalledWith(agentId, {
      canCreateAgents: true,
      canAssignTasks: true,
    });
  });

  it("allows agent creators to manage permissions", async () => {
    const creatorAgentId = "44444444-4444-4444-8444-444444444444";
    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === creatorAgentId) {
        return makeAgent({
          id,
          permissions: { canCreateAgents: true },
        });
      }
      return makeAgent({ id });
    });

    const app = createApp({
      type: "agent",
      agentId: creatorAgentId,
      companyId,
      source: "agent_key",
    });

    const res = await request(app)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: true, canAssignTasks: true });

    expect(res.status).toBe(200);
    expect(mockAccessService.hasPermission).toHaveBeenCalledWith(
      companyId,
      "agent",
      creatorAgentId,
      "agents:create",
    );
  });

  it("allows agents with explicit agents:create grants to manage permissions", async () => {
    const grantedAgentId = "55555555-5555-4555-8555-555555555555";
    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === grantedAgentId) {
        return makeAgent({
          id,
          permissions: { canCreateAgents: false },
        });
      }
      return makeAgent({ id });
    });
    mockAccessService.hasPermission.mockImplementation(
      async (requestedCompanyId: string, principalType: string, principalId: string, permissionKey: string) =>
        requestedCompanyId === companyId
        && principalType === "agent"
        && principalId === grantedAgentId
        && permissionKey === "agents:create",
    );

    const app = createApp({
      type: "agent",
      agentId: grantedAgentId,
      companyId,
      source: "agent_key",
    });

    const res = await request(app)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: false, canAssignTasks: true });

    expect(res.status).toBe(200);
    expect(mockAccessService.hasPermission).toHaveBeenCalledWith(
      companyId,
      "agent",
      grantedAgentId,
      "agents:create",
    );
  });

  it("rejects agents without team structure privileges", async () => {
    const actorAgentId = "66666666-6666-4666-8666-666666666666";
    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === actorAgentId) {
        return makeAgent({
          id,
          permissions: { canCreateAgents: false },
        });
      }
      return makeAgent({ id });
    });

    const app = createApp({
      type: "agent",
      agentId: actorAgentId,
      companyId,
      source: "agent_key",
    });

    const res = await request(app)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: true, canAssignTasks: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("team structure management");
    expect(mockAgentService.updatePermissions).not.toHaveBeenCalled();
  });

  it("allows agent creators to pause, resume, terminate, and delete agents", async () => {
    const creatorAgentId = "77777777-7777-4777-8777-777777777777";
    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === creatorAgentId) {
        return makeAgent({
          id,
          permissions: { canCreateAgents: true },
        });
      }
      return makeAgent({ id });
    });

    const app = createApp({
      type: "agent",
      agentId: creatorAgentId,
      companyId,
      source: "agent_key",
    });

    const pauseRes = await request(app).post(`/api/agents/${agentId}/pause`);
    const resumeRes = await request(app).post(`/api/agents/${agentId}/resume`);
    const terminateRes = await request(app).post(`/api/agents/${agentId}/terminate`);
    const deleteRes = await request(app).delete(`/api/agents/${agentId}`);

    expect(pauseRes.status).toBe(200);
    expect(resumeRes.status).toBe(200);
    expect(terminateRes.status).toBe(200);
    expect(deleteRes.status).toBe(200);
    expect(mockAgentService.pause).toHaveBeenCalledWith(agentId);
    expect(mockAgentService.resume).toHaveBeenCalledWith(agentId);
    expect(mockAgentService.terminate).toHaveBeenCalledWith(agentId);
    expect(mockAgentService.remove).toHaveBeenCalledWith(agentId);
    expect(mockHeartbeatService.cancelActiveForAgent).toHaveBeenCalledWith(agentId);
  });

  it("allows agents with explicit grants to execute lifecycle routes", async () => {
    const grantedAgentId = "88888888-8888-4888-8888-888888888888";
    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === grantedAgentId) {
        return makeAgent({
          id,
          permissions: { canCreateAgents: false },
        });
      }
      return makeAgent({ id });
    });
    mockAccessService.hasPermission.mockImplementation(
      async (requestedCompanyId: string, principalType: string, principalId: string, permissionKey: string) =>
        requestedCompanyId === companyId
        && principalType === "agent"
        && principalId === grantedAgentId
        && permissionKey === "agents:create",
    );

    const app = createApp({
      type: "agent",
      agentId: grantedAgentId,
      companyId,
      source: "agent_key",
    });

    const res = await request(app).post(`/api/agents/${agentId}/terminate`);

    expect(res.status).toBe(200);
    expect(mockAgentService.terminate).toHaveBeenCalledWith(agentId);
    expect(mockAccessService.hasPermission).toHaveBeenCalledWith(
      companyId,
      "agent",
      grantedAgentId,
      "agents:create",
    );
  });

  it("rejects lifecycle routes for agents without team structure privileges", async () => {
    const actorAgentId = "99999999-9999-4999-8999-999999999999";
    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === actorAgentId) {
        return makeAgent({
          id,
          permissions: { canCreateAgents: false },
        });
      }
      return makeAgent({ id });
    });

    const app = createApp({
      type: "agent",
      agentId: actorAgentId,
      companyId,
      source: "agent_key",
    });

    const res = await request(app).delete(`/api/agents/${agentId}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("team structure management");
    expect(mockAgentService.remove).not.toHaveBeenCalled();
  });
});
