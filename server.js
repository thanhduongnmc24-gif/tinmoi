// --- Các thư viện cần thiết ---
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

// ----- CÀI ĐẶT CACHE (RSS) -----
const cache = new Map(); 
const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 phút

// --- Cài đặt Server ---
const app = express();
const PORT = process.env.PORT || 3000; 

// --- Middleware ---
app.use(cors()); 
app.use(express.json()); 
app.use(express.static('.')); 

// Lấy API Key từ Biến Môi Trường
const API_KEY = process.env.GEMINI_API_KEY;

// ----- CÁC ENDPOINT -----

/**
 * Endpoint 1: Lấy RSS feed (Không thay đổi)
 */
app.get('/get-rss', async (req, res) => {
    const rssUrl = req.query.url;
    if (!rssUrl) return res.status(400).send('Thiếu tham số url');

    const now = Date.now();
    if (cache.has(rssUrl)) {
        const cachedItem = cache.get(rssUrl);
        if (now - cachedItem.timestamp < CACHE_DURATION_MS) {
            console.log(`[CACHE] Gửi ${rssUrl} từ cache.`);
            res.type('application/xml');
            return res.send(cachedItem.data); 
        } else {
            cache.delete(rssUrl);
            console.log(`[CACHE] Cache ${rssUrl} đã hết hạn.`);
        }
    }

    try {
        console.log(`[FETCH] Đang fetch mới ${rssUrl}...`);
        const response = await fetch(rssUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const xmlText = await response.text();
        
        cache.set(rssUrl, { data: xmlText, timestamp: now });
        console.log(`[CACHE] Đã lưu ${rssUrl} vào cache.`);
        res.type('application/xml');
        res.send(xmlText);

    } catch (error) {
        console.error("Lỗi khi fetch RSS:", error);
        res.status(500).send('Không thể lấy RSS feed: ' + error.message);
    }
});

/**
 * Endpoint 2: Tóm tắt AI (Không thay đổi)
 */
app.post('/summarize', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).send('Thiếu prompt');
    if (!API_KEY) return res.status(500).send('API Key chưa được cấu hình trên server');

    // Model này dùng để tóm tắt nội dung được cung cấp
    // (Đã sửa lại tên model cho đúng)
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;
    
    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: {
            parts: [{ text: "Bạn là một trợ lý tóm tắt tin tức. Hãy tóm tắt nội dung được cung cấp một cách súc tích, chính xác trong khoảng 100-150 từ, sử dụng ngôn ngữ tiếng Việt." }]
        },
    };

    try {
        const geminiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) throw new Error('Lỗi từ Gemini');
        const result = await geminiResponse.json();
        
        if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
            res.json({ summary: result.candidates[0].content.parts[0].text });
        } else {
            throw new Error("Không nhận được nội dung hợp lệ từ API Gemini.");
        }
    } catch (error) {
        console.error("Lỗi khi gọi Gemini (summarize):", error);
        res.status(500).send('Lỗi khi tóm tắt: ' + error.message);
    }
});

/**
 * [CẬP NHẬT] Endpoint 3: Chat AI (Kết hợp History + Google Search)
 */
app.post('/chat', async (req, res) => {
    // Sửa lại: Nhận 'history' (từ bước trước) thay vì 'prompt'
    const { history } = req.body; 
    
    if (!history || history.length === 0) {
        return res.status(400).send('Thiếu history');
    }
    if (!API_KEY) return res.status(500).send('API Key chưa được cấu hình trên server');

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;
    
    const payload = {
        // Gửi toàn bộ lịch sử (để nhớ bối cảnh)
        contents: history, 
        systemInstruction: {
            parts: [{ text: "Bạn là một trợ lý AI hữu ích và thân thiện. Hãy trả lời các câu hỏi của người dùng bằng tiếng Việt một cách rõ ràng và chi tiết. Hãy chủ động sử dụng công cụ tìm kiếm để trả lời các câu hỏi về thông tin mới, thời sự hoặc các sự kiện sau tháng 1 năm 2025." }]
        },
        // Bật công cụ Google Search (như bạn đã thêm)
        tools: [
            { "google_search": {} }
        ]
    };

    try {
        const geminiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.json();
            console.error("Lỗi API Gemini (chat):", errorBody);
            throw new Error(`Lỗi từ Gemini: ${geminiResponse.status}`);
        }

        const result = await geminiResponse.json();
        
        if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
            const answerText = result.candidates[0].content.parts[0].text;
            res.json({ answer: answerText });
        } else {
            console.warn("Kết quả trả về không có phần text:", result);
            throw new Error("Không nhận được nội dung hợp lệ từ API Gemini.");
        }
    } catch (error) {
        console.error("Lỗi khi gọi Gemini (chat):", error);
        res.status(500).send('Lỗi khi chat: ' + error.message);
    }
});


// --- Khởi động Server ---
app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
