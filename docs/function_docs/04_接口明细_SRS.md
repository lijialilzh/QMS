# 接口明细：SRS（需求规格说明）

> 公共规范见 [02_接口设计总览.md](./02_接口设计总览.md)。完整路径 = `/trace-api` + 下列路径。

---

## 公共数据模型（文档树）

### Node（`obj/node.py`，节点基类）
| 字段 | 类型 | 含义 |
|------|------|------|
| doc_id | int | 文档ID |
| n_id | int | 节点ID |
| p_id | int | 父节点ID |
| ref_id | int | 引用ID |
| level | int | 层级 |
| priority | str | 排序优先级 |
| title | str | 节点标题 |
| with_chapter | int | 是否含章节号 |
| children | List[Node] | 子节点 |

### TabHeader / TableCell / Table
| 模型 | 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|------|
| TabHeader | code | str | 必填 | 列编码 |
| TabHeader | name | str | | 列名 |
| TableCell | value | str | | 单元格内容 |
| TableCell | row_span | int | 1 | 行合并 |
| TableCell | col_span | int | 1 | 列合并 |
| TableCell | h_align | str | left | 水平对齐 |
| TableCell | v_align | str | top | 垂直对齐 |
| Table | name | str | | 表名 |
| Table | show_header | int | 1 | 显示表头 |
| Table | headers | List[TabHeader] | | 表头 |
| Table | rows | List[Dict] | | 行数据 |
| Table | cells | List[List[TableCell]] | | 二维单元格（含合并） |

### SrsNodeForm（继承 Node）
| 字段 | 类型 | 含义 |
|------|------|------|
| label | str | 节点小标题 |
| rcm_codes | List[str] | RCM ID 列表 |
| srs_code | str | 需求编号 |
| ref_type | str | `img_struct`/`img_flow`/`img_topo`/`srs_reqs_1`/`srs_reqs_2`/`srs_reqds` |
| img_url | str | 图片 URL |
| text | str | 节点文本 |
| table | Table | 表格 |
| children | List[SrsNodeForm] | 子节点 |

### SrsDocForm / SrsDocObj
| 字段 | 类型 | 含义 |
|------|------|------|
| id | int | 文档ID |
| product_id | int | 产品ID |
| version | str | 版本号 |
| folder_name | str | 文件夹名 |
| file_no | str | 文件编号 |
| change_log | str | 版本变更说明 |
| content | List[SrsNodeForm] | 文档树 |
| n_id | int | 最大节点ID |
| product_name（Obj） | str | 产品名称 |
| product_version（Obj） | str | 产品版本 |
| create_time（Obj） | datetime | 创建时间 |

### SrsTypeForm
| 字段 | 类型 | 含义 |
|------|------|------|
| id | int | 类型ID |
| doc_id | int | 文档ID |
| type_code | str | 类型编号（新增时服务端生成 UUID） |
| type_name | str | 类型名称 |
| create_time | datetime | |

### SrsReqForm / SrsReqObj
| 字段 | 类型 | 含义 |
|------|------|------|
| id | int | 需求ID |
| doc_id | int | 文档ID |
| code | str | 需求编号 |
| module / function / sub_function | str | 模块/功能/子功能 |
| location | str | 位置/章节 |
| type_code | str | `1`=标准，`2`=其他，`reqd`=功能描述，UUID=变更类型 |
| rcm_ids | List[int] | RCM ID 列表 |
| rcm_codes（Obj） | List[str] | RCM 编号（出参填充） |

### SrsReqBatchSaveForm
| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| doc_id | int | **必填** | 文档ID |
| type_code | str | `"1"` | 需求类型 |
| temp_updates | List[SrsReqForm] | [] | 改号前临时释放（先更新） |
| upserts | List[SrsReqForm] | [] | 新增或更新 |
| delete_ids | List[int] | [] | 删除ID列表 |

### SrsReqdForm / SrsReqdObj
| 字段 | 类型 | 含义 |
|------|------|------|
| req_id | int | 需求ID |
| doc_id | int | 文档ID（新增用，写后清空） |
| code | str | 需求编号（新增用） |
| name | str | 需求名称 |
| overview | str | 概述 |
| participant | str | 参与人 |
| pre_condition | str | 前置条件 |
| trigger | str | 触发条件 |
| work_flow | str | 工作流程 |
| post_condition | str | 后置条件 |
| exception | str | 异常情况 |
| constraint | str | 约束 |
| rcm_ids | List[int] | RCM ID |
| rcm_codes / module / function / sub_function / type_code（Obj） | | 出参附加 |

---

## 一、`api_srs_doc.py`（prefix `/srs_doc`）

### POST `/srs_doc/add_srs_doc`
- 权限：`srs_doc_edit` / 入参：Body `SrsDocForm`（含 content 树）
- 出参：`Resp[SrsDocForm]`，data={ id }
- 错误：`该产品下已经有{version}版本文档存在`、`msg_obj_exist`、`msg_err_db`
- 树策略：新建 doc（n_id=0），有 content 则递归 INSERT

