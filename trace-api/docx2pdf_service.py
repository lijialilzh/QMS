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


@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    """接收 docx 文件，返回 PDF（保留完整格式）。"""
    docx_bytes = await file.read()
    with tempfile.TemporaryDirectory() as tmpdir:
        docx_path = os.path.join(tmpdir, "input.docx")
        with open(docx_path, "wb") as f:
            f.write(docx_bytes)
        result = subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmpdir, docx_path],
            capture_output=True, timeout=60,
        )
        pdf_path = os.path.join(tmpdir, "input.pdf")
        if os.path.exists(pdf_path):
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf")
        return JSONResponse({"error": "转换失败", "stderr": result.stderr.decode()[:200]}, status_code=500)


@app.post("/convert_ps")
async def convert_ps(file: UploadFile = File(...)):
    """接收 docx 文件，返回 PostScript（PDF→PS via Ghostscript，保留格式+中文）。"""
    docx_bytes = await file.read()
    with tempfile.TemporaryDirectory() as tmpdir:
        docx_path = os.path.join(tmpdir, "input.docx")
        with open(docx_path, "wb") as f:
            f.write(docx_bytes)
        # 第一步：docx→PDF
        subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmpdir, docx_path],
            capture_output=True, timeout=60,
        )
        pdf_path = os.path.join(tmpdir, "input.pdf")
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
