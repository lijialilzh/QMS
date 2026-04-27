
import os
import re
import io
import base64
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx import Document
from docx.shared import Inches, Pt
try:
    from PIL import Image
except Exception:
    Image = None
from docx import enum as dox_enum
from docx.shared import RGBColor

from ...obj.tobj_srs_doc import Table

def __fonted_cell(cell, text, font_size=10.5):
    for paragraph in cell.paragraphs:
        paragraph.alignment = dox_enum.text.WD_ALIGN_PARAGRAPH.LEFT
        paragraph.paragraph_format.first_line_indent = Pt(0)
        paragraph.paragraph_format.left_indent = Pt(0)
        paragraph.paragraph_format.right_indent = Pt(0)
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        fonted_txt(paragraph, text, font_size)

def __apply_table_border(tabx):
    tblBorders = OxmlElement('w:tblBorders')
    for pos in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
        border = OxmlElement(f'w:{pos}')
        border.set(qn('w:val'), 'single')
        border.set(qn('w:sz'), str(8))
        border.set(qn('w:color'), '000000')
        border.set(qn('w:space'), '0')
        tblBorders.append(border)
    tblPr = tabx._tbl.tblPr
    tblPr.append(tblBorders)

def __apply_two_col_width(tabx, col_count: int):
    # 仅两列表格：左列窄，右列宽（约 1:2）
    if col_count != 2:
        return
    tabx.autofit = False
    left_w = Inches(1.6)
    right_w = Inches(4.8)
    for row in tabx.rows:
        if len(row.cells) < 2:
            continue
        row.cells[0].width = left_w
        row.cells[1].width = right_w

def __text_visual_len(value: str) -> float:
    txt = str(value or "").strip()
    if not txt:
        return 0.0
    # 中文按双宽估算，英文/数字按单宽估算；防止超长URL把比例拉爆
    score = 0.0
    for ch in txt:
        score += 2.0 if "\u4e00" <= ch <= "\u9fff" else 1.0
    return min(score, 80.0)

def __distribute_col_widths(scores, total_width: float, min_width: float, max_width: float):
    col_count = len(scores)
    if col_count == 0:
        return []
    if total_width <= col_count * min_width:
        return [total_width / col_count for _ in range(col_count)]
    safe_scores = [max(0.1, float(s or 0.1)) for s in scores]
    score_sum = sum(safe_scores) or 1.0
    widths = [total_width * (s / score_sum) for s in safe_scores]
    widths = [max(min_width, min(max_width, w)) for w in widths]
    cur_sum = sum(widths)
    # 迭代收敛到目标总宽
    for _ in range(6):
        diff = total_width - cur_sum
        if abs(diff) < 0.01:
            break
        if diff > 0:
            grow_idx = [i for i, w in enumerate(widths) if w < max_width - 1e-6]
            if not grow_idx:
                break
            base = sum(safe_scores[i] for i in grow_idx) or len(grow_idx)
            for i in grow_idx:
                inc = diff * ((safe_scores[i] / base) if base else (1 / len(grow_idx)))
                widths[i] = min(max_width, widths[i] + inc)
        else:
            shrink_idx = [i for i, w in enumerate(widths) if w > min_width + 1e-6]
            if not shrink_idx:
                break
            base = sum(safe_scores[i] for i in shrink_idx) or len(shrink_idx)
            for i in shrink_idx:
                dec = (-diff) * ((safe_scores[i] / base) if base else (1 / len(shrink_idx)))
                widths[i] = max(min_width, widths[i] - dec)
        cur_sum = sum(widths)
    return widths

def __apply_adaptive_col_width(tabx, headers, rows):
    col_count = len(headers or [])
    if col_count <= 0:
        return
    # 两列表格保留原有版式（封面信息/修订记录等）
    if col_count == 2:
        __apply_two_col_width(tabx, col_count)
        return
    # A4常规页边距下可用宽度约 6.5~6.9 英寸，这里取中值
    total_width = 6.7
    min_width = 0.78
    max_width = 3.6
    scores = []
    for ci, header in enumerate(headers or []):
        hname = str(getattr(header, "name", "") or "")
        header_score = max(2.0, __text_visual_len(hname) * 1.2)
        col_samples = []
        for row in (rows or [])[:40]:
            if isinstance(row, dict):
                col_samples.append(str(row.get(getattr(header, "code", ""), "") or ""))
        sample_max = max((__text_visual_len(x) for x in col_samples), default=0.0)
        sample_avg = (sum(__text_visual_len(x) for x in col_samples) / max(1, len(col_samples))) if col_samples else 0.0
        score = max(header_score, sample_max * 0.9, sample_avg * 1.1, 2.0)
        # URL/备注/描述这类文本列给更高权重，避免被压窄
        if re.search(r"(url|uri|http|路径|地址|链接|备注|说明|描述|内容|参数|详情)", hname, re.I):
            score *= 1.55
        # 编号/序号类列适度收窄
        if re.search(r"(编号|序号|id|编码)", hname, re.I):
            score *= 0.85
        scores.append(score)
    widths = __distribute_col_widths(scores, total_width=total_width, min_width=min_width, max_width=max_width)
    tabx.autofit = False
    for row in tabx.rows:
        for ci, width in enumerate(widths):
            if ci < len(row.cells):
                row.cells[ci].width = Inches(width)

