/**
 * 바로바로 프롬프트 (Prompt-Copy) - 메인 애플리케이션 로직
 * - 원페이지 단일 페이지 앱
 * - 구글 스프레드시트 실시간 동기화 + 번들 데이터 폴백
 * - 프롬프트 이름 및 본문 실시간 검색 & 키워드 하이라이팅
 * - 원클릭 클립보드 복사 & 시각적 피드백 토스트
 * - 테이블 뷰 / 카드 뷰 전환 & 상세 모달
 */

// 구글 스프레드시트 설정
const SPREADSHEET_ID = '1oIxQt5rl1mL8-9GbLtNji8IqMDwr3QDewN370GsZ6XM';
const SPREADSHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;

// 전역 상태
let allPrompts = [];
let filteredPrompts = [];
let currentFilterTag = 'ALL';
let currentSearchQuery = '';
let currentViewMode = 'table'; // 'table' | 'card'
let currentPage = 1;
let itemsPerPage = parseInt(localStorage.getItem('prompt_copy_page_size') || '10', 10);

// DOM 엘리먼트 캐싱
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const filterTagsContainer = document.getElementById('filterTags');
const resultsCountEl = document.getElementById('resultsCount');
const tableBody = document.getElementById('tableBody');
const cardGrid = document.getElementById('cardGrid');
const tableViewWrapper = document.getElementById('tableViewWrapper');
const emptyState = document.getElementById('emptyState');
const paginationContainer = document.getElementById('paginationContainer');
const paginationInfo = document.getElementById('paginationInfo');
const paginationControls = document.getElementById('paginationControls');
const pageSizeSelect = document.getElementById('pageSizeSelect');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const refreshBtn = document.getElementById('refreshBtn');
const syncStatusText = document.getElementById('syncStatusText');
const viewTableBtn = document.getElementById('viewTableBtn');
const viewCardBtn = document.getElementById('viewCardBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalContent = document.getElementById('modalContent');
const modalCopyBtn = document.getElementById('modalCopyBtn');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const toastContainer = document.getElementById('toastContainer');

// ==========================================================================
// 1. 초기화 & 데이터 로드
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();

  // 기본 번들 데이터가 있으면 우선 즉각 렌더링
  if (window.INITIAL_PROMPTS && Array.isArray(window.INITIAL_PROMPTS) && window.INITIAL_PROMPTS.length > 0) {
    allPrompts = [...window.INITIAL_PROMPTS];
    renderFilterTags();
    applyFilter();
    updateSyncStatus('로컬 데이터 로드됨', false);
  }

  // 백그라운드에서 구글 스프레드시트 최신 데이터 실시간 동기화 시도
  fetchSpreadsheetData();
});

// CSV 문자열 안전 파서 (따옴표 내 쉼표, 줄바꿈 처리)
function parseCSV(text) {
  const p = [];
  let row = [''];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      p.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== '') {
    p.push(row);
  }
  return p;
}

// 구글 스프레드시트 데이터 불러오기
async function fetchSpreadsheetData() {
  updateSyncStatus('스프레드시트 동기화 중...', true);
  try {
    const res = await fetch(SPREADSHEET_CSV_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const csvText = await res.text();
    const rows = parseCSV(csvText);

    if (rows.length > 1) {
      const items = [];
      // 첫 행(헤더) 제외하고 순회
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const name = (row[0] || '').trim();
        const prompt = (row[1] || '').trim();
        if (name || prompt) {
          items.push({
            id: items.length + 1,
            name: name || `프롬프트 #${items.length + 1}`,
            prompt: prompt
          });
        }
      }

      if (items.length > 0) {
        allPrompts = items;
        renderFilterTags();
        applyFilter();
        updateSyncStatus(`실시간 연동됨 (${items.length}개)`, false);
        showToast(`구글 스프레드시트에서 ${items.length}개의 프롬프트를 불러왔습니다.`);
        return;
      }
    }
    throw new Error('빈 데이터 응답');
  } catch (err) {
    console.warn('스프레드시트 실시간 연동 실패, 번들 데이터를 사용합니다:', err);
    if (!allPrompts.length && window.INITIAL_PROMPTS) {
      allPrompts = [...window.INITIAL_PROMPTS];
      renderFilterTags();
      applyFilter();
    }
    updateSyncStatus(`로컬 데이터 연결됨 (${allPrompts.length}개)`, false);
  }
}

