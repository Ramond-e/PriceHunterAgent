"""
Browser-Use Python Microservice
Provides browser automation for searching Chinese e-commerce platforms.

Endpoints:
  POST /search          - Start an async product search task
  GET  /result/{id}     - Poll task status / result
  POST /resume/{id}     - Resume after user completes manual login
  POST /coupon          - Start an async coupon search task
  GET  /health          - Health check
"""

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from browser_use import Agent, Browser
from browser_use.browser.context import BrowserContext
from browser_use.controller.service import Controller
from langchain_openai import ChatOpenAI

# BrowserConfig 在不同版本的 browser_use 中位置不同，兼容处理
try:
    from browser_use import BrowserConfig                        # 0.1.x
except ImportError:
    try:
        from browser_use.browser.browser import BrowserConfig   # 部分 0.1.x 子版本
    except ImportError:
        BrowserConfig = None

try:
    from browser_use.browser.context import BrowserContextConfig
except ImportError:
    BrowserContextConfig = None

# Chromium 用户数据目录（挂载到宿主机 ./browser-data，实现 Cookie 跨容器重启持久化）
BROWSER_DATA_DIR = "/app/browser-data"
BROWSER_COOKIES_FILE = os.path.join(BROWSER_DATA_DIR, "saved_cookies.json")
os.makedirs(BROWSER_DATA_DIR, exist_ok=True)

# 清理 Chromium 上次异常退出遗留的 Singleton 锁文件，防止新实例无法启动
for _lock in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
    _lp = os.path.join(BROWSER_DATA_DIR, _lock)
    if os.path.exists(_lp):
        try:
            os.remove(_lp)
            print(f"[main] Removed stale lock: {_lp}")
        except OSError:
            pass

# 确保 Playwright/Chromium 在 Xvfb 上显示（Docker 内必须）
os.environ.setdefault("DISPLAY", ":99")
os.environ.setdefault("IN_DOCKER", "true")

_shared_browser: Optional[Browser] = None
_automation_context: Optional[BrowserContext] = None
_browser_lock = asyncio.Lock()

# deepseek-v4-* 在 API 侧会走 reasoner，不支持 browser-use 的 tool_choice
BROWSER_LLM_MODEL = os.environ.get("BROWSER_LLM_MODEL", "deepseek-chat")

PLATFORM_LABELS = {"jd": "京东", "taobao": "淘宝", "pdd": "拼多多"}

DOCKER_CHROME_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
]

