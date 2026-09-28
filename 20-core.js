// BOSS海投助手 · 核心业务逻辑
// 从原单体 content.js 抽出（重构第 5 步）。逻辑未做任何改动。
//
// 依赖：CONFIG(01) / state(02) / FilterUtils(10)。
// 注意：Core 不引用 UI —— 整个项目里 UI.* 只出现在 99-content.js 的 init() 中。
//
// ── 关于 toggleProcess 的循环依赖 ────────────────────────────────
// Core.resetCycle() 与 Core.processJobList() 需要调用 toggleProcess
// （在无匹配岗位或本轮跑完时自动停止），但 toggleProcess 位于
// 30-controls.js，加载顺序在 20-core.js 之后，因此不能在模块顶层绑定。
// 这里采用「调用时取用」：只在实际调用那一刻读 __BH__.toggleProcess。
// 由于两个调用点都发生在运行期（init 之后），届时模块已全部就绪。
// 若将来把 30-controls.js 移到 20 之前，可改回顶层直接绑定。
// ────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const CONFIG = __BH__.CONFIG;
    const state = __BH__.state;
    const elements = __BH__.elements;
    const FilterUtils = __BH__.FilterUtils;
    // 选择器统一来自 05-selectors.js 的单一来源
    const SEL = __BH__.SELECTORS;

    const Core = {
        basicInterval: parseInt(localStorage.getItem('basicInterval')) || CONFIG.BASIC_INTERVAL,
        operationInterval: parseInt(localStorage.getItem('operationInterval')) || CONFIG.OPERATION_INTERVAL,

        // 主循环。
        //
        // 2026-09-29 收窄职责：本工具只负责「判断 → 投递 → 发招呼语」，
        // HR 回复之后的沟通由求职者自己做。因此**不再处理聊天页** ——
        // 原来的 handleChatPage（自动回 HR 消息）已移除。
        async startProcessing() {
            if (location.pathname.includes('/jobs'))
                await this.autoScrollJobList();

            while (state.isRunning) {
                if (location.pathname.includes('/jobs')) {
                    await this.processJobList();
                } else {
                    // 不在岗位列表页时不做任何事。
                    // 说明：点开岗位会短暂离开列表页，但 BOSS 的岗位详情是
                    // 列表页内的右栏，pathname 不变，所以这里通常不会触发。
                    this.log('⚠️ 当前不在岗位列表页，请在职位列表页使用');
                    __BH__.toggleProcess();
                    return;
                }
                this._touchProgress();
                await this.delay(this.basicInterval);
            }
        },

        async autoScrollJobList() {
            return new Promise((resolve) => {
                const cardSelector = 'li.job-card-box';
                const maxHistory = 3;
                const waitTime = this.basicInterval;
                let cardCountHistory = [];
                let isStopped = false;
                let attempts = 0;

                // 安全阀：岗位卡片数持续增长时历史永不重复，原实现会无限递归，
                // 导致 startProcessing() 的主循环永远进不去。设上限兜底。
                const MAX_ATTEMPTS = 200;

                const scrollStep = async () => {
                    if (isStopped) return;
                    if (++attempts > MAX_ATTEMPTS) {
                        const cards = document.querySelectorAll(cardSelector);
                        this.log(`⚠️ 滚动已达上限 ${MAX_ATTEMPTS} 次，以当前 ${cards.length} 个岗位继续`);
                        resolve(cards);
                        return;
                    }
                    window.scrollTo({
                        top: document.documentElement.scrollHeight,
                        behavior: 'smooth'
                    });
                    await this.delay(waitTime);
                    if (isStopped) return;   // delay 期间可能已被停止，提前退出递归
                    const cards = document.querySelectorAll(cardSelector);
                    const currentCount = cards.length;
                    cardCountHistory.push(currentCount);
                    if (cardCountHistory.length > maxHistory) cardCountHistory.shift();
                    if (cardCountHistory.length === maxHistory && new Set(cardCountHistory).size === 1) {
                        const filtered = Array.from(cards).filter(card => FilterUtils.matchesAllFilters(card));
                        this.log(`已加载 ${cards.length} 个岗位，符合筛选条件 ${filtered.length} 个，开始沟通`);
                        resolve(cards);
                        return;
                    }
                    await scrollStep();
                };

                // 停止入口：点击"停止海投"时由 toggleProcess() 调用
                this.stopAutoScroll = () => {
                    isStopped = true;
                    resolve(document.querySelectorAll(cardSelector));
                };

                scrollStep();
            });
        },

        // ══════════════════════════════════════════════════════════════
        //  持久化与统计辅助
        // ══════════════════════════════════════════════════════════════

        /** 写待确认列表（全部保留，按分数从高到低展示由 UI 负责） */
        _persistPending() {
            try {
                localStorage.setItem('bossPendingJobs', JSON.stringify(state.pendingJobs));
            } catch (e) { this.log(`⚠️ 待确认列表写入失败：${e.message}`); }
        },

        /** 写投递档案 */
        _persistAppliedLog() {
            try {
                localStorage.setItem('bossAppliedLog', JSON.stringify(state.appliedLog));
            } catch (e) { this.log(`⚠️ 投递档案写入失败：${e.message}`); }
        },

        /** 写跳过列表（已跳过的不再重试） */
        _persistSkipList() {
            try {
                localStorage.setItem('bossSkipList', JSON.stringify(state.skipList));
            } catch (e) { /* 配额满则忽略 */ }
        },

        /** 写运行统计 */
        _persistRunStats() {
            try {
                localStorage.setItem('bossRunStats', JSON.stringify(state.runStats));
            } catch (e) { /* 忽略 */ }
        },

        /** 标记有进展（用于"卡住变色"判定） */
        _touchProgress() {
            state.lastProgressAt = Date.now();
        },

        /**
         * 当日额度是否已用完（求职者确认：默认 80 家/天，到顶停下、明天继续）。
         * @returns {{ok:boolean, used:number, cap:number}}
         */
        checkDailyCap() {
            const cap = __BH__.CONFIG.MATCH.DAILY_CAP;
            const today = new Date().toISOString().slice(0, 10);
            if (state.runStats.todayDate !== today) {
                state.runStats.todayDate = today;
                state.runStats.todayApplied = 0;
                this._persistRunStats();
            }
            return { ok: state.runStats.todayApplied < cap, used: state.runStats.todayApplied, cap };
        },

        /** 记一条待确认岗位（去重：同 jobId 只留一条，分数取新的） */
        addPendingJob(jobId, job, judged, decision) {
            if (!jobId) return;
            const item = {
                jobId,
                title: job.title || '',
                company: job.companyName || '',
                salary: job.salary || '',
                location: job.location || '',
                url: job.jobUrl || '',
                // 展示用：区间分数 + 一句话理由
                lo: judged && judged.match ? judged.match.lo : null,
                hi: judged && judged.match ? judged.match.hi : null,
                tierLabel: judged && judged.match ? judged.match.tierLabel : '',
                oneLine: judged ? judged.oneLine : '',
                reason: decision ? decision.reason : '',
                roleType: judged ? judged.roleType : '',
                addedAt: Date.now(),
            };
            const idx = state.pendingJobs.findIndex((p) => p.jobId === jobId);
            if (idx >= 0) state.pendingJobs[idx] = item;
            else state.pendingJobs.push(item);
            // 太长的历史只保留最近 2000 条，避免 localStorage 撑爆
            if (state.pendingJobs.length > 2000) {
                state.pendingJobs.sort((a, b) => b.addedAt - a.addedAt);
                state.pendingJobs = state.pendingJobs.slice(0, 2000);
            }
            this._persistPending();
        },

        /** 记一条投递档案 */
        addAppliedLog(jobId, job, judged, result) {
            state.appliedLog.push({
                jobId,
                title: job.title || '',
                company: job.companyName || '',
                salary: job.salary || '',
                location: job.location || '',
                url: job.jobUrl || '',
                roleType: judged ? judged.roleType : '',
                lo: judged && judged.match ? judged.match.lo : null,
                hi: judged && judged.match ? judged.match.hi : null,
                greeting: result ? result.text : '',
                basis: result ? result.basis : null,
                warnings: result ? result.warnings : [],
                appliedAt: Date.now(),
            });
            if (state.appliedLog.length > 3000) {
                state.appliedLog = state.appliedLog.slice(-3000);
            }
            this._persistAppliedLog();
        },

        /**
         * 标记岗位为"跳过，不再重试"。
         * 典型场景：按钮不是「立即沟通」（说明已聊过）、招呼语发不出去。
         */
        markSkipped(jobId, reason) {
            if (!jobId) return;
            state.skipList[jobId] = { reason, at: Date.now() };
            this._persistSkipList();
        },

        // ══════════════════════════════════════════════════════════════
        //  主流程：处理当前列表里的下一个岗位
        //
        //  关卡顺序（求职者确认的规则，任何一道不过就不投）：
        //    ① 已投过 / 已跳过        → 跳过（不花 AI 的钱）
        //    ② 硬条件（本地规则）      → 跳过（不花 AI 的钱）
        //    ③ 列表粗筛（AI，只有卡片信息）→ <40 丢；40-69 进待确认
        //    ④ 点开读 JD → 精判（AI，分数**以精判为准**）
        //    ⑤ ≥70 自动投：生成招呼语 → 发进聊天框 → 记档
        //       <70 进待确认，<40 丢弃
        //
        //  额度：80 家/天，到顶停下（明天继续）
        // ══════════════════════════════════════════════════════════════

        // ══════════════════════════════════════════════════════════════
        //  在岗位卡上标注匹配分数
        //
        //  求职者要求"岗位卡只显示分数 + 一句话理由 + 薪资"。
        //  做法是往 BOSS 自己的卡片里插一个小徽标，而不是自建列表 ——
        //  这样他滚动时看的还是原生列表，只是多了判断结果。
        //
        //  ⚠️ 幂等：同一张卡重复标注时先移除旧徽标，避免叠加。
        // ══════════════════════════════════════════════════════════════
        annotateCard(card, judged, decision) {
            if (!card) return;
            try {
                const old = card.querySelector('.bh-score-badge');
                if (old) old.remove();

                const match = judged && judged.match;
                const badge = document.createElement('div');
                badge.className = 'bh-score-badge';
                badge.style.cssText = `
                    display: flex; align-items: center; gap: 6px;
                    margin-top: 4px; font-size: 11px; line-height: 1.4;
                    pointer-events: none;
                `;

                const score = document.createElement('span');
                let color, text;
                if (match) {
                    text = `${match.lo}-${match.hi}%`;
                    // 色阶让"能不能投"一眼可辨
                    if (match.lo >= __BH__.CONFIG.MATCH.AUTO_APPLY_MIN) color = '#10b981';      // 绿：会自动投
                    else if (match.lo >= __BH__.CONFIG.MATCH.PREFILTER_MIN) color = '#f59e0b';  // 黄：待确认
                    else color = '#9ca3af';                                                     // 灰：丢弃
                } else {
                    text = '—';
                    color = '#9ca3af';
                }
                score.textContent = text;
                score.style.cssText = `
                    flex: 0 0 auto; font-weight: 700; color: ${color};
                    padding: 0 4px; border-radius: 4px; background: ${color}1a;
                `;
                badge.appendChild(score);

                const reason = document.createElement('span');
                const oneLine = (judged && judged.oneLine) || (decision && decision.reason) || '';
                reason.textContent = oneLine.slice(0, 26) + (oneLine.length > 26 ? '…' : '');
                reason.style.cssText = `color: ${color}; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
                reason.title = oneLine;   // 完整理由悬停可见
                badge.appendChild(reason);

                card.appendChild(badge);
            } catch (_) { /* 标注失败不影响投递 */ }
        },

        /** 在卡片上标一个"跳过原因"，让用户知道为什么没投 */
        annotateCardSkipped(card, reason) {
            if (!card || !reason) return;
            try {
                const old = card.querySelector('.bh-score-badge');
                if (old) old.remove();
                const badge = document.createElement('div');
                badge.className = 'bh-score-badge';
                badge.style.cssText = 'margin-top:4px; font-size:11px; color:#9ca3af; pointer-events:none;';
                badge.textContent = `⏭ ${String(reason).slice(0, 24)}`;
                badge.title = reason;
                card.appendChild(badge);
            } catch (_) { }
        },

        async processJobList() {
            const M = __BH__.Matcher;

            // ── 额度检查（放在最前，省得白跑）──
            const quota = this.checkDailyCap();
            if (!quota.ok) {
                this.log(`🛑 今日已投 ${quota.used}/${quota.cap} 家，达到上限，明天继续`);
                __BH__.toggleProcess();
                return;
            }

            const allCards = Array.from(document.querySelectorAll('li.job-card-box'));
            state.jobList = allCards.filter(card => FilterUtils.matchesAllFilters(card));

            if (!state.jobList.length) {
                this.log('⚠️ 没有符合筛选条件的职位，请调整筛选条件');
                this.log(`   当前页面共 ${allCards.length} 个岗位，全部被过滤`);
                __BH__.toggleProcess();
                return;
            }

            if (state.currentIndex >= state.jobList.length) {
                this.resetCycle();
                return;
            }

            const currentCard = state.jobList[state.currentIndex];
            const jobInfo = FilterUtils.extractJobInfo(currentCard);
            const keys = this.jobKeys(jobInfo);
            const jobId = jobInfo.jobId || keys[0];
            state.currentJobId = jobId;
            state.currentJobTitle = jobInfo.title;

            // ── 关卡①：已投过 / 已跳过 ──
            const hitKey = keys.find((k) => state.appliedJobs.has(k));
            if (hitKey) {
                this.log(`⏭️ 已投递过，跳过 [${jobInfo.title}] - ${jobInfo.companyName}`);
                state.currentIndex++;
                this._touchProgress();
                await this.delay(500);
                return;
            }
            if (jobId && state.skipList[jobId]) {
                const why = state.skipList[jobId].reason || '此前已跳过';
                this.log(`⏭️ 跳过 [${jobInfo.title}]（${why}）`);
                state.currentIndex++;
                this._touchProgress();
                await this.delay(300);
                return;
            }

            state.runStats.skipped;   // 占位，见下方统计

            // ── 关卡②：硬条件（本地规则，不花 AI 的钱）──
            const coarseJob = {
                title: jobInfo.title,
                companyName: jobInfo.companyName,
                salary: jobInfo.salary,
                location: jobInfo.location,
                jdText: '',
            };
            const hard = M.checkHardConditions(coarseJob);
            if (!hard.pass) {
                const needsHuman = hard.hits.some((h) => h.needsHuman);
                const reason = hard.hits.map((h) => h.detail).join('；');
                if (needsHuman) {
                    this.log(`🕐 待确认 [${jobInfo.title}] ${reason}`);
                    this.addPendingJob(jobId, coarseJob, null, { reason });
                    state.runStats.pending++;
                } else {
                    this.log(`⏭️ 硬条件不过，跳过 [${jobInfo.title}] ${reason}`);
                    state.runStats.skipped++;
                }
                state.currentIndex++;
                this._touchProgress();
                await this.delay(400);
                return;
            }

            // ── 关卡③：粗筛（用缓存优先，避免重复花 token）──
            let judged = this.getCachedJudgement(jobId);
            if (!judged) {
                judged = await this.judgeJob(coarseJob, 'coarse');
                if (judged) this.cacheJudgement(jobId, judged);
            }
            if (!judged) {
                this.log(`⚠️ 粗筛失败，本轮跳过 [${jobInfo.title}]`);
                state.runStats.failed++;
                state.currentIndex++;
                await this.delay(400);
                return;
            }

            if (judged.match.lo < __BH__.CONFIG.MATCH.PREFILTER_MIN) {
                this.log(`⏭️ 粗筛 ${judged.match.lo}-${judged.match.hi}% 低于淘汰线，不点开 [${jobInfo.title}]`);
                this.annotateCard(currentCard, judged, { action: 'skip' });
                this.markSkipped(jobId, `粗筛 ${judged.match.lo}% 低于淘汰线`);
                state.runStats.skipped++;
                state.currentIndex++;
                this._touchProgress();
                await this.delay(300);
                return;
            }

            // ── 关卡④：点开岗位，读 JD 精判 ──
            currentCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            currentCard.click();
            this.log(`📋 打开 [${jobInfo.title}] ${jobInfo.salary} - ${jobInfo.companyName} (${state.currentIndex + 1}/${state.jobList.length})`);

            // 等 JD 内容渲染出来，而不是死等 1.5 秒。
            // 详情页的 JD 会出现在右栏（列表页内），所以等它出现即可。
            await this.waitForAny(SEL.JOB_DETAIL.description.concat(SEL.JOB_DETAIL.title), {
                timeout: this.operationInterval * 4,
            });
            // 再给一点点时间让同栏内的薪资/公司也渲染完（这段很短，影响可忽略）
            await this.delay(200);

            const jd = this.extractCurrentJD();
            const jdText = [jd.description, jd.requirements].filter(Boolean).join('\n');
            const fineJob = {
                title: jd.title || jobInfo.title,
                companyName: jd.company || jobInfo.companyName,
                salary: jd.salary || jobInfo.salary,
                location: jobInfo.location,
                jdText,
                jobUrl: jobInfo.jobUrl,
            };

            // 精判前再跑一次硬条件 —— 详情页能读到 JD 全文，
            // 可能暴露列表页看不到的信息（如"单休""劳务派遣"）
            const hardFine = M.checkHardConditions(fineJob);
            if (!hardFine.pass && !hardFine.hits.some((h) => h.needsHuman)) {
                this.log(`⏭️ JD 里发现硬伤，跳过：${hardFine.hits.map((h) => h.detail).join('；')}`);
                this.markSkipped(jobId, 'JD 命中硬条件');
                state.runStats.skipped++;
                state.currentIndex++;
                this._touchProgress();
                await this.delay(400);
                return;
            }

            // 精判（分数以此为准，粗筛只用来淘汰明显不对的）
            let fine = jdText.length >= 80 ? await this.judgeJob(fineJob, 'fine') : judged;
            if (!fine) fine = judged;
            if (fine) this.cacheJudgement(jobId, fine);

            // ── 关卡⑤：决策 ──
            const decision = M.decide(fineJob, fine.match);
            this.log(`📊 [${jobInfo.title}] 精判 ${fine.match.lo}-${fine.match.hi}%（${fine.match.tierLabel}）→ ${decision.action}`);

            if (decision.action === 'skip') {
                this.log(`   ↳ 丢弃：${decision.reason}`);
                this.annotateCard(currentCard, fine, decision);
                this.markSkipped(jobId, decision.reason);
                state.runStats.skipped++;
                state.currentIndex++;
                this._touchProgress();
                await this.delay(300);
                return;
            }

            if (decision.action === 'pending') {
                this.log(`   ↳ 待确认：${decision.reason}`);
                this.annotateCard(currentCard, fine, decision);
                this.addPendingJob(jobId, fineJob, fine, decision);
                if (__BH__.PendingList && __BH__.PendingList.render) __BH__.PendingList.render();
                state.runStats.pending++;
                state.currentIndex++;
                this._touchProgress();
                await this.delay(300);
                return;
            }

            // ── 自动投递 ──
            const chatBtn = document.querySelector(SEL.CHAT_ENTRY_BUTTON);
            if (!chatBtn) {
                this.log('   ↳ 未找到沟通按钮，本轮跳过');
                this.annotateCard(currentCard, fine, decision);
                state.currentIndex++;
                await this.delay(400);
                return;
            }

            const btnText = chatBtn.textContent.trim();
            if (btnText !== '立即沟通') {
                // 按钮是「继续沟通」= 之前已经联系过（含用户手动投的 400 家）。
                // 记进跳过列表，下次不再点进来 —— 等于自动完成了历史去重。
                this.log(`   ↳ 按钮为「${btnText}」，说明此前已联系过，记下并跳过`);
                this.annotateCardSkipped(currentCard, '此前已联系过');
                this.markSkipped(jobId, '此前已联系过');
                state.runStats.skipped++;
                state.currentIndex++;
                this._touchProgress();
                await this.delay(300);
                return;
            }

            // 旧的排除词检查保留（它管的是用户自己勾的排除词）
            const matchedBadWords = FilterUtils.smartMatchExclude(
                `${jd.title} ${jd.description} ${jd.requirements}`,
                state.filters.excludeContentKeywords
            );
            if (matchedBadWords.length > 0) {
                this.log(`🚫 跳过：JD 命中你的排除词[${matchedBadWords.join(', ')}]`);
                this.annotateCardSkipped(currentCard, `命中排除词：${matchedBadWords.join('/')}`);
                this.markSkipped(jobId, '命中排除词');
                state.runStats.skipped++;
                state.currentIndex++;
                await this.delay(400);
                return;
            }

            this.log('   ↳ 投递中…');
            chatBtn.click();
            await this.handleGreetingModal();

            // 生成招呼语并发送。失败 → **不记录为已投**，
            // 避免"投了但一句话没说"的干巴巴投递。
            const sent = await this.generateAndSendGreeting(fineJob, fine);
            if (!sent.ok) {
                this.log(`   ↳ ❌ 未完成（${sent.reason}），本岗位不计入已投，记入跳过`);
                this.annotateCardSkipped(currentCard, `招呼语${sent.reason}`);
                this.markSkipped(jobId, `招呼语${sent.reason}`);
                state.runStats.failed++;
                state.currentIndex++;
                await this.delay(500);
                return;
            }

            // 成功：记录已投 + 档案 + 额度
            for (const k of keys) state.appliedJobs.add(k);
            localStorage.setItem('appliedJobs', JSON.stringify([...state.appliedJobs]));
            this.addAppliedLog(jobId, fineJob, fine, sent);
            // 成功的卡上标成绿色分数 —— 滚动时一眼看出哪些投过了
            this.annotateCard(currentCard, fine, decision);

            state.runStats.applied++;
            state.runStats.todayApplied++;
            this._persistRunStats();
            this._touchProgress();

            this.log(`   ↳ ✅ 已投并发出招呼语（累计 ${state.appliedJobs.size} 家，今日 ${state.runStats.todayApplied}/${quota.cap}）`);
            if (sent.warnings && sent.warnings.length) {
                this.log(`   ↳ ⚠️ 自检提示：${sent.warnings.join('；')}`);
            }
            state.currentIndex++;
        },

        // 生成一条岗位的**全部**候选去重标识。
        //
        // 为什么返回多个而不是一个：
        //   1. 岗位 ID 最可靠（平台内唯一），但历史记录里没有它
        //   2. 旧记录用的是 `标题-公司名`
        //   3. 公司名选择器曾长期失效，那段时期存进去的是**纯标题**
        // 任一命中即判为已投，写入时全部写入，使新旧记录互相兼容。
        //
        // ⚠️ 关于"纯标题"标识的严格限制（此处踩过坑）：
        // 纯标题**不能**无条件参与判重 —— 不同公司的同名岗位会被误判为重复，
        // 而那正是本方法要修复的 bug 本身。因此仅当**当前岗位也抓不到公司名**
        // 时才使用纯标题匹配：此时两边都是"标题"，确实是同一条记录的特征。
        // 一旦公司名可解析，就必须依赖 jobId 或"标题-公司名"来判重。
        jobKeys(jobInfo) {
            const keys = [];
            const t = (jobInfo.title || '').trim().toLowerCase();
            const c = (jobInfo.companyName || '').trim().toLowerCase();

            if (jobInfo.jobId) keys.push(`id:${jobInfo.jobId}`);
            if (t && c) keys.push(`${t}-${c}`);
            // 仅在两边都缺公司名时才退回纯标题匹配（兼容公司名失效期的历史记录）
            if (t && !c) keys.push(t);
            return keys;
        },

        async handleGreetingModal() {
            await this.delay(this.operationInterval);
            const btn = [...document.querySelectorAll(SEL.GREETING_MODAL_CANCEL)]
                .find(b => b.textContent.trim() === '留在此页');
            if (btn) {
                btn.click();
                await this.delay(this.operationInterval);
            }
        },

        getAIConfig() {
            // 运行期覆盖优先：设置面板保存时会写入 customApiKeyOverride /
            // customApiUrlOverride / customModelOverride，使新配置**立即生效**，
            // 不必刷新页面。原实现只读启动时写入的 customApi*，用户保存后
            // 仍走旧配置，容易误判为"Key 不生效"。
            const customApiKey = localStorage.getItem('customApiKeyOverride')
                || localStorage.getItem('customApiKey') || '';
            const customApiUrl = localStorage.getItem('customApiUrlOverride')
                || localStorage.getItem('customApiUrl') || '';
            const customModel = localStorage.getItem('customModelOverride')
                || localStorage.getItem('customModel') || '';
            const useCustom = !!(customApiKey && customApiUrl);

            // 共享回落配置：来自 00a-local-config.js（可选文件，默认不含凭据）。
            // 此前这里硬编码了原作者混淆过的讯飞凭据，属于他人凭据且已公开
            // 发布，现改为外部可选配置 —— 代码中不再包含任何凭据。
            const local = (typeof __BH__ !== 'undefined' && __BH__.LOCAL_CONFIG) || {};
            const sharedToken = local.SHARED_FALLBACK_TOKEN || '';

            return {
                apiKey: useCustom ? customApiKey : sharedToken,
                apiUrl: useCustom
                    ? customApiUrl
                    : (local.SHARED_FALLBACK_URL || 'https://spark-api-open.xf-yun.com/v1/chat/completions'),
                model: useCustom
                    ? (customModel || 'gpt-3.5-turbo')
                    : (local.SHARED_FALLBACK_MODEL || 'lite'),
                useCustom: useCustom,
                // 既没用自定义 Key、也没有共享回落 → 无可用凭据
                isDefault: !useCustom && !!sharedToken,
                hasNoKey: !useCustom && !sharedToken
            };
        },

        // 检查是否达到次数限制（只有用共享回落 token 才限制）
        checkRateLimit() {
            const config = this.getAIConfig();

            // 没有任何可用凭据：明确拒绝，而不是带着空 Key 发请求
            if (config.hasNoKey) {
                return { allowed: false, remaining: 0, reason: 'no-key' };
            }
            if (config.useCustom) return { allowed: true, remaining: -1 };

            const today = new Date().toISOString().split('T')[0];
            if (state.lastAiDate !== today) {
                state.aiReplyCount = 0;
                state.lastAiDate = today;
                localStorage.setItem('aiReplyCount', '0');
                localStorage.setItem('lastAiDate', today);
            }

            const remaining = CONFIG.AI.MAX_REPLIES_FREE - state.aiReplyCount;
            return {
                allowed: remaining > 0,
                remaining: remaining,
                reason: remaining > 0 ? 'ok' : 'quota'
            };
        },

        // 无可用凭据时统一的提示文案
        NO_KEY_MESSAGE: '尚未配置 API Key：请点面板 ⚙ →「🔑 API 设置」填入自己的 Key'
            + '（可用 DeepSeek / 智谱 等，推荐点「🔌 测试连接」验证）',

        // 记录一次AI调用
        recordAiUsage() {
            const config = this.getAIConfig();
            if (config.useCustom) return; // 自定义key不计数

            state.aiReplyCount++;
            localStorage.setItem('aiReplyCount', String(state.aiReplyCount));
        },

        // 共享的 Chat Completions 调用。
        // 原先 requestAi / requestAiWithSystem 各自复制了一份完全相同的
        // HTTP 与响应解析逻辑，任何修复都得改两处，容易漏改。此处收敛为一处。
        //
        // 注意：本方法只负责发请求与解析，**不检查额度、不计数**，
        // 由调用方决定是否计入用量（测试连接就不应计入）。
        async _chatCompletion({ apiUrl, apiKey, model, messages, maxTokens }) {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + apiKey
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.9,
                    top_p: 0.8,
                    max_tokens: maxTokens
                })
            });

            // 有些错误响应体不是 JSON（如网关返回 HTML），直接 response.json()
            // 会抛出难以理解的解析错误。这里先取文本再尝试解析，失败时
            // 把 HTTP 状态与响应片段带进错误信息，便于定位。
            const raw = await response.text();
            let result;
            try {
                result = JSON.parse(raw);
            } catch (e) {
                throw new Error(`API返回非JSON（HTTP ${response.status}）: ${raw.slice(0, 200)}`);
            }

            // 兼容不同API的返回格式
            if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
                return result.choices[0].message.content.trim();
            }
            if (result.result) {
                return result.result.trim();
            }
            if (result.data && result.data.content) {
                return result.data.content.trim();
            }
            if (result.code !== undefined && result.code !== 0) {
                throw new Error('API错误: ' + (result.message || result.msg || '未知错误'));
            }
            if (result.error) {
                const e = result.error;
                throw new Error('API错误: ' + (typeof e === 'string' ? e : (e.message || JSON.stringify(e))));
            }
            throw new Error(`API返回格式异常（HTTP ${response.status}）`);
        },

        // 测试连接：用设置面板里**当前输入框**的值发一次最小请求。
        // 目的是让用户填完 Key 立刻知道是否可用，而不是投递时才发现失败。
        // 明确不检查额度、不计入用量、不读取 localStorage 里的旧配置。
        async testAIConnection({ apiUrl, apiKey, model }) {
            if (!apiUrl || !apiKey) {
                throw new Error('API 地址和 API Key 都需要填写');
            }
            const content = await this._chatCompletion({
                apiUrl,
                apiKey,
                model: model || 'deepseek-chat',
                messages: [
                    { role: 'system', content: '你是一个测试助手。' },
                    { role: 'user', content: '请只回复两个字：可用' }
                ],
                maxTokens: 16
            });
            return content;
        },

        async requestAi(message) {
            const config = this.getAIConfig();

            // 检查限制
            const limit = this.checkRateLimit();
            if (!limit.allowed) {
                throw new Error(limit.reason === 'no-key'
                    ? this.NO_KEY_MESSAGE
                    : '今日免费额度已用完，请在设置中配置自己的API Key');
            }

            try {
                const content = await this._chatCompletion({
                    apiUrl: config.apiUrl,
                    apiKey: config.apiKey,
                    model: config.model,
                    messages: [
                        {
                            role: 'system',
                            content: localStorage.getItem('aiRole') || CONFIG.AI.DEFAULT_ROLE
                        },
                        {
                            role: 'user',
                            content: message
                        }
                    ],
                    maxTokens: 512
                });
                this.recordAiUsage();
                return content;
            } catch (error) {
                console.error('AI请求失败:', error);
                throw error;
            }
        },

        // ========== JD提取 & 打招呼语生成 ==========

        // 提取当前岗位的JD信息
        // ══════════════════════════════════════════════════════════════
        //  JD 判断：列表粗筛 + 进页精判
        //
        //  两级匹配的由来：列表页只能拿到卡片上的信息（岗位名/公司/薪资/标签），
        //  信息量不足以做准判断；详情页能读 JD 全文。所以先用卡片信息粗筛，
        //  淘汰明显不对的（省 AI 调用），再对幸存者读 JD 精判。
        //  冲突时**以精判为准** —— 因为 JD 全文才看得出真实要求。
        // ══════════════════════════════════════════════════════════════

        // 判断用的 system 提示词。
        // 规范来源：offer-toolkit-skill/job-description-skill
        //   · 铁律一：先解码，再做任何事（不能拿原始 JD 话术直接算匹配度）
        //   · 铁律二：不替用户编简历内容
        //   · match-rubric：总分 = 0.6×MustHave + 0.2×NiceToHave + 0.2×HiddenSignal
        _judgeSystemPrompt() {
            return `你是求职匹配分析器。任务：把一份招聘 JD 从「招聘话术」翻译成
「这位候选人到底能不能胜任」，并给出可核对的依据。

【第一步：先解码，再打分】
招聘 JD 几乎从不直白说话，必须先翻译再判断。常见对应：
  · "strong experience with X" → 做过 1-2 次能讲清楚即可，不要求 X 年专家
  · "deep expertise in X"      → 真要 5 年以上且能背调
  · "passion for X"            → 没硬性经验要求，但得讲出真诚兴趣
  · "working knowledge of X"   → 听说过 + 能聊，不要求做过
  · 国内 JD："结果导向"=加班常态、"抗压能力强"=压力大、
    "狼性/战斗力强"=高流动、"复合型人才"=一人多岗、
    "高速发展期"=早期阶段业务模式还在变、"拥抱变化"=需求经常变
把话术翻译成"真实要求"后，再用真实要求去比对简历。

【第二步：逐条判定 Must Have / Nice to Have】
先列出 JD 真正的硬性要求（Must Have，3-6 条）与加分项（Nice to Have，1-4 条）。
每条按三档打分，判定标准是**简历里有没有直接证据**：
  · 1.0 完全命中：简历有具体经历/项目背书，且有量化或可验证细节，且经验较新
  · 0.5 部分命中/相邻经验：做过相邻领域，或只有表述缺细节，或经验偏旧
  · 0.0 未命中：简历里完全看不出这块经验
⚠️ 用户口头说"我会"不算 —— 简历没体现就是 0 分（招聘经理只看简历）。

【第三步：隐含信号】
从 JD 措辞推断招聘经理偏好，挑 3-5 个最强的，各按 0 / 0.5 / 1 打 fit：
  · ambiguity / 0-1 / 自己定义问题 → 要自驱型
  · ownership / end-to-end / 全程负责 → 要能独立扛
  · influence / align / stakeholder → 政治密度高、协调成本大
  · fast-paced / move quickly     → 节奏快、可能加班
  · metrics-driven / 数据驱动      → 决策要数据支撑

【硬性约束】
1. 只能使用【候选人事实】里出现过的内容作为证据。**不许补充任何事实。**
2. 每条判定都要写明"简历里的哪句话"作为依据（quote 字段）。
3. 找不到依据的，命中分就是 0，不要为了凑分勉强给 0.5。
4. gap 与 risk 是两件事：
   · gap  = 简历缺什么
   · risk = 招聘经理看到这份简历会**担心**什么（如"经验低于岗位层级""稳定性存疑"）
   每个 risk 必须给出"对方会怎么质疑"+"候选人该怎么回应"。
5. 只输出 JSON，不要任何解释文字、不要 markdown 围栏、不要注释。

【输出格式】
{
  "roleType": "这是什么岗（如：招聘顾问 / 客户成功 / 实施顾问 / 商务BD / 其他）",
  "roleCategory": "recruiting|customer_success|implementation|sales|operations|other",
  "mustHave": [{"item":"要求内容","hit":1或0.5或0,"quote":"简历里对应的原句，没有则空字符串"}],
  "niceToHave": [{"item":"...","hit":1或0.5或0,"quote":"..."}],
  "hiddenSignals": [{"signal":"信号","fit":1或0.5或1,"why":"为什么这么判"}],
  "gateMiss": false,
  "gap": [{"item":"缺什么","level":"fixable|hard|irrelevant","how":"怎么补或怎么答"}],
  "risk": [{"item":"对方可能担心什么","probe":"他会怎么问","reply":"你该怎么答"}],
  "redFlags": ["JD 里的坑，如：高提成可能底薪低（没有则空数组）"],
  "oneLine": "一句话说清：这个岗适不适合这个人，为什么（30 字内）"
}`;
        },

        /** 去掉 JSON 里的注释与尾逗号（有些模型会加，标准 JSON.parse 会失败） */
        _sanitizeJson(text) {
            let s = String(text || '');

            // ── 去掉注释 ──
            //
            // ⚠️ 必须**跳过字符串内部**，不能无脑全局替换。
            // 早期实现用 /(^|[^:"'\\])\/\/[^\n]*/ 全局替换，结果把字符串里的
            // `//` 也删了：{"a":"这是 // 内容"} → {"a":"这是  ← JSON 直接崩。
            // 模型经常在字符串里写 URL 或路径，这个 bug 会静默损坏数据。
            //
            // 做法：手工扫描，遇到引号就整段跳过（支持 \" 转义），
            // 只在引号外识别 // 与 /* */。
            let out = '';
            let i = 0;
            const n = s.length;
            while (i < n) {
                const ch = s[i];

                // 字符串：整段照抄，含转义
                if (ch === '"') {
                    out += ch;
                    i++;
                    while (i < n) {
                        if (s[i] === '\\') { out += s[i] + (s[i + 1] || ''); i += 2; continue; }
                        out += s[i];
                        if (s[i] === '"') { i++; break; }
                        i++;
                    }
                    continue;
                }

                // 行注释
                if (ch === '/' && s[i + 1] === '/') {
                    while (i < n && s[i] !== '\n') i++;
                    continue;
                }

                // 块注释
                if (ch === '/' && s[i + 1] === '*') {
                    i += 2;
                    while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
                    i += 2;
                    continue;
                }

                out += ch;
                i++;
            }
            s = out;

            // ── 去掉尾逗号 ──（同样要跳过字符串内部）
            out = '';
            i = 0;
            while (i < s.length) {
                const ch = s[i];
                if (ch === '"') {
                    out += ch;
                    i++;
                    while (i < s.length) {
                        if (s[i] === '\\') { out += s[i] + (s[i + 1] || ''); i += 2; continue; }
                        out += s[i];
                        if (s[i] === '"') { i++; break; }
                        i++;
                    }
                    continue;
                }
                if (ch === ',') {
                    // 跳过逗号后的空白，看下一个非空白字符是不是 } 或 ]
                    let j = i + 1;
                    while (j < s.length && /\s/.test(s[j])) j++;
                    if (s[j] === '}' || s[j] === ']') { i++; continue; }   // 丢掉这个逗号
                }
                out += ch;
                i++;
            }
            return out;
        },

        /**
         * 判断一个岗位。
         * @param {object} job {title, companyName, salary, location, jdText, tags}
         * @param {'coarse'|'fine'} mode coarse=只看卡片信息；fine=有 JD 全文
         * @returns {Promise<object|null>} 结构化判断 + 评分（match 字段）
         */
        async judgeJob(job, mode = 'fine') {
            const M = __BH__.Matcher;
            const facts = M.getCandidateFacts();

            const jdText = String(job.jdText || '').trim();
            const isCoarse = mode === 'coarse' || jdText.length < 80;

            const userMsg = [
                `【判断层级】${isCoarse ? '粗筛（只有卡片信息，信息有限，判定要保守）' : '精判（有 JD 全文）'}`,
                '',
                '【岗位信息】',
                `岗位名：${job.title || '(未提供)'}`,
                `公司：${job.companyName || '(未提供)'}`,
                `薪资标价：${job.salary || '(未提供)'}`,
                `地点：${job.location || '(未提供)'}`,
                job.tags ? `标签：${job.tags}` : '',
                isCoarse ? '' : `\nJD 全文：\n${jdText.slice(0, 3000)}`,
                '',
                '【候选人事实（只能从这里取材，不许补充）】',
                JSON.stringify(facts, null, 1),
                '',
                '【特别提醒】',
                `· 绝对不许使用的事实：${facts.mustNotFabricate.join('；')}`,
                '· 如果 JD 要求的东西在这份事实里找不到证据，命中分就是 0，不要勉强给分。',
            ].filter(Boolean).join('\n');

            let raw;
            try {
                raw = await this.requestAiWithSystem(
                    this._judgeSystemPrompt(),
                    userMsg,
                    // 判断输出字段多（must/nice/signals/gap/risk），留足额度防截断
                    1600,
                    __BH__.CONFIG.MATCH.MODEL_JUDGE
                );
            } catch (e) {
                this.log(`❌ 判断失败：${e.message}`);
                return null;
            }

            let judged;
            try {
                judged = JSON.parse(this._sanitizeJson(this.extractJson(raw)));
            } catch (e) {
                this.log(`⚠️ 判断结果解析失败：${e.message}`);
                return null;
            }

            // 算出匹配度（算法在 15-match.js，是纯函数、已单测覆盖）
            const match = M.computeMatchScore(judged);
            const redFlags = M.detectRedFlags(`${job.jdText || ''} ${job.title || ''}`);

            return {
                ...judged,
                match,
                // 本地规则扫出的坑，与 AI 报的合并去重
                redFlags: Array.from(new Set([...(judged.redFlags || []), ...redFlags.map((r) => r.meaning)])),
                mode: isCoarse ? 'coarse' : 'fine',
                judgedAt: Date.now(),
            };
        },

        // ══════════════════════════════════════════════════════════════
        //  对着 JD 生成招呼语
        //
        //  规范来源：本机 skill「greeting-writer」，其四条要求：
        //    1. 贴合该条 JD —— 回应 JD 里真实写出的要求，不是泛泛而谈
        //    2. 贴合本人简历 —— 引用的每个能力点都能在简历里找到出处
        //    3. 不编造 —— 违反这条比通用模板更糟，HR 追问一句就穿帮
        //    4. 强制输出【依据】—— 让用户能核对有没有编
        //
        //  批量投递时**每条 JD 单独生成**，不允许复用同一句。
        // ══════════════════════════════════════════════════════════════

        _greetingSystemPrompt() {
            return `你在帮一位求职者写发给招聘方的第一句话。

【最重要的规则：不许编造】
你写出的每一个能力、经历、数字，都必须在【候选人事实】里出现过。
严禁出现事实里没有的：数字、学历、证书、公司名、职位头衔、
"精通"类夸大词、"主导/带领团队"类角色描述。
事实里没有的东西就是没有 —— 宁可少说一个亮点，也不要补一个不存在的。
编造会让 HR 追问时当场穿帮，比写得平淡更糟。

【这条要贴合这个 JD，不是通用模板】
先看这份 JD 真正要什么（已完成解码，见【判断结果】），
再从事实里挑 1-2 个**直接对得上**的证据：
  · 招聘/猎头类岗     → 突出：抗压、高拒绝率下的沟通、判断需求、懂技术岗
  · 客户成功/实施类岗 → 突出：跨部门推动、ERP/WMS 系统经验、主动发现问题
  · AI 实施/售前类岗  → 突出：上线过的项目、懂技术但说人话、懂企业落地
  · 销售/BD 类岗      → 突出：转化率、客户拓展、销售闭环
不要什么亮点都塞进去，只挑跟这个 JD 对得上的。
如果这个人**缺** JD 要求的某项关键能力，不要硬攀、不要假装符合 ——
用相邻经验说话，或者干脆不提那一项。

【语气：有礼貌，但不套话】
· 开头"您好。"就够，不要"冒昧打扰""百忙之中""万分感谢"这类一看就是模板的客套
· 结尾用问句自然收束（"方便和您聊聊吗？"），不要卑微（不要"希望给个机会"）
· 全程用"您"，但不要用"贵司""本人""兹"这类书面语

【表达要求】
1. 40-70 字，一至两句 —— HR 在手机上扫，超过两行会被跳过
2. 第一句就给证据，不要寒暄铺垫
3. 具体 > 抽象："做过 DeepSeek API 集成" 好过 "有 AI 相关经验"
4. 不要每条都用同一个句式
5. 纯文本，不要 emoji、不要 markdown、不要分点
6. 不要提"转行""跨行"这类自我贬低的词，直接说能力
7. 不要提术数/命理/八字/占卜/排盘这类词，相关项目统一说"算法引擎""推演模式"

【输出格式】只输出 JSON，不要任何解释、不要围栏：
{"greeting":"招呼语正文","basis":{"jdHit":"命中了 JD 的哪条要求","resumeQuote":"引用的简历原句，必须逐字来自候选人事实","strength":"strong|medium|weak"}}`;
        },

        /**
         * 为某条 JD 生成招呼语。
         * @param {object} job 岗位信息（含 jdText）
         * @param {object} judged judgeJob 的结果（提供解码后的真实要求）
         * @returns {Promise<{text:string, basis:object}|null>} 失败返回 null
         */
        async generateGreetingForJD(job, judged) {
            const M = __BH__.Matcher;
            const facts = M.getCandidateFacts();
            const jdText = String(job.jdText || '').trim();

            // 已解码出的真实要求（若没有则退回原始 JD）
            const decoded = judged ? {
                roleType: judged.roleType,
                roleCategory: judged.roleCategory,
                mustHave: (judged.mustHave || []).map((m) => `${m.item}（命中 ${m.hit}）`),
                hiddenSignals: (judged.hiddenSignals || []).map((s) => s.signal),
                oneLine: judged.oneLine,
            } : null;

            const userMsg = [
                '【岗位信息】',
                `岗位名：${job.title || '(未提供)'}`,
                `公司：${job.companyName || '(未提供)'}`,
                `薪资：${job.salary || '(未提供)'}`,
                `地点：${job.location || '(未提供)'}`,
                jdText ? `\nJD 全文：\n${jdText.slice(0, 2500)}` : '(无 JD 全文，只有岗位名)',
                decoded ? `\n【判断结果（JD 已解码，优先参考）】\n${JSON.stringify(decoded, null, 1)}` : '',
                '\n【候选人事实（只能从这里取材）】',
                JSON.stringify(facts, null, 1),
                '\n【绝对不许写进招呼语的内容】',
                facts.mustNotFabricate.map((x) => `· ${x}`).join('\n'),
                '\n【依据字段要求】',
                'resumeQuote 必须是候选人事实里**逐字存在**的一句，',
                '如果找不到可引用的原句，就不要生成这条招呼语，返回 {"greeting":""}。',
            ].filter(Boolean).join('\n');

            let raw;
            try {
                raw = await this.requestAiWithSystem(
                    this._greetingSystemPrompt(),
                    userMsg,
                    700,
                    // 话术要质量，用 pro（判断用 flash）
                    __BH__.CONFIG.MATCH.MODEL_GREETING
                );
            } catch (e) {
                this.log(`❌ 招呼语生成请求失败：${e.message}`);
                return null;
            }

            let obj;
            try {
                obj = this.extractJson(raw);
            } catch (e) {
                this.log(`⚠️ 招呼语解析失败：${e.message}`);
                return null;
            }

            const text = String((obj && obj.greeting) || '').trim();
            if (!text) {
                this.log('⚠️ 模型未给出招呼语（可能找不到可引用的依据）');
                return null;
            }

            // ── 自检：把"有没有编"变成可核对的事实 ──
            const warn = this._auditGreeting(text, facts);
            if (warn.length) this.log(`⚠️ 招呼语自检提示：${warn.join('；')}`);

            return { text, basis: obj.basis || {}, warnings: warn };
        },

        /**
         * 招呼语自检：扫明显的编造与禁忌词。
         * 不追求完备（那需要人工核对），但要挡住最常见的几类。
         * @returns {string[]} 问题描述列表，空数组表示没发现问题
         */
        _auditGreeting(text, facts) {
            const issues = [];
            const t = String(text || '');

            // 1. 夸大角色词（这个人的项目都是"独立开发"）
            for (const w of ['主导', '带领团队', '带队', '管理团队', '负责团队']) {
                if (t.includes(w)) issues.push(`出现夸大角色词「${w}」`);
            }
            // 2. 夸大能力词
            for (const w of ['精通', '专家', '资深']) {
                if (t.includes(w)) issues.push(`出现夸大词「${w}」`);
            }
            // 3. 不得出现的领域词
            for (const w of ['术数', '命理', '八字', '占卜', '排盘', '算命']) {
                if (t.includes(w)) issues.push(`出现禁忌词「${w}」`);
            }
            // 4. 自我贬低
            for (const w of ['希望给个机会', '希望能给我', '转行', '跨行']) {
                if (t.includes(w)) issues.push(`出现贬低表述「${w}」`);
            }
            // 5. 套话（求职者明确要求不要）
            for (const w of ['冒昧打扰', '百忙之中', '万分感谢', '贵司']) {
                if (t.includes(w)) issues.push(`出现套话「${w}」`);
            }
            // 6. 事实里没有的数字：抽出招呼语里的数字，逐个到事实里找
            const nums = t.match(/\d+(?:\.\d+)?/g) || [];
            const factStr = JSON.stringify(facts);
            for (const n of nums) {
                if (!factStr.includes(n)) issues.push(`数字「${n}」在候选人事实里找不到`);
            }
            return issues;
        },

        /** 取某个岗位的缓存判断结果（同一条 JD 不重复分析） */
        getCachedJudgement(jobId) {
            if (!jobId) return null;
            const c = state.matchCache && state.matchCache[jobId];
            if (!c) return null;
            // 缓存 7 天过期，避免简历/市场变化后一直用旧结论
            if (Date.now() - (c.judgedAt || 0) > 7 * 24 * 3600 * 1000) return null;
            return c;
        },

        /** 写入判断缓存（带容量上限，防止 localStorage 撑爆） */
        cacheJudgement(jobId, judged) {
            if (!jobId || !judged) return;
            state.matchCache[jobId] = judged;
            const keys = Object.keys(state.matchCache);
            const MAX = 800;
            if (keys.length > MAX) {
                // 按时间淘汰最旧的
                keys.sort((a, b) => (state.matchCache[a].judgedAt || 0) - (state.matchCache[b].judgedAt || 0));
                for (const k of keys.slice(0, keys.length - MAX)) delete state.matchCache[k];
            }
            try { localStorage.setItem('bossMatchCache', JSON.stringify(state.matchCache)); } catch (e) { /* 配额满则忽略 */ }
        },

        // 提取当前岗位的 JD（详情页）
        extractCurrentJD() {
            // 与 10-filters.js 同理：同时认旧名与真实页面类名。
            // 详情页与列表页的类名不同，因此这里的选择器覆盖面更宽。
            const pick = (sels) => {
                for (const s of sels) {
                    const el = document.querySelector(s);
                    if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
                }
                return '';
            };

            const jd = {
                title: pick(SEL.JOB_DETAIL.title),
                salary: pick(SEL.JOB_DETAIL.salary),
                company: pick(SEL.JOB_DETAIL.company),
                description: '',
                requirements: ''
            };

            // 尝试提取职位描述 (不同页面结构可能不同)
            const jdSelectors = SEL.JOB_DETAIL.description;

            for (const selector of jdSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim().length > 20) {
                    jd.description = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 3000);
                    break;
                }
            }

            // 如果没找到，尝试从所有文本中提取
            if (!jd.description) {
                // 兜底：innerText 依赖布局引擎，并非在所有环境都可用
                //（例如 jsdom 中为 undefined）。缺失时退回 textContent，
                // 避免一次 TypeError 中断整个岗位的处理流程。
                const allText = document.body.innerText || document.body.textContent || '';
                const idxOf = (kw) => allText.indexOf(kw);
                const markerHits = SEL.JD_TEXT_MARKERS.map(idxOf).filter(i => i > -1);
                const jdStart = markerHits.length ? Math.min(...markerHits) : -1;
                if (jdStart > -1) {
                    jd.description = allText.slice(jdStart, jdStart + 3000).replace(/\s+/g, ' ');
                }
            }

            // 提取任职要求
            const reqSelectors = SEL.JOB_DETAIL.requirements;
            for (const selector of reqSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent.trim().length > 10) {
                    jd.requirements = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 1500);
                    break;
                }
            }

            state.currentJD = jd;
            return jd;
        },

        // AI生成个性化打招呼语
        //
        // 设计要点（与本仓库 skill「greeting-writer」的要求一致）：
        //   1. 必须带入**简历全文**。结构化字段只有 7 个短字段，且常为
        //      "未填写"；只靠它们时 AI 无据可依，必然编造。全文里才有
        //      项目名、技术栈、量化结果等可引用的证据。
        //   2. prompt 中明确禁止编造，并要求 AI 标注每条能力点的出处，
        //      使"有没有编"变成可核对的事实。
        //   3. 岗位描述用全文（不再截断到 1000 字符），否则 JD 的后半段
        //      要求（常含任职要求）会被丢掉，导致回应不中要害。
        async generateGreeting() {
            const jd = this.extractCurrentJD();
            const resume = state.resume;
            const rawText = this.getResumeRawText();

            // 有全文就以全文为准；否则退回结构化字段
            if (!rawText && !resume.skills && !resume.highlight) {
                this.log('⚠️ 请先在设置中上传简历（PDF）或粘贴简历文本');
                this.log('💡 只有简历全文才能生成有针对性的招呼语');
                return null;
            }

            if (!jd.title) {
                this.log('⚠️ 未检测到岗位信息，请先打开岗位详情页');
                return null;
            }

            this.log(`🤖 正在为「${jd.title}」生成个性化打招呼语...`);

            // JD 全文（描述 + 任职要求），不截断
            const jdFull = [jd.description, jd.requirements].filter(Boolean).join('\n');

            // 简历：优先全文；同时附上结构化字段作为补充线索
            const resumeBlock = rawText
                ? `【简历全文】\n${rawText}`
                : `【简历（仅有结构化字段，证据有限，务必保守）】
技能栈：${resume.skills || '未填写'}
核心亮点：${resume.highlight || '未填写'}`;

            const structuredHints = [
                resume.name && `姓名：${resume.name}`,
                resume.yearsOfExp && `工作年限：${resume.yearsOfExp}`,
                resume.education && `学历：${resume.education}`,
                resume.currentCompany && `当前/上一家公司：${resume.currentCompany}`,
                resume.targetPosition && `目标岗位：${resume.targetPosition}`,
            ].filter(Boolean).join('\n');

            const userPrompt = `【岗位信息】
职位：${jd.title}
公司：${jd.company || '（未知）'}
薪资：${jd.salary || '（未知）'}
岗位描述与要求：
${jdFull || '（未抓取到详细描述，请仅依据职位名称判断，并保持措辞保守）'}

${resumeBlock}
${structuredHints ? '\n【结构化信息（补充线索）】\n' + structuredHints : ''}

【任务】
写一句打招呼开场白，要求：
1. 必须回应上面「岗位描述与要求」中**真实写出的**至少一条具体要求
2. 必须引用简历中**真实存在**的经历或技能，并在末尾用「依据：」列出引用了简历的哪一句
3. 严禁编造简历中没有的数字、学历、年限、公司名、项目角色
4. 一句话，40-70 字，像真人在说话，不要模板腔
5. 若简历与该岗位匹配度低，用「有相关项目经验 + 学习速度」的务实说法，不要硬说自己完全符合

输出格式（只输出这两行）：
招呼语：<正文>
依据：<引用的简历原句>`;

            try {
                const greeting = await this.requestAiWithSystem(
                    CONFIG.AI.GREETING_PROMPT,
                    userPrompt
                );

                if (greeting) {
                    this.log(`✅ 打招呼语生成成功：${greeting}`);
                    return greeting;
                } else {
                    this.log('❌ 打招呼语生成失败，请稍后重试');
                    return null;
                }
            } catch (error) {
                this.log('❌ 打招呼语生成失败: ' + error.message);
                this.log('💡 请在设置→API设置中配置自己的API Key');
                return null;
            }
        },

        // 带自定义system prompt的AI请求
        //
        // maxTokens 可传参覆盖。原实现硬编码 200，导致"简历结构化"这类需要
        // 输出较长 JSON 的场景被中途截断 —— 返回的 JSON 不完整，
        // JSON.parse 抛错，表现为"AI解析失败"。默认提到 512。
        // 带 system 提示词的请求。
        //
        // modelOverride：本工具做「分工调用」—— 判断 JD 要快、量大，用 flash；
        // 写招呼语要质量，一次一条，用 pro。所以必须能逐次覆盖模型，
        // 不能只有全局一个。不传则用全局配置的模型（保持原有行为不变）。
        async requestAiWithSystem(systemPrompt, userMessage, maxTokens = 512, modelOverride = null) {
            const config = this.getAIConfig();

            // 检查限制
            const limit = this.checkRateLimit();
            if (!limit.allowed) {
                throw new Error(limit.reason === 'no-key'
                    ? this.NO_KEY_MESSAGE
                    : '今日免费额度已用完，请在设置中配置自己的API Key');
            }

            try {
                const content = await this._chatCompletion({
                    apiUrl: config.apiUrl,
                    apiKey: config.apiKey,
                    model: modelOverride || config.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage }
                    ],
                    maxTokens
                });
                this.recordAiUsage();
                return content;
            } catch (error) {
                console.error('AI请求失败:', error);
                throw error;
            }
        },

        // 从 AI 返回的文本中稳健地提取 JSON 对象。
        //
        // 为什么不能直接 JSON.parse：
        //   1. 模型常把 JSON 包在 ```json 围栏里
        //   2. 模型可能在 JSON 前后加一句说明文字
        //   3. max_tokens 偏小时 JSON 会被**中途截断**，末尾不完整
        // 前两种可以清理，第三种无法恢复 —— 只能靠调用方给足 maxTokens，
        // 这里至少给出可读的错误，便于定位。
        extractJson(text) {
            if (!text) throw new Error('AI 返回为空');
            let s = String(text).trim();

            // 去掉 markdown 代码围栏
            s = s.replace(/```json/gi, '').replace(/```/g, '').trim();

            // ⚠️ 必须先清洗再 parse。
            // 模型经常在 JSON 里加注释和尾逗号，标准 JSON.parse 会直接抛错 ——
            // 原实现漏了这一步：清洗只发生在调用方，而调用方拿到的是
            // extractJson 抛出的异常，永远走不到清洗那一步。
            // 两处尝试都要清洗（花括号截取那段也可能带注释）。
            try { return JSON.parse(this._sanitizeJson(s)); } catch (_) { /* 继续 */ }

            // 截取第一个 { 到最后一个 }
            const start = s.indexOf('{');
            const end = s.lastIndexOf('}');
            if (start >= 0 && end > start) {
                const slice = s.slice(start, end + 1);
                try { return JSON.parse(this._sanitizeJson(slice)); } catch (_) { /* 继续 */ }
            }

            // 判断是否为截断
            const looksTruncated = start >= 0 && (end <= start);
            throw new Error(looksTruncated
                ? 'AI 返回的 JSON 不完整（可能被 max_tokens 截断），请重试或更换模型'
                : 'AI 返回的内容不是合法 JSON');
        },

        // 保存简历信息
        // 关键：同时保留**简历全文**（rawText）。
        // 结构化字段只有 7 个短字段，且用户简历常缺姓名/学历/工作年限，
        // 这些字段会变成"未填写"。只靠它们生成招呼语时，AI 拿不到任何
        // 具体证据，只能编造 —— 这正是招呼语质量差的根因。
        // 全文里才有项目名、技术栈、量化结果等真正可引用的证据。
        saveResume(resumeData) {
            Object.assign(state.resume, resumeData);
            localStorage.setItem('bossResume', JSON.stringify(state.resume));
        },

        // 保存简历全文（与结构化字段分开存储，避免把长文本混进表单）
        saveResumeRawText(text) {
            const trimmed = (text || '').trim();
            if (!trimmed) return;
            // localStorage 单域上限约 5MB，简历留 8000 字符足够且安全
            const capped = trimmed.slice(0, 8000);
            state.resume.rawText = capped;
            localStorage.setItem('bossResumeRawText', capped);
            this.log(`📄 已保存简历全文 ${capped.length} 字符（供生成招呼语引用具体经历）`);
        },

        // 读取简历全文
        getResumeRawText() {
            return (state.resume && state.resume.rawText)
                || localStorage.getItem('bossResumeRawText') || '';
        },

        // PDF简历解析：从扩展本地加载pdf.js提取文本，然后AI结构化
        async parsePdfResume(file) {
            this.log('📄 正在读取PDF文件...');
            let fullText = '';
            try {
                const arrayBuffer = await file.arrayBuffer();

                // pdf.js 已通过 manifest 的 content_scripts 加载，直接使用
                if (typeof globalThis.pdfjsLib === 'undefined') {
                    this.log('❌ PDF.js 未加载，请检查扩展是否完整（lib/pdf.min.js）');
                    return null;
                }

                const pdf = await globalThis.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n';
                }

                if (!fullText.trim()) {
                    this.log('⚠️ PDF中未提取到文本（可能是扫描件），请用粘贴文本方式或手动填写');
                    return null;
                }

                this.log(`📄 提取到 ${fullText.length} 字符`);
            } catch (error) {
                this.log('❌ PDF读取失败: ' + error.message);
                this.log('💡 可尝试粘贴文本方式解析');
                return null;
            }

            // 无论后续 AI 解析成功与否，先把全文保存下来 ——
            // resume.rawText 是生成个性化招呼语的证据来源
            this.saveResumeRawText(fullText);

            // 尝试用AI解析
            try {
                this.log('🤖 正在用AI解析简历...');
                const parsePrompt = `你是一个简历解析器。请从以下简历文本中提取结构化信息，严格按JSON格式输出，不要输出其他内容。

要求提取的字段：
{
  "name": "姓名",
  "yearsOfExp": "工作年限（如：3年）",
  "education": "最高学历（如：本科/硕士）",
  "currentCompany": "当前或上一家公司名",
  "targetPosition": "目标岗位",
  "skills": "技能栈，逗号分隔（如：React,Vue,TypeScript）",
  "highlight": "核心亮点，1-2句话总结最突出的项目经历或成就"
}

如果某个字段无法提取，留空字符串。直接输出JSON，不要markdown格式。`;

                const result = await this.requestAiWithSystem(parsePrompt, fullText.slice(0, 3000), 1200);

                if (result) {
                    const parsed = this.extractJson(result);
                    this.log(`✅ 简历解析成功：${parsed.name || '未知'} | ${parsed.yearsOfExp || ''} | ${parsed.skills?.slice(0, 50) || ''}`);
                    return parsed;
                }
            } catch (error) {
                this.log('⚠️ AI解析失败: ' + error.message);
                // 即使AI解析失败，也尝试正则提取基本信息
                this.log('💡 尝试从PDF文本中直接提取...');
                const fallback = this._fallbackParseResume(fullText);
                if (fallback) {
                    this.log('✅ 基础信息提取成功（建议手动补充）');
                    return fallback;
                }
                this.log('💡 请在设置中配置API Key后重试，或手动填写简历信息');
            }
            return null;
        },

        // 从粘贴的文本解析简历
        async parseTextResume(text) {
            this.log('🤖 正在解析简历文本...');
            if (!text || text.trim().length < 10) {
                this.log('⚠️ 文本内容太少');
                return null;
            }

            // 与 PDF 路径一致：先保存全文，作为招呼语的证据来源
            this.saveResumeRawText(text);

            try {
                const parsePrompt = `你是一个简历解析器。请从以下简历文本中提取结构化信息，严格按JSON格式输出，不要输出其他内容。

要求提取的字段：
{
  "name": "姓名",
  "yearsOfExp": "工作年限（如：3年）",
  "education": "最高学历（如：本科/硕士）",
  "currentCompany": "当前或上一家公司名",
  "targetPosition": "目标岗位",
  "skills": "技能栈，逗号分隔（如：React,Vue,TypeScript）",
  "highlight": "核心亮点，1-2句话总结最突出的项目经历或成就"
}

如果某个字段无法提取，留空字符串。直接输出JSON，不要markdown格式。`;

                const result = await this.requestAiWithSystem(parsePrompt, text.slice(0, 3000), 1200);

                if (result) {
                    const parsed = this.extractJson(result);
                    this.log(`✅ 简历解析成功：${parsed.name || '未知'} | ${parsed.yearsOfExp || ''} | ${parsed.skills?.slice(0, 50) || ''}`);
                    return parsed;
                }
            } catch (error) {
                this.log('⚠️ AI解析失败: ' + error.message);
                this.log('💡 尝试正则提取...');
                const fallback = this._fallbackParseResume(text);
                if (fallback) {
                    this.log('✅ 基础信息提取成功（建议手动补充）');
                    return fallback;
                }
                this.log('💡 请在设置中配置API Key，或手动填写简历信息');
            }
            return null;
        },

        // 简历正则兜底解析（无API也可用）
        _fallbackParseResume(text) {
            const result = {
                name: '', yearsOfExp: '', education: '', currentCompany: '',
                targetPosition: '', skills: '', highlight: ''
            };

            // 姓名：常见格式
            const nameMatch = text.match(/姓\s*名[：:]\s*(\S+)/) || text.match(/^([^\s,，。]{2,4})$/m);
            if (nameMatch) result.name = nameMatch[1];

            // 工作年限
            const expMatch = text.match(/(\d+)\s*年/) || text.match(/工作[经验][:：]\s*(\d+\s*年)/);
            if (expMatch) result.yearsOfExp = expMatch[0].includes('工作') ? expMatch[0].replace(/工作[经验][:：]\s*/, '') : expMatch[0];

            // 学历
            const eduMatch = text.match(/(博士|硕士|本科|大专|MBA)/);
            if (eduMatch) result.education = eduMatch[1];

            // 技能：查找常见技术词
            // ⚠️ 必须转义后再构造正则。原实现在列表里写 'C\+\+'，
            // 但字符串字面量里的 \+ 就是 +，实际值是 'C++'，
            // 而 new RegExp('C++') 会抛 "Nothing to repeat" ——
            // 导致这个兜底解析在 AI 失败时整个崩掉（真机已复现）。
            const techKeywords = ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C++', 'React', 'Vue', 'Angular',
                'Node', 'Spring', 'Django', 'MySQL', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'Linux', 'Git'];
            const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const found = techKeywords.filter((t) => {
                try { return new RegExp(escRe(t), 'i').test(text); } catch (_) { return false; }
            });
            if (found.length) result.skills = found.join(',');

            // 至少有姓名或技能才算提取成功
            if (!result.name && !result.skills) return null;
            return result;
        },

        // 查看当前岗位JD详情
        viewCurrentJD() {
            const jd = this.extractCurrentJD();

            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5); z-index: 999998;
                display: flex; align-items: center; justify-content: center;
            `;

            const box = document.createElement('div');
            box.style.cssText = `
                width: 90%; max-width: 500px; max-height: 80vh;
                background: white; border-radius: 16px;
                display: flex; flex-direction: column; overflow: hidden;
                font-family: 'Segoe UI', sans-serif;
            `;

            const header = document.createElement('div');
            header.style.cssText = `
                padding: 15px 20px; background: var(--primary-color);
                color: white; font-size: 16px; font-weight: 600;
                display: flex; justify-content: space-between; align-items: center;
            `;
            header.textContent = `📋 ${jd.title || '岗位详情'}`;

            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = 'background:transparent;color:white;border:none;font-size:18px;cursor:pointer;';
            closeBtn.addEventListener('click', () => modal.remove());
            header.appendChild(closeBtn);

            const body = document.createElement('div');
            body.style.cssText = 'padding: 20px; overflow-y: auto; font-size: 14px; line-height: 1.6;';

            if (jd.salary) {
                body.innerHTML += `<div style="margin-bottom:10px;"><span style="color:#6b7280;font-size:13px;">薪资：</span><span style="color:#e91e63;font-weight:600;">${jd.salary}</span></div>`;
            }
            if (jd.company) {
                body.innerHTML += `<div style="margin-bottom:10px;"><span style="color:#6b7280;font-size:13px;">公司：</span><span style="font-weight:500;">${jd.company}</span></div>`;
            }
            if (jd.description) {
                body.innerHTML += `<div style="margin-bottom:15px;"><div style="color:#6b7280;font-size:13px;margin-bottom:5px;">职位描述：</div><div style="color:#374151;">${jd.description}</div></div>`;
            }
            if (jd.requirements) {
                body.innerHTML += `<div style="margin-bottom:15px;"><div style="color:#6b7280;font-size:13px;margin-bottom:5px;">任职要求：</div><div style="color:#374151;">${jd.requirements}</div></div>`;
            }
            if (!jd.description && !jd.requirements) {
                body.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:40px 0;">未检测到JD内容，请先点开岗位详情页</div>';
            }

            // 智能排除词检查
            const fullText = `${jd.title} ${jd.description} ${jd.requirements}`;
            const matchedWords = FilterUtils.smartMatchExclude(fullText, state.filters.excludeContentKeywords);

            if (matchedWords.length > 0) {
                const warning = document.createElement('div');
                warning.style.cssText = `
                    margin-top: 15px; padding: 10px 12px;
                    background: #fef2f2; border: 1px solid #fecaca;
                    border-radius: 8px; color: #991b1b; font-size: 13px;
                `;
                warning.innerHTML = `⚠️ <strong>检测到以下排除关键词：</strong><br>${matchedWords.map(w => `<span style="display:inline-block;background:#fee2e2;padding:2px 8px;border-radius:4px;margin:2px;">${w}</span>`).join('')}`;
                body.appendChild(warning);
            } else {
                const ok = document.createElement('div');
                ok.style.cssText = `
                    margin-top: 15px; padding: 10px 12px;
                    background: #f0fdf4; border: 1px solid #bbf7d0;
                    border-radius: 8px; color: #166534; font-size: 13px;
                `;
                ok.textContent = '✅ 未检测到排除关键词，该岗位可以投递';
                body.appendChild(ok);
            }

            const footer = document.createElement('div');
            footer.style.cssText = 'padding: 12px 20px; border-top: 1px solid #e5e7eb; display:flex; gap:10px;';

            const closeBtn2 = document.createElement('button');
            closeBtn2.textContent = '关闭';
            closeBtn2.style.cssText = 'flex:1;padding:8px;border:1px solid #d1d5db;border-radius:8px;cursor:pointer;background:white;color:#374151;';
            closeBtn2.addEventListener('click', () => modal.remove());

            const genBtn = document.createElement('button');
            genBtn.textContent = '✨ 生成打招呼语';
            genBtn.style.cssText = 'flex:1;padding:8px;border:none;border-radius:8px;cursor:pointer;background:linear-gradient(45deg,#9c27b0,#e91e63);color:white;font-weight:600;';
            genBtn.addEventListener('click', async () => {
                modal.remove();
                const greeting = await this.generateGreeting();
                if (greeting) {
                    try { await navigator.clipboard.writeText(greeting); } catch(e) {}
                }
            });

            footer.append(closeBtn2, genBtn);
            box.append(header, body, footer);
            modal.appendChild(box);
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
            document.body.appendChild(modal);
        },

        // 清除投递记录
        clearAppliedJobs() {
            state.appliedJobs.clear();
            localStorage.removeItem('appliedJobs');
            this.log('🗑️ 已清除全部投递记录');
        },

        async _findChatInput() {
            const sels = SEL.CHAT.chatInput || ['#chat-input'];
            for (const s of sels) {
                const el = await this.waitForElement(s, 3000);
                if (el) return el;
            }
            return null;
        },

        /**
         * 把文字填进聊天输入框。
         * BOSS 的输入框是 contenteditable，直接设 textContent 不触发框架的
         * 状态更新，因此要派发 input 事件；insertText 失败时退回 textContent + 事件。
         */
        async _fillChatInput(input, text) {
            input.focus();
            // 先清空
            input.textContent = '';
            try {
                document.execCommand('insertText', false, text);
            } catch (_) { /* 某些环境不支持 execCommand */ }

            // execCommand 失败时兜底：直接赋值 + 手动派发事件，
            // 否则 Vue/React 的状态不会更新，发送按钮点了也是空的
            if (!input.textContent || input.textContent.trim().length < text.length * 0.5) {
                input.textContent = text;
                input.dispatchEvent(new InputEvent('input', {
                    bubbles: true, cancelable: true, inputType: 'insertText', data: text,
                }));
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await this.delay(200);
        },

        /** 统计"我自己"发出的消息条数（用于确认真的发出去了） */
        _countSelfMessages() {
            try {
                return document.querySelectorAll(SEL.CHAT.selfMessageItem).length;
            } catch (_) { return 0; }
        },

        /** 判断输入框是否还残留着我们填的内容（发送成功会被清空） */
        _inputStillHasText(input, text) {
            try {
                const cur = (input.textContent || '').trim();
                if (!cur) return false;
                // 取前 8 个字比对，避免因为空格/换行差异误判
                return cur.slice(0, 8) === String(text).trim().slice(0, 8);
            } catch (_) { return false; }
        },

        /**
         * 发送一条消息到当前聊天框。
         * @returns {Promise<{ok:boolean, reason:string}>}
         */
        async sendMessageToChat(text, { retries = 2 } = {}) {
            if (!text || !text.trim()) return { ok: false, reason: '消息为空' };

            for (let attempt = 0; attempt <= retries; attempt++) {
                if (attempt > 0) {
                    this.log(`↻ 发送重试第 ${attempt} 次`);
                    await this.delay(800);
                }

                const input = await this._findChatInput();
                if (!input) {
                    this.log('⚠️ 未找到聊天输入框');
                    continue;
                }

                const before = this._countSelfMessages();
                await this._fillChatInput(input, text);

                const sendBtn = await this.waitForAny([SEL.CHAT.sendButton], { timeout: 3000 });
                if (sendBtn) {
                    await this.simulateClick(sendBtn);
                } else {
                    // 没有发送按钮就回车
                    const ev = new KeyboardEvent('keydown', {
                        key: 'Enter', keyCode: 13, code: 'Enter', which: 13, bubbles: true,
                    });
                    input.dispatchEvent(ev);
                }

                // 等"真的发出去了"再判断，而不是死等 800ms。
                // 两条成功判据任一成立即可（见下方注释）。
                // 用 waitForCondition 是为了在后台标签也立刻响应 ——
                // 定时器会被节流，MutationObserver 不会。
                await this.waitForCondition(() => {
                    const grew = this._countSelfMessages() > before;
                    const cleared = !this._inputStillHasText(input, text);
                    return grew || cleared;
                }, { timeout: 5000 });

                const after = this._countSelfMessages();
                const cleared = !this._inputStillHasText(input, text);

                if (after > before) {
                    return { ok: true, reason: '已发送（消息数 +1）' };
                }
                if (cleared) {
                    // 有些页面不把我方消息计入 item-myself，但输入框被清空
                    // 也说明发出去了
                    return { ok: true, reason: '已发送（输入框已清空）' };
                }
                this.log('⚠️ 发送后未检测到生效');
            }

            return { ok: false, reason: `重试 ${retries + 1} 次仍失败` };
        },

        /**
         * 为当前 JD 生成招呼语并发送。
         * 生成失败或发送失败都返回 false —— 调用方据此**不记录该岗位为已投**，
         * 并写入 skipList，避免下次重复尝试。
         */
        async generateAndSendGreeting(job, judged) {
            let result = null;
            try {
                result = await this.generateGreetingForJD(job, judged);
            } catch (e) {
                this.log(`❌ 招呼语生成失败：${e.message}`);
                return { ok: false, reason: 'generate-failed' };
            }
            // generateGreetingForJD 返回 {text, basis, warnings}，失败时返回 null。
            // 这里要取 .text —— 早期实现直接把它当字符串传给 sendMessageToChat，
            // 导致 text.trim is not a function（被测试抓出来）。
            const text = result && typeof result === 'object' ? result.text : result;
            if (!text || !String(text).trim()) {
                return { ok: false, reason: 'generate-empty' };
            }

            const r = await this.sendMessageToChat(String(text).trim());
            if (!r.ok) {
                this.log(`❌ 招呼语发送失败（${r.reason}），本岗位不计入已投`);
                return { ok: false, reason: 'send-failed', text, basis: result.basis };
            }
            return { ok: true, text, basis: result.basis, reason: r.reason };
        },

        async simulateClick(element) {
            if (!element) return;
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const dispatchMouseEvent = (type, options = {}) => {
                const event = new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: document.defaultView,
                    clientX: x,
                    clientY: y,
                    ...options
                });
                element.dispatchEvent(event);
            };
            dispatchMouseEvent('mouseover');
            await this.delay(30);
            dispatchMouseEvent('mousemove');
            await this.delay(30);
            dispatchMouseEvent('mousedown', { button: 0 });
            await this.delay(30);
            dispatchMouseEvent('mouseup', { button: 0 });
            await this.delay(30);
            dispatchMouseEvent('click', { button: 0 });
        },

        // ══════════════════════════════════════════════════════════════
        //  等条件就绪（而不是等固定秒数）
        //
        //  为什么必须这样：浏览器对**后台标签页**的定时器有降频策略 ——
        //  隐藏 5 分钟后进入密集节流，setTimeout 最多一分钟才跑一次。
        //  求职者要"启动就走开、切到别的标签"，如果流程靠 await delay(1500)
        //  推进，切走后就会从"几秒投一个"掉到"一分钟投一个"。
        //
        //  而 MutationObserver 是** DOM 变了才触发**，不是定时器，
        //  在后台标签里照常立刻触发。所以把"等 1.5 秒再做下一步"
        //  改成"等那个元素出现再做下一步"，后台也能接近全速。
        //
        //  ⚠️ 但仍要保留超时兜底：页面结构变了、元素永远不出现时，
        //  必须能继续往下走，不能把流程卡死。
        // ══════════════════════════════════════════════════════════════

        /**
         * 等任意一个选择器出现，返回第一个命中的元素。
         * @param {string[]} selectors
         * @param {{timeout?:number, interval?:number}} opt
         *        interval 只在 MutationObserver 不可用时作为兜底轮询间隔
         * @returns {Promise<Element|null>}
         */
        waitForAny(selectors, { timeout = 8000, interval = 100 } = {}) {
            const sels = (selectors || []).filter(Boolean);
            if (!sels.length) return Promise.resolve(null);

            const find = () => {
                for (const s of sels) {
                    const el = document.querySelector(s);
                    if (el) return el;
                }
                return null;
            };

            return new Promise((resolve) => {
                // ⚠️ 三个句柄必须先声明并初始化，见下方 finish 的注释
                let done = false;
                let observer = null;
                let poller = null;
                let timer = null;

                const finish = (el) => {
                    if (done) return;
                    done = true;
                    try { if (observer) observer.disconnect(); } catch (_) { }
                    if (timer) clearTimeout(timer);
                    if (poller) clearInterval(poller);
                    resolve(el);
                };

                const hit = find();
                if (hit) return finish(hit);

                observer = new MutationObserver(() => {
                    const el = find();
                    if (el) finish(el);
                });
                try {
                    observer.observe(document.body || document.documentElement,
                        { childList: true, subtree: true });
                } catch (_) { /* observe 失败时只靠轮询 */ }

                // 轮询兜底：MutationObserver 在某些情况下不会触发
                // （如属性变化、或 el 已存在于但被替换）。间隔设小些即可，
                // 它只在后台被节流，而 observer 才是主路径。
                poller = setInterval(() => {
                    const el = find();
                    if (el) finish(el);
                }, interval);

                timer = setTimeout(() => finish(null), timeout);
            });
        },

        /**
         * 等某个条件成立（不只是元素存在，也可以是任意判断）。
         * 用于"发出去之后等消息列表更新"这类场景。
         * @param {() => any} predicate 返回真值即视为就绪
         */
        waitForCondition(predicate, { timeout = 8000, interval = 120 } = {}) {
            return new Promise((resolve) => {
                // ⚠️ 这三个句柄必须在 finish 被**任何路径**调用之前就存在。
                // 原实现把它们声明在同步检查之后 —— 条件已成立时会先调 finish，
                // 此时 const 还在 TDZ，访问即抛 ReferenceError；而 Promise
                // 执行器内的异常会把 Promise 静默变成 rejected，
                // 调用方 await 直接中断，且没有明显报错。
                let done = false;
                let observer = null;
                let poller = null;
                let timer = null;

                const finish = (v) => {
                    if (done) return;
                    done = true;
                    try { if (observer) observer.disconnect(); } catch (_) { }
                    if (timer) clearTimeout(timer);
                    if (poller) clearInterval(poller);
                    resolve(v);
                };

                try { const v = predicate(); if (v) return finish(v); } catch (_) { }

                observer = new MutationObserver(() => {
                    try { const v = predicate(); if (v) finish(v); } catch (_) { }
                });
                try {
                    observer.observe(document.body || document.documentElement,
                        { childList: true, subtree: true, characterData: true });
                } catch (_) { }

                poller = setInterval(() => {
                    try { const v = predicate(); if (v) finish(v); } catch (_) { }
                }, interval);

                timer = setTimeout(() => finish(null), timeout);
            });
        },

        async waitForElement(selectorOrFunction, timeout = 5000) {
            return new Promise((resolve) => {
                // 句柄先声明，避免 timeout 回调引用到尚未赋值的变量
                // （同 waitForAny 那个 ReferenceError 的成因，见上方注释）
                let observer = null;
                let timeoutId = null;
                let settled = false;
                const done = (v) => {
                    if (settled) return;
                    settled = true;
                    try { if (observer) observer.disconnect(); } catch (_) { }
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(v);
                };

                const query = () => (typeof selectorOrFunction === 'function'
                    ? selectorOrFunction()
                    : document.querySelector(selectorOrFunction));

                const first = query();
                if (first) return done(first);

                timeoutId = setTimeout(() => done(null), timeout);

                observer = new MutationObserver(() => {
                    const el = query();
                    if (el) done(el);
                });
                const target = document.body || document.documentElement;
                if (target) {
                    observer.observe(target, { childList: true, subtree: true });
                } else {
                    done(null);
                }
            });
        },

        // 让出执行权，不用定时器。
        //
        // 为什么需要它：浏览器对**后台标签**的定时器（setTimeout / setInterval）
        // 有密集节流 —— 隐藏 5 分钟后最多一分钟才跑一次。而 MessageChannel 的
        // 消息事件**不是定时器**，不受该节流策略影响（Chrome 官方说明明确把
        // 节流对象限定为 "setTimeout and setInterval"）。
        //
        // ⚠️ 但要清楚它的能力边界：它只能保证"让出执行权、让事件循环转一圈"，
        //    **不保证延迟时长**。所以它只适合"下一步该跑了，让一让"的场景，
        //    不适合"等页面渲染完"（那必须用 waitForAny / waitForCondition）。
        _nextTick() {
            return new Promise((resolve) => {
                if (typeof MessageChannel !== 'function') {
                    // 极老环境兜底：至少还有 setTimeout
                    setTimeout(resolve, 0);
                    return;
                }
                const ch = new MessageChannel();
                ch.port1.onmessage = () => {
                    try { ch.port1.close(); ch.port2.close(); } catch (_) { }
                    resolve();
                };
                ch.port2.postMessage(0);
            });
        },

        /**
         * 延迟若干毫秒 —— 就老老实实等（不试图逃逸节流）。
         *
         * 设计取舍（2026-09-29 定）：
         *
         * 试过让 delay 双通路（定时器 + MessageChannel 竞争）来"在后台也等满"，
         * 实测**行不通** —— MessageChannel 的 tick 快到微秒级，Date.now() 的
         * 精度不够，导致 delay(300) 实际只等了 77ms。让一个函数同时兼顾
         * "延迟准确"和"不受节流"是矛盾的目标。
         *
         * 所以拆开：
         *   · delay(ms)         → 只用于**节奏控制**（前台要等满才有真实间隔）
         *   · waitForAny / waitForCondition → 用于**等页面就绪**（用
         *     MutationObserver，后台标签也不受节流影响）
         *
         * 结果：切到别的标签后，这里的等待会被浏览器拉长（最坏 1 分钟一次），
         * 但**流程不会错乱** —— 因为真正决定"能不能继续"的是元素是否就绪，
         * 而不是这里的等待。每日上限 80 家继续兜底风控。
         */
        delay(ms) {
            const wait = Number(ms) || 0;
            if (wait <= 0) return this._nextTick();
            return new Promise((resolve) => setTimeout(resolve, wait));
        },

        resetCycle() {
            // 注意：必须先把计数读出来再停止，否则 toggleProcess() 会清零 currentIndex，
            // 导致"本次共沟通 0 个岗位"的错误日志（原 bug）。
            const doneCount = state.currentIndex;
            __BH__.toggleProcess();
            this.log(`🎉 所有符合条件的岗位沟通完成，本轮实际沟通 ${doneCount} 个，恭喜你即将找到理想工作！`);
        },

        log(message) {
            const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
            const logPanel = document.querySelector('#pro-log');
            if (logPanel) {
                const logItem = document.createElement('div');
                logItem.className = 'log-item';
                logItem.style.cssText = 'margin-bottom: 4px; line-height: 1.5;';
                logItem.textContent = logEntry;
                logPanel.appendChild(logItem);
                logPanel.scrollTop = logPanel.scrollHeight;
            }
        }
    };

    __BH__.Core = Core;
})();
