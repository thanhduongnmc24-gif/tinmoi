// --- Các thư viện cần thiết ---
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
// [MỚI] Thư viện để phân tích response streaming từ Google
import { GoogleGenerativeAI } from "@google/generative-ai";

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

// [MỚI] Khởi tạo client Google AI (cần cho streaming)
let genAI;
if (API_KEY) {
    genAI = new GoogleGenerativeAI(API_KEY);
} else {
    console.error("Thiếu GEMINI_API_KEY trong biến môi trường!");
}


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
 * [CẬP NHẬT] Endpoint 2: Tóm tắt AI (Chuyển sang Streaming)
 * Đổi tên thành /summarize-stream và dùng GET thay vì POST
 * Nhận prompt qua query parameter
 */
app.get('/summarize-stream', async (req, res) => {
    const { prompt } = req.query; // Nhận prompt từ query parameter

    if (!prompt) return res.status(400).send('Thiếu prompt');
    if (!API_KEY || !genAI) return res.status(500).send('API Key chưa được cấu hình hoặc lỗi khởi tạo client');

    // Thiết lập header cho Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Gửi header ngay lập tức

    try {
        const model = genAI.getGenerativeModel({
             model: "gemini-2.5-flash-preview-09-2025", // Đảm bảo đúng model
             systemInstruction: "Bạn là một trợ lý tóm tắt tin tức. Hãy tóm tắt nội dung được cung cấp một cách súc tích, chính xác trong khoảng 100-150 từ, sử dụng ngôn ngữ tiếng Việt. Luôn giả định người dùng đang ở múi giờ Hà Nội (GMT+7)."
        });

        // Gọi API streaming
        const result = await model.generateContentStream(prompt);

        // Lặp qua từng chunk dữ liệu nhận được
        for await (const chunk of result.stream) {
            try {
                const chunkText = chunk.text();
                // Gửi chunk về client theo định dạng SSE: "data: <nội dung>\n\n"
                res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
            } catch (error) {
                 // Lỗi có thể xảy ra nếu chunk bị chặn vì an toàn (safety settings)
                 console.error("Lỗi xử lý chunk:", error);
                 // Gửi thông báo lỗi về client
                 res.write(`data: ${JSON.stringify({ error: "Một phần nội dung có thể đã bị chặn." })}\n\n`);
            }
        }
         // Gửi tín hiệu kết thúc stream
         res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
         res.end(); // Đóng kết nối

    } catch (error) {
        console.error("Lỗi khi gọi Gemini Stream:", error);
         // Gửi lỗi về client nếu có lỗi lớn xảy ra
         res.write(`data: ${JSON.stringify({ error: 'Lỗi khi tóm tắt: ' + error.message })}\n\n`);
         res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
         res.end();
    }

     // Đảm bảo kết nối đóng khi client ngắt kết nối
     req.on('close', () => {
         console.log('Client ngắt kết nối SSE');
         res.end();
     });
});


/**
 * Endpoint 3: Chat AI (Không thay đổi, vẫn dùng POST và history)
 */
app.post('/chat', async (req, res) => {
    const { history } = req.body;

    if (!history || history.length === 0) {
        return res.status(400).send('Thiếu history');
    }
    if (!API_KEY) return res.status(500).send('API Key chưa được cấu hình trên server');

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

    const payload = {
        contents: history,
        systemInstruction: {
            parts: [{ text: "Bạn là một trợ lý AI hữu ích và thân thiện. Hãy trả lời các câu hỏi của người dùng bằng tiếng Việt một cách rõ ràng và chi tiết. Hãy chủ động sử dụng công cụ tìm kiếm để trả lời các câu hỏi về thông tin mới. Luôn giả định rằng người dùng đang ở Hà Nội (múi giờ GMT+7) khi trả lời các câu hỏi liên quan đến thời gian." }]
        },
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
