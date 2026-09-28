// BOSS海投助手 · 待确认列表（2026-09-29 新增）
//
// 为什么需要它：求职者的规则是"70 分以上自动投、低于 70 的攒起来等他勾"。
// 攒起来的那些必须有地方看、能勾选、能补投，否则等于白攒。
//
// 设计要点（按求职者的明确要求）：
//   · 全部保留，不丢任何一条
//   · **按分数从高到低排**，让他能从上往下勾，不用在几百条里翻
//   · 只看分数 + 一句话理由 + 薪资（他说"累了，别让我判断"）
//   · 勾完点一个按钮就补投，不用逐个去 BOSS 手动找
(function () {
    'use strict';

    const state = __BH__.state;

    const PendingList = {
        el: null,
        _selected: null,     // Set<jobId>

        /**
         * 创建待确认列表 DOM。
         * 默认折叠（只显示条数），点开才展开 —— 面板空间有限，
         * 没攒到东西时不应该占地方。
         */
        create() {
            if (!this._selected) this._selected = new Set();

            const box = document.createElement('div');
            box.id = 'boss-pending-list';
            box.style.cssText = `
                margin-bottom: 12px; border-radius: 10px;
                border: 1px solid var(--accent-color, #e5e7eb);
                background: #fff; overflow: hidden;
            `;

            // ── 折叠头 ──
            const head = document.createElement('div');
            head.id = 'boss-pending-head';
            head.style.cssText = `
                display: flex; align-items: center; justify-content: space-between;
                padding: 9px 12px; cursor: pointer; user-select: none;
                background: #f9fafb; font-size: 13px; font-weight: 500;
            `;
            const headLabel = document.createElement('span');
            headLabel.id = 'boss-pending-title';
            headLabel.textContent = '待确认（0）';
            const headArrow = document.createElement('span');
            headArrow.id = 'boss-pending-arrow';
            headArrow.textContent = '▾';
            headArrow.style.cssText = 'color: var(--neutral-color, #6b7280); font-size: 12px;';
            head.append(headLabel, headArrow);

            // ── 展开区 ──
            const body = document.createElement('div');
            body.id = 'boss-pending-body';
            body.style.cssText = 'display: none; max-height: 300px; overflow-y: auto;';

            // 工具栏
            const toolbar = document.createElement('div');
            toolbar.style.cssText = `
                display: flex; gap: 6px; padding: 8px 12px;
                border-bottom: 1px solid var(--accent-color, #e5e7eb);
                position: sticky; top: 0; background: #fff; z-index: 1;
            `;
            const mkBtn = (text, id, primary) => {
                const b = document.createElement('button');
                b.id = id;
                b.textContent = text;
                b.style.cssText = `
                    flex: 1; padding: 5px 8px; font-size: 12px; cursor: pointer;
                    border-radius: 6px; border: 1px solid ${primary ? 'transparent' : 'var(--accent-color, #e5e7eb)'};
                    background: ${primary ? 'var(--primary-color, #2563eb)' : '#fff'};
                    color: ${primary ? '#fff' : 'var(--ink-color, #111827)'};
                `;
                return b;
            };
            const selAll = mkBtn('全选', 'boss-pending-selectall', false);
            const selNone = mkBtn('清空选择', 'boss-pending-selectnone', false);
            const applyBtn = mkBtn('投递选中的', 'boss-pending-apply', true);
            toolbar.append(selAll, selNone, applyBtn);

            // 条目容器
            const items = document.createElement('div');
            items.id = 'boss-pending-items';

            body.append(toolbar, items);
            box.append(head, body);
            this.el = box;

            // ── 事件 ──
            let expanded = false;
            head.addEventListener('click', () => {
                expanded = !expanded;
                body.style.display = expanded ? 'block' : 'none';
                headArrow.textContent = expanded ? '▴' : '▾';
                if (expanded) this.render();
            });

            selAll.addEventListener('click', () => {
                for (const p of this._sorted()) this._selected.add(p.jobId);
                this.render();
            });
            selNone.addEventListener('click', () => {
                this._selected.clear();
                this.render();
            });
            applyBtn.addEventListener('click', () => this.applySelected());

            // ⚠️ 这里**不能**调 this.render()。
            // render() 首行会检查 el.isConnected，而此刻元素还没插进 document，
            // 于是它直接 return —— 计数会停在初始的 0。
            // 真实后果：用户明明有待确认项，面板却显示"待确认（0）"，
            // 他会以为没东西可看。所以创建完只设一下初始文案，
            // 等调用方插入 DOM 后再调 refresh()。
            const initTitle = this.el.querySelector('#boss-pending-title');
            if (initTitle) initTitle.textContent = `待确认（${(state.pendingJobs || []).length}）`;

            return box;
        },

        /** 元素插入 DOM 之后调用，做首次真正渲染 */
        refresh() {
            this.render();
        },

        destroy() {
            this.el = null;
        },

        /** 按分数从高到低排序（分数未知的沉到底部） */
        _sorted() {
            const list = (state.pendingJobs || []).slice();
            list.sort((a, b) => {
                const av = typeof a.lo === 'number' ? a.lo : -1;
                const bv = typeof b.lo === 'number' ? b.lo : -1;
                if (bv !== av) return bv - av;
                return (b.addedAt || 0) - (a.addedAt || 0);
            });
            return list;
        },

        /** 刷新界面 */
        render() {
            if (!this.el || !this.el.isConnected) return;
            const list = this._sorted();
            const titleEl = this.el.querySelector('#boss-pending-title');
            if (titleEl) {
                const sel = this._selected ? this._selected.size : 0;
                titleEl.textContent = sel
                    ? `待确认（${list.length}，已选 ${sel}）`
                    : `待确认（${list.length}）`;
            }

            const items = this.el.querySelector('#boss-pending-items');
            if (!items) return;
            items.textContent = '';

            if (!list.length) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding: 16px 12px; color: #9ca3af; font-size: 12px; text-align: center;';
                empty.textContent = '暂无待确认岗位（低于自动投递线的会攒到这里）';
                items.appendChild(empty);
                return;
            }

            // 只渲染前 100 条 —— 列表可能有上千条，全渲染会卡
            const MAX_RENDER = 100;
            for (const p of list.slice(0, MAX_RENDER)) {
                const row = document.createElement('div');
                row.style.cssText = `
                    display: flex; gap: 8px; padding: 8px 12px; font-size: 12px;
                    border-bottom: 1px solid #f3f4f6; align-items: flex-start;
                `;

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = this._selected.has(p.jobId);
                cb.style.cssText = 'margin-top: 2px; flex: 0 0 auto; cursor: pointer;';
                cb.addEventListener('change', () => {
                    if (cb.checked) this._selected.add(p.jobId);
                    else this._selected.delete(p.jobId);
                    const t = this.el.querySelector('#boss-pending-title');
                    if (t) t.textContent = `待确认（${list.length}，已选 ${this._selected.size}）`;
                });

                const info = document.createElement('div');
                info.style.cssText = 'flex: 1; min-width: 0;';

                // 第一行：分数 + 一句话
                const line1 = document.createElement('div');
                line1.style.cssText = 'display:flex; gap:6px; align-items:baseline; flex-wrap:wrap;';
                if (typeof p.lo === 'number') {
                    const score = document.createElement('span');
                    score.textContent = `${p.lo}-${p.hi}%`;
                    score.style.cssText = `
                        font-weight: 600; color: var(--primary-color, #2563eb); flex: 0 0 auto;
                    `;
                    line1.appendChild(score);
                }
                const reason = document.createElement('span');
                reason.textContent = p.oneLine || p.reason || '';
                reason.style.cssText = 'color: var(--ink-color, #111827);';
                reason.title = p.reason || '';
                line1.appendChild(reason);

                // 第二行：岗位 · 公司 · 薪资
                const line2 = document.createElement('div');
                line2.style.cssText = 'color: var(--neutral-color, #6b7280); margin-top: 2px;';
                line2.textContent = [p.title, p.company, p.salary].filter(Boolean).join(' · ');

                // 第三行：为何被拦（一行，太长截断）
                const line3 = document.createElement('div');
                line3.style.cssText = 'color: #9ca3af; margin-top: 2px; font-size: 11px;';
                line3.textContent = p.reason || '';
                line3.title = p.reason || '';

                info.append(line1, line2, line3);
                row.append(cb, info);

                // 点击整行切换勾选（小屏更好点）
                row.addEventListener('click', (e) => {
                    if (e.target === cb) return;
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                });

                items.appendChild(row);
            }

            if (list.length > MAX_RENDER) {
                const more = document.createElement('div');
                more.style.cssText = 'padding: 8px 12px; color: #9ca3af; font-size: 11px; text-align: center;';
                more.textContent = `仅显示分数最高的 ${MAX_RENDER} 条，共 ${list.length} 条`;
                items.appendChild(more);
            }
        },

        /**
         * 补投选中的岗位。
         *
         * 实现方式：把它们从 skipList 里移除（如果被标记过），
         * 让主循环下次遇到时重新走一遍判断 —— 而不是在这里直接投。
         *
         * 为什么不直接投：投递需要当前页面已打开该岗位详情页，
         * 而待确认列表里的岗位可能不在当前列表页。让主循环处理更可靠。
         */
        applySelected() {
            if (!this._selected || !this._selected.size) {
                if (__BH__.Core && __BH__.Core.log) __BH__.Core.log('⚠️ 没有勾选任何岗位');
                return;
            }
            const n = this._selected.size;
            let removed = 0;
            for (const jobId of this._selected) {
                if (state.skipList && state.skipList[jobId]) {
                    delete state.skipList[jobId];
                    removed++;
                }
            }
            try { localStorage.setItem('bossSkipList', JSON.stringify(state.skipList)); } catch (_) { }

            // 从待确认里移除已勾选的（它们已交给主循环重新处理）
            const keep = (state.pendingJobs || []).filter((p) => !this._selected.has(p.jobId));
            state.pendingJobs = keep;
            try { localStorage.setItem('bossPendingJobs', JSON.stringify(keep)); } catch (_) { }

            if (__BH__.Core && __BH__.Core.log) {
                __BH__.Core.log(`✅ 已把 ${n} 个岗位交回主流程（解除了 ${removed} 个跳过标记）`);
                __BH__.Core.log('   提示：这些岗位会在主循环再次遇到时重新判断投递');
            }
            this._selected.clear();
            this.render();
        },

        /** 供测试与外部查询 */
        getSelected() {
            return this._selected ? Array.from(this._selected) : [];
        },
    };

    __BH__.PendingList = PendingList;
})();
