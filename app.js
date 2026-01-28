// ============================================
// the main app for the reglament viewer
// press F1 twice to toggle edit mode //todo: remove that?
// orig docs is so terrible, isnt it?
// ============================================

// ===== fuzzy search stuff =====
// this helps find stuff even if u type it wrong

function levenshtein(a, b) {
    // calculates how different two strings are
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[b.length][a.length];
}

function similarity(a, b) {
    // returns 0-1 how similar two words are
    a = a.toLowerCase();
    b = b.toLowerCase();
    if (a === b) return 1;
    
    const maxLen = Math.max(a.length, b.length);
    const minLen = Math.min(a.length, b.length);
    const dist = levenshtein(a, b);
    
    // short words get more tolerance
    if (minLen <= 3 && dist <= 1) return 0.82;
    if (minLen <= 5 && dist <= 1) return 0.88;
    if (minLen >= 6 && dist <= 2) return Math.max(0.75, 1 - dist / maxLen);
    
    return 1 - dist / maxLen;
}

function fuzzyMatch(query, text, threshold = 0.6) {
    // checks if query matches text (exact or fuzzy)
    query = query.toLowerCase();
    text = text.toLowerCase();
    if (text.includes(query)) return { match: true, score: 1, type: 'exact' };
    
    const queryWords = query.split(/\s+/);
    const textWords = text.split(/\s+/);
    let totalScore = 0, matchedWords = 0;
    
    for (const qWord of queryWords) {
        let bestScore = 0;
        for (const tWord of textWords) {
            const score = similarity(qWord, tWord);
            if (score > bestScore) bestScore = score;
        }
        if (bestScore >= threshold) {
            matchedWords++;
            totalScore += bestScore;
        }
    }
    
    if (matchedWords > 0) {
        const avgScore = totalScore / queryWords.length;
        const coverage = matchedWords / queryWords.length;
        const finalScore = avgScore * coverage;
        if (finalScore >= threshold * 0.7) return { match: true, score: finalScore, type: 'fuzzy' };
    }
    return { match: false, score: 0, type: 'none' };
}

function findBestMatch(query, text) {
    // finds where in text the query matches best
    // used for highlighting
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    const exactIndex = lowerText.indexOf(lowerQuery);
    if (exactIndex !== -1) {
        return { index: exactIndex, length: query.length, matched: text.substr(exactIndex, query.length) };
    }
    
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 0);
    if (queryWords.length === 0) return null;
    
    const wordRegex = /\S+/g;
    const textWords = [];
    let match;
    while ((match = wordRegex.exec(text)) !== null) {
        textWords.push({ word: match[0], index: match.index, length: match[0].length });
    }
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (let startIdx = 0; startIdx < textWords.length; startIdx++) {
        let matchedQueryWords = 0;
        let totalScore = 0;
        let endIdx = startIdx;
        
        for (let qi = 0; qi < queryWords.length && endIdx < textWords.length; qi++) {
            const qWord = queryWords[qi];
            const tWord = textWords[endIdx].word.toLowerCase();
            const score = similarity(qWord, tWord);
            
            if (score >= 0.5) {
                matchedQueryWords++;
                totalScore += score;
                endIdx++;
            } else if (endIdx + 1 < textWords.length) {
                const nextScore = similarity(qWord, textWords[endIdx + 1].word.toLowerCase());
                if (nextScore >= 0.5) {
                    matchedQueryWords++;
                    totalScore += nextScore;
                    endIdx += 2;
                    continue;
                }
                break;
            } else {
                break;
            }
        }
        
        if (matchedQueryWords > 0) {
            const avgScore = totalScore / matchedQueryWords;
            const coverage = matchedQueryWords / queryWords.length;
            const finalScore = avgScore * coverage;
            
            if (finalScore > bestScore && coverage >= 0.4) {
                bestScore = finalScore;
                const startPos = textWords[startIdx].index;
                const endPos = textWords[endIdx - 1].index + textWords[endIdx - 1].length;
                bestMatch = { index: startPos, length: endPos - startPos, matched: text.substring(startPos, endPos) };
            }
        }
    }
    
    return bestMatch;
}

// ===== app state =====
// keeps track of whats selected and stuff

const state = {
    editMode: false,
    lastF1Press: 0,
    currentSection: 'reglament',
    currentTab: null,
    currentSubtab: null,
    currentSubsubtab: null,
    expandedSubtabs: new Set(),
    data: null  // loaded from data.json
};

// ===== dom elements we use a lot =====

