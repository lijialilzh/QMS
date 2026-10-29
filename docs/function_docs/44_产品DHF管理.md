# 产品 DHF 管理（设计历史文件）

## 1. 功能概述

按产品维护设计历史文件清单（文件编号 code + 文件名称 name），用于产品资料管理。

---

## 2. 用户操作流程

`/prod_dhfs` → 选产品 → CRUD → Excel 导入（指定 prod_id）→ 批量删除。「新增」弹窗选完产品和版本后，在本页展开该产品的 DHF 表。该产品已经有 DHF 条目时，确定提示「该产品已有 DHF 清单，不能重复新增」，弹窗不关。该产品还没有 DHF 条目时也要留在列表里并展开，不能因为条数为 0 被滤掉后又回到空列表。表格为空时，「暂无数据」旁有「新增」，打开与行内「+」相同的新增弹窗（文件编号、文件名称）。「查看 / 编辑」在本页行下展开（展开时只留当前产品行），「收起」回到产品列表。

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
2. 版本复制勾选的 DHF：`TX-TF-` 后的代号段写成目标版本的产品代码（产品代码末尾 4 位已按新完整版本换过）。`TX-QP-` 编号保持原样。版本管理保存产品代码后，该版本已有 DHF 的这一段改成新产品代码。打开 DHF 清单时按各版本当前产品代码再对齐一次。
3. 可见性：非管理员无 prod_id 时按 `prod_user` **或** `Product.create_user_id == op_user`（兼容历史）。
4. 复制某一份文档且新版本是 A1、A2 及以后时，在目标产品 DHF 增加一条。编号把原文件编号末尾的版本段改成新版本（`-A0` 改为 `-A1`）；末尾不是这种版本段时，在原编号后加上 `-A1`。名称沿用原编号对应的 DHF 名称，对不上再用文档名称去匹配。同一产品下这个编号已经有了就不再加。A0 复制不加。

---

## 7. 修改注意事项 / 不可破坏的核心逻辑

1. `(prod_id, code)` 唯一不可放开。
2. 导入「按 code 更新、否则按 name 回写 code」的双匹配逻辑不可简化。
3. DHF 与 RCM/HAZ 无直接关联，不要强加关系。