function updateSyncStatus(text, isSyncing) {
  if (syncStatusText) {
    syncStatusText.textContent = text;
  }
  const dot = document.querySelector('.status-dot');
  if (dot) {
    dot.style.backgroundColor = isSyncing ? '#f59e0b' : '#10b981';
    dot.style.boxShadow = isSyncing ? '0 0 8px #f59e0b' : '0 0 8px #10b981';
  }
}

// ==========================================================================
// 2. 카테고리 / 태그 필터 생성
// ==========================================================================
function renderFilterTags() {
  if (!filterTagsContainer) return;

  // 고유한 프롬프트 이름 목록 추출
  const names = Array.from(new Set(allPrompts.map(p => p.name).filter(Boolean)));
  
  let html = `<button class="filter-tag ${currentFilterTag === 'ALL' ? 'active' : ''}" data-tag="ALL">전체 (${allPrompts.length})</button>`;
  
  names.forEach(name => {
    const count = allPrompts.filter(p => p.name === name).length;
    html += `<button class="filter-tag ${currentFilterTag === name ? 'active' : ''}" data-tag="${escapeHtml(name)}">${escapeHtml(name)} (${count})</button>`;
  });

  filterTagsContainer.innerHTML = html;

  // 태그 클릭 이벤트
  filterTagsContainer.querySelectorAll('.filter-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilterTag = btn.dataset.tag;
      filterTagsContainer.querySelectorAll('.filter-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilter();
    });
  });
}

// ==========================================================================
// 3. 검색 및 필터링 로직
// ==========================================================================
function applyFilter(resetPage = true) {
  if (resetPage) {
    currentPage = 1;
  }

  const query = currentSearchQuery.trim().toLowerCase();
  const searchWords = query.split(/\s+/).filter(Boolean);

  filteredPrompts = allPrompts.filter(item => {
    // 1) 태그 필터 검사
    if (currentFilterTag !== 'ALL' && item.name !== currentFilterTag) {
      return false;
    }

    // 2) 검색어 검사 (이름 + 본문에서 검색어 단어들이 모두 포함되는지)
    if (searchWords.length > 0) {
      const targetText = `${item.name} ${item.prompt}`.toLowerCase();
      const allMatched = searchWords.every(word => targetText.includes(word));
      if (!allMatched) return false;
    }

    return true;
  });

  // 검색 결과 카운트 갱신
  if (resultsCountEl) {
    if (query || currentFilterTag !== 'ALL') {
      resultsCountEl.innerHTML = `검색 결과: <strong>${filteredPrompts.length}</strong>개 (전체 ${allPrompts.length}개)`;
    } else {
      resultsCountEl.innerHTML = `등록된 프롬프트: <strong>${allPrompts.length}</strong>개`;
    }
  }

  // 현재 페이지 데이터 렌더링
  renderCurrentPage();
}

