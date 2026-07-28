#!/usr/bin/env python
# encoding: utf-8

# 简版 IPP 客户端：用 socket 发 IPP 请求，向 IPP 打印机发送打印任务。
# 仅实现 Print-Job 操作（RFC 8010/8011），无需第三方库。
# 参考：https://datatracker.ietf.org/doc/html/rfc8010

import socket
import struct
import time


# IPP 操作码
OP_PRINT_JOB = 0x0002
OP_GET_PRINTER_ATTRIBUTES = 0x000B

# IPP 版本 1.1
IPP_VERSION = (1, 1)

# 必需属性组标签
TAG_OPERATION = 0x01  # operation-attributes-tag
TAG_JOB = 0x02        # job-attributes-tag
TAG_END = 0x03        # end-of-attributes-tag

# 常用属性标签
TAG_INTEGER = 0x21
TAG_BOOLEAN = 0x22
TAG_ENUM = 0x23
TAG_CHARSET = 0x47
TAG_NATURAL_LANGUAGE = 0x48
TAG_URI = 0x45
TAG_NAME_WITHOUT_LANG = 0x42
TAG_KEYWORD = 0x44
TAG_MIME_MEDIA_TYPE = 0x49


def _encode_tag_value(tag, value):
    """编码单个属性：tag(1B) + name-len(2B) + name + value-len(2B) + value"""
    if isinstance(value, str):
        value = value.encode("utf-8")
    elif isinstance(value, int):
        value = struct.pack(">i", value)
    return value


def _attr(tag, name, value):
    name_b = name.encode("utf-8")
    if isinstance(value, str):
        value_b = value.encode("utf-8")
    elif isinstance(value, int):
        value_b = struct.pack(">i", value)
    elif isinstance(value, bool):
        value_b = struct.pack(">?", value)
    else:
        value_b = value
    return struct.pack(">B", tag) + struct.pack(">H", len(name_b)) + name_b + struct.pack(">H", len(value_b)) + value_b


def _build_print_job_request(printer_uri, job_name, document_format="application/octet-stream"):
    """构造 Print-Job 请求字节流（不含文档数据）。"""
    req_id = int(time.time()) & 0x7FFFFFFF
    # IPP 头：version(2B) + op-id(2B) + request-id(4B)
    header = struct.pack(">BB", *IPP_VERSION) + struct.pack(">H", OP_PRINT_JOB) + struct.pack(">i", req_id)
    # operation-attributes-tag
    body = struct.pack(">B", TAG_OPERATION)
    body += _attr(TAG_CHARSET, "attributes-charset", "utf-8")
    body += _attr(TAG_NATURAL_LANGUAGE, "attributes-natural-language", "en")
    body += _attr(TAG_URI, "printer-uri", printer_uri)
    body += _attr(TAG_NAME_WITHOUT_LANG, "requesting-user-name", "qms")
    body += _attr(TAG_NAME_WITHOUT_LANG, "job-name", job_name)
    body += _attr(TAG_MIME_MEDIA_TYPE, "document-format", document_format)
    # end-of-attributes
    body += struct.pack(">B", TAG_END)
    return header + body


def _build_get_printer_attributes_request(printer_uri):
    """构造 Get-Printer-Attributes 请求（用于测试连接）。"""
    req_id = int(time.time()) & 0x7FFFFFFF
    header = struct.pack(">BB", *IPP_VERSION) + struct.pack(">H", OP_GET_PRINTER_ATTRIBUTES) + struct.pack(">i", req_id)
    body = struct.pack(">B", TAG_OPERATION)
    body += _attr(TAG_CHARSET, "attributes-charset", "utf-8")
    body += _attr(TAG_NATURAL_LANGUAGE, "attributes-natural-language", "en")
    body += _attr(TAG_URI, "printer-uri", printer_uri)
    body += struct.pack(">B", TAG_END)
    return header + body