def save_tab2docx(tab: Table,  docx: Document):
    # 优先使用 cells 导出（保留Word导入时的合并单元格结构）
    if tab.cells and len(tab.cells) > 0:
        row_count = len(tab.cells)
        col_count = max((len(row) for row in tab.cells), default=0)
        if row_count > 0 and col_count > 0:
            tabx = docx.add_table(rows=row_count, cols=col_count)
            for ri, row in enumerate(tab.cells):
                for ci, cell in enumerate(row):
                    if cell is None:
                        continue
                    rs = int(cell.row_span or 1)
                    cs = int(cell.col_span or 1)
                    if rs == 0 or cs == 0:
                        continue
                    text = str(cell.value or "")
                    __fonted_cell(tabx.cell(ri, ci), text)
                    end_r = min(row_count - 1, ri + max(1, rs) - 1)
                    end_c = min(col_count - 1, ci + max(1, cs) - 1)
                    if end_r > ri or end_c > ci:
                        tabx.cell(ri, ci).merge(tabx.cell(end_r, end_c))
            header_names = []
            if tab.show_header and row_count > 0:
                try:
                    header_names = [str(tab.cells[0][ci].value or "") for ci in range(col_count)]
                except Exception:
                    header_names = []
            pseudo_headers = tab.headers or [type("Header", (), {"code": f"c{idx}", "name": (header_names[idx] if idx < len(header_names) else f"列{idx+1}")}) for idx in range(col_count)]
            pseudo_rows = []
            data_start = 1 if (tab.show_header and row_count > 0) else 0
            for ri in range(data_start, row_count):
                row_dict = {}
                for ci in range(col_count):
                    code = getattr(pseudo_headers[ci], "code", f"c{ci}")
                    val = ""
                    try:
                        cell = tab.cells[ri][ci]
                        val = "" if cell is None else str(getattr(cell, "value", "") or "")
                    except Exception:
                        val = ""
                    row_dict[code] = val
                pseudo_rows.append(row_dict)
            __apply_adaptive_col_width(tabx, pseudo_headers, pseudo_rows)
            __apply_table_border(tabx)
            empty = docx.add_paragraph()
            empty.paragraph_format.space_after = Pt(20)
            return

    if not tab.headers:
        return

    tabx = docx.add_table(rows=0, cols=len(tab.headers))

    if tab.show_header:
        header_cells = tabx.add_row().cells
        for ci, header in enumerate(tab.headers):
            __fonted_cell(header_cells[ci], header.name)

    for row in tab.rows or []:
        row_cells = tabx.add_row().cells
        for ci, header in enumerate(tab.headers):
            cell_value = row.get(header.code)
            text = str(cell_value) if cell_value is not None else ""
            __fonted_cell(row_cells[ci], text)

    __apply_adaptive_col_width(tabx, tab.headers, tab.rows or [])
    __apply_table_border(tabx)

    empty = docx.add_paragraph()
    empty.paragraph_format.space_after = Pt(20)


