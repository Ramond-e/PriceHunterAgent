FROM python:3.11-slim-bookworm

WORKDIR /app

# ── 换国内镜像源（USTC），解决 deb.debian.org DNS 失败问题 ───────────────────
RUN rm -f /etc/apt/sources.list.d/*.sources \
    && echo "deb http://mirrors.ustc.edu.cn/debian bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list \
    && echo "deb http://mirrors.ustc.edu.cn/debian bookworm-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list \
    && echo "deb http://mirrors.ustc.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware" >> /etc/apt/sources.list

# ── 系统工具：虚拟显示 + VNC + noVNC ─────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        xvfb \
        x11vnc \
        novnc \
        websockify \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ── Python 依赖（使用清华 PyPI 镜像）────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    --trusted-host pypi.tuna.tsinghua.edu.cn

# ── Playwright Chromium（含全部系统库）────────────────────────────────────────
RUN playwright install chromium --with-deps

# ── 应用代码 ──────────────────────────────────────────────────────────────────
COPY . .
RUN chmod +x start.sh

EXPOSE 8000 6080

# 用 bash -c 在运行时先去掉 Windows \r，再执行脚本
# 这样 volume 挂载覆盖文件后依然有效
CMD ["/bin/bash", "-c", "sed -i 's/\\r//' /app/start.sh && bash /app/start.sh"]
