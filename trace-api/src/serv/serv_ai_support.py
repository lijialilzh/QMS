#!/usr/bin/env python
# encoding: utf-8


import re
import logging
from pathlib import Path

from ..obj import Resp

logger = logging.getLogger(__name__)

# 用户手册目录：trace-api/src-res/manuals
_MANUAL_DIR = Path(__file__).resolve().parents[2] / "src-res" / "manuals"
# AI 客服知识库目录（"是什么/解决什么/怎么用"四段式讲解，优先级高于手册）
# 候选路径按优先级顺序，命中第一个存在且非空的目录即用：
#   1) /docs/function_docs/        —— docker-compose 把仓库 docs 挂到容器（推荐，改 KB 重启即生效）
#   2) parents[3]/docs/function_docs —— 仓库根（本地直接跑 python 时的开发期回退）
#   3) trace-api/src-res/ai_kb/    —— 镜像内置兜底资源（容器没挂 docs 时使用）
_KB_DIR_DOCS_MOUNT = Path("/docs/function_docs")
_KB_DIR_DEV = Path(__file__).resolve().parents[3] / "docs" / "function_docs"
_KB_DIR_RES = Path(__file__).resolve().parents[2] / "src-res" / "ai_kb"
_KB_FILE_GLOB = "AI客服知识库_*.md"

# 检索相关度阈值（query 二元组覆盖率），低于此值视为未命中
_SCORE_THRESHOLD = 0.18
# 返回的最相关章节数量上限
_TOP_N = 2
# 第 2 条起相对首条的最低分数比例，低于则不返回（剔除近似但不相关的干扰项）
_REL_RATIO = 0.82
# 单条回答正文最大长度，超出截断
_MAX_CONTENT_LEN = 900
# 未命中时返回的"猜你想问"数量
_SUGGEST_N = 3
# 猜你想问的最低分阈值（不必很相关，能引导即可）
_SUGGEST_THRESHOLD = 0.05

_PUNCT_RE = re.compile(r"[\s\u3000`~!@#\$%\^&\*\(\)\-_=\+\[\]\{\}\\\|;:'\"，。、；：？！…—·《》〈〉「」『』（）【】,\.\?/<>]+")

# 模块级知识库缓存
_CHUNKS = None
# AI 客服知识库（四段式条目）缓存
_KB_ITEMS = None


def _norm(text: str) -> str:
    return _PUNCT_RE.sub("", str(text or "")).lower()


def _bigrams(text: str):
    s = _norm(text)
    if len(s) < 2:
        return {s} if s else set()
    return {s[i:i + 2] for i in range(len(s) - 1)}


def _manual_name(filename: str) -> str:
    name = filename.rsplit(".", 1)[0]
    # 形如 90_用户手册_总览与登录 -> 用户手册_总览与登录
    name = re.sub(r"^\d+_", "", name)
    return name.replace("_", " ")


def _split_sections(md_text: str, manual: str):
    sections = []
    h1 = ""
    h2 = ""
    cur_title = ""
    cur_parent = ""
    cur_buf = []

    def flush():
        if not cur_title:
            return
        body = "\n".join(cur_buf).strip()
        if not body:
            return
        seen = []
        for p in [manual, cur_parent, cur_title]:
            if p and p not in seen:
                seen.append(p)
        section = " > ".join(seen)
        sections.append({
            "manual": manual,
            "title": cur_title,
            "section": section,
            "headings": f"{cur_parent} {cur_title}".strip(),
            "content": body,
        })

    for line in md_text.splitlines():
        if re.match(r"^#\s+\S", line):
            flush()
            h1 = line.lstrip("# ").strip()
            h2 = ""
            cur_title = ""
            cur_parent = ""
            cur_buf = []
            continue
        if line.startswith("## "):
            flush()
            h2 = line[3:].strip()
            cur_title = h2
            cur_parent = h1
            cur_buf = [line]
            continue
        if line.startswith("### "):
            flush()
            cur_title = line[4:].strip()
            cur_parent = h2 or h1
            cur_buf = [line]
            continue
        cur_buf.append(line)
    flush()
    return sections


def _load_chunks():
    global _CHUNKS
    if _CHUNKS is not None:
        return _CHUNKS
    chunks = []
    try:
        files = sorted(_MANUAL_DIR.glob("*.md")) if _MANUAL_DIR.exists() else []
        for f in files:
            try:
                text = f.read_text(encoding="utf-8")
            except Exception:
                logger.exception("read manual failed: %s", f)
                continue
            manual = _manual_name(f.name)
            for sec in _split_sections(text, manual):
                # 跳过清洗后无实质内容的空壳章节（仅父标题、无正文），避免其占据检索名次
                if len(_clean_steps(sec.get("content", ""), sec.get("title", ""))) < 8:
                    continue
                # 跳过“第X部分”这类只有导语、无操作步骤的分隔/容器章节
                if re.match(r"^第[一二三四五六七八九十百\d]+部分", str(sec.get("title", "")).strip()):
                    continue
                htext = _clean_for_index(sec.get("headings") or sec["title"])
                ctext = _clean_for_index((sec.get("headings") or "") + "。" + sec["content"])
                sec["title_bi"] = _bigrams(htext)
                sec["content_bi"] = _bigrams(ctext)
                leaf_title = re.sub(r"^[\d.]+\s*", "", str(sec["title"]))
                leaf_title = re.sub(r"（[^）]*）|\([^)]*\)", "", leaf_title)
                sec["leaf_title_bi"] = _bigrams(_clean_for_index(leaf_title))
                sec["is_boundary"] = "边界测试" in str(sec["title"])
                chunks.append(sec)
    except Exception:
        logger.exception("load manuals failed")
    _CHUNKS = chunks
    logger.info("ai_support knowledge loaded: %s sections from %s", len(chunks), str(_MANUAL_DIR))
    return _CHUNKS