def save_img2docx(
    path: str,
    docx: Document,
    mw: int = 600,
    mh: int = 600,
    min_w: int = 0,
    min_h: int = 0,
    target_long: int = 0,
):
    PIXELS_PER_INCH = 96
    SPACE_VALUE = Pt(20)
    image_source = None
    if path and str(path).startswith("data:image/"):
        matched = re.match(r"^data:image/[a-zA-Z0-9.+-]+;base64,(.+)$", str(path), re.S)
        if matched:
            try:
                image_source = io.BytesIO(base64.b64decode(matched.group(1)))
            except Exception:
                image_source = None
    elif path and os.path.exists(path):
        image_source = path

    if image_source is None:
        return

    # 结合页面可用宽高做硬限制，避免图片在一页内展示不下
    try:
        section = docx.sections[-1] if docx.sections else None
        if section is not None:
            page_w_in = float(section.page_width) / 914400.0
            page_h_in = float(section.page_height) / 914400.0
            margin_l_in = float(section.left_margin) / 914400.0
            margin_r_in = float(section.right_margin) / 914400.0
            margin_t_in = float(section.top_margin) / 914400.0
            margin_b_in = float(section.bottom_margin) / 914400.0
            avail_w_px = max(120.0, (page_w_in - margin_l_in - margin_r_in) * PIXELS_PER_INCH)
            avail_h_px = max(120.0, (page_h_in - margin_t_in - margin_b_in) * PIXELS_PER_INCH)
            # 预留上下正文与题注空间，避免“单图吃满一页”
            mw = int(min(float(mw), avail_w_px * 0.60))
            mh = int(min(float(mh), avail_h_px * 0.32))
    except Exception:
        pass

    node_para = docx.add_paragraph()
    node_para.alignment = dox_enum.text.WD_ALIGN_PARAGRAPH.CENTER
    node_para.paragraph_format.space_before = SPACE_VALUE
    node_para.paragraph_format.space_after = SPACE_VALUE
    if Image is None:
        # 本地环境未安装 Pillow 时，按最大宽度插入，避免导出失败
        node_para.add_run().add_picture(image_source, width=Inches(mw / PIXELS_PER_INCH))
        return

    try:
        if isinstance(image_source, io.BytesIO):
            image_source.seek(0)
            with Image.open(image_source) as img:
                ow, oh = img.size
            image_source.seek(0)
        else:
            with Image.open(image_source) as img:
                ow, oh = img.size
        max_scale = min(mw / ow, mh / oh)
        min_scale = 0.0
        if min_w > 0 or min_h > 0:
            min_scale = max(
                (min_w / ow) if min_w > 0 else 0.0,
                (min_h / oh) if min_h > 0 else 0.0,
            )
        if min_scale > max_scale:
            # 极端长宽比时，优先保证不超出最大边界
            min_scale = max_scale

        if target_long and target_long > 0:
            base_scale = target_long / max(ow, oh)
        else:
            base_scale = 1.0
        scale = min(max(base_scale, min_scale), max_scale)
        img_w = (ow * scale) / PIXELS_PER_INCH
        img_h = (oh * scale) / PIXELS_PER_INCH
        node_para.add_run().add_picture(image_source, width=Inches(img_w), height=Inches(img_h))
    except Exception:
        # 尺寸探测失败时退化为固定宽度，确保图片仍可导出
        if isinstance(image_source, io.BytesIO):
            image_source.seek(0)
        node_para.add_run().add_picture(image_source, width=Inches(mw / PIXELS_PER_INCH))

def save_title2docx(title: str, docx: Document, level: int = 1, font_size=10.5):
    # 按文档规范设置标题：一级三号加粗，二级四号加粗，三级及以下五号常规
    size_map = {1: 16.0, 2: 14.0, 3: 10.5}
    size = size_map.get(level, 10.5)
    is_bold = level <= 2
    # 使用Heading样式，便于Word目录域(TOC)识别并生成可点击目录
    node_para = docx.add_heading("", level=max(1, min(level, 9)))
    node_para.alignment = dox_enum.text.WD_ALIGN_PARAGRAPH.LEFT
    node_para.paragraph_format.first_line_indent = Pt(0)
    node_para.paragraph_format.left_indent = Pt(0)
    node_para.paragraph_format.right_indent = Pt(0)
    node_para.paragraph_format.line_spacing = 1.5
    node_para.paragraph_format.space_before = Pt(0)
    node_para.paragraph_format.space_after = Pt(0)
    fonted_txt(node_para, title, font_size=size, bold=is_bold)

def save_txt2docx(text: str, docx: Document, font_size=10.5):
    texts = (text or "").splitlines()
    for text in texts:
        text = text.strip()
        if not text:
            continue
        node_para = docx.add_paragraph()
        node_para.alignment = dox_enum.text.WD_ALIGN_PARAGRAPH.LEFT
        node_para.paragraph_format.first_line_indent = Pt(font_size*2)
        node_para.paragraph_format.left_indent = Pt(0)
        node_para.paragraph_format.right_indent = Pt(0)
        node_para.paragraph_format.line_spacing = 1.5
        node_para.paragraph_format.space_before = Pt(0)
        node_para.paragraph_format.space_after = Pt(0)
        fonted_txt(node_para, text, font_size)

def fonted_txt(node_para, text, font_size=10.5, bold=False):
    parts = re.findall(r'([\u4e00-\u9fa5]+|[^\u4e00-\u9fa5]+)', text or "")
    node_para.paragraph_format.space_before = Pt(0)
    node_para.paragraph_format.space_after = Pt(0)
    for part in parts:
        run = node_para.add_run(part)
        run.font.size = Pt(font_size)
        run.font.color.rgb = RGBColor(0, 0, 0)
        run.font.italic = False
        run.font.bold = bool(bold)
        font_name="宋体" if re.match(r'[\u4e00-\u9fa5]', part) else "Times New Roman"
        run.font.name = font_name
        run._element.rPr.rFonts.set(qn('w:eastAsia'), font_name)
