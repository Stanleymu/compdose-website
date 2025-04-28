// HTML escape helper
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Import Markdown parser for modal
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@4.3.0/lib/marked.esm.js';

// Smart truncate to sentence or word boundary
function smartTruncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  const substr = text.slice(0, maxLen);
  const lastPeriod = substr.lastIndexOf('.');
  let cut = -1;
  if (lastPeriod > 0) {
    cut = lastPeriod + 1;
  } else {
    const lastSpace = substr.lastIndexOf(' ');
    cut = lastSpace > 0 ? lastSpace : maxLen;
  }
  return substr.slice(0, cut).trim() + '...';
}

// Client-side logic for PDF fetch and display
window.addEventListener('DOMContentLoaded', () => {
  const summariesContainer = document.getElementById('summaries');
  // Dark-mode toggle init
  const themeSwitch = document.getElementById('themeSwitch');
  const savedTheme = localStorage.getItem('theme') || 'light';
  const htmlEl = document.documentElement;
  // Apply saved theme
  if (savedTheme === 'dark') {
    htmlEl.classList.add('dark-mode');
  } else {
    htmlEl.classList.remove('dark-mode');
  }
  if (themeSwitch) {
    themeSwitch.checked = savedTheme === 'dark';
    themeSwitch.addEventListener('change', e => {
      if (e.target.checked) {
        htmlEl.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
      } else {
        htmlEl.classList.remove('dark-mode');
        localStorage.setItem('theme', 'light');
      }
    });
  }

  const pagination = document.getElementById('pagination');
  let summaryList = [];
  let currentPage = 1;
  const pageSize = 6;

  function renderPage(page) {
    summariesContainer.innerHTML = '';
    const start = (page - 1) * pageSize;
    const pageItems = summaryList.slice(start, start + pageSize);
    pageItems.forEach(summary => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-lg-4';

      // Title without .pdf
      const fname = summary.fileName || '';
      const base = fname.toLowerCase().endsWith('.pdf') ? fname.slice(0, -4) : fname;
      const title = escapeHTML(base);

      // Date formatted YYYY-MM-DD
      const processedAt = summary.processedAt || '';
      const dateStr = processedAt.split('T')[0];

      // Summary text: support legacy object entries
      const raw = (() => {
        if (summary.summary) {
          if (typeof summary.summary.executive_summary === 'string' && summary.summary.executive_summary) {
            return summary.summary.executive_summary;
          }
          return JSON.stringify(summary.summary, null, 2);
        }
        // Legacy fallback
        if (typeof summary.finalSummary === 'string' && summary.finalSummary) {
          return summary.finalSummary;
        }
        if (Array.isArray(summary.summaries)) {
          return summary.summaries
            .map(chunk => {
              if (typeof chunk === 'string') return chunk;
              if (chunk.choices?.[0]?.message?.content) return chunk.choices[0].message.content;
              return JSON.stringify(chunk);
            })
            .join(' ');
        }
        return '';
      })();
      // Remove all markdown headings and markers
      const plain = raw.replace(/#+\s*/g, '').trim();
      // Truncate: short text at first sentence, long text via smartTruncate
      const maxLen = 300;
      let truncated;
      if (plain.length <= maxLen) {
        const idx = plain.indexOf('.');
        truncated = idx > -1 ? plain.slice(0, idx + 1) : plain;
      } else {
        truncated = smartTruncate(plain, maxLen);
      }
      // Add ellipsis if text was cut
      if (truncated.length < plain.length) truncated += '...';

      // Split summary into up to 3 bullet points
      const sentences = plain.split('. ').filter(Boolean);
      const bulletItems = sentences.slice(0, 3).map(s => s.endsWith('.') ? s : s + '.');
      const bulletList = `<ul class="summary-list mb-3">${bulletItems.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`;

      const jsonFile = encodeURIComponent(`${base}.json`);

      col.innerHTML = `
        <div class="article-card card h-100 border-0 shadow-sm" role="region" aria-label="Summary: ${title}">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="card-title mb-0">${title}</h5>
            <span class="badge bg-secondary">${dateStr}</span>
          </div>
          <div class="card-body">
            ${bulletList}
          </div>
          <div class="card-footer d-flex justify-content-end">
            <button type="button" class="btn btn-primary btn-analyze" data-filename="${fname}">Analyze</button>
          </div>
        </div>
      `;
      summariesContainer.appendChild(col);
      // store full text for search
      col.querySelector('.article-card').dataset.plain = plain;

      // Attach click handler for modal display
      const btn = col.querySelector('.btn-analyze');
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const lastFocused = document.activeElement;
        const filename = btn.dataset.filename;
        const data = summaryList.find(item => item.fileName === filename);
        showSummaryModal(data);
      });
    });
  }

  function setupPagination() {
    pagination.innerHTML = '';
    const totalPages = Math.ceil(summaryList.length / pageSize);
    for (let i = 1; i <= totalPages; i++) {
      const li = document.createElement('li');
      li.className = 'page-item' + (i === currentPage ? ' active' : '');
      li.innerHTML = `<a class="page-link" href="#" aria-label="Page ${i}"${i===currentPage?' aria-current="page"':''}>${i}</a>`;
      li.addEventListener('click', e => {
        e.preventDefault();
        currentPage = i;
        renderPage(i);
        setupPagination();
      });
      pagination.appendChild(li);
    }
  }

  function showSkeletons() {
    summariesContainer.innerHTML = '';
    for (let i = 0; i < pageSize; i++) {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-lg-4';
      col.innerHTML = `
        <div class="article-card card h-100 border-0 shadow-sm skeleton-card">
          <div class="card-header skeleton skeleton-title"></div>
          <div class="card-body">
            <div class="skeleton skeleton-text mb-2"></div>
            <div class="skeleton skeleton-text mb-2"></div>
            <div class="skeleton skeleton-text"></div>
          </div>
          <div class="card-footer skeleton skeleton-button"></div>
        </div>
      `;
      summariesContainer.appendChild(col);
    }
  }

  async function fetchSummaries() {
    showSkeletons();
    try {
      const resp = await fetch('/api/summaries');
      summaryList = await resp.json();
      setupPagination();
      renderPage(1);
    } catch (err) {
      summariesContainer.innerHTML = `
        <div class="col-12">
          <div class="alert alert-danger d-flex justify-content-between align-items-center" role="alert">
            <span>Error loading summaries: ${err.message}</span>
            <button class="btn btn-link p-0" id="retryBtn">Retry</button>
          </div>
        </div>
      `;
      const retryBtn = document.getElementById('retryBtn');
      if (retryBtn) retryBtn.addEventListener('click', fetchSummaries);
    }
  }

  // Debounce util to limit rapid calls
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  // Escape regex special chars
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  }

  // Initial load
  fetchSummaries();

  // Interactive search: filter displayed summaries on input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    // full-word search with debounce for precision and performance
    const handleSearch = debounce(e => {
      const raw = e.target.value.trim();
      // normalize input: lowercase and replace non-word chars with spaces
      const normalizedInput = raw.toLowerCase().replace(/[^\w\s]/g, ' ');
      const tokens = normalizedInput.split(/\s+/).filter(Boolean);
      const regexes = tokens.map(tok => new RegExp(`\\b${escapeRegex(tok)}\\b`, 'i'));
      document.querySelectorAll('.article-card').forEach(card => {
        const col = card.parentElement;
        // normalize haystack: lowercase and strip special chars
        const rawHaystack = card.dataset.plain || '';
        const normalizedHaystack = rawHaystack.toLowerCase().replace(/[^\w\s]/g, ' ');
        if (!regexes.length || regexes.every(rx => rx.test(normalizedHaystack))) {
          col.style.display = '';
          // snippet preview
          const filename = card.querySelector('.btn-analyze').dataset.filename;
          const summaryObj = summaryList.find(s => s.fileName === filename) || {};
          let rawFull = '';
          if (typeof summaryObj.finalSummary === 'string') rawFull = summaryObj.finalSummary;
          else if (Array.isArray(summaryObj.summaries)) rawFull = summaryObj.summaries
            .map(c => typeof c === 'string' ? c : (c.choices?.[0]?.message?.content || JSON.stringify(c)))
            .join(' ');
          const plainFull = rawFull.replace(/#+\s*/g, '').trim();
          const sentencesFull = plainFull.split('. ').filter(Boolean);
          const snippetIdx = sentencesFull.findIndex(sent => tokens.every(tok => sent.toLowerCase().includes(tok)));
          let previewEl = card.querySelector('.snippet-preview');
          if (tokens.length && snippetIdx > -1) {
            const sentence = sentencesFull[snippetIdx];
            const regex = new RegExp(`(${tokens.join('|')})`, 'gi');
            const highlighted = sentence.replace(regex, '<mark>$1</mark>');
            if (!previewEl) {
              previewEl = document.createElement('div');
              previewEl.className = 'snippet-preview mt-2 small text-muted';
              card.querySelector('.card-body').appendChild(previewEl);
              previewEl.addEventListener('click', e => {
                if (!e.target.classList.contains('snippet-link')) return;
                e.preventDefault();
                const idx = e.target.dataset.para;
                const modalEl2 = document.getElementById('summaryModal');
                const bsModal2 = new bootstrap.Modal(modalEl2);
                bsModal2.show();
                document.getElementById('summaryModalLabel').textContent = title;
                modalEl2.addEventListener('shown.bs.modal', () => {
                  const target = document.getElementById(`para-${idx}`);
                  if (target) target.scrollIntoView({behavior:'smooth', block:'center'});
                }, {once:true});
              });
            }
            previewEl.innerHTML = `${highlighted} <a href="#" class="snippet-link ms-1" data-para="${snippetIdx}">(Full)</a>`;
          } else if (previewEl) {
            previewEl.remove();
          }
        } else {
          col.style.display = 'none';
          const previewEl2 = card.querySelector('.snippet-preview');
          if (previewEl2) previewEl2.remove();
        }
      });
    }, 300);
    searchInput.addEventListener('input', handleSearch);
  }

  function showSummaryModal(summaryData) {
    const modalTitle = document.getElementById('summaryModalLabel');
    const modalContent = document.getElementById('modalSummaryContent');
    let md = '';
    // First check for modern format
    if (summaryData && summaryData.version === "2.0" && summaryData.format === "markdown") {
      // Modern version 2.0 format
      md = summaryData.summary;
      console.log('Using version 2.0 summary format');
    } 
    // Legacy format fallbacks in order of preference
    else if (typeof summaryData === 'string') {
      md = summaryData;
      console.log('Using direct string summary');
    } else if (summaryData && typeof summaryData.summary === 'string') {
      md = summaryData.summary;
      console.log('Using summary.summary string');
    } else if (summaryData && summaryData.summary && typeof summaryData.summary.summary === 'string') {
      md = summaryData.summary.summary;
      console.log('Using summary.summary.summary nested structure');
    } else if (summaryData && typeof summaryData.finalSummary === 'string') {
      md = summaryData.finalSummary;
      console.log('Using finalSummary legacy format');
    } else if (summaryData && summaryData.summary && typeof summaryData.summary.executive_summary === 'string') {
      md = summaryData.summary.executive_summary;
      console.log('Using summary.executive_summary legacy format');
    } else {
      console.log('No summary found in data:', summaryData);
      md = 'No summary available.';
    }
    modalContent.innerHTML = marked.parse(md);
    modalTitle.textContent = (summaryData.fileName || 'Summary');
    const summaryModal = new bootstrap.Modal(document.getElementById('summaryModal'));
    summaryModal.show();
  }
});

// --- Mermaid.js rendering support ---
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.esm.min.mjs';

function renderMermaidDiagrams() {
  document.querySelectorAll('pre code.language-mermaid').forEach((block, idx) => {
    const parent = block.parentElement;
    const code = block.textContent;
    const container = document.createElement('div');
    container.className = 'mermaid';
    container.innerHTML = code;
    parent.replaceWith(container);
    // Mermaid will render all .mermaid elements
  });
  mermaid.run({ querySelector: '.mermaid' });
}

// Hook into modal display (after summary is rendered)
document.addEventListener('shown.bs.modal', function (event) {
  renderMermaidDiagrams();
});
// Also run after summaries are loaded (for inline diagrams)
document.addEventListener('DOMContentLoaded', function () {
  renderMermaidDiagrams();
});
