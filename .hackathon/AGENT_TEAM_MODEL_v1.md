# Agent Team 统一数据模型 v1

> 设计日期：2026-03-28
> 状态：初稿，待迭代

---

## 设计原则

### P1: Graph-Native（图原生）
Team 本质上是一个**有向图**：节点是 Agent，边是 Relation。CrewAI 的扁平列表是退化图（无边），Edict 的状态机是隐式图（边是状态转移），Paperclip 的树是受限图（单父节点）。统一模型必须以图为基础，让这三种拓扑都成为自然的特例。

### P2: Structure ≠ Runtime（结构与运行时分离）
Team 的**结构定义**（谁在队里、谁向谁汇报）和**运行时状态**（谁在忙、任务到哪了）必须严格分离。结构是可序列化、可版本化的蓝图；运行时是瞬态、可重建的。三个 Runtime 混淆这两者是导致问题的主要原因。

### P3: Mutation-as-First-Class（结构变更是一等公民）
"修改 Team 结构"不应是 hack 或绕过——它应该是一个**有类型、有权限、有审计**的正式操作。这是三个 Runtime 最大的共同缺口。

### P4: Capability-Based Permission（基于能力的权限）
不采用粗粒度的 RBAC（如 Paperclip 的 `agents:create` = 全能），而是每个结构变更操作对应独立的 Capability，可以精细授予。

### P5: Composable（可组合）
Team 应该能嵌套——一个 Team 的成员可以是另一个 Team（子团队）。CrewAI 的 Flow 和 Edict 的多省架构都暗示了这种需求。

### P6: Topology-Agnostic Process（拓扑无关的流程编排）
流程编排（sequential, hierarchical, state-machine, event-driven）应该是 Team 上的**策略配置**，而不是硬编码在结构中。同一个 Team 结构应该能适配不同的编排策略。

---

## 核心数据模型

### 1. Agent（节点）

```typescript
interface Agent {
  // === 身份 ===
  id: string;                          // 全局唯一标识（UUID）
  name: string;                        // 显示名称
  role: string;                        // 角色标识（如 "engineer", "reviewer", "shangshu"）
  description?: string;                // 角色描述 / backstory

  // === 能力 ===
  capabilities: AgentCapability[];     // 此 Agent 拥有的能力列表
  tools: ToolRef[];                    // 可用工具引用
  model?: ModelConfig;                 // LLM 配置

  // === Team 权限 ===
  teamPermissions: TeamPermission[];   // 对所在 Team 结构的操作权限

  // === 配置 ===
  config: Record<string, unknown>;     // 扩展配置（adapter, runtime 等）
  metadata?: Record<string, unknown>;  // 自由元数据
}
```

### 2. Relation（边）

```typescript
interface Relation {
  id: string;
  source: string;                      // 源 Agent ID
  target: string;                      // 目标 Agent ID
  type: RelationType;                  // 关系类型
  metadata?: Record<string, unknown>;  // 关系附加数据
}

enum RelationType {
  // 层级关系
  REPORTS_TO = "reports_to",           // target 是 source 的上级（Paperclip 模式）
  MANAGES = "manages",                 // source 管理 target（CrewAI hierarchical）

  // 协作关系
  DELEGATES_TO = "delegates_to",       // 可以委派任务给 target（CrewAI delegation）
  COMMUNICATES = "communicates",       // 可以直接通信

  // 流程关系
  ROUTES_TO = "routes_to",            // 状态流转路由（Edict 模式）
  REVIEWS = "reviews",                // 审核关系（Edict 门下省模式）

  // 组合关系
  CONTAINS = "contains",              // 子团队包含关系
}
```

### 3. Team（图容器）

```typescript
interface Team {
  // === 身份 ===
  id: string;
  name: string;
  description?: string;

  // === 结构（图） ===
  members: TeamMember[];               // 成员列表（Agent 引用 + 团队内角色）
  relations: Relation[];               // 成员间关系（有向边）

  // === 编排策略 ===
  process: ProcessConfig;              // 流程编排配置

  // === 约束 ===
  constraints: TeamConstraint[];       // 结构约束规则

  // === 变更策略 ===
  mutationPolicy: MutationPolicy;     // 谁可以修改、如何修改

  // === 元数据 ===
  version: number;                     // 结构版本号（每次变更 +1）
  metadata?: Record<string, unknown>;
}

interface TeamMember {
  agentId: string;                     // Agent 引用
  teamRole?: string;                   // 在此 Team 中的角色（可能与 Agent.role 不同）
  joinedAt: string;                    // 加入时间
}
```

### 4. ProcessConfig（编排策略）

