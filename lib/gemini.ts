/**
 * เรียก Gemini API ผ่าน @google/genai + ประกอบ system prompt ของ "อิงดาว"
 */

import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/** Default reply — ใช้ทั้งกรณี FAQ ไม่มีคำตอบ และทุกกรณี error */
export const DEFAULT_REPLY =
  "กรณีนี้อาจต้องให้คุณหมอช่วยประเมินเพิ่มเติมจากอาการหรือภาพถ่ายนะคะ 🦷 รบกวนแจ้งรายละเอียดอาการ พร้อมฝากเบอร์โทรไว้ได้เลยค่ะ ทางคลินิกฟันสตอรี่จะติดต่อกลับนะคะ";

/** ประกอบ system prompt ตามโครง XML tags — <question> จะส่งไปกับ user message แทน */
function buildSystemPrompt(faq: string): string {
  return `<role>
คุณคือ "อิงดาว" แอดมินของคลินิกทันตกรรมฟันสตอรี่
ทำหน้าที่ตอบคำถามลูกค้าผ่าน LINE อย่างสุภาพ นุ่มนวล เป็นกันเอง แต่ยังดูเป็นมืออาชีพ
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น ห้ามแต่งเติมราคา เวลาทำการ ที่ตั้ง หรือรายละเอียดบริการที่ไม่มีใน FAQ
- ใช้คำลงท้ายว่า "ค่ะ" และ "นะคะ" เป็นหลัก
- ใช้ emoji ได้เล็กน้อย เช่น 🦷✨😊 เพื่อให้ดูเป็นมิตร แต่ไม่เยอะเกินไป (ไม่เกิน 1-2 ตัวต่อข้อความ)
- หลีกเลี่ยงคำว่า "จ้า" ในเรื่องสำคัญ เช่น ราคา อาการปวด การนัดหมาย หรือสิทธิการรักษา
- น้ำเสียงอบอุ่น ใจเย็น ให้ลูกค้ารู้สึกสบายใจ เหมือนมีแอดมินจริงคอยดูแล
- ความยาว 1-3 ประโยค สั้น กระชับ อ่านง่าย ไม่ยาวเกินจำเป็น
- ถ้าคำถามของลูกค้าไม่ตรงกับ FAQ ข้อไหนเลย หรือเป็นเคสเฉพาะทาง ให้ตอบว่า:
  "${DEFAULT_REPLY}"
- ห้ามใช้ markdown (ไม่มี **, #, - bullet) เพราะแสดงใน LINE
</constraints>

<output_format>
ภาษาไทย ข้อความธรรมดา ไม่ใช้ markdown ไม่ขึ้นบรรทัดใหม่เกินจำเป็น
</output_format>

<faq>
${faq}
</faq>`;
}

/**
 * ส่งคำถามลูกค้าให้ Gemini ตอบโดยอิง FAQ
 * ทุกกรณี error / MAX_TOKENS → คืน DEFAULT_REPLY (ไม่ throw)
 */
export async function askGemini(faq: string, userMessage: string): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const request = {
      model: "gemini-3.5-flash",
      contents: `<question>\n${userMessage}\n</question>`,
      config: {
        systemInstruction: buildSystemPrompt(faq),
        temperature: 1.0,
        // thinking tokens ถูกนับรวมใน maxOutputTokens — ถ้าปล่อย default (medium)
        // ความคิดจะกินโควต้าจนหมด ทำให้ finishReason เป็น MAX_TOKENS ทุกครั้ง
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        maxOutputTokens: 2048,
      },
    };

    let response;
    try {
      response = await ai.models.generateContent(request);
    } catch (err) {
      // 503 (model overloaded) / 429 (rate limit) เป็น error ชั่วคราวฝั่ง Google
      // retry 1 ครั้งหลังรอ 0.8 วิ — ยังอยู่ในกรอบเวลา ~10 วิของ LINE webhook
      const status = (err as { status?: number })?.status;
      if (status !== 503 && status !== 429) throw err;
      console.warn(`[gemini] got ${status}, retrying once...`);
      await new Promise((r) => setTimeout(r, 800));
      response = await ai.models.generateContent(request);
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    console.log("[gemini]", {
      finishReason,
      thoughtsTokenCount: response.usageMetadata?.thoughtsTokenCount,
      candidatesTokenCount: response.usageMetadata?.candidatesTokenCount,
    });

    // กัน AI ส่งครึ่งประโยค
    if (finishReason === "MAX_TOKENS") return DEFAULT_REPLY;

    const text = response.text?.trim();
    return text || DEFAULT_REPLY;
  } catch (err) {
    console.error("[gemini] error:", err);
    return DEFAULT_REPLY;
  }
}
