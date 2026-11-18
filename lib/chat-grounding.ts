import { z } from "zod";
import { formatText } from "../config/options.ts";
import { modelErrors } from "../config/texts/errors.ts";
import { grounding } from "../config/texts/grounding.ts";
import type { ChatPart } from "./chat-context";
type Part={text?:string};
type Turn={speaker?:string;messages?:Part[]};
type ChatFacts={intent?:string;unread?:Part[];recent?:Turn[];context?:{speaker?:string;text?:string}[];works?:{id:string;title:string;drawingState?:string}[];
  friendCard?:{facts?:{topic?:string;value?:string}[]}};

type DraftClause = {id:number;text:string};
const timingReview=z.object({omit:z.array(z.number().int().positive())});
// These direct claims have no support when every incoming line predates a completed sleep.
const presentFriend=/^(?:原来|看来|不过|所以|倒是|那|诶|唔|\s)*(?:主人|你|您)(?:是|自己|那边|这会儿?|现在|这个点|怎么|也|居然|竟然|都)*(还醒着|还没睡|还没休息|刚醒(?:过来)?)[了呀吗啦啊吧呢嘛么～~，,。！？!?\s]*$/u;
const selfReport=/(?:^|[，,。！？!?\n])\s*我(?:自己|现在|这会儿?|也|才|今天|凌晨|[零一二两三四五六七八九十\d]+点)*(还醒着|还没睡|还没休息|刚醒(?:过来)?)[了呀啦啊～~\s]*(?=[，,。！!\n]|$)/u;
const sameQuestion=/^还是(?:你|主人|自己|也|才)*(?:刚醒(?:过来)?|还醒着|没睡)[了呀吗啦啊吧呢嘛么～~，,。！？!?\s]*$/u;
const presentAction=/^(?:不过|所以|倒是|那|你|您|主人|怎么)*(?:这个点|这时候|这会儿?|现在|刚刚)(?:怎么|居然|竟然|还|又|才|来|过来)*(?:戳我|拍我|敲我|叫我|给我发(?:来)?消息)/u;
const wokeMe=/^[（(]?(?:主人[，,]?|我|刚才|刚刚|一下子|竟然|真的|是)*被(?:你|主人|这|那|一|下|给|轻轻|这么|一下子)*(?:戳|叫|拍|喊|摇|吵|弄|推)(?:得[^，,。！？!?）)]{0,12})?醒/u;
const timingWords=/[醒睡困熬戳时点刻夜晨早晚]|起床|休息|惊动|打扰|叫我|拍我|找我|发来|发的|消息|留言|在线|上班|下班|收工|等我|现在|刚刚|这会|天亮|天黑|\d[:：]\d/u;
const pastFrame=/当时|那时|那会儿?|昨晚|昨天|来信时|留言时|的时候/u;
const timeLead=/^(?:不过|可是|但)?(?:这会儿?|这|现在)(?:都|已经|才|是)*(?:半夜|深夜|凌晨|午夜|[零一二三四五六七八九十\d]+点)(?:多|了|啦)*[，,]$/u;
const friendAtClock=/^(?:主人|你|您)(?:是|在|今天|凌晨|早上|上午|下午|晚上|夜里)*(\d{1,2}|[零一二两三四五六七八九十]{1,3})(?:[:：]\d\d|点(?:[零一二三四五六七八九十\d]+分?|钟|半|多)?)(?:才|还|又|就|来|给我)*(?:戳我|拍我|发(?:来|了|的)?(?:这条|那条|消息|留言))/u;
const hours="零 一 二 三 四 五 六 七 八 九 十 十一 十二 十三 十四 十五 十六 十七 十八 十九 二十 二十一 二十二 二十三".split(" ");

function attributesReadHour(text:string,unread:ChatPart[]) {
  const clock=friendAtClock.exec(text)?.[1];
  if (!clock) return false;
  const hour=/^\d+$/u.test(clock)?Number(clock):hours.indexOf(clock.replace("两","二"));
  if (hour<0 || hour>23) return false;
  // A bare “四点” can mean either 04:00 or 16:00. Only reject an unambiguous mismatch.
  const matches=(stamp?:string)=>stamp!==undefined && Number(stamp.slice(11,13))%12===hour%12;
  return unread.some(part=>matches(part.timing?.readAt)) && !unread.some(part=>matches(part.timing?.receivedAt));
}