def _leaf_similar(a: set, b: set) -> bool:
    # 两个叶子标题是否近义：交集占较短一方的比例很高（一个几乎是另一个的子集）
    if not a or not b:
        return False
    return len(a & b) / min(len(a), len(b)) >= 0.8


def _score(q_bi, chunk):
    if not q_bi:
        return 0.0
    content_hit = len(q_bi & chunk["content_bi"]) / len(q_bi)
    title_hit = len(q_bi & chunk["title_bi"]) / len(q_bi)
    # 叶子标题命中率(recall) + 精确度(precision)：
    # precision 惩罚标题里 query 之外的多余字，区分“新建产品”与“新建产品线”这类高度重叠却不同功能的章节
    leaf = chunk.get("leaf_title_bi") or set()
    if leaf:
        inter = len(q_bi & leaf)
        leaf_recall = inter / len(q_bi)
        leaf_prec = inter / len(leaf)
    else:
        leaf_recall = leaf_prec = 0.0
    score = content_hit + title_hit * 0.6 + leaf_recall * 0.5 + leaf_prec * 1.1
    # 边界测试章节是测试用例而非操作步骤：用户未明确问“边界/测试”时大幅降权
    if chunk.get("is_boundary") and not (("边界" in q_bi) or ("测试" in q_bi)):
        score *= 0.4
    return score


_FILE_PATH_RE = re.compile(r"[\w./-]+\.(?:tsx|ts|jsx|js|py|json|less|md)\b", re.I)
_TABLE_SEP_RE = re.compile(r"^[\-\|\:\s]+$")
_HEADING_RE = re.compile(r"^#{1,6}\s*")
_QUOTE_RE = re.compile(r"^>\s*")
_INLINE_CODE_RE = re.compile(r"`[^`]*`")
_CODE_PATH_RE = re.compile(r"\.(?:tsx|ts|jsx|js|py|json|less|md)\b", re.I)


# 缩写同义词归一：把英文缩写补成中文含义，便于“需求文档/设计文档”等口语化提问命中
_SYNONYMS = (
    (r"SRS", "SRS需求规格说明文档"),
    (r"SDS", "SDS详细设计文档"),
    (r"RCM", "RCM风险控制矩阵风险控制措施"),
    (r"HAZ", "HAZ危害"),
    (r"CST", "CST网络安全威胁"),
    (r"FMEA", "FMEA失效模式风险分析"),
    (r"UDI", "UDI唯一器械标识"),
    (r"DHF", "DHF设计历史文件"),
    (r"QMS", "QMS质量管理系统"),
)

# 词形归一：把口语化词转成知识库里的标准词，提升命中率
_PHRASE_NORMALIZE = (
    ("产品线", "项目"),
    ("注册项目", "项目"),
    ("账号", "用户"),
    ("员工", "用户"),
    ("忘记密码", "重置密码"),
    ("忘了密码", "重置密码"),
    ("找回密码", "重置密码"),
    ("密码重置", "重置密码"),
    ("注销", "退出登录"),
    ("拓扑图", "物理拓扑图"),
    ("结构图", "体系结构图"),
    ("流程图", "网络安全流程图"),
    ("需求文档", "SRS需求规格说明文档"),
    ("需求规格", "SRS需求规格说明文档"),
    ("设计文档", "SDS详细设计文档"),
    ("详细设计", "SDS详细设计文档"),
    ("控制措施", "RCM风险控制"),
    ("风险报告", "风险管理报告"),
)

# 意图关键词：决定回答应展开哪些段落
_INTENT_IS_WHAT = ("是什么", "干什么", "做什么", "用来", "用途", "啥东西", "干嘛的", "什么功能", "干啥", "什么意思")
_INTENT_WHY = ("为什么", "为啥", "解决什么", "有什么用", "干嘛要", "意义", "好处")
_INTENT_HOW = ("怎么", "如何", "怎样", "步骤", "操作", "流程", "咋", "怎么办")
_INTENT_WHERE = ("在哪", "哪里", "入口", "菜单", "找不到", "在哪儿", "哪个页面")


