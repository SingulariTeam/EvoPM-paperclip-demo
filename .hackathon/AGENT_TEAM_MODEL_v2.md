# Agent Team 统一数据模型 v2

> 设计日期：2026-03-29
> 设计目标：表示力超集——用一个数据结构无损表示三种（及更多）Runtime 的 Team

---

## 设计原则

### P1: 超集，不是公约数
不求三个 Runtime 都能"理解"这个模型的每个字段，而是确保任何 Runtime 的 Team 结构都能在这个模型中**完整、无损**地表达出来。宁可有冗余字段，不可丢失信息。

### P2: 有向属性图（Directed Property Graph）
三个 Runtime 的 Team 本质都是节点（Agent）和边（关系）的集合，区别在于边的类型和约束。采用有向属性图作为底层结构：节点和边都可以携带任意属性。

### P3: 数据结构，不是框架
不设计执行引擎、适配层、权限运行时。只回答一个问题：**用什么 shape 的数据能把 Team 完整记下来？**

### P4: 类型化核心 + 开放扩展
对三个 Runtime 共有的概念给出明确的类型化字段（id, name, role, edges...），对 Runtime 特有的概念提供 `ext` 扩展点，避免一切信息都塞进 metadata 黑洞。

### P5: 可组合（Composable）
Team 的成员可以是另一个 Team。这既是 CrewAI Flow（多 Crew 编排）的需求，也是 Edict 多省嵌套的需求。通过节点的多态（Agent | Team）实现。

---

## 核心数据结构

### 总览

```
TeamGraph
├── id, name, description
├── nodes: Node[]              ← Agent 或嵌套的 TeamGraph
│   └── Node { id, type, agent?, team?, role_in_team, ext }
├── edges: Edge[]              ← 节点间的有向关系
│   └── Edge { source, target, type, ext }
├── process: ProcessDef        ← 编排方式的数据描述
│   └── ProcessDef { type, steps?, states?, triggers?, ext }
└── ext: Record<string, any>   ← Team 级扩展属性
```

---

### 1. TeamGraph（顶层容器）

```typescript
interface TeamGraph {
  /** 全局唯一标识 */
  id: string;

  /** 团队名称 */
  name: string;

  /** 团队描述 */
  description?: string;

  /** 成员节点——Agent 或嵌套子 Team */
  nodes: Node[];

  /** 节点间的有向关系 */
  edges: Edge[];

  /** 编排流程定义 */
  process?: ProcessDef;

  /** Runtime 特定的团队级扩展 */
  ext?: Record<string, any>;
}
```

**设计说明**：
- `TeamGraph` 本身可以作为另一个 `TeamGraph` 的节点出现（通过 `Node.team`），实现任意深度嵌套。
- `ext` 是逃生舱：Runtime 特有的、无法归类到上述字段的信息放这里。但优先使用类型化字段。

---

### 2. Node（节点：Agent 或子 Team）

```typescript
interface Node {
  /** 节点在本 TeamGraph 内的唯一标识（通常就是 Agent ID） */
  id: string;

  /** 节点类型 */
  type: "agent" | "team";

  /** type="agent" 时的完整 Agent 定义 */
  agent?: AgentDef;

  /** type="team" 时的嵌套 TeamGraph */
  team?: TeamGraph;

  /**
   * 此节点在本 Team 中扮演的角色
   * 同一个 Agent 在不同 Team 中可以有不同角色
   *
   * 例：CrewAI 中同一 Agent 在 Crew A 里是 "researcher"，在 Crew B 里是 "reviewer"
   * 例：Paperclip 中 Agent 的 title 是团队内角色，role 是全局角色
   */
  role_in_team?: string;

  /** 节点级扩展 */
  ext?: Record<string, any>;
}
```

---

### 3. AgentDef（Agent 定义）

