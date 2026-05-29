# SDS 设计条目管理（设计列表 / sds_reqd）

## 1. 功能概述

为每条需求维护详细设计（概述、功能细节、逻辑文本、逻辑图、输入/输出/接口），存于 `sds_reqd`，逻辑图存于 `logic`。

---

## 2. 用户操作流程

1. 详情页树节点 `ref_type=sds_reqds`（标准模板「6.6 功能设计」）→ 打开「设计列表」弹框。
2. 按产品 + SDS 版本查询。
3. 编辑：概述、功能、逻辑文本、逻辑图、输入/输出/接口。
4. 保存 → `update_sds_reqd`；删逻辑图 → `delete_sds_logic`。

---

## 3. 前端实现

| 函数 / 组件 | 说明 |
|-------------|------|
| `SdsDocDetail.loadReqdListData()` | 弹框数据 |
| `syncMissingReqdNodes()` | 按需求列表补全第 6 章功能设计子树 |
| `SdsReqds.tsx` `DetailDlg` | 编辑表单 + 逻辑图 Upload（独立页，无路由） |

---

## 4. 后端接口

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| GET | `/sds_reqd/list_sds_reqd` | prod_id, doc_id, 分页 | Page[SdsReqdObj] |
| GET | `/sds_reqd/get_sds_reqd` | id | SdsReqdObj（含 logics[]） |
| POST | `/sds_reqd/update_sds_reqd` | Form: 文本字段 + new_imgs[] + new_logics/alt_logics(JSON) | 成功/失败 |
| DELETE | `/sds_reqd/delete_sds_logic` | logic_id | 成功/失败 |

---

## 5. 数据库表

- `sds_reqd`：唯一 `(doc_id, req_id)`；六段字段 `overview, func_detail, logic_txt, intput, output, interface`。
- `logic`：reqd_id, txt, filename, img_url（一对多）。

---

## 6. 关键业务逻辑与规则

### 6.1 行初始化
- `__ensure_sds_reqd_rows`：列表时自动补齐 `SrsReq.type_code != "reqd"` 的空行。

### 6.2 列表展示优先级（核心）
| 场景 | 数据来源 |
|------|----------|
| 已 Word 导入 SDS（`__has_effective_sds_content`） | 优先从 SDS 树解析字段；解析不到回退 SRS |
| 未导入 SDS | 展示 SRS 需求细节；DB 手工值兜底 |
| 逻辑图 | 手动上传 > 树内抽取 > `/` |

### 6.3 从 SDS 树抽取
- `__extract_imported_fields`：按 `sds_code`/标题匹配节点，识别 overview/func_detail/logic/io/interface 标签段落。

### 6.4 排序
- `__resort_rows`：SDS 树章节位置 → 追溯 location → SRS 类型 → 需求编号。

### 6.5 type_code 与 req_id
- 列表 JOIN `srs_req`，过滤 `type_code != "reqd"` 自动行。
- 创建 SDS 时排除 `type_code == "2"`（其他需求不进初始行）。
- `req_id` 是 `srs_req.id`，非字符串编号。

---

## 7. 边界与特殊处理

- 仅图题（「图23 xxx」）不作为 `logic_txt`。
- `intput` 为历史拼写，全栈一致保留。

---

## 8. 修改注意事项 / 不可破坏的核心逻辑

1. **列表展示优先级（导入树 > SRS 回退 > DB 兜底）** 不可改动顺序。
2. **`intput` 字段名**全栈一致，禁止改成 input。
3. **req_id = srs_req.id（整数）**，不是编号字符串。
4. 行初始化与类型过滤（排除 reqd / type_code=2）不可改。