```typescript
interface ProcessConfig {
  type: ProcessType;
  config: Record<string, unknown>;     // 类型特定配置
}

enum ProcessType {
  SEQUENTIAL = "sequential",           // 顺序执行（CrewAI sequential）
  HIERARCHICAL = "hierarchical",       // 层级指挥（CrewAI hierarchical, Paperclip tree）
  STATE_MACHINE = "state_machine",     // 状态机驱动（Edict 模式）
  EVENT_DRIVEN = "event_driven",       // 事件驱动（Edict Redis Streams / CrewAI Flow）
  GRAPH = "graph",                     // 通用 DAG 编排
}

// 示例：状态机配置
interface StateMachineConfig {
  states: string[];
  transitions: {
    from: string;
    to: string;
    trigger: string;
    assignTo?: string;                 // Agent ID 或 role
  }[];
  initialState: string;
  terminalStates: string[];
}

// 示例：层级配置
interface HierarchicalConfig {
  rootAgent: string;                   // 根节点 Agent ID（manager / CEO）
  delegationDepth?: number;            // 最大委派深度
}
```

### 5. TeamPermission（团队权限）

```typescript
interface TeamPermission {
  capability: TeamCapability;          // 能力类型
  scope: PermissionScope;             // 作用范围
  conditions?: PermissionCondition[]; // 附加条件
}

enum TeamCapability {
  // 成员管理
  MEMBER_ADD = "member:add",           // 添加成员
  MEMBER_REMOVE = "member:remove",     // 移除成员
  MEMBER_UPDATE = "member:update",     // 修改成员属性

  // 关系管理
  RELATION_ADD = "relation:add",       // 添加关系
  RELATION_REMOVE = "relation:remove", // 移除关系
  RELATION_UPDATE = "relation:update", // 修改关系

  // 结构管理
  PROCESS_UPDATE = "process:update",   // 修改编排策略
  CONSTRAINT_UPDATE = "constraint:update",
  POLICY_UPDATE = "policy:update",     // 修改变更策略（最高权限）

  // 任务管理
  TASK_ASSIGN = "task:assign",         // 分配任务
  TASK_DELEGATE = "task:delegate",     // 委派任务
  TASK_REVIEW = "task:review",         // 审核任务
}

interface PermissionScope {
  type: "all" | "subtree" | "specific";
  targets?: string[];                  // specific 模式下的目标 Agent IDs
  subtreeRoot?: string;                // subtree 模式下的子树根节点
}

interface PermissionCondition {
  type: "approval_required" | "max_count" | "role_match" | "custom";
  config: Record<string, unknown>;
}
```

### 6. TeamMutation（结构变更操作）

```typescript
interface TeamMutation {
  id: string;
  teamId: string;
  type: MutationType;
  payload: MutationPayload;
  initiator: string;                   // 发起变更的 Agent ID
  status: "pending" | "approved" | "applied" | "rejected" | "rolled_back";
  approvals?: Approval[];              // 审批记录
  appliedAt?: string;
  resultingVersion?: number;           // 变更后的 Team 版本号
}

enum MutationType {
  ADD_MEMBER = "add_member",
  REMOVE_MEMBER = "remove_member",
  UPDATE_MEMBER = "update_member",
  ADD_RELATION = "add_relation",
  REMOVE_RELATION = "remove_relation",
  UPDATE_RELATION = "update_relation",
  UPDATE_PROCESS = "update_process",
  BATCH = "batch",                     // 批量变更（原子操作）
}

// 联合类型 payload 示例
type MutationPayload =
  | { agentId: string; teamRole?: string }                      // ADD_MEMBER
  | { agentId: string; reassignTo?: string }                    // REMOVE_MEMBER
  | { relation: Relation }                                      // ADD_RELATION
  | { mutations: TeamMutation[] }                               // BATCH
  // ...
```

### 7. TeamConstraint（结构约束）

```typescript
interface TeamConstraint {
  type: ConstraintType;
  config: Record<string, unknown>;
  enforceOn: "mutation" | "validation" | "both";
}

enum ConstraintType {
  // 拓扑约束
  NO_CYCLES = "no_cycles",                    // 禁止循环引用（Paperclip 的 assertNoCycle）
  SINGLE_ROOT = "single_root",                // 必须有且仅有一个根节点
  MAX_DEPTH = "max_depth",                    // 最大层级深度
  MAX_MEMBERS = "max_members",                // 最大成员数

  // 角色约束
  REQUIRED_ROLES = "required_roles",          // 必须包含某些角色
  UNIQUE_ROLES = "unique_roles",              // 某些角色只能有一个

  // 流程约束
  ALL_TASKS_ASSIGNED = "all_tasks_assigned",  // 每个任务必须有 Agent（CrewAI sequential 验证）
  NO_ORPHAN_AGENTS = "no_orphan_agents",      // 所有 Agent 必须可达
}
```

---

## 三个 Runtime 到统一模型的映射

### CrewAI → 统一模型

```
Crew                    → Team
Crew.agents             → Team.members
Crew.tasks              → 独立 Task 模型，通过 ProcessConfig 编排
Crew.process            → Team.process (SEQUENTIAL | HIERARCHICAL)
Crew.manager_agent      → HierarchicalConfig.rootAgent + Relation(MANAGES)
Agent.allow_delegation  → TeamPermission(TASK_DELEGATE)
Task.context            → Task 间的依赖关系（可映射为 Relation 或独立 DAG）
```

