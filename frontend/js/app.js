/**
 * FitQA - 运动健身智能问答系统 主逻辑
 * 连接 FastAPI 后端（ngrok 公网穿透）
 */

// ==================== API 配置 ====================
// 使用相对路径，确保通过任何方式访问（localhost/127.0.0.1/LAN IP/ngrok）都能正常请求
window.API_BASE_URL = '';

// ==================== 全局状态 ====================
var STATE = {
    currentTab: 'chat',
    sessions: [],
    currentSessionId: null,
    history: [],
    knowledgeCache: null,
    categoriesCache: null,
    knowledgeSort: 'index',
    backendHealthy: false,
    currentUser: null,
};

const TOKEN_KEY = 'fitqa_token';

window.getToken = function getToken() { return localStorage.getItem(TOKEN_KEY); }
window.setToken = function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
window.isLoggedIn = function isLoggedIn() { return !!STATE.currentUser; }
window.authHeaders = function authHeaders(extra) {
    const t = getToken();
    return t ? Object.assign({}, extra, { Authorization: `Bearer ${t}` }) : (extra || {});
};
var getToken = window.getToken;
var setToken = window.setToken;
var isLoggedIn = window.isLoggedIn;
var authHeaders = window.authHeaders;

// 动态添加运动记录卡片样式
(function addExerciseCardStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .exercise-panel .exercise-list { gap: 10px; }
        .exercise-panel .exercise-item {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            border-bottom: none;
            transition: all var(--transition);
        }
        .exercise-panel .exercise-item:hover {
            border-color: var(--primary);
            box-shadow: var(--shadow-sm);
        }
    `;
    document.head.appendChild(style);
})();

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initChat();
    initCompare();
    initSettings();
    initImport();
    initEntryModal();
    initAuthUI();
    initUnansweredUI();
    initTrainingPlanUI();
    initTrainingPlanTabUI();
    initHistoryDetailUI();
    initExerciseUI();
    await checkBackendHealth();
    if (STATE.backendHealthy) {
        await Promise.all([initKnowledge()]);
        await initAuth();
    } else {
        initKnowledgeFallback();
        initHistoryFallback();
    }
    initSuggestQuestions();
});

// ==================== 后端健康检查 ====================
async function checkBackendHealth() {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('apiStatusText');
    try {
        const resp = await fetch(`${API_BASE_URL}/health`);
        if (resp.ok) {
            const data = await resp.json();
            STATE.backendHealthy = true;
            STATE.healthData = data;
            statusDot.className = 'status-dot online';
            if (data.mock_mode) {
                statusText.textContent = '离线模式';
            } else {
                const activeModel = data.active_model;
                statusText.textContent = activeModel && activeModel.name ? activeModel.name : '大模型模式';
            }
            console.log('[FitQA] Backend connected:', data);
            return;
        }
        console.warn('[FitQA] Health check failed:', resp.status, resp.statusText);
    } catch (e) {
        console.warn('[FitQA] Backend unreachable:', e.message, 'URL:', `${API_BASE_URL}/health`);
    }
    STATE.backendHealthy = false;
    statusDot.className = 'status-dot offline';
    statusText.textContent = '离线';
}

// ==================== 用户认证 ====================
async function initAuth() {
    const token = getToken();
    if (token && STATE.backendHealthy) {
        try {
            const resp = await fetch(`${API_BASE_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (resp.ok) {
                STATE.currentUser = await resp.json();
            } else {
                setToken(null);
            }
        } catch (e) {
            setToken(null);
        }
    }
    applyAuthState();
    if (STATE.currentUser) {
        await loadSessionsFromBackend();
    } else {
        STATE.sessions = [];
        createSession();
    }
    renderSessionList();
    renderMessages();
    initHistory();
    loadTrainingPlans();
    loadExerciseRecordsInTraining();
    await refreshUserStatus();
}

function applyAuthState() {
    const btnLogin = document.getElementById('btnLogin');
    const userMenu = document.getElementById('userMenu');
    const userName = document.getElementById('userName');
    const historyTab = document.querySelector('[data-tab="history"]');
    if (STATE.currentUser) {
        if (btnLogin) btnLogin.classList.add('hidden');
        if (userMenu) userMenu.classList.remove('hidden');
        if (userName) userName.textContent = STATE.currentUser.username;
        if (historyTab) historyTab.style.display = '';
    } else {
        if (btnLogin) btnLogin.classList.remove('hidden');
        if (userMenu) userMenu.classList.add('hidden');
        if (historyTab) historyTab.style.display = 'none';
    }
    // 若设置弹窗已打开，刷新其内容（全局/个人切换）
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.classList.contains('active')) {
        loadSettings();
    }
}

async function refreshUserStatus() {
    if (!isLoggedIn()) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/config`, { headers: authHeaders() });
        if (resp.ok) {
            const cfg = await resp.json();
            const statusText = document.getElementById('apiStatusText');
            const statusDot = document.querySelector('.status-dot');
            if (cfg.is_mock) {
                if (statusText) statusText.textContent = '离线';
                if (statusDot) statusDot.className = 'status-dot offline';
            } else {
                if (statusText) statusText.textContent = cfg.model_name || '大模型模式';
                if (statusDot) statusDot.className = 'status-dot online';
            }
        }
    } catch (e) { /* 忽略 */ }
}

function openLoginModal(tab = 'login') {
    const modal = document.getElementById('loginModal');
    if (!modal) return;
    switchAuthTab(tab);
    modal.classList.add('active');
}

function closeLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) modal.classList.remove('active');
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.auth === tab));
    const mode = tab === 'login' ? 'login' : 'register';
    const submit = document.getElementById('btnAuthSubmit');
    if (submit) submit.textContent = mode === 'login' ? '登录' : '注册';
    const title = document.getElementById('loginModalTitle');
    if (title) title.textContent = mode === 'login' ? '登录' : '注册';
}

async function handleAuthSubmit() {
    const activeTab = document.querySelector('.auth-tab.active');
    const mode = activeTab && activeTab.dataset.auth === 'register' ? 'register' : 'login';
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;

    if (!username || !password) {
        showToast('请输入用户名和密码', 'error');
        return;
    }
    if (password.length < 6) {
        showToast('密码长度至少 6 位', 'error');
        return;
    }

    const btn = document.getElementById('btnAuthSubmit');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '提交中...';
    try {
        const resp = await fetch(`${API_BASE_URL}/auth/${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            showToast(data.detail || (mode === 'login' ? '登录失败' : '注册失败'), 'error');
            return;
        }
        setToken(data.token);
        STATE.currentUser = { id: data.user_id, username: data.username };
        closeLoginModal();
        applyAuthState();
        showToast(mode === 'login' ? '登录成功' : '注册成功，已自动登录', 'success');
        await loadSessionsFromBackend();
        renderSessionList();
        renderMessages();
        initHistory();
        loadTrainingPlans();
        loadExerciseRecordsInTraining();
        await refreshUserStatus();
    } catch (e) {
        showToast(`请求失败: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

async function handleLogout() {
    const token = getToken();
    if (token && STATE.backendHealthy) {
        try {
            await fetch(`${API_BASE_URL}/auth/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch (e) { /* 忽略 */ }
    }
    setToken(null);
    STATE.currentUser = null;
    applyAuthState();
    STATE.sessions = [];
    createSession();
    renderSessionList();
    renderMessages();
    initHistory();
    loadTrainingPlans();
    loadExerciseRecordsInTraining();
    if (STATE.backendHealthy) checkBackendHealth();
    showToast('已退出登录', 'info');
}

function requireLogin(fn) {
    if (!isLoggedIn()) {
        showToast('请先登录后使用该功能', 'error');
        openLoginModal();
        return false;
    }
    if (fn) fn();
    return true;
}

function initAuthUI() {
    const btnLogin = document.getElementById('btnLogin');
    const btnLogout = document.getElementById('btnLogout');
    const btnCloseLogin = document.getElementById('btnCloseLogin');
    const btnAuthSubmit = document.getElementById('btnAuthSubmit');
    const loginModal = document.getElementById('loginModal');

    if (btnLogin) btnLogin.addEventListener('click', () => openLoginModal('login'));
    if (btnLogout) btnLogout.addEventListener('click', handleLogout);
    if (btnCloseLogin) btnCloseLogin.addEventListener('click', closeLoginModal);
    if (btnAuthSubmit) btnAuthSubmit.addEventListener('click', handleAuthSubmit);
    if (loginModal) {
        loginModal.addEventListener('click', (e) => {
            if (e.target === loginModal) closeLoginModal();
        });
        const pwd = document.getElementById('authPassword');
        if (pwd) pwd.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
    }

    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => switchAuthTab(tab.dataset.auth));
    });
}

// ==================== 无法回答问题（需登录） ====================
function initUnansweredUI() {
    const btn = document.getElementById('btnUnanswered');
    const btnClose = document.getElementById('btnCloseUnanswered');
    const btnClear = document.getElementById('btnClearUnanswered');
    const modal = document.getElementById('unansweredModal');

    if (btn) btn.addEventListener('click', () => requireLogin(openUnansweredModal));
    if (btnClose) btnClose.addEventListener('click', () => modal && modal.classList.remove('active'));
    if (btnClear) btnClear.addEventListener('click', clearUnansweredQuestions);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
}

