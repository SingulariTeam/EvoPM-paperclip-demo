# EvoPM 落地方案 v1.0

> 面向团队的技术对齐文档。读完这份文档你应该清楚：我们要做什么、不做什么、怎么做、分工怎么切。

---

## 一句话定义

用一份 **Skill 文档**，指导 Paperclip 里一个有团队结构读写权限的 **Organizer Agent**，
在每次项目执行后，通过预定义的 **OrgGene/OrgCapsule** 接口与 EvoMap 交互——
把成功的组织结构发布出去，把已有的组织经验检索回来。

---

## 核心架构

```
用户输入业务场景
        ↓
[意图映射层] — LLM 多轮对话，提取任务特征
        ↓
[Fetch-First] — POST /a2a/fetch → 查询 EvoMap 上的 OrgGene
        ↓ 有匹配              ↓ 无匹配
  实例化 OrgGene         LLM 设计新组织结构
        ↓                      ↓
     [Paperclip]  ←  POST /api/companies/import
     启动 Agent Teams，执行任务
        ↓
[Organizer Agent] 评估执行效果
（读取任务完成率、Token 消耗、耗时）
        ↓ 效果好
  打包 OrgCapsule
        ↓
  POST /a2a/publish → 发布到 EvoMap
```

---

## 需要实现的三块核心工作

### 1. OrgGene / OrgCapsule Schema 定义

这是整个系统的数据契约，两端（Paperclip 和 EvoMap）都依赖它。

**OrgGene**（可复用的组织模式模板）最小字段：

```json
{
  "type": "OrgGene",
  "schema_version": "1.0.0",
  "category": "org-topology",
  "summary": "适用于 ToC 增长型产品的蜂巢式架构",
  "signals_match": ["ToC", "high-frequency-iteration"],
  "topology": {
    "structure": "hub-and-spoke",
    "roles": [
      { "name": "ceo", "reportsTo": null, "responsibilities": "...", "decision_boundary": "..." },
      { "name": "product", "reportsTo": "ceo", "responsibilities": "...", "decision_boundary": "..." }
    ],
    "coordination_protocol": {
      "delegation": "ceo → direct reports",
      "approval_required": ["budget > 1000"],
      "escalation": "任何角色可向 ceo 升级冲突"
    }
  },
  "constraints": {
    "max_agents": 6,
    "heartbeat_interval_hint": "2h",
    "cost_ceiling_hint": "medium"
  },
  "asset_id": "sha256:..."
}
```

**OrgCapsule**（带执行验证结果的具体实例）最小字段：

```json
{
  "type": "OrgCapsule",
  "schema_version": "1.0.0",
  "gene": "sha256:对应 OrgGene 的 asset_id",
  "summary": "ToC 电商场景下，蜂巢式架构执行结果",
  "trigger": ["ToC", "e-commerce", "independent-site"],
  "mutations": "在基础模板上增加了'增长分析师'角色",
  "outcome": {
    "status": "success",
    "task_completion_rate": 0.92,
    "token_cost_relative": "low",
    "duration_minutes": 47,
    "bottleneck": "前端开发角色等待 review 时间过长"
  },
  "paperclip_config_snapshot": {
    "agents": [...],
    "issues": [...]
  },
  "confidence": 0.87,
  "asset_id": "sha256:..."
}
```

---

### 2. Organizer Agent 的 Skill 文档

一份 Markdown 文件，喂给 Organizer Agent，定义它的完整工作流。核心内容：

**触发时机**：
- 用户提交新业务场景时（创建公司前）
- 一个 epoch 的任务执行完毕后（评估 + 发布）

**工作流伪代码**：

```
on_new_task(task_description):
  features = extract_features(task_description)  # ToC/ToB, 行业, 规模等
  existing = fetch_org_gene(features)             # POST /a2a/fetch
  if existing:
    config = instantiate_gene(existing)           # OrgGene → Paperclip 公司配置
  else:
    config = design_new_org(features)             # LLM 从零设计
  deploy_to_paperclip(config)                     # POST /api/companies/import

on_epoch_complete(execution_log):
  score = evaluate(execution_log)                 # 完成率、Token、耗时
  if score.is_good():
    capsule = pack_capsule(config, score)         # 打包 OrgCapsule
    publish_to_evomap(capsule)                    # POST /a2a/publish
```

---

### 3. 评估逻辑

Organizer Agent 读 Paperclip 的执行记录，计算三个指标：

| 指标 | 数据来源 | 计算方式 |
|------|----------|----------|
| 任务完成率 | `issues` 表的 `status` 字段 | `done / total` |
| Token 消耗（相对值） | `heartbeatRuns` 表 | 与同类任务基线比较 |
| 执行耗时 | `heartbeatRuns` 的时间戳 | epoch 开始到最后一个 issue done |

MVP 阶段：这三个指标够用，不需要更复杂的评估函数。

---

## 技术接口速查

### Paperclip 侧

| 操作 | 接口 |
|------|------|
| 创建公司（含 agents + issues） | `POST /api/companies/import` |
| 唤醒 Agent 开始工作 | `POST /api/agents/:id/wakeup` |
| 查询任务状态 | `GET /api/issues` |
| 查询执行记录 | `GET /api/heartbeat-runs`（或直接读 DB） |

### EvoMap 侧

| 操作 | 接口 |
|------|------|
| 注册节点（一次性） | `POST https://evomap.ai/a2a/hello` |
| 检索已有 OrgGene | `POST https://evomap.ai/a2a/fetch` |
| 发布 OrgCapsule | `POST https://evomap.ai/a2a/publish` |
| 保持在线 | `POST https://evomap.ai/a2a/heartbeat`（每 15 分钟） |

---

## MVP 边界（黑客松 30 小时内）

**必须跑通（P0）：**
- [ ] OrgGene/OrgCapsule Schema 定义完毕（JSON 文件）
- [ ] 至少 2 个预置 OrgGene（ToC 蜂巢式 / ToB 堡垒式）手动写好，发布到 EvoMap
- [ ] Organizer Agent 能读取 EvoMap 上的 OrgGene，实例化为 Paperclip 公司配置并启动
- [ ] 执行完成后，能打包 OrgCapsule 并发布到 EvoMap

**有时间再做（P1）：**
- [ ] 意图映射层的 LLM 多轮对话入口
- [ ] 评估指标的自动计算（先允许手动填）
- [ ] before/after 进化对比的可视化

**不做（明确排除）：**
- 通用 Fetch-First 框架（EvoMap 自己的 roadmap，不是我们的差异化）
- 复杂的 Agent 治理 / 审批流程（用 Paperclip 现成的就够）
- 跨 Runtime 兼容（MVP 只支持 Paperclip）

---

## 建议分工

| 模块 | 工作内容 | 建议负责人 |
|------|----------|----------|
| OrgGene Schema + 预置模板 | 定义 JSON 结构，手写 2 个模板，发布到 EvoMap | 开发 |
| Organizer Agent + Skill 文档 | 写 Skill Markdown，实现 Fetch→实例化→发布 逻辑 | 开发 |
| 意图映射层 UI | 对话入口，提取特征，生成公司配置 | 开发 |
| 评估逻辑 | 读 Paperclip 执行记录，计算三个指标 | 开发 |
| Demo 脚本 + 海报 + 文档 | 展示用 | 产品 |

---

*版本：v1.0 — 2026-03-27*
*供团队内部对齐使用*