const elements = {
    navTabs: document.querySelectorAll('.nav-tab'),
    navCenter: document.getElementById('navCenter'),
    searchInput: document.getElementById('searchInput'),
    searchResults: document.getElementById('searchResults'),
    searchHighlightBox: document.getElementById('searchHighlightBox'),
    sidebarContent: document.getElementById('sidebarContent'),
    contentTitle: document.getElementById('contentTitle'),
    contentBody: document.getElementById('contentBody'),
    contentEditBtn: document.getElementById('contentEditBtn'),
    addTabBtn: document.getElementById('addTabBtn'),
    modalOverlay: document.getElementById('modalOverlay'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalFooter: document.getElementById('modalFooter'),
    modalClose: document.getElementById('modalClose'),
    saveBtn: document.getElementById('saveBtn'),
    loadBtn: document.getElementById('loadBtn'),
    fileInput: document.getElementById('fileInput')
};

// ===== init - runs when page loads =====

async function init() {
    // load data from json file
    try {
        const response = await fetch('data.json');
        state.data = await response.json();
    } catch (err) {
        console.error('couldnt load data.json:', err);
        state.data = {
            'reglament': { tabs: [] },
            'templates-withdrawal': { tabs: [] },
            'templates-deposit': { tabs: [] }
        };
    }
    
    setupEventListeners();
    handleHash();
    renderSidebar();
}

// ===== event listeners =====

function setupEventListeners() {
    // nav tabs click
    elements.navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            setActiveNavTab(tab);
            state.currentSection = tab.dataset.section;
            state.currentTab = null;
            state.currentSubtab = null;
            state.currentSubsubtab = null;
            renderSidebar();
            showEmptyState();
            updateHash();
        });
    });

    // F1 double tap for edit mode
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F1') {
            e.preventDefault();
            const now = Date.now();
            if (now - state.lastF1Press < 500) toggleEditMode();
            state.lastF1Press = now;
        }
    });

    // search stuff
    elements.searchInput.addEventListener('input', debounce(handleSearch, 300));
    elements.searchInput.addEventListener('focus', () => {
        if (elements.searchInput.value) handleSearch();
    });
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            elements.searchResults.classList.remove('visible');
        }
    });

    // modal close
    elements.modalClose.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.modalOverlay.classList.contains('visible')) {
            if (confirm('Закрыть без сохранения?')) closeModal();
        }
    });

    // edit mode buttons
    elements.addTabBtn.addEventListener('click', () => openTabModal());
    elements.contentEditBtn.addEventListener('click', () => openContentEditModal());
    elements.saveBtn.addEventListener('click', saveToFile);
    elements.loadBtn.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', loadFromFile);
    
    window.addEventListener('hashchange', handleHash);
}

function setActiveNavTab(activeTab) {
    elements.navTabs.forEach(tab => tab.classList.remove('active'));
    activeTab.classList.add('active');
}

function toggleEditMode() {
    state.editMode = !state.editMode;
    document.body.classList.toggle('edit-mode', state.editMode);
    elements.navCenter.classList.toggle('visible', state.editMode);
}

// ===== copy code to clipboard =====

function copyCode(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
    });
}

window.copyCode = copyCode;

// ===== render sidebar with all tabs =====

function renderSidebar() {
    const tabs = state.data[state.currentSection]?.tabs || [];
    
    if (tabs.length === 0) {
        elements.sidebarContent.innerHTML = `
            <div class="empty-state" style="height: auto; padding: 40px 20px;">
                <p style="font-size: 14px; color: var(--text-muted);">Нет разделов</p>
            </div>
        `;
        return;
    }

    let html = '';
    tabs.forEach(tab => {
        const hasSubtabs = tab.subtabs && tab.subtabs.length > 0;
        const isExpanded = state.currentTab === tab.id;
        const isActive = state.currentTab === tab.id && !state.currentSubtab;

        html += `
            <div class="tab-item" data-tab-id="${tab.id}">
                <div class="tab-header ${isActive ? 'active' : ''}" onclick="selectTab('${tab.id}')">
                    <span class="tab-arrow ${hasSubtabs ? (isExpanded ? 'expanded' : '') : 'hidden'}" onclick="toggleTab('${tab.id}', event)">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </span>
                    ${tab.icon ? `<span class="tab-icon">${tab.icon}</span>` : ''}
                    <span class="tab-name">${escapeHtml(tab.name)}</span>
                    <button class="tab-edit-btn" onclick="event.stopPropagation(); openTabModal('${tab.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
                <div class="subtabs ${isExpanded ? 'expanded' : ''}">
                    ${renderSubtabs(tab)}
                    <div class="add-subtab-btn" onclick="openSubtabModal('${tab.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Добавить подраздел
                    </div>
                </div>
            </div>
        `;
    });

    elements.sidebarContent.innerHTML = html;
}