def test_printer(printer_uri, host, port=631, timeout=5):
    """测试打印机连接：发 Get-Printer-Attributes，返回 (ok, msg)。"""
    try:
        req = _build_get_printer_attributes_request(printer_uri)
        with socket.create_connection((host, port), timeout=timeout) as s:
            # HTTP/1.1 POST 包装
            http_req = (
                f"POST /ipp/print HTTP/1.1\r\n"
                f"Host: {host}\r\n"
                f"Content-Type: application/ipp\r\n"
                f"Content-Length: {len(req)}\r\n"
                f"\r\n"
            ).encode("utf-8") + req
            s.sendall(http_req)
            resp = s.recv(4096)
            # 解析 IPP 响应状态码（offset 2-3 after HTTP headers）
            # 简单判断：响应含 IPP version 即认为连通
            if b"IPP" in resp or (len(resp) > 4 and resp[0] == 1):
                return True, "连接成功"
            return False, "打印机无响应或非IPP协议"
    except socket.timeout:
        return False, f"连接超时（{host}:{port}）"
    except ConnectionRefusedError:
        return False, f"连接被拒绝（{host}:{port}），请检查IP和端口"
    except Exception as e:
        return False, f"连接失败：{str(e)[:80]}"


def print_document(printer_uri, host, port, job_name, document_bytes, document_format="application/octet-stream", timeout=30):
    """向 IPP 打印机发送打印任务：Print-Job。返回 (ok, msg)。"""
    try:
        req = _build_print_job_request(printer_uri, job_name, document_format)
        with socket.create_connection((host, port), timeout=timeout) as s:
            body = req + document_bytes
            http_req = (
                f"POST /ipp/print HTTP/1.1\r\n"
                f"Host: {host}\r\n"
                f"Content-Type: application/ipp\r\n"
                f"Content-Length: {len(body)}\r\n"
                f"\r\n"
            ).encode("utf-8") + body
            s.sendall(http_req)
            resp = s.recv(4096)
            # IPP 响应：version(2B) + status-code(2B) + request-id(4B) + ...
            # 找 HTTP body 起始（\r\n\r\n 之后）
            idx = resp.find(b"\r\n\r\n")
            ipp_resp = resp[idx + 4:] if idx >= 0 else resp
            if len(ipp_resp) >= 4:
                status = struct.unpack(">H", ipp_resp[2:4])[0]
                if status == 0x0000:
                    return True, "打印任务已提交"
                else:
                    return False, f"打印机返回错误状态：0x{status:04x}"
            return False, "打印机响应异常"
    except socket.timeout:
        return False, f"打印超时（{host}:{port}）"
    except ConnectionRefusedError:
        return False, f"连接被拒绝（{host}:{port}）"
    except Exception as e:
        return False, f"打印失败：{str(e)[:80]}"

# ===== TCP/IP 9100 端口协议（HP JetDirect / RAW）=====
# 大多数网络打印机支持 9100 端口，直接 socket 连上发送数据即可打印，无需协议封装。

def test_printer_9100(host, port=9100, timeout=5):
    """测试 9100 端口打印机连接：尝试 TCP 连接。返回 (ok, msg)。"""
    try:
        with socket.create_connection((host, port), timeout=timeout) as s:
            return True, "连接成功（9100端口）"
    except socket.timeout:
        return False, f"连接超时（{host}:{port}）"
    except ConnectionRefusedError:
        return False, f"连接被拒绝（{host}:{port}），请检查IP和端口"
    except Exception as e:
        return False, f"连接失败：{str(e)[:80]}"


def print_document_9100(host, port, job_name, document_bytes, timeout=60):
    """通过 9100 端口直接发送文档数据到打印机（RAW协议）。返回 (ok, msg)。"""
    try:
        with socket.create_connection((host, port), timeout=timeout) as s:
            s.sendall(document_bytes)
            # 等待打印机接收完成（发送完毕即可，9100是流式协议）
            return True, "打印任务已发送"
    except socket.timeout:
        return False, f"打印超时（{host}:{port}）"
    except ConnectionRefusedError:
        return False, f"连接被拒绝（{host}:{port}）"
    except Exception as e:
        return False, f"打印失败：{str(e)[:80]}"
