#\!/usr/bin/env python3
# encoding: utf-8
# docx→PDF 转换微服务：在宿主机运行，用 LibreOffice 转 docx 为 PDF。
# 后端 Docker 容器通过 host.docker.internal:8765 调用此服务。
# 用法：python3 docx2pdf_service.py
# 依赖：宿主机已安装 LibreOffice（soffice 命令可用），Ghostscript（gs 命令可选）

import io
import os
import re
import subprocess
import tempfile
import zipfile
from xml.etree import ElementTree as ET
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn

app = FastAPI(title="docx2pdf Service")

# Word XML 命名空间
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}
W = NS["w"]

# LibreOffice 独立 profile 目录（避免锁冲突）
_LO_PROFILE = os.path.join(tempfile.gettempdir(), "lo_profile_qms")


def _soffice_convert(docx_path: str, outdir: str, timeout: int = 60) -> str:
    """用 soffice 转 PDF，转换后强制杀掉残留进程，避免 Mac 上卡死。"""
    try:
        subprocess.run(
            ["soffice", "--headless", "--nologo", "--nodefault", "--nolockcheck",
             f"-env:UserInstallation=file://{_LO_PROFILE}",
             "--convert-to", "pdf", "--outdir", outdir, docx_path],
            capture_output=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        pass
    finally:
        # 强制杀掉残留 soffice 进程（Mac 上经常不退出）
        subprocess.run(["pkill", "-9", "-f", "soffice"], capture_output=True, timeout=5)
    pdf_path = os.path.join(outdir, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")
    return pdf_path


def _extract_headings_from_docx(docx_path: str) -> list:
    """从 docx 中提取所有标题文本（Heading 1-4），返回 [(level, text), ...]。"""
    headings = []
    try:
        with zipfile.ZipFile(docx_path) as zf:
            xml_bytes = zf.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        for para in root.iter(f"{{{W}}}p"):
            # 获取段落样式
            ppr = para.find(f"{{{W}}}pPr")
            if ppr is None:
                continue
            pstyle = ppr.find(f"{{{W}}}pStyle")
            if pstyle is None:
                continue
            style_val = pstyle.get(f"{{{W}}}val", "")
            if not style_val.startswith("Heading"):
                continue
            try:
                level = int(style_val.replace("Heading", "").strip() or "1")
            except ValueError:
                level = 1
            if not (1 <= level <= 4):
                continue
            # 提取段落文本
            texts = []
            for t in para.iter(f"{{{W}}}t"):
                if t.text:
                    texts.append(t.text)
            text = "".join(texts).strip()
            if text:
                headings.append((level, text))
    except Exception:
        pass
    return headings


def _find_heading_pages(pdf_path: str, headings: list) -> dict:
    """用 Ghostscript 提取 PDF 每页文本，找到每个标题首次出现的页码。
    返回 {标题文本: 页码}。"""
    if not headings:
        return {}
    result = {}
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            # 用 gs txtwrite 逐页输出到 page_%d.txt（%d 自动按页编号）
            out_pattern = os.path.join(tmpdir, "page_%d.txt")
            subprocess.run(
                ["gs", "-dNOPAUSE", "-dBATCH", "-dQUIET",
                 "-sDEVICE=txtwrite", f"-sOutputFile={out_pattern}", pdf_path],
                capture_output=True, timeout=60,
            )
            # 读取每页文本，跳过目录页（含"目录"标题的页面）
            remaining = {h[1]: h[0] for h in headings}  # text -> level
            page = 1
            while remaining:
                txt_path = os.path.join(tmpdir, f"page_{page}.txt")
                if not os.path.exists(txt_path):
                    break
                with open(txt_path, "r", encoding="utf-8", errors="ignore") as f:
                    page_text = f.read()
                # 跳过目录页（含"目录"且含多个标题文本的页面）
                is_toc_page = "目录" in page_text and sum(1 for t in remaining if t in page_text) > 3
                if not is_toc_page:
                    # 检查哪些标题在这一页
                    for title in list(remaining.keys()):
                        # 去掉标题中的编号前缀（如 "1.2.3 " 或 "1 "）做模糊匹配
                        clean_title = re.sub(r'^[\d.]+\s*', '', title).strip()
                        if title in page_text or clean_title in page_text:
                            result[title] = page
                            del remaining[title]
                page += 1
                if page > 500:  # 安全限制
                    break
    except Exception as e:
        print(f"[toc] find_heading_pages error: {e}", flush=True)
    return result


def _update_toc_page_numbers(docx_path: str, heading_pages: dict) -> bool:
    """修改 docx 中目录条目的页码占位为真实页码。
    在 TOC 域的 separate 和 end 之间，找到 <w:tab/> 后的 <w:t> 文本替换为页码。"""
    if not heading_pages:
        return False
    try:
        with zipfile.ZipFile(docx_path) as zf:
            xml_str = zf.read("word/document.xml").decode("utf-8")
            other_files = {name: zf.read(name) for name in zf.namelist() if name != "word/document.xml"}

        # 找到 TOC 域的 separate 和 end 位置
        toc_pos = xml_str.find("TOC")
        if toc_pos < 0:
            print("[toc] no TOC field found", flush=True)
            return False
        sep_pos = xml_str.find('w:fldCharType="separate"', toc_pos)
        if sep_pos < 0:
            print("[toc] no separate found", flush=True)
            return False
        sep_end = xml_str.find("/>", sep_pos) + 2  # separate 标签结束位置
        end_pos = xml_str.find('w:fldCharType="end"', sep_pos)
        if end_pos < 0:
            end_pos = len(xml_str)

        # 在 separate 和 end 之间，逐个找 <w:tab/> 后的 <w:t> 页码占位
        # 先提取每个目录条目的标题文本（tab 前的文本），再按标题匹配页码
        replaced_count = 0
        search_pos = sep_end
        while search_pos < end_pos:
            tab_pos = xml_str.find("<w:tab/>", search_pos)
            if tab_pos < 0 or tab_pos >= end_pos:
                break
            # 找 tab 后第一个 <w:t> 或 <w:t 标签
            t_start = xml_str.find("<w:t>", tab_pos)
            t_start_attr = xml_str.find("<w:t ", tab_pos)
            if t_start < 0 or (t_start_attr >= 0 and t_start_attr < t_start):
                t_start = t_start_attr
            if t_start < 0 or t_start >= end_pos:
                search_pos = tab_pos + 1
                continue
            t_content_start = xml_str.find(">", t_start) + 1
            t_end = xml_str.find("</w:t>", t_content_start)
            if t_end < 0 or t_end >= end_pos:
                search_pos = tab_pos + 1
                continue
            old_val = xml_str[t_content_start:t_end]
            # 提取这个条目的标题文本（tab 前面的所有 <w:t> 文本）
            # 从上一个 <w:br/> 或 separate 后到当前 tab 之间的文本
            entry_start = search_pos
            entry_text = ""
            pos = entry_start
            while pos < tab_pos:
                t_pos = xml_str.find("<w:t", pos)
                if t_pos < 0 or t_pos >= tab_pos:
                    break
                tc_start = xml_str.find(">", t_pos) + 1
                tc_end = xml_str.find("</w:t>", tc_start)
                if tc_end < 0 or tc_end >= tab_pos:
                    break
                entry_text += xml_str[tc_start:tc_end]
                pos = tc_end + 6
            entry_text = entry_text.strip()
            # 用标题文本匹配页码
            new_page = None
            if entry_text in heading_pages:
                new_page = str(heading_pages[entry_text])
            else:
                # 模糊匹配：去掉编号前缀
                clean_entry = re.sub(r'^[\d.]+\s*', '', entry_text).strip()
                for h_title, h_page in heading_pages.items():
                    clean_h = re.sub(r'^[\d.]+\s*', '', h_title).strip()
                    if clean_entry == clean_h or entry_text in h_title or h_title in entry_text:
                        new_page = str(h_page)
                        break
            if new_page and new_page != old_val:
                xml_str = xml_str[:t_content_start] + new_page + xml_str[t_end:]
                print(f"[toc] replaced '{entry_text}': {old_val} -> {new_page}", flush=True)
                replaced_count += 1
                # 更新 end_pos（XML 长度变了）
                end_pos = xml_str.find('w:fldCharType="end"', sep_pos)
                search_pos = t_content_start + len(new_page) + len("</w:t>")
            else:
                search_pos = tab_pos + 1
        print(f"[toc] total replaced: {replaced_count}", flush=True)

        # 写回 docx：保持原始 zip 文件顺序，只替换 document.xml 内容
        with zipfile.ZipFile(docx_path, "r") as zf_in:
            file_order = zf_in.namelist()
            all_files = {name: zf_in.read(name) for name in file_order}
        all_files["word/document.xml"] = xml_str.encode("utf-8")
        tmp_docx = docx_path + ".tmp"
        with zipfile.ZipFile(tmp_docx, "w", zipfile.ZIP_DEFLATED) as zf_out:
            for name in file_order:  # 按原始顺序写
                zf_out.writestr(name, all_files[name])
        import os as _os
        _os.replace(tmp_docx, docx_path)
        return replaced_count > 0
    except Exception as e:
        print(f"update toc page numbers error: {e}", flush=True)
        return False


@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    """接收 docx 文件，返回 PDF（保留完整格式）。"""
    docx_bytes = await file.read()
    with tempfile.TemporaryDirectory() as tmpdir:
        docx_path = os.path.join(tmpdir, "input.docx")
        with open(docx_path, "wb") as f:
            f.write(docx_bytes)
        try:
            subprocess.run(
                ["soffice", "--headless", "--nologo", "--nodefault", "--nolockcheck",
                 f"-env:UserInstallation=file://{_LO_PROFILE}",
                 "--convert-to", "pdf", "--outdir", tmpdir, docx_path],
                capture_output=True, timeout=60,
            )
        except subprocess.TimeoutExpired:
            subprocess.run(["pkill", "-9", "-f", "soffice"], capture_output=True, timeout=5)
        pdf_path = os.path.join(tmpdir, "input.pdf")
        if os.path.exists(pdf_path):
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf")
        return JSONResponse({"error": "转换失败"}, status_code=500)


@app.post("/convert_ps")
async def convert_ps(file: UploadFile = File(...)):
    """接收 docx 文件，返回 PostScript（PDF→PS via Ghostscript，保留格式+中文）。
    先转PDF提取标题页码→回填docx→重新转PDF→PS，确保目录页码正确。"""
    docx_bytes = await file.read()
    original_docx = docx_bytes  # 备份原始 docx
    with tempfile.TemporaryDirectory() as tmpdir:
        docx_path = os.path.join(tmpdir, "input.docx")
        with open(docx_path, "wb") as f:
            f.write(docx_bytes)
        # 第一步：docx→PDF
        try:
            subprocess.run(
                ["soffice", "--headless", "--nologo", "--nodefault", "--nolockcheck",
                 f"-env:UserInstallation=file://{_LO_PROFILE}",
                 "--convert-to", "pdf", "--outdir", tmpdir, docx_path],
                capture_output=True, timeout=60,
            )
        except subprocess.TimeoutExpired:
            subprocess.run(["pkill", "-9", "-f", "soffice"], capture_output=True, timeout=5)
        pdf_path = os.path.join(tmpdir, "input.pdf")
        if not os.path.exists(pdf_path):
            return JSONResponse({"error": "docx转PDF失败"}, status_code=500)

        # 第二步：提取标题页码并回填到 docx，然后重新转 PDF
        headings = _extract_headings_from_docx(docx_path)
        print(f"[toc] headings found: {len(headings)}", flush=True)
        if headings:
            heading_pages = _find_heading_pages(pdf_path, headings)
            print(f"[toc] heading_pages: {heading_pages}", flush=True)
            if heading_pages:
                updated = _update_toc_page_numbers(docx_path, heading_pages)
                print(f"[toc] updated: {updated}", flush=True)
                if updated:
                    # 重新转 PDF（带正确页码）
                    try:
                        os.remove(pdf_path)
                    except Exception:
                        pass
                    # 等待 soffice 退出并清理锁
                    import time as _time
                    _time.sleep(2)
                    lo_profile2 = _LO_PROFILE + "_2"
                    try:
                        subprocess.run(
                            ["soffice", "--headless", "--nologo", "--nodefault", "--nolockcheck",
                             f"-env:UserInstallation=file://{lo_profile2}",
                             "--convert-to", "pdf", "--outdir", tmpdir, docx_path],
                            capture_output=True, timeout=60,
                        )
                    except subprocess.TimeoutExpired:
                        subprocess.run(["pkill", "-9", "-f", "soffice"], capture_output=True, timeout=5)
                    # 如果重新转失败，恢复原始 docx 再转
                    if not os.path.exists(pdf_path):
                        print("[toc] re-convert failed, restoring original docx", flush=True)
                        with open(docx_path, "wb") as f:
                            f.write(original_docx)
                        try:
                            subprocess.run(
                                ["soffice", "--headless", "--nologo", "--nodefault", "--nolockcheck",
                                 f"-env:UserInstallation=file://{_LO_PROFILE}_3",
                                 "--convert-to", "pdf", "--outdir", tmpdir, docx_path],
                                capture_output=True, timeout=60,
                            )
                        except Exception:
                            pass

        # 第三步：PDF→PostScript（用 Ghostscript）
        ps_path = os.path.join(tmpdir, "input.ps")
        print(f"[toc] pdf exists: {os.path.exists(pdf_path)}, size: {os.path.getsize(pdf_path) if os.path.exists(pdf_path) else 0}", flush=True)
        gs_result = subprocess.run(
            ["gs", "-dNOPAUSE", "-dBATCH", "-sDEVICE=ps2write", f"-sOutputFile={ps_path}", pdf_path],
            capture_output=True, timeout=60,
        )
        print(f"[toc] gs returncode: {gs_result.returncode}, ps exists: {os.path.exists(ps_path)}", flush=True)
        if gs_result.returncode != 0:
            print(f"[toc] gs stderr: {gs_result.stderr.decode()[:200]}", flush=True)
        if os.path.exists(ps_path) and os.path.getsize(ps_path) > 0:
            with open(ps_path, "rb") as f:
                ps_bytes = f.read()
            return StreamingResponse(io.BytesIO(ps_bytes), media_type="application/postscript")
        # gs 不可用，返回 PDF（打印机可能支持）
        if os.path.exists(pdf_path):
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf")
        return JSONResponse({"error": "PDF和PS都生成失败"}, status_code=500)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765)