```typescript
interface AgentDef {
  /** 全局唯一标识 */
  id: string;

  /** 名称 */
  name: string;

  /** 全局角色标识 */
  role: string;

  /** 角色描述 / 背景故事 / 职责说明 */
  description?: string;

  /** 图标 / emoji */
  icon?: string;

  // ─── 能力配置 ───

  /** 可用工具列表 */
  tools: ToolDef[];

  /** LLM 模型配置 */
  model?: ModelDef;

  /** 知识源 */
  knowledge?: KnowledgeDef[];

  // ─── 行为约束 ───

  /** 最大推理迭代次数 */
  max_iterations?: number;

  /** 可委派任务（对应 CrewAI allow_delegation） */
  can_delegate?: boolean;

  /** 需要人工介入确认 */
  requires_human_input?: boolean;

  // ─── 权限声明 ───

  /**
   * 此 Agent 持有的权限标识列表
   * 开放字符串，不限定枚举——不同 Runtime 的权限体系差异极大
   *
   * 例：Paperclip → ["agents:create", "tasks:assign"]
   * 例：Edict    → ["dispatch:hubu", "dispatch:gongbu"]（从 allowAgents 转换）
   * 例：CrewAI   → ["delegate"]（从 allow_delegation 转换）
   */
  permissions?: string[];

  /** Agent 级扩展 */
  ext?: Record<string, any>;
}
```

**关键设计决策**：

- **`tools` 是 `ToolDef[]` 而非 `string[]`**：三个 Runtime 对工具的描述粒度不同（CrewAI 是完整的 BaseTool 对象，Edict 是 skill 路径，Paperclip 几乎没有）。用结构化定义可以兼容所有粒度。
- **`permissions` 是 `string[]` 而非类型化枚举**：三个 Runtime 的权限模型差异太大（CrewAI 几乎没有，Edict 是白名单，Paperclip 是粗粒度标识）。开放字符串是唯一能兼容所有的选择。
- **`can_delegate` 单独提出来**：因为三个 Runtime 都有某种形式的委派概念，这是最接近"共有"的行为属性。

```typescript
interface ToolDef {
  name: string;
  description?: string;
  /** 工具来源（MCP server、本地函数、外部 API 等） */
  source?: string;
  /** 工具特定配置 */
  config?: Record<string, any>;
}

interface ModelDef {
  /** 模型标识，如 "anthropic/claude-sonnet-4-6" */
  provider_model: string;
  /** 模型参数 */
  params?: Record<string, any>;
}

interface KnowledgeDef {
  name: string;
  type: string;          // "file", "url", "database", "vector_store", ...
  source: string;
  config?: Record<string, any>;
}
```

---

### 4. Edge（有向边：节点间关系）

这是整个模型表示力的关键。v1 的教训是：不应该把 RelationType 做成封闭枚举，因为不同 Runtime 的关系语义千差万别。

```typescript
interface Edge {
  /** 源节点 ID */
  source: string;

  /** 目标节点 ID */
  target: string;

  /**
   * 关系类型——开放字符串，附带推荐的常用值
   *
   * 推荐值（覆盖三个 Runtime 的已知关系）：
   *   "reports_to"     — 层级汇报（Paperclip reportsTo）
   *   "manages"        — 管理下属（CrewAI manager_agent、Paperclip 反向）
   *   "delegates_to"   — 可委派任务（CrewAI delegation、Edict allowAgents）
   *   "routes_to"      — 状态/任务流转路由（Edict STATE_AGENT_MAP）
   *   "reviews"        — 审核关系（Edict 门下省审核）
   *   "contains"       — 子团队包含（组合用）
   *   "depends_on"     — 依赖关系（CrewAI Task.context）
   *   "communicates"   — 通信通道（Edict 事件总线）
   *
   * 也可以是 Runtime 自定义值，如 "edict:state_transition"
   */
  type: string;

  /**
   * 关系权重/优先级（可选）
   * 用于表示偏好路由、优先级等
   */
  weight?: number;

  /**
   * 关系上的条件表达式（可选）
   * 例：Edict 状态转移的触发条件
   * 例：CrewAI Flow 的 @router 条件路由
   */
  condition?: string;

  /** 边级扩展 */
  ext?: Record<string, any>;
}
```