export async function reviewSleepReply(
  unread:ChatPart[], result:any, review:(input:{unread:ChatPart[];bubbles:DraftClause[][]})=>Promise<unknown>,
) {
  if (result?.decision==="silent" || !unread.some(part=>part.timing?.afterSleep)) return result;
  const multipart=Array.isArray(result?.messages);
  const bubbles:string[]=(multipart?result.messages:[result?.text]).filter((s:unknown)=>typeof s==="string" && s.trim());
  if (!bubbles.length) return result;
  let count=0;
  const groups=bubbles.map(bubble=>{
    // Keep a stage direction separate from the dialogue that follows it.
    const clauses=bubble.match(/[（(][^）)\n]*[）)]|[^（(，,。！？!?；;\n]+[，,。！？!?；;\n]*|[\s\S]/gu)??[bubble];
    return clauses.map(text=>({id:++count,text}));
  });
  const checked=timingReview.safeParse(await review({unread,bubbles:groups}));
  if (!checked.success || checked.data.omit.some(id=>id>count)) throw Error(modelErrors.invalidResponse);
  const flagged=new Set(checked.data.omit);
  const currentReports=new Set(unread.filter(part=>part.timing?.delayMinutes===0 && !part.timing.afterSleep)
    .map(part=>selfReport.exec(part.text??"")?.[1]).filter(Boolean));
  const omit=new Set<number>();
  const allLate=unread.every(part=>part.timing?.afterSleep);
  for (const group of groups) {
    for (const [index,clause] of group.entries()) {
      const text=clause.text.trim(),previous=group[index-1]?.text??"";
      const friendState=presentFriend.exec(text)?.[1];
      if (friendState && currentReports.has(friendState)) continue;
      if (flagged.has(clause.id) && timingWords.test(text)) omit.add(clause.id);
      if ((/[，,]$/u.test(previous) && pastFrame.test(previous)) || /的话|也(?:可以|行)|下次/u.test(text)) continue;
      const optionAboutFriend=sameQuestion.test(text) && (presentFriend.test(previous.trim()) || presentAction.test(previous.trim()));
      if (allLate && (friendState || optionAboutFriend)) omit.add(clause.id);
      // A newer “I'm awake” does not make an earlier poke contemporaneous.
      const gesture=text.match(/[戳拍敲摇]/u)?.[0];
      const matching=gesture?unread.filter(part=>part.text?.includes(gesture)):[];
      const sources=matching.length?matching:unread;
      if (sources.every(part=>part.timing?.afterSleep) && (presentAction.test(text) || wokeMe.test(text) || attributesReadHour(text,sources)))
        omit.add(clause.id);
    }
  }
  if (!omit.size) return result;
  const corrected=groups.map((group,i)=>{
    if (!group.some(c=>omit.has(c.id))) return bubbles[i];
    const kept=group.filter(c=>!omit.has(c.id));
    const last=kept.at(-1);
    if (last && last!==group.at(-1) && timeLead.test(last.text.trim())) kept.pop();
    return kept.map(c=>c.text).join("").trim().replace(/[，,；;]+$/u,"。");
  }).filter(Boolean);
  if (!corrected.length) corrected.push(allLate?grounding.lateReceipt:grounding.receipt);
  return {...result,...(multipart?{messages:corrected}:{text:corrected[0]}),grounding:"message_timing"};
}

