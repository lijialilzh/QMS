#\!/usr/bin/env python3
# encoding: utf-8
# docx→PDF 转换微服务：在宿主机运行，用 LibreOffice 转 docx 为 PDF。
# 后端 Docker 容器通过 host.docker.internal:8765 调用此服务。
# 用法：python3 docx2pdf_service.py
# 依赖：宿主机已安装 LibreOffice（soffice 命令可用），Ghostscript（gs 命令可选）

import io
import os
import subprocess
import tempfile
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn

app = FastAPI(title="docx2pdf Service")


def _convert_docx_to_pdf_with_toc(docx_path: str, pdf_path: str) -> bool:
    """用 LibreOffice UNO API 加载 docx，更新目录域后再导出 PDF。
    用 LibreOffice 自带的 python（含 uno 模块）执行 UNO 脚本。
    失败则回退到普通命令行转换。"""
    # macOS LibreOffice 自带 python 路径
    lo_python = "/Applications/LibreOffice.app/Contents/Resources/python"
    if not os.path.exists(lo_python):
        return False

    uno_script = r'''
import sys, time, uno
from com.sun.star.beans import PropertyValue

def prop(name, value):
    p = PropertyValue(); p.Name = name; p.Value = value; return p

ctx = uno.getComponentContext()
resolver = ctx.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", ctx)
connected = None
for _ in range(60):
    try:
        connected = resolver.resolve("uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext")
        break
    except Exception as e:
        connected = e; time.sleep(0.3)
if isinstance(connected, Exception):
    raise connected
desktop = connected.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", connected)
doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(sys.argv[1]), "_blank", 0,
    (prop("Hidden", True), prop("UpdateDocMode", 3)))
try:
    indexes = doc.getDocumentIndexes()
    for i in range(indexes.getCount()):
        indexes.getByIndex(i).update()
    try:
        doc.getTextFields().refresh()
    except Exception:
        pass
    doc.storeToURL(uno.systemPathToFileUrl(sys.argv[2]),
        (prop("FilterName", "writer_pdf_Export"), prop("Overwrite", True)))
finally:
    doc.close(True)
'''
    with tempfile.TemporaryDirectory(prefix="lo_toc_") as tmpdir:
        script_path = os.path.join(tmpdir, "refresh_toc.py")
        profile_dir = os.path.join(tmpdir, "lo_profile")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(uno_script)
        # 启动 soffice 监听 UNO 端口
        server = subprocess.Popen(
            ["soffice", "--headless", "--nologo", "--nodefault", "--nolockcheck",
             f"-env:UserInstallation=file://{profile_dir}",
             "--accept=socket,host=127.0.0.1,port=2002;urp;StarOffice.ServiceManager"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            # 用 LibreOffice 自带的 python 执行 UNO 脚本
            subprocess.run(
                [lo_python, script_path, docx_path, pdf_path],
                capture_output=True, timeout=120,
            )
        except Exception:
            return False
        finally:
            server.terminate()
            try: server.wait(timeout=10)
            except subprocess.TimeoutExpired: server.kill()
    return os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0


@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    """接收 docx 文件，返回 PDF（保留完整格式，自动更新目录域）。"""
    docx_bytes = await file.read()
    with tempfile.TemporaryDirectory() as tmpdir:
        docx_path = os.path.join(tmpdir, "input.docx")
        pdf_path = os.path.join(tmpdir, "input.pdf")
        with open(docx_path, "wb") as f:
            f.write(docx_bytes)
        # 优先用 UNO API 转换（更新目录域）；失败则回退命令行
        ok = _convert_docx_to_pdf_with_toc(docx_path, pdf_path)
        if not ok:
            subprocess.run(
                ["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmpdir, docx_path],
                capture_output=True, timeout=60,
            )
        if os.path.exists(pdf_path):
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf")
        return JSONResponse({"error": "转换失败"}, status_code=500)


@app.post("/convert_ps")
async def convert_ps(file: UploadFile = File(...)):
    """接收 docx 文件，返回 PostScript（PDF→PS via Ghostscript，保留格式+中文，自动更新目录域）。"""
    docx_bytes = await file.read()
    with tempfile.TemporaryDirectory() as tmpdir:
        docx_path = os.path.join(tmpdir, "input.docx")
        pdf_path = os.path.join(tmpdir, "input.pdf")
        with open(docx_path, "wb") as f:
            f.write(docx_bytes)
        # 优先用 UNO API 转 PDF（更新目录域）；失败则回退命令行
        ok = _convert_docx_to_pdf_with_toc(docx_path, pdf_path)
        if not ok:
            subprocess.run(
                ["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmpdir, docx_path],
                capture_output=True, timeout=60,
            )
        if not os.path.exists(pdf_path):
            return JSONResponse({"error": "docx转PDF失败"}, status_code=500)
        # 第二步：PDF→PostScript（用 Ghostscript）
        ps_path = os.path.join(tmpdir, "input.ps")
        gs_result = subprocess.run(
            ["gs", "-dNOPAUSE", "-dBATCH", "-sDEVICE=ps2write", f"-sOutputFile={ps_path}", pdf_path],
            capture_output=True, timeout=60,
        )
        if os.path.exists(ps_path):
            with open(ps_path, "rb") as f:
                ps_bytes = f.read()
            return StreamingResponse(io.BytesIO(ps_bytes), media_type="application/postscript")
        # gs 不可用，返回 PDF（打印机可能支持）
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
        return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765)
