#!/usr/bin/env python
# encoding: utf-8
# @author: ZengLei


import socket


def read_ip():
    try:
        conn = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        conn.connect(("8.8.8.8", 80))
        ip = conn.getsockname()
        return ip[0] if ip else None
    finally:
        conn.close()
