// ========== System Architecture Configuration ==========
const SYSTEM_ARCHITECTURE = {
    // 当前实现（前端原型）
    current: {
        frontend: "Static HTML/CSS/JS",
        backend: "Direct API calls (for demo) or Mock",
        storage: "LocalStorage (browser)",
        monitoring: "Google Drive API (on-demand scan)",
        security: "API key in client (⚠️ demo only, real deployment move to backend)"
    },
    
    // 生产环境架构（报告 & presentation 可以讲）
    production: {
        frontend: "SPA (React/Vue)",
        backend: "Node.js/Express API server or Cloud Functions",
        database: "Firestore/PostgreSQL",
        storage: "Google Cloud Storage / Drive",
        monitoring: "Google Drive API + Cloud Functions (auto trigger)",
        security: "API keys in environment variables, JWT auth",
        deployment: "Docker containers on GCP/Azure"
    }
};

console.log("=== AutoAssess System Architecture ===");
console.log("Current (Prototype):", SYSTEM_ARCHITECTURE.current);
console.log("Production Ready:", SYSTEM_ARCHITECTURE.production);

// ========== Global Variables & Configuration ==========
const CONFIG = {
    // 如果你没有 Gemini key，可以不改它，系统会自动用 demo 模式
    GEMINI_API_KEY: "KEY",
    MAX_FILE_SIZE: 15 * 1024 * 1024,
    DEFAULT_RUBRIC: {
        logic: 40,
        flowchart: 30,
        pseudocode: 20,
        formatting: 10
    },

    // ✅ Google Drive 配置
    // 1. 把下面这一行换成你自己的 Google API key
    // 2. FOLDER ID 我已经帮你填好，是你给的那个 Drive folder
    DRIVE_API_KEY: "KEY",
    DRIVE_FOLDER_ID: "1u_fbuHDpIeA7G510h5ZoQgrafxLcSq_B"
};

// ========== Utility Functions ==========
// Extract student info from filename
function extractStudentInfo(filename) {
    const patterns = [
        /^(\w+)[-_]([\p{L}\s]+)[-_]/u,       // studentID_name_
        /^([A-Z]\d+)[-_](.+?)(?=\.[^.]+$)/,  // B12345678_John.pdf
        /^(\d+)[-_](.+)/                     // 12345678_John
    ];
    
    for (const pattern of patterns) {
        const match = filename.match(pattern);
        if (match) {
            return {
                studentId: match[1].trim(),
                studentName: match[2].trim()
            };
        }
    }
    
    // Fallback：前 10 个字符当 ID，后面当名字
    const nameWithoutExt = filename.split('.')[0];
    return {
        studentId: nameWithoutExt.substring(0, 10) || 'UNKNOWN',
        studentName: nameWithoutExt.substring(10) || 'Unnamed Student'
    };
}

// Extract student info from document content (fallback)
function extractStudentInfoFromContent(text) {
    if (!text) return null;
    
    // 尝试找 7–10 位数字当作 student ID
    const idMatch = text.match(/\b(\d{7,10})\b/);
    let studentId = idMatch ? idMatch[1] : "";
    
    // 尝试找 "Name: xxx" 这一行
    let studentName = "";
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/name\s*[:\-]\s*(.+)/i);
        if (match) {
            studentName = match[1].trim();
            break;
        }
    }
    
    if (!studentId && !studentName) {
        return null;
    }
    
    return {
        studentId: studentId || "UNKNOWN",
        studentName: studentName || "UNKNOWN"
    };
}

// Read local file content (for manual upload)
async function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            if (file.type.includes('text') || file.name.endsWith('.txt')) {
                resolve(e.target.result);
            } else if (file.name.endsWith('.pdf')) {
                resolve(`[PDF File] ${file.name} (Size: ${formatFileSize(file.size)})`);
            } else {
                resolve(
                    `File preview not available. Use plain text for full AI analysis.\n` +
                    `File Name: ${file.name}\nFile Type: ${file.type}\nFile Size: ${formatFileSize(file.size)}`
                );
            }
        };
        
        reader.onerror = reject;
        
        if (file.type.includes('text') || file.name.endsWith('.txt')) {
            reader.readAsText(file);
        } else {
            reader.readAsArrayBuffer(file);
        }
    });
}

function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Update student info UI
function updateStudentInfo(studentId, studentName, fileName) {
    document.getElementById('studentId').textContent = studentId || 'UNKNOWN';
    document.getElementById('studentName').textContent = studentName || 'Unnamed Student';
    document.getElementById('fileName').textContent = fileName || '-';
    document.getElementById('submitTime').textContent = new Date().toLocaleString('en-US');
}

