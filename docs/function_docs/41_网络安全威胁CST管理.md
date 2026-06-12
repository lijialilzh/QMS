# 网络安全威胁（CST）管理

## 1. 功能概述

CST 基础数据库（网络安全相关原因/条件，IEC 62443 风格分类）。与 HAZ **无库表关联**；与 RCM 通过 `cst_rcm` 关联表建立**多对多关联**（在 CST 总表维护每条威胁的关联 RCM）。用于产品网络安全风险清单（prod_cst）。

---

## 2. 用户操作流程

`/csts` → 模糊搜索 → CRUD → 导入/导出 Excel。分类下拉为前端写死 9 类（认证、授权、保密性等）。

---

## 3. 前端实现

- 页面：`pages/basedata/Csts.tsx`
- API：`api/ApiCst.ts`

---

## 4. 后端接口

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| POST | `/cst/add_cst` | CstSaveForm: code, category, module, connection, description, harm, **rcm_ids[]** | Resp |
| POST | `/cst/update_cst` | 含 id；`rcm_ids` 显式传入(含空数组)则全量重置关联，未传则不动 | Resp |
| DELETE | `/cst/delete_cst` | id | 级联 prod_cst、cst_rcm |
| GET | `/cst/list_cst` | fuzzy?, 分页 | Page[CstObj]（含 `rcms`/`rcm_ids`，prod_cst_view 可读） |
| GET | `/cst/get_cst` | id | CstObj（含 `rcms`/`rcm_ids`） |
| GET/POST | export_csts / import_csts | — | 同 RCM 模式（不含 RCM 关联列） |

权限：`cst_edit`（写）、`cst_view`（读）。

---

## 5. 数据库表

`cst`：code(唯一), category, module, connection, description, harm。

`cst_rcm`（CST↔RCM 多对多关联表）：cst_id, rcm_id，`(cst_id, rcm_id)` 唯一。删除 CST 级联清理。

---

## 6. 关键业务逻辑与规则

- `code` 唯一。
- 与 HAZ 无主数据层关联（区别于危害分析）；与 RCM 通过 `cst_rcm` 多对多关联，在 CST 总表用多选维护，列表/详情返回 `rcms`(含 code/description) 与 `rcm_ids`。
- 删除 CST 级联删 prod_cst、cst_rcm。
- CST↔RCM 关联仅为 CST 总表新增能力，**不改动 RCM、HAZ、prod_cst 模块的既有逻辑**。

---

## 7. 修改注意事项 / 不可破坏的核心逻辑

1. **CST 与 HAZ 是不同风险维度**（网络安全 vs 医疗器械危害），不可在需求/文档中混为一张表。
2. 删除级联 prod_cst 不可遗漏。
3. 分类 9 类为前端固定枚举，新增需前端同步。
