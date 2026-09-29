# -*- coding: utf-8 -*-
# 推演冒烟用 mock LLM（OpenAI 兼容 /v1/chat/completions）：按提示词类型回罐头 JSON。
# 用途：zai 配额窗口内做接线级验证。端口 8439。用法：python mock-llm.py [port]
import json, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

GEN = json.dumps({
    "stimulus": {"speaker": "沈志远", "line": "青梧啊，把字签了，往后还是一家人。", "narration": "沈志远把一份文件推到青梧面前。"},
    "options": [
        {"kind": "推进", "text": "我不签。协议原文呢？", "action": "把文件推回去", "effect": "正面顶回，逼对方亮底牌"},
        {"kind": "回避", "text": "今天是我父亲的忌日，改天吧。", "action": "起身望向灵位", "effect": "借孝压宴，张力后移"},
        {"kind": "意外", "text": "（提笔，却写了自己的名字）", "action": "当众写名", "effect": "出格一举，满座哗然"},
        {"kind": "自由", "text": "叔替我担了半年，辛苦费怎么算？", "action": "翻开账本", "effect": "把家事变生意，反将一军"},
    ],
}, ensure_ascii=False)

# 录屏用逐拍手写剧本（mock 秒回；真模型跑同结构）
BEATS = {
    "2": {
        "stimulus": {"speaker": "沈志远", "line": "先坐下。家事桌上说，别让外人看笑话。", "narration": "沈志远笑容微僵，亲自斟了杯酒推过来。"},
        "options": [
            {"kind": "推进", "text": "这杯酒，先问问账上缺的三万两。", "action": "指尖点着账册", "effect": "把家事变生意"},
            {"kind": "回避", "text": "……叔说得是。", "action": "低头抿酒不接话", "effect": "隐忍蓄力"},
            {"kind": "意外", "text": "（端起酒泼在地上）敬我妈的。", "action": "泼酒祭母", "effect": "满座哗然"},
            {"kind": "自由", "text": "那便请叔当众讲讲代持的来历。", "action": "起身环视", "effect": "逼其当众背书"},
        ],
    },
    "3": {
        "stimulus": {"speaker": "周夫人", "line": "难怪要退婚——连身像样的衣裳都没有。", "narration": "周夫人掩口轻笑，目光在青梧的旧衣上打转。"},
        "options": [
            {"kind": "推进", "text": "退婚可以。聘礼单子，周家敢当面念吗？", "action": "从袖中抽出单据", "effect": "反将一军"},
            {"kind": "回避", "text": "（沉默，替自己斟满一杯）", "action": "不接话", "effect": "张力后移"},
            {"kind": "意外", "text": "夫人说得对。", "action": "微笑附和", "effect": "众人错愕"},
            {"kind": "自由", "text": "周家要退，先还我陪嫁的祖铺。", "action": "看向周叙", "effect": "开辟第二战线"},
        ],
    },
    "4": {
        "stimulus": {"speaker": "周叙", "line": "青梧，你听我说，这事不是……", "narration": "满堂哗然中，周叙猛地站起，嘴唇发白。"},
        "options": [
            {"kind": "推进", "text": "让他说。今天谁都别想散。", "action": "端坐不动", "effect": "逼当场摊牌"},
            {"kind": "回避", "text": "（抬手止住）不必了。", "action": "转身面向二叔", "effect": "跳过纠缠直击主线"},
            {"kind": "意外", "text": "你母亲收了多少，你知情吗？", "action": "声量不高", "effect": "引爆暗线"},
            {"kind": "自由", "text": "（把手记拍在桌上）看完再说话。", "action": "亮出手记", "effect": "亮牌留一手"},
        ],
    },
    "5": {
        "stimulus": {"speaker": "沈志远", "line": "大胆！亡父之物也敢伪造——", "narration": "沈志远脸色终于变了，抬手要夺那本手记。"},
        "options": [
            {"kind": "推进", "text": "伪造与否，请官府来验。", "action": "收手记入袖", "effect": "借势压人"},
            {"kind": "回避", "text": "（退半步收起手记）今日到此。", "action": "见好就收", "effect": "保留余味"},
            {"kind": "意外", "text": "叔看完，念给大家听。", "action": "双手递出", "effect": "以退为进"},
            {"kind": "自由", "text": "二叔急什么？", "action": "淡淡开口", "effect": "诛心一句"},
        ],
    },
}

