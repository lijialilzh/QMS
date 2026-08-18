# SRS 文档树结构编辑

## 1. 功能概述

SRS 编辑页主体是文档树（`TreeStructure`）：展开/折叠章节、编辑标题/正文、插入表格/图片、增删子节点、绑定 RCM、内嵌编辑标准/其他/变更需求表、自动生成第 7 章功能描述结构。

---

## 2. 用户操作流程

在编辑页树中对任意节点：编辑标题/正文、添加/删除子节点、插入图片或表格、绑定 RCM 编码；保存时整棵树随 `update_srs_doc.content` 提交。

---

## 3. 前端实现

| 项 | 说明 |
|----|------|
| `TreeStructure.tsx` | 树渲染与节点 CRUD（约 5950 行） |
| `standard_nodes.json` | 标准模板：封面、修订记录、1~9 章骨架；2.1 含 `ref_type=srs_reqs`；2.2/2.3 含图片 ref_type；第 7 章含「7.1 要求」 |
| 导出/保存校验 | `validateStandardSrsCodeUnique`、`validateStandardSrsRowContentRaw`、`validateStandardSrsHierarchyDuplicates`、`validateChangeReqDataRows` 等 |

---

## 4. 后端接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/srs_doc/add_srs_node` | SrsNodeForm（单节点追加），`doc.n_id += 1` |
| DELETE | `/srs_doc/delete_srs_node` | doc_id, n_id |
| POST | `/srs_doc/update_srs_doc` | 整树保存（主路径） |

**SrsNodeForm 字段**：doc_id, n_id, p_id, title, label, srs_code, rcm_codes[], ref_type, img_url, text, table, children[]

---

## 5. 数据库表

`srs_node`（详见 [01_数据库表结构.md](./01_数据库表结构.md)）。

---

## 6. 关键业务逻辑与规则

### 6.1 节点标记 label
- `__auto_req_detail`：自动生成的第 7 章功能描述节点。
- `__auto_req_group`：自动生成的分组容器。

### 6.2 ref_type 渲染语义
- `srs_reqs` / `srs_reqs_2`：预览嵌入标准/其他需求表（只读态 `shouldShowSrsReqPreviewTables`）。
- `srs_reqds`：需求列表入口。
- `img_topo`（2.2）/ `img_struct`（2.3）：产品图表库图片。

### 6.3 删除节点的特殊路径（重要）
- **删除变更表节点必须走 `onDeleteSrsChangeTable`**（不能只清 `node.table`），否则 DB 残留 srs_type/srs_req。详见 [25_变更需求表管理.md](./25_变更需求表管理.md)。

### 6.4 第 7 章功能描述
- `syncSrsReqDetailsByKey` 按 module → function → sub_function 层级重建，保留已有 KV 表内容（按 stableKey/code 匹配）。

### 6.5 工具库
- 后端 `tree_util.iter_tree / find_parent / fix_chapter`，`tab_util.find_node`。

### 6.6 第 9 章文档需求 RCM 归属
- 「9 文档需求」只保留需求编号与引言。
- RCM 按正文分段落入已有子章节：9.1 在用户说明书中说明、9.2 在用户说明书中增加的警示、9.3 在用户说明书中增加的注意事项。
- 编辑页加载时若一级章节仍堆着这三段正文、且对应子章节为空，自动拆分并静默保存；子章节已有正文则不覆盖。

### 6.7 第 2.3 章系统结构图子节
- 「2.3 系统结构图」子节只保留模板 4 条：图像接收、图像存储、图像处理、图像显示（标题不含末尾冒号，正文用 `standard_nodes.json`）。
- 加载时标题匹配忽略章节号与末尾 `：`，避免 Word 导入的「图像接收：」与模板「2.3.1 图像接收」重复并存；模板外的子节删除并静默保存。
- 2.3 本章结构图正文与 `img_struct` 图片不覆盖；2.4 及第 7 章自动生成节点不按此规则裁剪。

---

## 7. 边界与特殊处理

- `update_srs_doc` 整树重建：保存前重置 `n_id`，新节点 `n_id=0`。
- 自动生成节点（`__auto_*`）由系统维护，手工编辑需谨慎。

---

## 8. 修改注意事项 / 不可破坏的核心逻辑

1. **变更表节点删除必须走 `onDeleteSrsChangeTable`**，禁止退化为只清 `node.table`。
2. `__auto_req_detail` / `__auto_req_group` 标记是第 7 章联动的识别依据，不可改名或误删。
3. ref_type 渲染分支（srs_reqs / srs_reqds / img_*）不可随意调整。
4. 整树重建 + n_id 重置策略不可破坏。
