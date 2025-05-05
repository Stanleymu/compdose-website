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
    
    // Debug logging to see full list
    console.log('Rendering page', page, 'with', pageItems.length, 'items');
    
    pageItems.forEach((summary, index) => {
      // Log data format for debugging
      console.log(`Document ${index} data structure:`, summary);
      
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-lg-4 mb-4';

      // Title without .pdf
      const fname = summary.fileName || '';
      const base = fname.toLowerCase().endsWith('.pdf') ? fname.slice(0, -4) : fname;
      const title = escapeHTML(base);

      // Date formatted YYYY-MM-DD
      const processedAt = summary.processedAt || '';
      const dateStr = processedAt.split('T')[0];

      // Universal summary extraction that handles all formats consistently
      let summaryText = '';
      
      try {
        // Case 1: Direct access to summary property that is plain text
        if (typeof summary.summary === 'string') {
          // Check if it's a JSON string that needs parsing
          if (summary.summary.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(summary.summary);
              if (parsed.version === "2.0" && parsed.format === "markdown" && typeof parsed.summary === 'string') {
                // Properly extract the summary from parsed JSON
                summaryText = parsed.summary;
                console.log(`Document ${index}: Extracted from JSON string in summary property`);
              } else {
                // If JSON doesn't have the expected structure, use it as is
                summaryText = summary.summary;
                console.log(`Document ${index}: Using raw summary JSON string (unexpected format)`);
              }
            } catch (e) {
              // Not valid JSON or parsing error, use as plain text
              summaryText = summary.summary;
              console.log(`Document ${index}: Using plain text summary (JSON parse failed)`, e);
            }
          } else {
            // Not JSON, use directly
            summaryText = summary.summary;
            console.log(`Document ${index}: Using plain text summary (not JSON)`);
          }
        }
        // Case 2: Direct version 2.0 format in the root object
        else if (summary.version === "2.0" && summary.format === "markdown" && typeof summary.summary === 'string') {
          summaryText = summary.summary;
          console.log(`Document ${index}: Extracted from direct version 2.0 format`);
        }
        // Case 3: Nested executive_summary
        else if (summary.summary && typeof summary.summary.executive_summary === 'string') {
          summaryText = summary.summary.executive_summary;
          console.log(`Document ${index}: Using executive_summary property`);
        }
        // Case 4: finalSummary property (legacy)
        else if (typeof summary.finalSummary === 'string') {
          summaryText = summary.finalSummary;
          console.log(`Document ${index}: Using finalSummary property`);
        }
        // Case 5: Array of summaries
        else if (Array.isArray(summary.summaries)) {
          summaryText = summary.summaries
            .map(chunk => {
              if (typeof chunk === 'string') return chunk;
              if (chunk.choices?.[0]?.message?.content) return chunk.choices[0].message.content;
              return '';
            })
            .filter(Boolean)
            .join(' ');
          console.log(`Document ${index}: Concatenated from summaries array`);
        }
        // Fallback
        else {
          console.warn(`Document ${index}: Unknown summary format`, summary);
          summaryText = 'Summary not available in a supported format.';
        }
      } catch (e) {
        console.error(`Document ${index}: Error extracting summary:`, e);
        summaryText = 'Error processing summary data.';
      }

      // Clean up markdown formatting for display
      const plain = summaryText.replace(/#+\s*/g, '').trim();
      
      // Truncate: short text at first sentence, long text via smartTruncate
      const maxLen = 180; // Shorter for better card display
      let truncated;
      if (plain.length <= maxLen) {
        const idx = plain.indexOf('.');
        truncated = idx > 0 ? plain.slice(0, idx + 1) : plain;
      } else {
        truncated = smartTruncate(plain, maxLen);
      }
      
      // Add ellipsis if text was cut
      if (truncated.length < plain.length && !truncated.endsWith('...')) {
        truncated += '...';
      }

      // Extract key points (up to 3 sentences)
      // Improved sentence splitting that handles different types of punctuation
      const sentences = plain.split(/\.(?:\s|$)/).filter(sentence => sentence.trim().length > 10).map(s => s.trim());
      
      // Format document title for cleaner display
      let formattedTitle = title;
      // Extract document type and number if possible (e.g., "Circular 28")
      const docMatch = title.match(/(?:(circular|notice|guidance|gazette)\s*(?:no\.?\s*)?(\d+))/i);
      if (docMatch) {
        const [_, type, number] = docMatch;
        formattedTitle = `${type.charAt(0).toUpperCase() + type.slice(1)} ${number}`;
      }

      const jsonFile = encodeURIComponent(`${base}.json`);

      // Enhanced card template with proper structure and styling
      col.innerHTML = `
        <div class="article-card card h-100 border-0 shadow-sm" role="region" aria-label="Summary: ${formattedTitle}">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="card-title mb-0 text-truncate">${formattedTitle}</h5>
            ${dateStr ? `<span class="badge bg-primary rounded-pill ms-2">${dateStr}</span>` : ''}
          </div>
          <div class="card-body d-flex flex-column">
            <p class="card-text flex-grow-1">${escapeHTML(truncated)}</p>
            ${sentences.length > 1 ? `
            <div class="key-points mt-3">
              <div class="key-point-title fw-bold mb-2 small">Key Points:</div>
              <ul class="key-point-list ps-3 mb-0">
                ${sentences.slice(0, 3).map(point => `<li class="small text-secondary">${escapeHTML(point + '.')}</li>`).join('')}
              </ul>
            </div>` : ''}
          </div>
          <div class="card-footer d-flex justify-content-end align-items-center">
            <button type="button" class="btn btn-sm btn-outline-primary btn-analyze" data-filename="${escapeHTML(fname)}">
              Analyze
            </button>
          </div>
        </div>
      `;
      
      summariesContainer.appendChild(col);
      
      // Store plain text for search
      col.querySelector('.article-card').dataset.plain = plain;

      // Attach click handler for modal display
      const btn = col.querySelector('.btn-analyze');
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const filename = btn.dataset.filename;
        const data = summaryList.find(item => item.fileName === filename);
        showSummaryModal(data);
      });
    });
  }

  function setupPagination() {
    if (!pagination) return;
    pagination.innerHTML = '';
    const totalPages = Math.ceil(summaryList.length / pageSize);
    if (totalPages <= 1) return;

    // simplistic pagination rendering
    for (let i = 1; i <= totalPages; i++) {
      const item = document.createElement('li');
      item.className = `page-item ${i === currentPage ? 'active' : ''}`;
      const link = document.createElement('a');
      link.className = 'page-link';
      link.href = '#';
      link.textContent = i;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        currentPage = i;
        renderPage(currentPage);
        setupPagination();
      });
      item.appendChild(link);
      pagination.appendChild(item);
    }
  }

  function showSkeletons() {
    summariesContainer.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const col = document.createElement('div');
      col.className = 'col-md-6 col-lg-4';
      col.innerHTML = `
        <div class="article-card card h-100 border-0 shadow-sm skeleton-card">
          <div class="card-header skeleton skeleton-title"></div>
          <div class="card-body">
            <div class="skeleton skeleton-text mb-2"></div>
            <div class="skeleton skeleton-text mb-2"></div>
            <div class="skeleton skeleton-text mb-2"></div>
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
      if (!resp.ok) {
        throw new Error('Network response was not ok');
      }
      summaryList = await resp.json();
      console.log('Fetched summaries:', summaryList);
      currentPage = 1;
      renderPage(currentPage);
      setupPagination();
    } catch (error) {
      console.error('Error fetching summaries:', error);
      document.getElementById('summaries').innerHTML = `<div class="alert alert-danger">Failed to load summaries. Please try again later.</div>`;
    }
  }

  // Debounce util to limit rapid calls
  function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fn.apply(this, args);
      }, delay);
    };
  }

  // Escape regex special chars
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
          const data = summaryList.find(s => s.fileName === filename);
          // no search in progress, remove any preview
          if (!tokens.length) {
            const preview = card.querySelector('.snippet-preview');
            if (preview) preview.remove();
            return;
          }
          // enhance search with snippet preview
          const plainFull = data?.summary || rawHaystack;
          const sentencesFull = plainFull.split('. ').filter(Boolean);
          const snippetIdx = sentencesFull.findIndex(sent => tokens.every(tok => sent.toLowerCase().includes(tok)));
          let previewEl = card.querySelector('.snippet-preview');
          if (tokens.length && snippetIdx > -1) {
            const sentence = sentencesFull[snippetIdx];
            const regex = new RegExp(`(${tokens.join('|')})`, 'gi');
            const highlighted = sentence.replace(regex, '<mark>$1</mark>');
            
            if (!previewEl) {
              previewEl = document.createElement('div');
              previewEl.className = 'snippet-preview mt-3 p-2 border-start border-4 border-primary small bg-light';
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
    
    // For debugging
    console.log('Modal data:', summaryData);
    
    let md = '';
    
    try {
      // Universal summary extraction (similar to renderPage)
      // Case 1: Direct string in summary property that is JSON
      if (typeof summaryData.summary === 'string' && summaryData.summary.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(summaryData.summary);
          if (parsed.version === "2.0" && parsed.format === "markdown") {
            md = parsed.summary;
            console.log('Modal: Using parsed JSON from summary property');
          } else {
            md = summaryData.summary;
            console.log('Modal: Using raw JSON string (unexpected format)');
          }
        } catch (e) {
          md = summaryData.summary;
          console.log('Modal: Using summary as plain text (JSON parse failed)');
        }
      }
      // Case 2: Direct string in summary property (not JSON)
      else if (typeof summaryData.summary === 'string') {
        md = summaryData.summary;
        console.log('Modal: Using plain text summary');
      }
      // Case 3: Direct version 2.0 format
      else if (summaryData.version === "2.0" && summaryData.format === "markdown") {
        md = summaryData.summary;
        console.log('Modal: Using direct version 2.0 format');
      }
      // Legacy fallbacks in order of preference
      else if (summaryData.summary && typeof summaryData.summary.executive_summary === 'string') {
        md = summaryData.summary.executive_summary;
        console.log('Modal: Using executive_summary property');
      }
      else if (typeof summaryData.finalSummary === 'string') {
        md = summaryData.finalSummary;
        console.log('Modal: Using finalSummary property');
      }
      else if (summaryData.summary && typeof summaryData.summary.summary === 'string') {
        md = summaryData.summary.summary;
        console.log('Modal: Using nested summary.summary property');
      }
      else if (Array.isArray(summaryData.summaries)) {
        md = summaryData.summaries
          .map(chunk => {
            if (typeof chunk === 'string') return chunk;
            if (chunk.choices?.[0]?.message?.content) return chunk.choices[0].message.content;
            return '';
          })
          .filter(Boolean)
          .join('\n\n');
        console.log('Modal: Concatenated from summaries array');
      }
      else {
        console.warn('Modal: Unknown summary format', summaryData);
        md = 'Summary not available in a supported format.';
      }
    } catch (e) {
      console.error('Modal: Error extracting summary:', e);
      md = 'Error processing summary data.';
    }
    
    // Enhanced markdown rendering options
    marked.setOptions({
      headerIds: true,
      mangle: false,
      gfm: true
    });
    
    // Add CSS classes to different heading levels
    const renderer = new marked.Renderer();
    renderer.heading = function(text, level) {
      const escapedText = text.toLowerCase().replace(/[^\w]+/g, '-');
      const className = level === 1 ? 'modal-section-title' : 
                      level === 2 ? 'modal-section-subtitle' : 
                      'modal-section-heading';
      return `<h${level} class="${className}" id="heading-${escapedText}">${text}</h${level}>`;
    };

    // Add special formatting for lists
    renderer.list = function(body, ordered) {
      const type = ordered ? 'ol' : 'ul';
      const className = 'modal-list';
      return `<${type} class="${className}">${body}</${type}>`;
    };
    
    // Add table styling
    renderer.table = function(header, body) {
      return `<div class="table-responsive"><table class="table table-sm table-striped table-hover">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table></div>`;
    };
    
    // Format the title more professionally
    let formattedTitle = summaryData.fileName || 'Summary';
    if (formattedTitle.toLowerCase().endsWith('.pdf')) {
      formattedTitle = formattedTitle.slice(0, -4);
    }
    
    // Improve document title formatting
    const docMatch = formattedTitle.match(/(?:(circular|notice|guidance|gazette)\s*(?:no\.?\s*)?(\d+))/i);
    if (docMatch) {
      const [_, type, number] = docMatch;
      formattedTitle = `${type.charAt(0).toUpperCase() + type.slice(1)} ${number}`;
    }
    
    marked.use({ renderer });
    modalContent.innerHTML = marked.parse(md);
    modalTitle.textContent = formattedTitle;
    
    // Add table of contents for navigation
    const headings = modalContent.querySelectorAll('h1, h2');
    
    if (headings.length > 2) {
      const tocElement = document.createElement('div');
      tocElement.className = 'modal-toc mb-4';
      let tocHTML = '<div class="modal-toc-title fw-bold mb-2">Contents:</div><ul class="list-unstyled">';
      headings.forEach(heading => {
        const id = heading.id;
        const text = heading.textContent;
        const level = heading.tagName === 'H1' ? '' : 'ms-3';
        tocHTML += `<li class="${level}"><a href="#${id}" class="toc-link">${text}</a></li>`;
      });
      tocHTML += '</ul>';
      tocElement.innerHTML = tocHTML;
      modalContent.insertBefore(tocElement, modalContent.firstChild);
      
      // Add click handlers for TOC links
      setTimeout(() => {
        document.querySelectorAll('.toc-link').forEach(link => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = e.target.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
              targetElement.scrollIntoView({behavior: 'smooth', block: 'start'});
            }
          });
        });
      }, 100);
    }
    
    // Show the modal
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
