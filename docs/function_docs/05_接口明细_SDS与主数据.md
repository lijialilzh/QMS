# 接口明细：SDS（软件详细设计）与 RCM/HAZ/CST 主数据

> 公共规范见 [02_接口设计总览.md](./02_接口设计总览.md)。完整路径 = `/trace-api` + 下列路径。

---

## 公共数据模型（SDS）

### SdsDocForm / SdsDocObj
| 字段 | 类型 | 含义 |
|------|------|------|
| id | int | 文档ID |
| srsdoc_id | int | 关联 SRS 文档ID |
| version | str | 版本号 |
| file_no | str | 文件编号 |
| change_log | str | 版本变更说明 |
| content | List[SdsNodeForm] | 文档树 |
| n_id | int | 最大节点ID |
| product_id / product_name / product_version（Obj） | | 产品信息 |
| create_time（Obj） | datetime | 创建时间 |
| srs_version（Obj） | str | 需求规格版本 |

### SdsNodeForm（继承 Node）
| 字段 | 类型 | 含义 |
|------|------|------|
| doc_id/n_id/p_id/ref_id/level/priority/title/with_chapter | | 同 Node |
| sds_code | str | 设计编号 |
| ref_type | str | `img_struct`/`img_flow`/`img_topo`/`sds_traces` |
| label | str | 小标题 |
| img_url | str | 图片URL |
| text | str | 文本 |
| table | SdsTable | 表格 |
| children | List[SdsNodeForm] | 子节点 |

### SdsTable（继承 Table，额外）
| 字段 | 类型 | 默认 | 含义 |
|------|------|------|------|
| extra_tables | List[SdsExtraTable] | | 附加表格 |
| trace_synced | bool | | 追溯已从 SRS 同步 |

`SdsExtraTable`：`title`(str) + `table`(Table)。

### SdsReqdForm / SdsReqdObj + LogicForm
| 模型 | 字段 | 类型 | 含义 |
|------|------|------|------|
| SdsReqd | id/req_id/doc_id | int | 主键/需求ID/文档ID |
| SdsReqd | overview | str | 概述 |
| SdsReqd | func_detail | str | 功能 |
| SdsReqd | logic_txt | str | 逻辑文本 |
| SdsReqd | intput | str | 输入（**字段名拼写为 intput**） |
| SdsReqd | output | str | 输出 |
| SdsReqd | interface | str | 接口 |
| Obj 附加 | srs_code/sds_code/name/module/function/sub_function/type_code/product_name/product_version/srsdoc_version/sdsdoc_version | | 关联展示 |
| Obj 附加 | logics | List[LogicForm] | 逻辑图列表（详情含） |
| LogicForm | id/txt/filename/img_url | | 逻辑图项 |

### SdsTraceForm / SdsTraceObj
| 字段 | 类型 | 含义 |
|------|------|------|
| id | int | ID（无 id 则新增） |
| req_id | int | 需求ID |
| doc_id | int | 文档ID |
| sds_code | str | 设计编号 |
| chapter | str | 章节 |
| location | str | 位置 |
| Obj 附加 | srs_code/name/product_name/product_version/srsdoc_version/sdsdoc_version/type_code/type_name/module/function/sub_function | | 关联展示 |

### CompareObj
`column_code`(str)、`column_name`(str)、`same_flag`(int 1相同/0不同)、`values`(List 两文档值)。

---

## 一、`api_sds_doc.py`（prefix `/sds_doc`）

### POST `/sds_doc/add_sds_doc`
- 权限：`sds_doc_edit` / 入参：Body `SdsDocForm`
- 出参：`Resp[SdsDocForm]`，data={ id } / 错误：`msg_obj_exist`（srsdoc_id+version 重复）、`msg_err_db`

### POST `/sds_doc/import_sds_doc_word`
- 权限：`sds_doc_edit` / Content-Type：multipart
- 入参：Form `product_id`(必填)、`srsdoc_id`(默认0)、`version`(必填)、`change_log`(默认"") + File `file`(必填)
- 错误：缺 python-docx；`导入失败：未找到匹配的需求文档版本...`；`导入失败：当前产品下未找到需求规格说明...`；版本冲突；`msg_err_db`