async function openUnansweredModal() {
    const modal = document.getElementById('unansweredModal');
    if (!modal) return;
    modal.classList.add('active');
    const list = document.getElementById('unansweredList');
    const countEl = document.getElementById('unansweredCount');
    list.innerHTML = '<div class="history-empty"><p>加载中...</p></div>';
    try {
        const data = await apiGet('/knowledge/unanswered');
        if (countEl) countEl.textContent = `共 ${data.length} 条`;
        if (!data || data.length === 0) {
            list.innerHTML = '<div class="history-empty"><p>暂无无法回答的问题记录</p></div>';
            return;
        }
        list.innerHTML = data.map(q => `
            <div class="unanswered-item">
                <div class="unanswered-q">${escapeHtml(q.question)}</div>
                <div class="unanswered-meta">模式：${q.mode} · 原因：${escapeHtml(q.reason || '未知')} · ${formatTime(new Date(q.created_at || Date.now()))}</div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="history-empty"><p>加载失败</p></div>';
    }
}

async function clearUnansweredQuestions() {
    if (!confirm('确定清空所有无法回答的问题记录吗？')) return;
    try {
        const data = await apiDelete('/knowledge/unanswered');
        showToast(data.message || '已清空', 'success');
        openUnansweredModal();
    } catch (e) {
        showToast('清空失败', 'error');
    }
}

// ==================== 训练计划生成 ====================
function initTrainingPlanUI() {
    const btnOpen = document.getElementById('btnTrainingPlan');
    const btnInline = document.getElementById('btnTrainingPlanInline');
    const btnClose = document.getElementById('btnCloseTrainingPlan');
    const btnGenerate = document.getElementById('btnGeneratePlan');
    const btnManageGoal = document.getElementById('btnPlanGoalManage');
    const modal = document.getElementById('trainingPlanModal');

    function openPlanModal() {
        if (!isLoggedIn()) {
            showToast('请先登录后再使用训练计划', 'error');
            openLoginModal();
            return;
        }
        if (modal) {
            document.getElementById('planGoal').value = '';
            document.getElementById('planLevel').value = '新手';
            document.getElementById('planDays').value = '4';
            document.getElementById('planRequirements').value = '';
            // 用知识库分类填充 datalist
            const dl = document.getElementById('planGoalList');
            if (dl) {
                const cats = (STATE.categoriesCache || []).map(c => c.category);
                dl.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
            }
            modal.classList.add('active');
        }
    }

    if (btnOpen) btnOpen.addEventListener('click', openPlanModal);
    if (btnInline) btnInline.addEventListener('click', openPlanModal);
    if (btnClose) btnClose.addEventListener('click', () => modal && modal.classList.remove('active'));
    if (btnGenerate) btnGenerate.addEventListener('click', generateTrainingPlan);
    if (btnManageGoal) btnManageGoal.addEventListener('click', () => {
        // 打开知识库分类管理
        if (modal) modal.classList.remove('active');
        const catBtn = document.querySelector('[data-tab="knowledge"]');
        if (catBtn) catBtn.click();
        // 触发知识库的分类管理弹窗
        setTimeout(() => {
            const btnCat = document.getElementById('btnManageCategories');
            if (btnCat) btnCat.click();
        }, 300);
    });
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
}

function generateTrainingPlan() {
    const goal = document.getElementById('planGoal')?.value?.trim() || '';
    const level = document.getElementById('planLevel')?.value || '新手';
    const days = document.getElementById('planDays')?.value || '';
    const requirements = document.getElementById('planRequirements')?.value?.trim() || '';

    if (!goal) { showToast('请填写训练目标', 'error'); return; }
    if (!days) { showToast('请填写每周训练天数', 'error'); return; }

    let question = `我是${level}，目标是${goal}，每周可以训练 ${days} 天。请根据知识库内容，为我制定一份一周训练计划，包含：每日训练部位、具体动作、每组次数与组数、组间休息和注意事项，并标注参考资料编号。`;
    if (requirements) {
        question += `\n额外要求：${requirements}`;
    }

    const modal = document.getElementById('trainingPlanModal');
    if (modal) modal.classList.remove('active');

    // 先切到聊天标签
    const chatBtn = document.querySelector('[data-tab="chat"]');
    if (chatBtn) chatBtn.click();

    // 在聊天中发送消息，完成后自动保存到训练计划库
    window._pendingPlanSave = { goal, level, days };
    const input = document.getElementById('chatInput');
    if (input) input.value = question;
    window.handleSendMessage();
}

async function autoSaveTrainingPlan(question, answer, planInfo) {
    try {
        const title = question;
        // 提取分类：从目标中推断
        const category = planInfo.goal || '通用';
        const res = await fetch('/training-plans', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({
                title: title,
                goal: planInfo.goal,
                level: planInfo.level,
                days_per_week: parseInt(planInfo.days) || 4,
                content: answer,
                category: category,
            }),
        });
        if (res.ok) {
            showToast('训练计划已自动保存', 'success');
            // 刷新训练计划列表
            loadTrainingPlans();
        } else {
            const err = await res.text();
            console.warn('自动保存训练计划失败:', err);
        }
    } catch (e) {
        console.warn('自动保存训练计划异常:', e);
    }
}
window.autoSaveTrainingPlan = autoSaveTrainingPlan;

// ==================== 训练计划板块 ====================
let currentTrainingSubtab = 'plans';

function initTrainingPlanTabUI() {
    loadTrainingPlans();

    // 子标签切换
    document.querySelectorAll('.training-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.training-subtab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTrainingSubtab = btn.dataset.subtab;
            exitTrainingBatchMode();
            const plansToolbar = document.getElementById('trainingPlansToolbar');
            const exercisesToolbar = document.getElementById('trainingExercisesToolbar');
            const trainingList = document.getElementById('trainingList');
            const exerciseList = document.getElementById('exerciseList');
            const exportWrapper = document.querySelector('.training-actions .export-wrapper');
            if (currentTrainingSubtab === 'plans') {
                trainingList.classList.remove('hidden');
                exerciseList.classList.add('hidden');
                plansToolbar.classList.remove('hidden');
                exercisesToolbar.classList.add('hidden');
                if (exportWrapper) exportWrapper.style.display = '';
                loadTrainingPlans();
            } else {
                trainingList.classList.add('hidden');
                exerciseList.classList.remove('hidden');
                plansToolbar.classList.add('hidden');
                exercisesToolbar.classList.remove('hidden');
                loadExerciseRecordsInTraining();
            }
        });
    });

    // 新增按钮
    document.getElementById('btnTrainingAdd')?.addEventListener('click', () => {
        if (!isLoggedIn()) {
            showToast('请先登录后使用', 'error');
            openLoginModal();
            return;
        }
        if (currentTrainingSubtab === 'plans') {
            openTrainingPlanEdit(null);
        } else {
            openExerciseModal();
        }
    });

    // 批量操作按钮
    document.getElementById('btnTrainingBatchOp')?.addEventListener('click', () => {
        if (!isLoggedIn()) {
            showToast('请先登录后使用', 'error');
            return;
        }
        document.body.classList.add('training-batch-mode');
        document.getElementById('trainingBatchBar').classList.remove('hidden');
        updateTrainingBatchCount();
    });

    // 取消批量操作
    document.getElementById('btnCancelTrainingBatch')?.addEventListener('click', exitTrainingBatchMode);

    // 全选
    document.getElementById('trainingCheckAll')?.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const selector = currentTrainingSubtab === 'plans'
            ? '#trainingList .training-item-check input'
            : '#exerciseList .exercise-card-check input';
        document.querySelectorAll(selector).forEach(cb => cb.checked = checked);
        updateTrainingBatchCount();
    });

    // 批量删除
    document.getElementById('btnConfirmBatchDeleteTraining')?.addEventListener('click', async () => {
        const ids = getTrainingBatchSelectedIds();
        if (ids.length === 0) {
            showToast('请先选择要删除的记录', 'warning');
            return;
        }
        if (!confirm(`确定删除选中的 ${ids.length} 条记录？`)) return;
        try {
            const url = currentTrainingSubtab === 'plans'
                ? '/training-plans/batch-delete'
                : '/exercise/records/batch-delete';
            const res = await fetch(url, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                body: JSON.stringify({ ids }),
            });
            if (!res.ok) throw new Error(await res.text());
            showToast(`已删除 ${ids.length} 条记录`, 'success');
            exitTrainingBatchMode();
            if (currentTrainingSubtab === 'plans') loadTrainingPlans(); else loadExerciseRecordsInTraining();
        } catch (e) {
            showToast('删除失败: ' + e.message, 'error');
        }
    });

    // 批量编辑
    document.getElementById('btnBatchEditTraining')?.addEventListener('click', () => {
        const ids = getTrainingBatchSelectedIds();
        if (ids.length === 0) {
            showToast('请先选择要编辑的记录', 'warning');
            return;
        }
        if (currentTrainingSubtab === 'plans') {
            document.getElementById('trainingBatchEditCount').textContent = ids.length;
            document.getElementById('trainingBatchEditModal').classList.add('active');
        } else {
            document.getElementById('exerciseBatchEditCount').textContent = ids.length;
            document.getElementById('exerciseBatchEditModal').classList.add('active');
        }
    });

    // 训练计划搜索
    let trainingSearchTimer;
    document.getElementById('trainingSearch')?.addEventListener('input', () => {
        clearTimeout(trainingSearchTimer);
        trainingSearchTimer = setTimeout(loadTrainingPlans, 300);
    });

    // 训练计划筛选
    document.getElementById('trainingGoalFilter')?.addEventListener('change', loadTrainingPlans);
    document.getElementById('trainingLevelFilter')?.addEventListener('change', loadTrainingPlans);
    document.getElementById('trainingDaysFilter')?.addEventListener('change', loadTrainingPlans);
    document.getElementById('trainingDateFrom')?.addEventListener('change', loadTrainingPlans);
    document.getElementById('trainingDateTo')?.addEventListener('change', loadTrainingPlans);

    // 运动记录搜索
    let exerciseSearchTimer;
    document.getElementById('exerciseSearch')?.addEventListener('input', () => {
        clearTimeout(exerciseSearchTimer);
        exerciseSearchTimer = setTimeout(loadExerciseRecordsInTraining, 300);
    });

    // 运动记录筛选
    document.getElementById('exerciseTypeFilter')?.addEventListener('change', loadExerciseRecordsInTraining);
    document.getElementById('exerciseDurationFilter')?.addEventListener('change', loadExerciseRecordsInTraining);
    document.getElementById('exerciseIntensityFilter')?.addEventListener('change', loadExerciseRecordsInTraining);
    document.getElementById('exerciseDateFrom')?.addEventListener('change', loadExerciseRecordsInTraining);
    document.getElementById('exerciseDateTo')?.addEventListener('change', loadExerciseRecordsInTraining);

    // 导出（训练计划/运动记录共用）
    document.getElementById('btnExportTrainingPlan')?.addEventListener('click', () => {
        document.getElementById('trainingExportDropdown').classList.toggle('hidden');
    });
    document.querySelectorAll('#trainingExportDropdown .export-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.getElementById('trainingExportDropdown').classList.add('hidden');
            if (currentTrainingSubtab === 'plans') {
                await exportTrainingPlans(btn.dataset.format);
            } else {
                await exportExerciseRecords(btn.dataset.format);
            }
        });
    });

    document.addEventListener('click', (e) => {
        const wrapper = document.querySelector('.training-actions .export-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            document.getElementById('trainingExportDropdown')?.classList.add('hidden');
        }
    });

    // 训练计划编辑弹窗 - 保存
    document.getElementById('btnSaveTrainingPlan')?.addEventListener('click', saveTrainingPlanEdit);

    // 训练计划编辑弹窗 - 关闭
    document.getElementById('btnCloseTrainingPlanEdit')?.addEventListener('click', () => {
        document.getElementById('trainingPlanEditModal').classList.remove('active');
    });
    document.getElementById('trainingPlanEditModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('trainingPlanEditModal')) {
            document.getElementById('trainingPlanEditModal').classList.remove('active');
        }
    });

    // 训练计划详情弹窗 - 关闭
    document.getElementById('btnCloseTrainingPlanDetail')?.addEventListener('click', () => {
        document.getElementById('trainingPlanDetailModal').classList.remove('active');
    });
    document.getElementById('btnCloseTrainingPlanDetailFooter')?.addEventListener('click', () => {
        document.getElementById('trainingPlanDetailModal').classList.remove('active');
    });
    document.getElementById('trainingPlanDetailModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('trainingPlanDetailModal')) {
            document.getElementById('trainingPlanDetailModal').classList.remove('active');
        }
    });

    // 训练计划详情弹窗 - 编辑
    document.getElementById('btnEditFromDetail')?.addEventListener('click', () => {
        const modal = document.getElementById('trainingPlanDetailModal');
        const id = parseInt(modal?.dataset.planId);
        if (id) {
            modal?.classList.remove('active');
            openTrainingPlanEdit(id);
        }
    });

    // 训练计划详情弹窗 - 删除
    document.getElementById('btnDeleteFromDetail')?.addEventListener('click', async () => {
        const modal = document.getElementById('trainingPlanDetailModal');
        const id = parseInt(modal?.dataset.planId);
        if (!id || !confirm('确定删除该训练计划？')) return;
        try {
            const res = await fetch('/training-plans/' + id, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(await res.text());
            modal?.classList.remove('active');
            showToast('删除成功', 'success');
            loadTrainingPlans();
        } catch (e) {
            showToast('删除失败: ' + e.message, 'error');
        }
    });

    // 批量编辑训练计划
    document.getElementById('btnCloseTrainingBatchEdit')?.addEventListener('click', () => {
        document.getElementById('trainingBatchEditModal').classList.remove('active');
    });
    document.getElementById('trainingBatchEditModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('trainingBatchEditModal')) {
            document.getElementById('trainingBatchEditModal').classList.remove('active');
        }
    });
    document.getElementById('btnSaveTrainingBatchEdit')?.addEventListener('click', saveTrainingBatchEdit);

    // 批量编辑运动记录
    document.getElementById('btnCloseExerciseBatchEdit')?.addEventListener('click', () => {
        document.getElementById('exerciseBatchEditModal').classList.remove('active');
    });
    document.getElementById('exerciseBatchEditModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('exerciseBatchEditModal')) {
            document.getElementById('exerciseBatchEditModal').classList.remove('active');
        }
    });
    document.getElementById('btnSaveExerciseBatchEdit')?.addEventListener('click', saveExerciseBatchEdit);
}

function getTrainingBatchSelectedIds() {
    const selector = currentTrainingSubtab === 'plans'
        ? '#trainingList .training-item-check input:checked'
        : '#exerciseList .exercise-card-check input:checked';
    return [...document.querySelectorAll(selector)].map(cb => parseInt(cb.value)).filter(n => !isNaN(n));
}

function exitTrainingBatchMode() {
    document.body.classList.remove('training-batch-mode');
    document.getElementById('trainingBatchBar').classList.add('hidden');
    document.getElementById('trainingCheckAll').checked = false;
    document.querySelectorAll('#trainingList .training-item-check input, #exerciseList .exercise-card-check input').forEach(cb => cb.checked = false);
    updateTrainingBatchCount();
}

async function updateTrainingGoalFilter() {
    try {
        const data = await fetch('/training-plans?limit=500', { headers: authHeaders() }).then(r => r.json());
        const goalFilter = document.getElementById('trainingGoalFilter');
        if (!goalFilter || !data || !Array.isArray(data)) return;
        const currentVal = goalFilter.value;
        const goals = [...new Set(data.map(p => p.goal).filter(Boolean))].sort();
        goalFilter.innerHTML = '<option value="">训练目标</option>' +
            goals.map(g => `<option value="${escapeHtml(g)}"${g === currentVal ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('');
    } catch (e) { /* 忽略 */ }
}

function loadTrainingPlans() {
    const list = document.getElementById('trainingList');
    if (!list) return;
    if (!isLoggedIn()) {
        list.innerHTML = '<div class="training-empty"><p>请先登录后查看训练计划</p></div>';
        return;
    }

    // 动态更新训练目标筛选选项
    updateTrainingGoalFilter();

    const keyword = document.getElementById('trainingSearch')?.value || '';
    const goal = document.getElementById('trainingGoalFilter')?.value || '';
    const level = document.getElementById('trainingLevelFilter')?.value || '';
    const days = document.getElementById('trainingDaysFilter')?.value || '';
    const dateFrom = document.getElementById('trainingDateFrom')?.value || '';
    const dateTo = document.getElementById('trainingDateTo')?.value || '';

    let url = '/training-plans?limit=100';
    if (keyword) url += '&keyword=' + encodeURIComponent(keyword);
    if (goal) url += '&goal=' + encodeURIComponent(goal);
    if (level) url += '&level=' + encodeURIComponent(level);
    if (days) url += '&days_per_week=' + encodeURIComponent(days);
    if (dateFrom) url += '&date_from=' + encodeURIComponent(dateFrom);
    if (dateTo) url += '&date_to=' + encodeURIComponent(dateTo);

    fetch(url, { headers: authHeaders() })
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(data => {
            if (!Array.isArray(data)) {
                throw new Error('服务器返回了意外的数据格式');
            }
            if (data.length === 0) {
                list.innerHTML = '<div class="training-empty"><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="14" y="6" width="20" height="36" rx="4" stroke="#999" stroke-width="2"/><line x1="14" y1="14" x2="34" y2="14" stroke="#999" stroke-width="2"/><line x1="18" y1="22" x2="30" y2="22" stroke="#999" stroke-width="1.5"/><line x1="18" y1="28" x2="30" y2="28" stroke="#999" stroke-width="1.5"/><line x1="18" y1="34" x2="26" y2="34" stroke="#999" stroke-width="1.5"/></svg><p>暂无训练计划，点击"新增"按钮或前往智能问答界面生成训练计划</p></div>';
                return;
            }

            list.innerHTML = data.map(function(p) {
                const preview = (p.content || p.goal || '').substring(0, 200);
                const time = formatDateTime(p.created_at) || '';
                return '<div class="training-item" data-id="' + p.id + '">' +
                    '<div class="training-item-check"><input type="checkbox" value="' + p.id + '"></div>' +
                    '<div class="training-item-body">' +
                    '<div class="ti-title">' + escapeHtml(p.title || '训练计划 #' + p.id) + '</div>' +
                    '<div class="ti-meta">' +
                    (p.category ? '<span>📁 ' + escapeHtml(p.category) + '</span>' : '') +
                    (p.level ? '<span>📊 ' + escapeHtml(p.level) + '</span>' : '') +
                    (p.goal ? '<span>🎯 ' + escapeHtml(p.goal) + '</span>' : '') +
                    (p.days_per_week ? '<span>📅 每周 ' + p.days_per_week + ' 天</span>' : '') +
                    '<span>🕐 ' + time + '</span>' +
                    '</div>' +
                    (preview ? '<div class="ti-preview">' + escapeHtml(preview) + '</div>' : '') +
                    '</div>' +
                    '<div class="ti-actions">' +
                    '<button class="btn btn-ghost btn-xs ti-edit" title="编辑" data-id="' + p.id + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
                    '<button class="btn btn-ghost btn-xs ti-delete" title="删除" data-id="' + p.id + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                    '</div>' +
                    '</div>';
            }).join('');

            list.querySelectorAll('.training-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.closest('.training-item-check') || e.target.closest('.ti-actions')) return;
                    if (document.body.classList.contains('training-batch-mode')) return;
                    const id = parseInt(el.dataset.id);
                    showTrainingPlanDetail(id);
                });
            });

            list.querySelectorAll('.ti-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = parseInt(btn.dataset.id);
                    openTrainingPlanEdit(id);
                });
            });

            list.querySelectorAll('.ti-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = parseInt(btn.dataset.id);
                    if (!confirm('确定删除该训练计划？')) return;
                    try {
                        const res = await fetch('/training-plans/' + id, {
                            method: 'DELETE',
                            headers: authHeaders(),
                        });
                        if (!res.ok) throw new Error(await res.text());
                        showToast('删除成功', 'success');
                        loadTrainingPlans();
                    } catch (e) {
                        showToast('删除失败: ' + e.message, 'error');
                    }
                });
            });

            list.querySelectorAll('.training-item-check input').forEach(cb => {
                cb.addEventListener('change', updateTrainingBatchCount);
            });
        })
        .catch(e => {
            list.innerHTML = '<div class="training-empty"><p>加载失败: ' + escapeHtml(e.message) + '</p></div>';
        });
}

function updateTrainingBatchCount() {
    const ids = getTrainingBatchSelectedIds();
    document.getElementById('trainingBatchCount').textContent = '已选 ' + ids.length + ' 项';
}

function showTrainingPlanDetail(id) {
    fetch('/training-plans/' + id, { headers: authHeaders() })
        .then(r => r.json())
        .then(p => {
            document.getElementById('detailPlanTitle').textContent = p.title || '训练计划详情';
            document.getElementById('tpDetailMeta').innerHTML =
                (p.category ? '<span>📁 ' + escapeHtml(p.category) + '</span>' : '') +
                (p.level ? '<span>📊 ' + escapeHtml(p.level) + '</span>' : '') +
                (p.goal ? '<span>🎯 ' + escapeHtml(p.goal) + '</span>' : '') +
                (p.days_per_week ? '<span>📅 每周 ' + p.days_per_week + ' 天</span>' : '') +
                '<span>🕐 ' + formatDateTime(p.created_at) + '</span>' +
                (p.updated_at !== p.created_at ? '<span>✏️ 更新于 ' + formatDateTime(p.updated_at) + '</span>' : '');
            document.getElementById('tpDetailContent').textContent = p.content || p.goal || '暂无内容';
            document.getElementById('trainingPlanDetailModal').dataset.planId = p.id;
            document.getElementById('trainingPlanDetailModal').classList.add('active');
        })
        .catch(e => showToast('加载详情失败: ' + e.message, 'error'));
}

function openTrainingPlanEdit(id) {
    if (id) {
        fetch('/training-plans/' + id, { headers: authHeaders() })
            .then(r => r.json())
            .then(p => {
                document.getElementById('editPlanId').value = p.id;
                document.getElementById('editPlanTitle').value = p.title || '';
                document.getElementById('editPlanGoal').value = p.goal || '';
                document.getElementById('editPlanLevel').value = p.level || '新手';
                document.getElementById('editPlanDays').value = p.days_per_week || 4;
                document.getElementById('editPlanCategory').value = p.category || '';
                document.getElementById('editPlanContent').value = p.content || '';
                document.getElementById('trainingPlanEditTitle').textContent = '编辑训练计划';
                document.getElementById('trainingPlanEditModal').classList.add('active');
            })
            .catch(e => showToast('加载失败: ' + e.message, 'error'));
    } else {
        document.getElementById('editPlanId').value = '';
        document.getElementById('editPlanTitle').value = '';
        document.getElementById('editPlanGoal').value = '';
        document.getElementById('editPlanLevel').value = '新手';
        document.getElementById('editPlanDays').value = '4';
        document.getElementById('editPlanCategory').value = '';
        document.getElementById('editPlanContent').value = '';
        document.getElementById('trainingPlanEditTitle').textContent = '新增训练计划';
        document.getElementById('trainingPlanEditModal').classList.add('active');
    }
}