function updateFeedback(text) {
    document.getElementById('feedbackText').textContent = text;
}

// ========== Google Drive Integration ==========

// 列出 Google Drive folder 里的档案
async function listDriveFiles() {
    const { DRIVE_API_KEY, DRIVE_FOLDER_ID } = CONFIG;
    if (!DRIVE_API_KEY || !DRIVE_FOLDER_ID) {
        alert("Drive API is not configured. Please set DRIVE_API_KEY and DRIVE_FOLDER_ID.");
        return [];
    }

    const query = `'${DRIVE_FOLDER_ID}' in parents and trashed = false`;
    const fields = "files(id,name,mimeType,modifiedTime,size)";
    const url =
        "https://www.googleapis.com/drive/v3/files" +
        `?q=${encodeURIComponent(query)}` +
        `&fields=${encodeURIComponent(fields)}` +
        `&key=${DRIVE_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
        console.error("Drive API error", await res.text());
        alert("Failed to read Google Drive folder. Please check API key & sharing settings.");
        return [];
    }

    const data = await res.json();
    return data.files || [];
}

// 从 Google Drive 下载档案内容（先支援文字档）
async function downloadDriveFile(fileId) {
    const { DRIVE_API_KEY } = CONFIG;
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error("Download from Drive failed");
    }

    // 这里只处理纯文字档
    return await res.text();
}

// 按钮：Scan Google Drive Folder
async function scanDriveFolder() {
    showLoader(true);
    try {
        const files = await listDriveFiles();
        if (!files.length) {
            alert("No files found in Google Drive folder.");
            renderCloudFilesTable([]); // 清空表格
            return;
        }

        renderCloudFilesTable(files);
    } catch (e) {
        console.error(e);
        alert("Cloud scan failed: " + e.message);
    } finally {
        showLoader(false);
    }
}

// 把 Drive 文件列表显示在表格里
function renderCloudFilesTable(files) {
    const tbody = document.getElementById("cloudFilesBody");
    if (!tbody) return; // 如果 HTML 还没加这块，就不做事

    tbody.innerHTML = "";

    files.forEach(file => {
        const tr = document.createElement("tr");
        const sizeKB = file.size ? (file.size / 1024).toFixed(1) : "-";
        const time = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleString("en-US")
            : "-";

        // 注意：要 escape 单引号，避免 HTML 破坏
        const safeName = file.name.replace(/'/g, "\\'");

        tr.innerHTML = `
            <td>${file.name}</td>
            <td>${sizeKB}</td>
            <td>${time}</td>
            <td>
                <button class="table-btn" onclick="gradeDriveFile('${file.id}', '${safeName}')">
                    <i class="fas fa-magic"></i> Grade
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 对云端档案做评分（跟本地上传类似）
async function gradeDriveFile(fileId, fileName) {
    try {
        showLoader(true);

        // 1. 从 Drive 下载作业内容
        const content = await downloadDriveFile(fileId);

        // 2. 从档名 & 内容抓学生资料
        const infoFromName = extractStudentInfo(fileName) || {};
        const infoFromContent = extractStudentInfoFromContent(content) || {};

        let studentId = infoFromName.studentId || infoFromContent.studentId || "UNKNOWN";
        let studentName = infoFromName.studentName || infoFromContent.studentName || "UNKNOWN";

        updateStudentInfo(studentId, studentName, fileName);

        // 3. 取当前的 rubric
        const rubric = getCurrentRubric();

        // 4. 叫 AI（或 mock）打分
        const result = await evaluateWithAI(content, rubric);

        // 5. 更新右边的结果卡片
        document.getElementById("resultCard").style.display = "block";
        updateScoresDisplay(result.scores, result.total);
        updateFeedback(result.feedback);

        // 6. 存 history（如果有勾 Save History）
        if (document.getElementById("saveHistory").checked) {
            saveAssessmentToHistory(studentId, studentName, result, fileName);
        }

        // 7. Auto-download report (optional)
        if (document.getElementById('autoDownload').checked) {
            setTimeout(() => generatePDF(), 800);
        }

    } catch (e) {
        console.error(e);
        alert("Failed to grade cloud file: " + e.message);
    } finally {
        showLoader(false);
    }
}

// ========== AI Evaluation Logic ==========

// 1. 生成给 Gemini 的提示词
function createEvaluationPrompt(content, rubric) {
    const { logic, flowchart, pseudocode, formatting } = rubric;
    
    return `
You are a strict programming logic lecturer.

Grade the student's assignment based on this rubric:

- logic: 0~${logic}
- flowchart: 0~${flowchart}
- pseudocode: 0~${pseudocode}
- formatting: 0~${formatting}

Return ONLY a JSON object, no explanation, no backticks, no extra text.
Use this exact format:

{
  "scores": {
    "logic": number,
    "flowchart": number,
    "pseudocode": number,
    "formatting": number
  },
  "total": number,
  "feedback": "string"
}

Now evaluate this submission:

${content}
`;
}

// 2. 调用 Gemini 做真实评分（失败才退回 demo）
async function evaluateWithAI(content, rubric) {
    showLoader(true);
    
    try {
        // 读取下拉选单：Gemini / Demo
        const modelSelect = document.getElementById('aiModel');
        const model = modelSelect ? modelSelect.value : 'gemini-pro';
        
        // 如果用户选 Demo Mode，就直接用 mock
        if (model === 'mock') {
            console.warn("Demo mode selected, using mock evaluation.");
            return createMockEvaluation(content);
        }
        
        // 没有设 GEMINI_API_KEY 的话，也退回 demo
        if (!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
            console.warn("No Gemini API key set, using demo mode instead.");
            return createMockEvaluation(content);
        }
        
        const prompt = createEvaluationPrompt(content, rubric);

        // 真正呼叫 Gemini API
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  }
);
        if (!response.ok) {
            const errText = await response.text();
            console.error("Gemini API HTTP error:", response.status, errText);
            alert("Gemini API 调用失败，已切换为 demo 模式。（HTTP " + response.status + "）");
            return createMockEvaluation(content);
        }
        
        const data = await response.json();
        console.log("Gemini raw response:", data);

        // 从 Gemini 回传结果里把文字抓出来
        let textResponse = "";
        try {
            const candidates = data.candidates || [];
            if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
                textResponse = candidates[0].content.parts
                    .map(p => p.text || "")
                    .join("\n");
            }
        } catch (e) {
            console.warn("Unexpected Gemini API response format", e);
        }
        
        if (!textResponse) {
            console.warn("Empty AI response, using mock evaluation");
            return createMockEvaluation(content);
        }
        
        // 尝试从文字中截出 JSON（避免前后有多余文字）
        const match = textResponse.match(/\{[\s\S]*\}/);
        if (!match) {
            console.warn("No JSON found in AI response, using mock evaluation");
            return createMockEvaluation(content);
        }
        
        let parsed;
        try {
            parsed = JSON.parse(match[0]);
        } catch (e) {
            console.warn("Could not parse AI JSON response, using mock evaluation", e);
            return createMockEvaluation(content);
        }
        
        // 简单检查结构
        if (!parsed || !parsed.scores || typeof parsed.total !== "number") {
            console.warn("AI JSON format not as expected, using mock evaluation");
            return createMockEvaluation(content);
        }
        
        return parsed;
        
    } catch (error) {
        console.error("AI grading error:", error);
        alert("AI grading failed, using demo mode instead.");
        return createMockEvaluation(content);
    } finally {
        showLoader(false);
    }
}