**关键设计决策**：

- **`type` 是开放字符串而非封闭枚举**：这是 v1 最大的修正。CrewAI 的 `manager_agent`、Edict 的 `STATE_AGENT_MAP`、Paperclip 的 `reportsTo` 虽然都是"关系"，但语义差异太大，强行统一到枚举里会丢失精度。开放字符串 + 推荐值是更好的平衡。
- **`condition` 字段**：Edict 的状态转移和 CrewAI 的 Flow router 都有条件逻辑，这需要在边上表达。用字符串（而非类型化的条件对象）保持灵活性。
- **同一对节点可以有多条不同类型的边**：A 可以同时 `manages` B 且 `reviews` B。这是 Paperclip 的 `reportsTo` 单字段表达不了的。

---

### 5. ProcessDef（编排流程定义）

这不是执行引擎——而是**用数据描述 "任务在这个 Team 中如何流转"**。

```typescript
interface ProcessDef {
  /**
   * 编排类型
   *
   * 已知值：
   *   "sequential"     — 按固定顺序逐步执行（CrewAI sequential）
   *   "hierarchical"   — 根节点指挥分发（CrewAI hierarchical, Paperclip tree）
   *   "state_machine"  — 有限状态机驱动（Edict Orchestrator）
   *   "event_driven"   — 事件触发（Edict Redis Streams, CrewAI Flow）
   *   "dag"            — 有向无环图依赖（CrewAI Task.context）
   *
   * 可组合：一个 Team 可以有多种编排叠加（如 Edict 同时是 state_machine + event_driven）
   */
  type: string | string[];

  // ─── 以下字段按 type 选择性使用 ───

  /**
   * 顺序流程的步骤定义
   * 适用于 type="sequential" | "dag"
   */
  steps?: StepDef[];

  /**
   * 状态机定义
   * 适用于 type="state_machine"
   */
  states?: StateDef;

  /**
   * 事件触发器定义
   * 适用于 type="event_driven"
   */
  triggers?: TriggerDef[];

  /**
   * 层级流程的根指挥节点
   * 适用于 type="hierarchical"
   */
  root_agent?: string;

  /** 流程级扩展 */
  ext?: Record<string, any>;
}
```

子类型定义：

```typescript
/** 顺序/DAG 步骤 */
interface StepDef {
  /** 步骤标识 */
  id: string;
  /** 步骤描述（对应 CrewAI Task.description） */
  description: string;
  /** 负责执行的节点 ID */
  assigned_to?: string;
  /** 前置依赖步骤（构成 DAG） */
  depends_on?: string[];
  /** 预期输出描述 */
  expected_output?: string;
  /** 是否异步执行 */
  async?: boolean;
  ext?: Record<string, any>;
}

/** 状态机定义 */
interface StateDef {
  /** 所有状态 */
  states: string[];
  /** 初始状态 */
  initial: string;
  /** 终止状态 */
  terminal: string[];
  /** 转移规则 */
  transitions: TransitionDef[];
}

interface TransitionDef {
  from: string;
  to: string;
  /** 触发条件 */
  trigger?: string;
  /** 转移后负责的节点 ID */
  assigned_to?: string;
}

/** 事件触发器 */
interface TriggerDef {
  /** 事件 topic（如 Edict 的 "task.dispatch"） */
  event: string;
  /** 触发后执行的节点 ID */
  handler: string;
  /** 触发条件 */
  condition?: string;
  ext?: Record<string, any>;
}
```

**关键设计决策**：