async function saveTrainingPlanEdit() {
    const id = document.getElementById('editPlanId')?.value;
    const title = document.getElementById('editPlanTitle')?.value?.trim() || '';
    const goal = document.getElementById('editPlanGoal')?.value?.trim() || '';
    const level = document.getElementById('editPlanLevel')?.value || '新手';
    const days = parseInt(document.getElementById('editPlanDays')?.value) || 0;
    const category = document.getElementById('editPlanCategory')?.value || '';
    const content = document.getElementById('editPlanContent')?.value?.trim() || '';

    if (!title) { showToast('请填写计划标题', 'error'); return; }
    if (!goal) { showToast('请填写训练目标', 'error'); return; }
    if (!days) { showToast('请填写每周训练天数', 'error'); return; }
    if (!content) { showToast('请填写计划内容', 'error'); return; }

    try {
        const url = id ? '/training-plans/' + id : '/training-plans';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method: method,
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ title, goal, level, days_per_week: days, content, category }),
        });
        if (!res.ok) throw new Error(await res.text());
        showToast(id ? '训练计划已更新' : '训练计划已创建', 'success');
        document.getElementById('trainingPlanEditModal')?.classList.remove('active');
        loadTrainingPlans();
    } catch (e) {
        showToast('保存失败: ' + e.message, 'error');
    }
}

async function saveTrainingBatchEdit() {
    const ids = getTrainingBatchSelectedIds();
    if (ids.length === 0) return;
    const goal = document.getElementById('batchEditGoal')?.value || '';
    const level = document.getElementById('batchEditLevel')?.value || '';
    const days = parseInt(document.getElementById('batchEditDays')?.value) || 0;
    const category = document.getElementById('batchEditCategory')?.value || '';

    if (!goal && !level && !days && !category) {
        showToast('请至少选择一项要修改的字段', 'warning');
        return;
    }

    try {
        const res = await fetch('/training-plans/batch-update', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ ids, goal, level, days_per_week: days, category }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        showToast(data.message || '批量更新成功', 'success');
        document.getElementById('trainingBatchEditModal').classList.remove('active');
        exitTrainingBatchMode();
        loadTrainingPlans();
    } catch (e) {
        showToast('批量更新失败: ' + e.message, 'error');
    }
}

async function saveExerciseBatchEdit() {
    const ids = getTrainingBatchSelectedIds();
    if (ids.length === 0) return;
    const exerciseType = document.getElementById('batchEditExerciseType')?.value || '';
    const intensity = document.getElementById('batchEditExerciseIntensity')?.value || '';
    const duration = parseInt(document.getElementById('batchEditExerciseDuration')?.value) || 0;

    if (!exerciseType && !intensity && !duration) {
        showToast('请至少选择一项要修改的字段', 'warning');
        return;
    }

    try {
        let updated = 0;
        for (const id of ids) {
            const body = {};
            if (exerciseType) body.exercise_type = exerciseType;
            if (intensity) body.intensity = intensity;
            if (duration) body.duration = duration;
            const res = await fetch('/exercise/records/' + id, {
                method: 'PUT',
                headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                body: JSON.stringify(body),
            });
            if (res.ok) updated++;
        }
        showToast(`已更新 ${updated} 条记录`, 'success');
        document.getElementById('exerciseBatchEditModal').classList.remove('active');
        exitTrainingBatchMode();
        loadExerciseRecordsInTraining();
    } catch (e) {
        showToast('批量更新失败: ' + e.message, 'error');
    }
}

async function exportTrainingPlans(format) {
    if (!isLoggedIn()) {
        showToast('请先登录后导出', 'error');
        return;
    }
    try {
        const res = await fetch('/training-plans/export?format=' + format, {
            headers: authHeaders(),
        });
        if (!res.ok) {
            if (format === 'pdf' || format === 'docx') {
                showToast('PDF/Word 格式暂不支持，已导出为文本格式', 'info');
                const txtRes = await fetch('/training-plans/export?format=txt', { headers: authHeaders() });
                if (!txtRes.ok) throw new Error(await txtRes.text());
                const blob = await txtRes.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'training-plans.txt';
                a.click();
                URL.revokeObjectURL(url);
                return;
            }
            throw new Error(await res.text());
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'training-plans.' + (format === 'docx' ? 'docx' : format);
        a.click();
        URL.revokeObjectURL(url);
        showToast('导出成功', 'success');
    } catch (e) {
        showToast('导出失败: ' + e.message, 'error');
    }
}

async function exportExerciseRecords(format) {
    if (!isLoggedIn()) {
        showToast('请先登录后导出', 'error');
        return;
    }
    try {
        const data = await apiGet('/exercise/records?limit=500');
        if (!data || data.length === 0) {
            showToast('暂无运动记录可导出', 'info');
            return;
        }
        let content, filename, type;
        if (format === 'json') {
            content = JSON.stringify(data, null, 2);
            filename = 'exercise-records.json';
            type = 'application/json';
        } else if (format === 'csv') {
            const header = '运动类型,时长(分钟),强度,日期,备注';
            const rows = data.map(r => `"${r.exercise_type}","${r.duration}","${r.intensity}","${r.record_date}","${(r.notes || '').replace(/"/g, '""')}"`);
            content = '\uFEFF' + header + '\n' + rows.join('\n');
            filename = 'exercise-records.csv';
            type = 'text/csv;charset=utf-8';
        } else if (format === 'markdown') {
            const lines = data.map(r => `- **${r.record_date}** | ${r.exercise_type} | ${r.duration}分钟 | ${r.intensity}${r.notes ? ' | ' + r.notes : ''}`);
            content = '# 运动记录\n\n' + lines.join('\n');
            filename = 'exercise-records.md';
            type = 'text/markdown';
        } else if (format === 'pdf' || format === 'docx') {
            const textLines = data.map(r => `${r.record_date}  |  ${r.exercise_type}  |  ${r.duration}分钟  |  ${r.intensity}${r.notes ? '  |  ' + r.notes : ''}`);
            const textContent = '运动记录\n\n' + textLines.join('\n');
            content = textContent;
            filename = 'exercise-records.txt';
            type = 'text/plain';
            showToast('已导出为文本格式（PDF/Word 需后端支持）', 'info');
        } else {
            const lines = data.map(r => `${r.record_date} | ${r.exercise_type} | ${r.duration}分钟 | ${r.intensity}${r.notes ? ' | ' + r.notes : ''}`);
            content = lines.join('\n');
            filename = 'exercise-records.txt';
            type = 'text/plain';
        }
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showToast('导出成功', 'success');
    } catch (e) {
        showToast('导出失败: ' + e.message, 'error');
    }
}

// ==================== 问答历史详情 ====================
function initHistoryDetailUI() {
    const modal = document.getElementById('historyDetailModal');
    if (!modal) return;

    document.getElementById('btnCloseHistoryDetail')?.addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('btnCloseHistoryDetailFooter')?.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
}

function showHistoryDetail(question, answer, meta, sources) {
    const modal = document.getElementById('historyDetailModal');
    if (!modal) return;
    document.getElementById('hdQuestion').textContent = question || '';
    document.getElementById('hdAnswer').innerHTML = formatMessage(answer || '');
    document.getElementById('hdMeta').textContent = meta || '';

    const sourcesContainer = document.getElementById('hdSources');
    if (sourcesContainer) {
        if (sources && sources.length > 0) {
            sourcesContainer.innerHTML = sources.map((s, i) => {
                const title = s.title || '未知来源';
                const category = s.category ? `<span class="hd-source-category">${escapeHtml(s.category)}</span>` : '';
                const score = s.score ? `<span class="hd-source-score">相关度: ${(s.score * 100).toFixed(0)}%</span>` : '';
                const snippet = s.snippet ? `<div class="hd-source-snippet">${escapeHtml(s.snippet).substring(0, 150)}${s.snippet.length > 150 ? '...' : ''}</div>` : '';
                return `<div class="hd-source-item">
                    <span class="hd-source-index">[${i + 1}]</span>
                    <span class="hd-source-title">${escapeHtml(title)}</span>
                    ${category}${score}
                    ${snippet}
                </div>`;
            }).join('');
            sourcesContainer.style.display = 'block';
        } else {
            sourcesContainer.innerHTML = '<div class="hd-source-empty">无参考资料来源</div>';
            sourcesContainer.style.display = 'block';
        }
    }

    modal.classList.add('active');
}

// ==================== 运动记录 ====================
async function updateExerciseTypeFilter() {
    try {
        const data = await apiGet('/exercise/records?limit=500');
        const typeFilter = document.getElementById('exerciseTypeFilter');
        if (!typeFilter || !data) return;
        const currentVal = typeFilter.value;
        const types = [...new Set(data.map(r => r.exercise_type).filter(Boolean))].sort();
        typeFilter.innerHTML = '<option value="">运动类型</option>' +
            types.map(t => `<option value="${escapeHtml(t)}"${t === currentVal ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
    } catch (e) { /* 忽略 */ }
}

function openExerciseModal() {
    const modal = document.getElementById('exerciseModal');
    if (modal) {
        delete modal.dataset.editId;
        document.getElementById('exType').value = '';
        document.getElementById('exDuration').value = '';
        document.getElementById('exIntensity').value = '中等';
        document.getElementById('exDate').value = new Date().toISOString().slice(0, 10);
        document.getElementById('exNotes').value = '';
        document.getElementById('btnSaveExercise').textContent = '保存记录';
        modal.classList.add('active');
    }
}

function initExerciseUI() {
    const btnOpen = document.getElementById('btnExerciseRecord');
    const btnClose = document.getElementById('btnCloseExercise');
    const btnSave = document.getElementById('btnSaveExercise');
    const modal = document.getElementById('exerciseModal');

    if (btnOpen) btnOpen.addEventListener('click', () => {
        if (!isLoggedIn()) {
            showToast('请先登录后再使用运动记录', 'error');
            openLoginModal();
            return;
        }
        if (modal) {
            delete modal.dataset.editId;
            document.getElementById('exType').value = '';
            document.getElementById('exDuration').value = '';
            document.getElementById('exIntensity').value = '中等';
            document.getElementById('exDate').value = new Date().toISOString().slice(0, 10);
            document.getElementById('exNotes').value = '';
            document.getElementById('btnSaveExercise').textContent = '保存记录';
            modal.classList.add('active');
        }
    });
    if (btnClose) btnClose.addEventListener('click', () => {
        if (modal) {
            delete modal.dataset.editId;
            modal.classList.remove('active');
        }
    });
    const btnCloseFooter = document.getElementById('btnCloseExerciseFooter');
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', () => {
        if (modal) {
            delete modal.dataset.editId;
            modal.classList.remove('active');
        }
    });
    if (btnSave) btnSave.addEventListener('click', addExerciseRecord);
    if (modal) modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            delete modal.dataset.editId;
            modal.classList.remove('active');
        }
    });
    initExerciseDetailUI();
}

async function addExerciseRecord() {
    const type = document.getElementById('exType').value.trim();
    const duration = parseInt(document.getElementById('exDuration').value) || 0;
    const intensity = document.getElementById('exIntensity').value;
    const date = document.getElementById('exDate').value;
    const notes = document.getElementById('exNotes').value.trim();
    const modal = document.getElementById('exerciseModal');
    const editId = modal?.dataset.editId;

    if (!type) { showToast('请输入运动类型', 'error'); return; }
    try {
        if (editId) {
            await fetch('/exercise/records/' + editId, {
                method: 'PUT',
                headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
                body: JSON.stringify({
                    exercise_type: type,
                    duration,
                    intensity,
                    notes,
                    record_date: date,
                }),
            });
            showToast('运动记录已更新', 'success');
            delete modal.dataset.editId;
            document.getElementById('btnSaveExercise').textContent = '保存记录';
        } else {
            await apiPost('/exercise/records', {
                exercise_type: type,
                duration,
                intensity,
                notes,
                record_date: date,
            });
            showToast('运动记录已添加', 'success');
        }
        document.getElementById('exType').value = '';
        document.getElementById('exDuration').value = '';
        document.getElementById('exNotes').value = '';
        if (modal) modal.classList.remove('active');
        await loadExerciseRecordsInTraining();
    } catch (e) {
        showToast('保存失败: ' + e.message, 'error');
    }
}

async function deleteExerciseRecord(id) {
    if (!confirm('确定删除这条运动记录吗？')) return;
    try {
        await apiDelete(`/exercise/records/${id}`);
        showToast('记录已删除', 'info');
        await loadExerciseRecordsInTraining();
    } catch (e) { /* apiDelete 已 showToast */ }
}

function showExerciseDetail(id, records) {
    const record = records.find(r => r.id === id);
    if (!record) return;
    document.getElementById('exDetailType').textContent = record.exercise_type || '-';
    document.getElementById('exDetailDuration').textContent = (record.duration || 0) + ' 分钟';
    document.getElementById('exDetailIntensity').textContent = record.intensity || '-';
    document.getElementById('exDetailDate').textContent = record.record_date || '-';
    document.getElementById('exDetailNotes').textContent = record.notes || '无';
    const detailModal = document.getElementById('exerciseDetailModal');
    detailModal.dataset.recordId = id;
    detailModal.classList.add('active');
}

function initExerciseDetailUI() {
    const detailModal = document.getElementById('exerciseDetailModal');
    const btnClose = document.getElementById('btnCloseExerciseDetail');
    const btnCloseFooter = document.getElementById('btnCloseExerciseDetailFooter');
    const btnEdit = document.getElementById('btnEditFromExDetail');
    const btnDelete = document.getElementById('btnDeleteFromExDetail');

    const closeDetail = () => { if (detailModal) detailModal.classList.remove('active'); };
    if (btnClose) btnClose.addEventListener('click', closeDetail);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeDetail);
    if (detailModal) detailModal.addEventListener('click', (e) => { if (e.target === detailModal) closeDetail(); });

    if (btnEdit) btnEdit.addEventListener('click', () => {
        const id = parseInt(detailModal?.dataset.recordId);
        closeDetail();
        openExerciseEditFromDetail(id);
    });
    if (btnDelete) btnDelete.addEventListener('click', async () => {
        const id = parseInt(detailModal?.dataset.recordId);
        if (!confirm('确定删除这条运动记录吗？')) return;
        try {
            await apiDelete(`/exercise/records/${id}`);
            showToast('记录已删除', 'info');
            closeDetail();
            await loadExerciseRecordsInTraining();
        } catch (e) { /* apiDelete 已 showToast */ }
    });
}

function openExerciseEditFromDetail(id) {
    const modal = document.getElementById('exerciseModal');
    if (!modal) return;
    apiGet('/exercise/records?limit=100').then(data => {
        const record = data.find(r => r.id === id);
        if (!record) return;
        modal.dataset.editId = id;
        document.getElementById('exType').value = record.exercise_type || '';
        document.getElementById('exDuration').value = record.duration || '';
        document.getElementById('exIntensity').value = record.intensity || '中等';
        document.getElementById('exDate').value = record.record_date || '';
        document.getElementById('exNotes').value = record.notes || '';
        document.getElementById('btnSaveExercise').textContent = '更新记录';
        modal.classList.add('active');
    });
}

async function loadExerciseRecordsInTraining() {
    const list = document.getElementById('exerciseList');
    if (!list) return;
    if (!isLoggedIn()) {
        list.innerHTML = '<div class="training-empty"><p>请先登录后查看运动记录</p></div>';
        return;
    }

    // 动态更新运动类型筛选选项
    await updateExerciseTypeFilter();

    const keyword = document.getElementById('exerciseSearch')?.value || '';
    const exerciseType = document.getElementById('exerciseTypeFilter')?.value || '';
    const durationRange = document.getElementById('exerciseDurationFilter')?.value || '';
    const intensity = document.getElementById('exerciseIntensityFilter')?.value || '';
    const dateFrom = document.getElementById('exerciseDateFrom')?.value || '';
    const dateTo = document.getElementById('exerciseDateTo')?.value || '';

    let url = '/exercise/records?limit=100';
    if (keyword) url += '&keyword=' + encodeURIComponent(keyword);
    if (exerciseType) url += '&exercise_type=' + encodeURIComponent(exerciseType);
    if (intensity) url += '&intensity=' + encodeURIComponent(intensity);
    if (durationRange) {
        const parts = durationRange.split('-');
        if (parts[0]) url += '&duration_min=' + parts[0];
        if (parts[1]) url += '&duration_max=' + parts[1];
    }
    if (dateFrom) url += '&date_from=' + encodeURIComponent(dateFrom);
    if (dateTo) url += '&date_to=' + encodeURIComponent(dateTo);

    try {
        const data = await fetch(url, { headers: authHeaders() }).then(r => r.json());
        if (!data || data.length === 0) {
            list.innerHTML = '<div class="training-empty"><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="#999" stroke-width="2" fill="none"/><path d="M24 16v8l6 4" stroke="#999" stroke-width="2" fill="none"/></svg><p>暂无运动记录，点击"新增"按钮或前往智能问答界面添加运动记录</p></div>';
            return;
        }
        list.innerHTML = data.map(r => `
            <div class="exercise-card" data-id="${r.id}">
                <div class="exercise-card-check"><input type="checkbox" value="${r.id}"></div>
                <div class="exercise-card-body">
                    <div class="exercise-card-main">
                        <span class="exercise-card-type">${escapeHtml(r.exercise_type)}</span>
                        <span class="exercise-card-duration">${r.duration}分钟</span>
                        <span class="exercise-card-intensity">${escapeHtml(r.intensity)}</span>
                    </div>
                    <div class="exercise-card-meta">
                        <span class="exercise-card-date">${escapeHtml(r.record_date)}</span>
                        ${r.notes ? `<span class="exercise-card-notes">${escapeHtml(r.notes)}</span>` : ''}
                    </div>
                </div>
                <div class="exercise-card-actions">
                    <button class="btn btn-ghost btn-xs ex-edit" title="编辑" data-id="${r.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-xs ex-delete" title="删除" data-id="${r.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `).join('');

        list.querySelectorAll('.exercise-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.exercise-card-check') || e.target.closest('.exercise-card-actions')) return;
                if (document.body.classList.contains('training-batch-mode')) return;
                showExerciseDetail(parseInt(card.dataset.id), data);
            });
        });

        list.querySelectorAll('.ex-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                openExerciseEditFromDetail(id);
            });
        });

        list.querySelectorAll('.ex-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(btn.dataset.id);
                if (!confirm('确定删除这条运动记录？')) return;
                try {
                    await apiDelete(`/exercise/records/${id}`);
                    showToast('记录已删除', 'info');
                    loadExerciseRecordsInTraining();
                } catch (e) { /* apiDelete 已 showToast */ }
            });
        });

        list.querySelectorAll('.exercise-card-check input').forEach(cb => {
            cb.addEventListener('change', updateTrainingBatchCount);
        });
    } catch (e) {
        list.innerHTML = '<div class="training-empty"><p>加载失败: ' + escapeHtml(e.message) + '</p></div>';
    }
}