// 3. 没连到 Gemini 时的示范评分（Demo Mode）
function createMockEvaluation(content) {
    const length = content.length;
    const mockScores = {
        logic: Math.min(40, Math.floor(length / 50) + 20),
        flowchart: Math.min(30, Math.floor(length / 80) + 15),
        pseudocode: Math.min(20, Math.floor(length / 100) + 10),
        formatting: Math.min(10, Math.floor(length / 200) + 5)
    };
    
    // 限制在合法范围内
    Object.keys(mockScores).forEach(key => {
        mockScores[key] = Math.max(0, Math.min(CONFIG.DEFAULT_RUBRIC[key], mockScores[key]));
    });
    
    const total = Object.values(mockScores).reduce((a, b) => a + b, 0);
    
    return {
        scores: mockScores,
        feedback: "[DEMO MODE] 目前使用示范评分结果。\n请确认 Gemini API key 正确配置后，即可启用真实 AI 批改。",
        total
    };
}


function createMockEvaluation(content) {
    const length = content.length;
    const mockScores = {
        logic: Math.min(40, Math.floor(length / 50) + 25),
        flowchart: Math.min(30, Math.floor(length / 80) + 20),
        pseudocode: Math.min(20, Math.floor(length / 100) + 15),
        formatting: Math.min(10, Math.floor(length / 200) + 8)
    };
    
    // Ensure scores are in valid range
    Object.keys(mockScores).forEach(key => {
        mockScores[key] = Math.max(0, Math.min(CONFIG.DEFAULT_RUBRIC[key], mockScores[key]));
    });
    
    const total = Object.values(mockScores).reduce((a, b) => a + b, 0);
    
    return {
        scores: mockScores,
        feedback: "[DEMO MODE] This is a mock evaluation result.\n\n1. Logic is generally acceptable but can be improved.\n2. Flowchart needs more details and proper symbols.\n3. Pseudocode format should be consistent with standard convention.\n4. Formatting can be cleaner (indentation, spacing).",
        total
    };
}