function renderSubtabs(tab) {
    if (!tab.subtabs || tab.subtabs.length === 0) return '';
    
    return tab.subtabs.map(subtab => {
        const hasSubsubtabs = subtab.subsubtabs && subtab.subsubtabs.length > 0;
        const isSubActive = state.currentSubtab === subtab.id && !state.currentSubsubtab;
        const isSubExpanded = state.expandedSubtabs.has(subtab.id) || state.currentSubtab === subtab.id;

        return `
            <div class="subtab-item" data-subtab-id="${subtab.id}">
               <div class="subtab-header ${isSubActive ? 'active' : ''}" onclick="selectSubtab('${tab.id}', '${subtab.id}')">
                    <span class="tab-arrow ${hasSubsubtabs ? (isSubExpanded ? 'expanded' : '') : 'hidden'}" style="width: 16px; height: 16px;" onclick="toggleSubtab('${subtab.id}', event)">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </span>
                    ${subtab.icon ? `<span class="subtab-icon">${subtab.icon}</span>` : ''}
                    <span class="tab-name">${escapeHtml(subtab.name)}</span>
                    <button class="tab-edit-btn" onclick="event.stopPropagation(); openSubtabModal('${tab.id}', '${subtab.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
                <div class="subsubtabs ${isSubExpanded ? 'expanded' : ''}">
                    ${renderSubsubtabs(tab, subtab)}
                    <div class="add-subsubtab-btn" onclick="openSubsubtabModal('${tab.id}', '${subtab.id}')">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Добавить подподраздел
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderSubsubtabs(tab, subtab) {
    if (!subtab.subsubtabs || subtab.subsubtabs.length === 0) return '';
    
    return subtab.subsubtabs.map(subsubtab => {
        const isActive = state.currentSubsubtab === subsubtab.id;
        return `
            <div class="subsubtab-item" data-subsubtab-id="${subsubtab.id}">
                <div class="subsubtab-header ${isActive ? 'active' : ''}" onclick="selectSubsubtab('${tab.id}', '${subtab.id}', '${subsubtab.id}')">
                    ${subsubtab.icon ? `<span class="subsubtab-icon">${subsubtab.icon}</span>` : ''}
                    <span class="tab-name">${escapeHtml(subsubtab.name)}</span>
                    <button class="tab-edit-btn" onclick="event.stopPropagation(); openSubsubtabModal('${tab.id}', '${subtab.id}', '${subsubtab.id}')" style="width: 24px; height: 24px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ===== tab selection handlers =====

function selectTab(tabId) {
    state.currentTab = tabId;
    state.currentSubtab = null;
    state.currentSubsubtab = null;
    renderSidebar();
    renderContent();
    updateHash();
}

function selectSubtab(tabId, subtabId) {
    state.currentTab = tabId;
    state.currentSubtab = subtabId;
    state.currentSubsubtab = null;
    state.expandedSubtabs.add(subtabId);
    renderSidebar();
    renderContent();
    updateHash();
}

function selectSubsubtab(tabId, subtabId, subsubtabId) {
    state.currentTab = tabId;
    state.currentSubtab = subtabId;
    state.currentSubsubtab = subsubtabId;
    state.expandedSubtabs.add(subtabId);
    renderSidebar();
    renderContent();
    updateHash();
}

function toggleTab(tabId, event) {
    if (event) event.stopPropagation();
    
    if (state.currentTab === tabId) {
        state.currentTab = null;
        state.currentSubtab = null;
        state.currentSubsubtab = null;
    } else {
        state.currentTab = tabId;
    }
    renderSidebar();
}

function toggleSubtab(subtabId, event) {
    if (event) event.stopPropagation();
    
    if (state.expandedSubtabs.has(subtabId)) {
        state.expandedSubtabs.delete(subtabId);
        if (state.currentSubtab === subtabId) {
            state.currentSubsubtab = null;
        }
    } else {
        state.expandedSubtabs.add(subtabId);
    }
    renderSidebar();
}

// make em global so onclick works
window.selectTab = selectTab;
window.selectSubtab = selectSubtab;
window.selectSubsubtab = selectSubsubtab;
window.toggleTab = toggleTab;
window.toggleSubtab = toggleSubtab;

// ===== render main content area =====

function renderContent() {
    const tabs = state.data[state.currentSection]?.tabs || [];
    const tab = tabs.find(t => t.id === state.currentTab);
    
    if (!tab) {
        showEmptyState();
        return;
    }

    // level 3 - just subsubtab
    if (state.currentSubsubtab && state.currentSubtab) {
        const subtab = tab.subtabs?.find(s => s.id === state.currentSubtab);
        const subsubtab = subtab?.subsubtabs?.find(ss => ss.id === state.currentSubsubtab);
        if (subsubtab) {
            elements.contentTitle.innerHTML = `
                ${subsubtab.icon ? `<span class="content-title-icon">${subsubtab.icon}</span>` : ''}
                ${escapeHtml(subsubtab.name)}
            `;
            elements.contentBody.innerHTML = `<div class="markdown-content">${parseMarkdown(subsubtab.content || '')}</div>`;
            return;
        }
    }

    // level 2 - subtab + its children
    if (state.currentSubtab) {
        const subtab = tab.subtabs?.find(s => s.id === state.currentSubtab);
        if (subtab) {
            elements.contentTitle.innerHTML = `
                ${subtab.icon ? `<span class="content-title-icon">${subtab.icon}</span>` : ''}
                ${escapeHtml(subtab.name)}
            `;
            
            let html = '<div class="markdown-content">';
            html += parseMarkdown(subtab.content || '');
            
            if (subtab.subsubtabs && subtab.subsubtabs.length > 0) {
                for (const subsubtab of subtab.subsubtabs) {
                    html += `
                        <div class="section-divider">
                            <div class="section-divider-title">${subsubtab.icon ? `<span class="section-divider-icon">${subsubtab.icon}</span>` : ''}${escapeHtml(subsubtab.name)}</div>
                            <div class="section-divider-path">${escapeHtml(subtab.name)} → ${escapeHtml(subsubtab.name)}</div>
                        </div>
                    `;
                    html += parseMarkdown(subsubtab.content || '');
                }
            }
            
            html += '</div>';
            elements.contentBody.innerHTML = html;
            return;
        }
    }

    // level 1 - tab + all children
    elements.contentTitle.innerHTML = `
        ${tab.icon ? `<span class="content-title-icon">${tab.icon}</span>` : ''}
        ${escapeHtml(tab.name)}
    `;
    
    let html = '<div class="markdown-content">';
    html += parseMarkdown(tab.content || '');
    
    if (tab.subtabs && tab.subtabs.length > 0) {
        for (const subtab of tab.subtabs) {
            html += `
                <div class="section-divider">
                    <div class="section-divider-title">${subtab.icon ? `<span class="section-divider-icon">${subtab.icon}</span>` : ''}${escapeHtml(subtab.name)}</div>
                    <div class="section-divider-path">${escapeHtml(tab.name)} → ${escapeHtml(subtab.name)}</div>
                </div>
            `;
            html += parseMarkdown(subtab.content || '');
            
            if (subtab.subsubtabs && subtab.subsubtabs.length > 0) {
                for (const subsubtab of subtab.subsubtabs) {
                    html += `
                        <div class="section-divider">
                            <div class="section-divider-title">${subsubtab.icon ? `<span class="section-divider-icon">${subsubtab.icon}</span>` : ''}${escapeHtml(subsubtab.name)}</div>
                            <div class="section-divider-path">${escapeHtml(tab.name)} → ${escapeHtml(subtab.name)} → ${escapeHtml(subsubtab.name)}</div>
                        </div>
                    `;
                    html += parseMarkdown(subsubtab.content || '');
                }
            }
        }
    }
    
    html += '</div>';
    elements.contentBody.innerHTML = html;
}

function showEmptyState() {
    elements.contentTitle.textContent = 'Выберите раздел';
    elements.contentBody.innerHTML = `
        <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <h3 class="empty-state-title">Выберите раздел</h3>
            <p class="empty-state-text">Выберите раздел в боковом меню для просмотра содержимого</p>
        </div>
    `;
}

// ===== markdown parser =====
// converts markdown-ish text to html

function parseMarkdown(text) {
    if (!text) return '';
    
    // pull out svg images first so we dont escape em
    const svgBlocks = [];
    text = text.replace(/<svg[\s\S]*?<\/svg>/gi, (match) => {
        const index = svgBlocks.length;
        svgBlocks.push(match);
        return `%%SVGBLOCK${index}%%`;
    });
    // extract png image tags
	const pngBlocks = [];
	text = text.replace(/<png([^>]*)>([\s\S]*?)<\/png>/gi, (match, attrs, filename) => {
		const index = pngBlocks.length;
		pngBlocks.push({ attrs: attrs.trim(), filename: filename.trim() });
		return `%%PNGBLOCK${index}%%`;
	});
    // pull out code blocks first so we dont mess with em
    const codeBlocks = [];
    text = text.replace(/```([\s\S]*?)```/g, (match, code) => {
        const index = codeBlocks.length;
        codeBlocks.push(code.trim());
        return `%%CODEBLOCK${index}%%`;
    });
    
    // same for inline code
    const inlineCodes = [];
    text = text.replace(/`([^`]+)`/g, (match, code) => {
        const index = inlineCodes.length;
        inlineCodes.push(code);
        return `%%INLINECODE${index}%%`;
    });
    
    let html = escapeHtml(text);
    
    // put svg blocks back as-is (they render as images)
    svgBlocks.forEach((svg, index) => {
        html = html.replace(`%%SVGBLOCK${index}%%`, `<span class="inline-svg">${svg}</span>`);
    });
    // restore png image blocks
	pngBlocks.forEach((png, index) => {
		const widthMatch = png.attrs.match(/width\s*=\s*["']?([^"'\s>]+)["']?/i);
		const heightMatch = png.attrs.match(/height\s*=\s*["']?([^"'\s>]+)["']?/i);
		const xMatch = png.attrs.match(/x\s*=\s*["']?([^"'\s>]+)["']?/i);
		const yMatch = png.attrs.match(/y\s*=\s*["']?([^"'\s>]+)["']?/i);
		
		let imgStyle = '';
		let wrapperStyle = '';
		const hasPosition = xMatch || yMatch;
		
		if (widthMatch) {
			const w = widthMatch[1];
			imgStyle += 'width:' + (/^\d+$/.test(w) ? w + 'px' : w) + ';';
		}
		if (heightMatch) {
			const h = heightMatch[1];
			imgStyle += 'height:' + (/^\d+$/.test(h) ? h + 'px' : h) + ';';
		}
		if (xMatch) {
			const x = xMatch[1];
			wrapperStyle += 'margin-left:' + (/^-?\d+$/.test(x) ? x + 'px' : x) + ';';
		}
		if (yMatch) {
			const y = yMatch[1];
			wrapperStyle += 'margin-top:' + (/^-?\d+$/.test(y) ? y + 'px' : y) + ';';
		}
		
		const wrapperClass = hasPosition ? 'png-wrapper png-positioned' : 'png-wrapper png-centered';
		const safeFilename = png.filename.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		
		html = html.replace('%%PNGBLOCK' + index + '%%', 
			'<div class="' + wrapperClass + '" style="' + wrapperStyle + '">' +
			'<img src="' + safeFilename + '" style="' + imgStyle + '" alt="">' +
			'</div>'
		);
	});
    // put code blocks back with copy buttons
    codeBlocks.forEach((code, index) => {
        const escapedCode = escapeHtml(code);
        const codeForCopy = code.replace(/'/g, "\\'").replace(/\n/g, "\\n");
        html = html.replace(`%%CODEBLOCK${index}%%`, 
            '<div class="code-block-wrapper">' +
                '<button class="code-block-copy" onclick="copyCode(this, \'' + codeForCopy + '\')">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
                        '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
                    '</svg>' +
                '</button>' +
                '<pre><code>' + escapedCode + '</code></pre>' +
            '</div>'
        );
    });
    
    // inline code with copy
    inlineCodes.forEach((code, index) => {
        const escapedCode = escapeHtml(code);
        const codeForCopy = code.replace(/'/g, "\\'");
        html = html.replace(`%%INLINECODE${index}%%`,
            '<span class="inline-code-wrapper">' +
                '<code>' + escapedCode + '</code>' +
                '<button class="inline-code-copy" onclick="copyCode(this, \'' + codeForCopy + '\')">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
                        '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
                    '</svg>' +
                '</button>' +
            '</span>'
        );
    });
    
    // colored text like &red word
    html = html.replace(/&amp;(red|green|blue|yellow|orange|purple|pink|cyan|white|gray)\s+(\S+)/gi, 
        '<span class="color-$1">$2</span>');
    
    // headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // bold n italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    
    // paragraphs
    html = html.split('\n\n').map(p => {
        p = p.trim();
        if (!p) return '';
        if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol') || 
            p.startsWith('<li') || p.startsWith('<div class="code-block') || p.startsWith('<blockquote')) {
            return p;
        }
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');
    
    return html;
}

// ===== modals =====

function openModal(title, bodyHtml, footerHtml) {
    elements.modalTitle.textContent = title;
    elements.modalBody.innerHTML = bodyHtml;
    elements.modalFooter.innerHTML = footerHtml;
    elements.modalOverlay.classList.add('visible');
}

function closeModal() {
    elements.modalOverlay.classList.remove('visible');
}

// html for the edit form in modals
function getModalFormHtml(data = {}) {
    return `
        <div class="form-group">
            <label class="form-label">Название</label>
            <input type="text" class="form-input" id="itemName" value="${escapeHtml(data.name || '')}" placeholder="Название">
        </div>
        <div class="form-group">
            <label class="form-label">Теги (через запятую)</label>
            <input type="text" class="form-input" id="itemTags" value="${data.tags ? data.tags.join(', ') : ''}" placeholder="тег1, тег2, тег3">
        </div>
        <div class="form-group">
            <label class="form-label">Иконка (SVG код)</label>
            <textarea class="form-input" id="itemIcon" placeholder="<svg>...</svg>" style="min-height: 80px; font-size: 12px; font-family: monospace;">${escapeHtml(data.icon || '')}</textarea>
            <div class="icon-preview" id="iconPreview" style="display: none;">
                <div class="icon-preview-box" id="iconPreviewBox"></div>
                <span class="icon-preview-text">Предпросмотр иконки</span>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">Или загрузить SVG файл</label>
            <input type="file" class="form-input form-input-file" id="itemIconFile" accept=".svg">
        </div>
        <div class="form-group">
            <label class="form-label">Содержимое (Markdown). Цвета: &red слово, &green слово и т.д.</label>
            <textarea class="form-input form-textarea" id="itemContent" placeholder="Текст раздела...">${escapeHtml(data.content || '')}</textarea>
        </div>
    `;
}

function setupIconPreview() {
    setTimeout(() => {
        const iconInput = document.getElementById('itemIcon');
        const iconPreview = document.getElementById('iconPreview');
        const iconPreviewBox = document.getElementById('iconPreviewBox');
        if (!iconInput) return;

        const updatePreview = () => {
            const svg = iconInput.value.trim();
            if (svg && svg.includes('<svg')) {
                iconPreviewBox.innerHTML = svg;
                iconPreview.style.display = 'flex';
            } else {
                iconPreview.style.display = 'none';
            }
        };

        iconInput.addEventListener('input', updatePreview);
        updatePreview();

        document.getElementById('itemIconFile')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    iconInput.value = e.target.result;
                    updatePreview();
                };
                reader.readAsText(file);
            }
        });
    }, 0);
}

// ===== tab crud =====

function openTabModal(tabId = null) {
    const tabs = state.data[state.currentSection]?.tabs || [];
    const tab = tabId ? tabs.find(t => t.id === tabId) : null;
    const isEdit = !!tab;

    const footerHtml = `
        ${isEdit ? `<button class="btn btn-danger" onclick="deleteTab('${tabId}')">Удалить</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal()">Отмена</button>
        <button class="btn btn-primary" onclick="saveTab('${tabId || ''}')">${isEdit ? 'Сохранить' : 'Создать'}</button>
    `;

    openModal(isEdit ? 'Редактировать раздел' : 'Новый раздел', getModalFormHtml(tab || {}), footerHtml);
    setupIconPreview();
}

function saveTab(tabId) {
    const name = document.getElementById('itemName').value.trim();
    const tags = document.getElementById('itemTags').value.split(',').map(t => t.trim()).filter(t => t);
    const icon = document.getElementById('itemIcon').value.trim();
    const content = document.getElementById('itemContent').value;

    if (!name) { alert('Введите название'); return; }

    const tabs = state.data[state.currentSection].tabs;

    if (tabId) {
        const tab = tabs.find(t => t.id === tabId);
        if (tab) { tab.name = name; tab.tags = tags; tab.icon = icon; tab.content = content; }
    } else {
        tabs.push({ id: 'tab_' + Date.now(), name, tags, icon, content, subtabs: [] });
    }

    closeModal();
    renderSidebar();
    if (state.currentTab === tabId) renderContent();
}

function deleteTab(tabId) {
    if (!confirm('Удалить раздел?')) return;
    const tabs = state.data[state.currentSection].tabs;
    const index = tabs.findIndex(t => t.id === tabId);
    if (index > -1) tabs.splice(index, 1);
    if (state.currentTab === tabId) { state.currentTab = null; state.currentSubtab = null; state.currentSubsubtab = null; showEmptyState(); }
    closeModal();
    renderSidebar();
}

// ===== subtab crud =====

function openSubtabModal(tabId, subtabId = null) {
    const tabs = state.data[state.currentSection]?.tabs || [];
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const subtab = subtabId ? tab.subtabs?.find(s => s.id === subtabId) : null;
    const isEdit = !!subtab;

    const footerHtml = `
        ${isEdit ? `<button class="btn btn-danger" onclick="deleteSubtab('${tabId}', '${subtabId}')">Удалить</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal()">Отмена</button>
        <button class="btn btn-primary" onclick="saveSubtab('${tabId}', '${subtabId || ''}')">${isEdit ? 'Сохранить' : 'Создать'}</button>
    `;

    openModal(isEdit ? 'Редактировать подраздел' : 'Новый подраздел', getModalFormHtml(subtab || {}), footerHtml);
    setupIconPreview();
}

function saveSubtab(tabId, subtabId) {
    const name = document.getElementById('itemName').value.trim();
    const tags = document.getElementById('itemTags').value.split(',').map(t => t.trim()).filter(t => t);
    const icon = document.getElementById('itemIcon').value.trim();
    const content = document.getElementById('itemContent').value;

    if (!name) { alert('Введите название'); return; }

    const tabs = state.data[state.currentSection].tabs;
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (!tab.subtabs) tab.subtabs = [];

    if (subtabId) {
        const subtab = tab.subtabs.find(s => s.id === subtabId);
        if (subtab) { subtab.name = name; subtab.tags = tags; subtab.icon = icon; subtab.content = content; }
    } else {
        tab.subtabs.push({ id: 'subtab_' + Date.now(), name, tags, icon, content, subsubtabs: [] });
    }

    closeModal();
    renderSidebar();
    if (state.currentTab === tabId) renderContent();
}

function deleteSubtab(tabId, subtabId) {
    if (!confirm('Удалить подраздел?')) return;
    const tabs = state.data[state.currentSection].tabs;
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || !tab.subtabs) return;
    const index = tab.subtabs.findIndex(s => s.id === subtabId);
    if (index > -1) tab.subtabs.splice(index, 1);
    if (state.currentSubtab === subtabId) { state.currentSubtab = null; state.currentSubsubtab = null; }
    closeModal();
    renderSidebar();
    renderContent();
}

// ===== subsubtab crud =====

function openSubsubtabModal(tabId, subtabId, subsubtabId = null) {
    const tabs = state.data[state.currentSection]?.tabs || [];
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const subtab = tab.subtabs?.find(s => s.id === subtabId);
    if (!subtab) return;
    const subsubtab = subsubtabId ? subtab.subsubtabs?.find(ss => ss.id === subsubtabId) : null;
    const isEdit = !!subsubtab;

    const footerHtml = `
        ${isEdit ? `<button class="btn btn-danger" onclick="deleteSubsubtab('${tabId}', '${subtabId}', '${subsubtabId}')">Удалить</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal()">Отмена</button>
        <button class="btn btn-primary" onclick="saveSubsubtab('${tabId}', '${subtabId}', '${subsubtabId || ''}')">${isEdit ? 'Сохранить' : 'Создать'}</button>
    `;

    openModal(isEdit ? 'Редактировать подподраздел' : 'Новый подподраздел', getModalFormHtml(subsubtab || {}), footerHtml);
    setupIconPreview();
}

function saveSubsubtab(tabId, subtabId, subsubtabId) {
    const name = document.getElementById('itemName').value.trim();
    const tags = document.getElementById('itemTags').value.split(',').map(t => t.trim()).filter(t => t);
    const icon = document.getElementById('itemIcon').value.trim();
    const content = document.getElementById('itemContent').value;

    if (!name) { alert('Введите название'); return; }

    const tabs = state.data[state.currentSection].tabs;
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const subtab = tab.subtabs?.find(s => s.id === subtabId);
    if (!subtab) return;
    if (!subtab.subsubtabs) subtab.subsubtabs = [];

    if (subsubtabId) {
        const subsubtab = subtab.subsubtabs.find(ss => ss.id === subsubtabId);
        if (subsubtab) { subsubtab.name = name; subsubtab.tags = tags; subsubtab.icon = icon; subsubtab.content = content; }
    } else {
        subtab.subsubtabs.push({ id: 'subsubtab_' + Date.now(), name, tags, icon, content });
    }

    closeModal();
    renderSidebar();
    renderContent();
}

function deleteSubsubtab(tabId, subtabId, subsubtabId) {
    if (!confirm('Удалить подподраздел?')) return;
    const tabs = state.data[state.currentSection].tabs;
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const subtab = tab.subtabs?.find(s => s.id === subtabId);
    if (!subtab || !subtab.subsubtabs) return;
    const index = subtab.subsubtabs.findIndex(ss => ss.id === subsubtabId);
    if (index > -1) subtab.subsubtabs.splice(index, 1);
    if (state.currentSubsubtab === subsubtabId) state.currentSubsubtab = null;
    closeModal();
    renderSidebar();
    renderContent();
}

// quick content edit
function openContentEditModal() {
    if (!state.currentTab) return;
    const tabs = state.data[state.currentSection]?.tabs || [];
    const tab = tabs.find(t => t.id === state.currentTab);
    if (!tab) return;

    let content = '', title = '';

    if (state.currentSubsubtab && state.currentSubtab) {
        const subtab = tab.subtabs?.find(s => s.id === state.currentSubtab);
        const subsubtab = subtab?.subsubtabs?.find(ss => ss.id === state.currentSubsubtab);
        if (subsubtab) { content = subsubtab.content || ''; title = `Редактировать: ${subsubtab.name}`; }
    } else if (state.currentSubtab) {
        const subtab = tab.subtabs?.find(s => s.id === state.currentSubtab);
        if (subtab) { content = subtab.content || ''; title = `Редактировать: ${subtab.name}`; }
    } else {
        content = tab.content || '';
        title = `Редактировать: ${tab.name}`;
    }

    const bodyHtml = `
        <div class="form-group">
            <label class="form-label">Содержимое (Markdown). Цвета: &red слово, &green слово и т.д.</label>
            <textarea class="form-input form-textarea" id="editContent" style="min-height: 300px;">${escapeHtml(content)}</textarea>
        </div>
    `;

    openModal(title, bodyHtml, `
        <button class="btn btn-secondary" onclick="closeModal()">Отмена</button>
        <button class="btn btn-primary" onclick="saveContentEdit()">Сохранить</button>
    `);
}

function saveContentEdit() {
    const content = document.getElementById('editContent').value;
    const tabs = state.data[state.currentSection].tabs;
    const tab = tabs.find(t => t.id === state.currentTab);
    if (!tab) return;

    if (state.currentSubsubtab && state.currentSubtab) {
        const subtab = tab.subtabs?.find(s => s.id === state.currentSubtab);
        const subsubtab = subtab?.subsubtabs?.find(ss => ss.id === state.currentSubsubtab);
        if (subsubtab) subsubtab.content = content;
    } else if (state.currentSubtab) {
        const subtab = tab.subtabs?.find(s => s.id === state.currentSubtab);
        if (subtab) subtab.content = content;
    } else {
        tab.content = content;
    }

    closeModal();
    renderContent();
}

// make crud functions global
window.openTabModal = openTabModal;
window.saveTab = saveTab;
window.deleteTab = deleteTab;
window.openSubtabModal = openSubtabModal;
window.saveSubtab = saveSubtab;
window.deleteSubtab = deleteSubtab;
window.openSubsubtabModal = openSubsubtabModal;
window.saveSubsubtab = saveSubsubtab;
window.deleteSubsubtab = deleteSubsubtab;
window.openContentEditModal = openContentEditModal;
window.saveContentEdit = saveContentEdit;
window.closeModal = closeModal;

// ===== search =====

function handleSearch() {
    const query = elements.searchInput.value.trim().toLowerCase();
    if (!query || query.length < 2) { elements.searchResults.classList.remove('visible'); return; }

    const results = [];

    Object.entries(state.data).forEach(([sectionId, section]) => {
        const sectionName = { 'reglament': 'Регламент', 'templates-withdrawal': 'Шаблоны выплаты', 'templates-deposit': 'Шаблоны депозита' }[sectionId];

        (section.tabs || []).forEach(tab => {
            addSearchResult(results, sectionId, sectionName, tab, null, null, query);

            (tab.subtabs || []).forEach(subtab => {
                addSearchResult(results, sectionId, sectionName, tab, subtab, null, query);

                (subtab.subsubtabs || []).forEach(subsubtab => {
                    addSearchResult(results, sectionId, sectionName, tab, subtab, subsubtab, query);
                });
            });
        });
    });

    results.sort((a, b) => b.score - a.score);

    if (results.length === 0) {
        elements.searchResults.innerHTML = `<div class="search-result-item"><div class="search-result-title">Ничего не найдено</div></div>`;
    } else {
        elements.searchResults.innerHTML = results.slice(0, 15).map(r => {
            const preview = getSearchPreview(r.content, r.query);
            const matchBadge = r.matchType === 'fuzzy' ? `<span class="search-result-match">~${Math.round(r.score * 100)}%</span>` : '';
            return `
                <div class="search-result-item" onclick='navigateToResult(${JSON.stringify(r).replace(/'/g, "\\'")})'>
                    <div class="search-result-title">${escapeHtml(r.name)} ${matchBadge}</div>
                    <div class="search-result-path">${escapeHtml(r.path)}</div>
                    ${preview ? `<div class="search-result-preview">${preview}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    elements.searchResults.classList.add('visible');
}

function addSearchResult(results, sectionId, sectionName, tab, subtab, subsubtab, query) {
    const item = subsubtab || subtab || tab;
    const nameMatch = fuzzyMatch(query, item.name);
    const contentMatch = fuzzyMatch(query, item.content || '');
    const tagsMatch = (item.tags || []).map(t => fuzzyMatch(query, t)).find(m => m.match);

    if (nameMatch.match || contentMatch.match || tagsMatch) {
        const bestMatch = [nameMatch, contentMatch, tagsMatch].filter(m => m?.match).sort((a, b) => b.score - a.score)[0];
        
        let path = sectionName + ' → ' + tab.name;
        if (subtab) path += ' → ' + subtab.name;
        if (subsubtab) path += ' → ' + subsubtab.name;

        let highlightText = query;
        if (contentMatch.match && item.content) {
            const match = findBestMatch(query, item.content);
            if (match) highlightText = match.matched;
        }

        results.push({
            section: sectionId,
            tabId: tab.id,
            subtabId: subtab?.id || null,
            subsubtabId: subsubtab?.id || null,
            name: item.name,
            path,
            content: item.content || '',
            query,
            highlightText,
            score: bestMatch.score,
            matchType: bestMatch.type
        });
    }
}

function getSearchPreview(content, query) {
    if (!content) return '';
    
    const match = findBestMatch(query, content);
    if (!match) return '';
    
    const start = Math.max(0, match.index - 30);
    const end = Math.min(content.length, match.index + match.length + 30);
    let preview = content.substring(start, end);
    if (start > 0) preview = '...' + preview;
    if (end < content.length) preview = preview + '...';
    
    const matchInPreview = preview.indexOf(match.matched);
    if (matchInPreview !== -1) {
        preview = escapeHtml(preview.substring(0, matchInPreview)) + 
                  '<mark>' + escapeHtml(match.matched) + '</mark>' +
                  escapeHtml(preview.substring(matchInPreview + match.length));
    } else {
        preview = escapeHtml(preview);
    }
    
    return preview;
}

function navigateToResult(result) {
    state.currentSection = result.section;
    elements.navTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.section === result.section));

    state.currentTab = result.tabId;
    state.currentSubtab = result.subtabId;
    state.currentSubsubtab = result.subsubtabId;
    if (result.subtabId) state.expandedSubtabs.add(result.subtabId);

    renderSidebar();
    renderContent();
    updateHash();

    elements.searchResults.classList.remove('visible');
    elements.searchInput.value = '';

    setTimeout(() => highlightSearchText(result.highlightText || result.query), 200);
}

window.navigateToResult = navigateToResult;

function highlightSearchText(query) {
    // makes a glowing box around found text
    const contentEl = elements.contentBody.querySelector('.markdown-content');
    if (!contentEl) return;

    const textContent = contentEl.textContent || contentEl.innerText;
    const match = findBestMatch(query, textContent);
    if (!match) return;

    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    let currentPos = 0;
    let foundNode = null;
    let foundOffset = 0;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const nodeLength = node.textContent.length;
        
        if (currentPos + nodeLength > match.index) {
            foundNode = node;
            foundOffset = match.index - currentPos;
            break;
        }
        currentPos += nodeLength;
    }

    if (!foundNode) return;

    const parentEl = foundNode.parentElement;
    if (parentEl) {
        parentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    setTimeout(() => {
        try {
            const range = document.createRange();
            const endOffset = Math.min(foundOffset + match.length, foundNode.textContent.length);
            range.setStart(foundNode, foundOffset);
            range.setEnd(foundNode, endOffset);
            const rect = range.getBoundingClientRect();

            if (rect.width === 0 || rect.height === 0) return;

            const box = elements.searchHighlightBox;
            const padding = 4;
            
            box.style.left = (rect.left - padding) + 'px';
            box.style.top = (rect.top - padding) + 'px';
            box.style.width = (rect.width + padding * 2) + 'px';
            box.style.height = (rect.height + padding * 2) + 'px';
            
            box.classList.remove('fading');
            box.classList.add('active');

            setTimeout(() => {
                box.classList.add('fading');
                setTimeout(() => {
                    box.classList.remove('active', 'fading');
                }, 500);
            }, 2500);
        } catch (e) {
            console.log('highlight error:', e);
        }
    }, 500);
}

// ===== url hash for deep linking =====

function updateHash() {
    let hash = state.currentSection;
    if (state.currentTab) {
        hash += '/' + state.currentTab;
        if (state.currentSubtab) {
            hash += '/' + state.currentSubtab;
            if (state.currentSubsubtab) {
                hash += '/' + state.currentSubsubtab;
            }
        }
    }
    window.location.hash = hash;
}

function handleHash() {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const parts = hash.split('/');
    const section = parts[0];

    if (['reglament', 'templates-withdrawal', 'templates-deposit'].includes(section)) {
        state.currentSection = section;
        elements.navTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.section === section));
    }

    if (parts[1]) state.currentTab = parts[1];
    if (parts[2]) { state.currentSubtab = parts[2]; state.expandedSubtabs.add(parts[2]); }
    if (parts[3]) state.currentSubsubtab = parts[3];

    renderSidebar();
    if (state.currentTab) renderContent();
}

// ===== save/load json files =====

function saveToFile() {
    const dataStr = JSON.stringify(state.data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function loadFromFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            state.data = JSON.parse(e.target.result);
            state.currentTab = null;
            state.currentSubtab = null;
            state.currentSubsubtab = null;
            renderSidebar();
            showEmptyState();
            alert('Данные успешно загружены!');
        } catch (err) {
            alert('Ошибка загрузки файла: ' + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// ===== utils =====

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// start the app
init();