function openExerciseEdit(id) {
    fetch('/exercise/records?limit=1', { headers: authHeaders() })
        .then(() => {
            const modal = document.getElementById('exerciseModal');
            if (!modal) return;
            modal.dataset.editId = id;
            modal.classList.add('active');
            loadExerciseRecordsForEdit(id);
        });
}

async function loadExerciseRecordsForEdit(id) {
    try {
        const data = await apiGet('/exercise/records?limit=100');
        const record = data.find(r => r.id === id);
        if (record) {
            document.getElementById('exType').value = record.exercise_type || '';
            document.getElementById('exDuration').value = record.duration || '';
            document.getElementById('exIntensity').value = record.intensity || '中等';
            document.getElementById('exDate').value = record.record_date || '';
            document.getElementById('exNotes').value = record.notes || '';
            document.getElementById('btnSaveExercise').textContent = '更新记录';
        }
        loadExerciseRecords();
    } catch (e) {
        console.warn('加载运动记录详情失败:', e);
    }
}

// ==================== 网络请求封装 ====================
async function apiGet(path) {
    try {
        const resp = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        showToast(`网络请求失败: ${e.message}`, 'error');
        throw e;
    }
}

function clearAuthStateSilently() {
    if (!isLoggedIn()) return;
    setToken(null);
    STATE.currentUser = null;
    applyAuthState();
    showToast('登录凭证已失效，请重新登录', 'info');
}

window.apiPost = async function apiPost(path, body) {
    try {
        const resp = await fetch(`${API_BASE_URL}${path}`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            if (resp.status === 422) {
                try {
                    const detail = JSON.parse(text).detail;
                    const fieldNameMap = {
                        notes: '备注', exercise_type: '运动类型', duration: '时长',
                        intensity: '强度', record_date: '日期',
                        title: '标题', category: '分类', source: '来源',
                        question: '问题', username: '用户名', password: '密码',
                        goal: '训练目标', level: '经验水平',
                    };
                    const errors = (Array.isArray(detail) ? detail : [detail]).map(d => {
                        const field = (d.loc || []).slice(-1)[0] || '未知字段';
                        const limit = (d.ctx || {}).limit_value || (d.ctx || {}).max_length || '';
                        const cnName = fieldNameMap[field] || field;
                        const msgMap = {
                            'notes': `备注超过字数限制（最多${limit}字）`,
                            'exercise_type': `运动类型超过字数限制（最多${limit}字）`,
                            'duration': '时长格式不正确',
                            'intensity': '强度格式不正确',
                            'record_date': '日期格式不正确',
                        };
                        return msgMap[field] || `${cnName}输入不符合要求`;
                    });
                    if (errors.length) {
                        showToast(errors.join('；'), 'error');
                        throw new Error('VALIDATION_ERROR');
                    }
                } catch (parseErr) {
                    if (parseErr.message === 'VALIDATION_ERROR') throw parseErr;
                }
            }
            throw new Error(`HTTP ${resp.status} - ${text.substring(0, 200)}`);
        }
        return await resp.json();
    } catch (e) {
        if (e.message !== 'VALIDATION_ERROR') {
            showToast(`网络请求失败: ${e.message}`, 'error');
        }
        throw e;
    }
}
var apiPost = window.apiPost;

async function apiDelete(path, query) {
    try {
        let url = `${API_BASE_URL}${path}`;
        if (query) {
            const qs = Object.entries(query)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`)
                .join('&');
            if (qs) url += `?${qs}`;
        }
        const resp = await fetch(url, { method: 'DELETE', headers: authHeaders() });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        showToast(`网络请求失败: ${e.message}`, 'error');
        throw e;
    }
}

// ==================== 导航切换 ====================
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    STATE.currentTab = tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'training') {
        if (currentTrainingSubtab === 'exercises') {
            loadExerciseRecordsInTraining();
        } else {
            loadTrainingPlans();
        }
    }
    if (tab === 'history') {
        initHistory();
    }
}

// ==================== Toast 提示 ====================
window.showToast = function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
var showToast = window.showToast;

// ==================== 聊天功能 ====================
function initChat() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('btnSend');
    const newChatBtn = document.getElementById('btnNewChat');

    if (STATE.sessions.length === 0) {
        createSession();
    } else {
        STATE.currentSessionId = STATE.sessions[0].id;
    }
    renderSessionList();

    sendBtn.addEventListener('click', function() {
        if (sendBtn.classList.contains('streaming')) {
            if (window.stopStreaming) window.stopStreaming();
        } else {
            window.handleSendMessage();
        }
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            window.handleSendMessage();
        }
    });
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    newChatBtn.addEventListener('click', () => createSession());
}

window.createSession = async function createSession() {
    let session;
    if (isLoggedIn() && STATE.backendHealthy) {
        try {
            const data = await apiPost('/sessions', { title: '新对话' });
            session = { id: String(data.id), title: '新对话', messages: [], remote: true };
        } catch (e) {
            session = { id: Date.now().toString(), title: '新对话', messages: [], remote: false };
        }
    } else {
        session = { id: Date.now().toString(), title: '新对话', messages: [], remote: false };
    }
    STATE.sessions.unshift(session);
    STATE.currentSessionId = session.id;
    renderSessionList();
    renderMessages();
};
var createSession = window.createSession;

window.getCurrentSession = function getCurrentSession() {
    return STATE.sessions.find(s => s.id === STATE.currentSessionId);
};
var getCurrentSession = window.getCurrentSession;

window.renderSessionList = function renderSessionList() {
    const list = document.getElementById('chatSessionList');
    if (!list) return;
    if (STATE.sessions.length === 0) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = STATE.sessions.map(s => `
        <div class="session-item ${s.id === STATE.currentSessionId ? 'active' : ''}" data-id="${s.id}">
            <span class="session-title">${escapeHtml(s.title)}</span>
            <span class="session-delete" data-action="delete" title="删除对话">
                <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.5"/></svg>
            </span>
        </div>
    `).join('');

    list.querySelectorAll('.session-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            if (e.target.closest('[data-action="delete"]')) {
                deleteSession(item.dataset.id);
                return;
            }
            STATE.currentSessionId = item.dataset.id;
            renderSessionList();
            await loadCurrentSessionMessages();
            renderMessages();
        });
    });
}
var renderSessionList = window.renderSessionList;

async function loadCurrentSessionMessages() {
    const session = getCurrentSession();
    if (!session || !session.remote || !isLoggedIn()) return;
    try {
        const data = await apiGet(`/sessions/${session.id}/messages`);
        session.messages = (data || []).map(m => ({
            role: m.role,
            content: m.content,
            sources: m.sources || [],
            time: formatTime(new Date(m.created_at || Date.now())),
        }));
    } catch (e) {
        /* 加载失败忽略 */
    }
}

async function loadSessionsFromBackend() {
    if (!STATE.backendHealthy) return;
    try {
        const data = await apiGet('/sessions');
        const sessions = (data || []).map(s => ({
            id: String(s.id),
            title: s.title || '新对话',
            messages: [],
            remote: true,
        }));
        if (sessions.length > 0) {
            STATE.sessions = sessions;
            STATE.currentSessionId = sessions[0].id;
        } else {
            STATE.sessions = [];
            await createSession();
        }
    } catch (e) {
        STATE.sessions = [];
        createSession();
    }
}

async function deleteSession(id) {
    const session = STATE.sessions.find(s => s.id === id);
    if (session && session.remote && isLoggedIn() && STATE.backendHealthy) {
        try {
            await apiDelete(`/sessions/${id}`);
        } catch (e) { /* 忽略 */ }
    }
    STATE.sessions = STATE.sessions.filter(s => s.id !== id);
    if (STATE.currentSessionId === id) {
        STATE.currentSessionId = STATE.sessions.length > 0 ? STATE.sessions[0].id : null;
        if (!STATE.currentSessionId) createSession();
    }
    renderSessionList();
    renderMessages();
    showToast('对话已删除', 'info');
}

window.renderMessages = function renderMessages() {
    const container = document.getElementById('chatMessages');
    const session = getCurrentSession();

    if (!session || session.messages.length === 0) {
        container.innerHTML = `
            <div class="chat-welcome">
                <div class="welcome-icon">
                    <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
                        <rect x="3" y="10" width="4" height="12" rx="1.5" stroke="#4A9E6B" stroke-width="2.5"/>
                        <rect x="9" y="7" width="4" height="18" rx="1.5" stroke="#4A9E6B" stroke-width="2.5"/>
                        <line x1="13" y1="16" x2="19" y2="16" stroke="#4A9E6B" stroke-width="2.5" stroke-linecap="round"/>
                        <rect x="19" y="7" width="4" height="18" rx="1.5" stroke="#4A9E6B" stroke-width="2.5"/>
                        <rect x="25" y="10" width="4" height="12" rx="1.5" stroke="#4A9E6B" stroke-width="2.5"/>
                    </svg>
                </div>
                <h2>欢迎使用 FitQA</h2>
                <p>我是你的智能健身教练助手，可以回答关于减脂、增肌、力量训练、运动损伤预防等问题。</p>
                <div class="suggest-questions">
                    <span>试试这些问题：</span>
                    <button class="suggest-btn" data-question="新手增肌训练一周几次比较合适？">新手增肌训练一周几次比较合适？</button>
                    <button class="suggest-btn" data-question="如何正确做杠铃深蹲？">如何正确做杠铃深蹲？</button>
                    <button class="suggest-btn" data-question="减脂期饮食应该怎么安排？">减脂期饮食应该怎么安排？</button>
                    <button class="suggest-btn" data-question="跑步膝盖疼是什么原因？">跑步膝盖疼是什么原因？</button>
                    <button class="suggest-btn" data-question="增肌人群每天应摄入多少蛋白质？">增肌人群每天应摄入多少蛋白质？</button>
                    <button class="suggest-btn" data-question="运动前应该怎么热身？">运动前应该怎么热身？</button>
                </div>
            </div>
        `;
        initSuggestQuestions();
        return;
    }

    container.innerHTML = session.messages.map((m, idx) => {
    const isLastAssistant = m.role === 'assistant' && idx === session.messages.length - 1;
    return `
        <div class="message ${m.role}">
            <div class="message-avatar">${m.role === 'user' ? 'U' : 'AI'}</div>
            <div>
                <div class="message-bubble">${formatMessage(m.content, m.sources)}</div>
                <div class="message-time">${m.time}${m.cached ? ' <span class="cache-badge" title="该回答来自缓存，响应速度更快">⚡ 缓存</span>' : ''}</div>
                ${isLastAssistant ? `<button class="message-retry-btn" onclick="retryLastMessage()"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,4 4,1 7,4"/><path d="M4,1 C7,1 12,4 13,8 C14,12 11,15 8,15"/></svg> 重新回答</button>` : ''}
            </div>
        </div>
    `;
}).join('');

    container.scrollTop = container.scrollHeight;
}
var renderMessages = window.renderMessages;

function inlineFormat(text) {
    let t = escapeHtml(text);
    // 行内代码
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 加粗
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 斜体
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 【】加粗
    t = t.replace(/【(.+?)】/g, '<strong>【$1】</strong>');
    t = t.replace(/\[([A-Z]?\d+)\]/g, '<a class="ref-link" href="#source-$1" title="跳转到参考资料$1">[$1]</a>');
    return t;
}

function renderMarkdownTable(rows) {
    const parseRow = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
    const cells = rows.map(parseRow);
    if (cells.length === 0) return '';
    let header = cells[0];
    let body = cells.slice(1);
    // 第二行为分隔行（如 |---|:---:|）时跳过
    if (body.length > 0 && /^[\s:|-]+$/.test(body[0].join(''))) {
        body = body.slice(1);
    }
    let html = '<table><thead><tr>';
    header.forEach(h => { html += `<th>${inlineFormat(h)}</th>`; });
    html += '</tr></thead><tbody>';
    body.forEach(row => {
        html += '<tr>';
        row.forEach(c => { html += `<td>${inlineFormat(c)}</td>`; });
        html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
}

function formatMessage(content, sources) {
    const lines = (content || '').split('\n');
    let html = '';
    let listOpen = null;
    let inCodeBlock = false;
    let codeLines = [];

    const closeList = () => {
        if (listOpen) { html += `</${listOpen}>`; listOpen = null; }
    };

    // 列表内缩进补充行（如 AI 生成的"依据[1]…"续行）：追加到当前列表项，不关闭列表
    const appendToCurrentLi = (text) => {
        if (html.endsWith('</li>')) {
            html = html.slice(0, -5) + `<div class="li-cont">${inlineFormat(text)}</div></li>`;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 代码块
        if (/^\s*```/.test(line)) {
            closeList();
            if (inCodeBlock) {
                html += `<pre><code>${codeLines.join('\n')}</code></pre>`;
                codeLines = [];
                inCodeBlock = false;
            } else {
                inCodeBlock = true;
            }
            continue;
        }
        if (inCodeBlock) {
            codeLines.push(escapeHtml(line));
            continue;
        }

        // 表格：收集连续表格行
        if (/^\s*\|(.+)\|\s*$/.test(line)) {
            closeList();
            const rows = [];
            while (i < lines.length && /^\s*\|(.+)\|\s*$/.test(lines[i])) {
                rows.push(lines[i]);
                i++;
            }
            i--;
            html += renderMarkdownTable(rows);
            continue;
        }

        // 标题
        const hMatch = line.match(/^\s*(#{1,4})\s+(.+)$/);
        if (hMatch) {
            closeList();
            const level = hMatch[1].length;
            html += `<h${level}>${inlineFormat(hMatch[2])}</h${level}>`;
            continue;
        }

        // 引用
        const quoteMatch = line.match(/^\s*>\s?(.*)$/);
        if (quoteMatch) {
            closeList();
            html += `<blockquote>${inlineFormat(quoteMatch[1])}</blockquote>`;
            continue;
        }

        // 无序列表
        const ulMatch = line.match(/^\s*[-•*]\s+(.+)$/);
        // 有序列表
        const olMatch = line.match(/^\s*(\d+)[.、)]\s*(.+)$/);

        if (ulMatch) {
            if (listOpen !== 'ul') {
                closeList();
                listOpen = 'ul';
                html += '<ul>';
            }
            html += `<li>${inlineFormat(ulMatch[1])}</li>`;
        } else if (olMatch) {
            if (listOpen !== 'ol') {
                closeList();
                listOpen = 'ol';
                html += '<ol>';
            }
            html += `<li>${inlineFormat(olMatch[2])}</li>`;
        } else {
            // 含有引用编号的续行（如"依据[1]…"），追加到当前列表项，不关闭列表
            if (listOpen && /\[([A-Z]?\d+)\]/.test(line)) {
                html += `<div class="li-cont">${inlineFormat(line)}</div>`;
            } else {
                closeList();
                html += line ? inlineFormat(line) : '<br>';
            }
        }
    }
    closeList();
    if (inCodeBlock) {
        html += `<pre><code>${codeLines.join('\n')}</code></pre>`;
    }

    if (sources && sources.length > 0) {
        html += '<div class="reference-section">';
        html += '<div class="reference-materials"><strong>参考资料：</strong>';
        sources.forEach((s) => {
            html += '<span class="ref-id">[' + escapeHtml(s.id) + ']</span>';
        });
        html += '</div>';
        html += '<div class="reference-sources"><strong>参考来源：</strong>';
        sources.forEach((s) => {
            const hasUrl = s.url && s.url.trim();
            html += '<div class="source-item" id="source-' + escapeHtml(s.id) + '">';
            if (hasUrl) {
                html += '<span class="source-id">' + escapeHtml(s.id) + '</span>: ';
                html += '<a href="' + s.url + '" target="_blank" rel="noopener" class="source-link">' + escapeHtml(s.title) + '</a>';
            } else {
                html += '<span class="source-id">' + escapeHtml(s.id) + '</span>: ';
                html += '<span class="source-title">' + escapeHtml(s.title) + '</span>';
            }
            html += '</div>';
        });
        html += '</div></div>';
    }

    if (content.includes('风险提示') || content.includes('免责') || content.includes('咨询医生')) {
        html += '<div class="risk-note">风险提示：本回答仅作为知识科普参考，不构成专业医疗建议。涉及伤病问题请咨询专业医生或教练。</div>';
    }

    return html;
}

function initSuggestQuestions() {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.removeEventListener('click', handleSuggestClick);
    container.addEventListener('click', handleSuggestClick);
}

function handleSuggestClick(e) {
    const btn = e.target.closest('.suggest-btn');
    if (!btn) return;
    const question = btn.dataset.question;
    document.getElementById('chatInput').value = question;
    handleSendMessage();
}

window.handleSendMessage = async function handleSendMessage() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    if (!question) return;

    const modeRadio = document.querySelector('input[name="searchMode"]:checked');
    const mode = modeRadio ? modeRadio.value : 'hybrid';

    if (!getCurrentSession()) await createSession();

    const session = getCurrentSession();
    // 多轮上下文：取当前会话最近 6 轮（不含刚提交的这条）
    const history = session.messages.slice(-6).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
    }));

    const userMsg = {
        role: 'user',
        content: question,
        time: formatTime(new Date()),
    };
    session.messages.push(userMsg);

    if (session.messages.length === 1 || session.title === '新对话') {
        session.title = question.length > 20 ? question.substring(0, 20) + '...' : question;
        if (session.remote && isLoggedIn()) {
            // 标题由后端在 /ask 时更新；本地同步
        }
    }

    input.value = '';
    input.style.height = 'auto';
    renderSessionList();
    renderMessages();

    const container = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="message-bubble">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;

    let answer, sources, cached = false;

    if (STATE.backendHealthy) {
        try {
            const body = { question, mode, history, scene: window.currentScene };
            if (window._skipCache) {
                body.skip_cache = true;
                window._skipCache = false;
            }
            if (session.remote && isLoggedIn()) body.session_id = session.id;
            const data = await apiPost('/ask', body);
            answer = data.answer;
            sources = data.sources;
            cached = data.cached || false;
        } catch (e) {
            answer = `请求失败：${e.message}\n\n当前请求地址：${API_BASE_URL}/ask\n页面地址：${window.location.href}`;
            sources = [];
        }
    } else {
        answer = `后端服务不可用（健康检查未通过）。\n\n请确认后端已启动：python3 -m uvicorn main:app --host 0.0.0.0 --port 8000`;
        sources = [];
    }

    typingDiv.remove();

    const assistantMsg = {
        role: 'assistant',
        content: answer,
        sources: sources,
        cached: cached,
        time: formatTime(new Date()),
    };
    session.messages.push(assistantMsg);
    renderMessages();

    // 自动保存训练计划（从生成计划入口来的）
    if (window._pendingPlanSave) {
        const planInfo = window._pendingPlanSave;
        window._pendingPlanSave = null;
        autoSaveTrainingPlan(question, answer, planInfo);
    }

    if (STATE.backendHealthy && isLoggedIn()) {
        loadHistoryFromBackend();
    }
}
var handleSendMessage = window.handleSendMessage;