// ========== Loader ==========
function showLoader(show) {
    const overlay = document.getElementById('loaderOverlay');
    if (!overlay) return;
    overlay.style.display = show ? 'flex' : 'none';
}

// ========== Main Process Functions (Local Upload) ==========
async function processFile() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    
    if (!file) {
        alert('Please select a file first');
        return;
    }
    
    // Check file size
    if (file.size > CONFIG.MAX_FILE_SIZE) {
        alert(`File is too large. Please select a file smaller than ${formatFileSize(CONFIG.MAX_FILE_SIZE)}`);
        return;
    }
    
    // Show result card
    document.getElementById('resultCard').style.display = 'block';
    
    try {
        // 1. Read file content
        const content = await readFileContent(file);
        
        // 2. Extract student info (filename + document content)
        const infoFromName = extractStudentInfo(file.name) || {};
        const infoFromContent = extractStudentInfoFromContent(content) || {};
        
        let studentId = infoFromName.studentId;
        let studentName = infoFromName.studentName;
        
        if ((!studentId || studentId === 'UNKNOWN') && infoFromContent.studentId) {
            studentId = infoFromContent.studentId;
        }
        if ((!studentName || studentName === 'Unnamed Student' || studentName === 'UNKNOWN') && infoFromContent.studentName) {
            studentName = infoFromContent.studentName;
        }
        
        if (!studentId) studentId = 'UNKNOWN';
        if (!studentName) studentName = 'UNKNOWN';
        
        updateStudentInfo(studentId, studentName, file.name);
        
        // 3. Get current rubric
        const rubric = getCurrentRubric();
        
        // 4. Call AI grading
        const result = await evaluateWithAI(content, rubric);
        
        // 5. Update UI
        updateScoresDisplay(result.scores, result.total);
        updateFeedback(result.feedback);
        
        // 6. Auto-save to history
        if (document.getElementById('saveHistory').checked) {
            saveAssessmentToHistory(studentId, studentName, result, file.name);
        }
        
        // 7. Auto-download report
        if (document.getElementById('autoDownload').checked) {
            setTimeout(() => generatePDF(), 1000);
        }
        
    } catch (error) {
        console.error('Grading process error:', error);
        alert('Grading failed: ' + error.message);
        updateFeedback(`Grading failed: ${error.message}\n\nPlease check API key settings or network connection.`);
    }
}

// ========== Rubric Management ==========
function getCurrentRubric() {
    return {
        logic: parseInt(document.getElementById('logicWeight').value),
        flowchart: parseInt(document.getElementById('flowchartWeight').value),
        pseudocode: parseInt(document.getElementById('pseudocodeWeight').value),
        formatting: parseInt(document.getElementById('formattingWeight').value)
    };
}

function updateRubric() {
    const rubric = getCurrentRubric();
    const total = rubric.logic + rubric.flowchart + rubric.pseudocode + rubric.formatting;
    
    if (total !== 100) {
        alert(`Total weight is ${total}%. System will normalize to 100%.`);
    }
    
    document.getElementById('logicWeightLabel').textContent = rubric.logic + '%';
    document.getElementById('flowchartWeightLabel').textContent = rubric.flowchart + '%';
    document.getElementById('pseudocodeWeightLabel').textContent = rubric.pseudocode + '%';
    document.getElementById('formattingWeightLabel').textContent = rubric.formatting + '%';
}