IDLE_PAGE_HTML = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>AI 比价购物系统</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#0f2942 100%);
    font-family:'Segoe UI',system-ui,sans-serif;color:#e2e8f0;text-align:center;
    overflow:hidden;
  }
  .card{
    background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
    border-radius:20px;padding:48px 56px;max-width:480px;width:90%;
    backdrop-filter:blur(12px);box-shadow:0 24px 64px rgba(0,0,0,0.5);
  }
  .icon{font-size:52px;margin-bottom:20px;display:block}
  h1{font-size:26px;font-weight:700;letter-spacing:-.5px;margin-bottom:10px}
  .sub{font-size:14px;color:#94a3b8;line-height:1.8;margin-bottom:28px}
  .platforms{display:flex;justify-content:center;gap:12px;margin-bottom:28px}
  .platform{
    padding:6px 16px;border-radius:99px;font-size:12px;font-weight:600;
    border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);
    color:#cbd5e1;
  }
  .jd{border-color:#e1251b55;color:#fca5a5}
  .tb{border-color:#ff660055;color:#fdba74}
  .pdd{border-color:#e02e2455;color:#fca5a5}
  .hint{
    font-size:12px;color:#64748b;border-top:1px solid rgba(255,255,255,0.08);
    padding-top:20px;line-height:1.7;
  }
  .dot{
    display:inline-block;width:8px;height:8px;border-radius:50%;
    background:#22c55e;box-shadow:0 0 8px #22c55e;margin-right:6px;
    animation:pulse 2s ease-in-out infinite;
  }
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
<div class="card">
  <span class="icon">🛒</span>
  <h1>AI 比价购物系统</h1>
  <p class="sub">
    <span class="dot"></span>浏览器已就绪<br>
    请在前端输入商品名称发起搜索<br>
    AI 将自动操作浏览器完成全网比价
  </p>
  <div class="platforms">
    <span class="platform jd">京东</span>
    <span class="platform tb">淘宝</span>
    <span class="platform pdd">拼多多</span>
  </div>
  <div class="hint">
    Powered by DeepSeek · Browser-Use · .NET 8<br>
    © 2026 Raymondeng
  </div>
</div>
</body>
</html>"""


def resolve_api_key(body_key: str, header_key: str | None = None) -> str:
    """合并 body / header 中的 API Key，并写入环境变量供 browser-use 使用。"""
    key = (body_key or header_key or os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if key:
        os.environ["OPENAI_API_KEY"] = key
        os.environ["DEEPSEEK_API_KEY"] = key
    return key


def build_llm(api_key: str, max_tokens: int = 4096) -> ChatOpenAI:
    return ChatOpenAI(
        model=BROWSER_LLM_MODEL,
        base_url="https://api.deepseek.com/v1",
        api_key=api_key,
        temperature=0,
        max_tokens=max_tokens,
    )


def agent_tool_calling_method(model: str) -> str:
    """reasoner / v4 模型不支持 function calling，改用 raw 模式。"""
    m = model.lower()
    if any(x in m for x in ("reasoner", "r1", "v4")):
        return "raw"
    return "auto"


def build_combined_search_task(product: str, platforms: list[str]) -> str:
    steps = []
    for i, platform in enumerate(platforms, 1):
        if platform not in PLATFORM_TASKS:
            continue
        label = PLATFORM_LABELS.get(platform, platform)
        steps.append(
            f"### 第{i}步：{label}（{platform}）\n"
            + PLATFORM_TASKS[platform].format(product=product)
        )
    platform_keys = ",".join(p for p in platforms if p in PLATFORM_TASKS)
    return (
        f"请在同一浏览器窗口中依次完成以下平台搜索，商品：{product}。\n"
        "每步必须真正打开对应网站并完成搜索，不要跳过。\n"
        "全部完成后，用 done 动作返回一个 JSON 对象，键为平台代号，值为该平台提取到的 JSON 数组或文本。\n"
        f"键名必须为：{platform_keys}\n\n"
        + "\n\n".join(steps)
    )


def extract_results_from_history(history, platforms: list[str]) -> dict[str, str]:
    """从 Agent 历史中取出结果；失败时返回可读错误而非空字符串。"""
    final = history.final_result()
    if final and str(final).strip():
        text = str(final).strip()
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return {
                    p: json.dumps(parsed[p], ensure_ascii=False)
                    if p in parsed and not isinstance(parsed[p], str)
                    else str(parsed.get(p, text))
                    for p in platforms
                }
        except json.JSONDecodeError:
            pass
        return {p: text for p in platforms}

    errors = [e for e in history.errors() if e]
    if errors:
        msg = errors[-1]
        return {p: f"搜索失败: {msg}" for p in platforms}

    if history.is_successful() is False:
        return {p: "搜索失败: Agent 报告未成功完成" for p in platforms}

    return {
        p: (
            "搜索未完成：浏览器 Agent 未能执行操作。"
            "请确认使用 deepseek-chat 模型（勿用 v4/reasoner）。"
        )
        for p in platforms
    }


def make_browser() -> Browser:
    """有头模式 + Docker 参数，在 Xvfb :99 上显示 Chromium 窗口。
    user_data_dir 让 Chromium 使用持久化 Profile，登录 Cookie 自动保存到磁盘。
    """
    cfg_kwargs: dict = {
        "headless": False,
        "keep_alive": True,
        "extra_browser_args": list(DOCKER_CHROME_ARGS),
    }
    # user_data_dir：让 Chromium 将 Cookie/Session 写入持久化目录，重启后无需重新登录
    if BrowserConfig is not None:
        try:
            cfg_kwargs["user_data_dir"] = BROWSER_DATA_DIR
            browser_cfg = BrowserConfig(**cfg_kwargs)
        except TypeError:
            # 某些 browser-use 版本不支持 user_data_dir，降级处理
            cfg_kwargs.pop("user_data_dir", None)
            browser_cfg = BrowserConfig(**cfg_kwargs)
        if BrowserContextConfig is not None:
            try:
                browser_cfg.new_context_config = BrowserContextConfig(
                    no_viewport=False,
                    window_width=1280,
                    window_height=900,
                    highlight_elements=True,
                )
            except Exception:
                pass
        return Browser(config=browser_cfg)
    return Browser()


async def _restore_cookies(ctx: BrowserContext) -> None:
    """从备份文件恢复 Cookie（user_data_dir 失效时的兜底方案）。"""
    if not os.path.exists(BROWSER_COOKIES_FILE):
        return
    try:
        with open(BROWSER_COOKIES_FILE, encoding="utf-8") as f:
            cookies = json.load(f)
        if not cookies:
            return
        # 尝试访问底层 Playwright Context
        playwright_ctx = getattr(ctx, "context", None)
        if playwright_ctx is not None:
            await playwright_ctx.add_cookies(cookies)
            print(f"[main] Restored {len(cookies)} cookies from backup")
    except Exception as e:
        print(f"[main] Cookie restore failed (non-fatal): {e}")


async def save_cookies() -> None:
    """将当前浏览器上下文的所有 Cookie 保存到磁盘备份文件。"""
    try:
        ctx = _automation_context
        if ctx is None:
            return
        playwright_ctx = getattr(ctx, "context", None)
        if playwright_ctx is None:
            return
        cookies = await playwright_ctx.cookies()
        # 过滤掉无效 Cookie，减小文件体积
        valid = [c for c in cookies if c.get("name") and c.get("domain")]
        with open(BROWSER_COOKIES_FILE, "w", encoding="utf-8") as f:
            json.dump(valid, f, ensure_ascii=False)
        print(f"[main] Saved {len(valid)} cookies to backup")
    except Exception as e:
        print(f"[main] Cookie save failed (non-fatal): {e}")


async def get_shared_browser() -> Browser:
    global _shared_browser
    async with _browser_lock:
        if _shared_browser is None:
            _shared_browser = make_browser()
        return _shared_browser


async def get_automation_context() -> BrowserContext:
    """单一浏览器上下文，避免每次搜索新建窗口导致 about:blank 闪烁。
    创建时自动恢复备份 Cookie，确保登录状态持久化。
    """
    global _automation_context
    browser = await get_shared_browser()
    async with _browser_lock:
        if _automation_context is None:
            _automation_context = await browser.new_context()
            # 尝试从备份恢复 Cookie（user_data_dir 无效时的兜底）
            await _restore_cookies(_automation_context)
    return _automation_context


async def show_idle_page() -> None:
    """在固定上下文中显示欢迎页，失败时最多重试 5 次（Chromium 启动需要时间）。"""
    for attempt in range(5):
        try:
            ctx = await get_automation_context()
            page = await ctx.get_current_page()
            await page.set_content(IDLE_PAGE_HTML, wait_until="domcontentloaded")
            print("[main] idle page loaded OK")
            return
        except Exception as exc:
            print(f"[main] show_idle_page attempt {attempt + 1}/5 failed: {exc}")
            # 重置上下文，下次重试时重新创建
            global _automation_context, _shared_browser
            _automation_context = None
            _shared_browser = None
            await asyncio.sleep(2)
    print("[main] WARNING: could not load idle page after 5 attempts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时给 Chromium 一点初始化时间再加载欢迎页
    await asyncio.sleep(1)
    await show_idle_page()
    yield
    global _shared_browser, _automation_context
    if _automation_context is not None:
        try:
            await _automation_context.close()
        except Exception:
            pass
        _automation_context = None
    if _shared_browser is not None:
        try:
            await _shared_browser.close()
        except Exception:
            pass
        _shared_browser = None


app = FastAPI(title="Browser-Use Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tasks: dict[str, dict] = {}

_COUPON_STEPS = (
    "  【优惠券操作——进入详情页后必须执行】\n"
    "  ① 仔细观察页面中所有优惠相关区域：\n"
    "     - 标有【领券】【优惠券】【满减】【立减】【折扣】【活动价】的按钮或文字\n"
    "     - 价格旁边的红色/橙色标签、角标\n"
    "     - 页面顶部横幅或浮动提示条\n"
    "  ② 若看到任何【领取】【立即领取】【点击领取】【领券】按钮，必须点击尝试领取。\n"
    "  ③ 若领取成功，记录优惠内容（如：满300减50已领取）。\n"
    "  ④ 若需要登录才能领券，先记录优惠内容，标注：需登录才能领取。\n"
    "  ⑤ 将所有看到的优惠信息（无论能否领取）都记录到 coupon 字段，多条用/分隔；没有则填 null。\n"
)

PLATFORM_TASKS = {
    "jd": (
        "【京东比价任务】商品：{product}\n\n"
        "第1步：打开 https://search.jd.com/Search?keyword={product}，等待搜索结果加载。\n"
        "第2步：若出现任何登录弹窗或跳转到登录页，立即调用 wait_for_user_login('京东')，"
        "不要点弹窗内任何按钮。登录后若不在搜索结果页，重新打开上述URL。\n"
        "第3步：在搜索结果页，找到前5个商品，按顺序逐一操作（每次只开一个详情页）：\n"
        "  (a) 点击该商品标题或图片，进入商品详情页，等待加载完成\n"
        "  (b) 在页面顶部区域提取：商品完整名称、当前价格（¥）\n"
        + _COUPON_STEPS +
        "  (c) 向下滚动页面，找到评价/评论区域，提取以下信息：\n"
        "     - 累计评价总数（如：12万条评价）\n"
        "     - 好评率或好评数量（如：好评率98%，或好评12000条）\n"
        "     - 差评数量（如：差评300条；若页面显示好评率则用 100%-好评率 估算）\n"
        "     - 差评主要原因：点击【差评】或【中评】标签，阅读最新3~5条差评内容，\n"
        "       总结用户差评的核心原因（如：吸力下降、续航短、噪音大、客服态度差等），\n"
        "       若差评数极少或无法点击差评标签，写：暂无明显差评\n"
        "     - 好评关键词：从好评中提炼2~3个高频正面词（如：吸力强、轻便、续航好）\n"
        "     - 店铺名称\n"
        "  (d) 记录当前页面URL\n"
        "  (e) 关闭该商品详情页标签，回到搜索结果页，准备处理下一个商品\n"
        "第4步：5个商品全部处理完毕后，调用 done，返回 JSON 数组：\n"
        '[{{"name":"商品名","price":"¥XX","coupon":"优惠信息或null","shop":"店铺名",'
        '"reviews_total":"XX万条","good_rate":"XX%","bad_reasons":"差评主要原因摘要",'
        '"good_keywords":"好评关键词","url":"https://..."}},...]\n'
        "严格规则：每次只能打开一个详情页标签；看完必须关闭该标签再处理下一个；不得同时打开多个商品标签。"
    ),
    "taobao": (
        "【淘宝比价任务】商品：{product}\n\n"
        "第1步：打开 https://s.taobao.com/search?q={product}，等待搜索结果加载。\n"
        "第2步：若出现任何登录弹窗（密码/短信/扫码等任何登录界面），立即调用 wait_for_user_login('淘宝')，"
        "不要关闭或点击弹窗内任何按钮。登录后若不在搜索结果页，重新打开上述URL。\n"
        "第3步：在搜索结果页，找到前5个商品，按顺序逐一操作（每次只开一个详情页）：\n"
        "  (a) 点击该商品标题或图片，进入商品详情页，等待加载完成\n"
        "  (b) 在页面顶部区域提取：商品完整名称、当前价格（¥）\n"
        + _COUPON_STEPS +
        "  (c) 向下滚动页面，找到评价/评论区域，提取以下信息：\n"
        "     - 月销量（如：月销1000+）、店铺名称\n"
        "     - 累计评价总数、好评率或好评数量\n"
        "     - 差评主要原因：点击【差评】标签，阅读3~5条差评，\n"
        "       总结核心负面反馈（如：质量一般、与描述不符、发货慢等）；\n"
        "       若差评极少则写：暂无明显差评\n"
        "     - 好评关键词：从好评中提炼2~3个高频正面词\n"
        "  (d) 记录当前页面URL\n"
        "  (e) 关闭该商品详情页标签，回到搜索结果页，准备处理下一个商品\n"
        "第4步：5个商品全部处理完毕后，调用 done，返回 JSON 数组：\n"
        '[{{"name":"商品名","price":"¥XX","coupon":"优惠信息或null","shop":"店铺名",'
        '"sales":"月销XXX","reviews_total":"XX条","good_rate":"XX%",'
        '"bad_reasons":"差评主要原因","good_keywords":"好评关键词","url":"https://..."}},...]\n'
        "严格规则：每次只能打开一个详情页标签；看完必须关闭该标签再处理下一个；不得同时打开多个商品标签。"
    ),
    "pdd": (
        "【拼多多比价任务】商品：{product}\n\n"
        "第1步：打开 https://mobile.pinduoduo.com/，等待首页加载完成。\n"
        "第2步：点击页面顶部的搜索框，输入 {product}，点击搜索按钮，等待搜索结果页加载。\n"
        "第3步：立即调用 dismiss_pdd_overlay 关闭可能出现的'扫码用App打开'浮层。\n"
        "第4步：若出现登录弹窗，立即调用 wait_for_user_login('拼多多')，不要点弹窗内任何按钮。\n"
        "第5步：向下滚动搜索结果页，每次滚动后等待内容加载。【严格限制：最多只滑动6次，超过6次立即停止】\n"
        "第6步：调用 extract_pdd_search_results，从搜索结果页直接提取商品数据（名称/价格/优惠/销量）。\n"
        "  - 若商品数不足5个但已滑动6次，不再继续滑动，直接用已有数据。\n"
        "第7步：调用 extract_pdd_product_links 获取商品链接列表（用于进入详情页）。\n"
        "  - 若 extract_pdd_product_links 返回链接，优先用 open_tab 打开详情页。\n"
        "  - 若没有链接，尝试调用 tap_pdd_product 点击第1、2、3、4、5个商品。\n"
        "第8步：从链接列表中取前5个，逐一用 open_tab 打开详情页（每次只开一个）：\n"
        "  (a) open_tab 打开链接，等待页面加载；若页面无法加载或强制跳转App则跳过此商品\n"
        "  (b) 在详情页提取商品名称、当前价格\n"
        + _COUPON_STEPS +
        "  (c) 向下滚动页面，找到评价/评论区域，提取：\n"
        "     - 已拼/已购件数（如：XX万人已购）\n"
        "     - 好评率或好评标签（如：好评率97%）\n"
        "     - 差评主要原因：点击差评标签，阅读3~5条差评内容，\n"
        "       总结核心负面反馈；若差评极少则写：暂无明显差评\n"
        "     - 好评关键词：2~3个高频正面词\n"
        "  (d) 关闭该标签，回到搜索结果页\n"
        "  注意：若详情页无法正常打开，使用第6步搜索结果中的数据，跳过此商品。\n"
        "第9步：5个商品全部处理完毕后，调用 done，返回 JSON 数组：\n"
        '[{{"name":"商品名","price":"¥XX","coupon":"优惠信息或null",'
        '"sold":"XX万人已购","good_rate":"XX%","bad_reasons":"差评原因","good_keywords":"好评关键词",'
        '"url":"https://..."}},...]\n'
        "严格规则：\n"
        "- 拼多多移动端点击商品无效，必须用 open_tab + URL 进入详情页\n"
        "- 每次只能打开一个详情页标签，看完立即关闭\n"
        "- 若详情页无法访问，搜索结果中的数据已经足够，直接使用"
    ),
}

COUPON_TASK = (
    "打开商品链接 {url}，"
    "等待页面加载完成。"
    "注意：若平台为拼多多，请使用移动版页面（mobile.pinduoduo.com），PC版可能无法正常显示优惠券。"
    "查找页面上所有可用的优惠券、满减活动和促销信息。"
    "如果需要登录才能领取优惠券，请调用 wait_for_user_login 函数并传入参数 '{platform}'。"
    "尝试点击'领取优惠券'、'立即领取'或'点击领取'按钮。"
    "返回所有找到的优惠信息：券面额、使用条件、有效期、是否已成功领取。"
    "以JSON格式返回包含字段：coupons（数组），每项含 amount, condition, expiry, claimed。"
)


class SearchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product: str
    api_key: str = Field(validation_alias=AliasChoices("api_key", "apiKey"))
    platforms: list[str] = ["jd", "taobao", "pdd"]


class CouponRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    platform: str
    product: str
    url: str
    api_key: str = Field(validation_alias=AliasChoices("api_key", "apiKey"))


def make_controller(task_id: str, platform: str = "") -> Controller:
    controller = Controller()

    @controller.action("如果当前页面需要用户登录才能继续，调用此函数暂停并等待用户手动完成登录")
    async def wait_for_user_login(platform: str) -> str:  # noqa: F841
        task = tasks.get(task_id)
        if task:
            task["status"] = "login_required"
            task["login_platform"] = platform
            event: asyncio.Event = task["login_event"]
            event.clear()
            await event.wait()
        # 登录完成后立即保存 Cookie，下次启动无需重新登录
        await save_cookies()
        return f"用户已在 {platform} 完成登录，继续执行搜索。"

    # PDD 专用动作：绕过移动端点击限制，用 JS 直接提取数据
    if platform == "pdd":

        @controller.action(
            "关闭拼多多页面上的'扫码用App打开'浮层/弹窗。"
            "进入搜索结果页后立即调用此函数，防止浮层拦截后续操作。"
        )
        async def dismiss_pdd_overlay() -> str:
            try:
                ctx = _automation_context
                if ctx is None:
                    return "浏览器上下文未初始化。"
                page = await ctx.get_current_page()
                removed: int = await page.evaluate("""() => {
                    let n = 0;
                    const keywords = ['download', 'app', 'popup', 'modal', 'overlay',
                                      'qrcode', 'guide', 'dialog', 'banner', 'float'];
                    document.querySelectorAll('*').forEach(el => {
                        const cls = (el.className || '').toString().toLowerCase();
                        const id  = (el.id || '').toLowerCase();
                        if (keywords.some(k => cls.includes(k) || id.includes(k))) {
                            const style = window.getComputedStyle(el);
                            if (style.position === 'fixed' || style.position === 'absolute') {
                                el.remove(); n++;
                            }
                        }
                    });
                    document.dispatchEvent(
                        new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
                    return n;
                }""")
                await page.keyboard.press("Escape")
                return f"已清除 {removed} 个浮层元素，页面可正常操作。"
            except Exception as e:
                return f"关闭浮层失败: {e}"

        @controller.action(
            "从当前拼多多搜索结果页中提取前5~8个商品的完整信息（名称、价格、优惠、销量、链接）。"
            "滚动到至少5个商品可见后调用此函数；若商品数量不足则继续滚动后再调用。"
        )
        async def extract_pdd_search_results() -> str:
            try:
                ctx = _automation_context
                if ctx is None:
                    return "浏览器上下文未初始化。"
                page = await ctx.get_current_page()
                products: list = await page.evaluate("""() => {
                    const results = [];

                    // 尝试多种选择器找到商品卡片
                    const cardSelectors = [
                        'li[data-goods-id]', 'li.goods-list-item',
                        '[class*="goods-item"]', '[class*="search-result"]',
                        '[class*="SearchListItem"]', '[class*="GoodsCard"]',
                        '.list-view > li', '.commodity-list > li', 'li.list-item'
                    ];
                    let cards = [];
                    for (const sel of cardSelectors) {
                        cards = Array.from(document.querySelectorAll(sel));
                        if (cards.length >= 2) break;
                    }
                    // 兜底：找包含价格和图片的 li/article
                    if (cards.length < 2) {
                        cards = Array.from(document.querySelectorAll('li, article'))
                            .filter(el => /[¥￥]\s*\d+/.test(el.textContent || '') &&
                                          el.querySelector('img'));
                    }

                    cards.slice(0, 8).forEach(card => {
                        const text = card.textContent || '';

                        // 价格：优先"券后价"
                        const pMatch = text.match(/券后[¥￥]?\s*(\d+(?:\.\d+)?)|[¥￥]\s*(\d+(?:\.\d+)?)/);
                        const price = pMatch ? '¥' + (pMatch[1] || pMatch[2]) : null;
                        if (!price) return;

                        // 优惠信息
                        const discounts = [];
                        [/立减[¥￥]?\d+/g, /券减[¥￥]?\d+/g, /百亿补贴/g,
                         /\d+元券/g, /满\d+减\d+/g, /减\d+/g].forEach(p => {
                            const m = text.match(p);
                            if (m) discounts.push(...m);
                        });

                        // 销量
                        let sales = null;
                        for (const p of [
                            /\d+(?:\.\d+)?万[+＋]?(?:人已购|件|单)/,
                            /\d+[+＋]?万?(?:人已购|件已拼|已拼|已购)/,
                            /本店已拼(\d+)件/, /月销\d+[+＋]?/
                        ]) {
                            const m = text.match(p);
                            if (m) { sales = m[0]; break; }
                        }

                        // 标题
                        let title = null;
                        const tEl = card.querySelector(
                            '[class*="title"],[class*="name"],[class*="desc"],[class*="goods-name"]');
                        if (tEl) title = tEl.textContent.trim().slice(0, 60);
                        if (!title) title = text.replace(/\s+/g,' ').trim().slice(0, 60);

                        // 商品链接
                        let url = null;
                        card.querySelectorAll('a[href]').forEach(a => {
                            const h = a.href;
                            if (!url && (h.includes('goods_id') || h.includes('/goods.html') ||
                                         h.includes('goodsId') || h.includes('goods-detail'))) {
                                url = h;
                            }
                        });

                        results.push({ title, price, discount: discounts.join(', ') || null,
                                       sales, url });
                    });
                    return results;
                }""")

                if not products:
                    return "未能从搜索结果提取商品数据，请确认已在拼多多搜索结果页，或继续向下滚动后重试。"
                return json.dumps(products[:5], ensure_ascii=False, indent=2)
            except Exception as e:
                return f"提取搜索结果失败: {e}"

        @controller.action(
            "从当前拼多多搜索结果页中用 JavaScript 提取所有商品链接并返回列表。"
            "当需要进入商品详情页时，先用此方法获取链接，再用 open_tab 打开。"
        )
        async def extract_pdd_product_links() -> str:
            try:
                ctx = _automation_context
                if ctx is None:
                    return "浏览器上下文未初始化，请稍后重试。"
                page = await ctx.get_current_page()
                links: list = await page.evaluate("""() => {
                    const seen = new Set();
                    const results = [];
                    document.querySelectorAll('a[href]').forEach(a => {
                        const h = a.href;
                        if ((h.includes('goods_id') || h.includes('goodsId') ||
                             h.includes('/goods.html') || h.includes('goods-detail')) &&
                            !seen.has(h)) {
                            seen.add(h);
                            results.push(h);
                        }
                    });
                    return results.slice(0, 10);
                }""")
                if not links:
                    return "未找到商品链接，请继续向下滚动后再次调用此函数。"
                return json.dumps(links, ensure_ascii=False)
            except Exception as e:
                return f"提取链接失败: {e}"

        @controller.action(
            "在拼多多搜索结果页模拟点击第 n 个商品（n 从1开始）。"
            "当 extract_pdd_product_links 无法提取链接时，用此方法尝试触发商品页面跳转。"
        )
        async def tap_pdd_product(n: int) -> str:
            """用 JavaScript 触摸事件模拟点击第 n 个商品卡片，绕过移动端 onclick 限制。"""
            try:
                ctx = _automation_context
                if ctx is None:
                    return "浏览器上下文未初始化。"
                page = await ctx.get_current_page()

                result: str = await page.evaluate(f"""() => {{
                    const idx = {n} - 1;
                    // 尝试多种商品卡片选择器
                    const selectors = [
                        'li[data-goods-id]', 'li.goods-list-item',
                        '[class*="goods-item"]', '[class*="GoodsCard"]',
                        '[class*="SearchListItem"]', '.list-view > li',
                        '.commodity-list > li', 'li.list-item'
                    ];
                    let cards = [];
                    for (const sel of selectors) {{
                        cards = Array.from(document.querySelectorAll(sel));
                        if (cards.length > idx) break;
                    }}
                    if (cards.length <= idx) {{
                        return '未找到第' + {n} + '个商品卡片，当前找到 ' + cards.length + ' 个';
                    }}
                    const el = cards[idx];
                    const rect = el.getBoundingClientRect();
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;

                    // 先尝试直接 click
                    const clickable = el.querySelector('a') || el;
                    clickable.click();

                    // 再补发 touch 事件（移动端）
                    const touch = new Touch({{identifier: Date.now(), target: el, clientX: cx, clientY: cy}});
                    el.dispatchEvent(new TouchEvent('touchstart', {{bubbles:true, touches:[touch], changedTouches:[touch]}}));
                    el.dispatchEvent(new TouchEvent('touchend',   {{bubbles:true, touches:[],    changedTouches:[touch]}}));

                    // 尝试触发 href 跳转
                    const link = el.querySelector('a[href]');
                    if (link && link.href) return '已触发点击，链接: ' + link.href;
                    return '已触发点击第' + {n} + '个商品';
                }}""")

                await asyncio.sleep(1.5)  # 等待页面响应跳转
                current_url = page.url
                return f"{result}。当前页面: {current_url}"
            except Exception as e:
                return f"模拟点击失败: {e}"

    return controller


async def run_one_platform(
    platform: str,
    product: str,
    api_key: str,
    task_id: str,
    llm,
    browser,
    browser_context,
) -> str:
    """在已有浏览器上下文中完成单平台搜索，支持登录中断。"""
    task_text = PLATFORM_TASKS[platform].format(product=product)
    controller = make_controller(task_id, platform=platform)

    agent = Agent(
        task=task_text,
        llm=llm,
        browser=browser,
        browser_context=browser_context,
        controller=controller,
        max_actions_per_step=1,   # 每个动作后立即重新观察页面，确保滚动→看→决策的循环
        use_vision=False,
        enable_memory=False,
        tool_calling_method=agent_tool_calling_method(BROWSER_LLM_MODEL),
        extend_system_message=(
            "你在操作中国电商网站，必须实际使用浏览器动作完成任务。\n"
            "遇到任何登录弹窗或登录提示，立即调用 wait_for_user_login，不要尝试关闭或点击弹窗内的元素。\n"
            "【滚动观察规则】：每次执行 scroll 动作后，先阅读页面当前内容，\n"
            "确认看到了哪些商品或信息，再决定是继续滚动还是点击商品或提取数据。\n"
            "【标签页管理规则】：\n"
            "  - 打开商品详情页时，使用 open_tab 或点击链接进入新标签；\n"
            "  - 看完一个商品后，必须使用 close_tab 关闭当前详情页，切换回搜索结果页；\n"
            "  - 任何时刻同时开着的标签页不超过 2 个（搜索页 + 当前详情页）；\n"
            "  - 完成全部5个商品后，调用 done 返回 JSON 数组。"
        ),
    )
    history = await agent.run(max_steps=120)  # 步数加倍以补偿 max_actions_per_step=1
    final = history.final_result()
    if final and str(final).strip():
        return str(final).strip()
    errors = [e for e in history.errors() if e]
    return f"搜索失败: {errors[-1]}" if errors else "搜索未完成"


async def run_search(task_id: str, product: str, api_key: str, platforms: list[str]):
    task = tasks[task_id]
    try:
        api_key = resolve_api_key(api_key)
        if not api_key:
            task["status"] = "error"
            task["error"] = "DeepSeek API Key 未设置，请点击右上角设置按钮填写 API Key"
            return

        valid_platforms = [p for p in platforms if p in PLATFORM_TASKS]
        if not valid_platforms:
            task["status"] = "error"
            task["error"] = "未指定有效平台（jd / taobao / pdd）"
            return

        llm = build_llm(api_key)
        browser = await get_shared_browser()
        browser_context = await get_automation_context()
        results = {}

        # 逐平台独立 Agent，共享同一浏览器上下文（不会新建标签/上下文）
        for platform in valid_platforms:
            # 每个平台开始前重置登录事件（上一个平台可能已触发）
            task["login_event"].set()
            task["login_platform"] = None
            if task["status"] != "running":
                task["status"] = "running"

            results[platform] = await run_one_platform(
                platform, product, api_key, task_id, llm, browser, browser_context
            )
            # 每个平台完成后保存一次 Cookie，确保最新登录态持久化
            await save_cookies()

        task["status"] = "completed"
        task["result"] = json.dumps(results, ensure_ascii=False)

    except asyncio.CancelledError:
        task["status"] = "error"
        task["error"] = "搜索被取消"
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)


async def run_coupon(task_id: str, platform: str, product: str, url: str, api_key: str):
    task = tasks[task_id]
    try:
        api_key = resolve_api_key(api_key)
        if not api_key:
            task["status"] = "error"
            task["error"] = "DeepSeek API Key 未设置，请点击右上角设置按钮填写 API Key"
            return

        llm = build_llm(api_key, max_tokens=2048)
        browser = await get_shared_browser()
        browser_context = await get_automation_context()
        controller = make_controller(task_id)
        task_text = COUPON_TASK.format(url=url, platform=platform, product=product)

        agent = Agent(
            task=task_text,
            llm=llm,
            browser=browser,
            browser_context=browser_context,
            controller=controller,
            max_actions_per_step=10,
            use_vision=False,
            enable_memory=False,
            tool_calling_method=agent_tool_calling_method(BROWSER_LLM_MODEL),
        )
        history = await agent.run(max_steps=20)
        final = history.final_result()
        if final and str(final).strip():
            task["status"] = "completed"
            task["result"] = str(final)
        else:
            errors = [e for e in history.errors() if e]
            task["status"] = "error"
            task["error"] = errors[-1] if errors else "优惠券搜索未完成"
            return

    except asyncio.CancelledError:
        task["status"] = "error"
        task["error"] = "优惠券搜索被取消"
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)


@app.get("/health")
async def health():
    return {"status": "ok", "active_tasks": len(tasks)}


@app.post("/search")
async def search(
    req: SearchRequest,
    x_deepseek_api_key: str | None = Header(default=None, alias="X-DeepSeek-Api-Key"),
):
    api_key = resolve_api_key(req.api_key, x_deepseek_api_key)
    task_id = str(uuid.uuid4())
    login_event = asyncio.Event()
    login_event.set()
    tasks[task_id] = {
        "status": "running",
        "result": None,
        "error": None,
        "login_platform": None,
        "login_event": login_event,
    }
    asyncio.create_task(run_search(task_id, req.product, api_key, req.platforms))
    return {"task_id": task_id}


@app.get("/result/{task_id}")
async def get_result(task_id: str):
    task = tasks.get(task_id)
    if not task:
        return {"status": "not_found"}
    return {
        "status": task["status"],
        "login_platform": task.get("login_platform"),
        "result": task.get("result"),
        "error": task.get("error"),
    }


@app.post("/resume/{task_id}")
async def resume_task(task_id: str):
    task = tasks.get(task_id)
    if task and task["status"] == "login_required":
        task["status"] = "running"
        task["login_platform"] = None
        event: asyncio.Event = task["login_event"]
        event.set()
        return {"status": "resumed"}
    return {"status": "not_found_or_not_paused"}


@app.post("/coupon")
async def find_coupon(
    req: CouponRequest,
    x_deepseek_api_key: str | None = Header(default=None, alias="X-DeepSeek-Api-Key"),
):
    api_key = resolve_api_key(req.api_key, x_deepseek_api_key)
    task_id = str(uuid.uuid4())
    login_event = asyncio.Event()
    login_event.set()
    tasks[task_id] = {
        "status": "running",
        "result": None,
        "error": None,
        "login_platform": None,
        "login_event": login_event,
    }
    asyncio.create_task(
        run_coupon(task_id, req.platform, req.product, req.url, api_key)
    )
    return {"task_id": task_id}
