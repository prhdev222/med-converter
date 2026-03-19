# MedOrder Converter — AI + Offline Learning + D1

แปลง Medication Reconcile → Doctor Order  
Offline first + AI ช่วยยาใหม่ + D1 เรียนรู้ถาวร

## Architecture

```
┌────────────────────────────────────┐
│  Cloudflare Pages (Static HTML)    │
│  ├─ 137 drug rules (hardcoded)     │
│  ├─ localStorage (fast local cache)│
│  └─ Anthropic API key (optional)   │
├────────────────────────────────────┤
│  /api/parse (Pages Function)       │
│  ├─ D1 check → ยาเคยเรียนรู้?     │
│  ├─ AI chain → Workers AI/Gemini/  │
│  │             Groq (ฟรีทุกตัว)    │
│  └─ Save to D1 → ครั้งต่อไปไม่ต้อง AI │
└────────────────────────────────────┘
```

## 🚀 Deploy (4 ขั้นตอน)

```bash
# 1. Login
npm install -g wrangler && wrangler login

# 2. สร้าง D1
wrangler d1 create med-learned
# → ได้ ID กลับมา ใส่ใน wrangler.toml

# 3. สร้างตาราง
wrangler d1 execute med-learned --file=./schema.sql --remote

# 4. Deploy
wrangler pages deploy ./public --project-name med-converter
```

จากนั้นไปตั้ง Bindings ใน **Dashboard → Pages → Settings → Functions**:
- **D1 database bindings**: `DB` → `med-learned`
- **AI bindings**: `AI`
- (Optional) `GEMINI_API_KEY`, `GROQ_API_KEY`
- **Redeploy**

## 📦 โครงสร้าง (5 ไฟล์)

```
med-converter/
├── public/index.html       # Frontend (137 drugs + localStorage)
├── functions/api/parse.js   # D1 check → AI fallback → save D1
├── schema.sql               # D1 schema (ตารางเดียว)
├── wrangler.toml            # Config
└── README.md
```

## 🔄 การเรียนรู้แบบ 4 ชั้น

```
ยารู้จัก (137 ตัว)    →  ⚙ Offline rules      (ทันที, ไม่ต้อง internet)
ยาเคยเรียนรู้ (local) →  📚 localStorage        (ทันที, อยู่ใน browser)
ยาเคยเรียนรู้ (cloud) →  ☁ D1 database          (เร็ว, ไม่ต้อง AI)
ยาไม่รู้จักเลย        →  🤖 AI → save D1+local  (ครั้งเดียว, ครั้งต่อไปไม่ต้อง)
```

เดือนแรก AI อาจเรียก 20-30 ครั้ง → หลังจากนั้นแทบไม่ได้ใช้ AI อีก

## ☁ Sync ข้ามเครื่อง

คลิก **📚 Learned** → **☁ Sync D1** → ดึงยาจาก D1 cloud มาเก็บใน localStorage
- เปลี่ยนเครื่องใหม่ กด Sync ครั้งเดียว ได้ยาทั้งหมดกลับ
- หลายคนใช้ร่วมกัน → คนนึง AI แปลง คนอื่น Sync ได้

## 💰 ค่าใช้จ่าย: ฟรีทั้งหมด

| Service | Free Tier | ใช้จริง |
|---------|-----------|---------|
| Pages | Unlimited | ✅ |
| D1 | 5M reads + 100K writes/day | ใช้ ~100 reads/day |
| Workers AI | 10K neurons/day | ลดลงเรื่อยๆ |
| Gemini/Groq | Free tier | Fallback เท่านั้น |