- **`type` 可以是数组**：Edict 同时是 `state_machine`（Orchestrator 驱动）和 `event_driven`（Redis Streams 通信），不应强行二选一。
- **`steps` / `states` / `triggers` 是并列可选字段，不是互斥联合体**：同一个 Team 可能同时有 steps（定义任务模板）和 triggers（定义事件响应），这比 `ProcessConfig = StepBased | StateBased | ...` 的联合类型更灵活。
- **StepDef 吸收了 CrewAI Task 的核心字段**：`description`, `assigned_to`, `depends_on`, `expected_output`, `async`——这些是"流程中的一步"的通用属性，不是 CrewAI 特有的。

---

## 完整类型定义汇总

```typescript
// ══════════════════════════════════════
//  Agent Team Graph — v2 完整类型
// ══════════════════════════════════════

interface TeamGraph {
  id: string;
  name: string;
  description?: string;
  nodes: Node[];
  edges: Edge[];
  process?: ProcessDef;
  ext?: Record<string, any>;
}

interface Node {
  id: string;
  type: "agent" | "team";
  agent?: AgentDef;
  team?: TeamGraph;
  role_in_team?: string;
  ext?: Record<string, any>;
}

interface AgentDef {
  id: string;
  name: string;
  role: string;
  description?: string;
  icon?: string;
  tools: ToolDef[];
  model?: ModelDef;
  knowledge?: KnowledgeDef[];
  max_iterations?: number;
  can_delegate?: boolean;
  requires_human_input?: boolean;
  permissions?: string[];
  ext?: Record<string, any>;
}

interface Edge {
  source: string;
  target: string;
  type: string;
  weight?: number;
  condition?: string;
  ext?: Record<string, any>;
}

interface ProcessDef {
  type: string | string[];
  steps?: StepDef[];
  states?: StateDef;
  triggers?: TriggerDef[];
  root_agent?: string;
  ext?: Record<string, any>;
}

interface StepDef {
  id: string;
  description: string;
  assigned_to?: string;
  depends_on?: string[];
  expected_output?: string;
  async?: boolean;
  ext?: Record<string, any>;
}

interface StateDef {
  states: string[];
  initial: string;
  terminal: string[];
  transitions: TransitionDef[];
}

interface TransitionDef {
  from: string;
  to: string;
  trigger?: string;
  assigned_to?: string;
}

interface TriggerDef {
  event: string;
  handler: string;
  condition?: string;
  ext?: Record<string, any>;
}

interface ToolDef {
  name: string;
  description?: string;
  source?: string;
  config?: Record<string, any>;
}

interface ModelDef {
  provider_model: string;
  params?: Record<string, any>;
}

interface KnowledgeDef {
  name: string;
  type: string;
  source: string;
  config?: Record<string, any>;
}
```

---

## 三个 Runtime 的完整映射实例

### 实例 1: CrewAI Crew（Hierarchical 模式）

原始 CrewAI 结构：
- 3 个 Agent：manager, researcher, writer
- 2 个 Task：research_task → write_task（DAG 依赖）
- 层级流程，manager 指挥