def _expand_syn(s: str) -> str:
    # 对缩写做一次同义扩展（区分大小写不敏感），仅追加中文含义、不删除原词
    s = str(s or "")
    for kw, full in _SYNONYMS:
        s = re.sub(kw, full, s, flags=re.I)
    # 口语化短语归一：把"产品线/账号/忘记密码"等替换为知识库里使用的标准词
    for kw, full in _PHRASE_NORMALIZE:
        if kw in s:
            s = s.replace(kw, full)
    # “新增/新建/创建”视为同一操作，统一归一，避免口语化提问错配
    s = s.replace("新增", "新建").replace("创建", "新建")
    return s


def _clean_for_index(s: str) -> str:
    # 建索引前清洗：剥离“（菜单：…）”括注与反引号路径，避免菜单路径文字污染匹配
    s = str(s or "")
    s = re.sub(r"（菜单[^）]*）", "", s)
    s = re.sub(r"`[^`]*`", "", s)
    return _expand_syn(s)


def _strip_inline_code(s: str) -> str:
    # 反引号内若是路由/源码路径则整体删除；否则保留内容、仅去掉反引号（如 .docx、+ 等有用信息）
    def repl(m):
        inner = m.group(1).strip()
        if inner.startswith("/") or _CODE_PATH_RE.search(inner):
            return ""
        return inner
    return re.sub(r"`([^`]*)`", repl, str(s or ""))


def _clean_section(section: str) -> str:
    parts = []
    for p in str(section or "").split(">"):
        p = _INLINE_CODE_RE.sub("", p)
        p = re.sub(r"（[^）]*）", "", p)
        p = re.sub(r"\([^)]*\)", "", p)
        p = re.sub(r"\s+", " ", p).strip()
        if p:
            parts.append(p)
    return " > ".join(parts)


def _norm_loose(s: str) -> str:
    # 用于标题去重：去反引号、括注后归一化
    s = _INLINE_CODE_RE.sub("", str(s or ""))
    s = re.sub(r"（[^）]*）|\([^)]*\)", "", s)
    return _norm(s)


def _strip_bracket_garbage(s: str) -> str:
    # 去反引号后残留的悬空标点与空括号，如 “（只读，）”->“（只读）”，“()”->“”
    s = re.sub(r"[，、,；;]\s*(?=[）)])", "", s)
    s = re.sub(r"（\s*）|\(\s*\)", "", s)
    return s


def _strip_field_name(name: str) -> str:
    # 去掉字段名里的接口标识括注，如 “型号(type_code)”->“型号”
    name = _strip_inline_code(name)
    name = re.sub(r"\([^)]*\)", "", name)
    name = re.sub(r"（[^）]*）", "", name)
    return name.strip()


def _convert_table(rows: list) -> list:
    # 把 markdown 表格转成用户可读的逐项说明
    cells_rows = []
    for ln in rows:
        if _TABLE_SEP_RE.match(ln.strip()):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        cells_rows.append(cells)
    if len(cells_rows) < 2:
        return []
    header = cells_rows[0]
    data = cells_rows[1:]

    def find_idx(keys):
        for i, h in enumerate(header):
            if any(k in h for k in keys):
                return i
        return -1

    req_idx = find_idx(["必填"])
    desc_idx = find_idx(["说明"])
    out = []
    for cells in data:
        if not any(c for c in cells):
            continue
        name = _strip_field_name(cells[0]) if cells else ""
        if not name:
            continue
        seg = f"· {name}"
        if req_idx >= 0 and len(cells) > req_idx:
            seg += "（必填）" if ("是" in cells[req_idx]) else "（选填）"
        desc = ""
        if desc_idx >= 0 and len(cells) > desc_idx:
            desc = cells[desc_idx]
        elif desc_idx < 0 and len(cells) >= 2:
            desc = cells[1]
        desc = re.sub(r"\s+", " ", _strip_inline_code(desc)).strip()
        hint = _field_input_hint(desc)
        if hint:
            seg += f"：{hint}"
        out.append(seg)
    return out


_CONSTRAINT_KW = (
    "唯一", "必须", "不能为空", "非空", "组合", "联合", "全局",
    "≤", "不超过", "截断", "长度", "只能", "禁止",
)


def _strip_constraint(text: str) -> str:
    # 去掉字段说明里的限制/约束子句（如“与完整版本组合后必须唯一”“全局唯一”），只留填写说明
    segs = re.split(r"[，,；;]", str(text or ""))
    kept = [s for s in segs if s.strip() and not any(k in s for k in _CONSTRAINT_KW)]
    return "，".join(kept)


# 字段输入方式识别（有序：先匹配更具体的）。字段说明只保留输入方式，去掉啰嗦描述
_INPUT_HINTS = (
    ("下拉", "下拉选择"),
    ("手工输入", "手动输入"),
    ("手动输入", "手动输入"),
    ("文本框", "手动输入"),
    ("多行文本", "多行输入"),
    ("勾选", "勾选"),
    ("复选", "勾选"),
    ("单选", "单选"),
    ("选择文件", "上传文件"),
    ("上传", "上传文件"),
    ("选择日期", "选择日期"),
    ("日期", "选择日期"),
)


def _field_input_hint(text: str) -> str:
    t = str(text or "")
    for kw, label in _INPUT_HINTS:
        if kw in t:
            return label
    return ""