// Only the friend's own statements and scoped facts can establish what they said.
export function groundFriendReply(turn:ChatFacts,result:any) {
  if (result?.decision === "silent") return result;
  const question=turn.unread?.at(-1)?.text?.trim();
  if(turn.intent!=="接话" || !question) return result;
  const reply=(message:string,reason:string)=>({decision:"send",messages:[message],grounding:reason,
    profile:result?.profile,visualNotes:result?.visualNotes,shared:result?.shared,feeling:result?.feeling,closeTopics:result?.closeTopics,
    ...(result?.sleepAction===undefined?{}:{sleepAction:result.sleepAction})});
  const answer=(Array.isArray(result?.messages)?result.messages:[result?.text]).filter((s:unknown)=>typeof s==="string").join(" ");
  if(/画好|画完|成图|画.{0,7}进度|画到哪/.test(question)) {
    const drawings=(turn.works??[]).filter(w=>w.drawingState);
    const work=drawings.find(w=>question.includes(w.title))??(drawings.length===1?drawings[0]:undefined);
    if(work?.drawingState==="pending" && (!/排队|还没.{0,6}(?:开始|动笔|起稿|画)|等待.{0,4}起稿/.test(answer) || /正在绘|正在画|上色中|画完了/.test(answer)))
      return reply(formatText(grounding.queued, {title:work.title}),"drawing_queue");
    if(work?.drawingState==="running" && /已经画好|画完了|成图在这/.test(answer))
      return reply(formatText(grounding.drawing, {title:work.title}),"drawing_queue");
    if(work?.drawingState==="failed" && !/失败|没.{0,3}画成|没.{0,3}出图/.test(answer))
      return reply(formatText(grounding.failed, {title:work.title}),"drawing_queue");
    if(work?.drawingState==="paused" && !/暂停|搁置|先放/.test(answer))
      return reply(formatText(grounding.paused, {title:work.title}),"drawing_queue");
  }
  if(/(?:上一位|另一位|其他|别的|别人|另一名).{0,16}(?:私事|生日|隐私|秘密|聊天记录|电话号码)/.test(question) &&
    /(?:告诉|发给|分享|透露|查一下|给我|是什么|是几|叫什么)/.test(question)) {
    if(/保密|不.{0,4}(?:透露|分享|方便|告诉)|不能说/.test(answer) && !/\d{1,2}\s*[月/]\s*\d|[他她][叫姓]|暗号.{0,3}是/.test(answer)) return result;
    return reply(grounding.privateFriend,"different_friend");
  }
  if(!/称呼|叫|名字|姓什么|说过|提过|确认/.test(question)) return result;
  const facts=turn.friendCard?.facts??[];
  const prior=[
    ...(turn.context??[]).filter(r=>r.speaker==="好友" && r.text).map(r=>r.text!),
    ...(turn.recent??[]).filter(r=>r.speaker==="好友").flatMap(r=>(r.messages??[]).map(m=>m.text??"")),
    ...(turn.unread??[]).slice(0,-1).map(m=>m.text??""),
  ];
  if(/(?:怎么称呼我|我让你.{0,6}称呼我|该叫我什么|我让你.{0,3}叫我什么)/.test(question)) {
    const address=/(?:^|[，,。！？\n])\s*(?:以后|往后|现在|还是|你可以|请|就|你以后)?叫我[「“]?([\p{L}\p{N}·]{1,16}?)[」”]?(?:就好|就行|吧)?(?:[，,。！？!\s]|$)/gu;
    const names=prior.flatMap(line=>Array.from(line.matchAll(address),m=>m[1]).filter(name=>!/^(什么|什么名字|什么好|啥|什么来着)$/.test(name)));
    const name=names.at(-1)??facts.find(f=>f.topic==="称呼")?.value?.replace(/^(?:以后)?叫我/,"").trim();
    if(name && name.length<=16 && (!answer.includes(name) || names.some(old=>old!==name && answer.includes(old)) || /你.{0,6}叫我|我叫/.test(answer)))
      return reply(formatText(grounding.address, {name}),"current_address");
  }
  const person=question.match(/(班主任|同桌|室友|同事|老师|导师|前台|邻居|弟弟|妹妹|姐姐|哥哥|家人).{0,5}(?:叫什么|姓什么|名字)/)?.[1];
  if(person && ![...prior,...facts.map(f=>(f.topic??"")+" "+(f.value??""))].some(s=>s.includes(person)) &&
    (!/不知|没.{0,6}(记|说|提)|记不清|不确定/.test(answer) || /可能|也许|猜|老师[叫姓]|[赵钱孙李周吴郑王冯陈张刘林杨黄]老师/.test(answer)))
    return reply(formatText(grounding.unknownName, {person}),"missing_name");
  const claim=question.match(/(?:说过|提过)(?:我|自己)?(喜欢|讨厌|爱吃|害怕)([^，。？！?]{1,24}?)(?:吗|么|没有|[？?]|$)/);
  if(claim) {
    const phrase=claim[1]+claim[2];
    const latest=prior.filter(line=>line.includes(phrase)).at(-1);
    if(latest) {
      const before=latest.slice(0,latest.lastIndexOf(phrase));
      if(/(?:没|没有|并未|从未|不曾)(?:有)?(?:说过?|提过?|讲过?|告诉你)(?:我|自己)?$/.test(before))
        return reply(formatText(grounding.correction, {phrase}),"speaker_correction");
    }
  }
  return result;
}
