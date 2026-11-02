// パイロット リハーサル（匿名フィクスチャで通し検証）。
//   実行: npm run rehearsal
//   受付 → 分類 → クライアント照合 → 注意事項確認 → 候補提示 → 手動割当 → 実績時間 → 承認待ち → 送信ブロック
// 実データ・実送信なし（AI_PROVIDER=mock、外部送信OFF）。専用の使い捨てDBを使う。
import { readFileSync, rmSync, mkdirSync } from "node:fs";

process.env.DATABASE_PATH = "./data/rehearsal.db";
process.env.AI_PROVIDER = "mock";
process.env.NODE_ENV = "development";
for (const s of ["", "-wal", "-shm"]) { try { rmSync("./data/rehearsal.db" + s); } catch {} }
mkdirSync("./data", { recursive: true });

const { db, migrate } = await import("../src/db.js");
migrate();
db.exec(readFileSync(new URL("../db/seed.pilot-rehearsal.sql", import.meta.url), "utf8"));

const { ingest } = await import("../src/ingest/pipeline.js");
const { processAll } = await import("../src/jobs/worker.js");
const { assignTask } = await import("../src/assign/assign.js");
const { addTimeEntry } = await import("../src/analytics/timeEntries.js");
const { generateDraft, sendDraft } = await import("../src/drafts/drafts.js");
const { taskDetail } = await import("../src/store/queries.js");

let pass = 0, fail = 0;
function step(n: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${n}${detail ? " — " + detail : ""}`);
  ok ? pass++ : fail++;
}

// 1) 受付（Chatwork 想定・匿名口座 cw-pilot → パイロット商事）
const o = ingest({
  channel: "chatwork", externalId: "rh-1", threadKey: "rh-room",
  sourceUrl: "https://chatwork/x", senderRaw: "cw-pilot",
  bodyRaw: "見積書お願いします。品目：コンサル、数量：1。宛名：パイロット商事。",
  receivedAt: 1720000000000,
});
step("受付：依頼を統合インボックスへ", o.status === "created", `status=${o.status}`);

// 2) 分類＋クライアント照合（AI解析＝mock）
await processAll();
const d = taskDetail(o.taskId!)!;
step("分類：業務カテゴリ付与", d.task.category === "quotation_invoice", `category=${d.task.category}`);
step("照合：クライアント特定", (d.task.client_name ?? "").includes("パイロット商事"), `client=${d.task.client_name}`);

// 3) 注意事項確認（人が確認する材料）
step("注意事項：クライアント固有ルール表示", /部長.*CC/.test(d.client_notes ?? ""), d.client_notes ?? "(なし)");

// 4) 候補提示（最大3名・根拠つき）
const cands = d.suggested;
step("候補提示：実作業者候補", cands.length >= 1, cands.map((c) => `${c.staff_name}(${c.score})`).join(", "));

// 5) 手動割当（人が確定）→ 通知は記録のみ
const r = assignTask(o.taskId!, cands[0]?.staff_id ?? "stf_a", "マネージャーM");
const notif = db.prepare("SELECT status FROM notifications WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(o.taskId!) as any;
step("手動割当：担当確定＋通知記録", r.ok && notif?.status === "recorded", `notif=${notif?.status}`);

// 6) 実績時間（15分単位）
const te = addTimeEntry(o.taskId!, cands[0]?.staff_id ?? "stf_a", 30, "リハーサル", "スタッフA");
step("実績：15分単位で記録", te.ok && te.totalActual === 30, `actual=${te.totalActual}分`);
step("実績：非15分は拒否", addTimeEntry(o.taskId!, "stf_a", 10, null, "スタッフA").ok === false);

// 7) 承認待ち（確認文案は作るが送らない・送信は3ゲートでブロック）
const draft = generateDraft(o.taskId!, "マネージャーM");
const cd = db.prepare("SELECT status FROM confirmation_drafts WHERE id=?").get(draft.id) as any;
step("承認待ち：確認文案を作成（未送信）", cd?.status === "pending");
const blocked = sendDraft(draft.id, "マネージャーM"); // 未承認＋全体OFF＋口座OFF
step("送信ブロック：承認/全体/口座のいずれかで送らない", blocked.ok === false, blocked.error ?? "");

console.log(`\n=== リハーサル結果: ${pass} PASS / ${fail} FAIL ===`);
db.close();
for (const s of ["", "-wal", "-shm"]) { try { rmSync("./data/rehearsal.db" + s); } catch {} }
process.exit(fail ? 1 : 0);