_VALID_DROP_KW = (
    "留空", "未填", "为空", "红色提示", "无法提交", "校验拦截", "请选择文件",
    "重复", "已存在", "不一致", "原密码错误",
    "不允许", "被引用", "不能删除", "不能重置", "不能删除自己",
)


def _is_validation_line(s: str) -> bool:
    # 校验/异常分支行：含校验关键词且不是“成功结果”说明，则视为校验内容，不进入回答
    if "成功" in s:
        return False
    return any(k in s for k in _VALID_DROP_KW)


def _clean_steps(content: str, title: str = "") -> str:
    out = []
    table_buf = []
    title_key = _norm_loose(title)
    skip_section = False

    def flush_table():
        for seg in _convert_table(table_buf):
            out.append(seg)
        table_buf.clear()

    for raw in str(content or "").splitlines():
        s = raw.strip()
        # 小节标题：进入/退出“边界测试”跳过区（边界测试是测试用例，不作操作步骤）
        m_head = re.match(r"^#{2,6}\s*(.+)$", s)
        if m_head:
            flush_table()
            skip_section = "边界测试" in m_head.group(1)
            if skip_section:
                continue
        elif skip_section:
            continue
        # 收集表格块（含表头/分隔/数据），到非表格行时统一转换
        if s.startswith("|"):
            table_buf.append(s)
            continue
        flush_table()
        if not s:
            if out and out[-1] != "":
                out.append("")
            continue
        # markdown 分隔线
        if re.match(r"^[-*_=]{3,}$", s):
            continue
        # 含文件路径（接口/源码）的行
        if _FILE_PATH_RE.search(s):
            continue
        s = _strip_inline_code(s)
        # 是否为 markdown 子节标题（####/##### 等）：去掉 # 后剥离 "8.1/9.2.1" 之类的章节号，
        # 避免兜底回答里出现"8.1 操作 / 9.1 顶栏"这种文献式小节号
        is_subhead = bool(re.match(r"^#{2,6}\s", s))
        s = _HEADING_RE.sub("", s)
        s = _QUOTE_RE.sub("", s)
        if is_subhead:
            s = re.sub(r"^\d+(?:\.\d+)+\s*", "", s).strip()
            # 子节标题与父章节叶子重名时跳过（如 "### 3.2 基础信息" 切出的 chunk 里又包含
            # "### 3.2 基础信息" 这行，去编号后均为 "基础信息"，避免重复加粗输出）
            if s:
                title_leaf = re.sub(r"^[\d\.\s]+", "", str(title or "")).strip()
                if title_leaf and _norm_loose(s) == _norm_loose(title_leaf):
                    continue
                s = f"**{s}**"
        # 去掉校验类括注（必填项留空/红色提示/无法提交 等），只留操作说明
        s = re.sub(r"（[^（）]*(?:留空|必填项|红色提示|无法提交|否则|未填|校验)[^（）]*）", "", s)
        s = _strip_bracket_garbage(s)
        s = re.sub(r"\s+", " ", s).strip()
        if not s:
            continue
        # 跳过纯校验/异常分支行（重复、已存在、错误、不一致等），只保留操作步骤与成功结果
        if _is_validation_line(s):
            continue
        # 跳过以“若/如果”开头的条件限制分支，只保留正常操作步骤
        if re.sub(r"^[-·*]\s*", "", s).startswith(("若", "如果")):
            continue
        # 字段说明行：只保留“字段（必填/选填/只读）”+输入方式，去掉啰嗦描述
        fm = re.match(r"^(.*?（(?:必填|选填|只读)）\s*[：:])(.*)$", s)
        if fm:
            hint = _field_input_hint(fm.group(2))
            s = (fm.group(1) + hint) if hint else fm.group(1).rstrip("：: ")
        # 跳过与章节标题重复的首行
        if not out and title_key and _norm_loose(s) == title_key:
            continue
        out.append(s)
    flush_table()
    cleaned = "\n".join(out).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


# ============================================================
# AI 客服知识库（四段式条目）：是做什么的 / 解决什么问题 / 怎么用 / 相关功能
# 数据来源：docs/function_docs/AI客服知识库_*.md
# 与原手册检索并存：先尝试 KB 命中（讲解式回答），未命中再走原手册（步骤式回答）
# ============================================================

# 每个段落的 key（标题里的字段名）
_KB_FIELDS = (
    ("location", "界面位置"),
    ("ask", "用户常见问法"),
    ("what", "是做什么的"),
    ("why", "解决什么问题"),
    ("how", "怎么用"),
    ("related", "相关功能"),
)


def _split_kb_items(md_text: str, kb_name: str):
    """把 AI 客服知识库 md 拆成"功能条目"数组。
    每个 ## 一条，解析其下的 - **字段**：内容 行。"""
    items = []
    cur_title = ""
    cur_lines = []
    overview_h1 = ""

    def flush():
        if not cur_title:
            return
        body = "\n".join(cur_lines).strip()
        if not body:
            return
        # 跳过"模块总览"这种无操作步骤的概述，但保留为模块说明（用于"xxx 模块是什么"提问）
        item = _parse_kb_item(cur_title, body, kb_name, overview_h1)
        if item:
            items.append(item)

    for line in md_text.splitlines():
        s = line.rstrip()
        if s.startswith("# ") and not s.startswith("## "):
            overview_h1 = s[2:].strip()
            continue
        if s.startswith("## "):
            flush()
            cur_title = s[3:].strip()
            cur_lines = []
            continue
        # 跳过 markdown 章节分隔线（---/***/___），避免被收进字段末尾
        if re.match(r"^[-*_]{3,}$", s.strip()):
            continue
        cur_lines.append(s)
    flush()
    return items


