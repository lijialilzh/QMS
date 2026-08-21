# 产品 DHF 管理（设计历史文件）

## 1. 功能概述

按产品维护设计历史文件清单（文件编号 code + 文件名称 name），用于产品资料管理。

---

## 2. 用户操作流程

`/prod_dhfs` → 选产品 → CRUD → Excel 导入（指定 prod_id）→ 批量删除。

---

## 3. 前端实现

- 页面：`prod_risk/ProdDhfs.tsx`
- API：`api/ApiProdDhf.ts`

---

## 4. 后端接口

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| POST | `/prod_dhf/add_prod_dhf` / `update_prod_dhf` | ProdDhfForm: prod_id, code, name | 同产品 code 唯一 |
| DELETE | `/prod_dhf/delete_prod_dhf` | 单 id | — |
| POST | `/prod_dhf/delete_prod_dhfs` | ids[] | 批量 |
| GET | `/prod_dhf/list_prod_dhf` | prod_id?, 分页 | **有 offset/limit 真分页** |
| GET | `/prod_dhf/get_prod_dhf` | id | — |
| POST | `/prod_dhf/import_prod_dhfs` | Form: prod_id, file | count/created/updated_by_code/updated_by_name |

---

## 5. 数据库表

`prod_dhf`：唯一 `(prod_id, code)`。

---

## 6. 关键业务逻辑与规则

1. 导入：扫描前 10 行识别「文件编号/名称」列；按 code 更新，否则按 **name** 回写 code；忽略隐藏 sheet。
2. 可见性：非管理员无 prod_id 时按 `prod_user` **或** `Product.create_user_id == op_user`（兼容历史）。

---

## 7. 修改注意事项 / 不可破坏的核心逻辑

1. `(prod_id, code)` 唯一不可放开。
2. 导入「按 code 更新、否则按 name 回写 code」的双匹配逻辑不可简化。
3. DHF 与 RCM/HAZ 无直接关联，不要强加关系。