// ==========================================================================
// 3-1. 페이지별 렌더링 총괄 (테이블/카드 + 페이지네이션 바)
// ==========================================================================
function renderCurrentPage() {
  const totalItems = filteredPrompts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  // 1) 결과가 없을 때 (Empty State)
  if (totalItems === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (tableViewWrapper) tableViewWrapper.style.display = 'none';
    if (cardGrid) cardGrid.style.display = 'none';
    if (paginationContainer) paginationContainer.style.display = 'none';
    return;
  }

  // 2) 결과가 있을 때
  if (emptyState) emptyState.style.display = 'none';
  if (paginationContainer) paginationContainer.style.display = 'flex';

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const paginatedItems = filteredPrompts.slice(startIndex, endIndex);

  if (currentViewMode === 'table') {
    if (tableViewWrapper) tableViewWrapper.style.display = 'block';
    if (cardGrid) cardGrid.style.display = 'none';
    renderTableView(paginatedItems, startIndex);
  } else {
    if (tableViewWrapper) tableViewWrapper.style.display = 'none';
    if (cardGrid) cardGrid.style.display = 'grid';
    renderCardView(paginatedItems, startIndex);
  }

  renderPaginationControls(totalItems, totalPages, startIndex, endIndex);
}

// ==========================================================================
// 3-2. 페이지네이션 컨트롤 바 렌더링
// ==========================================================================
function renderPaginationControls(totalItems, totalPages, startIndex, endIndex) {
  if (!paginationContainer || !paginationControls || !paginationInfo) return;

  // 정보 텍스트 (예: 1 - 10 / 36개 표시)
  paginationInfo.innerHTML = `총 <strong>${totalItems}</strong>개 중 <strong>${startIndex + 1}-${endIndex}</strong>개 표시 (<strong>${currentPage}</strong> / ${totalPages} 페이지)`;

  const isFirst = currentPage === 1;
  const isLast = currentPage === totalPages;

  let html = '';

  // 처음으로 («)
  html += `
    <button class="page-btn" ${isFirst ? 'disabled' : ''} onclick="goToPage(1)" title="첫 페이지로 이동" aria-label="첫 페이지">
      «
    </button>
  `;

  // 이전 (‹)
  html += `
    <button class="page-btn" ${isFirst ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})" title="이전 페이지로 이동" aria-label="이전 페이지">
      ‹
    </button>
  `;

  // 페이지 번호 리스트 (스마트 생략 부호 처리)
  const pageNumbers = getPaginationPageNumbers(currentPage, totalPages);
  pageNumbers.forEach(pageNum => {
    if (pageNum === '...') {
      html += `<span class="page-ellipsis">…</span>`;
    } else {
      const isActive = pageNum === currentPage;
      html += `
        <button 
          class="page-btn ${isActive ? 'active' : ''}" 
          ${isActive ? 'disabled aria-current="page"' : `onclick="goToPage(${pageNum})"`} 
          title="${pageNum} 페이지로 이동"
        >
          ${pageNum}
        </button>
      `;
    }
  });

  // 다음 (›)
  html += `
    <button class="page-btn" ${isLast ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})" title="다음 페이지로 이동" aria-label="다음 페이지">
      ›
    </button>
  `;

  // 마지막으로 (»)
  html += `
    <button class="page-btn" ${isLast ? 'disabled' : ''} onclick="goToPage(${totalPages})" title="마지막 페이지로 이동" aria-label="마지막 페이지">
      »
    </button>
  `;

  paginationControls.innerHTML = html;
}

// 스마트 페이지 번호 계산 유틸리티
function getPaginationPageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = [];
  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  } else if (current >= total - 3) {
    pages.push(1);
    pages.push('...');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    pages.push('...');
    pages.push(current - 1);
    pages.push(current);
    pages.push(current + 1);
    pages.push('...');
    pages.push(total);
  }
  return pages;
}