def _parse_kb_item(title: str, body: str, kb_name: str, overview_h1: str):
    """从条目正文中抽取四段式字段。"""
    fields = {k: "" for k, _ in _KB_FIELDS}
    # 用 - **字段名**：内容 这种行抽取；内容可能跨行（直到下一个 - **xx**：或文档尾）
    pattern = re.compile(r"^\s*-\s+\*\*([^*]+)\*\*\s*[:：]\s*(.*)$")
    cur_key = ""
    cur_buf = []

    def commit():
        if not cur_key:
            return
        text = "\n".join(cur_buf).strip()
        for k, label in _KB_FIELDS:
            if cur_key == label:
                fields[k] = text
                return

    for line in body.splitlines():
        m = pattern.match(line)
        if m:
            commit()
            cur_key = m.group(1).strip()
            cur_buf = [m.group(2)] if m.group(2) else []
            continue
        if cur_key:
            cur_buf.append(line)
    commit()

    # 必备字段：至少要有"是做什么的"或"怎么用"，否则视为概述节
    if not fields["what"] and not fields["how"]:
        return None

    # 清洗叶子标题：去掉序号、括注，作为对外展示名（如"产品管理"）
    leaf = re.sub(r"^[\d\.、\s]+", "", title)
    leaf = re.sub(r"（[^）]*）|\([^)]*\)", "", leaf).strip()

    # 核心识别文本：功能名 + 标题 + "是做什么的"（不含口语化问法，用于评分）
    core_text = " ".join([leaf, title, fields.get("what", "")])
    return {
        "kb": kb_name,
        "title": title,
        "leaf": leaf,
        "module": overview_h1,
        "fields": fields,
        "core_bi": _bigrams(_clean_for_index(core_text)),
        "leaf_bi": _bigrams(_clean_for_index(leaf)),
        "ask_bi": _bigrams(_clean_for_index(fields.get("ask", ""))),
        # 门槛专用：功能名 + 原始常见问法（不做同义扩展，去泛词），判断"问的是哪个功能"
        "gate_bi": _gate_bigrams(" ".join([leaf, fields.get("ask", "")]), expand=False),
    }


def _load_kb_items():
    global _KB_ITEMS
    if _KB_ITEMS is not None:
        return _KB_ITEMS
    items = []
    # 按优先级在三个候选目录里找：挂载 docs → 开发期 docs → 镜像内置 ai_kb，命中即用，互不叠加
    candidates = []
    for kb_dir in (_KB_DIR_DOCS_MOUNT, _KB_DIR_DEV, _KB_DIR_RES):
        if kb_dir.exists():
            files = sorted(kb_dir.glob(_KB_FILE_GLOB))
            if files:
                candidates = files
                logger.info("ai_support kb dir resolved: %s (%s files)", kb_dir, len(files))
                break
    for f in candidates:
        try:
            text = f.read_text(encoding="utf-8")
        except Exception:
            logger.exception("read kb failed: %s", f)
            continue
        kb_name = re.sub(r"^AI客服知识库_\d+_?", "", f.stem) or f.stem
        for it in _split_kb_items(text, kb_name):
            items.append(it)
    _KB_ITEMS = items
    logger.info("ai_support kb loaded: %s items", len(items))
    return _KB_ITEMS


# 泛化词：表达"操作意图/通用名词"，不指向具体功能，门槛判断时先剔除
# （"风险管理"与"用户管理"只共享"管理"不应判为命中）
_GENERIC_WORDS = (
    "怎么", "如何", "怎样", "咋", "操作", "管理", "系统", "功能", "设置",
    "使用", "维护", "流程", "步骤", "是什么", "什么", "可以", "一下",
    "请问", "我想", "想问", "的", "了", "吗", "呢",
)


def _gate_bigrams(text: str, expand: bool = False):
    """门槛专用二元组：可选同义扩展 → 去路径/菜单括注 → 去泛化词 → 切片。
    用于判断"用户到底在问哪个功能"，剔除泛词与跨词噪声。"""
    t = str(text or "")
    if expand:
        t = _expand_syn(t)
    t = re.sub(r"`[^`]*`", "", t)
    t = re.sub(r"（菜单[^）]*）", "", t)
    for w in _GENERIC_WORDS:
        t = t.replace(w, " ")
    return _bigrams(t)


