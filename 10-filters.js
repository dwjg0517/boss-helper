// BOSS海投助手 · 岗位筛选工具
// 从原单体 content.js 抽出（重构第 4 步）。逻辑未做任何改动。
//
// 依赖：CONFIG（01-config.js）、state（02-state.js）。
// 本模块不依赖 Core / UI，可安全地最先加载。
(function () {
    'use strict';

    const CONFIG = __BH__.CONFIG;
    const state = __BH__.state;
    // 选择器统一来自 05-selectors.js 的单一来源，便于发现漂移
    const SEL = __BH__.SELECTORS.JOB_CARD_FIELDS;

    const FilterUtils = {
        // 从岗位卡片提取所有信息
        extractJobInfo(card) {
            // 选择器定义与各自的验证状态见 05-selectors.js。
            // 2026-09 用 tools/selector-audit.js 对真实职位列表页采样 8 张
            // 卡片核实：真实类名为 .job-salary / .boss-name / .tag-list li，
            // 与旧代码假设的 .salary / .company-name / .tag-item 均不同。
            // 每个字段都是**回落数组**，按优先级依次尝试。
            const pick = (sels) => {
                for (const s of sels) {
                    const el = card.querySelector(s);
                    if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
                }
                return '';
            };

            const info = {
                title: pick(SEL.title),
                salary: pick(SEL.salary),
                location: pick(SEL.location),
                companyName: pick(SEL.company),
                companyInfo: pick(SEL.companyInfo),
                tags: Array.from(card.querySelectorAll(SEL.tags.join(', ')))
                    .map(el => (el.textContent || '').trim())
                    .filter(t => t)
            };

            // 提取岗位 ID（去重用）。
            // 岗位详情链接形如 /job_detail/<岗位ID>.html，ID 是平台内唯一标识。
            // 为什么必须用它：旧逻辑用 `标题-公司名` 做 key，而公司名选择器
            // 曾长期失效（companyName 恒为空），导致 key 退化成纯标题 ——
            // 不同公司的同名岗位被误判为"已投递"而跳过。
            info.jobUrl = '';
            info.jobId = '';
            for (const s of SEL.jobLink) {
                const el = card.querySelector(s);
                const href = el && (el.getAttribute ? el.getAttribute('href') : '');
                if (href && /\/job_detail\//.test(href)) {
                    info.jobUrl = href;
                    const m = href.match(/\/job_detail\/([^./?#]+)/);
                    if (m) info.jobId = m[1];
                    break;
                }
            }
            // 兜底：卡片内任意指向 job_detail 的链接
            if (!info.jobId) {
                const any = card.querySelector('a[href*="/job_detail/"]');
                const href = any && any.getAttribute ? any.getAttribute('href') : '';
                if (href) {
                    info.jobUrl = href;
                    const m = href.match(/\/job_detail\/([^./?#]+)/);
                    if (m) info.jobId = m[1];
                }
            }

            // 提取薪资范围
            const salaryMatch = info.salary.match(/(\d+)-(\d+)K/);
            if (salaryMatch) {
                info.salaryMin = parseInt(salaryMatch[1]);
                info.salaryMax = parseInt(salaryMatch[2]);
            } else if (info.salary.includes('面议')) {
                info.salaryMin = null;
                info.salaryMax = null;
                info.salaryNegotiable = true;
            }

            // 提取经验和学历 (通常在公司信息区域)
            const infoText = info.companyInfo + ' ' + info.tags.join(' ');

            // 经验匹配
            const expPatterns = ['应届生', '1年以内', '1-3年', '3-5年', '5-10年', '10年以上'];
            for (const exp of expPatterns) {
                if (infoText.includes(exp)) {
                    info.experience = exp;
                    break;
                }
            }

            // 学历匹配
            const eduPatterns = ['博士', '硕士', '本科', '大专'];
            for (const edu of eduPatterns) {
                if (infoText.includes(edu)) {
                    info.education = edu;
                    break;
                }
            }

            // 公司规模匹配
            const sizePatterns = ['10000人以上', '1000-9999人', '500-999人', '100-499人', '20-99人', '0-20人'];
            for (const size of sizePatterns) {
                if (infoText.includes(size)) {
                    info.companySize = size;
                    break;
                }
            }

            return info;
        },

        // 判断岗位是否符合所有筛选条件
        matchesAllFilters(card) {
            const info = this.extractJobInfo(card);
            const f = state.filters;

            // 岗位关键词筛选
            if (state.filterKeyword) {
                const keywords = state.filterKeyword.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
                const titleLower = info.title.toLowerCase();
                const titleMatch = keywords.some(kw => titleLower.includes(kw));
                if (!titleMatch) return false;
            }

            // 地点筛选
            if (state.locationKeyword) {
                const locations = state.locationKeyword.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
                const locationLower = info.location.toLowerCase();
                const locationMatch = locations.some(loc => locationLower.includes(loc));
                if (!locationMatch) return false;
            }

            // 最低薪资筛选
            if (f.salaryMin && info.salaryMin !== null && info.salaryMin !== undefined) {
                if (!info.salaryNegotiable && info.salaryMin < parseInt(f.salaryMin)) {
                    return false;
                }
            }

            // 最高薪资筛选
            if (f.salaryMax && info.salaryMax !== null && info.salaryMax !== undefined) {
                if (!info.salaryNegotiable && info.salaryMax > parseInt(f.salaryMax)) {
                    return false;
                }
            }

            // 工作经验筛选
            if (f.experience && info.experience) {
                if (info.experience !== f.experience) return false;
            }

            // 学历筛选
            if (f.education && info.education) {
                const eduRank = { '大专': 1, '本科': 2, '硕士': 3, '博士': 4 };
                const required = eduRank[f.education] || 0;
                const current = eduRank[info.education] || 0;
                if (current < required) return false;
            }

            // 公司规模筛选
            if (f.companySize && info.companySize) {
                if (info.companySize !== f.companySize) return false;
            }

            // 行业关键词筛选
            if (f.industryKeyword) {
                const industries = f.industryKeyword.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
                const infoLower = info.companyInfo.toLowerCase();
                const industryMatch = industries.some(ind => infoLower.includes(ind));
                if (!industryMatch) return false;
            }

            // 公司名称关键词筛选
            if (f.companyKeyword) {
                const companies = f.companyKeyword.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
                const companyLower = info.companyName.toLowerCase();
                const companyMatch = companies.some(c => companyLower.includes(c));
                if (!companyMatch) return false;
            }

            // 排除关键词（岗位标题）
            if (f.excludeKeywords) {
                const excludes = f.excludeKeywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
                const titleLower = info.title.toLowerCase();
                const hasExclude = excludes.some(ex => titleLower.includes(ex));
                if (hasExclude) return false;
            }

            // 排除公司
            if (f.excludeCompanies) {
                const excludes = f.excludeCompanies.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
                const companyLower = info.companyName.toLowerCase();
                const hasExclude = excludes.some(ex => companyLower.includes(ex));
                if (hasExclude) return false;
            }

            return true;
        },

        // 保存筛选设置
        saveFilters() {
            localStorage.setItem('bossFilters', JSON.stringify(state.filters));
            localStorage.setItem('bossFilterKeyword', state.filterKeyword);
            localStorage.setItem('bossLocationKeyword', state.locationKeyword);
        },

        // 智能匹配JD排除词
        // 对"单休""大小周"等做精准上下文匹配，避免误杀
        smartMatchExclude(text, keywords) {
            if (!keywords || !keywords.length) return [];
            const lower = text.toLowerCase();
            const matched = [];

            for (const kw of keywords) {
                const kwLower = kw.toLowerCase();
                const opt = CONFIG.EXCLUDE_CONTENT_OPTIONS.find(o => o.value === kw);

                if (opt && opt.type === 'smart') {
                    // 智能匹配：单休/大小周
                    if (kw === '单休') {
                        // 匹配"单休"，但排除"双休""非单休""不是单休""周末双休"
                        const idx = lower.indexOf('单休');
                        if (idx > -1) {
                            const before = lower.slice(Math.max(0, idx - 3), idx);
                            if (!before.includes('双') && !before.includes('非') && !before.includes('不')) {
                                matched.push(kw);
                            }
                        }
                    } else if (kw === '大小周') {
                        // 匹配"大小周"，排除"非大小周""不是大小周"
                        const idx = lower.indexOf('大小周');
                        if (idx > -1) {
                            const before = lower.slice(Math.max(0, idx - 3), idx);
                            if (!before.includes('非') && !before.includes('不')) {
                                matched.push(kw);
                            }
                        }
                    } else {
                        if (lower.includes(kwLower)) matched.push(kw);
                    }
                } else {
                    // 普通包含匹配
                    if (lower.includes(kwLower)) matched.push(kw);
                }
            }
            return matched;
        }
    };

    __BH__.FilterUtils = FilterUtils;
})();
