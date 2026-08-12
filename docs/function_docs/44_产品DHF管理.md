# 产品 DHF 管理（设计历史文件）

## 1. 功能概述

按产品维护设计历史文件清单（文件编号 code + 文件名称 name），用于产品资料管理。

- 菜单：「产品管理 → 基本信息 → 产品DHF管理」`/prod_dhfs`，权限 `prod_dhf_view` / `prod_dhf_edit`。

---

## 2. 用户操作流程

1. **列表页** `/prod_dhfs`：按**产品**一行展示（名称、完整版本、发布版本、型号、DHF 条数）；**仅展示 DHF 条数 > 0 的产品**，删除全部条目后该行从列表消失；模糊搜索产品；行内 **查看 / 编辑 / 复制 / 删除** 进入或操作该产品 DHF；**删除**清空该产品全部 DHF 条目（无条目时禁用）；**复制**仅可复制到**尚无 DHF** 的目标产品版本（可同产品名称不同完整版本；禁止源相同版本、禁止目标已有 DHF）；顶部 **新增** 选产品后进入编辑页。
2. **详情页** `/prod_dhfs/view/:prodId`（只读）或 `/prod_dhfs/edit/:prodId`（可编辑）：顶部 **产品名称 + 完整版本** 下拉切换产品；展示当前产品下 DHF 清单（文件编号、文件名称）；编辑页**单击编号/名称内联编辑，失焦自动保存**；行内图标新增/删除；支持 Excel 导入/导出、批量删除；切换产品后路由 `prod_id` 同步更新。

---

## 3. 前端实现

- 列表页：`prod_risk/ProdDhfs.tsx`（产品分组列表）
- 详情页：`prod_risk/ProdDhfDetail.tsx`（单产品 DHF 维护，查看/编辑两路由）
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
| POST | `/prod_dhf/copy_prod_dhfs` | Body: source_prod_id, target_product_id | **目标已有 DHF 拒绝**；**source=target 拒绝**；仅写入空目标 |
| POST | `/prod_dhf/delete_prod_dhfs_by_prod_id` | Body: prod_id | 删除该产品全部 DHF 条目 |

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