def _kb_score(q_bi, q_gate, item):
    if not q_bi:
        return 0.0
    core = item["core_bi"]
    leaf = item["leaf_bi"]
    ask = item["ask_bi"]
    if not core:
        return 0.0
    # 区分度门槛：去掉泛词后，query 必须与该功能的"身份特征"（功能名 + 原始常见问法，
    # 不做同义扩展）有实质交集，否则视为不相关——
    # 防止"风险管理"靠泛词"管理"错配用户管理，或靠 RCM 同义扩展错配文档章节编辑。
    if not (q_gate & item["gate_bi"]):
        return 0.0
    core_hit = len(q_bi & core) / len(q_bi)
    leaf_hit = (len(q_bi & leaf) / len(q_bi)) if leaf else 0.0
    leaf_prec = (len(q_bi & leaf) / len(leaf)) if leaf else 0.0
    # ask 只作为辅助加分，权重较低
    ask_hit = (len(q_bi & ask) / len(q_bi)) if ask else 0.0
    return core_hit + leaf_hit * 0.8 + leaf_prec * 0.9 + ask_hit * 0.3


def _detect_intent(question: str) -> str:
    """识别用户意图：what / why / how / where / mixed（默认）"""
    q = str(question or "")
    if any(k in q for k in _INTENT_WHERE):
        return "where"
    # 同时含"是什么"和"怎么用"按 mixed 处理（默认即包含全部段落）
    has_what = any(k in q for k in _INTENT_IS_WHAT) or any(k in q for k in _INTENT_WHY)
    has_how = any(k in q for k in _INTENT_HOW)
    if has_what and not has_how:
        return "what"
    if has_how and not has_what:
        return "how"
    return "mixed"


def _format_how(text: str) -> str:
    """规整"怎么用"段：去掉 markdown 列表前缀，统一为可读编号。"""
    if not text:
        return ""
    out = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            if out and out[-1] != "":
                out.append("")
            continue
        # 去掉反引号路径
        s = _strip_inline_code(s)
        # 列表项前缀归一：1. xx / - xx / · xx
        s = re.sub(r"^\s*[\-·\*]\s+", "", s)
        s = re.sub(r"\s+", " ", s).strip()
        if s:
            out.append(s)
    return "\n".join(out).strip()


def _compose_kb_answer(question: str, item: dict) -> str:
    """根据意图，拼装四段式自然语言回答。"""
    fields = item["fields"]
    leaf = item["leaf"]
    intent = _detect_intent(question)

    location = fields.get("location", "").strip()
    what = fields.get("what", "").strip()
    why = fields.get("why", "").strip()
    how = _format_how(fields.get("how", ""))
    related = fields.get("related", "").strip()

    parts = []

    # 开场：用功能名 + 一句话讲解
    if what:
        parts.append(f"**{leaf}**：{what}")
    else:
        parts.append(f"**{leaf}**")

    if intent == "where":
        if location:
            parts.append(f"**在哪里**：{location}")
        if how:
            # where 意图给一句简短说明，不展开全部步骤
            first_step = how.splitlines()[0] if how else ""
            if first_step:
                parts.append(f"**进入后**：{first_step}")
    elif intent == "what":
        if why:
            parts.append(f"**为什么需要它**：{why}")
        if location:
            parts.append(f"**界面位置**：{location}")
        if related:
            parts.append(f"**相关功能**：{related}")
    elif intent == "how":
        if location:
            parts.append(f"**界面位置**：{location}")
        if how:
            parts.append(f"**操作步骤**：\n{how}")
        if related:
            parts.append(f"**相关功能**：{related}")
    else:  # mixed / 默认
        if why:
            parts.append(f"**解决什么问题**：{why}")
        if location:
            parts.append(f"**界面位置**：{location}")
        if how:
            parts.append(f"**怎么用**：\n{how}")
        if related:
            parts.append(f"**相关功能**：{related}")

    return "\n\n".join(parts)


def _kb_answer(question: str):
    """尝试从 AI 客服知识库匹配并组装答案。返回 (data, suggestions_for_miss)。"""
    items = _load_kb_items()
    if not items:
        return None, []
    q_bi = _bigrams(_expand_syn(question))
    if not q_bi:
        return None, []
    q_gate = _gate_bigrams(question, expand=True)
    scored = sorted(((it, _kb_score(q_bi, q_gate, it)) for it in items), key=lambda x: x[1], reverse=True)
    top = scored[0] if scored else None
    if not top or top[1] < _SCORE_THRESHOLD:
        # 未命中：取分数较高的若干条目作为"猜你想问"
        suggestions = []
        seen_leaf = set()
        for it, sc in scored:
            if sc < _SUGGEST_THRESHOLD or len(suggestions) >= _SUGGEST_N:
                break
            if it["leaf"] in seen_leaf:
                continue
            seen_leaf.add(it["leaf"])
            # 若有"用户常见问法"，取一条作为更口语化的建议；否则用功能名
            ask = it["fields"].get("ask", "")
            if ask:
                first = re.split(r"[、,，;；]", ask)[0].strip()
                if first:
                    suggestions.append(first)
                    continue
            suggestions.append(f"{it['leaf']}怎么用")
        return None, suggestions
    item, _sc = top
    answer = _compose_kb_answer(question, item)
    return {
        "answer": answer,
        "matched": True,
        "sources": [{"manual": item["kb"], "section": item["leaf"]}],
        "suggestions": [],
    }, []


