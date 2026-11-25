#!/usr/bin/env python3
"""在 Windows 上打完 Linux 的 tar.gz 之后，把执行位补回去。

electron-builder 打包时按宿主文件系统的权限写 tar：在 Windows 上打出来的全是 0644，
用户在 Linux 上解压以后 `./feiyu-launcher` 根本跑不起来。这个脚本重写一遍 tar，
把该带的权限标上：

    feiyu-launcher           0755
    chrome-sandbox           4755  （Chromium 的 setuid 沙箱）
    chrome_crashpad_handler  0755
    *.so*                    0755  （动态库不需要，但无所谓）

用法：python scripts/fix-linux-tar.py <输入.tar.gz> [输出.tar.gz]
输出默认是 <输入>.fixed.tar.gz。
"""
from __future__ import annotations

import os
import sys
import tarfile

EXEC_NAMES = {"feiyu-launcher", "chrome-sandbox", "chrome_crashpad_handler"}


def fix(src: str, dst: str) -> int:
    fixed = 0
    with tarfile.open(src, "r:gz") as tin, tarfile.open(dst, "w:gz", compresslevel=6) as tout:
        for member in tin:
            base = os.path.basename(member.name)
            if base in EXEC_NAMES:
                member.mode = 0o4755 if base == "chrome-sandbox" else 0o755
                fixed += 1
            elif base.endswith((".so", ".so.1")) or ".so." in base:
                member.mode = 0o755
            if member.isdir():
                member.mode = 0o755
            else:
                # 保留文件内容；目录没有 data 流
                data = tin.extractfile(member) if member.isfile() else None
                tout.addfile(member, data)
                continue
            tout.addfile(member)
    return fixed


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(src)[0] + ".fixed.tar.gz"
    if not os.path.isfile(src):
        print(f"找不到 {src}")
        return 1
    n = fix(src, dst)
    print(f"补了 {n} 个可执行文件的权限位 -> {dst} ({os.path.getsize(dst) / 1048576:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
