# SRS 需求条目管理（标准需求 / 其他需求）

## 1. 功能概述

管理 SRS 的标准需求表（`type_code=1`：编号+模块+功能+子功能）与其他需求表（`type_code=2`：编号+模块+章节）。两类均通过 `srs_req` 表存储，主入口已集成到 SRS 编辑页的树内表格。

---

## 2. 用户操作流程

- **标准需求表**：树内 `ref_type=srs_reqs` 节点 → 内嵌表格编辑 → 保存触发 `handleSaveSrsReqTableInCurrentPage`。
- **其他需求表**：树内其他需求表节点 → `handleSaveOtherReqTableInCurrentPage`。

> 遗留独立页 `SrsManage.tsx` / `SrsReq.tsx` **未注册路由**，功能已并入 `SrsDocDetail`。

---

## 3. 前端实现

| 函数 | 说明 |
|------|------|
| `handleSaveSrsReqTableInCurrentPage` | 标准需求表保存 |
| `handleSaveOtherReqTableInCurrentPage` | 其他需求表保存（逐行 add/update，删除走 delete_srs_req） |
| `syncOtherReqCodesToChaptersFromRows` | 其他需求编号同步到对应章节标题 |

---

## 4. 后端接口

| 方法 | 路径 | 入参 |
|------|------|------|
| GET | `/srs_req/list_srs_req` | doc_id, type_code, 分页 |
| POST | `/srs_req/batch_save_srs_req` | SrsReqBatchSaveForm |
| POST | `/srs_req/add_srs_req` / `update_srs_req` | SrsReqForm |
| DELETE | `/srs_req/delete_srs_req` | id |

**SrsReqBatchSaveForm**：doc_id, type_code, temp_updates[], upserts[], delete_ids[]
**SrsReqForm**：id, doc_id, code, module, function, sub_function, location, type_code, rcm_ids[]
**SrsReqObj 额外**：rcm_codes[]

---

## 5. 数据库表

`srs_req`（唯一 `(doc_id, type_code, code)`）、`req_rcm`。

---

## 6. 关键业务逻辑与规则

### 6.1 标准需求保存（handleSaveSrsReqTableInCurrentPage）
1. 解析表头列：需求编号/模块/功能/子功能。
2. 合并单元格：同 SRS 前缀组内继承 module/function/sub_function。
3. 校验：编号唯一、行内容、层级重复。
4. 与 DB 旧行 diff → `batch_save_srs_req`。
5. 刷新树与 reqListData。

### 6.2 改号（temp_updates，重要）
- 改编号时先把旧 code 改为临时值，再 upsert 新 code，**临时释放唯一约束**避免冲突。

### 6.3 分类规则（前后端一致）
- `code + module + function` → `type_code=1`。
- `code + module + location`（无功能/子功能）→ `type_code=2`。

### 6.4 保存后回写
- `__sync_req_to_node_tables` / `__sync_req_to_node_titles` 回写 `srs_node`。
- 若已绑定 SDS：`add_srs_req` 自动插入 `sds_reqd`、`sds_trace`（`sds_code = code.replace("SRS","SDS")`）。

### 6.5 排序与位置
- `list_srs_req` 优先按文档树表行顺序（`__query_doc_req_order`），**非 code 字母序**，不因 code 重排。
- `location` 空时从树路径推断章节号。

### 6.6 其他需求差异
- `list_srs_reqd` **排除** `type_code=2`（功能描述列表不含其他需求）。

---

## 7. 边界与特殊处理

- `__repair_reqs_from_nodes`：导入后 SRS 管理为空时，仅从「导入表格/图片/正文」标记的文档回填。

---

## 8. 修改注意事项 / 不可破坏的核心逻辑

1. **改号必须走 temp_updates 两段式**，不可直接 update 新 code（违反唯一约束）。
2. **行顺序不因 code 重排**（`should_reposition=False`），保持用户/Word 顺序。
3. **type_code 1/2 分类规则**前后端一致，不可单边修改。
4. 绑定 SDS 时自动建 sds_reqd/sds_trace 的联动不可遗漏。
5. `list_srs_reqd` 排除 type_code=2 不可改动。
