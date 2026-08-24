"""DocKit — static server สำหรับทดสอบบนคอม/มือถือในวง Wi-Fi เดียวกัน

รันด้วย serve.bat (ดับเบิลคลิก) หรือ  python serve.py [port]
"""
import http.server
import os
import socket
import sys
import threading
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
ROOT = os.path.dirname(os.path.abspath(__file__))


def lan_ip():
    """IP ที่เครื่องอื่นในวงเดียวกันใช้เรียกได้ (ไม่ได้ส่งอะไรออกจริง แค่ถาม routing table)"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # ระหว่างพัฒนาไม่ต้องให้เบราว์เซอร์ cache ไฟล์แอป (service worker จัดการ cache เอง)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    try:
        srv = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    except OSError as e:
        print("\n  เปิด server ไม่ได้ที่ port %d — %s" % (PORT, e))
        print("  ลองสั่ง:  python serve.py 8792\n")
        input("  กด Enter เพื่อปิด...")
        return 1

    ip = lan_ip()
    print("")
    print("  DocKit")
    print("  ------------------------------------------")
    print("  บนคอมนี้ : http://localhost:%d" % PORT)
    if ip:
        print("  บนมือถือ : http://%s:%d   (ต่อ Wi-Fi วงเดียวกัน)" % (ip, PORT))
    print("")
    print("  ปิดหน้าต่างนี้ หรือกด Ctrl+C = ปิด server")
    print("")

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