// 특정 페이지 이동
function goToPage(page) {
  const totalPages = Math.ceil(filteredPrompts.length / itemsPerPage) || 1;
  if (page < 1 || page > totalPages || page === currentPage) return;

  currentPage = page;
  renderCurrentPage();

  // 상단 컨트롤 바로 부드럽게 스크롤
  const targetElement = document.querySelector('.controls-bar') || tableViewWrapper;
  if (targetElement) {
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ==========================================================================
// 4. 테이블 뷰 렌더링
// ==========================================================================
function renderTableView(items, startIndex = 0) {
  if (!tableBody) return;

  const rowsHtml = items.map((item, index) => {
    const itemNumber = startIndex + index + 1;
    const highlightedName = highlightQuery(escapeHtml(item.name), currentSearchQuery);
    const highlightedPrompt = highlightQuery(escapeHtml(item.prompt), currentSearchQuery);

    return `
      <tr data-id="${item.id}">
        <td class="col-id">${itemNumber}</td>
        <td class="col-name">
          <span class="prompt-name-badge">${highlightedName}</span>
        </td>
        <td class="col-prompt">
          <div class="prompt-preview" title="클릭하여 전체 보기" onclick="openDetailModal(${item.id})">
            ${highlightedPrompt}
          </div>
        </td>
        <td class="col-action">
          <button class="btn-view-detail" onclick="openDetailModal(${item.id})">자세히</button>
          <button class="btn-copy" onclick="copyPrompt(${item.id}, this)">
            <span class="btn-copy-icon">📋</span>
            <span class="btn-copy-text">복사하기</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tableBody.innerHTML = rowsHtml;
}

// ==========================================================================
// 5. 카드 그리드 뷰 렌더링
// ==========================================================================
function renderCardView(items, startIndex = 0) {
  if (!cardGrid) return;

  const cardsHtml = items.map((item, index) => {
    const itemNumber = startIndex + index + 1;
    const highlightedName = highlightQuery(escapeHtml(item.name), currentSearchQuery);
    const highlightedPrompt = highlightQuery(escapeHtml(item.prompt), currentSearchQuery);

    return `
      <div class="prompt-card" data-id="${item.id}">
        <div class="card-header">
          <div>
            <span class="card-number">#${itemNumber}</span>
            <h3 class="card-title">${highlightedName}</h3>
          </div>
        </div>
        <div class="card-body" onclick="openDetailModal(${item.id})" title="클릭하여 전체 보기">
          ${highlightedPrompt}
        </div>
        <div class="card-footer">
          <button class="btn-view-detail" onclick="openDetailModal(${item.id})">전체 읽기</button>
          <button class="btn-copy" onclick="copyPrompt(${item.id}, this)">
            <span class="btn-copy-icon">📋</span>
            <span class="btn-copy-text">복사하기</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  cardGrid.innerHTML = cardsHtml;
}

// ==========================================================================
// 6. 클립보드 원클릭 복사 & 인터랙션
// ==========================================================================
async function copyPrompt(id, btnElement) {
  const item = allPrompts.find(p => p.id === id);
  if (!item) return;

  const textToCopy = item.prompt;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(textToCopy);
    } else {
      // 폴백 복사
      const textArea = document.createElement('textarea');
      textArea.value = textToCopy;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    // 복사 성공 피드백 애니메이션
    if (btnElement) {
      const originalText = btnElement.querySelector('.btn-copy-text')?.textContent || '복사하기';
      const iconSpan = btnElement.querySelector('.btn-copy-icon');
      const textSpan = btnElement.querySelector('.btn-copy-text');

      btnElement.classList.add('copied');
      if (iconSpan) iconSpan.textContent = '✅';
      if (textSpan) textSpan.textContent = '복사 완료!';

      setTimeout(() => {
        btnElement.classList.remove('copied');
        if (iconSpan) iconSpan.textContent = '📋';
        if (textSpan) textSpan.textContent = originalText;
      }, 1600);
    }

    showToast(`'${item.name}' 프롬프트가 복사되었습니다!`);
  } catch (err) {
    console.error('클립보드 복사 실패:', err);
    showToast('복사에 실패했습니다. 브라우저 권한을 확인해주세요.', true);
  }
}

// 모달 내 복사 버튼
if (modalCopyBtn) {
  modalCopyBtn.addEventListener('click', () => {
    const currentId = parseInt(modalCopyBtn.dataset.currentId, 10);
    if (currentId) {
      copyPrompt(currentId, modalCopyBtn);
    }
  });
}

// ==========================================================================
// 7. 모달 창 (상세 보기)
// ==========================================================================
function openDetailModal(id) {
  const item = allPrompts.find(p => p.id === id);
  if (!item) return;

  modalTitle.textContent = item.name;
  modalContent.textContent = item.prompt;
  modalCopyBtn.dataset.currentId = id;

  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDetailModal() {
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ==========================================================================
// 8. 토스트 알림
// ==========================================================================
function showToast(message, isError = false) {
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isError) {
    toast.style.borderColor = '#ef4444';
  }

  toast.innerHTML = `
    <span class="toast-icon">${isError ? '⚠️' : '✅'}</span>
    <span>${escapeHtml(message)}</span>
  `;

  toastContainer.appendChild(toast);

  // 애니메이션 효과
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 2400);
}

// ==========================================================================
// 9. 테마 토글 (Dark / Light)
// ==========================================================================
function initTheme() {
  const savedTheme = localStorage.getItem('prompt_copy_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('prompt_copy_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  if (!themeIcon) return;
  themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
  themeToggleBtn.setAttribute('title', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
}

// ==========================================================================
// 10. 이벤트 리스너 설정
// ==========================================================================
function setupEventListeners() {
  // 실시간 검색 입력
  searchInput.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value;
    clearSearchBtn.classList.toggle('active', currentSearchQuery.length > 0);
    applyFilter();
  });

  // 검색어 지우기 버튼
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentSearchQuery = '';
    clearSearchBtn.classList.remove('active');
    searchInput.focus();
    applyFilter();
  });

  // 뷰 전환 (현재 보고 있는 페이지 유지)
  viewTableBtn.addEventListener('click', () => {
    currentViewMode = 'table';
    viewTableBtn.classList.add('active');
    viewCardBtn.classList.remove('active');
    renderCurrentPage();
  });

  viewCardBtn.addEventListener('click', () => {
    currentViewMode = 'card';
    viewCardBtn.classList.add('active');
    viewTableBtn.classList.remove('active');
    renderCurrentPage();
  });

  // 테마 토글
  themeToggleBtn.addEventListener('click', toggleTheme);

  // 새로고침 버튼
  refreshBtn.addEventListener('click', () => {
    fetchSpreadsheetData();
  });

  // 모달 닫기
  modalCloseBtn.addEventListener('click', closeDetailModal);
  modalCancelBtn.addEventListener('click', closeDetailModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeDetailModal();
  });

  // ESC 키로 모달 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
      closeDetailModal();
    }
  });

  // 페이지당 표시 개수 변경
  if (pageSizeSelect) {
    pageSizeSelect.value = String(itemsPerPage);
    pageSizeSelect.addEventListener('change', (e) => {
      itemsPerPage = parseInt(e.target.value, 10);
      localStorage.setItem('prompt_copy_page_size', String(itemsPerPage));
      currentPage = 1;
      renderCurrentPage();
    });
  }

  // 검색 초기화 버튼 (empty-state 내)
  const resetBtn = document.getElementById('resetSearchBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      searchInput.value = '';
      currentSearchQuery = '';
      currentFilterTag = 'ALL';
      clearSearchBtn.classList.remove('active');
      renderFilterTags();
      applyFilter();
    });
  }
}

// ==========================================================================
// 11. 유틸리티 함수
// ==========================================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightQuery(text, query) {
  if (!query || !query.trim()) return text;
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return text;

  // 특수문자 이스케이프
  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi');
  return text.replace(regex, '<mark class="highlight">$1</mark>');
}

// 전역 공개 (HTML onclick 인라인 호출용)
window.copyPrompt = copyPrompt;
window.openDetailModal = openDetailModal;
window.closeDetailModal = closeDetailModal;
window.goToPage = goToPage;