// 重新回答：移除最后一条 assistant 消息，重新发送用户问题（跳过缓存）
window.retryLastMessage = function retryLastMessage() {
    const session = getCurrentSession();
    if (!session || session.messages.length < 2) return;

    // 找到最后一条 user 消息
    let lastUserIdx = -1;
    for (let i = session.messages.length - 1; i >= 0; i--) {
        if (session.messages[i].role === 'user') {
            lastUserIdx = i;
            break;
        }
    }
    if (lastUserIdx === -1) return;

    // 移除最后一条 assistant 消息（如果有）
    if (session.messages.length > lastUserIdx + 1) {
        session.messages = session.messages.slice(0, lastUserIdx + 1);
    }

    // 设置跳过缓存标记
    window._skipCache = true;

    // 重新发送
    const question = session.messages[lastUserIdx].content;
    const input = document.getElementById('chatInput');
    if (input) input.value = question;
    window.handleSendMessage();
};
var retryLastMessage = window.retryLastMessage;

// ==================== 检索对比面板 ====================
function initCompare() {
    const btnCompare = document.getElementById('btnCompare');
    const input = document.getElementById('compareInput');

    btnCompare.addEventListener('click', () => handleCompare());
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleCompare();
    });

    input.value = '新手增肌训练一周几次比较合适？';
}

async function handleCompare() {
    const question = document.getElementById('compareInput').value.trim();
    if (!question) {
        showToast('请输入要对比的问题', 'error');
        return;
    }

    const container = document.getElementById('compareResults');

    if (!STATE.backendHealthy) {
        container.innerHTML = `<div class="history-empty"><p>后端服务不可用，无法进行检索对比。请确认后端已启动。</p></div>`;
        return;
    }

    container.innerHTML = `
        <div class="compare-column"><div class="compare-column-body" style="text-align:center;padding:40px;">BM25 检索中...</div></div>
        <div class="compare-column"><div class="compare-column-body" style="text-align:center;padding:40px;">向量检索中...</div></div>
    `;

    let bm25Result, vectorResult;
    try {
        // 对比模式检索召回量与正常问答 hybrid 的 BM25 召回量（top_k*4=20）对齐，
        // 避免 BM25 侧因 top_k 过小召回相关性不足而误判"无法回答"
        [bm25Result, vectorResult] = await Promise.all([
            apiPost('/ask', { question, mode: 'bm25', top_k: 20 }),
            apiPost('/ask', { question, mode: 'vector', top_k: 20 }),
        ]);
    } catch (e) {
        container.innerHTML = `<div class="history-empty"><p>请求失败: ${e.message}</p></div>`;
        return;
    }

    container.innerHTML = `
        <div class="compare-column">
            <div class="compare-column-header">
                <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="6" y1="6" x2="12" y2="6" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="9" x2="12" y2="9" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="12" x2="10" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>
                BM25 字面检索
                <span class="badge badge-bm25">对照组</span>
            </div>
            <div class="compare-column-body">
                <div class="compare-answer">
                    <div class="answer-label">生成结果</div>
                    ${escapeHtml(bm25Result.answer).replace(/\n/g, '<br>')}
                </div>
                <div class="compare-sources">
                    <div class="source-label">检索到的知识片段（展示前 ${Math.min(bm25Result.sources.length, 5)} / 共 ${bm25Result.sources.length} 条）</div>
                    ${bm25Result.sources.slice(0, 5).map(s => `
                        <div class="compare-source-item">
                            <span class="source-score">${typeof s.score === 'number' && s.score > 1 ? s.score.toFixed(1) : s.score.toFixed(2)}</span>
                            <div>
                                <strong>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}</strong>
                                <div class="source-text">${escapeHtml(s.snippet)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="compare-metric">
                    <span>命中数：<strong>${bm25Result.sources.length}</strong></span>
                    <span>方法：<strong>BM25 + jieba 分词</strong></span>
                </div>
            </div>
        </div>
        <div class="compare-column">
            <div class="compare-column-header">
                <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/><circle cx="6" cy="7" r="1.2" fill="currentColor"/><circle cx="12" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="11" r="1.2" fill="currentColor"/><line x1="6" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1"/><line x1="6" y1="7" x2="9" y2="11" stroke="currentColor" stroke-width="1"/><line x1="12" y1="7" x2="9" y2="11" stroke="currentColor" stroke-width="1"/></svg>
                向量语义检索
                <span class="badge badge-vector">实验组</span>
            </div>
            <div class="compare-column-body">
                <div class="compare-answer">
                    <div class="answer-label">生成结果</div>
                    ${escapeHtml(vectorResult.answer).replace(/\n/g, '<br>')}
                </div>
                <div class="compare-sources">
                    <div class="source-label">检索到的知识片段（展示前 ${Math.min(vectorResult.sources.length, 5)} / 共 ${vectorResult.sources.length} 条）</div>
                    ${vectorResult.sources.slice(0, 5).map(s => `
                        <div class="compare-source-item">
                            <span class="source-score">${s.score.toFixed(2)}</span>
                            <div>
                                <strong>${s.url ? `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}</strong>
                                <div class="source-text">${escapeHtml(s.snippet)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="compare-metric">
                    <span>命中数：<strong>${vectorResult.sources.length}</strong></span>
                    <span>方法：<strong>Embedding + FAISS 向量检索</strong></span>
                </div>
            </div>
        </div>
    `;
}

// ==================== 知识库浏览 ====================
window.initKnowledge = async function initKnowledge() {
    if (!STATE.backendHealthy) return initKnowledgeFallback();

    try {
        const [items, categories] = await Promise.all([
            apiGet('/knowledge/list'),
            apiGet('/knowledge/categories'),
        ]);
        STATE.knowledgeCache = items;
        STATE.categoriesCache = categories;

        renderKnowledgeStats(items, categories);
        renderFilterTags(categories);
        renderKnowledgeList(items);

        const searchInput = document.getElementById('knowledgeSearch');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const query = searchInput.value.trim().toLowerCase();
                const activeCat = document.querySelector('.filter-tag.active')?.dataset.cat || 'all';
                filterKnowledge(query, activeCat);
            });
        }

        const sortSelect = document.getElementById('knowledgeSort');
        if (sortSelect) {
            sortSelect.value = STATE.knowledgeSort || 'index';
            sortSelect.addEventListener('change', () => {
                STATE.knowledgeSort = sortSelect.value;
                const query = (document.getElementById('knowledgeSearch')?.value || '').trim().toLowerCase();
                const activeCat = document.querySelector('.filter-tag.active')?.dataset.cat || 'all';
                filterKnowledge(query, activeCat);
            });
        }
    } catch (e) {
        initKnowledgeFallback();
    }
}

function initKnowledgeFallback() {
    if (typeof KNOWLEDGE_BASE !== 'undefined') {
        STATE.knowledgeCache = KNOWLEDGE_BASE;
        STATE.categoriesCache = typeof CATEGORIES !== 'undefined'
            ? CATEGORIES.map(c => ({ category: c, count: KNOWLEDGE_BASE.filter(k => k.category === c).length }))
            : [];
        renderKnowledgeStats(STATE.knowledgeCache, STATE.categoriesCache);
        renderFilterTags(STATE.categoriesCache);
        renderKnowledgeList(STATE.knowledgeCache);
    }
}

function renderKnowledgeStats(items, categories) {
    const statTotal = document.getElementById('statTotal');
    const statCats = document.getElementById('statCats');
    if (statTotal) statTotal.textContent = items.length;
    if (statCats) statCats.textContent = categories.length;
}

function renderFilterTags(categories) {
    const container = document.getElementById('filterTags');
    if (!container) return;
    const allCats = ['all', ...categories.map(c => c.category)];
    container.innerHTML = allCats.map(cat => `
        <button class="filter-tag ${cat === 'all' ? 'active' : ''}" data-cat="${cat}">
            ${cat === 'all' ? '全部' : cat}
        </button>
    `).join('');

    container.querySelectorAll('.filter-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            container.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            const query = document.getElementById('knowledgeSearch')?.value.trim().toLowerCase() || '';
            filterKnowledge(query, tag.dataset.cat);
        });
    });
}

function filterKnowledge(query, cat) {
    let filtered = STATE.knowledgeCache || [];
    if (cat && cat !== 'all') {
        filtered = filtered.filter(k => k.category === cat);
    }
    if (query) {
        filtered = filtered.filter(k =>
            k.title.toLowerCase().includes(query) ||
            k.content.toLowerCase().includes(query) ||
            (k.tags && k.tags.some(t => t.toLowerCase().includes(query)))
        );
    }
    renderKnowledgeList(filtered);
}

function renderKnowledgeList(items) {
    const container = document.getElementById('knowledgeList');
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = '<div class="history-empty"><p>没有找到匹配的知识条目</p></div>';
        return;
    }
    items = sortKnowledgeItems(items);
    const isStatic = (id) => String(id).startsWith('KB');
    container.innerHTML = items.map(k => `
        <div class="knowledge-card" data-id="${escapeHtml(k.id)}">
            <div class="knowledge-card-check">
                <input type="checkbox" class="knowledge-check" data-id="${escapeHtml(k.id)}" ${isStatic(k.id) ? 'title="内置知识不可修改"' : ''}>
            </div>
            <div class="knowledge-card-actions">
                <button class="btn-card-action btn-card-edit" data-action="edit" data-id="${escapeHtml(k.id)}" title="编辑">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-card-action btn-card-delete" data-action="delete" data-id="${escapeHtml(k.id)}" data-title="${escapeHtml(k.title)}" title="删除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
            <div class="knowledge-card-header">
                <h3><span class="k-index">${escapeHtml(k.id)}</span>：${escapeHtml(k.title)}</h3>
                <span class="k-category">${escapeHtml(k.category)}</span>
            </div>
            <div class="k-content">${escapeHtml((k.content || '').substring(0, 200))}...</div>
            <div class="k-meta">
                <span>来源: ${k.url ? `<a href="${k.url}" target="_blank" rel="noopener">${escapeHtml(k.source || '')}</a>` : escapeHtml(k.source || '')}</span>
                ${k.tags ? `<span>标签: ${k.tags.map(t => '#' + t).join(' ')}</span>` : ''}
            </div>
            ${k.created_at ? `<span class="k-time">导入时间: ${escapeHtml(formatDateTime(k.created_at))}</span>` : ''}
        </div>
    `).join('');

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!requireLogin()) return;
            openEditEntryModal(btn.dataset.id);
        });
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!requireLogin()) return;
            openDeleteConfirm(btn.dataset.id, btn.dataset.title);
        });
    });

    container.querySelectorAll('.knowledge-check').forEach(cb => {
        cb.addEventListener('change', updateKnowledgeBatchCount);
    });
}

function sortKnowledgeItems(items) {
    const sort = STATE.knowledgeSort || 'index';
    const arr = [...items];
    if (sort === 'category') {
        arr.sort((a, b) =>
            (a.category || '').localeCompare(b.category || '', 'zh') ||
            String(a.id).localeCompare(String(b.id), 'en', { numeric: true })
        );
    } else if (sort === 'time') {
        arr.sort((a, b) => {
            const ta = a.created_at || '';
            const tb = b.created_at || '';
            if (ta && tb) return tb.localeCompare(ta);
            if (ta) return -1;
            if (tb) return 1;
            return String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
        });
    } else {
        arr.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
    }
    return arr;
}
var initKnowledge = window.initKnowledge;

// ==================== 问答历史 ====================
let historyListenersBound = false;

async function initHistory() {
    if (!STATE.backendHealthy) return initHistoryFallback();

    if (!historyListenersBound) {
        const clearBtn = document.getElementById('btnClearHistory');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                try {
                    await apiDelete('/history');
                    STATE.history = [];
                    renderHistoryList();
                    showToast('问答历史已清空', 'info');
                } catch (e) {
                    showToast('清空失败', 'error');
                }
            });
        }

        const btnBatchDeleteHistory = document.getElementById('btnBatchDeleteHistory');
        if (btnBatchDeleteHistory) {
            btnBatchDeleteHistory.addEventListener('click', enterHistoryBatchMode);
        }
        const btnConfirmBatchDeleteHistory = document.getElementById('btnConfirmBatchDeleteHistory');
        if (btnConfirmBatchDeleteHistory) {
            btnConfirmBatchDeleteHistory.addEventListener('click', executeBatchDeleteHistory);
        }
        const btnCancelHistoryBatch = document.getElementById('btnCancelHistoryBatch');
        if (btnCancelHistoryBatch) {
            btnCancelHistoryBatch.addEventListener('click', exitHistoryBatchMode);
        }
        const historyCheckAll = document.getElementById('historyCheckAll');
        if (historyCheckAll) {
            historyCheckAll.addEventListener('change', () => {
                document.querySelectorAll('.history-check').forEach(cb => {
                    cb.checked = historyCheckAll.checked;
                });
                updateHistoryBatchCount();
            });
        }
        historyListenersBound = true;
    }

    // 未登录：历史为登录功能
    if (!isLoggedIn()) {
        STATE.history = [];
        renderHistoryList();
        return;
    }

    await loadHistoryFromBackend();
    renderHistoryList();
}

function initHistoryFallback() {
    const clearBtn = document.getElementById('btnClearHistory');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            STATE.history = [];
            localStorage.removeItem('fitqa_history');
            renderHistoryList();
            showToast('问答历史已清空（本地）', 'info');
        });
    }
    STATE.history = loadLocalHistory();
    renderHistoryList();
}

window.loadHistoryFromBackend = async function loadHistoryFromBackend() {
    try {
        const data = await apiGet('/history');
        STATE.history = data.map(r => ({
            id: r.id,
            question: r.question,
            answer: r.answer,
            mode: r.mode,
            sources: r.sources ? JSON.parse(r.sources) : [],
            time: r.created_at,
        }));
    } catch (e) {
        // 静默
    }
    renderHistoryList();
}
var loadHistoryFromBackend = window.loadHistoryFromBackend;

function renderHistoryList() {
    const container = document.getElementById('historyList');
    if (!container) return;

    if (!isLoggedIn() && STATE.backendHealthy) {
        container.innerHTML = `
            <div class="history-empty">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <rect x="14" y="6" width="20" height="36" rx="4" stroke="#999" stroke-width="2"/>
                    <line x1="14" y1="14" x2="34" y2="14" stroke="#999" stroke-width="2"/>
                    <line x1="24" y1="6" x2="24" y2="2" stroke="#999" stroke-width="2" stroke-linecap="round"/>
                    <line x1="18" y1="22" x2="30" y2="22" stroke="#999" stroke-width="1.5"/>
                    <line x1="18" y1="28" x2="30" y2="28" stroke="#999" stroke-width="1.5"/>
                    <line x1="18" y1="34" x2="26" y2="34" stroke="#999" stroke-width="1.5"/>
                </svg>
                <p>问答历史为登录功能，登录后可查看</p>
                <button class="btn btn-primary btn-sm" id="btnHistoryLogin" style="margin-top:12px;">去登录</button>
            </div>`;
        const btn = container.querySelector('#btnHistoryLogin');
        if (btn) btn.addEventListener('click', () => openLoginModal());
        return;
    }

    if (!STATE.history || STATE.history.length === 0) {
        container.innerHTML = `
            <div class="history-empty">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <rect x="12" y="8" width="24" height="32" rx="3" stroke="#999" stroke-width="2"/>
                    <line x1="18" y1="16" x2="30" y2="16" stroke="#999" stroke-width="1.5"/>
                    <line x1="18" y1="22" x2="30" y2="22" stroke="#999" stroke-width="1.5"/>
                    <line x1="18" y1="28" x2="26" y2="28" stroke="#999" stroke-width="1.5"/>
                </svg>
                <p>暂无问答记录</p>
            </div>`;
        return;
    }

    container.innerHTML = STATE.history.map(h => {
        const time = new Date(h.time);
        const modeLabel = h.mode === 'hybrid' ? '混合检索' : h.mode === 'bm25' ? 'BM25' : '向量检索';
        return `
            <div class="history-item" data-id="${h.id}">
                <div class="history-item-check">
                    <input type="checkbox" class="history-check" data-id="${h.id}">
                </div>
                <div class="history-item-body">
                    <div class="hi-question">Q: ${escapeHtml(h.question)}</div>
                    <div class="hi-answer">A: ${escapeHtml((h.answer || '').substring(0, 150))}</div>
                    <div class="hi-meta">
                        <span>${formatTime(time)}</span>
                        <span>检索模式：${modeLabel}</span>
                        ${h.sources && h.sources.length > 0 ? `<span>参考来源：${h.sources.length}条</span>` : ''}
                    </div>
                </div>
                <button class="history-item-delete" data-id="${h.id}" title="删除该条历史">删除</button>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.history-check').forEach(cb => {
        cb.addEventListener('change', updateHistoryBatchCount);
    });

    container.querySelectorAll('.history-item-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (!confirm('确定删除这条问答历史吗？')) return;
            try {
                await apiDelete(`/history/${id}`);
                STATE.history = STATE.history.filter(h => String(h.id) !== String(id));
                renderHistoryList();
                showToast('历史记录已删除', 'success');
            } catch (e) {
                showToast('删除失败', 'error');
            }
        });
    });

    // 点击历史记录查看完整问答
    container.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.history-item-check') || e.target.closest('.history-item-delete')) return;
            if (document.body.classList.contains('history-batch-mode')) return;
            const id = el.dataset.id;
            const item = STATE.history.find(h => String(h.id) === String(id));
            if (item) {
                const time = new Date(item.time);
                const modeLabel = item.mode === 'hybrid' ? '混合检索' : item.mode === 'bm25' ? 'BM25' : '向量检索';
                const meta = `${formatTime(time)} · 检索模式：${modeLabel}`;
                showHistoryDetail(item.question, item.answer, meta, item.sources);
            }
        });
    });
}