```json
{
  "id": "crew-001",
  "name": "Content Creation Crew",
  "nodes": [
    {
      "id": "manager",
      "type": "agent",
      "role_in_team": "manager",
      "agent": {
        "id": "agent-mgr-001",
        "name": "Project Manager",
        "role": "manager",
        "description": "Coordinates the content creation process",
        "tools": [],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" },
        "can_delegate": true,
        "permissions": ["delegate"],
        "ext": {
          "crewai": { "max_rpm": 10, "verbose": true }
        }
      }
    },
    {
      "id": "researcher",
      "type": "agent",
      "role_in_team": "researcher",
      "agent": {
        "id": "agent-res-001",
        "name": "Senior Researcher",
        "role": "researcher",
        "description": "Expert at finding and synthesizing information",
        "tools": [
          { "name": "SerperDevTool", "source": "crewai_tools" },
          { "name": "ScrapeWebsiteTool", "source": "crewai_tools" }
        ],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" },
        "can_delegate": false,
        "max_iterations": 15
      }
    },
    {
      "id": "writer",
      "type": "agent",
      "role_in_team": "writer",
      "agent": {
        "id": "agent-wrt-001",
        "name": "Technical Writer",
        "role": "writer",
        "description": "Skilled at crafting engaging technical content",
        "tools": [],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" },
        "can_delegate": false,
        "requires_human_input": true
      }
    }
  ],
  "edges": [
    { "source": "manager", "target": "researcher", "type": "manages" },
    { "source": "manager", "target": "writer",     "type": "manages" },
    { "source": "manager", "target": "researcher", "type": "delegates_to" },
    { "source": "manager", "target": "writer",     "type": "delegates_to" }
  ],
  "process": {
    "type": ["hierarchical", "dag"],
    "root_agent": "manager",
    "steps": [
      {
        "id": "research_task",
        "description": "Research the latest trends in AI",
        "assigned_to": "researcher",
        "expected_output": "A comprehensive report on AI trends",
        "async": false
      },
      {
        "id": "write_task",
        "description": "Write a blog post based on the research",
        "assigned_to": "writer",
        "depends_on": ["research_task"],
        "expected_output": "A polished blog post of 1500 words",
        "async": false
      }
    ]
  },
  "ext": {
    "crewai": {
      "process_enum": "hierarchical",
      "memory": true,
      "cache": true,
      "verbose": true,
      "security_config": { "fingerprint": "crew-001-fp" }
    }
  }
}
```

**CrewAI 特有信息保留方式**：
- `Crew.process = "hierarchical"` → `process.type` + `ext.crewai.process_enum`（双重保留：语义化 + 原始值）
- `Crew.memory/cache/verbose` → `ext.crewai.*`
- `Task.context` 依赖 → `StepDef.depends_on`
- `Task.human_input` → `AgentDef.requires_human_input`（提升到 Agent 级）或 `StepDef.ext`（保留在步骤级）
- `manager_agent` → `process.root_agent` + `edges[type=manages]`

---

### 实例 2: Edict 三省六部

原始 Edict 结构：
- 9 个 Agent（太子、三省、六部）
- 状态机驱动（7 个状态、多条转移）
- 事件总线通信

