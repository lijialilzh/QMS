
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
            __apply_two_col_width(tabx, col_count)
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

    __apply_two_col_width(tabx, len(tab.headers))
    __apply_table_border(tabx)

    empty = docx.add_paragraph()
    empty.paragraph_format.space_after = Pt(20)


def save_img2docx(path: str, docx: Document, mw: int = 600, mh: int = 600):
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
        scale = 1.0
        if ow > mw or oh > mh:
            scale = min(mw / ow, mh / oh)
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
    node_para.paragraph_format.first_line_indent = Pt(0)
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
        node_para.paragraph_format.first_line_indent = Pt(font_size*2)
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
