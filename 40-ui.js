// BOSS海投助手 · 界面模块
// 从原单体 content.js 抽出（重构第 6 步）。逻辑未做任何改动。
//
// 依赖（均在 40 之前加载，可安全顶层绑定）：
//   CONFIG(01) / state(02) / elements(02) / FilterUtils(10) /
//   Core(20) / toggleProcess, toggleChatProcess(30)
//
// UI 是依赖链的叶子：Core 不引用 UI，全项目仅 99-content.js 的
// init() 调用一次 UI.init()。因此拆出 UI 不会引入任何循环依赖。
//
// 本文件仍偏大（约 1150 行），后续可再细分，例如：
//   41-ui-panel.js     面板骨架、头部、底部、拖拽、迷你图标
//   42-ui-filters.js   基础筛选与高级筛选面板
//   43-ui-settings.js  设置弹窗（含 API 配置、简历录入）
(function () {
    'use strict';

    const CONFIG = __BH__.CONFIG;
    const state = __BH__.state;
    const elements = __BH__.elements;
    const FilterUtils = __BH__.FilterUtils;
    const Core = __BH__.Core;
    const toggleProcess = __BH__.toggleProcess;
    const toggleChatProcess = __BH__.toggleChatProcess;

    const UI = {
        PAGE_TYPES: { JOB_LIST: 'jobList', CHAT: 'chat' },
        currentPageType: null,

        init() {
            this.currentPageType = location.pathname.includes('/chat')
                ? this.PAGE_TYPES.CHAT
                : this.PAGE_TYPES.JOB_LIST;
            this._applyTheme();
            this.createControlPanel();
            this.createMiniIcon();
        },

        _applyTheme() {
            const colors = this.currentPageType === this.PAGE_TYPES.JOB_LIST
                ? { primary: '#4285f4', secondary: '#f5f7fa', accent: '#e8f0fe', neutral: '#6b7280' }
                : { primary: '#34a853', secondary: '#f0fdf4', accent: '#dcfce7', neutral: '#6b7280' };
            CONFIG.COLORS = colors;
            document.documentElement.style.setProperty('--primary-color', colors.primary);
            document.documentElement.style.setProperty('--secondary-color', colors.secondary);
            document.documentElement.style.setProperty('--accent-color', colors.accent);
            document.documentElement.style.setProperty('--neutral-color', colors.neutral);
            const rgb = this._hexToRgb(colors.primary);
            document.documentElement.style.setProperty('--primary-rgb', rgb);
        },

        createControlPanel() {
            if (document.getElementById('boss-pro-panel')) {
                document.getElementById('boss-pro-panel').remove();
            }
            elements.panel = this._createPanel();
            const header = this._createHeader();
            const controls = this._createPageControls();
            elements.log = this._createLogger();
            const footer = this._createFooter();
            elements.panel.append(header, controls, elements.log, footer);
            document.body.appendChild(elements.panel);
            this._makeDraggable(elements.panel);

            if (!document.getElementById('boss-settings-dialog')) {
                const settingsDialog = this._createSettingsDialog();
                document.body.appendChild(settingsDialog);
            }

            if (this.currentPageType === this.PAGE_TYPES.CHAT) {
                if (elements.filterInput) elements.filterInput.style.display = 'none';
                if (elements.locationInput) elements.locationInput.style.display = 'none';
            }
        },

        _createPanel() {
            const panel = document.createElement('div');
            panel.id = 'boss-pro-panel';
            panel.style.cssText = `
                position: fixed; top: 36px; right: 24px;
                width: clamp(320px, 85vw, 420px);
                border-radius: 16px; padding: 18px;
                font-family: 'Segoe UI', system-ui, sans-serif;
                z-index: 2147483647; display: flex; flex-direction: column;
                transition: all 0.3s ease; background: #ffffff;
                box-shadow: 0 10px 25px rgba(var(--primary-rgb), 0.15);
                border: 1px solid var(--accent-color); cursor: default;
            `;
            return panel;
        },

        _createHeader() {
            const header = document.createElement('div');
            header.className = this.currentPageType === this.PAGE_TYPES.JOB_LIST ? 'boss-header' : 'boss-chat-header';
            header.style.cssText = `
                display: flex; justify-content: space-between; align-items: center;
                padding: 0 10px 15px; margin-bottom: 15px;
                border-bottom: 1px solid var(--accent-color);
            `;
            const title = this._createTitle();
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = 'display: flex; gap: 8px;';

            const clearLogBtn = this._createIconButton('🗑', () => {
                elements.log.innerHTML = `<div style="color:var(--neutral-color); margin-bottom:8px;">欢迎使用BOSS海投助手！设置筛选条件后点击启动海投即可开始自动投递。</div>`;
            }, '清空日志');

            const settingsBtn = this._createIconButton('⚙', () => {
                const dialog = document.getElementById('boss-settings-dialog');
                if (dialog) dialog.style.display = 'flex';
            }, '插件设置');

            const closeBtn = this._createIconButton('✕', () => {
                state.isMinimized = true;
                elements.panel.style.transform = 'translateY(160%)';
                elements.miniIcon.style.display = 'flex';
            }, '最小化面板');

            buttonContainer.append(clearLogBtn, settingsBtn, closeBtn);
            header.append(title, buttonContainer);
            return header;
        },

        _createTitle() {
            const title = document.createElement('div');
            title.style.cssText = 'display: flex; align-items: center; gap: 10px;';
            const mainTitle = this.currentPageType === this.PAGE_TYPES.JOB_LIST
                ? `<span style="color:var(--primary-color);">BOSS</span>海投助手`
                : `<span style="color:var(--primary-color);">BOSS</span>智能聊天`;
            const subTitle = this.currentPageType === this.PAGE_TYPES.JOB_LIST
                ? '高效求职 · 智能匹配'
                : '智能对话 · 高效沟通';
            title.innerHTML = `
                <div style="width: 40px; height: 40px; background: var(--primary-color);
                    border-radius: 10px; display: flex; justify-content: center;
                    align-items: center; color: white; font-weight: bold;
                    box-shadow: 0 2px 8px rgba(var(--primary-rgb), 0.3);">
                    💼
                </div>
                <div>
                    <h3 style="margin: 0; color: #2c3e50; font-weight: 600; font-size: 1.2rem;">
                        ${mainTitle}
                    </h3>
                    <span style="font-size:0.8em; color:var(--neutral-color);">
                        ${subTitle}
                    </span>
                </div>
            `;
            return title;
        },

        _createPageControls() {
            if (this.currentPageType === this.PAGE_TYPES.JOB_LIST) {
                return this._createJobListControls();
            } else {
                return this._createChatControls();
            }
        },

        _createJobListControls() {
            const container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 15px; padding: 0 10px;';

            // 基础筛选
            const baseFilterContainer = this._createBaseFilterContainer();

            // 高级筛选按钮
            const toggleAdvancedBtn = document.createElement('button');
            toggleAdvancedBtn.id = 'toggle-advanced-filters';
            toggleAdvancedBtn.innerHTML = '🔽 高级筛选';
            toggleAdvancedBtn.style.cssText = `
                width: 100%; padding: 8px 12px;
                background: var(--secondary-color);
                color: var(--primary-color);
                border: 1px solid var(--accent-color);
                border-radius: 8px; cursor: pointer;
                font-size: 13px; font-weight: 500;
                margin-bottom: 12px;
                transition: all 0.2s ease;
            `;
            toggleAdvancedBtn.addEventListener('mouseenter', () => {
                toggleAdvancedBtn.style.background = 'var(--accent-color)';
            });
            toggleAdvancedBtn.addEventListener('mouseleave', () => {
                toggleAdvancedBtn.style.background = 'var(--secondary-color)';
            });
            toggleAdvancedBtn.addEventListener('click', () => {
                this._toggleAdvancedFilters(toggleAdvancedBtn);
            });
            elements.toggleAdvancedBtn = toggleAdvancedBtn;

            // 高级筛选面板
            const advancedPanel = this._createAdvancedFilterPanel();
            elements.advancedFilterPanel = advancedPanel;

            // 双按钮行：查看JD + 生成打招呼语
            const actionRow = document.createElement('div');
            actionRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 10px;';

            const jdBtn = document.createElement('button');
            jdBtn.innerHTML = '📋 查看JD';
            jdBtn.style.cssText = `
                flex: 1; padding: 10px 8px;
                background: white; color: var(--primary-color);
                border: 1.5px solid var(--primary-color);
                border-radius: 10px; cursor: pointer;
                font-size: 13px; font-weight: 600;
                display: flex; justify-content: center; align-items: center;
                gap: 4px; transition: all 0.3s ease;
            `;
            jdBtn.addEventListener('mouseenter', () => {
                jdBtn.style.background = 'var(--primary-color)';
                jdBtn.style.color = 'white';
            });
            jdBtn.addEventListener('mouseleave', () => {
                jdBtn.style.background = 'white';
                jdBtn.style.color = 'var(--primary-color)';
            });
            jdBtn.addEventListener('click', () => Core.viewCurrentJD());

            const greetingBtn = document.createElement('button');
            greetingBtn.innerHTML = '✨ 生成打招呼语';
            greetingBtn.style.cssText = `
                flex: 1; padding: 10px 8px;
                background: linear-gradient(45deg, #9c27b0, #e91e63);
                color: white; border: none;
                border-radius: 10px; cursor: pointer;
                font-size: 13px; font-weight: 600;
                display: flex; justify-content: center; align-items: center;
                gap: 4px; transition: all 0.3s ease;
                box-shadow: 0 4px 10px rgba(156, 39, 176, 0.2);
            `;
            greetingBtn.addEventListener('mouseenter', () => {
                greetingBtn.style.transform = 'translateY(-2px)';
                greetingBtn.style.boxShadow = '0 6px 15px rgba(156, 39, 176, 0.3)';
            });
            greetingBtn.addEventListener('mouseleave', () => {
                greetingBtn.style.transform = 'translateY(0)';
                greetingBtn.style.boxShadow = '0 4px 10px rgba(156, 39, 176, 0.2)';
            });
            greetingBtn.addEventListener('click', async () => {
                const greeting = await Core.generateGreeting();
                if (greeting) {
                    try {
                        await navigator.clipboard.writeText(greeting);
                        Core.log('📋 已复制到剪贴板，可直接粘贴发送');
                    } catch (e) {
                        Core.log('💡 请手动复制打招呼语');
                    }
                }
            });

            actionRow.append(jdBtn, greetingBtn);

            // 启动按钮
            elements.controlBtn = this._createTextButton(
                '🚀 启动海投', 'var(--primary-color)', () => toggleProcess()
            );
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = 'display: flex; justify-content: center; width: 100%;';
            btnContainer.appendChild(elements.controlBtn);

            // 投递统计 + 清除记录
            const statsRow = document.createElement('div');
            statsRow.style.cssText = `
                display: flex; justify-content: space-between; align-items: center;
                margin-top: 10px; padding: 8px 10px;
                background: #f9fafb; border-radius: 8px; font-size: 12px;
            `;
            const statsText = document.createElement('span');
            statsText.style.color = '#6b7280';
            statsText.innerHTML = `📊 已投递 <strong style="color:var(--primary-color);">${state.appliedJobs.size}</strong> 个岗位`;
            elements.appliedCountEl = statsText;

            const clearBtn = document.createElement('button');
            clearBtn.textContent = '🗑️ 清除记录';
            clearBtn.style.cssText = `
                background: transparent; border: none; color: #ef4444;
                font-size: 12px; cursor: pointer; padding: 2px 6px;
            `;
            clearBtn.addEventListener('click', () => {
                if (confirm('确定要清除全部投递记录吗？清除后已投过的岗位会重新投递。')) {
                    Core.clearAppliedJobs();
                    statsText.innerHTML = `📊 已投递 <strong style="color:var(--primary-color);">0</strong> 个岗位`;
                }
            });
            statsRow.append(statsText, clearBtn);

            container.append(baseFilterContainer, toggleAdvancedBtn, advancedPanel, actionRow, btnContainer, statsRow);
            return container;
        },

        _createBaseFilterContainer() {
            const container = document.createElement('div');
            container.style.cssText = `
                background: var(--secondary-color); border-radius: 12px;
                padding: 15px; margin-bottom: 12px;
            `;

            const filterRow = document.createElement('div');
            filterRow.style.cssText = 'display: flex; gap: 10px; margin-bottom: 12px;';

            const jobFilterCol = this._createInputControl('岗位关键词', 'job-filter', '如：前端,Java,产品', state.filterKeyword);
            const locationFilterCol = this._createInputControl('工作地点', 'location-filter', '如：北京,上海,杭州', state.locationKeyword);

            elements.filterInput = jobFilterCol.querySelector('input');
            elements.locationInput = locationFilterCol.querySelector('input');

            filterRow.append(jobFilterCol, locationFilterCol);

            // 快速统计
            const statsRow = document.createElement('div');
            statsRow.style.cssText = `
                display: flex; justify-content: space-around;
                padding-top: 10px; border-top: 1px solid var(--accent-color);
                font-size: 12px; color: var(--neutral-color);
            `;
            statsRow.innerHTML = `
                <span>💡 多关键词用英文逗号分隔</span>
            `;

            container.append(filterRow, statsRow);
            return container;
        },

        _createAdvancedFilterPanel() {
            const panel = document.createElement('div');
            panel.id = 'advanced-filter-panel';
            panel.style.cssText = `
                background: #f0f7ff; border-radius: 12px;
                padding: 15px; margin-bottom: 12px;
                display: none;
            `;

            // 薪资范围
            const salaryRow = document.createElement('div');
            salaryRow.style.cssText = 'display: flex; gap: 10px; margin-bottom: 12px;';
            const salaryMinCol = this._createSelectControl('最低薪资', 'salary-min', CONFIG.FILTER_OPTIONS.salaryMin, state.filters.salaryMin);
            const salaryMaxCol = this._createSelectControl('最高薪资', 'salary-max', CONFIG.FILTER_OPTIONS.salaryMax, state.filters.salaryMax);
            elements.filterSelects.salaryMin = salaryMinCol.querySelector('select');
            elements.filterSelects.salaryMax = salaryMaxCol.querySelector('select');
            salaryRow.append(salaryMinCol, salaryMaxCol);

            // 经验 + 学历
            const expEduRow = document.createElement('div');
            expEduRow.style.cssText = 'display: flex; gap: 10px; margin-bottom: 12px;';
            const expCol = this._createSelectControl('工作经验', 'experience', CONFIG.FILTER_OPTIONS.experience, state.filters.experience);
            const eduCol = this._createSelectControl('学历要求', 'education', CONFIG.FILTER_OPTIONS.education, state.filters.education);
            elements.filterSelects.experience = expCol.querySelector('select');
            elements.filterSelects.education = eduCol.querySelector('select');
            expEduRow.append(expCol, eduCol);

            // 公司规模
            const sizeRow = document.createElement('div');
            sizeRow.style.cssText = 'margin-bottom: 12px;';
            const sizeCol = this._createSelectControl('公司规模', 'company-size', CONFIG.FILTER_OPTIONS.companySize, state.filters.companySize);
            elements.filterSelects.companySize = sizeCol.querySelector('select');
            sizeRow.append(sizeCol);

            // 行业 + 公司名称
            const industryRow = document.createElement('div');
            industryRow.style.cssText = 'display: flex; gap: 10px; margin-bottom: 12px;';
            const industryCol = this._createInputControl('行业关键词', 'industry-keyword', '如：互联网,金融,教育', state.filters.industryKeyword);
            const companyCol = this._createInputControl('公司名称关键词', 'company-keyword', '如：字节,阿里,腾讯', state.filters.companyKeyword);
            elements.filterSelects.industryKeyword = industryCol.querySelector('input');
            elements.filterSelects.companyKeyword = companyCol.querySelector('input');
            industryRow.append(industryCol, companyCol);

            // 排除关键词（岗位标题）
            const excludeRow = document.createElement('div');
            excludeRow.style.cssText = 'display: flex; gap: 10px; margin-bottom: 12px;';
            const excludeJobCol = this._createInputControl('排除岗位关键词', 'exclude-keywords', '如：销售,客服,外包', state.filters.excludeKeywords);
            const excludeCompanyCol = this._createInputControl('排除公司', 'exclude-companies', '如：XX公司', state.filters.excludeCompanies);
            elements.filterSelects.excludeKeywords = excludeJobCol.querySelector('input');
            elements.filterSelects.excludeCompanies = excludeCompanyCol.querySelector('input');
            excludeRow.append(excludeJobCol, excludeCompanyCol);

            // JD内容排除词（复选框形式）
            const excludeContentRow = document.createElement('div');
            excludeContentRow.style.cssText = 'margin-bottom: 12px;';
            const excludeContentLabel = document.createElement('div');
            excludeContentLabel.style.cssText = 'font-size: 13px; color: #6b7280; margin-bottom: 6px; font-weight: 500;';
            excludeContentLabel.innerHTML = '🚫 JD内容排除词 <span style="font-size:11px;color:#9ca3af;">（勾选后投递前自动检查JD）</span>';
            excludeContentRow.appendChild(excludeContentLabel);

            // 复选框容器
            const checkboxContainer = document.createElement('div');
            checkboxContainer.style.cssText = `
                display: flex; flex-wrap: wrap; gap: 6px;
                background: white; padding: 10px; border-radius: 8px;
                border: 1px solid #e5e7eb;
            `;

            const excludeContentCheckboxes = [];
            CONFIG.EXCLUDE_CONTENT_OPTIONS.forEach(opt => {
                const isChecked = (state.filters.excludeContentKeywords || []).includes(opt.value);
                const wrapper = document.createElement('label');
                wrapper.style.cssText = `
                    display: inline-flex; align-items: center; gap: 4px;
                    padding: 4px 8px; border-radius: 6px; cursor: pointer;
                    font-size: 12px; transition: all 0.2s;
                    background: ${isChecked ? '#fef2f2' : '#f9fafb'};
                    color: ${isChecked ? '#991b1b' : '#6b7280'};
                    border: 1px solid ${isChecked ? '#fca5a5' : '#e5e7eb'};
                `;
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = isChecked;
                cb.dataset.value = opt.value;
                cb.style.cssText = 'margin: 0; cursor: pointer;';

                const labelSpan = document.createElement('span');
                labelSpan.textContent = opt.label;

                cb.addEventListener('change', () => {
                    if (cb.checked) {
                        wrapper.style.background = '#fef2f2';
                        wrapper.style.color = '#991b1b';
                        wrapper.style.borderColor = '#fca5a5';
                    } else {
                        wrapper.style.background = '#f9fafb';
                        wrapper.style.color = '#6b7280';
                        wrapper.style.borderColor = '#e5e7eb';
                    }
                });

                wrapper.append(cb, labelSpan);
                checkboxContainer.appendChild(wrapper);
                excludeContentCheckboxes.push(cb);
            });

            elements.filterSelects.excludeContentKeywords = excludeContentCheckboxes;
            excludeContentRow.appendChild(checkboxContainer);

            // 实时预览按钮
            const previewRow = document.createElement('div');
            previewRow.style.cssText = 'margin-top: 10px;';
            const previewBtn = document.createElement('button');
            previewBtn.textContent = '🔍 预览筛选结果';
            previewBtn.style.cssText = `
                width: 100%; padding: 8px 12px;
                background: white; color: var(--primary-color);
                border: 1px solid var(--primary-color);
                border-radius: 8px; cursor: pointer;
                font-size: 13px; font-weight: 500;
                transition: all 0.2s ease;
            `;
            previewBtn.addEventListener('mouseenter', () => {
                previewBtn.style.background = 'var(--primary-color)';
                previewBtn.style.color = 'white';
            });
            previewBtn.addEventListener('mouseleave', () => {
                previewBtn.style.background = 'white';
                previewBtn.style.color = 'var(--primary-color)';
            });
            previewBtn.addEventListener('click', () => {
                this._previewFilterResults();
            });
            previewRow.appendChild(previewBtn);

            panel.append(salaryRow, expEduRow, sizeRow, industryRow, excludeRow, excludeContentRow, previewRow);
            return panel;
        },

        _toggleAdvancedFilters(btn) {
            const panel = elements.advancedFilterPanel;
            if (panel.style.display === 'none' || !panel.style.display) {
                panel.style.display = 'block';
                btn.innerHTML = '🔼 收起高级筛选';
            } else {
                panel.style.display = 'none';
                btn.innerHTML = '🔽 高级筛选';
            }
            // 保存筛选值到state
            this._collectFilterValues();
        },

        _collectFilterValues() {
            const selects = elements.filterSelects;
            if (selects.salaryMin) state.filters.salaryMin = selects.salaryMin.value;
            if (selects.salaryMax) state.filters.salaryMax = selects.salaryMax.value;
            if (selects.experience) state.filters.experience = selects.experience.value;
            if (selects.education) state.filters.education = selects.education.value;
            if (selects.companySize) state.filters.companySize = selects.companySize.value;
            if (selects.industryKeyword) state.filters.industryKeyword = selects.industryKeyword.value;
            if (selects.companyKeyword) state.filters.companyKeyword = selects.companyKeyword.value;
            if (selects.excludeKeywords) state.filters.excludeKeywords = selects.excludeKeywords.value;
            if (selects.excludeCompanies) state.filters.excludeCompanies = selects.excludeCompanies.value;
            if (selects.excludeContentKeywords && Array.isArray(selects.excludeContentKeywords)) {
                state.filters.excludeContentKeywords = selects.excludeContentKeywords
                    .filter(cb => cb.checked)
                    .map(cb => cb.dataset.value);
            }
            FilterUtils.saveFilters();
        },

        _previewFilterResults() {
            this._collectFilterValues();
            const allCards = document.querySelectorAll('li.job-card-box');
            const filtered = Array.from(allCards).filter(card => FilterUtils.matchesAllFilters(card));
            Core.log(`🔍 筛选预览：当前页面 ${allCards.length} 个岗位，符合条件 ${filtered.length} 个`);
            if (filtered.length > 0) {
                const sample = FilterUtils.extractJobInfo(filtered[0]);
                Core.log(`   示例：${sample.title} | ${sample.salary} | ${sample.companyName}`);
            }
        },

        _createChatControls() {
            const container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 15px; padding: 0 10px;';
            elements.controlBtn = this._createTextButton(
                '🤖 开始智能聊天', 'var(--primary-color)', () => toggleChatProcess()
            );
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = 'display: flex; justify-content: center; width: 100%;';
            btnContainer.appendChild(elements.controlBtn);
            container.append(btnContainer);
            return container;
        },

        _createInputControl(labelText, id, placeholder, defaultValue = '') {
            const controlCol = document.createElement('div');
            controlCol.style.cssText = 'flex: 1;';
            const label = document.createElement('label');
            label.textContent = labelText;
            label.style.cssText = 'display:block; margin-bottom:5px; font-weight: 500; color: #333; font-size: 0.85rem;';
            const input = document.createElement('input');
            input.id = id;
            input.placeholder = placeholder;
            input.value = defaultValue;
            input.style.cssText = `
                width: 100%; padding: 8px 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 13px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: all 0.2s ease;
                box-sizing: border-box;
            `;
            input.addEventListener('focus', () => {
                input.style.borderColor = 'var(--primary-color)';
                input.style.boxShadow = '0 0 0 3px rgba(66, 133, 244, 0.2)';
            });
            input.addEventListener('blur', () => {
                input.style.borderColor = '#d1d5db';
                input.style.boxShadow = 'none';
            });
            controlCol.append(label, input);
            return controlCol;
        },

        _createSelectControl(labelText, id, options, defaultValue = '') {
            const controlCol = document.createElement('div');
            controlCol.style.cssText = 'flex: 1;';
            const label = document.createElement('label');
            label.textContent = labelText;
            label.style.cssText = 'display:block; margin-bottom:5px; font-weight: 500; color: #333; font-size: 0.85rem;';
            const select = document.createElement('select');
            select.id = id;
            select.value = defaultValue;
            select.style.cssText = `
                width: 100%; padding: 8px 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 13px;
                background: white; color: #333;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                transition: all 0.2s ease;
                box-sizing: border-box;
            `;
            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.value === defaultValue) option.selected = true;
                select.appendChild(option);
            });
            select.addEventListener('focus', () => {
                select.style.borderColor = 'var(--primary-color)';
                select.style.boxShadow = '0 0 0 3px rgba(66, 133, 244, 0.2)';
            });
            select.addEventListener('blur', () => {
                select.style.borderColor = '#d1d5db';
                select.style.boxShadow = 'none';
            });
            controlCol.append(label, select);
            return controlCol;
        },

        _createLogger() {
            const log = document.createElement('div');
            log.id = 'pro-log';
            const height = this.currentPageType === this.PAGE_TYPES.JOB_LIST ? '200px' : '240px';
            log.style.cssText = `
                height: ${height}; overflow-y: auto; background: var(--secondary-color);
                border-radius: 12px; padding: 12px; font-size: 12.5px;
                line-height: 1.5; margin-bottom: 15px; margin-left: 10px;
                margin-right: 10px; transition: all 0.3s ease; user-select: text;
                border: 1px solid var(--accent-color);
            `;
            log.innerHTML = `
                <div style="color:var(--neutral-color); margin-bottom:8px;">
                    👋 欢迎使用BOSS海投助手增强版！<br>
                    支持：岗位/地点筛选 + 薪资/经验/学历/公司规模等高级筛选 + 排除关键词<br>
                    设置筛选条件后点击「启动海投」开始自动投递
                </div>
            `;
            return log;
        },

        _createFooter() {
            const footer = document.createElement('div');
            footer.style.cssText = `
                text-align: center; font-size: 0.75em; color: var(--neutral-color);
                padding-top: 12px; border-top: 1px solid var(--accent-color);
                margin-top: auto; padding: 12px;
            `;
            footer.textContent = '💼 BOSS海投助手 · 把繁琐交给代码，把希望留给自己';
            return footer;
        },

        _createTextButton(text, bgColor, onClick) {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.style.cssText = `
                width: 100%; max-width: 320px; padding: 12px 20px;
                background: ${bgColor}; color: #fff; border: none;
                border-radius: 10px; cursor: pointer; font-size: 15px;
                font-weight: 600; transition: all 0.3s ease;
                display: flex; justify-content: center; align-items: center;
                box-shadow: 0 4px 10px rgba(0,0,0,0.1);
            `;
            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateY(-2px)';
                btn.style.boxShadow = `0 6px 15px rgba(var(--primary-rgb), 0.3)`;
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.1)';
            });
            btn.addEventListener('click', onClick);
            return btn;
        },

        _createIconButton(icon, onClick, title) {
            const btn = document.createElement('button');
            btn.innerHTML = icon;
            btn.title = title;
            btn.style.cssText = `
                width: 32px; height: 32px; border-radius: 50%; border: none;
                background: var(--accent-color); cursor: pointer; font-size: 16px;
                transition: all 0.2s ease; display: flex;
                justify-content: center; align-items: center; color: var(--primary-color);
            `;
            btn.addEventListener('click', onClick);
            btn.addEventListener('mouseenter', () => {
                btn.style.backgroundColor = 'var(--primary-color)';
                btn.style.color = '#fff';
                btn.style.transform = 'scale(1.1)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.backgroundColor = 'var(--accent-color)';
                btn.style.color = 'var(--primary-color)';
                btn.style.transform = 'scale(1)';
            });
            return btn;
        },

        _makeDraggable(panel) {
            const header = panel.querySelector('.boss-header, .boss-chat-header');
            if (!header) return;
            header.style.cursor = 'move';
            let isDragging = false;
            let startX = 0, startY = 0;
            let initialX = 0, initialY = 0;

            header.addEventListener('mousedown', (e) => {
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = panel.getBoundingClientRect();
                initialX = rect.left;
                initialY = rect.top;
                panel.style.transition = 'none';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                panel.style.left = `${initialX + dx}px`;
                panel.style.top = `${initialY + dy}px`;
                panel.style.right = 'auto';
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    panel.style.transition = 'all 0.3s ease';
                }
            });
        },

        createMiniIcon() {
            elements.miniIcon = document.createElement('div');
            elements.miniIcon.style.cssText = `
                width: 48px; height: 48px; position: fixed; bottom: 40px;
                left: 40px; background: var(--primary-color); border-radius: 50%;
                box-shadow: 0 6px 16px rgba(var(--primary-rgb), 0.4);
                cursor: pointer; display: none; justify-content: center;
                align-items: center; color: #fff; z-index: 2147483647;
                transition: all 0.3s ease; font-size: 20px;
            `;
            elements.miniIcon.innerHTML = '💼';
            elements.miniIcon.addEventListener('mouseenter', () => {
                elements.miniIcon.style.transform = 'scale(1.1)';
                elements.miniIcon.style.boxShadow = `0 8px 20px rgba(var(--primary-rgb), 0.5)`;
            });
            elements.miniIcon.addEventListener('mouseleave', () => {
                elements.miniIcon.style.transform = 'scale(1)';
                elements.miniIcon.style.boxShadow = `0 6px 16px rgba(var(--primary-rgb), 0.4)`;
            });
            elements.miniIcon.addEventListener('click', () => {
                state.isMinimized = false;
                elements.panel.style.transform = 'translateY(0)';
                elements.miniIcon.style.display = 'none';
            });
            document.body.appendChild(elements.miniIcon);
        },

        _createSettingsDialog() {
            const dialog = document.createElement('div');
            dialog.id = 'boss-settings-dialog';
            dialog.style.cssText = `
                position: fixed; top: 50%; left: 50%;
                transform: translate(-50%, -50%);
                width: clamp(350px, 90vw, 560px);
                background: #ffffff; border-radius: 16px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.15);
                z-index: 999999; display: none;
                flex-direction: column; font-family: 'Segoe UI', sans-serif;
                overflow: hidden;
            `;
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 15px 20px; background: var(--primary-color);
                color: white; font-size: 18px; font-weight: 500;
                display: flex; justify-content: space-between; align-items: center;
            `;
            header.textContent = '海投助手设置';
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = `
                background: transparent; color: white; border: none;
                font-size: 18px; cursor: pointer; padding: 5px 10px;
            `;
            closeBtn.addEventListener('click', () => dialog.style.display = 'none');
            header.appendChild(closeBtn);

            // Tab 栏
            const tabBar = document.createElement('div');
            tabBar.style.cssText = `
                display: flex; border-bottom: 1px solid #e5e7eb;
                background: #f9fafb;
            `;
            const tabs = [
                { id: 'tab-basic', label: '⚙️ 基础设置' },
                { id: 'tab-resume', label: '📄 简历设置' },
                { id: 'tab-api', label: '🔑 API设置' }
            ];
            const tabPanes = {};
            let activeTab = 'tab-basic';

            tabs.forEach((tab, index) => {
                const tabBtn = document.createElement('button');
                tabBtn.textContent = tab.label;
                tabBtn.dataset.tab = tab.id;
                tabBtn.style.cssText = `
                    flex: 1; padding: 12px 16px; border: none;
                    background: transparent; cursor: pointer;
                    font-size: 14px; font-weight: 500;
                    color: ${index === 0 ? 'var(--primary-color)' : '#6b7280'};
                    border-bottom: 2px solid ${index === 0 ? 'var(--primary-color)' : 'transparent'};
                    transition: all 0.2s ease;
                `;
                tabBtn.addEventListener('click', () => {
                    // 切换tab
                    tabs.forEach(t => {
                        const btn = tabBar.querySelector(`[data-tab="${t.id}"]`);
                        if (t.id === tab.id) {
                            btn.style.color = 'var(--primary-color)';
                            btn.style.borderBottom = '2px solid var(--primary-color)';
                            tabPanes[t.id].style.display = 'block';
                        } else {
                            btn.style.color = '#6b7280';
                            btn.style.borderBottom = '2px solid transparent';
                            tabPanes[t.id].style.display = 'none';
                        }
                    });
                    activeTab = tab.id;
                });
                tabBar.appendChild(tabBtn);
            });

            // 基础设置面板
            const basicPane = document.createElement('div');
            basicPane.id = 'tab-basic-pane';
            basicPane.style.cssText = 'padding: 20px;';

            const roleLabel = document.createElement('label');
            roleLabel.textContent = 'AI 人设（聊天回复用）：';
            roleLabel.style.cssText = 'display:block; margin-bottom:8px; font-weight: 500; font-size: 14px;';

            // 一键预设：三条求职线各一套人设。
            // 点一下只是**填入文本框**，仍需点保存才生效 —— 避免误触直接改掉设置。
            const rolePresetRow = document.createElement('div');
            rolePresetRow.id = 'ai-role-presets';
            rolePresetRow.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;';

            const roleInput = document.createElement('textarea');
            roleInput.id = 'ai-role-input';
            roleInput.rows = 4;
            roleInput.value = localStorage.getItem('aiRole') || CONFIG.AI.DEFAULT_ROLE;
            roleInput.style.cssText = `
                width: 100%; padding: 10px; border-radius: 8px;
                border: 1px solid #d1d5db; resize: vertical; font-size: 14px;
                margin-bottom: 15px; box-sizing: border-box;
            `;

            (CONFIG.AI.ROLE_PRESETS || []).forEach((preset) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'role-preset-btn';
                b.dataset.presetKey = preset.key;
                b.textContent = preset.label;
                b.style.cssText = `
                    padding: 4px 10px; font-size: 12px; cursor: pointer;
                    border-radius: 12px; border: 1px solid #d1d5db;
                    background: #f9fafb; color: #374151;
                `;
                b.addEventListener('click', () => {
                    roleInput.value = preset.value;
                    b.style.background = '#dbeafe';
                    b.style.borderColor = '#2196f3';
                });
                rolePresetRow.appendChild(b);
            });

            const roleHint = document.createElement('div');
            roleHint.textContent = '↑ 点预设填入，再点下方「保存」生效';
            roleHint.style.cssText = 'font-size: 12px; color: #6b7280; margin: -10px 0 12px;';
            if (!(CONFIG.AI.ROLE_PRESETS || []).length) roleHint.style.display = 'none';

            const intervalLabel = document.createElement('label');
            intervalLabel.textContent = '基本间隔（毫秒）：';
            intervalLabel.style.cssText = 'display:block; margin-bottom:8px; font-weight: 500; font-size: 14px;';
            const intervalInput = document.createElement('input');
            intervalInput.type = 'number';
            intervalInput.min = '500';
            intervalInput.value = localStorage.getItem('basicInterval') || CONFIG.BASIC_INTERVAL;
            intervalInput.style.cssText = `
                width: 100%; padding: 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 14px;
                margin-bottom: 10px; box-sizing: border-box;
            `;

            basicPane.append(roleLabel, rolePresetRow, roleInput, roleHint, intervalLabel, intervalInput);
            tabPanes['tab-basic'] = basicPane;

            // 简历设置面板
            const resumePane = document.createElement('div');
            resumePane.id = 'tab-resume-pane';
            resumePane.style.cssText = 'padding: 20px; display: none; max-height: 50vh; overflow-y: auto;';

            const resumeTip = document.createElement('div');
            resumeTip.style.cssText = `
                background: #eff6ff; border: 1px solid #bfdbfe;
                border-radius: 8px; padding: 10px 12px;
                margin-bottom: 15px; font-size: 13px; color: #1e40af;
            `;
            resumeTip.innerHTML = '💡 上传PDF简历自动解析，或手动填写。AI会根据岗位JD+简历生成个性化打招呼语！';
            resumePane.appendChild(resumeTip);

            // PDF上传区域
            const uploadArea = document.createElement('div');
            uploadArea.style.cssText = `
                margin-bottom: 15px; padding: 20px;
                background: #f9fafb; border: 2px dashed #d1d5db;
                border-radius: 12px; text-align: center;
                cursor: pointer; transition: all 0.3s ease;
            `;
            uploadArea.innerHTML = `
                <div style="font-size: 28px; margin-bottom: 8px;">📄</div>
                <div style="font-size: 14px; color: #6b7280; font-weight: 500;">点击上传PDF简历</div>
                <div style="font-size: 12px; color: #9ca3af; margin-top: 4px;">AI自动解析姓名、技能、经验等</div>
            `;

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.pdf';
            fileInput.style.display = 'none';

            uploadArea.addEventListener('click', () => fileInput.click());
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = 'var(--primary-color)';
                uploadArea.style.background = '#eff6ff';
            });
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.style.borderColor = '#d1d5db';
                uploadArea.style.background = '#f9fafb';
            });
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = '#d1d5db';
                uploadArea.style.background = '#f9fafb';
                const file = e.dataTransfer.files[0];
                if (file && file.name.endsWith('.pdf')) {
                    handlePdfUpload(file);
                }
            });
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) handlePdfUpload(file);
            });

            const handlePdfUpload = async (file) => {
                uploadArea.innerHTML = '<div style="font-size:14px;color:var(--primary-color);">⏳ 正在解析...</div>';
                const parsed = await Core.parsePdfResume(file);

                // PDF 文本一旦提取成功就已存入 resume.rawText（在 parsePdfResume
                // 内部完成）。因此即使 AI 结构化失败，招呼语功能仍可用 ——
                // 这里据此给出准确反馈，避免用户误以为要手工重填。
                const rawLen = (Core.getResumeRawText() || '').length;

                if (parsed) {
                    // 填充到各个输入框
                    for (const key in resumeInputs) {
                        if (parsed[key]) {
                            resumeInputs[key].value = parsed[key];
                        }
                    }
                    uploadArea.innerHTML = `
                        <div style="font-size: 28px; margin-bottom: 8px;">✅</div>
                        <div style="font-size: 14px; color: #166534; font-weight: 500;">解析成功</div>
                        <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">${parsed.name || ''} | ${parsed.skills?.slice(0, 40) || ''}</div>
                        <div style="font-size: 12px; color: #166534; margin-top: 4px;">已保存简历全文 ${rawLen} 字符，打招呼语会据此定制</div>
                        <div style="font-size: 11px; color: #9ca3af; margin-top: 4px;">记得点「保存设置」</div>
                    `;
                } else if (rawLen > 0) {
                    // 关键分支：提取到文本但 AI 结构化失败
                    uploadArea.innerHTML = `
                        <div style="font-size: 28px; margin-bottom: 8px;">📄</div>
                        <div style="font-size: 14px; color: #92400e; font-weight: 500;">已读取简历正文（${rawLen} 字符）</div>
                        <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">
                            AI 结构化未成功（通常是未配置 API Key），<br>
                            但打招呼语仍会依据简历全文生成，无需手工重填。
                        </div>
                    `;
                } else {
                    uploadArea.innerHTML = `
                        <div style="font-size: 28px; margin-bottom: 8px;">📄</div>
                        <div style="font-size: 14px; color: #6b7280; font-weight: 500;">点击上传PDF简历</div>
                        <div style="font-size: 12px; color: #9ca3af; margin-top: 4px;">未能读取文本（可能是扫描件），请手动填写</div>
                    `;
                }
            };

            uploadArea.appendChild(fileInput);
            resumePane.appendChild(uploadArea);

            // ---- 粘贴简历文本 ----
            // parseTextResume 一直存在，但此前没有任何 UI 调用它。
            // 这导致两类用户无法提供简历：简历不是 PDF 的、以及
            // 未配置 API Key（无法用 AI 结构化）的。
            // 而招呼语的核心依赖是**简历全文**，并非结构化的那 7 个字段。
            const pasteLabel = document.createElement('label');
            pasteLabel.textContent = '或直接粘贴简历文本（推荐，最完整）：';
            pasteLabel.style.cssText = 'display:block; margin: 14px 0 6px; font-weight: 500; font-size: 13px;';

            const pasteArea = document.createElement('textarea');
            pasteArea.placeholder = '把简历正文整段粘贴到这里。\n'
                + '包含项目经历、技能、量化结果等 —— 打招呼语会从这里挑选与岗位匹配的证据。';
            pasteArea.rows = 5;
            pasteArea.style.cssText = `
                width: 100%; padding: 8px 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 13px; line-height: 1.5;
                box-sizing: border-box; resize: vertical; font-family: inherit;
            `;

            const pasteBtns = document.createElement('div');
            pasteBtns.style.cssText = 'display:flex; gap:8px; align-items:center; margin-top:8px;';

            const pasteSaveBtn = document.createElement('button');
            pasteSaveBtn.textContent = '💾 仅保存文本';
            pasteSaveBtn.style.cssText = `
                padding: 6px 14px; font-size: 12px; cursor: pointer;
                background: #eff6ff; color: #1d4ed8;
                border: 1px solid #bfdbfe; border-radius: 6px;
            `;

            const pasteAiBtn = document.createElement('button');
            pasteAiBtn.textContent = '🤖 保存并用AI解析字段';
            pasteAiBtn.style.cssText = `
                padding: 6px 14px; font-size: 12px; cursor: pointer;
                background: #f0fdf4; color: #166534;
                border: 1px solid #bbf7d0; border-radius: 6px;
            `;

            const pasteStatus = document.createElement('span');
            pasteStatus.style.cssText = 'font-size: 12px; color: #6b7280;';

            pasteSaveBtn.addEventListener('click', () => {
                const text = pasteArea.value.trim();
                if (text.length < 10) {
                    pasteStatus.style.color = '#991b1b';
                    pasteStatus.textContent = '内容太短';
                    return;
                }
                Core.saveResumeRawText(text);
                pasteStatus.style.color = '#166534';
                pasteStatus.textContent = `✅ 已保存 ${text.length} 字符，招呼语将据此定制`;
            });

            pasteAiBtn.addEventListener('click', async () => {
                const text = pasteArea.value.trim();
                if (text.length < 10) {
                    pasteStatus.style.color = '#991b1b';
                    pasteStatus.textContent = '内容太短';
                    return;
                }
                pasteStatus.style.color = '#6b7280';
                pasteStatus.textContent = '⏳ AI 解析中…';
                const parsed = await Core.parseTextResume(text);
                if (parsed) {
                    for (const key in resumeInputs) {
                        if (parsed[key]) resumeInputs[key].value = parsed[key];
                    }
                    pasteStatus.style.color = '#166534';
                    pasteStatus.textContent = '✅ 已保存全文并填充字段，记得点「保存设置」';
                } else {
                    // 文本已在 parseTextResume 内部保存，AI 失败不影响招呼语
                    pasteStatus.style.color = '#92400e';
                    pasteStatus.textContent = '⚠️ AI 解析未成功，但全文已保存，招呼语仍可用';
                }
            });

            pasteBtns.append(pasteSaveBtn, pasteAiBtn, pasteStatus);
            resumePane.append(pasteLabel, pasteArea, pasteBtns);

            // 回填已保存的全文
            const savedRaw = Core.getResumeRawText();
            if (savedRaw) pasteArea.value = savedRaw;

            const resumeFields = [
                { key: 'name', label: '姓名', placeholder: '如：张三', type: 'text' },
                { key: 'yearsOfExp', label: '工作年限', placeholder: '如：3年', type: 'text' },
                { key: 'education', label: '学历', placeholder: '如：本科', type: 'text' },
                { key: 'currentCompany', label: '当前/上家公司', placeholder: '如：字节跳动', type: 'text' },
                { key: 'targetPosition', label: '目标岗位', placeholder: '如：前端开发工程师', type: 'text' }
            ];

            const resumeInputs = {};

            // 一行两个
            for (let i = 0; i < resumeFields.length; i += 2) {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; gap: 10px; margin-bottom: 12px;';
                const fields = resumeFields.slice(i, i + 2);
                fields.forEach(field => {
                    const col = document.createElement('div');
                    col.style.cssText = 'flex: 1;';
                    const label = document.createElement('label');
                    label.textContent = field.label + '：';
                    label.style.cssText = 'display:block; margin-bottom:5px; font-weight: 500; font-size: 13px;';
                    const input = document.createElement('input');
                    input.type = field.type;
                    input.placeholder = field.placeholder;
                    input.value = state.resume[field.key] || '';
                    input.style.cssText = `
                        width: 100%; padding: 8px 10px; border-radius: 8px;
                        border: 1px solid #d1d5db; font-size: 14px;
                        box-sizing: border-box;
                    `;
                    resumeInputs[field.key] = input;
                    col.append(label, input);
                    row.appendChild(col);
                });
                resumePane.appendChild(row);
            }

            // 技能栈
            const skillsLabel = document.createElement('label');
            skillsLabel.textContent = '技能栈（逗号分隔）：';
            skillsLabel.style.cssText = 'display:block; margin-bottom:5px; font-weight: 500; font-size: 13px;';
            const skillsInput = document.createElement('input');
            skillsInput.placeholder = '如：React, Vue, TypeScript, Node.js';
            skillsInput.value = state.resume.skills || '';
            skillsInput.style.cssText = `
                width: 100%; padding: 8px 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 14px;
                margin-bottom: 12px; box-sizing: border-box;
            `;
            resumeInputs.skills = skillsInput;
            resumePane.append(skillsLabel, skillsInput);

            // 核心亮点
            const highlightLabel = document.createElement('label');
            highlightLabel.textContent = '核心亮点/项目经历（1-2句话）：';
            highlightLabel.style.cssText = 'display:block; margin-bottom:5px; font-weight: 500; font-size: 13px;';
            const highlightInput = document.createElement('textarea');
            highlightInput.rows = 3;
            highlightInput.placeholder = '如：主导过XX项目，日活XX万，擅长性能优化...';
            highlightInput.value = state.resume.highlight || '';
            highlightInput.style.cssText = `
                width: 100%; padding: 8px 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 14px;
                resize: vertical; box-sizing: border-box;
            `;
            resumeInputs.highlight = highlightInput;
            resumePane.append(highlightLabel, highlightInput);

            tabPanes['tab-resume'] = resumePane;

            // API设置面板
            const apiPane = document.createElement('div');
            apiPane.id = 'tab-api-pane';
            apiPane.style.cssText = 'padding: 20px; display: none; max-height: 50vh; overflow-y: auto;';

            const apiTip = document.createElement('div');
            apiTip.style.cssText = `
                background: #fffbeb; border: 1px solid #fcd34d;
                border-radius: 8px; padding: 10px 12px;
                margin-bottom: 15px; font-size: 13px; color: #92400e;
                line-height: 1.5;
            `;
            apiTip.innerHTML = `
                💡 <strong>配置自己的 API Key 后无使用次数限制</strong><br>
                支持所有兼容 OpenAI 格式的接口（如 DeepSeek、智谱、通义、Moonshot 等）<br>
                Key 只保存在你的浏览器本地，不会上传、也不会进入代码仓库
            `;
            apiPane.appendChild(apiTip);

            // API 地址
            const apiUrlLabel = document.createElement('label');
            apiUrlLabel.textContent = 'API 地址：';
            apiUrlLabel.style.cssText = 'display:block; margin-bottom:5px; font-weight: 500; font-size: 13px;';
            const apiUrlInput = document.createElement('input');
            apiUrlInput.type = 'text';
            apiUrlInput.placeholder = '如：https://api.deepseek.com/v1/chat/completions';
            apiUrlInput.value = localStorage.getItem('customApiUrl') || '';
            apiUrlInput.style.cssText = `
                width: 100%; padding: 8px 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 14px;
                margin-bottom: 12px; box-sizing: border-box;
            `;
            apiPane.append(apiUrlLabel, apiUrlInput);

            // API Key
            const apiKeyLabel = document.createElement('label');
            apiKeyLabel.textContent = 'API Key：';
            apiKeyLabel.style.cssText = 'display:block; margin-bottom:5px; font-weight: 500; font-size: 13px;';
            const apiKeyInput = document.createElement('input');
            apiKeyInput.type = 'password';
            apiKeyInput.placeholder = 'sk-xxxxxxxxxxxxxxxx';
            apiKeyInput.value = localStorage.getItem('customApiKey') || '';
            apiKeyInput.style.cssText = `
                width: 100%; padding: 8px 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 14px;
                margin-bottom: 12px; box-sizing: border-box;
            `;
            apiPane.append(apiKeyLabel, apiKeyInput);

            // 模型名称
            const modelLabel = document.createElement('label');
            modelLabel.textContent = '模型名称：';
            modelLabel.style.cssText = 'display:block; margin-bottom:5px; font-weight: 500; font-size: 13px;';
            const modelInput = document.createElement('input');
            modelInput.type = 'text';
            modelInput.placeholder = '如：deepseek-chat / gpt-3.5-turbo';
            modelInput.value = localStorage.getItem('customModel') || '';
            modelInput.style.cssText = `
                width: 100%; padding: 8px 10px; border-radius: 8px;
                border: 1px solid #d1d5db; font-size: 14px;
                margin-bottom: 15px; box-sizing: border-box;
            `;
            apiPane.append(modelLabel, modelInput);

            // 常用API预设
            const presetLabel = document.createElement('label');
            presetLabel.textContent = '快速填充（常用API）：';
            presetLabel.style.cssText = 'display:block; margin-bottom:8px; font-weight: 500; font-size: 13px;';
            apiPane.appendChild(presetLabel);

            const presets = [
                { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
                { name: '智谱AI', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
                { name: 'Moonshot', url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
                { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-turbo' },
                { name: '讯飞星火', url: 'https://spark-api-open.xf-yun.com/v1/chat/completions', model: 'generalv3.5' }
            ];

            const presetContainer = document.createElement('div');
            presetContainer.style.cssText = `
                display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;
            `;
            presets.forEach(preset => {
                const btn = document.createElement('button');
                btn.textContent = preset.name;
                btn.style.cssText = `
                    padding: 4px 10px; font-size: 12px;
                    background: #eff6ff; color: #1d4ed8;
                    border: 1px solid #bfdbfe; border-radius: 6px;
                    cursor: pointer; transition: all 0.2s;
                `;
                btn.addEventListener('mouseenter', () => {
                    btn.style.background = '#dbeafe';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.background = '#eff6ff';
                });
                btn.addEventListener('click', () => {
                    apiUrlInput.value = preset.url;
                    modelInput.value = preset.model;
                });
                presetContainer.appendChild(btn);
            });
            apiPane.appendChild(presetContainer);

            // 当前状态
            const statusDiv = document.createElement('div');
            statusDiv.style.cssText = `
                margin-top: 15px; padding: 10px;
                background: #f0fdf4; border: 1px solid #bbf7d0;
                border-radius: 8px; font-size: 13px; color: #166534;
            `;
            const updateStatus = () => {
                const hasCustom = apiUrlInput.value && apiKeyInput.value;
                // 共享回落 token 是否存在（来自 00a-local-config.js，可选文件）
                const local = (typeof __BH__ !== 'undefined' && __BH__.LOCAL_CONFIG) || {};
                const hasShared = !!local.SHARED_FALLBACK_TOKEN;

                if (hasCustom) {
                    statusDiv.style.background = '#f0fdf4';
                    statusDiv.style.borderColor = '#bbf7d0';
                    statusDiv.style.color = '#166534';
                    statusDiv.textContent = '✅ 使用你自己的 API Key，无次数限制';
                } else if (hasShared) {
                    statusDiv.style.background = '#fef3c7';
                    statusDiv.style.borderColor = '#fcd34d';
                    statusDiv.style.color = '#92400e';
                    statusDiv.textContent = `⚠️ 未填自己的 Key，当前回落到共享凭据，每日 ${CONFIG.AI.MAX_REPLIES_FREE} 次。建议填自己的 Key`;
                } else {
                    // 默认状态：代码中不含任何凭据，必须用户自己配置
                    statusDiv.style.background = '#fef2f2';
                    statusDiv.style.borderColor = '#fecaca';
                    statusDiv.style.color = '#991b1b';
                    statusDiv.textContent = '❌ 尚未配置 API Key，AI 回复与打招呼语不可用。请选择上方模板并填入自己的 Key';
                }
            };
            updateStatus();
            apiUrlInput.addEventListener('input', updateStatus);
            apiKeyInput.addEventListener('input', updateStatus);
            apiPane.appendChild(statusDiv);

            // ---- 测试连接 ----
            // 让用户填完 Key 立刻确认可用性，而不是等到投递时才发现失败。
            // 走与真实请求相同的 HTTP 路径（Core.testAIConnection →
            // Core._chatCompletion），因此报错信息有实际参考价值。
            const testBtn = document.createElement('button');
            testBtn.textContent = '🔌 测试连接';
            testBtn.style.cssText = `
                margin-top: 10px; padding: 8px 16px; font-size: 13px;
                background: #eff6ff; color: #1d4ed8;
                border: 1px solid #bfdbfe; border-radius: 8px; cursor: pointer;
            `;
            const testResult = document.createElement('div');
            testResult.style.cssText = `
                margin-top: 8px; padding: 8px 10px; border-radius: 8px;
                font-size: 12px; display: none; white-space: pre-wrap;
                font-family: Consolas, monospace; word-break: break-all;
            `;
            testBtn.addEventListener('click', async () => {
                const apiUrl = apiUrlInput.value.trim();
                const apiKey = apiKeyInput.value.trim();
                const model = modelInput.value.trim();

                testResult.style.display = 'block';
                testResult.style.background = '#eff6ff';
                testResult.style.color = '#1e40af';
                testResult.textContent = '⏳ 正在请求…';
                testBtn.disabled = true;

                try {
                    const reply = await Core.testAIConnection({ apiUrl, apiKey, model });
                    testResult.style.background = '#f0fdf4';
                    testResult.style.color = '#166534';
                    testResult.textContent = `✅ 连接成功，模型回复：${reply}`;
                } catch (err) {
                    testResult.style.background = '#fef2f2';
                    testResult.style.color = '#991b1b';
                    testResult.textContent = `❌ 连接失败：${err.message}`;
                } finally {
                    testBtn.disabled = false;
                }
            });
            apiPane.append(testBtn, testResult);

            tabPanes['tab-api'] = apiPane;

            // 内容容器
            const contentContainer = document.createElement('div');
            contentContainer.style.cssText = 'max-height: 60vh; overflow-y: auto;';
            contentContainer.append(basicPane, resumePane, apiPane);

            const footer = document.createElement('div');
            footer.style.cssText = `
                padding: 15px 20px; border-top: 1px solid #e5e7eb;
                display: flex; justify-content: flex-end; gap: 10px;
                background: var(--secondary-color);
            `;
            const cancelBtn = this._createTextButton('取消', '#9ca3af', () => dialog.style.display = 'none');
            cancelBtn.style.width = 'auto';
            cancelBtn.style.padding = '8px 20px';

            const saveBtn = this._createTextButton('保存设置', 'var(--primary-color)', () => {
                // 保存基础设置
                localStorage.setItem('aiRole', roleInput.value);
                localStorage.setItem('basicInterval', intervalInput.value);
                Core.basicInterval = parseInt(intervalInput.value);

                // 保存简历设置
                const resumeData = {};
                for (const key in resumeInputs) {
                    resumeData[key] = resumeInputs[key].value;
                }
                Core.saveResume(resumeData);

                // 保存API设置
                // 同时写 Override 键：Core.getAIConfig() 优先读取 Override，
                // 使新配置立即生效，无需刷新页面。
                const urlVal = apiUrlInput.value.trim();
                const keyVal = apiKeyInput.value.trim();
                const modelVal = modelInput.value.trim();
                localStorage.setItem('customApiUrl', urlVal);
                localStorage.setItem('customApiKey', keyVal);
                localStorage.setItem('customModel', modelVal);
                localStorage.setItem('customApiUrlOverride', urlVal);
                localStorage.setItem('customApiKeyOverride', keyVal);
                localStorage.setItem('customModelOverride', modelVal);

                dialog.style.display = 'none';
                alert('设置保存成功！');
            });
            saveBtn.style.width = 'auto';
            saveBtn.style.padding = '8px 20px';

            // 暴露输入控件与保存动作，供自动化测试驱动**真实的保存逻辑**。
            // 存在的理由：测试若自行复制一遍 setItem 调用，就无法发现
            // "生产代码漏写某个键"这类缺陷 —— 变异测试实测确认过该盲区
            // （变异14 未被捕获）。仅挂在 dialog 元素上，不进页面全局作用域。
            dialog.__testHooks = {
                save: () => saveBtn.click(),
                inputs: { roleInput, intervalInput, apiUrlInput, apiKeyInput, modelInput, resumeInputs },
            };

            footer.append(cancelBtn, saveBtn);
            dialog.append(header, tabBar, contentContainer, footer);
            return dialog;
        },

        _hexToRgb(hex) {
            hex = hex.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return `${r}, ${g}, ${b}`;
        }
    };

    __BH__.UI = UI;
})();