```json
{
  "id": "edict-imperial-court",
  "name": "三省六部制",
  "description": "基于唐朝官制的 Agent 协作系统",
  "nodes": [
    {
      "id": "zaochao",
      "type": "agent",
      "role_in_team": "朝会主持",
      "agent": {
        "id": "zaochao",
        "name": "早朝",
        "role": "朝会召集与议程管理",
        "icon": "🏛️",
        "tools": [],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" }
      }
    },
    {
      "id": "shangshu",
      "type": "agent",
      "role_in_team": "总协调",
      "agent": {
        "id": "shangshu",
        "name": "尚书令",
        "role": "总协调与任务监督",
        "icon": "📜",
        "tools": [
          { "name": "dispatch", "source": "skills", "config": { "path": "~/.openclaw/workspace-shangshu/skills/dispatch" } }
        ],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" },
        "can_delegate": true,
        "permissions": [
          "dispatch:zhongshu", "dispatch:menxia",
          "dispatch:hubu", "dispatch:libu", "dispatch:bingbu",
          "dispatch:xingbu", "dispatch:gongbu"
        ]
      }
    },
    {
      "id": "zhongshu",
      "type": "agent",
      "role_in_team": "起草规划",
      "agent": {
        "id": "zhongshu",
        "name": "中书省",
        "role": "起草诏令与方案规划",
        "icon": "✍️",
        "tools": [],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" }
      }
    },
    {
      "id": "menxia",
      "type": "agent",
      "role_in_team": "审核封驳",
      "agent": {
        "id": "menxia",
        "name": "门下省",
        "role": "审核与封驳",
        "icon": "🔍",
        "tools": [],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" }
      }
    },
    {
      "id": "hubu",  "type": "agent", "role_in_team": "财务资源",
      "agent": { "id": "hubu",  "name": "户部", "role": "财务与资源管理", "icon": "💰", "tools": [], "model": { "provider_model": "anthropic/claude-sonnet-4-6" } }
    },
    {
      "id": "libu",  "type": "agent", "role_in_team": "人事组织",
      "agent": { "id": "libu",  "name": "吏部", "role": "人事与组织管理", "icon": "👤", "tools": [], "model": { "provider_model": "anthropic/claude-sonnet-4-6" } }
    },
    {
      "id": "bingbu", "type": "agent", "role_in_team": "安全应急",
      "agent": { "id": "bingbu", "name": "兵部", "role": "安全与应急响应", "icon": "🛡️", "tools": [], "model": { "provider_model": "anthropic/claude-sonnet-4-6" } }
    },
    {
      "id": "xingbu", "type": "agent", "role_in_team": "规范审查",
      "agent": { "id": "xingbu", "name": "刑部", "role": "规范与质量审查", "icon": "⚖️", "tools": [], "model": { "provider_model": "anthropic/claude-sonnet-4-6" } }
    },
    {
      "id": "gongbu", "type": "agent", "role_in_team": "工程技术",
      "agent": { "id": "gongbu", "name": "工部", "role": "工程与技术实施", "icon": "🔧", "tools": [], "model": { "provider_model": "anthropic/claude-sonnet-4-6" } }
    }
  ],
  "edges": [
    { "source": "shangshu", "target": "zhongshu", "type": "delegates_to" },
    { "source": "shangshu", "target": "menxia",   "type": "delegates_to" },
    { "source": "shangshu", "target": "hubu",     "type": "delegates_to" },
    { "source": "shangshu", "target": "libu",     "type": "delegates_to" },
    { "source": "shangshu", "target": "bingbu",   "type": "delegates_to" },
    { "source": "shangshu", "target": "xingbu",   "type": "delegates_to" },
    { "source": "shangshu", "target": "gongbu",   "type": "delegates_to" },

    { "source": "zhongshu", "target": "menxia",   "type": "routes_to", "condition": "plan_drafted" },
    { "source": "menxia",   "target": "shangshu", "type": "routes_to", "condition": "review_passed" },
    { "source": "menxia",   "target": "zhongshu", "type": "routes_to", "condition": "review_rejected" },
    { "source": "shangshu", "target": "hubu",     "type": "routes_to", "condition": "assigned_to_hubu" },
    { "source": "shangshu", "target": "gongbu",   "type": "routes_to", "condition": "assigned_to_gongbu" },

    { "source": "menxia", "target": "zhongshu", "type": "reviews" }
  ],
  "process": {
    "type": ["state_machine", "event_driven"],
    "states": {
      "states": ["Taizi", "Zhongshu", "Menxia", "Assigned", "Doing", "Review", "Done"],
      "initial": "Taizi",
      "terminal": ["Done"],
      "transitions": [
        { "from": "Taizi",    "to": "Zhongshu", "trigger": "triage_complete", "assigned_to": "zhongshu" },
        { "from": "Zhongshu", "to": "Menxia",   "trigger": "plan_drafted",    "assigned_to": "menxia" },
        { "from": "Menxia",   "to": "Zhongshu", "trigger": "review_rejected", "assigned_to": "zhongshu" },
        { "from": "Menxia",   "to": "Assigned",  "trigger": "review_passed",   "assigned_to": "shangshu" },
        { "from": "Assigned", "to": "Doing",     "trigger": "dispatched" },
        { "from": "Doing",    "to": "Review",    "trigger": "work_complete",   "assigned_to": "shangshu" },
        { "from": "Review",   "to": "Done",      "trigger": "review_approved" },
        { "from": "Review",   "to": "Doing",     "trigger": "review_rejected" }
      ]
    },
    "triggers": [
      { "event": "task.dispatch",     "handler": "shangshu" },
      { "event": "task.status",       "handler": "shangshu" },
      { "event": "task.created",      "handler": "zaochao" },
      { "event": "agent.todo.update", "handler": "shangshu" }
    ]
  },
  "ext": {
    "edict": {
      "db_schema": "001_initial",
      "event_bus": "redis_streams",
      "org_agent_map": {
        "户部": "hubu", "礼部": "libu", "兵部": "bingbu",
        "刑部": "xingbu", "工部": "gongbu", "吏部": "libu_hr"
      }
    }
  }
}
```