### Edict → 统一模型

```
agents.json             → Team.members + Team.relations
allowAgents             → TeamPermission(TASK_DELEGATE, scope=specific)
AGENT_META              → Agent.name + Agent.role + Agent.metadata
STATE_AGENT_MAP         → ProcessConfig(STATE_MACHINE) + transitions
ORG_AGENT_MAP           → Relation(ROUTES_TO)
Orchestrator            → ProcessConfig 的 runtime executor
Redis event bus         → 运行时通信层（不在结构模型中）
```

### Paperclip → 统一模型

```
agents table            → Team.members（每行一个 Agent）
reportsTo               → Relation(REPORTS_TO)
orgForCompany()         → Team 运行时视图构建
permissions.canCreate   → TeamPermission(MEMBER_ADD)
AgentConfigRevision     → TeamMutation（审计日志）
chainOfCommand          → 运行时计算（沿 REPORTS_TO 边向上遍历）
```

---

## 整体结构关系图

```
┌───────────────────────────────────────────────────────────────────┐
│                           Team                                    │
│  id, name, version                                                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ members: TeamMember[]                                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│  │  │ Agent A  │  │ Agent B  │  │ Agent C  │  │ SubTeam X│   │  │
│  │  │ role     │  │ role     │  │ role     │  │ (Team)   │   │  │
│  │  │ tools    │  │ tools    │  │ tools    │  │          │   │  │
│  │  │ perms    │  │ perms    │  │ perms    │  │          │   │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────┘   │  │
│  └───────┼──────────────┼──────────────┼───────────────────────┘  │
│          │              │              │                           │
│  ┌───────┴──────────────┴──────────────┴───────────────────────┐  │
│  │ relations: Relation[]                                       │  │
│  │                                                             │  │
│  │  A ──MANAGES──→ B        (层级)                             │  │
│  │  A ──DELEGATES_TO──→ C   (委派)                             │  │
│  │  B ──ROUTES_TO──→ C      (流转)                             │  │
│  │  A ──REVIEWS──→ B        (审核)                             │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ ProcessConfig   │  │ MutationPolicy   │  │ Constraints     │  │
│  │ type: HIERARCHI │  │ requireApproval  │  │ NO_CYCLES       │  │
│  │ rootAgent: A    │  │ auditLog: true   │  │ SINGLE_ROOT     │  │
│  └─────────────────┘  └──────────────────┘  └─────────────────┘  │
└───────────────────────────────────────────────────────────────────┘

                    │ TeamMutation (变更操作)
                    ▼
        ┌───────────────────────┐
        │ id, type, payload     │
        │ initiator: Agent B    │
        │ status: approved      │
        │ resultingVersion: 3   │
        └───────────────────────┘
```

---

## 设计决策说明

### 为什么用 Graph 而不是 List / Tree？

| 模型 | CrewAI 的扁平列表 | Edict 的状态路由 | Paperclip 的树 | 混合拓扑 |
|------|:--:|:--:|:--:|:--:|
| List | ✅ | ❌ | ❌ | ❌ |
| Tree | ❌ | ❌ | ✅ | ❌ |
| Graph | ✅（零边图）| ✅（路由边）| ✅（单父约束图）| ✅ |

Graph 是唯一能自然表达所有三种拓扑的数据结构。通过 `TeamConstraint` 可以将 Graph 约束为 Tree（`NO_CYCLES` + `SINGLE_ROOT`）或 List（零边）。

### 为什么 Relation 是独立实体而不是嵌入 Agent？

- **多类型关系**：同一对 Agent 间可能有多种关系（A 既管理 B，又审核 B）
- **关系自身有元数据**：如权重、条件、有效期
- **便于变更追踪**：添加/删除关系是独立的 Mutation 操作
- **避免 Paperclip 的教训**：`reportsTo` 嵌入 Agent 导致只能表达单一层级关系

### 为什么 TeamPermission 是 Capability-based 而不是 Role-based？

Paperclip 的教训：`agents:create` 一个权限 = 能修改整个组织结构。能力细分为 `member:add`, `member:remove`, `relation:add` 等，可以精确控制"Agent A 可以给自己的子树添加成员，但不能修改其他分支"。

---

## 下一步待讨论

1. **Task 模型**：是作为 Team 的一部分（CrewAI 做法），还是独立于 Team 结构（Edict/Paperclip 做法）？
2. **运行时状态**：Agent 状态（idle/running/paused）、心跳、通信通道如何建模？
3. **变更冲突**：并发 Mutation 如何处理？乐观锁（version）还是 CRDT？
4. **序列化格式**：JSON Schema？Protobuf？Pydantic BaseModel？
5. **Team 嵌套的深度**：SubTeam 是独立 Team 引用还是内联？
