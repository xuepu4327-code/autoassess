// ========== Global Variables & Configuration ==========
const CONFIG = {
    GEMINI_API_KEY: "YOUR_API_KEY_HERE", // Replace with your actual Gemini API key
    MAX_FILE_SIZE: 15 * 1024 * 1024, // 15MB
    DEFAULT_RUBRIC: {
        logic: 40,
        flowchart: 30,
        pseudocode: 20,
        formatting: 10
    }
};

// ========== Utility Functions ==========
// Extract student info from filename
function extractStudentInfo(filename) {
    const patterns = [
        /^(\w+)[-_]([\p{L}\s]+)[-_]/u, // studentID_name_
        /^([A-Z]\d+)[-_](.+?)(?=\.[^.]+$)/, // B12345678_John.pdf
        /^(\d+)[-_](.+)/ // 12345678_John
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
    
    // Fallback
    const nameWithoutExt = filename.split('.')[0];
    return {
        studentId: nameWithoutExt.substring(0, 10) || 'UNKNOWN',
        studentName: nameWithoutExt.substring(10) || 'Unnamed Student'
    };
}

// Read file content
async function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            if (file.type.includes('text') || file.name.endsWith('.txt')) {
                resolve(e.target.result);
            } else if (file.name.endsWith('.pdf')) {
                resolve(`[PDF File] ${file.name} (Size: ${formatFileSize(file.size)})`);
            } else {
                resolve(`File preview not available. Use plain text files for best results.\nFile Name: ${file.name}\nFile Type: ${file.type}\nFile Size: ${formatFileSize(file.size)}`);
            }
        };
        
        reader.onerror = reject;
        
        if (file.type.includes('text') || file.name.endsWith('.txt')) {
            reader.readAsText(file);
        } else {
            // For non-text files, read basic info only
            resolve(`Non-text file: ${file.name}`);
        }
    });
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ========== AI Grading Core ==========
async function evaluateWithAI(content, rubric) {
    showLoader(true);
    
    try {
        // Check API key
        if (!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY === "YOUR_API_KEY_HERE") {
            throw new Error("Please set a valid Gemini API key in script.js");
        }
        
        const prompt = createEvaluationPrompt(content, rubric);
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
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
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0]) {
            throw new Error("Invalid AI response format");
        }
        
        const aiText = data.candidates[0].content.parts[0].text;
        
        // Try to parse JSON
        try {
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.warn("Could not parse AI JSON response, using fallback");
        }
        
        // Fallback: Create mock evaluation
        return createMockEvaluation(content);
        
    } catch (error) {
        console.error("AI grading error:", error);
        
        // If API fails, use mock data for demonstration
        if (error.message.includes("API")) {
            alert("API call failed, using demo mode. Please check your API key.");
            return createMockEvaluation(content);
        }
        
        throw error;
    } finally {
        showLoader(false);
    }
}

// Create evaluation prompt
function createEvaluationPrompt(content, rubric) {
    return `You are a programming course teaching assistant. Please evaluate the student assignment based on the following rubric.

Grading Rubric (Total 100 points):
1. Logic Correctness: ${rubric.logic} points - Is the program logic correct and complete?
2. Flowchart Completeness: ${rubric.flowchart} points - Is the flowchart complete and logically clear?
3. Pseudocode Structure: ${rubric.pseudocode} points - Is the pseudocode well-structured and readable?
4. Document Format: ${rubric.formatting} points - Does the format meet specifications?

Student Assignment Content:
${content.substring(0, 2000)} ${content.length > 2000 ? '...(content truncated due to length)' : ''}

Return STRICT JSON format containing:
1. "scores" object: actual scores for four categories (must be integers)
2. "feedback" string: specific feedback pointing out strengths and improvements (in English)
3. "total" number: total score

Example format:
{
  "scores": {
    "logic": 35,
    "flowchart": 25,
    "pseudocode": 18,
    "formatting": 8
  },
  "feedback": "Logic is clear, flowchart is complete, but pseudocode lacks comments...",
  "total": 86
}

Please evaluate now and return JSON:`;
}