// Update score bars & labels
function updateScoresDisplay(scores, total) {
    const logicBar = document.getElementById('logicBar');
    const flowchartBar = document.getElementById('flowchartBar');
    const pseudocodeBar = document.getElementById('pseudocodeBar');
    const formattingBar = document.getElementById('formattingBar');
    
    const logicScore = document.getElementById('logicScore');
    const flowchartScore = document.getElementById('flowchartScore');
    const pseudocodeScore = document.getElementById('pseudocodeScore');
    const formattingScore = document.getElementById('formattingScore');
    const totalScore = document.getElementById('totalScore');
    
    logicBar.style.width = `${(scores.logic / CONFIG.DEFAULT_RUBRIC.logic) * 100}%`;
    flowchartBar.style.width = `${(scores.flowchart / CONFIG.DEFAULT_RUBRIC.flowchart) * 100}%`;
    pseudocodeBar.style.width = `${(scores.pseudocode / CONFIG.DEFAULT_RUBRIC.pseudocode) * 100}%`;
    formattingBar.style.width = `${(scores.formatting / CONFIG.DEFAULT_RUBRIC.formatting) * 100}%`;
    
    logicScore.textContent = scores.logic;
    flowchartScore.textContent = scores.flowchart;
    pseudocodeScore.textContent = scores.pseudocode;
    formattingScore.textContent = scores.formatting;
    totalScore.textContent = `${total} / 100`;
}

// ========== Report Generation ==========
function generatePDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const studentName = document.getElementById('studentName').textContent;
    const studentId = document.getElementById('studentId').textContent;
    const fileName = document.getElementById('fileName').textContent;
    const submitTime = document.getElementById('submitTime').textContent;
    
    const logic = document.getElementById('logicScore').textContent;
    const flowchart = document.getElementById('flowchartScore').textContent;
    const pseudocode = document.getElementById('pseudocodeScore').textContent;
    const formatting = document.getElementById('formattingScore').textContent;
    const total = document.getElementById('totalScore').textContent;
    const feedback = document.getElementById('feedbackText').textContent;
    
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;
    
    doc.setFontSize(18);
    doc.text("AutoAssess - Assignment Evaluation Report", pageWidth / 2, y, { align: 'center' });
    
    y += 15;
    doc.setFontSize(12);
    doc.text(`Student Name: ${studentName}`, 20, y);
    y += 7;
    doc.text(`Student ID: ${studentId}`, 20, y);
    y += 7;
    doc.text(`File Name: ${fileName}`, 20, y);
    y += 7;
    doc.text(`Submitted At: ${submitTime}`, 20, y);
    
    y += 12;
    doc.setFontSize(14);
    doc.text("Scores", 20, y);
    
    y += 10;
    doc.setFontSize(12);
    doc.text(`Logic: ${logic} / 40`, 20, y);
    y += 7;
    doc.text(`Flowchart: ${flowchart} / 30`, 20, y);
    y += 7;
    doc.text(`Pseudocode: ${pseudocode} / 20`, 20, y);
    y += 7;
    doc.text(`Formatting: ${formatting} / 10`, 20, y);
    y += 10;
    doc.text(`Total: ${total}`, 20, y);
    
    y += 12;
    doc.setFontSize(14);
    doc.text("Feedback", 20, y);
    
    y += 10;
    doc.setFontSize(11);
    
    const splitFeedback = doc.splitTextToSize(feedback, pageWidth - 40);
    doc.text(splitFeedback, 20, y);
    
    const safeFileName = `${studentId || 'student'}_${studentName || 'report'}_autoassess.pdf`;
    doc.save(safeFileName.replace(/\s+/g, '_'));
}

// ========== Reset ==========
function resetAssessment() {
    document.getElementById('resultCard').style.display = 'none';
    document.getElementById('logicBar').style.width = '0%';
    document.getElementById('flowchartBar').style.width = '0%';
    document.getElementById('pseudocodeBar').style.width = '0%';
    document.getElementById('formattingBar').style.width = '0%';
    
    document.getElementById('logicScore').textContent = '0';
    document.getElementById('flowchartScore').textContent = '0';
    document.getElementById('pseudocodeScore').textContent = '0';
    document.getElementById('formattingScore').textContent = '0';
    document.getElementById('totalScore').textContent = '0 / 100';
    
    document.getElementById('feedbackText').textContent = 'No feedback yet.';
}

// ========== History & Statistics ==========
function getHistory() {
    const historyJson = localStorage.getItem('autoassess_history');
    return historyJson ? JSON.parse(historyJson) : [];
}