# ---- 文档模块级聚合回答（SRS/SDS）----
# 触发：提问含模块词 + 操作意图词，且不含具体子功能词（精确问子功能时仍走普通检索）
_INTENT_KW = ("新建", "管理", "维护", "操作", "怎么", "如何", "编辑", "编写", "支持", "有哪些", "有什么", "功能", "用法")
_SUB_KW = ("变更", "导入", "节点", "表格", "图片", "图表", "追溯", "对比",
           "功能描述", "条目", "插入", "上传", "导出", "筛选", "编号", "封面", "字段")

_DOC_MODULES = (
    {
        "kw": ("srs", "需求规格", "需求文档", "需求说明", "需求"),
        "heading": "需求规格说明（SRS）文档管理",
        "noun": "文档",
        "manual_kw": "需求规格说明",
        "add_title_kw": ("新建", "srs文档"),
        "intro": "需求规格说明（SRS）支持：导入 Word 需求、复制已有文档版本、新建文档、编辑文档、删除文档。",
        "edit_steps": (
            "1. 在 SRS 文档列表找到目标文档，点该行「编辑」进入编辑页。\n"
            "2. 在目录结构区编辑各章节的标题、正文，维护需求条目、变更需求表、功能描述等内容。\n"
            "3. 点顶栏「保存」保存整个文档。"
        ),
        "delete_hint": "删除文档：在文档列表对应行点「删除」并按提示确认即可。",
    },
    {
        "kw": ("sds", "详细设计", "设计文档"),
        "heading": "软件详细设计（SDS）文档管理",
        "noun": "文档",
        "manual_kw": "软件详细设计",
        "add_title_kw": ("新建", "sds文档"),
        "intro": "软件详细设计（SDS）支持：导入 Word 详细设计、复制已有文档版本、新建文档、编辑文档、删除文档。",
        "edit_steps": (
            "1. 在 SDS 文档列表找到目标文档，点该行「编辑」进入编辑页。\n"
            "2. 在目录结构区编辑各章节的标题、正文，维护设计条目、追溯关联等内容。\n"
            "3. 点顶栏「保存」保存整个文档。"
        ),
        "delete_hint": "删除文档：在文档列表对应行点「删除」并按提示确认即可。",
    },
    {
        # 风险管理报告：步骤依据手册 8.报告列表 + 9.报告详情 章节真实内容串联
        "kw": ("风险管理报告", "风险报告"),
        "heading": "风险管理报告操作指引",
        "noun": "报告",
        "manual_kw": "风险管理",
        "intro": "风险管理报告支持：导入 Word、复制已有版本、新建报告、编辑报告、删除报告。",
        "add_steps": (
            "1. 在报告列表页点「新建」，进入新建页。\n"
            "2. 选择产品（必填），系统联动该产品的风险数据；填写报告版本、变更说明。\n"
            "3. 点「初始化模版」加载目录结构。\n"
            "4. 选中章节后编辑内容：参与人员章节从人员库勾选，接受标准/风险分析矩阵维护矩阵格，风险控制章节增减 RCM 行，普通章节编辑段落与表格，含图章节上传图片。\n"
            "5. 点顶栏「保存」保存报告（导出 Word 需先保存过）。"
        ),
        "edit_steps": (
            "1. 在报告列表找到目标报告，点该行「编辑」进入报告详情页。\n"
            "2. 在目录结构区编辑各章节标题与内容，维护参与人员、风险矩阵、风险控制等。\n"
            "3. 点顶栏「保存」保存报告。"
        ),
        "delete_hint": "删除报告：在报告列表对应行点「删除」并确认（会级联删除其风险分析/控制数据）。",
    },
)


def _find_chunk(chunks, manual_kw, title_kws):
    for c in chunks:
        if manual_kw not in str(c.get("manual", "")):
            continue
        tn = _norm(c.get("title", ""))
        if all(k in tn for k in title_kws):
            return c
    return None


def _clarify_answer(question, chunks):
    # 针对“系统不存在/易误解”的功能做澄清，内容均取自手册，避免误命中其它章节
    qn = _expand_syn(question)
    # 角色：系统无“新建角色”入口（预置 7 个固定角色），引导到“配置角色权限”
    if "角色" in qn and any(w in qn for w in ("新建", "添加", "增加")):
        c = _find_chunk(chunks, "系统配置", ("配置", "角色权限"))
        intro = ("系统未提供“新建角色”功能，使用预置的 7 个固定角色"
                 "（root 超级管理员、dqa、qa、ra、产品经理、开发、测试）；"
                 "日常只能在角色页配置各角色的权限范围。配置步骤如下：")
        steps = _clean_steps(c["content"], c.get("title", "")) if c else ""
        # 开场白已说明“无新增入口”，去掉手册段首重复的“说明…”，只保留编号操作步骤
        if steps:
            lines = steps.splitlines()
            for i, ln in enumerate(lines):
                if re.match(r"^\d+[\.、]", ln.strip()):
                    steps = "\n".join(lines[i:]).strip()
                    break
        answer = intro + ("\n\n" + steps if steps else "")
        sources = [{
            "manual": c["manual"] if c else "用户手册 系统配置",
            "section": "角色与权限 > 查看与配置角色权限",
        }]
        return {"answer": answer, "matched": True, "sources": sources}
    return None


