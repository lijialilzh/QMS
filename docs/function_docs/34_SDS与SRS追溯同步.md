# SDS 与 SRS 追溯自动同步（获取 SRS 追溯）

> 与变更需求表并列的高复杂度联动点。修改前务必通读「修改注意事项」。

## 1. 功能概述

用户在 SDS 编辑页点击「获取SRS追溯」，系统根据 SRS 自动：补齐追溯行、在第 6 章功能设计同步区生成功能章节树、回写 chapter/location、刷新「2.4」追溯表节点并标记已同步。

---

## 2. 用户操作流程

1. 编辑页树节点「2.4 设计与需求追溯表」→ 点击 **「获取SRS追溯」**。
2. 后端 `sync_srs_trace` 执行同步。
3. 前端 `refreshSdsDocTree` 重载树；`table.trace_synced=true`。
4. 按钮变为「需求追溯表」，打开弹框（`from_sync=1`）。

---

## 3. 前端实现

| 函数 | 说明 |
|------|------|
| `fetchSrsTrace()` | 调 `sync_srs_trace` |
| `isTraceSyncedOnTree()` | 判断 `trace_synced` |
| `SdsTraceSectionActions` | 按钮切换逻辑 |

---

## 4. 后端接口

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| POST | `/sds_doc/sync_srs_trace` | Form: doc_id | { trace_rows[], content[] } |

实现：`serv_sds_doc.Server` 混入 `SdsSrsTraceSyncMixin`（`serv_sds_srs_trace_sync.py`）。

---

## 5. 同步流程（sync_srs_trace）

1. **SRS 重绑**：若关联 SRS 已删除，尝试同版本或最新有效 SRS；必要时清空旧 `sds_trace`。
2. `__ensure_sds_traces`：保证追溯行与 SRS 一致。
3. Word 导入：章节号规范化 + `_bind_word_leaf_codes_from_srs`。
4. `_sync_missing_design_nodes_from_srs`：在各产品 `X.6` 同步区按 SDS 编号生成功能章节树（`X.1~X.5` 固定不动）。
5. `_persist_trace_chapters_from_srs`：回写 `sds_trace.chapter/location`；严格章节编号（模块=二级、功能=三级、子功能=四级）。
6. `_refresh_trace_table_nodes(mark_synced=True)`：刷新「2.4」追溯表节点 + 变更需求 extra_tables。
7. `_persist_sds_tree`：整树落库。

---

## 6. 第 6 章同步区规则（Mixin 常量）

- `FIXED_TEMPLATE_SECTION_MAX = 5`：1~5 节不同步改写。
- `SYNC_ZONE_SECTION_MIN = 6`：功能设计同步区。
- 算法类需求：只写 chapter，location 置空。
- 变更需求（type_code 非 1/2/reqd）：单独分组、虚拟章节插入。
- 同步后会：去重、剪枝无 active trace 分支、合并同标题容器。

---

## 7. 边界与特殊处理

- Word 导入后**首次**展示 Word 自带追溯表；点击同步后才重算。
- 已同步文档再次加载：`get_sds_doc` 会 `_refresh_trace_table_for_display(persist=True)`。
- 同步**不重复生成**已存在的需求节点（`_trace_can_reuse_node`）。

---

## 8. 修改注意事项 / 不可破坏的核心逻辑

1. **第 6 章同步区边界（1~5 固定、6+ 同步）** 不可改：会破坏用户在 1~5 节手工编辑的内容。
2. **章节编号层级规则（模块=二级、功能=三级、子功能=四级）** 不可改。
3. **同步是显式操作**，不可在加载/保存时自动触发完整同步（仅允许展示刷新 `_refresh_trace_table_for_display`）。
4. **`trace_synced` 标记**驱动按钮状态与 `from_sync` 取数，不可误清。
5. **节点复用（不重复生成已有节点）** 不可破坏，否则会重复增生章节。
6. 变更需求单独分组 / 虚拟章节逻辑不可与标准需求混用。