function saveAssessmentToHistory(studentId, studentName, result, fileName) {
    const history = getHistory();
    
    history.unshift({
        id: Date.now(),
        studentId,
        studentName,
        scores: result.scores,
        total: result.total,
        feedback: result.feedback,
        fileName,
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleString('en-US')
    });
    
    // Keep only last 100 records
    localStorage.setItem('autoassess_history', JSON.stringify(history.slice(0, 100)));
    
    updateHistoryTable();
    updateStatistics();
}

function updateHistoryTable() {
    const history = getHistory();
    const tbody = document.getElementById('historyBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    
    history.forEach(record => {
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td>${record.studentId}</td>
            <td>${record.studentName}</td>
            <td>${record.total}</td>
            <td>${record.date}</td>
            <td>
                <button class="table-btn" onclick="viewHistoryDetail(${record.id})">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="table-btn" onclick="deleteHistoryItem(${record.id})">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
}

function updateStatistics() {
    const history = getHistory();
    
    if (history.length === 0) {
        document.getElementById('statTotal').textContent = '0';
        document.getElementById('statAverage').textContent = '0';
        document.getElementById('statHighest').textContent = '0';
        document.getElementById('statLowest').textContent = '0';
        return;
    }
    
    const totals = history.map(r => r.total);
    const total = totals.reduce((a, b) => a + b, 0);
    
    document.getElementById('statTotal').textContent = history.length;
    document.getElementById('statAverage').textContent = (total / history.length).toFixed(1);
    document.getElementById('statHighest').textContent = Math.max(...totals);
    document.getElementById('statLowest').textContent = Math.min(...totals);
}

function clearHistory() {
    if (!confirm('Are you sure you want to clear all history?')) return;
    localStorage.removeItem('autoassess_history');
    updateHistoryTable();
    updateStatistics();
}

function exportHistory() {
    const history = getHistory();
    if (history.length === 0) {
        alert('No history to export.');
        return;
    }
    
    const headers = ['Student ID', 'Student Name', 'Logic', 'Flowchart', 'Pseudocode', 'Formatting', 'Total', 'Date', 'File Name'];
    const rows = history.map(r => [
        r.studentId,
        r.studentName,
        r.scores.logic,
        r.scores.flowchart,
        r.scores.pseudocode,
        r.scores.formatting,
        r.total,
        r.date,
        r.fileName
    ]);
    
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/cv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'autoassess_history.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function viewHistoryDetail(id) {
    const history = getHistory();
    const record = history.find(r => r.id === id);
    if (!record) return;
    
    alert(
        `Student: ${record.studentName} (${record.studentId})\n` +
        `File: ${record.fileName}\n` +
        `Score: ${record.total}\n\n` +
        `Feedback:\n${record.feedback}`
    );
}

function deleteHistoryItem(id) {
    if (!confirm('Delete this record?')) return;
    
    let history = getHistory();
    history = history.filter(r => r.id !== id);
    localStorage.setItem('autoassess_history', JSON.stringify(history));
    updateHistoryTable();
    updateStatistics();
}

// ========== Initialization ==========
window.addEventListener('load', () => {
    updateHistoryTable();
    updateStatistics();
    
    // Drag & drop upload
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    if (uploadArea && fileInput) {
        uploadArea.addEventListener('click', () => fileInput.click());
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                fileInput.files = e.dataTransfer.files;
            }
        });
    }
});

// ========== Expose functions to HTML ==========
window.processFile = processFile;
window.scanDriveFolder = scanDriveFolder;
window.gradeDriveFile = gradeDriveFile;
window.updateRubric = updateRubric;
window.generatePDF = generatePDF;
window.resetAssessment = resetAssessment;
window.clearHistory = clearHistory;
window.exportHistory = exportHistory;
window.viewHistoryDetail = viewHistoryDetail;
window.deleteHistoryItem = deleteHistoryItem;

// 给“Save to History”按钮用（如果有）
window.saveToHistory = function() {
    const studentId = document.getElementById('studentId').textContent;
    const studentName = document.getElementById('studentName').textContent;
    const scores = {
        logic: parseInt(document.getElementById('logicScore').textContent),
        flowchart: parseInt(document.getElementById('flowchartScore').textContent),
        pseudocode: parseInt(document.getElementById('pseudocodeScore').textContent),
        formatting: parseInt(document.getElementById('formattingScore').textContent)
    };
    
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const feedback = document.getElementById('feedbackText').textContent;
    const fileName = document.getElementById('fileName').textContent;
    
    saveAssessmentToHistory(studentId, studentName, { scores, total, feedback }, fileName);
    alert('Saved to history');
};