function loadLocalHistory() {
    try {
        const data = localStorage.getItem('fitqa_history');
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

// ==================== 工具函数 ====================
window.formatTime = function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    // 转换为北京时间 (UTC+8)
    const bj = new Date(d.getTime() + 8 * 3600 * 1000);
    const h = bj.getUTCHours().toString().padStart(2, '0');
    const m = bj.getUTCMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}
var formatTime = window.formatTime;

function formatDateTime(str) {
    if (!str) return '';
    // 后端存储为北京时间 "YYYY-MM-DD HH:MM:SS"，直接原样显示，避免浏览器时区干扰
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
        return str.substring(0, 16);
    }
    // 兼容 ISO 格式（带时区），统一按北京时间（UTC+8）显示
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    const bj = new Date(d.getTime() + 8 * 3600 * 1000);
    const y = bj.getUTCFullYear();
    const mo = (bj.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = bj.getUTCDate().toString().padStart(2, '0');
    const h = bj.getUTCHours().toString().padStart(2, '0');
    const mi = bj.getUTCMinutes().toString().padStart(2, '0');
    return `${y}-${mo}-${day} ${h}:${mi}`;
}

window.escapeHtml = function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
var escapeHtml = window.escapeHtml;

// ==================== 高级设置 ====================
function initSettings() {
    const btnSettings = document.getElementById('btnSettings');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    const btnCancelSettings = document.getElementById('btnCancelSettings');
    const btnApplyMode = document.getElementById('btnApplyMode');
    const btnAddModel = document.getElementById('btnAddModel');
    const btnSaveNewModel = document.getElementById('btnSaveNewModel');
    const btnCancelAddModel = document.getElementById('btnCancelAddModel');
    const btnTestNewModel = document.getElementById('btnTestNewModel');
    const btnToggleNewKey = document.getElementById('btnToggleNewKey');
    const btnSelectModel = document.getElementById('btnSelectModel');
    const btnCloseModelSelect = document.getElementById('btnCloseModelSelect');
    const modelSelectModal = document.getElementById('modelSelectModal');
    const modal = document.getElementById('settingsModal');

    btnSettings.addEventListener('click', () => requireLogin(openSettings));
    btnCloseSettings.addEventListener('click', closeSettings);
    btnCancelSettings.addEventListener('click', closeSettings);
    btnApplyMode.addEventListener('click', applyMode);
    btnAddModel.addEventListener('click', toggleAddModelForm);
    btnSaveNewModel.addEventListener('click', saveNewModel);
    btnCancelAddModel.addEventListener('click', hideAddModelForm);
    btnTestNewModel.addEventListener('click', testNewModelConnection);
    btnToggleNewKey.addEventListener('click', () => {
        const input = document.getElementById('newModelKey');
        input.type = input.type === 'password' ? 'text' : 'password';
    });
    if (btnSelectModel) btnSelectModel.addEventListener('click', openModelSelectModal);
    if (btnCloseModelSelect) btnCloseModelSelect.addEventListener('click', closeModelSelectModal);
    if (modelSelectModal) modelSelectModal.addEventListener('click', (e) => {
        if (e.target === modelSelectModal) closeModelSelectModal();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSettings();
    });

    // 点击模式按钮仅切换选中态，通过"应用"按钮生效
    document.querySelectorAll('#settingsModal .mode-btn').forEach(btn => {
        btn.addEventListener('click', () => selectModeTab(btn.dataset.mode));
    });
}

function selectModeTab(mode) {
    if (!['mock', 'real'].includes(mode)) return;
    document.querySelectorAll('#settingsModal .mode-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`#settingsModal .mode-btn[data-mode="${mode}"]`);
    if (btn) btn.classList.add('active');
    updateApplyModeBtn(mode);
    toggleLlmConfigVisibility(mode === 'real');
}

function updateApplyModeBtn(mode) {
    const btn = document.getElementById('btnApplyMode');
    if (!btn) return;
    btn.textContent = mode === 'real' ? '应用大模型模式' : '应用离线模式';
}

async function applyMode() {
    const activeBtn = document.querySelector('#settingsModal .mode-btn.active');
    const mode = activeBtn ? activeBtn.dataset.mode : 'mock';
    const label = mode === 'real' ? '大模型' : '离线';
    const btn = document.getElementById('btnApplyMode');
    btn.disabled = true;
    btn.textContent = '应用中...';
    try {
        const resp = await fetch(`${API_BASE_URL}/config/mode`, {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ mode }),
        });
        const data = await resp.json();
        if (!resp.ok) {
            showSettingsToast(data.detail || '切换失败', 'error');
            await loadSettings();
            return;
        }
        showSettingsToast(`已切换到${label}模式`, 'success');
        await checkBackendHealth();
        await loadSettings();
        await refreshUserStatus();
    } catch (e) {
        showSettingsToast(`切换失败: ${e.message}`, 'error');
        await loadSettings();
    } finally {
        btn.disabled = false;
        updateApplyModeBtn(mode);
    }
}

window.openSettings = async function openSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('active');
    await loadSettings();
}
var openSettings = window.openSettings;

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('active');
    hideAddModelForm();
    closeModelSelectModal();
}

async function loadSettings() {
    try {
        const resp = await fetch(`${API_BASE_URL}/config`, { headers: authHeaders() });
        if (resp.ok) {
            const config = await resp.json();
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            const activeBtn = document.querySelector(`.mode-btn[data-mode="${config.mode}"]`);
            if (activeBtn) activeBtn.classList.add('active');
            toggleLlmConfigVisibility(config.mode === 'real');
            updateApplyModeBtn(config.mode);
            const modeLabel = document.getElementById('currentModeLabel');
            if (modeLabel) modeLabel.textContent = config.mode === 'real' ? '大模型模式' : '离线模式';
        }
    } catch (e) {
        console.warn('[Settings] Failed to load config:', e.message);
    }
    await loadModelList();
}

