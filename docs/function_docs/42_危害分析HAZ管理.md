# 危害分析（HAZ）管理

## 1. 功能概述

HAZ 基础数据库（危害/风险分析行），含初始/剩余风险评估（概率、程度、水平），通过 `rcms` 字段（RCM 编号串）关联控制措施。

---

## 2. 用户操作流程

`/hazs` → 维护危害编号、来源、事件、情况、伤害、初始/剩余风险（概率 1–5、程度 A–E、水平三档）、处置、RCM 多选、证据、效益标志、分类。选 RCM 时前端自动把各 RCM 描述拼成 `deal`。导入/导出 Excel。

---

## 3. 前端实现

- 页面：`pages/basedata/Hazs.tsx`
- 导出常量：`HAZ_RATES`、`HAZ_DEGREES`、`HAZ_LEVELS`（水平 value `"1"|"2"|"3"` 对应三档中文）
- `doSearchRcms` → `list_rcm`（1000 条）供多选

---

## 4. 后端接口

| 方法 | 路径 | 入参要点 | 返回 |
|------|------|----------|------|
| POST | `/haz/add_haz` | HazForm 全字段 | Resp |
| POST | `/haz/update_haz` | 含 id；`None` 字段不更新 | Resp |
| DELETE | `/haz/delete_haz` | id | 级联 prod_haz |
| GET | `/haz/list_haz` | fuzzy 多字段 OR | Page[HazObj]（prod_haz_view 可读） |
| GET/POST | export_hazs / import_hazs | 导入从**第 3 行**起 | — |

---

## 5. 数据库表

`haz`：code(唯一), source, event, situation, damage, init_rate/degree/level, deal, rcms(≤1024 逗号串), evidence, cur_rate/degree/level, benefit_flag, category。

---

## 6. 关键业务逻辑与规则

1. `rcms` 存 **RCM 编号文本**，非 id（多对多逻辑关系，非 FK）。
2. 导出 `benefit_flag` 转「是/否」。
3. 删除 HAZ 级联删 prod_haz。
4. `list_haz` 对 `prod_haz_view` 开放（供产品页选主数据）。

---

## 7. 边界与特殊处理

- `init_level`/`cur_level`：前端用 1/2/3，导入/主数据也可能直接存中文（如「不可接受」）——存在混存可能。
- 更新时 `None` 字段不覆盖。

---

## 8. 修改注意事项 / 不可破坏的核心逻辑

1. **`rcms` 存编号串而非 id**，解析时按编号查 RCM，不可改成 id 关联。
2. **删除级联 prod_haz** 不可遗漏。
3. **风险水平 1/2/3 与中文混存**：读取需兼容两种，不可只认一种。
4. `update_haz` 的 `None` 不覆盖语义不可改（否则部分更新会清空字段）。