### GET `/srs_doc/duplicate_srs_doc`
- 权限：`srs_doc_edit` / 入参：Query `id`、`product_id?`（目标产品；为空或同原产品=同产品复制，指定其它产品=跨产品复制）
- 出参：data={ id:新文档 } / 错误：`msg_obj_null`、`msg_obj_exist`、`msg_err_db`
- 版本：同产品 `new_version(原版本)`；跨产品按目标产品现有最大版本递增，目标产品无文档则沿用原版本；撞号循环兜底递增保证 `(product_id, version)` 唯一
- 复制：树 + SrsType + SrsReq + SrsReqd + ReqRcm（变更表 type_code 重新生成 UUID）

### DELETE `/srs_doc/delete_srs_doc`
- 权限：`srs_doc_edit` / 入参：Query `id`
- 树策略：删全部 SrsNode；已绑定 SDS 则软删（改 version 前缀），否则物理删；同步删 SrsReq/SrsReqd/SrsType/ReqRcm
- 错误：`msg_obj_null`、`msg_err_db`

### POST `/srs_doc/add_srs_node`
- 权限：`srs_doc_edit` / 入参：Body `SrsNodeForm`（需 doc_id、p_id）
- 出参：新节点（含 n_id、priority）/ 错误：`msg_obj_null`（父不存在）
- 仅 INSERT 单节点，不递归 children

### DELETE `/srs_doc/delete_srs_node`
- 权限：`srs_doc_edit` / 入参：Query `doc_id`、`n_id`
- 仅删单条（不级联子节点）

### POST `/srs_doc/update_srs_doc`
- 权限：`srs_doc_edit` / 入参：Body `SrsDocForm`（需 id + 完整 content 树）
- 错误：版本冲突、`msg_obj_null`、`保存失败：未收到文档结构内容...`（content=null）、`保存失败：文档结构为空...`（content=[]）、`msg_err_db`
- **树策略（删后重建）**：更新主表 → n_id=0 → 删全部 SrsNode → 同步变更需求表到树 → 重置前端旧 n_id → 全量 INSERT → 同步 SrsReq/变更类型/SrsReqd/RCM

### POST `/srs_doc/update_srs_doc_file_no`
- 权限：`srs_doc_edit` / Content-Type：form
- 入参 Form：`id`(必填)、`file_no`(默认 "") / 错误：`msg_obj_null`、`msg_err_db`

### GET `/srs_doc/list_srs_doc`
- 权限：`srs_doc_view`
- 入参 Query：`product_id`(默认0)、`version`、分页
- 出参：`Resp[Page[SrsDocObj]]`（**不含 content 树**）；排除软删；非 admin 按产品权限过滤

### GET `/srs_doc/get_srs_doc`
- 权限：`srs_doc_view` / 入参：Query `id`
- 出参：`Resp[SrsDocObj]`（含完整 content 树）/ 错误：`msg_obj_null`

### POST `/srs_doc/add_doc_file` — 上传节点图片
- 权限：**`sds_doc_edit`**（注意非 srs_doc_edit）/ Content-Type：multipart
- 入参：Form `doc_id`(必填) + File `file` / 出参：`Resp[str]`（保存路径）

### GET `/srs_doc/export_srs_doc` — 导出 Word
- 权限：`srs_doc_view` / 入参：Query `id`(默认0) / 出参：docx 流

### POST `/srs_doc/export_srs_doc_snapshot` — 按快照导出 Word
- 权限：`srs_doc_view` / 入参：Body `SrsDocForm`（当前编辑态树，可不持久化）/ 出参：docx 流

### GET `/srs_doc/list_doc_trace` — SRS 追溯列表
- 权限：`srs_doc_view` / 入参：Query `id`(默认0)
- 出参：`Resp[List[dict]]`，行字段：

| 字段 | 类型 | 含义 |
|------|------|------|
| srs_code | str | SRS 编号 |
| type_code / type_name | str | 类型编号/名称 |
| rcm_flag | bool | 是否有 RCM |
| sds_code | str | SDS 编号 |
| sis_codes | List[str] | 接口编号 |
| test_codes | List[str] | 测试编号 |
| chapter | str | 章节 |
| tests_unit / tests_integ / tests_sys / tests_user | List[str] | 各阶段测试用例 |
| rcm_codes | List[str] | RCM 编号 |
| note | str | 备注 |

### POST `/srs_doc/import_srs_doc_word` — 导入 Word
- 权限：`srs_doc_edit` / Content-Type：multipart
- 入参 Form：`product_id`(必填)、`version`(必填)、`change_log`(默认"")、File `file`(必填)
- 出参：`Resp[SrsDocForm]`，data={ id }
- 错误：`当前环境缺少 python-docx 依赖...`、版本冲突、`msg_err_db`
- 导入后写入：SrsReq、变更需求表(SrsType+SrsReq)、RCM 关联、SrsReqd、产品图表文件

### GET `/srs_doc/export_doc_trace` — 导出追溯 Excel
- 权限：`srs_doc_view` / 入参：Query `id` / 出参：xlsx 流