### GET `/sds_doc/duplicate_sds_doc`
- 权限：`sds_doc_edit` / 入参：Query `id`、`product_id?`（目标产品；为空或同原产品=同产品复制，指定其它产品=跨产品复制） / 出参：data={ id:新文档 }
- 跨产品：`srsdoc_id` 自动绑定目标产品下最新有效 SRS（无则置 0），`product_id`=目标产品；版本按目标产品最大版本递增、无则沿用原版本；`(srsdoc_id, version)`+`(product_id, version)` 双重唯一校验 + 撞号兜底递增（防孤儿记录）
- 复制：树 + sds_reqd + sds_trace
- 错误：源不存在、版本冲突、DB 异常

### POST `/sds_doc/add_doc_file` — 上传节点图片
- 权限：`sds_doc_edit` / multipart
- 入参：Form `doc_id`(必填)、`ref_type`(可选) + File `file`(可选) / 出参：`Resp[str]`（保存路径）

### DELETE `/sds_doc/delete_sds_doc`
- 权限：`sds_doc_edit` / 入参：Query `id` / 出参：`code=1`

### POST `/sds_doc/add_sds_node`
- 权限：`sds_doc_edit` / 入参：Body `SdsNodeForm`（需 doc_id、p_id）
- 出参：新节点 / 错误：父节点 (doc_id,p_id) 不存在 → `msg_obj_null`

### DELETE `/sds_doc/delete_sds_node`
- 权限：`sds_doc_edit` / 入参：Query `doc_id`、`n_id` / 出参：`code=1`

### POST `/sds_doc/update_sds_doc`
- 权限：`sds_doc_edit` / 入参：Body `SdsDocForm`（需 id + content）
- 错误：版本重复、文档不存在、DB 异常 / 树策略：删后重建（同 SRS）

### POST `/sds_doc/update_sds_doc_file_no`
- 权限：`sds_doc_edit` / multipart
- 入参：Form `id`(必填)、`file_no`(默认 ""；空串存 null) / 错误：文档不存在、DB 异常

### POST `/sds_doc/sync_srs_trace` — 从 SRS 同步追溯
- 权限：`sds_doc_edit` / multipart / 入参：`doc_id`(必填)
- 出参：data = { trace_rows: List[SdsTraceObj], content: List[SdsNodeForm] }
- 错误：SDS 不存在 → `msg_obj_null`

### GET `/sds_doc/list_sds_doc`
- 权限：`sds_doc_view` / 入参：Query `product_id`(默认0)、`version`、分页
- 出参：`Resp[Page[SdsDocObj]]`；非 admin 按 UserProd 过滤

### GET `/sds_doc/get_sds_doc`
- 权限：`sds_doc_view` / 入参：Query `id` / 出参：`Resp[SdsDocObj]`（含 content 树）/ 错误：`msg_obj_null`

### GET `/sds_doc/export_sds_doc`
- 权限：`sds_doc_view` / 入参：Query `id`(默认0) / 出参：docx 流（缺 python-docx 时返回空流）

### GET `/sds_doc/compare_sds_doc`
- 权限：`sds_doc_view` / 入参：Query `id0`、`id1` / 出参：`Resp[List[CompareObj]]` / 错误：`msg_obj_null`

---

## 二、`api_sds_reqd.py`（prefix `/sds_reqd`）

### POST `/sds_reqd/update_sds_reqd`
- 权限：`sds_doc_edit` / Content-Type：multipart
- 入参（Form/File）：`id`、`doc_id`、`req_id`、`overview`、`func_detail`、`logic_txt`、`intput`、`output`、`interface`、`new_imgs`(List[UploadFile])、`new_logics`(JSON 数组 LogicForm)、`alt_logics`(JSON 数组 LogicForm)
- 错误：id 对应记录不存在、DB 异常

### DELETE `/sds_reqd/delete_sds_logic`
- 权限：`sds_doc_edit` / 入参：Query `logic_id` / 始终提交成功（无存在性校验）

### GET `/sds_reqd/list_sds_reqd`
- 权限：`sds_doc_view` / 入参：Query `prod_id`、`doc_id`、分页 / 出参：`Resp[Page[SdsReqdObj]]`

### GET `/sds_reqd/get_sds_reqd`
- 权限：`sds_doc_view` / 入参：Query `id`(默认0) / 出参：`Resp[SdsReqdObj]`（含 logics）/ 错误：`msg_obj_null`

---

## 三、`api_sds_trace.py`（prefix `/sds_trace`）