async function loadModelList() {
    const listEl = document.getElementById('modelList');
    const emptyEl = document.getElementById('modelListEmpty');
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models`, { headers: authHeaders() });
        if (!resp.ok) throw new Error('加载失败');
        const data = await resp.json();
        renderModelList(data.models, data.active_model_id);
        updateCurrentModelDisplay(data.models, data.active_model_id);
    } catch (e) {
        console.warn('[Models] Failed to load:', e.message);
        listEl.innerHTML = '<div class="model-list-empty">加载失败</div>';
    }
}

function updateCurrentModelDisplay(models, activeId) {
    const el = document.getElementById('currentModelName');
    if (!el) return;
    const active = (models || []).find(m => m.id === activeId);
    el.textContent = active ? active.name : '未选择';
}

function renderModelList(models, activeId) {
    const listEl = document.getElementById('modelList');
    if (!models || models.length === 0) {
        listEl.innerHTML = '<div class="model-list-empty">暂无模型，请点击下方按钮添加</div>';
        return;
    }
    listEl.innerHTML = models.map(m => `
        <div class="model-card ${m.id === activeId ? 'active' : ''}" data-id="${m.id}">
            <div class="model-info" onclick="switchModel(${m.id})">
                <div class="model-name">${escapeHtml(m.name)}</div>
                <div class="model-detail">${escapeHtml(m.model_name)} · ${m.api_key_masked}</div>
            </div>
            <div class="model-actions">
                ${m.id === activeId
                    ? '<span class="model-badge">使用中</span>'
                    : `<button class="btn btn-sm btn-outline" onclick="switchModel(${m.id})">切换</button>`
                }
                <button class="btn btn-sm btn-outline" onclick="openEditModel(${m.id})" title="编辑">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn btn-sm btn-danger-icon" onclick="removeModel(${m.id}, '${escapeHtml(m.name)}')" title="删除">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

let editingModelId = null;

function openEditModel(id) {
    const btnAdd = document.getElementById('btnAddModel');
    const form = document.getElementById('addModelForm');
    form.classList.remove('hidden');
    if (btnAdd) btnAdd.style.display = 'none';

    editingModelId = id;
    document.getElementById('newModelName').value = '';
    document.getElementById('newModelUrl').value = '';
    document.getElementById('newModelKey').value = '';
    document.getElementById('newModelModelName').value = '';
    document.getElementById('testNewModelResult').className = 'test-result';
    document.getElementById('testNewModelResult').textContent = '';

    fetch(`${API_BASE_URL}/config/models`, { headers: authHeaders() })
        .then(r => r.json())
        .then(data => {
            const m = (data.models || []).find(x => x.id === id);
            if (m) {
                document.getElementById('newModelName').value = m.name;
                document.getElementById('newModelUrl').value = m.base_url;
                document.getElementById('newModelModelName').value = m.model_name;
                document.getElementById('newModelKey').placeholder = '留空保持不变（当前: ' + m.api_key_masked + '）';
            }
        })
        .catch(() => {});
}

async function switchModel(id) {
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models/${id}/activate`, { method: 'PUT', headers: authHeaders() });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '切换失败');
        }
        showSettingsToast('模型已切换', 'success');
        await loadModelList();
        await checkBackendHealth();
        await refreshUserStatus();
    } catch (e) {
        showSettingsToast(`切换失败: ${e.message}`, 'error');
    }
}

async function removeModel(id, name) {
    if (!confirm(`确定删除模型 "${name}" 吗？`)) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '删除失败');
        }
        showSettingsToast('模型已删除', 'success');
        await loadModelList();
        await checkBackendHealth();
        await refreshUserStatus();
    } catch (e) {
        showSettingsToast(`删除失败: ${e.message}`, 'error');
    }
}

function toggleAddModelForm() {
    const form = document.getElementById('addModelForm');
    editingModelId = null;
    form.classList.toggle('hidden');
    if (form.classList.contains('hidden')) {
        const btnAdd = document.getElementById('btnAddModel');
        if (btnAdd) btnAdd.style.display = '';
    }
    resetModelFormFields();
}

function hideAddModelForm() {
    const form = document.getElementById('addModelForm');
    form.classList.add('hidden');
    const btnAdd = document.getElementById('btnAddModel');
    if (btnAdd) btnAdd.style.display = '';
    editingModelId = null;
    resetModelFormFields();
}

function resetModelFormFields() {
    document.getElementById('newModelName').value = '';
    document.getElementById('newModelUrl').value = '';
    document.getElementById('newModelKey').value = '';
    document.getElementById('newModelModelName').value = '';
    document.getElementById('newModelKey').placeholder = 'sk-...';
    document.getElementById('testNewModelResult').className = 'test-result';
    document.getElementById('testNewModelResult').textContent = '';
}

async function saveNewModel() {
    const name = document.getElementById('newModelName').value.trim();
    const baseUrl = document.getElementById('newModelUrl').value.trim();
    const apiKey = document.getElementById('newModelKey').value.trim();
    const modelName = document.getElementById('newModelModelName').value.trim();

    if (!name) { showToast('请输入模型别名', 'error'); return; }
    if (!baseUrl) { showToast('请输入 API 地址', 'error'); return; }
    if (editingModelId === null && !apiKey) { showToast('请输入 API Key', 'error'); return; }
    if (!modelName) { showToast('请输入模型名称', 'error'); return; }

    try {
        const isEdit = editingModelId !== null;
        const url = isEdit ? `${API_BASE_URL}/config/models/${editingModelId}` : `${API_BASE_URL}/config/models`;
        const resp = await fetch(url, {
            method: isEdit ? 'PUT' : 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ name, base_url: baseUrl, api_key: apiKey, model_name: modelName }),
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '保存失败');
        }
        showSettingsToast(isEdit ? '模型已更新' : '模型已添加', 'success');
        hideAddModelForm();
        await loadModelList();
        await checkBackendHealth();
        await refreshUserStatus();
    } catch (e) {
        showSettingsToast(`保存失败: ${e.message}`, 'error');
    }
}

async function testNewModelConnection() {
    const baseUrl = document.getElementById('newModelUrl').value.trim();
    const apiKey = document.getElementById('newModelKey').value.trim();
    const modelName = document.getElementById('newModelModelName').value.trim();
    const resultEl = document.getElementById('testNewModelResult');

    if (!baseUrl || !modelName) {
        resultEl.className = 'test-result show error';
        resultEl.textContent = '请填写 API 地址和模型名称';
        return;
    }

    const btn = document.getElementById('btnTestNewModel');
    btn.disabled = true;
    btn.textContent = '测试中...';
    resultEl.className = 'test-result show';
    resultEl.textContent = '正在测试连接...';

    try {
        const resp = await fetch(`${API_BASE_URL}/config/test`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ base_url: baseUrl, api_key: apiKey || 'test', model_name: modelName }),
        });
        const data = await resp.json();
        if (data.success) {
            resultEl.className = 'test-result show success';
            resultEl.textContent = `${data.message} (${data.latency_ms}ms)`;
        } else {
            resultEl.className = 'test-result show error';
            resultEl.textContent = data.message;
        }
    } catch (e) {
        resultEl.className = 'test-result show error';
        resultEl.textContent = `测试请求失败: ${e.message}`;
    } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
    }
}

function toggleLlmConfigVisibility(show) {
    // "当前模型" 与 "已添加模型" 始终可见，便于离线模式下先添加模型、查看当前模型
    const group = document.getElementById('currentModelGroup');
    if (group) group.classList.remove('hidden');
    const manageGroup = document.getElementById('modelManageGroup');
    if (manageGroup) manageGroup.classList.remove('hidden');
}

// ==================== 设置弹窗内提示（界面正下方） ====================
let settingsToastTimer = null;

function showSettingsToast(msg, type = 'info') {
    const el = document.getElementById('settingsToast');
    if (!el) return;
    el.textContent = msg;
    el.className = `settings-toast show ${type}`;
    clearTimeout(settingsToastTimer);
    settingsToastTimer = setTimeout(() => {
        el.className = 'settings-toast';
    }, 3000);
}

// ==================== 模型选择弹窗 ====================
async function openModelSelectModal() {
    const modal = document.getElementById('modelSelectModal');
    modal.classList.add('active');
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models`, { headers: authHeaders() });
        if (!resp.ok) throw new Error('加载失败');
        const data = await resp.json();
        renderModelSelectList(data.models, data.active_model_id);
    } catch (e) {
        document.getElementById('modelSelectList').innerHTML = '<div class="model-list-empty">加载失败</div>';
    }
}

function closeModelSelectModal() {
    document.getElementById('modelSelectModal').classList.remove('active');
}

function renderModelSelectList(models, activeId) {
    const listEl = document.getElementById('modelSelectList');
    if (!models || models.length === 0) {
        listEl.innerHTML = '<div class="model-list-empty">暂无模型，请先在设置中添加模型</div>';
        return;
    }
    listEl.innerHTML = models.map(m => `
        <div class="model-card ${m.id === activeId ? 'active' : ''}" data-id="${m.id}">
            <div class="model-info">
                <div class="model-name">${escapeHtml(m.name)}</div>
                <div class="model-detail">${escapeHtml(m.model_name)} · ${m.api_key_masked}</div>
            </div>
            ${m.id === activeId ? '<span class="model-badge">使用中</span>' : ''}
        </div>
    `).join('');

    listEl.querySelectorAll('.model-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = Number(card.dataset.id);
            if (id === activeId) {
                closeModelSelectModal();
                return;
            }
            selectModelFromModal(id);
        });
    });
}

async function selectModelFromModal(id) {
    const wasMock = document.querySelector('#settingsModal .mode-btn.active')?.dataset.mode === 'mock';
    try {
        const resp = await fetch(`${API_BASE_URL}/config/models/${id}/activate`, { method: 'PUT', headers: authHeaders() });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '切换失败');
        }
        if (wasMock) {
            // 离线模式下选择模型后保持离线模式，仅切换激活模型
            await fetch(`${API_BASE_URL}/config/mode`, {
                method: 'PUT',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ mode: 'mock' }),
            });
        }
        showSettingsToast('模型已选择', 'success');
        closeModelSelectModal();
        await loadModelList();
        await checkBackendHealth();
        await refreshUserStatus();
    } catch (e) {
        showSettingsToast(`选择失败: ${e.message}`, 'error');
    }
}

// ==================== 知识库导入（合并到知识管理弹窗） ====================
let importFiles = [];
let importMode = 'manual'; // manual=手动导入, smart=智能导入

function initImport() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('importFiles');
    const btnStart = document.getElementById('btnStartImport');
    const btnRebuild = document.getElementById('btnRebuildIndex');

    if (uploadArea) {
        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', handleDrop);
    }
    if (fileInput) fileInput.addEventListener('change', handleFileSelect);
    if (btnStart) btnStart.addEventListener('click', startImport);
    if (btnRebuild) btnRebuild.addEventListener('click', () => requireLogin(rebuildIndex));

    // 手动/智能导入模式切换
    document.querySelectorAll('.import-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => switchImportMode(btn.dataset.mode));
    });

    // 新增知识 / 导入文档 tab 切换
    document.querySelectorAll('#knowledgeTabs .modal-tab').forEach(tab => {
        tab.addEventListener('click', () => switchKnowledgeTab(tab.dataset.tab));
    });

    // 手动导入：内容分片勾选联动（同新增知识）
    const importSplitEnabled = document.getElementById('importSplitEnabled');
    if (importSplitEnabled) {
        importSplitEnabled.addEventListener('change', () => {
            const group = document.getElementById('importSplitMethodGroup');
            if (group) group.classList.toggle('hidden', !importSplitEnabled.checked);
            const radios = document.querySelectorAll('input[name="importSplitMethod"]');
            if (importSplitEnabled.checked) {
                if (!document.querySelector('input[name="importSplitMethod"]:checked')) {
                    const titleRadio = document.querySelector('input[name="importSplitMethod"][value="title"]');
                    if (titleRadio) titleRadio.checked = true;
                }
            } else {
                radios.forEach(r => r.checked = false);
            }
        });
    }
}

function switchImportMode(mode) {
    importMode = mode;
    document.querySelectorAll('.import-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    // 手动导入显示内容分片选项，智能导入隐藏（模型自动拆分）
    const splitOptionGroup = document.getElementById('importSplitOptionGroup');
    if (splitOptionGroup) splitOptionGroup.classList.toggle('hidden', mode !== 'manual');
    // 智能导入无需手动填来源/链接，来源自动识别为文件名
    const sourceRow = document.getElementById('importSourceRow');
    if (sourceRow) sourceRow.classList.toggle('hidden', mode !== 'manual');
    // 切换模式时重置导入表单
    resetImportForm();
}

// 知识管理弹窗：新增知识 / 导入文档 tab 切换
function switchKnowledgeTab(tab) {
    const tabs = document.querySelectorAll('#knowledgeTabs .modal-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const panelEntry = document.getElementById('tabPanelEntry');
    const panelImport = document.getElementById('tabPanelImport');
    if (panelEntry) panelEntry.classList.toggle('hidden', tab !== 'entry');
    if (panelImport) panelImport.classList.toggle('hidden', tab !== 'import');
    // 新增知识 tab 显示底部保存按钮，导入文档 tab 隐藏（用"开始导入"）
    const footer = document.querySelector('#entryModal .modal-footer');
    if (footer) footer.classList.toggle('hidden', tab !== 'entry');
}

function openImportModal() {
    document.getElementById('entryModal').classList.add('active');
    // 导入模式显示顶部 tab 切换
    const knowledgeTabs = document.getElementById('knowledgeTabs');
    if (knowledgeTabs) knowledgeTabs.classList.remove('hidden');
    switchKnowledgeTab('import');
    resetImportForm();
}

window.closeImportModal = function closeImportModal() {
    document.getElementById('entryModal').classList.remove('active');
    resetImportForm();
}
var closeImportModal = window.closeImportModal;

function resetImportForm() {
    importFiles = [];
    document.getElementById('importFiles').value = '';
    const list = document.getElementById('selectedFiles');
    if (list) list.innerHTML = '';
    document.getElementById('uploadArea').classList.remove('hidden');
    document.getElementById('importResult').classList.add('hidden');
    document.getElementById('importResult').textContent = '';
    document.getElementById('btnStartImport').disabled = false;
    document.getElementById('btnStartImport').textContent = '开始导入';
    document.getElementById('importSource').value = '';
    document.getElementById('importUrl').value = '';
    // 重置内容分片选项
    const importSplitEnabled = document.getElementById('importSplitEnabled');
    const importSplitMethodGroup = document.getElementById('importSplitMethodGroup');
    if (importSplitEnabled) importSplitEnabled.checked = false;
    if (importSplitMethodGroup) importSplitMethodGroup.classList.add('hidden');
    document.querySelectorAll('input[name="importSplitMethod"]').forEach(r => r.checked = false);
    // 按当前模式显示/隐藏内容分片选项
    const splitOptionGroup = document.getElementById('importSplitOptionGroup');
    if (splitOptionGroup) splitOptionGroup.classList.toggle('hidden', importMode !== 'manual');
    // 按当前模式显示/隐藏来源与链接（智能导入自动识别来源为文件名）
    const sourceRow = document.getElementById('importSourceRow');
    if (sourceRow) sourceRow.classList.toggle('hidden', importMode !== 'manual');
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(f => addImportFile(f));
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files || []);
    files.forEach(f => addImportFile(f));
}

function addImportFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
        showToast(`「${file.name}」格式不支持，仅支持 PDF / Word / TXT`, 'error');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast(`「${file.name}」超过 10MB 限制`, 'error');
        return;
    }
    if (importFiles.some(f => f.name === file.name && f.size === file.size)) {
        showToast(`「${file.name}」已添加`, 'error');
        return;
    }
    importFiles.push(file);
    renderSelectedFiles();
}

function renderSelectedFiles() {
    const list = document.getElementById('selectedFiles');
    if (!list) return;
    if (importFiles.length === 0) {
        list.innerHTML = '';
        document.getElementById('uploadArea').classList.remove('hidden');
        return;
    }
    document.getElementById('uploadArea').classList.add('hidden');
    list.innerHTML = importFiles.map((f, i) => `
        <div class="selected-file">
            <span class="file-icon">📄</span>
            <span class="file-name">${escapeHtml(f.name)}</span>
            <button class="btn-remove" data-index="${i}" title="移除">&times;</button>
        </div>
    `).join('');
    list.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', () => removeImportFile(parseInt(btn.dataset.index, 10)));
    });
}

function removeImportFile(index) {
    importFiles.splice(index, 1);
    renderSelectedFiles();
}

async function startImport() {
    if (!requireLogin()) return;
    if (importFiles.length === 0) {
        showToast('请先选择文件', 'error');
        return;
    }

    const btn = document.getElementById('btnStartImport');
    const resultEl = document.getElementById('importResult');
    btn.disabled = true;
    btn.textContent = '导入中...';

    // 手动导入：勾选内容分片才切分，未勾选则整篇作为一条；智能导入：模型自动拆分
    let mode = 'direct';
    let splitMethod = 'none';
    if (importMode === 'smart') {
        mode = 'llm';
    } else {
        const splitEnabled = document.getElementById('importSplitEnabled');
        if (splitEnabled && splitEnabled.checked) {
            splitMethod = document.querySelector('input[name="importSplitMethod"]:checked')?.value || 'title';
        }
    }
    const url = document.getElementById('importUrl').value.trim();
    const source = document.getElementById('importSource').value.trim();

    const formData = new FormData();
    importFiles.forEach(f => formData.append('files', f));
    formData.append('mode', mode);
    formData.append('split_method', splitMethod);
    if (url) formData.append('url', url);
    if (source) formData.append('source', source);

    try {
        const resp = await fetch(`${API_BASE_URL}/knowledge/import`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
        });
        const data = await resp.json();

        if (resp.ok && data.success) {
            resultEl.className = 'import-result show success';
            resultEl.textContent = data.message;
            showToast(data.message, 'success');
            await initKnowledge();
            resetImportForm();
        } else if (data.skipped) {
            resultEl.className = 'import-result show info';
            resultEl.textContent = data.message;
        } else {
            resultEl.className = 'import-result show error';
            resultEl.textContent = data.detail || data.message || '导入失败';
        }
    } catch (e) {
        resultEl.className = 'import-result show error';
        resultEl.textContent = `导入失败: ${e.message}`;
    } finally {
        btn.disabled = false;
        btn.textContent = '开始导入';
    }
}

async function rebuildIndex() {
    try {
        const resp = await fetch(`${API_BASE_URL}/knowledge/rebuild-index`, { method: 'POST', headers: authHeaders() });
        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message, 'success');
            await initKnowledge();
        } else {
            showToast(data.detail || '重建失败', 'error');
        }
    } catch (e) {
        showToast(`重建失败: ${e.message}`, 'error');
    }
}

// ==================== 知识条目 CRUD ====================
let currentDeleteEntryId = null;

