// BOSS海投助手 - 独立扩展版 Pro
(function () {
    'use strict';

    // PDF.js 由 manifest 的 content_scripts 声明式加载（isolated world），
    // 不走页面主世界注入，因此不受 BOSS 页面 CSP 约束。
    //
    // ⚠ 必须设置 GlobalWorkerOptions.workerSrc，不能只设 pdfjsLib.workerSrc。
    // PDF.js v3 的 UMD 包把 workerSrc 的读取点放在 GlobalWorkerOptions 上；
    // 直接写 pdfjsLib.workerSrc 只是挂了个没人读的属性，getDocument 时
    // 仍会抛 'No "GlobalWorkerOptions.workerSrc" specified.'，
    // 表现为"PDF简历无法解析"。两处都设以兼容不同版本。
    if (typeof globalThis.pdfjsLib !== 'undefined') {
        const workerUrl = chrome.runtime.getURL('lib/pdf.worker.min.js');
        globalThis.pdfjsLib.workerSrc = workerUrl;
        if (globalThis.pdfjsLib.GlobalWorkerOptions) {
            globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        }
    }

    // ========== 配置 ==========
    // CONFIG 定义已抽出到 01-config.js，通过 __BH__ 命名空间共享。
    const CONFIG = __BH__.CONFIG;

    // ========== 状态管理 ==========
    // state / elements 定义已抽出到 02-state.js，通过 __BH__ 命名空间共享。
    const state = __BH__.state;
    const elements = __BH__.elements;

    // ========== 筛选工具函数 ==========
    // FilterUtils 已抽出到 10-filters.js，通过 __BH__ 命名空间共享。
    const FilterUtils = __BH__.FilterUtils;

    // ========== 核心功能 ==========
    // Core 已抽出到 20-core.js，通过 __BH__ 命名空间共享。
    const Core = __BH__.Core;

    // ========== 工具函数 ==========
    // toggleProcess / toggleChatProcess 已抽出到 30-controls.js，
    // 通过 __BH__ 命名空间共享。
    const toggleProcess = __BH__.toggleProcess;
    const toggleChatProcess = __BH__.toggleChatProcess;

    // ========== UI模块 ==========
    // UI 已抽出到 40-ui.js，通过 __BH__ 命名空间共享。
    const UI = __BH__.UI;

    // ========== 主入口 ==========
    function init() {
        // 测试模式：仅当钩子显式要求跳过时才跳过（单元测试用）。
        // 冒烟测试会传 { skipInit: false }，从而真实执行下面的面板构建。
        const hook = globalThis.__BH_TEST_HOOK__;
        if (hook && hook.skipInit === true) return;
        try {
            // 每日重置
            const now = new Date();
            const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
            const msToMidnight = night - now;
            setTimeout(() => {
                localStorage.removeItem('aiReplyCount');
                localStorage.removeItem('lastAiDate');
                localStorage.removeItem('letterLastShown');
            }, msToMidnight);

            // 初始化 UI
            UI.init();
            document.body.style.position = 'relative';

            // 页面逻辑
            if (location.pathname.includes('/jobs')) {
                Core.log('✅ BOSS海投助手增强版已加载');
                Core.log('💡 判断逻辑：AI 读每条 JD → 算匹配度 → 70 分以上自动投并发出定制招呼语');
                Core.log('👉 设置筛选条件后点击「启动海投」开始');

                // 断线自愈：如果上次是"运行中"状态（页面被 BOSS 反爬重载、
                // 电脑休眠唤醒、浏览器内存回收后恢复），自动接着跑。
                // 投过的岗位有指纹记录不会重投，额度上限也仍生效。
                const resume = __BH__.resumeIfNeeded;
                if (typeof resume === 'function') {
                    try {
                        const resumed = resume();
                        if (resumed) {
                            Core.log('   ↳ 已自动续跑，你可以继续去忙别的');
                        }
                    } catch (e) {
                        console.error('自动续跑失败:', e);
                    }
                }
            } else {
                // 已收窄职责：本工具只处理岗位列表页，聊天页流程已移除
                Core.log('⚠️ 请在 BOSS 职位列表页使用（本工具只负责投递，不处理聊天）');
            }
        } catch (error) {
            console.error('初始化失败:', error);
            alert(`插件初始化失败: ${error.message}`);
        }
    }

    // 页面加载完成后启动
    if (document.readyState === 'loading') {
        window.addEventListener('load', init);
    } else {
        init();
    }

    // ------------------------------------------------------------------
    // 测试钩子：仅在 Node / jsdom 测试中出现（测试会预先设置该标志），
    // 浏览器环境永不存在，因此不挂载、不污染页面全局作用域。
    //   __BH_TEST_HOOK__ = true                  → 挂载钩子，跳过 init()（单元测试）
    //   __BH_TEST_HOOK__ = { skipInit: false }   → 挂载钩子，并真实执行 init()（冒烟测试）
    // 存在的理由：content.js 是 IIFE，测试无法触达内部 Core/UI，
    // 没有它就只能靠人工在 BOSS 页面回归，重构时极易引入静默回归。
    // ------------------------------------------------------------------
    if (globalThis.__BH_TEST_HOOK__) {
        globalThis.__CORE_TEST__ = {
            Core, UI, FilterUtils, state, CONFIG, elements,
            toggleProcess, toggleChatProcess,
        };
    }

})();
