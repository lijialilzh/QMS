# 网络安全威胁（CST）管理

## 1. 功能概述

CST 基础数据库（网络安全相关原因/条件，IEC 62443 风格分类）。与 HAZ/RCM **无库表关联**，用于产品网络安全风险清单（prod_cst）。

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
| POST | `/cst/add_cst` | CstForm: code, category, module, connection, description, harm | Resp |
| POST | `/cst/update_cst` | 含 id | Resp |
| DELETE | `/cst/delete_cst` | id | 级联 prod_cst |
| GET | `/cst/list_cst` | fuzzy?, 分页 | Page[CstObj]（prod_cst_view 可读） |
| GET | `/cst/get_cst` | id | CstObj |
| GET/POST | export_csts / import_csts | — | 同 RCM 模式 |

权限：`cst_edit`（写）、`cst_view`（读）。

---

## 5. 数据库表

`cst`：code(唯一), category, module, connection, description, harm。

---

## 6. 关键业务逻辑与规则

- `code` 唯一。
- 与 HAZ/RCM 无主数据层关联（区别于危害分析）。
- 删除 CST 级联删 prod_cst。

---

## 7. 修改注意事项 / 不可破坏的核心逻辑

1. **CST 与 HAZ 是不同风险维度**（网络安全 vs 医疗器械危害），不可在需求/文档中混为一张表。
2. 删除级联 prod_cst 不可遗漏。
3. 分类 9 类为前端固定枚举，新增需前端同步。