IMPORT = json.dumps({
    "format": "deduce-script@1",
    "title": "第二章 · 灯下对质",
    "premise": "【mock导入】老宅书房夜。二叔逼签让股契，女主携亡父手记赴约，各有底牌。",
    "opening": "二叔把手记拍在桌上：「凭这半页纸，你也配谈股份？」",
    "target_beats": 8,
    "style": "古风世家宅门，电影感，冷暖对撞",
    "protagonist": "沈青梧",
    "characters": [
        {"name": "沈青梧", "archetype": "隐忍反击型", "speech_pattern": "短句带刀", "relationships": {}, "current_arc": "试探→亮牌", "forbidden": ["当众哭"]},
        {"name": "沈志远", "archetype": "圆滑施压型", "speech_pattern": "先捧后压", "relationships": {}, "current_arc": "步步紧逼", "forbidden": ["认账"]}
    ],
}, ensure_ascii=False)

SCORE = json.dumps({
    "scores": [
        {"id": "opt-1", "persona": {"p": 0.92, "why": "短句顶回，符合『客气里带刀』"},
         "drive": {"p": 0.88, "why": "逼对方亮协议，冲突升级"},
         "ooc": {"p": 0.05, "why": "完全在人设内"},
         "emotion": {"p": 0.85, "why": "承接上一拍压迫感"}},
        {"id": "opt-2", "persona": {"p": 0.9, "why": "借孝脱身是隐忍型惯技"},
         "drive": {"p": 0.62, "why": "冲突延后但加了一层孝义筹码"},
         "ooc": {"p": 0.06, "why": "符合人设"},
         "emotion": {"p": 0.88, "why": "情绪转向哀而不怒"}},
        {"id": "opt-3", "persona": {"p": 0.45, "why": "当众写名超出隐忍底线"},
         "drive": {"p": 0.7, "why": "制造意外变量"},
         "ooc": {"p": 0.42, "why": "有崩险但可解释为爆发前兆"},
         "emotion": {"p": 0.5, "why": "情绪跳跃较大"}},
        {"id": "opt-4", "persona": {"p": 0.85, "why": "算账式反问贴『按规矩来』语汇"},
         "drive": {"p": 0.75, "why": "开辟第二条战线"},
         "ooc": {"p": 0.1, "why": "基本在格内"},
         "emotion": {"p": 0.8, "why": "以攻代守衔接顺畅"}},
    ],
    "probe": {"question": "要正面撕破脸，还是先绕后路？", "paths": [
        {"label": "正面线", "desc": "当场逼出协议原件，冲突提前引爆"},
        {"label": "迂回线", "desc": "先稳住场面，从账目暗线包抄"}]},
}, ensure_ascii=False)

DRAFT = "堂上烛火晃了晃。沈志远把一份文件推到沈青梧面前，笔搁在纸上。\n\n沈志远：「青梧啊，签了它，往后沈家还是一家人。」\n\n沈青梧没有看那支笔。她把文件原样推了回去，指尖压着纸角，一寸不让。\n\n沈青梧：「我不签。协议原文呢？请叔当着满堂，念给大家听。」"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        text = ""
        for m in body.get("messages", []):
            text += str(m.get("content", ""))
        if "任务（generate" in text:
            mb = re.search(r"generate · 第(\d+)拍", text)
            beat = mb.group(1) if mb else "1"
            bv = BEATS.get(beat)
            gen = json.loads(bv) if isinstance(bv, (str, bytes)) else (bv or json.loads(GEN))
            if beat == "1":
                mo = re.search(r'"开场": "([^"]+)"', text)
                gen = dict(gen)
                gen["stimulus"] = {"speaker": "", "line": mo.group(1) if mo else "沈志远举杯。", "narration": ""}
            content = json.dumps(gen, ensure_ascii=False)
        elif "任务（import" in text:
            content = IMPORT
        elif "任务（score" in text:
            content = SCORE
        else:
            content = DRAFT
        if body.get("stream"):
            self.send_response(200)
            self.send_header("content-type", "text/event-stream")
            self.end_headers()
            def chunk(delta, finish=None):
                return json.dumps({"id": "mock", "object": "chat.completion.chunk",
                                   "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]},
                                  ensure_ascii=False)
            for part in (chunk({"role": "assistant"}), chunk({"content": content}), chunk({}, "stop")):
                self.wfile.write(f"data: {part}\n\n".encode("utf-8"))
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            resp = json.dumps({"id": "mock", "object": "chat.completion", "choices": [
                {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
            ], "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8439
    HTTPServer(("127.0.0.1", port), H).serve_forever()
