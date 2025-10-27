// --- Các thư viện cần thiết ---
import express from 'express'; // Framework để tạo server
import fetch from 'node-fetch'; // Giống 'fetch' của trình duyệt, nhưng cho server
import cors from 'cors';      // Cho phép frontend gọi backend

// --- Cài đặt Server ---
const app = express();
const PORT = process.env.PORT || 3000; // Render sẽ cung cấp PORT

// --- Middleware ---
// Cho phép mọi tên miền gọi đến server này (để test, Render sẽ tự xử lý)
app.use(cors()); 
// Cho phép server đọc JSON gửi từ frontend
app.use(express.json()); 
// Quan trọng: Phục vụ file 'index.html' (và CSS/JS nếu có) từ thư mục gốc
app.use(express.static('.')); 

// Lấy API Key từ Biến Môi Trường (an toàn)
const API_KEY = process.env.GEMINI_API_KEY;

// ----- CÁC ENDPOINT (CỔNG GIAO TIẾP) -----

/**
 * Endpoint 1: Lấy RSS feed
 * Frontend sẽ gọi: /get-rss?url=https://...
 */
app.get('/get-rss', async (req, res) => {
    const rssUrl = req.query.url;
    if (!rssUrl) {
        return res.status(400).send('Thiếu tham số url');
    }

    try {
        // Server fetch trực tiếp, không cần proxy, không lo CORS!
        const response = await fetch(rssUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const xmlText = await response.text();
        
        // Gửi lại nội dung XML thô cho frontend
        res.type('application/xml');
        res.send(xmlText);

    } catch (error) {
        console.error("Lỗi khi fetch RSS:", error);
        res.status(500).send('Không thể lấy RSS feed: ' + error.message);
    }
});

/**
 * Endpoint 2: Tóm tắt AI
 * Frontend sẽ gọi: /summarize (với method POST)
 */
app.post('/summarize', async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) {
        return res.status(400).send('Thiếu prompt');
    }
    
    if (!API_KEY) {
        return res.status(500).send('API Key chưa được cấu hình trên server');
    }

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

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.json();
            console.error("Lỗi API Gemini:", errorBody);
            throw new Error(`Lỗi từ Gemini: ${geminiResponse.status}`);
        }

        const result = await geminiResponse.json();
        
        if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
            const summaryText = result.candidates[0].content.parts[0].text;
            // Gửi tóm tắt về lại cho frontend
            res.json({ summary: summaryText });
        } else {
            throw new Error("Không nhận được nội dung hợp lệ từ API Gemini.");
        }

    } catch (error) {
        console.error("Lỗi khi gọi Gemini:", error);
        res.status(500).send('Lỗi khi tóm tắt: ' + error.message);
    }
});

// --- Khởi động Server ---
app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
