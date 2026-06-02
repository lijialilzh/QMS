# 风险控制措施（RCM）管理

## 1. 功能概述

RCM 基础数据库（风险控制措施），被 HAZ（以编号串引用）、SRS 需求（经 req_rcm）、产品级 prod_rcm 引用。

---

## 2. 用户操作流程

基础数据 → RCM（`/rcms`）→ 模糊搜索 → 分页列表 → 新增/编辑（编号、描述、体现证据、备注）→ 单条/批量删除 → 导出/导入 Excel。

---

## 3. 前端实现

- 页面：`pages/basedata/Rcms.tsx`
- API：`api/ApiRcm.ts`
- 关键：`DetailDlg`（add/update/get_rcm）、`doSearch`→list_rcm、`doBatchDelete`（**逐条** delete_rcm）

---

## 4. 后端接口

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| POST | `/rcm/add_rcm` | RcmForm: id?, code, description, proof, note | Resp |
| POST | `/rcm/update_rcm` | 含 id | Resp |
| DELETE | `/rcm/delete_rcm` | id | 级联删 prod_rcm |
| GET | `/rcm/list_rcm` | fuzzy?, 分页 | Page[RcmObj] |
| GET | `/rcm/get_rcm` | id | RcmObj |
| GET | `/rcm/export_rcms` | 同 list | xlsx |
| POST | `/rcm/import_rcms` | file | {count} |

权限：`rcm_edit`（写）；`list_rcm` 另允 `srs_doc_view`、`haz_view`、`prod_rcm_view`。

---

## 5. 数据库表

`rcm`：code(唯一), description, proof, note。

---

## 6. 关键业务逻辑与规则

1. `code` 唯一；重复返回 `msg_obj_exist`。
2. 删除 RCM 同时删除所有 `prod_rcm` 关联（逻辑级联）。
3. 导入：首 sheet，第 2 行起；存在则更新否则插入。

---

## 7. 边界与特殊处理

- 导入兼容 Excel 公式（`data_only` + raw 公式串）。
- 前端批量删除为**逐条**调用（无批量 API）。

---

## 8. 修改注意事项 / 不可破坏的核心逻辑

1. **删除 RCM 必须级联删 prod_rcm**（无 DB 外键），不可遗漏。
2. `code` 唯一是 HAZ/需求/产品引用的基础，不可放开。
3. `list_rcm` 多权限 OR 开放是为其它模块下拉，不可收紧。
