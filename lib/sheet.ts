/**
 * ดึง FAQ จาก Google Sheet (public CSV link) + in-memory cache 60 วินาที
 *
 * Schema ของ Sheet: แถวแรกเป็น header `question,answer`
 * คืนค่าเป็น string format: `Q: ... → A: ...` คั่นแต่ละคู่ด้วย newline
 */

const CACHE_TTL_MS = 60_000;

let cachedFaq: string | null = null;
let cachedAt = 0;

/** CSV parser แบบง่าย รองรับ field ที่ครอบด้วย quote (เผื่อคำตอบมี comma/ขึ้นบรรทัดใหม่) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * คืน FAQ string สำหรับใส่ใน <faq> ของ system prompt
 * - cache อายุ < 60 วิ → ใช้ cache
 * - fetch ใหม่ fail แต่มี cache เก่า → ใช้ cache เก่า (stale)
 * - fetch fail + ไม่มี cache เลย → คืน null (ให้ caller ใช้ default reply)
 */
export async function getFaq(): Promise<string | null> {
  const now = Date.now();
  if (cachedFaq !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedFaq;
  }

  try {
    const url = process.env.SHEET_CSV_URL;
    if (!url) throw new Error("SHEET_CSV_URL is not set");

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Sheet fetch failed with status ${res.status}`);

    const csv = await res.text();
    const rows = parseCsv(csv);
    const faq = rows
      .slice(1) // ข้าม header: question,answer
      .filter((r) => r[0]?.trim() && r[1]?.trim())
      .map((r) => `Q: ${r[0].trim()} → A: ${r[1].trim()}`)
      .join("\n");

    if (!faq) throw new Error("Sheet has no FAQ rows");

    cachedFaq = faq;
    cachedAt = now;
    return faq;
  } catch (err) {
    console.error("[sheet] fetch FAQ failed:", err);
    return cachedFaq; // stale cache ถ้ามี / null ถ้าไม่เคย fetch สำเร็จ
  }
}