def _module_doc_answer(question, chunks):
    qn = _expand_syn(question).lower()
    for m in _DOC_MODULES:
        if not any(k in qn for k in m["kw"]):
            continue
        if not any(w in qn for w in _INTENT_KW):
            continue
        if any(x in qn for x in _SUB_KW):
            continue
        noun = m.get("noun", "文档")
        manual_name = m["manual_kw"]
        # 新增步骤：优先取章节真实正文（SRS/SDS），其次用配置好的步骤文本（风险报告）
        add_steps = m.get("add_steps", "")
        if not add_steps and m.get("add_title_kw"):
            add_c = _find_chunk(chunks, m["manual_kw"], m["add_title_kw"])
            if add_c:
                manual_name = add_c["manual"]
                raw = _clean_steps(add_c["content"], add_c.get("title", ""))
                # 概述已提“导入”，新增段去掉导入入口行，只保留新建主线
                add_steps = "\n".join(ln for ln in raw.splitlines() if "导入" not in ln).strip()
        body = [m["intro"], ""]
        if add_steps:
            body += [f"新增{noun}：", add_steps, ""]
        body += [f"编辑{noun}：", m["edit_steps"], "", m["delete_hint"]]
        answer = f"**{m['heading']}**\n\n" + "\n".join(body).strip()
        sources = [{"manual": manual_name, "section": m["heading"]}]
        return {"answer": answer, "matched": True, "sources": sources}
    return None


class Server(object):

    async def ask(self, question: str):
        question = (question or "").strip()
        if not question:
            return Resp.resp_err(msg="请输入您的问题")
        chunks = _load_chunks()
        if not chunks:
            return Resp.resp_err(msg="知识库暂未就绪，请稍后再试")
        # 优先级 1：AI 客服知识库（讲解式四段答案）
        kb_data, kb_suggestions = _kb_answer(question)
        if kb_data:
            return Resp.resp_ok(data=kb_data)
        # 优先级 2：功能澄清（如“新建角色”——系统无此入口）
        clar = _clarify_answer(question, chunks)
        if clar:
            clar.setdefault("suggestions", [])
            return Resp.resp_ok(data=clar)
        # 优先级 3：文档模块级提问（如“怎么新建需求文档”），返回模块聚合回答
        agg = _module_doc_answer(question, chunks)
        if agg:
            agg.setdefault("suggestions", [])
            return Resp.resp_ok(data=agg)
        # 优先级 4：用户手册章节检索（保留原步骤式回答，兜底）
        q_bi = _bigrams(_expand_syn(question))
        scored = sorted(((c, _score(q_bi, c)) for c in chunks), key=lambda x: x[1], reverse=True)
        top_score = scored[0][1] if scored else 0.0
        hits = []
        for i, (c, s) in enumerate(scored):
            if len(hits) >= _TOP_N:
                break
            if s < _SCORE_THRESHOLD:
                break
            # 第 2 条起须达到首条的相对比例，否则视为不够相关、不返回
            if hits and s < top_score * _REL_RATIO:
                break
            # 近义标题去重：剔除与已选章节标题高度相似的近义干扰（如“新建产品线”相对“新建产品”）
            leaf = c.get("leaf_title_bi") or set()
            if any(_leaf_similar(leaf, h.get("leaf_title_bi") or set()) for h, _ in hits):
                continue
            hits.append((c, s))
        if not hits:
            return Resp.resp_ok(data={
                "answer": "抱歉，我没有找到与您问题相关的功能说明。您可以换一种问法，或者试试下面的问题。",
                "matched": False,
                "sources": [],
                "suggestions": kb_suggestions,
            })
        parts = []
        sources = []
        for idx, (c, _s) in enumerate(hits):
            content = _clean_steps(c["content"], c.get("title", ""))
            if not content:
                continue
            if len(content) > _MAX_CONTENT_LEN:
                content = content[:_MAX_CONTENT_LEN] + "…"
            section = _clean_section(c["section"])
            # 用功能名（章节末级）作为口语化开头，不再暴露"用户手册 > ... > ..."这种文献式前缀
            leaf = section.split(">")[-1].strip() if section else ""
            leaf = re.sub(r"^[\d\.\s]+", "", leaf)
            head = (f"**{leaf}**\n" if leaf else "")
            if idx > 0:
                head = "另外，" + head
            parts.append(head + content)
            sources.append({"manual": c["manual"], "section": section})
        if not parts:
            return Resp.resp_ok(data={
                "answer": "抱歉，我没有找到对应的操作步骤。您可以换一种问法，或者试试下面的问题。",
                "matched": False,
                "sources": [],
                "suggestions": kb_suggestions,
            })
        return Resp.resp_ok(data={
            "answer": "\n\n".join(parts),
            "matched": True,
            "sources": sources,
            "suggestions": [],
        })