### GET `/srs_doc/export_doc_trace_word` — 导出追溯 Word
- 权限：`srs_doc_view` / 入参：Query `id` / 出参：docx 流

### GET `/srs_doc/compare_srs_doc` — 对比两份文档
- 权限：`srs_doc_view` / 入参：Query `id0`、`id1`（必填）
- 出参：`Resp[List[CompareObj]]`（column_code, column_name, same_flag, values[0|1]）
- 对比列：product_name、product_type_code、product_version、product_udi、product_scope、srs_version、feature_added、feature_removed
- 错误：`msg_obj_null`

---

## 二、`api_srs_type.py`（prefix `/srs_type`）

### POST `/srs_type/add_srs_type`
- 权限：`srs_doc_edit` / 入参：Body `SrsTypeForm`
- 出参：`Resp[SrsTypeForm]`（含生成 id、type_code；**同名已存在则返回已有记录**）
- 错误：`msg_err_db`

### DELETE `/srs_type/delete_srs_type`
- 权限：`srs_doc_edit` / 入参：Query `id`
- 副作用：删该类型下全部 SrsReq 及关联 SrsReqd/SdsReqd/SdsTrace；清理文档树中对应变更表节点、第 7 章功能描述节点
- 错误：`msg_obj_null`

### POST `/srs_type/update_srs_type`
- 权限：`srs_doc_edit` / 入参：Body `SrsTypeForm`（需 id；**type_code 不可改**）
- 更新规则：跳过 id、type_code、null 字段 / 错误：`msg_obj_null`、`msg_err_db`

### GET `/srs_type/list_srs_type`
- 权限：`srs_doc_view` / 入参：Query `doc_id`(默认0)、分页 / 出参：`Resp[Page[SrsTypeForm]]`

---

## 三、`api_srs_req.py`（prefix `/srs_req`）

### POST `/srs_req/add_srs_req`
- 权限：`srs_doc_edit` / 入参：Body `SrsReqForm`
- 副作用：写 ReqRcm；关联 SDS 时写 SdsReqd/SdsTrace；同步文档树表格与标题
- 错误：`msg_obj_exist`（doc+type_code+code 重复）、`msg_err_db`

### POST `/srs_req/update_srs_req`
- 权限：`srs_doc_edit` / 入参：Body `SrsReqForm`（需 id）
- 更新规则：跳过 id、null；`rcm_ids` 全量替换 / 错误：`msg_obj_exist`、`msg_obj_null`、`msg_err_db`

### POST `/srs_req/batch_save_srs_req`
- 权限：`srs_doc_edit` / 入参：Body `SrsReqBatchSaveForm`
- 处理顺序：temp_updates → upserts（有id更新/无id新增）→ delete_ids → 批量同步 SDS 编号与文档树
- 错误：`msg_obj_exist`、`msg_obj_null`、`msg_err_db`

### DELETE `/srs_req/delete_srs_req`
- 权限：`srs_doc_edit` / 入参：Query `id`
- 副作用：删 SdsReqd、SdsTrace、SrsReq、SrsReqd（不直接改文档树）

### GET `/srs_req/list_srs_req`
- 权限：`srs_doc_view` / 入参：Query `doc_id`、`type_code`、分页
- 出参：`Resp[Page[SrsReqObj]]`（含 rcm_codes、rcm_ids；无 location 时从树推断章节）
- 副作用：doc 下无需求且为 Word 导入文档时，可能从 srs_node 回填 SrsReq

### GET `/srs_req/get_srs_req`
- 权限：`srs_doc_view` / 入参：Query `id` / 出参：`Resp[SrsReqObj]` / 错误：`msg_obj_null`

---

## 四、`api_srs_reqd.py`（prefix `/srs_reqd`）

### POST `/srs_reqd/add_srs_reqd`
- 权限：`srs_doc_edit` / 入参：Body `SrsReqdForm`（需 doc_id、code）
- 逻辑：先建 `SrsReq(type_code="reqd")`，再建 SrsReqd；doc_id/code/name 不写入 reqd 表
- 错误：`msg_obj_exist`（doc+reqd+code 重复）、`msg_err_db`

### DELETE `/srs_reqd/delete_srs_reqd`
- 权限：`srs_doc_edit` / 入参：Query `req_id` / 副作用：删 SrsReqd + 对应 SrsReq

### POST `/srs_reqd/update_srs_reqd`
- 权限：`srs_doc_edit` / 入参：Body `SrsReqdForm`（需 req_id）
- 规则：不可改 req_id/doc_id/code/name；不存在则 INSERT；rcm_ids 全量替换 / 错误：`msg_err_db`

### GET `/srs_reqd/list_srs_reqd`
- 权限：`srs_doc_view` / 入参：Query `product_id`、`doc_id`、分页
- 出参：`Resp[Page[SrsReqdObj]]`；排除 type_code="2"；无 SrsReqd 记录时从树补齐字段

### GET `/srs_reqd/get_srs_reqd`
- 权限：`srs_doc_view` / 入参：Query `req_id`
- 出参：`Resp[SrsReqdObj]`（无记录时返回占位对象，name 取自 SrsReq）/ 错误：`msg_obj_null`
