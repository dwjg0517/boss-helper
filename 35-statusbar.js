// BOSS海投助手 · 运行状态条（2026-09-29 新增）
//
// 解决的核心问题：求职者说"最累的不是等待，是不知道还剩多少"。
// 一个不知道什么时候结束的活，干十分钟就烦；知道"还有 12 个、6 分钟"，
// 干一小时也不慌。
//
// 所以这里给出三件事，一屏同时可见：
//   ① 进度：已投 N 家 / 待确认 M 家 / 今日额度 X/80
//   ② 预计时间：按已处理的平均耗时估算剩余
//   ③ 当前动作：正在投哪个岗、什么阶段
//
// 另外负责"卡住变色"：
//   有进展 → 绿；超过 60 秒没进展 → 黄；超过 180 秒 → 红
// 求职者"启动就走开、偶尔回来瞄一眼"，靠颜色就能判断死没死。
(function () {
    'use strict';

    const CONFIG = __BH__.CONFIG;
    const state = __BH__.state;

    // 卡住判定的阈值（毫秒）
    const WARN_AFTER_MS = 60 * 1000;
    const DANGER_AFTER_MS = 180 * 1000;

    const StatusBar = {
        el: null,
        _timer: null,

        /** 创建状态条 DOM（由 40-ui.js 在面板装配时调用） */
        create() {
            const box = document.createElement('div');
            box.id = 'boss-status-bar';
            box.style.cssText = `
                display: flex; flex-direction: column; gap: 6px;
                padding: 10px 12px; margin-bottom: 12px;
                border-radius: 10px; background: #f9fafb;
                border: 1px solid var(--accent-color, #e5e7eb);
                font-size: 13px; color: var(--ink-color, #111827);
                transition: background 0.3s ease, border-color 0.3s ease;
            `;

            // 第一行：状态点 + 当前动作
            const row1 = document.createElement('div');
            row1.style.cssText = 'display:flex; align-items:center; gap:8px;';
            const dot = document.createElement('span');
            dot.id = 'boss-status-dot';
            dot.style.cssText = `
                width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto;
                background: var(--neutral-color, #6b7280);
            `;
            const action = document.createElement('span');
            action.id = 'boss-status-action';
            action.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;';
            action.textContent = '未启动';
            row1.append(dot, action);

            // 第二行：进度
            const row2 = document.createElement('div');
            row2.id = 'boss-status-progress';
            row2.style.cssText = 'color: var(--neutral-color, #6b7280); font-size: 12px;';
            row2.textContent = '—';

            // 第三行：进度条
            const track = document.createElement('div');
            track.style.cssText = `
                height: 4px; border-radius: 2px; overflow: hidden;
                background: var(--accent-color, #e5e7eb);
            `;
            const fill = document.createElement('div');
            fill.id = 'boss-status-fill';
            fill.style.cssText = `
                height: 100%; width: 0%; border-radius: 2px;
                background: var(--primary-color, #2563eb);
                transition: width 0.3s ease;
            `;
            track.appendChild(fill);

            box.append(row1, row2, track);
            this.el = box;

            // 每秒刷新一次（时间估算与卡住判定都要靠它推进）
            this._timer = setInterval(() => this.render(), 1000);
            this.render();
            return box;
        },

        /** 停止刷新（面板被移除时调用，避免定时器泄漏） */
        destroy() {
            if (this._timer) { clearInterval(this._timer); this._timer = null; }
            this.el = null;
        },

        /**
         * 估算剩余时间。
         *
         * 算法：用「本次运行已投家数 / 已用时长」算平均每家的耗时，
         * 再乘以剩余家数。样本太少（<3 家）时不给估算 —— 猜出来的数字
         * 比没有更糟。
         */
        _estimateRemaining() {
            const st = state.runStats || {};
            if (!st.startedAt) return null;

            const elapsedMs = Date.now() - st.startedAt;
            const done = (st.applied || 0) + (st.skipped || 0) + (st.pending || 0);
            // 样本不足不给估算（少于 3 家时平均值没有意义）
            if (done < 3 || elapsedMs < 5000) return null;

            const perJob = elapsedMs / done;
            // 剩余家数：当前列表还没处理的
            const total = (state.jobList || []).length;
            const remain = Math.max(0, total - (state.currentIndex || 0));
            if (remain === 0) return { remain: 0, ms: 0 };

            return { remain, ms: Math.round(perJob * remain) };
        },

        /** 把毫秒说成人话 */
        _humanMs(ms) {
            if (ms < 1000) return '不到 1 秒';
            const s = Math.round(ms / 1000);
            if (s < 60) return `${s} 秒`;
            const m = Math.floor(s / 60);
            const rs = s % 60;
            if (m < 60) return rs ? `${m} 分 ${rs} 秒` : `${m} 分`;
            const h = Math.floor(m / 60);
            return `${h} 小时 ${m % 60} 分`;
        },

        /** 判定当前状态：running / warn / danger / idle */
        _health() {
            if (!state.isRunning) return 'idle';
            const last = state.lastProgressAt;
            if (!last) return 'running';   // 刚启动还没打过点
            const gap = Date.now() - last;
            if (gap > DANGER_AFTER_MS) return 'danger';
            if (gap > WARN_AFTER_MS) return 'warn';
            return 'running';
        },

        render() {
            if (!this.el || !this.el.isConnected) return;

            const st = state.runStats || {};
            const health = this._health();
            const cap = (CONFIG.MATCH && CONFIG.MATCH.DAILY_CAP) || 80;

            const dot = this.el.querySelector('#boss-status-dot');
            const actionEl = this.el.querySelector('#boss-status-action');
            const progEl = this.el.querySelector('#boss-status-progress');
            const fillEl = this.el.querySelector('#boss-status-fill');

            // ── 状态点颜色 ──
            const colorMap = {
                idle: 'var(--neutral-color, #6b7280)',
                running: 'var(--ok-color, #10b981)',
                warn: 'var(--warn-color, #f59e0b)',
                danger: 'var(--danger-color, #ef4444)',
            };
            dot.style.background = colorMap[health];

            // 卡住时把整个状态条底色也变一下，余光扫到就能发现
            if (health === 'danger') {
                this.el.style.background = '#fef2f2';
                this.el.style.borderColor = '#fecaca';
            } else if (health === 'warn') {
                this.el.style.background = '#fffbeb';
                this.el.style.borderColor = '#fde68a';
            } else {
                this.el.style.background = '#f9fafb';
                this.el.style.borderColor = 'var(--accent-color, #e5e7eb)';
            }

            // ── 当前动作 ──
            let actionText;
            if (!state.isRunning) {
                actionText = '未启动';
                if (st.applied) actionText = `已停止（本次投了 ${st.applied} 家）`;
            } else if (health === 'danger') {
                const gap = Math.round((Date.now() - (state.lastProgressAt || Date.now())) / 1000);
                actionText = `⚠️ 疑似卡住（${gap} 秒无进展）`;
            } else if (health === 'warn') {
                const gap = Math.round((Date.now() - (state.lastProgressAt || Date.now())) / 1000);
                actionText = `⏳ ${gap} 秒无进展，请留意`;
            } else {
                actionText = state.currentJobTitle
                    ? `正在处理：${state.currentJobTitle}`
                    : '运行中…';
            }
            actionEl.textContent = actionText;
            actionEl.title = actionText;   // 太长了鼠标悬停能看全

            // ── 进度文字 ──
            const parts = [`已投 ${st.applied || 0} 家`];
            if (st.pending) parts.push(`待确认 ${st.pending} 家`);
            if (st.skipped) parts.push(`跳过 ${st.skipped}`);

            const est = this._estimateRemaining();
            if (est && est.remain > 0) {
                parts.push(`剩 ${est.remain} 家 · 约 ${this._humanMs(est.ms)}`);
            } else if (state.isRunning && est && est.remain === 0) {
                parts.push('本页已处理完');
            }

            // 今日额度（到顶会停，所以要显眼）
            parts.push(`今日 ${st.todayApplied || 0}/${cap}`);

            progEl.textContent = parts.join('　·　');

            // ── 进度条 ──
            let pct = 0;
            const total = (state.jobList || []).length;
            if (total > 0) {
                pct = Math.min(100, Math.round(((state.currentIndex || 0) / total) * 100));
            }
            fillEl.style.width = pct + '%';
            fillEl.style.background = health === 'danger'
                ? 'var(--danger-color, #ef4444)'
                : (health === 'warn' ? 'var(--warn-color, #f59e0b)' : 'var(--primary-color, #2563eb)');
        },
    };

    __BH__.StatusBar = StatusBar;
})();