// Mock evaluation (when API is unavailable)
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
        feedback: "[DEMO MODE] This is a mock evaluation result. Connect to Gemini API for real grading.\n\nSuggestions:\n1. Logic could be further optimized\n2. Flowchart needs more details\n3. Pseudocode format should be consistent\n4. Document structure is good",
        total: total
    };
}

// ========== UI Update Functions ==========
function updateScoresDisplay(scores, total) {
    // Update score numbers
    document.getElementById('logicScore').textContent = scores.logic;
    document.getElementById('flowchartScore').textContent = scores.flowchart;
    document.getElementById('pseudocodeScore').textContent = scores.pseudocode;
    document.getElementById('formattingScore').textContent = scores.formatting;
    document.getElementById('totalScore').textContent = total;
    
    // Update progress bars
    const maxScores = CONFIG.DEFAULT_RUBRIC;
    setTimeout(() => {
        document.getElementById('logicBar').style.width = `${(scores.logic / maxScores.logic) * 100}%`;
        document.getElementById('flowchartBar').style.width = `${(scores.flowchart / maxScores.flowchart) * 100}%`;
        document.getElementById('pseudocodeBar').style.width = `${(scores.pseudocode / maxScores.pseudocode) * 100}%`;
        document.getElementById('formattingBar').style.width = `${(scores.formatting / maxScores.formatting) * 100}%`;
    }, 100);
    
    // Update statistics
    updateStatistics();
}

function updateStudentInfo(studentId, studentName, fileName) {
    document.getElementById('studentId').textContent = studentId;
    document.getElementById('studentName').textContent = studentName;
    document.getElementById('fileName').textContent = fileName;
    document.getElementById('submitTime').textContent = new Date().toLocaleString('en-US');
}

function updateFeedback(text) {
    document.getElementById('feedbackText').textContent = text;
}

// ========== Main Process Functions ==========
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
        // 1. Extract student info
        const { studentId, studentName } = extractStudentInfo(file.name);
        updateStudentInfo(studentId, studentName, file.name);
        
        // 2. Read file content
        const content = await readFileContent(file);
        
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
    // Update display values
    document.getElementById('logicValue').textContent = document.getElementById('logicWeight').value;
    document.getElementById('flowchartValue').textContent = document.getElementById('flowchartWeight').value;
    document.getElementById('pseudocodeValue').textContent = document.getElementById('pseudocodeWeight').value;
    document.getElementById('formattingValue').textContent = document.getElementById('formattingWeight').value;
    
    alert('Grading rubric updated');
}

// ========== History Management ==========
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

function getHistory() {
    const historyJson = localStorage.getItem('autoassess_history');
    return historyJson ? JSON.parse(historyJson) : [];
}

function updateHistoryTable() {
    const history = getHistory();
    const tbody = document.getElementById('historyBody');
    
    tbody.innerHTML = history.map(item => `
        <tr>
            <td>${item.studentId}</td>
            <td>${item.studentName}</td>
            <td><strong>${item.total}</strong>/100</td>
            <td>${new Date(item.timestamp).toLocaleDateString('en-US')}</td>
            <td>
                <button onclick="viewHistoryDetail(${item.id})" class="btn-small">
                    <i class="fas fa-eye"></i> View
                </button>
                <button onclick="deleteHistoryItem(${item.id})" class="btn-small">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </td>
        </tr>
    `).join('');
}