**Edict 特有信息保留方式**：
- `STATE_AGENT_MAP` → `process.states.transitions[].assigned_to`
- `ORG_AGENT_MAP` → `ext.edict.org_agent_map`（中文部门名→Agent ID 的映射是 Edict 独有的，放 ext）
- `allowAgents` → `edges[type=delegates_to]`（完美映射，无信息损失）
- `STATE_TRANSITIONS` → `process.states.transitions`
- Redis Streams topics → `process.triggers`
- 数据库 schema 版本 → `ext.edict.db_schema`

---

### 实例 3: Paperclip 公司组织

原始 Paperclip 结构：
- 树形层级：CEO → CTO → Engineer
- reportsTo 自引用
- 权限 + 变更审计

```json
{
  "id": "company-paperclip-001",
  "name": "Paperclip Corp",
  "nodes": [
    {
      "id": "ceo-001",
      "type": "agent",
      "role_in_team": "ceo",
      "agent": {
        "id": "ceo-001",
        "name": "CEO Agent",
        "role": "ceo",
        "title": "Chief Executive Officer",
        "tools": [],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" },
        "can_delegate": true,
        "permissions": ["agents:create", "users:invite", "users:manage_permissions", "tasks:assign"],
        "ext": {
          "paperclip": {
            "adapter_type": "process",
            "status": "idle",
            "budget_monthly_cents": 100000,
            "spent_monthly_cents": 15000
          }
        }
      }
    },
    {
      "id": "cto-001",
      "type": "agent",
      "role_in_team": "cto",
      "agent": {
        "id": "cto-001",
        "name": "CTO Agent",
        "role": "cto",
        "title": "Chief Technology Officer",
        "tools": [],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" },
        "can_delegate": true,
        "permissions": ["agents:create", "tasks:assign"],
        "ext": {
          "paperclip": {
            "adapter_type": "process",
            "status": "running",
            "budget_monthly_cents": 50000,
            "spent_monthly_cents": 8000
          }
        }
      }
    },
    {
      "id": "eng-001",
      "type": "agent",
      "role_in_team": "engineer",
      "agent": {
        "id": "eng-001",
        "name": "Engineer",
        "role": "general",
        "title": "Software Engineer",
        "tools": [],
        "model": { "provider_model": "anthropic/claude-sonnet-4-6" },
        "can_delegate": false,
        "permissions": ["tasks:assign"],
        "ext": {
          "paperclip": {
            "adapter_type": "process",
            "status": "idle",
            "budget_monthly_cents": 10000,
            "spent_monthly_cents": 2000,
            "capabilities": "TypeScript, Python, infrastructure"
          }
        }
      }
    }
  ],
  "edges": [
    { "source": "cto-001", "target": "ceo-001", "type": "reports_to" },
    { "source": "eng-001", "target": "cto-001", "type": "reports_to" },
    { "source": "ceo-001", "target": "cto-001", "type": "manages" },
    { "source": "cto-001", "target": "eng-001", "type": "manages" }
  ],
  "process": {
    "type": "hierarchical",
    "root_agent": "ceo-001"
  },
  "ext": {
    "paperclip": {
      "company_id": "company-paperclip-001",
      "approval_workflows": ["hire_agent", "budget_change"],
      "permission_keys": [
        "agents:create", "users:invite", "users:manage_permissions",
        "tasks:assign", "tasks:assign_scope", "joins:approve"
      ]
    }
  }
}
```

