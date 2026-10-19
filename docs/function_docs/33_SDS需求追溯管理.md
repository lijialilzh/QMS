# SDS 需求追溯管理（sds_trace）

## 1. 功能概述

维护 SDS 设计与 SRS 需求的追溯关系（设计编号 sds_code、章节 chapter、位置 location），按需求展示为追溯表（图2 / 2.4 节）。一条需求对应多个设计编号或章节时，单元格内逐条换行，不单行裁切。

---

## 2. 用户操作流程

1. 树节点 `ref_type=sds_traces`（「2.4 设计与需求追溯表」）直接展示追溯表。标题旁不放「设计需求追溯」按钮。
2. 或 `SdsTraces.tsx` 独立页（未挂路由）。
3. 按产品 + SDS 版本查询；多行 SDS 编号会**展开**为多行。
4. 编辑：`sds_code`（必填）、`chapter`、`location` → `update_sds_trace`。

---

## 3. 前端实现

| 函数 | 说明 |
|------|------|
| `loadTraceListData()` | 弹框（要求先「获取SRS追溯」） |
| `syncTraceTableNodes()` | 用追溯数据刷新树内追溯表 |
| `expandTraceRows()` | 多行 sds_code/chapter/location 展开 + 合并单元格 |
| `buildVirtualLocationMap()` | 变更需求空 location 时虚拟章节推算 |

---

## 4. 后端接口

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| GET | `/sds_trace/list_sds_trace` | prod_id, doc_id, type_code, from_sync, 分页 | Page[SdsTraceObj] |
| GET | `/sds_trace/get_sds_trace` | id | SdsTraceObj |
| POST | `/sds_trace/update_sds_trace` | SdsTraceForm | 成功/失败 |

`SdsTraceObj` 扩展：srs_code, name, module/function/sub_function, type_code/type_name, 产品/版本信息。

---

## 5. 数据库表

`sds_trace`：唯一 `(doc_id, req_id)`；字段 sds_code, chapter, location。

---

## 6. 关键业务逻辑与规则

### 6.1 自动补齐（__ensure_sds_traces，列表前调用）
1. 从 SRS「产品需求列表」读层级 `hierarchy_map`。
2. 必要时从 SRS Word 表补齐 `srs_req`/`srs_type`。
3. 对每个 `type_code != "reqd"` 需求 upsert 追溯行。
4. 删除已不在 SRS 的 req_id 追溯。
5. **RCN300 固定映射**（`FIXED_RCN300_TRACES`）：一条 SRS 可对应多个 SDS 编号+章节+location（产品特例）。对照认的是编号数字 `300-001`～`300-010`，不认死字母 RCN。其他需求把代号从 RCN 改成 ACN 后，仍用同一套对照：设计编号只把字母改成和需求编号一样（`SDS-ACN300-006`），模块名仍是对照里的名称（如 DLServer、RePACS、DataProcessing），不改成「性能要求」「基本要求」「图像处理」。一行里多条设计编号的先后不换。展示和写回时不用需求上带数字后缀的中文名。单行也不用需求模块名覆盖。例如 `SRS-RCN300-001` / `SRS-ACN300-001` 写 RePACS，不写「数据库要求」；`004` 写 DataProcessing，不写「图像接收」；`005` 写 RePACS，不写「图像存储」；`007` 写 NeoViewer，不写「图像显示」。法规符合性需求、外部连接、文档需求的章节号按当前 SDS 目录同名章节的实际章号写，不写死 8/9/10，也不用节点上错位的设计编号反推。目录里没有「文档需求」时，2.4 主表不显示编号尾号为 `300-008` 的这一行。
6. **2.4 主表行序**：标准需求和其他需求放在同一张主表，按需求编号的数字排，不看代号字母。编号去掉开头的 3 后比段号、序号：`300` 在前，然后 `301`，再是 `306`。`SRS-ACN300-001` 与原来的 `SRS-RCN300-001` 占同一位置，改字母不挪行。不把标准需求整组排到其他需求前面。变更需求仍在主表下方单独成表，表内行序与需求规格变更需求一致：先比代号中的数字，再比末段序号，如 `SRS-RCN308-001`、`SRS-RCN308-010`、`SRS-RCN308-012`、`SRS-RCN308-020`。打开编辑页和查看页都按这个顺序。
7. **设计编号自动获取**：`300-001`～`010` 按固定映射写设计编号（如尾号 001 对应尾号 005），代号字母改了，这一行里的每一条设计编号都改成同一个字母。其它需求的设计编号由当前需求编号把 SRS 换成 SDS；需求编号改了之后，打开详细设计追溯表时单行设计编号跟着改。不属于这套固定对照、单元格里已有多行设计编号的不覆盖。

### 6.2 location 解析（非 from_sync）
1. DB 已存 location。
2. SDS 树按 `sds_code` 找节点 heading。
3. 按 module/function/sub_function 精确/模糊匹配树标题。
4. **NAME_DICT** 图像模块别名映射（如「图像处理」→ RePACS）。
5. 变更需求虚拟 location。

### 6.3 from_sync=true
- 直接用 DB 的 chapter/location，不做树推算。RCN300 固定映射除外，仍用映射里的名称和设计编号。法规符合性需求、外部连接的章节号按当前目录实际章号。目录没有文档需求时，主表不显示这一行。

### 6.4 type_code 分组（追溯表渲染）
| type_code | 含义 | 位置 |
|-----------|------|------|
| 1 | 标准需求 | 主表 |
| 2 | 其他需求 | 主表 |
| 其它 | 变更需求 | extra_tables[] |
| reqd | 需求细节 | 不参与 |

---

## 7. 边界与特殊处理

- 无 SDS 树时仍展示 SRS 基础信息，便于手工编辑。
- RCN300 系列走固定 trace，跳过常规定位。

---

## 8. 修改注意事项 / 不可破坏的核心逻辑

1. **`from_sync` 两种取值的不同 location 来源**（DB vs 树推算）不可混淆。
2. **RCN300 固定映射 / NAME_DICT 别名** 为产品特例，改动会影响特定产品追溯。
3. **type_code 分组（主表 / extra_tables / 不参与）** 不可改。
4. 自动补齐时「删除已不在 SRS 的追溯」逻辑不可误删仍有效的行。