function initEntryModal() {
    const btnAdd = document.getElementById('btnAddKnowledge');
    const btnClose = document.getElementById('btnCloseEntry');
    const btnCancel = document.getElementById('btnCancelEntry');
    const btnSave = document.getElementById('btnSaveEntry');
    const modal = document.getElementById('entryModal');
    const btnCloseDelete = document.getElementById('btnCloseDeleteConfirm');
    const btnCancelDelete = document.getElementById('btnCancelDelete');
    const btnConfirmDelete = document.getElementById('btnConfirmDelete');
    const deleteModal = document.getElementById('deleteConfirmModal');

    if (btnAdd) btnAdd.addEventListener('click', () => requireLogin(openAddEntryModal));
    if (btnClose) btnClose.addEventListener('click', closeEntryModal);
    if (btnCancel) btnCancel.addEventListener('click', closeEntryModal);
    if (btnSave) btnSave.addEventListener('click', saveEntry);

    const splitEnabled = document.getElementById('entrySplitEnabled');
    if (splitEnabled) {
        splitEnabled.addEventListener('change', () => {
            const group = document.getElementById('splitMethodGroup');
            if (group) group.classList.toggle('hidden', !splitEnabled.checked);
            const radios = document.querySelectorAll('input[name="entrySplitMethod"]');
            if (splitEnabled.checked) {
                // 勾选分片时，若未选择分片方式则默认按标题拆分
                if (!document.querySelector('input[name="entrySplitMethod"]:checked')) {
                    const titleRadio = document.querySelector('input[name="entrySplitMethod"][value="title"]');
                    if (titleRadio) titleRadio.checked = true;
                }
            } else {
                // 取消勾选时清空所有分片方式选中态，避免误会
                radios.forEach(r => r.checked = false);
            }
        });
    }

    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeEntryModal(); });

    if (btnCloseDelete) btnCloseDelete.addEventListener('click', closeDeleteConfirm);
    if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteConfirm);
    if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', executeDeleteEntry);
    if (deleteModal) deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) closeDeleteConfirm(); });

    // 批量操作入口
    const btnBatchKnowledge = document.getElementById('btnBatchKnowledge');
    if (btnBatchKnowledge) btnBatchKnowledge.addEventListener('click', () => requireLogin(enterKnowledgeBatchMode));

    // 批量编辑弹窗
    const btnBatchEdit = document.getElementById('btnBatchEditKnowledge');
    if (btnBatchEdit) btnBatchEdit.addEventListener('click', () => requireLogin(openBatchEditModal));
    const btnBatchDelete = document.getElementById('btnBatchDeleteKnowledge');
    if (btnBatchDelete) btnBatchDelete.addEventListener('click', () => requireLogin(executeBatchDeleteKnowledge));
    const btnCancelKnowledgeBatch = document.getElementById('btnCancelKnowledgeBatch');
    if (btnCancelKnowledgeBatch) btnCancelKnowledgeBatch.addEventListener('click', exitKnowledgeBatchMode);
    const knowledgeCheckAll = document.getElementById('knowledgeCheckAll');
    if (knowledgeCheckAll) {
        knowledgeCheckAll.addEventListener('change', () => {
            document.querySelectorAll('.knowledge-check').forEach(cb => {
                cb.checked = knowledgeCheckAll.checked;
            });
            updateKnowledgeBatchCount();
        });
    }
    const batchEditModal = document.getElementById('batchEditModal');
    const btnCloseBatchEdit = document.getElementById('btnCloseBatchEdit');
    const btnCancelBatchEdit = document.getElementById('btnCancelBatchEdit');
    const btnSaveBatchEdit = document.getElementById('btnSaveBatchEdit');
    if (btnCloseBatchEdit) btnCloseBatchEdit.addEventListener('click', closeBatchEditModal);
    if (btnCancelBatchEdit) btnCancelBatchEdit.addEventListener('click', closeBatchEditModal);
    if (btnSaveBatchEdit) btnSaveBatchEdit.addEventListener('click', saveBatchEdit);
    if (batchEditModal) batchEditModal.addEventListener('click', (e) => { if (e.target === batchEditModal) closeBatchEditModal(); });
}

function openAddEntryModal() {
    document.getElementById('entryId').value = '';
    document.getElementById('entryTitle').value = '';
    document.getElementById('entryCategory').value = '';
    document.getElementById('entryContent').value = '';
    document.getElementById('entrySource').value = '';
    document.getElementById('entryUrl').value = '';
    document.getElementById('entryTags').value = '';
    // 重置分片选项
    const splitEnabled = document.getElementById('entrySplitEnabled');
    const splitMethodGroup = document.getElementById('splitMethodGroup');
    if (splitEnabled) {
        splitEnabled.checked = false;
        splitEnabled.disabled = false;
    }
    if (splitMethodGroup) splitMethodGroup.classList.add('hidden');
    // 清空分片方式选中态，避免未勾选分片时误显示已选
    document.querySelectorAll('input[name="entrySplitMethod"]').forEach(r => r.checked = false);
    const splitOptionGroup = document.getElementById('splitOptionGroup');
    if (splitOptionGroup) splitOptionGroup.classList.remove('hidden');
    // 新增模式显示顶部 tab 切换
    const knowledgeTabs = document.getElementById('knowledgeTabs');
    if (knowledgeTabs) knowledgeTabs.classList.remove('hidden');
    populateCategoryDatalist();
    document.getElementById('entryModal').classList.add('active');
    switchKnowledgeTab('entry');
}

function openEditEntryModal(entryId) {
    const entry = STATE.knowledgeCache?.find(k => k.id === entryId);
    if (!entry) {
        showToast('未找到该条目', 'error');
        return;
    }
    document.getElementById('entryId').value = entry.id;
    document.getElementById('entryTitle').value = entry.title || '';
    document.getElementById('entryCategory').value = entry.category || '';
    document.getElementById('entryContent').value = entry.content || '';
    document.getElementById('entrySource').value = entry.source || '';
    document.getElementById('entryUrl').value = entry.url || '';
    document.getElementById('entryTags').value = (entry.tags || []).join(', ');
    // 编辑模式隐藏分片选项（分片仅新增时可用）
    const splitOptionGroup = document.getElementById('splitOptionGroup');
    if (splitOptionGroup) splitOptionGroup.classList.add('hidden');
    // 编辑模式隐藏顶部 tab 切换（仅编辑当前条目）
    const knowledgeTabs = document.getElementById('knowledgeTabs');
    if (knowledgeTabs) knowledgeTabs.classList.add('hidden');
    populateCategoryDatalist();
    document.getElementById('entryModal').classList.add('active');
    switchKnowledgeTab('entry');
}

function closeEntryModal() {
    document.getElementById('entryModal').classList.remove('active');
}

function populateCategoryDatalist() {
    const datalist = document.getElementById('categoryList');
    const categories = STATE.categoriesCache || [];
    datalist.innerHTML = categories.map(c => `<option value="${escapeHtml(c.category)}">`).join('');
}

async function saveEntry() {
    const entryId = document.getElementById('entryId').value;
    const title = document.getElementById('entryTitle').value.trim();
    const category = document.getElementById('entryCategory').value.trim();
    const content = document.getElementById('entryContent').value.trim();
    const source = document.getElementById('entrySource').value.trim();
    const url = document.getElementById('entryUrl').value.trim();
    const tagsStr = document.getElementById('entryTags').value.trim();

    if (!title) { showToast('请输入标题', 'error'); return; }
    if (!category) { showToast('请输入分类', 'error'); return; }
    if (!content) { showToast('请输入内容', 'error'); return; }
    if (!source) { showToast('请输入来源', 'error'); return; }

    const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
    const body = { title, category, content, source, url, tags };

    // 新增时支持分片
    if (!entryId) {
        const splitEnabled = document.getElementById('entrySplitEnabled');
        if (splitEnabled && splitEnabled.checked) {
            body.split_enabled = true;
            body.split_method = document.querySelector('input[name="entrySplitMethod"]:checked')?.value || 'title';
        }
    }

    const btnSave = document.getElementById('btnSaveEntry');
    btnSave.disabled = true;
    btnSave.textContent = '保存中...';

    try {
        let resp;
        if (entryId) {
            resp = await fetch(`${API_BASE_URL}/knowledge/entries/${entryId}`, {
                method: 'PUT',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
            });
        } else {
            resp = await fetch(`${API_BASE_URL}/knowledge/entries`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
            });
        }

        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message, 'success');
            closeEntryModal();
            await initKnowledge();
        } else {
            showToast(data.detail || '保存失败', 'error');
        }
    } catch (e) {
        showToast(`保存失败: ${e.message}`, 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = '保存';
    }
}

function openDeleteConfirm(entryId, title) {
    currentDeleteEntryId = entryId;
    document.getElementById('deleteEntryTitle').textContent = title;
    document.getElementById('deleteConfirmModal').classList.add('active');
}

function closeDeleteConfirm() {
    currentDeleteEntryId = null;
    document.getElementById('deleteConfirmModal').classList.remove('active');
}

async function executeDeleteEntry() {
    if (!currentDeleteEntryId) return;

    const btnConfirm = document.getElementById('btnConfirmDelete');
    btnConfirm.disabled = true;
    btnConfirm.textContent = '删除中...';

    try {
        const rebuild = document.getElementById('deleteRebuildIndex')?.checked !== false;
        const url = `${API_BASE_URL}/knowledge/entries/${currentDeleteEntryId}?rebuild=${rebuild ? 1 : 0}`;
        const resp = await fetch(url, { method: 'DELETE', headers: authHeaders() });
        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message, 'success');
            closeDeleteConfirm();
            await initKnowledge();
        } else {
            showToast(data.detail || '删除失败', 'error');
        }
    } catch (e) {
        showToast(`删除失败: ${e.message}`, 'error');
    } finally {
        btnConfirm.disabled = false;
        btnConfirm.textContent = '确认删除';
    }
}

// ==================== 知识批量操作 ====================
function getSelectedKnowledgeIds() {
    const ids = [];
    document.querySelectorAll('.knowledge-check:checked').forEach(cb => {
        if (!String(cb.dataset.id).startsWith('KB')) ids.push(cb.dataset.id);
    });
    return ids;
}

function updateKnowledgeBatchCount() {
    const checkboxes = document.querySelectorAll('.knowledge-check');
    const checked = [...checkboxes].filter(cb => cb.checked);
    const countEl = document.getElementById('knowledgeBatchCount');
    if (countEl) countEl.textContent = `已选 ${checked.length} 项`;
    const checkAll = document.getElementById('knowledgeCheckAll');
    if (checkAll) {
        checkAll.checked = checked.length > 0 && checked.length === checkboxes.length;
    }
}

function enterKnowledgeBatchMode() {
    const bar = document.getElementById('knowledgeBatchBar');
    if (bar) bar.classList.remove('hidden');
    document.body.classList.add('kb-batch-mode');
    updateKnowledgeBatchCount();
}

function exitKnowledgeBatchMode() {
    const bar = document.getElementById('knowledgeBatchBar');
    if (bar) bar.classList.add('hidden');
    document.body.classList.remove('kb-batch-mode');
    document.querySelectorAll('.knowledge-check').forEach(cb => cb.checked = false);
    const checkAll = document.getElementById('knowledgeCheckAll');
    if (checkAll) checkAll.checked = false;
    updateKnowledgeBatchCount();
}

function openBatchEditModal() {
    const ids = getSelectedKnowledgeIds();
    const kbCount = document.querySelectorAll('.knowledge-check:checked').length - ids.length;
    if (ids.length === 0) {
        showToast(kbCount > 0 ? 'KB 内置知识不可编辑，请勾选其他条目' : '请先勾选要编辑的知识条目', 'error');
        return;
    }
    if (kbCount > 0) showToast(`已跳过 ${kbCount} 条 KB 内置知识`, 'info');
    document.getElementById('batchEditCount').textContent = `已选 ${ids.length} 条知识`;
    document.getElementById('batchEditCategory').value = '';
    document.getElementById('batchEditSource').value = '';
    document.getElementById('batchEditUrl').value = '';
    document.getElementById('batchEditTags').value = '';
    populateCategoryDatalist();
    document.getElementById('batchEditModal').classList.add('active');
}

function closeBatchEditModal() {
    document.getElementById('batchEditModal').classList.remove('active');
}

async function saveBatchEdit() {
    const ids = getSelectedKnowledgeIds();
    if (ids.length === 0) {
        showToast('请先勾选要编辑的知识条目', 'error');
        return;
    }
    const category = document.getElementById('batchEditCategory').value.trim();
    const source = document.getElementById('batchEditSource').value.trim();
    const url = document.getElementById('batchEditUrl').value.trim();
    const tagsStr = document.getElementById('batchEditTags').value.trim();

    if (!category && !source && !url && !tagsStr) {
        showToast('请至少填写一个要修改的字段', 'error');
        return;
    }

    const body = { entry_ids: ids };
    if (category) body.category = category;
    if (source) body.source = source;
    if (url) body.url = url;
    if (tagsStr) body.tags = tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean);

    const btnSave = document.getElementById('btnSaveBatchEdit');
    btnSave.disabled = true;
    btnSave.textContent = '保存中...';
    try {
        const resp = await fetch(`${API_BASE_URL}/knowledge/entries/batch`, {
            method: 'PUT',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (resp.ok) {
            showToast(data.message, 'success');
            closeBatchEditModal();
            exitKnowledgeBatchMode();
            await initKnowledge();
        } else {
            showToast(data.detail || '批量更新失败', 'error');
        }
    } catch (e) {
        showToast(`批量更新失败: ${e.message}`, 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = '保存修改';
    }
}

async function executeBatchDeleteKnowledge() {
    const ids = getSelectedKnowledgeIds();
    const kbCount = document.querySelectorAll('.knowledge-check:checked').length - ids.length;
    if (ids.length === 0) {
        showToast(kbCount > 0 ? 'KB 内置知识不可删除，请勾选其他条目' : '请先勾选要删除的知识条目', 'error');
        return;
    }
    const skipTip = kbCount > 0 ? `（已跳过 ${kbCount} 条 KB 内置知识）` : '';
    if (!confirm(`确定删除选中的 ${ids.length} 条知识吗？删除后不可恢复。${skipTip}`)) return;

    const btn = document.getElementById('btnBatchDeleteKnowledge');
    btn.disabled = true;
    btn.textContent = '删除中...';
    try {
        // 逐条删除（不重建索引），最后统一重建一次
        for (const id of ids) {
            await fetch(`${API_BASE_URL}/knowledge/entries/${id}?rebuild=0`, { method: 'DELETE', headers: authHeaders() });
        }
        await fetch(`${API_BASE_URL}/knowledge/rebuild-index`, { method: 'POST', headers: authHeaders() });
        showToast(`已删除 ${ids.length} 条知识`, 'success');
        exitKnowledgeBatchMode();
        await initKnowledge();
    } catch (e) {
        showToast(`批量删除失败: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '批量删除';
    }
}

// ==================== 历史批量操作 ====================
function enterHistoryBatchMode() {
    const bar = document.getElementById('historyBatchBar');
    if (bar) bar.classList.remove('hidden');
    document.body.classList.add('history-batch-mode');
    updateHistoryBatchCount();
}

function exitHistoryBatchMode() {
    const bar = document.getElementById('historyBatchBar');
    if (bar) bar.classList.add('hidden');
    document.body.classList.remove('history-batch-mode');
    document.querySelectorAll('.history-check').forEach(cb => cb.checked = false);
    const checkAll = document.getElementById('historyCheckAll');
    if (checkAll) checkAll.checked = false;
    updateHistoryBatchCount();
}

function updateHistoryBatchCount() {
    const ids = [];
    document.querySelectorAll('.history-check:checked').forEach(cb => ids.push(cb.dataset.id));
    const countEl = document.getElementById('historyBatchCount');
    if (countEl) countEl.textContent = `已选 ${ids.length} 项`;
    const checkAll = document.getElementById('historyCheckAll');
    if (checkAll) {
        const total = document.querySelectorAll('.history-check').length;
        checkAll.checked = total > 0 && ids.length === total;
    }
}

async function executeBatchDeleteHistory() {
    const ids = [];
    document.querySelectorAll('.history-check:checked').forEach(cb => ids.push(cb.dataset.id));
    if (ids.length === 0) {
        showToast('请先勾选要删除的历史记录', 'error');
        return;
    }
    if (!confirm(`确定删除选中的 ${ids.length} 条问答历史吗？`)) return;

    const btn = document.getElementById('btnConfirmBatchDeleteHistory');
    btn.disabled = true;
    btn.textContent = '删除中...';
    try {
        await apiDelete('/history', { ids: ids.join(',') });
        STATE.history = STATE.history.filter(h => !ids.includes(String(h.id)));
        exitHistoryBatchMode();
        renderHistoryList();
        showToast(`已删除 ${ids.length} 条历史记录`, 'success');
    } catch (e) {
        showToast('批量删除失败', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '删除选中';
    }
}