**Paperclip 特有信息保留方式**：
- `reportsTo` → `edges[type=reports_to]`（完美映射）
- `reportsTo` 的反向 → `edges[type=manages]`（显式化，原始数据中是隐含的）
- `chainOfCommand` → 不需要存储，从 `reports_to` 边可运行时计算
- `AgentConfigRevision` → 不在结构模型中（这是变更历史，不是当前结构）
- `adapter_type`, `status`, `budget_*` → `ext.paperclip.*`
- `companyId` → `ext.paperclip.company_id`

---

## 表示力验证清单

| 原始 Runtime 概念 | v2 中的表达位置 | 信息损失 |
|-------------------|----------------|---------|
| **CrewAI** | | |
| Crew.agents | nodes[] | 无 |
| Crew.tasks | process.steps[] | 无 |
| Crew.process (sequential) | process.type = "sequential" | 无 |
| Crew.process (hierarchical) | process.type = "hierarchical" + root_agent | 无 |
| manager_agent | edges[manages] + process.root_agent | 无 |
| allow_delegation | can_delegate + edges[delegates_to] | 无——实际上更精确了 |
| Task.context (DAG) | steps[].depends_on | 无 |
| Task.output_json/pydantic | steps[].ext.crewai.output_schema | 无 |
| Task.guardrail | steps[].ext.crewai.guardrail | 无 |
| Flow @start/@listen/@router | process.triggers + edges[condition] | 无 |
| SecurityConfig.fingerprint | ext.crewai.security_config | 无 |
| memory/cache/verbose | ext.crewai.* | 无 |
| **Edict** | | |
| agents.json 成员列表 | nodes[] | 无 |
| allowAgents 白名单 | edges[delegates_to] | 无 |
| AGENT_META (name/role/icon) | agent.name/role/icon | 无 |
| STATE_AGENT_MAP | states.transitions[].assigned_to | 无 |
| ORG_AGENT_MAP | ext.edict.org_agent_map | 无 |
| STATE_TRANSITIONS | states.transitions | 无 |
| TaskState 枚举 | states.states[] | 无 |
| Redis Streams topics | process.triggers[] | 无 |
| Event 结构 | ext.edict.event_schema | 无 |
| DB schema (tasks/events/todos/thoughts) | ext.edict.db_schema | 无（运行时存储，不属于结构） |
| **Paperclip** | | |
| agents table 全字段 | nodes[].agent + ext.paperclip | 无 |
| reportsTo | edges[reports_to] | 无 |
| orgForCompany() 树 | 从 edges 运行时计算 | 无 |
| chainOfCommand | 从 edges 运行时计算 | 无 |
| permissions | agent.permissions[] | 无 |
| adapter_type/config | ext.paperclip.adapter_type/config | 无 |
| runtime_config | ext.paperclip.runtime_config | 无 |
| budget_monthly_cents | ext.paperclip.budget_monthly_cents | 无 |
| AgentConfigRevision | 不在结构模型中（变更历史 ≠ 当前结构） | 有意排除 |

**结论：零信息损失。** 三个 Runtime 的所有结构信息都能在 v2 模型中完整表达。

---

## v2 与 v1 对比

| 维度 | v1 | v2 |
|------|----|----|
| 核心类型数 | 14 个（含 Permission/Mutation/Constraint 等） | 11 个（纯数据类型） |
| edge type | 封闭枚举（8 个值） | 开放字符串 + 推荐值 |
| 权限模型 | TeamCapability 枚举 + PermissionScope + Condition | 简单 string[] |
| 变更操作 | TeamMutation + Approval 完整工作流 | 不在模型中（不属于结构数据） |
| 约束系统 | TeamConstraint + ConstraintType 枚举 | 不在模型中（属于执行时校验） |
| 编排流程 | ProcessConfig + 类型特定子接口 | ProcessDef + 并列可选字段 |
| 扩展性 | 无 | 每层都有 ext 逃生舱 |
| 设计哲学 | 标准化框架 | 表示力超集 |