function updateStatistics() {
    const history = getHistory();
    
    if (history.length === 0) {
        document.getElementById('totalAssessments').textContent = '0';
        document.getElementById('avgScore').textContent = '0.0';
        document.getElementById('highestScore').textContent = '0';
        document.getElementById('lowestScore').textContent = '0';
        return;
    }
    
    const total = history.length;
    const avgScore = history.reduce((sum, item) => sum + item.total, 0) / total;
    const highestScore = Math.max(...history.map(item => item.total));
    const lowestScore = Math.min(...history.map(item => item.total));
    
    document.getElementById('totalAssessments').textContent = total;
    document.getElementById('avgScore').textContent = avgScore.toFixed(1);
    document.getElementById('highestScore').textContent = highestScore;
    document.getElementById('lowestScore').textContent = lowestScore;
}

function clearHistory() {
    if (confirm('Are you sure you want to clear all grading history? This action cannot be undone.')) {
        localStorage.removeItem('autoassess_history');
        updateHistoryTable();
        updateStatistics();
        alert('History cleared');
    }
}

function exportHistory() {
    const history = getHistory();
    if (history.length === 0) {
        alert('No history records to export');
        return;
    }
    
    const csvContent = [
        ['Student ID', 'Name', 'Logic', 'Flowchart', 'Pseudocode', 'Format', 'Total', 'Time'].join(','),
        ...history.map(item => [
            item.studentId,
            item.studentName,
            item.scores.logic,
            item.scores.flowchart,
            item.scores.pseudocode,
            item.scores.formatting,
            item.total,
            item.date
        ].join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `autoassess_history_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function viewHistoryDetail(id) {
    const history = getHistory();
    const item = history.find(h => h.id === id);
    
    if (item) {
        alert(`Assessment Details:
Student: ${item.studentName} (${item.studentId})
Time: ${item.date}
File: ${item.fileName}
Scores: Logic ${item.scores.logic}/40, Flowchart ${item.scores.flowchart}/30, Pseudocode ${item.scores.pseudocode}/20, Format ${item.scores.formatting}/10
Total: ${item.total}/100
Feedback: ${item.feedback.substring(0, 200)}...`);
    }
}

function deleteHistoryItem(id) {
    if (confirm('Are you sure you want to delete this record?')) {
        const history = getHistory();
        const newHistory = history.filter(h => h.id !== id);
        localStorage.setItem('autoassess_history', JSON.stringify(newHistory));
        updateHistoryTable();
        updateStatistics();
    }
}

// ========== PDF Report Generation ==========
function generatePDF() {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Basic info
        const studentId = document.getElementById('studentId').textContent;
        const studentName = document.getElementById('studentName').textContent;
        const date = document.getElementById('submitTime').textContent;
        
        // Title
        doc.setFontSize(20);
        doc.text('AutoAssess Assignment Grading Report', 20, 20);
        
        doc.setFontSize(12);
        doc.text(`Student: ${studentName}`, 20, 35);
        doc.text(`Student ID: ${studentId}`, 20, 42);
        doc.text(`Grading Date: ${date}`, 20, 49);
        
        // Scores table
        const scores = {
            'Logic Correctness': document.getElementById('logicScore').textContent + '/40',
            'Flowchart Completeness': document.getElementById('flowchartScore').textContent + '/30',
            'Pseudocode Structure': document.getElementById('pseudocodeScore').textContent + '/20',
            'Document Format': document.getElementById('formattingScore').textContent + '/10'
        };
        
        let y = 65;
        Object.entries(scores).forEach(([item, score], i) => {
            doc.text(`${item}: ${score}`, 20, y + (i * 8));
        });
        
        // Total score
        const total = document.getElementById('totalScore').textContent;
        doc.setFontSize(14);
        doc.text(`Total Score: ${total}/100`, 20, y + 35);
        
        // Feedback
        const feedback = document.getElementById('feedbackText').textContent;
        doc.setFontSize(12);
        doc.text('Feedback:', 20, y + 50);
        doc.setFontSize(10);
        const splitFeedback = doc.splitTextToSize(feedback, 170);
        doc.text(splitFeedback, 20, y + 60);
        
        // Save
        doc.save(`${studentId}_${studentName}_Grading_Report.pdf`);
        
    } catch (error) {
        console.error('PDF generation failed:', error);
        alert('PDF generation failed. Please check if jsPDF library is loaded correctly.');
    }
}

// ========== Other Functions ==========
function resetAssessment() {
    if (confirm('Are you sure you want to reset the current grading?')) {
        document.getElementById('resultCard').style.display = 'none';
        document.getElementById('fileInput').value = '';
        
        // Reset score display
        document.getElementById('logicScore').textContent = '0';
        document.getElementById('flowchartScore').textContent = '0';
        document.getElementById('pseudocodeScore').textContent = '0';
        document.getElementById('formattingScore').textContent = '0';
        document.getElementById('totalScore').textContent = '0';
        document.getElementById('feedbackText').textContent = 'Waiting for grading results...';
        
        // Reset progress bars
        ['logicBar', 'flowchartBar', 'pseudocodeBar', 'formattingBar'].forEach(id => {
            document.getElementById(id).style.width = '0%';
        });
    }
}

function showLoader(show) {
    document.getElementById('loaderOverlay').style.display = show ? 'flex' : 'none';
}

// ========== Event Listeners & Initialization ==========
document.addEventListener('DOMContentLoaded', function() {
    // Initialize slider displays
    document.getElementById('logicWeight').addEventListener('input', function() {
        document.getElementById('logicValue').textContent = this.value;
    });
    document.getElementById('flowchartWeight').addEventListener('input', function() {
        document.getElementById('flowchartValue').textContent = this.value;
    });
    document.getElementById('pseudocodeWeight').addEventListener('input', function() {
        document.getElementById('pseudocodeValue').textContent = this.value;
    });
    document.getElementById('formattingWeight').addEventListener('input', function() {
        document.getElementById('formattingValue').textContent = this.value;
    });
    
    // File upload area click event
    document.getElementById('uploadArea').addEventListener('click', function() {
        document.getElementById('fileInput').click();
    });
    
    // File selection event
    document.getElementById('fileInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            document.querySelector('.upload-area p').textContent = `Selected: ${file.name}`;
            document.querySelector('.upload-area i').className = 'fas fa-file-alt fa-3x';
            document.querySelector('.upload-area').style.borderColor = '#00b09b';
        }
    });
    
    // Drag and drop functionality
    const uploadArea = document.getElementById('uploadArea');
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.style.borderColor = '#00b09b';
        this.style.background = '#e8f5e9';
    });
    
    uploadArea.addEventListener('dragleave', function() {
        this.style.borderColor = '#667eea';
        this.style.background = '#f8f9ff';
    });
    
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        this.style.borderColor = '#667eea';
        this.style.background = '#f8f9ff';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            document.getElementById('fileInput').files = files;
            document.querySelector('.upload-area p').textContent = `Selected: ${files[0].name}`;
            document.querySelector('.upload-area i').className = 'fas fa-file-alt fa-3x';
        }
    });
    
    // Initialize history and statistics
    updateHistoryTable();
    updateStatistics();
    
    // API key check
    if (CONFIG.GEMINI_API_KEY === "YOUR_API_KEY_HERE") {
        console.warn('⚠️ Please set a valid Gemini API key in script.js');
    }
});

// Make functions available in HTML
window.processFile = processFile;
window.updateRubric = updateRubric;
window.generatePDF = generatePDF;
window.resetAssessment = resetAssessment;
window.saveToHistory = function() {
    const studentId = document.getElementById('studentId').textContent;
    const studentName = document.getElementById('studentName').textContent;
    
    if (studentId === '-') {
        alert('Please perform grading first');
        return;
    }
    
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
window.clearHistory = clearHistory;
window.exportHistory = exportHistory;
window.viewHistoryDetail = viewHistoryDetail;
window.deleteHistoryItem = deleteHistoryItem;