### POST `/sds_trace/update_sds_trace`
- 权限：`sds_doc_edit` / 入参：Body `SdsTraceForm`（有 id 更新/无 id 新增）
- 错误：有 id 但记录不存在、DB 异常

### GET `/sds_trace/list_sds_trace`
- 权限：`sds_doc_view` / 入参：Query `prod_id`、`doc_id`、分页、`from_sync`(bool 默认 false)
- 出参：`Resp[Page[SdsTraceObj]]`

### GET `/sds_trace/get_sds_trace`
- 权限：`sds_doc_view` / 入参：Query `id`(默认0) / 出参：`Resp[SdsTraceObj]` / 错误：`msg_obj_null`

---

## 四、`api_rcm.py`（prefix `/rcm`）

### RcmForm / RcmObj
| 字段 | 类型 | 含义 |
|------|------|------|
| id | int | ID |
| code | str | 编号 |
| description | str | 描述 |
| proof | str | 体现证据 |
| note | str | 备注 |
| create_time（Obj） | datetime | 创建时间 |

### 端点
| M | 路径 | 权限 | 入参 | 出参/错误 |
|---|------|------|------|-----------|
| POST | /rcm/add_rcm | rcm_edit | Body RcmForm | code 重复、DB 异常 |
| DELETE | /rcm/delete_rcm | rcm_edit | Query id | 同时删 ProdRcm |
| POST | /rcm/update_rcm | rcm_edit | Body RcmForm（需 id） | 不存在、DB 异常 |
| GET | /rcm/list_rcm | rcm_view∨srs_doc_view∨haz_view∨prod_rcm_view | fuzzy(code/description/proof/note)、分页 | `Page[RcmObj]` |
| GET | /rcm/get_rcm | rcm_view | Query id | `msg_obj_null` |
| GET | /rcm/export_rcms | rcm_view | 同 list | xlsx 流 |
| POST | /rcm/import_rcms | rcm_edit | File file(必填) | data.count |

---

## 五、`api_haz.py`（prefix `/haz`）

### HazForm / HazObj
| 字段 | 类型 | 含义 |
|------|------|------|
| id | int | ID |
| code | str | 编号 |
| source / event / situation / damage | str | 来源/事件/情况/伤害 |
| init_rate | int | 初始风险等级 |
| init_degree / init_level | str | 初始危害等级/风险水平 |
| deal | str | 处置 |
| rcms | str | RCMS |
| evidence | str | 证据 |
| cur_rate | int | 剩余风险等级 |
| cur_degree / cur_level | str | 剩余危害等级/风险水平 |
| benefit_flag | int | 效益标志 |
| category | str | 分类 |
| create_time（Obj） | datetime | |

### 端点
| M | 路径 | 权限 | 备注 |
|---|------|------|------|
| POST | /haz/add_haz | haz_edit | code 重复、DB 异常 |
| DELETE | /haz/delete_haz | haz_edit | 删 ProdHaz |
| POST | /haz/update_haz | haz_edit | 需 id |
| GET | /haz/list_haz | haz_view∨prod_haz_view | fuzzy、分页 → `Page[HazObj]` |
| GET | /haz/get_haz | haz_view | `msg_obj_null` |
| GET | /haz/export_hazs | haz_view | xlsx 流 |
| POST | /haz/import_hazs | haz_edit | 模板第 3 行起读；data.count |

---

## 六、`api_cst.py`（prefix `/cst`）

### CstForm / CstObj
| 字段 | 类型 | 含义 |
|------|------|------|
| id | int | ID |
| code | str | 编号 |
| category | str | 分类 |
| module | str | 模块 |
| connection | str | 通信方式 |
| description | str | 描述 |
| harm | str | 危害后果 |
| create_time（Obj） | datetime | |

### 端点
| M | 路径 | 权限 | 备注 |
|---|------|------|------|
| POST | /cst/add_cst | cst_edit | code 重复、DB 异常 |
| DELETE | /cst/delete_cst | cst_edit | 删 ProdCst |
| POST | /cst/update_cst | cst_edit | 需 id |
| GET | /cst/list_cst | cst_view∨prod_cst_view | fuzzy(code/module/connection/description/harm) → `Page[CstObj]` |
| GET | /cst/get_cst | cst_view | |
| GET | /cst/export_csts | cst_view | xlsx 流 |
| POST | /cst/import_csts | cst_edit | 第 2 行起读；data.count |
