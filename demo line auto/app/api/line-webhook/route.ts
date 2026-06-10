/**
 * LINE webhook handler (POST only)
 *
 * Flow: verify signature → parse events → ดึง FAQ → เรียก Gemini → reply กลับ LINE
 * ต้อง return 200 เสมอ (ยกเว้น signature ไม่ตรง → 401) เพื่อกัน LINE retry
 */

import { messagingApi, validateSignature, webhook } from "@line/bot-sdk";
import { getFaq } from "@/lib/sheet";
import { askGemini, DEFAULT_REPLY } from "@/lib/gemini";

export async function POST(req: Request) {
  // ต้องใช้ raw body string ในการ verify signature
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  const channelSecret = process.env.LINE_CHANNEL_SECRET ?? "";
  if (!signature || !validateSignature(body, channelSecret, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  try {
    const { events } = JSON.parse(body) as { events?: webhook.Event[] };
    await Promise.all((events ?? []).map(handleEvent));
  } catch (err) {
    // log ไว้แต่ยังตอบ 200 — ป้องกัน LINE retry ซ้ำ
    console.error("[webhook] error:", err);
  }

  return Response.json({ ok: true });
}

async function handleEvent(event: webhook.Event): Promise<void> {
  // ตอบเฉพาะ text message เท่านั้น (sticker/image/video → เงียบ)
  if (event.type !== "message" || event.message.type !== "text" || !event.replyToken) {
    return;
  }

  let replyText = DEFAULT_REPLY;
  try {
    const faq = await getFaq();
    if (faq) {
      replyText = await askGemini(faq, event.message.text);
    }
  } catch (err) {
    console.error("[webhook] handle event error:", err);
  }

  try {
    const client = new messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    });
    // replyToken ใช้ได้ครั้งเดียว ภายใน ~30 วินาที
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: replyText }],
    });
  } catch (err) {
    console.error("[line] reply failed:", err);
  }
}
